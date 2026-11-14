# Part of Odoo. See LICENSE file for full copyright and licensing details.
import base64

from odoo import Command
from odoo.exceptions import AccessError
from odoo.tests import new_test_user, tagged

from .common import LiwanCrmCase
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule

BASE = '/api/v1/crm'
PACKAGES = f'{BASE}/packages'
PRODUCTS = '/api/v1/products'
PICK = f'{PRODUCTS}/pick'
OPPORTUNITIES = f'{BASE}/opportunities'
IMPORTS = f'{BASE}/imports'
MODES = {'saas': 'control_plane', 'non_saas': 'local_policy'}


@tagged('post_install', '-at_install', 'liwan')
class TestCrmPackages(LiwanCrmCase):
    """CRM offers service products as packages; it creates, edits and archives none (plan D4 option A and D13)."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.service = cls.env['liwan.products.service']
        cls.package = cls.make_package(1000, 'Gold')
        cls.other_manager = cls._user_in(cls.other_company, 'crm_other_manager', 'liwan_crm.role_crm_manager')
        cls.other_agent = cls._user_in(cls.other_company, 'crm_other_agent', 'liwan_crm.role_crm_agent')
        cls.settings_only = cls.custom_user('crm_settings_only', ['crm.settings.manage', 'crm.settings.read', 'crm.leads.assign', 'crm.leads.read'])

    @classmethod
    def _user_in(cls, company, login, role_xmlid):
        user = new_test_user(
            cls.env, login=login, password=f'{login}_pass_123', name=login, groups='liwan_core.group_employee',
            company_id=company.id, company_ids=[Command.set([company.id])],
        )
        cls.env['liwan.access.service']._liwan_replace_assignments(user, [{
            'role_id': cls.env.ref(role_xmlid).id, 'company_id': company.id,
        }])
        return user

    def set_mode(self, mode):
        profile = self.env.ref('liwan_platform.tenant_profile')
        self.env.cr.execute(
            'UPDATE liwan_tenant_profile SET commercial_mode=%s, entitlement_source=%s, valid_until=NULL WHERE id=%s',
            [mode, MODES[mode], profile.id],
        )
        profile.invalidate_recordset()

    def listed(self, user):
        response = self.as_user(user).api('GET', PACKAGES)
        self.assertEqual(response.status_code, 200, response.text)
        return [item['id'] for item in response.json()['items']]

    def add(self, user, product_id):
        return self.as_user(user).api('POST', PACKAGES, {'product_id': product_id})

    def product_count(self):
        return self.env['product.template'].with_context(active_test=False).search_count([])

    # Who may write a product

    def test_the_manager_role_holds_both_product_capabilities_and_the_agent_none(self):
        grants = self.env['liwan.access.service']._liwan_builtin_role_grants()
        self.assertTrue({'products.read', 'products.manage', 'products.prices.manage'} <= grants['liwan_crm.role_crm_manager'])
        self.assertFalse({key for key in grants['liwan_crm.role_crm_agent'] if key.startswith('products.')})
        manager_keys = self.env['liwan.access.service']._liwan_capability_keys(self.manager)
        self.assertTrue({'products.read', 'products.manage', 'products.prices.manage'} <= manager_keys)

    def test_the_built_in_manager_reads_the_product_list_and_detail_in_both_modes(self):
        for mode in MODES:
            with self.subTest(mode=mode):
                self.set_mode(mode)
                self.as_manager()
                listed = self.api('GET', PRODUCTS)
                self.assertEqual(listed.status_code, 200, listed.text)
                self.assertIn(self.package.id, [item['id'] for item in listed.json()['items']])
                detail = self.api('GET', f'{PRODUCTS}/{self.package.id}')
                self.assertEqual(detail.status_code, 200, detail.text)

    def test_a_settings_manager_alone_writes_no_product_through_any_route(self):
        before = self.product_count()
        self.as_user(self.settings_only)
        for method, path, body in (
            ('POST', PRODUCTS, {'name': 'Made', 'type': 'service'}),
            ('PATCH', f'{PRODUCTS}/{self.package.id}', {'list_price': 1}),
            ('POST', f'{PRODUCTS}/{self.package.id}/archive', None),
        ):
            response = self.api(method, path, body)
            self.assertEqual((response.status_code, response.json()['code']), (403, 'forbidden'), path)
        for body in ({'name': 'Made', 'price': 1}, {'product_id': self.package.id, 'name': 'Renamed'}):
            self.assertEqual(self.api('POST', PACKAGES, body).status_code, 422, body)
        for method in ('PATCH', 'PUT'):
            response = self.api(method, f'{PACKAGES}/{self.package.id}', {'price': 1})
            self.assertIn(response.status_code, (404, 405), method)
        self.assertEqual(self.product_count(), before)
        self.assertEqual((self.package.list_price, self.package.name, self.package.active), (1000, 'Gold', True))

    def test_a_settings_manager_alone_writes_no_product_through_the_orm(self):
        Template = self.env['product.template'].with_user(self.settings_only)
        with self.assertRaises(AccessError):
            Template.create({'name': 'Made'})
        with self.assertRaises(AccessError):
            Template.create({'name': 'Made', 'liwan_product': True})
        with self.assertRaises(AccessError):
            self.package.with_user(self.settings_only).write({'list_price': 1})
        stock = self.env['product.template'].create({'name': 'Stock product'})
        with self.assertRaises(AccessError):
            stock.with_user(self.settings_only).write({'name': 'Renamed'})
        with self.assertRaises(AccessError):
            self.env['product.product'].with_user(self.settings_only).create({'name': 'Variant'})
        service = self.service.with_user(self.settings_only)
        with self.assertRaises(LiwanAccessRule) as refused:
            service._liwan_create({'name': 'Made', 'type': 'service'})
        self.assertEqual(refused.exception.status, 403)
        with self.assertRaises(LiwanAccessRule):
            service._liwan_update(self.package, {'list_price': 1})
        self.assertEqual((self.package.list_price, stock.name), (1000, 'Stock product'))

    def test_the_built_in_manager_creates_and_prices_a_product_through_the_products_service(self):
        self.as_manager()
        created = self.api('POST', PRODUCTS, {'name': 'Silver', 'type': 'service', 'list_price': 450})
        self.assertEqual(created.status_code, 201, created.text)
        product_id = created.json()['id']
        priced = self.api('PATCH', f'{PRODUCTS}/{product_id}', {'list_price': 500})
        self.assertEqual((priced.status_code, priced.json()['list_price']), (200, 500), priced.text)
        added = self.add(self.manager, product_id)
        self.assertEqual(added.json(), {'id': product_id, 'name': 'Silver', 'price': 500, 'description': '', 'active': True})

    def test_the_agent_cannot_pick_or_write_a_product(self):
        self.as_agent()
        self.assertEqual(self.api('GET', PICK).status_code, 403)
        self.assertEqual(self.api('POST', PRODUCTS, {'name': 'Made', 'type': 'service'}).status_code, 403)
        self.as_user(self.outsider)
        self.assertEqual(self.api('GET', PICK).status_code, 403)

    def test_a_read_only_user_sees_the_package_prices_but_cannot_pick(self):
        readers = (
            self.custom_user('crm_leads_read_only', ['crm.leads.read']),
            self.custom_user('crm_settings_read_only', ['crm.settings.read']),
        )
        for mode in MODES:
            with self.subTest(mode=mode):
                self.set_mode(mode)
                for user in readers:
                    listed = self.as_user(user).api('GET', PACKAGES)
                    self.assertEqual(listed.status_code, 200, listed.text)
                    self.assertEqual([(item['id'], item['price']) for item in listed.json()['items']], [(self.package.id, 1000)])
                    self.assertEqual(self.api('GET', PICK).status_code, 403, user.login)
                    self.assertEqual(self.api('GET', PRODUCTS).status_code, 403, user.login)

    def test_only_the_settings_manager_picks_a_product_for_a_package(self):
        for mode in MODES:
            with self.subTest(mode=mode):
                self.set_mode(mode)
                picked = self.as_user(self.settings_only).api('GET', PICK)
                self.assertEqual(picked.status_code, 200, picked.text)
                self.assertIn(self.package.id, [item['id'] for item in picked.json()['items']])
                self.assertEqual(self.as_manager().api('GET', PICK).status_code, 200)
                self.assertEqual(self.as_agent().api('GET', PICK).status_code, 403)

    def test_a_lead_worker_records_a_sale_at_the_real_package_price(self):
        lead = self.make_lead(self.agent)
        sold = self.as_agent().api('POST', f'{OPPORTUNITIES}/{lead.id}/won', {'package_id': self.package.id, 'final_price': 1000})
        self.assertEqual(sold.status_code, 200, sold.text)
        self.assertEqual((sold.json()['list_price'], sold.json()['final_price']), (1000, 1000))

    # Offering a package

    def test_a_package_offered_by_one_company_is_not_offered_by_another(self):
        shared = self.env['product.template'].with_user(self.other_manager).with_company(self.other_company)
        self.assertEqual(shared.search_count([('id', '=', self.package.id)]), 1, 'the product is shared, so both read it')
        self.assertEqual(self.listed(self.agent), [self.package.id])
        self.assertEqual(self.listed(self.other_agent), [])
        self.assertEqual(self.listed(self.other_manager), [])
        lead = self.make_lead(self.other_agent, company=self.other_company)
        sold = self.as_user(self.other_agent).api(
            'POST', f'{OPPORTUNITIES}/{lead.id}/won', {'package_id': self.package.id, 'final_price': 1000},
        )
        self.assertEqual((sold.status_code, sold.json()['field']), (422, 'package_id'))
        self.assertEqual(self.add(self.other_manager, self.package.id).status_code, 200)
        self.assertEqual(self.listed(self.other_agent), [self.package.id])
        self.assertEqual(self.as_manager().api('DELETE', f'{PACKAGES}/{self.package.id}').status_code, 200)
        self.assertEqual((self.listed(self.agent), self.listed(self.other_agent)), ([], [self.package.id]))

    def test_adding_and_removing_a_package(self):
        silver = self.env['product.template'].create({'name': 'Silver', 'list_price': 450.5, 'liwan_product': True})
        added = self.add(self.manager, silver.id)
        self.assertEqual(added.status_code, 200, added.text)
        self.assertEqual(added.json(), {'id': silver.id, 'name': 'Silver', 'price': 450.5, 'description': '', 'active': True})
        self.assertEqual(self.add(self.manager, silver.id).status_code, 200, 'adding it again changes nothing')
        listing = self.api('GET', PACKAGES).json()
        self.assertEqual((sorted(item['id'] for item in listing['items']), listing['total']), (sorted([self.package.id, silver.id]), 2))
        removed = self.api('DELETE', f'{PACKAGES}/{silver.id}')
        self.assertEqual((removed.status_code, removed.json()['id']), (200, silver.id))
        self.assertEqual(self.listed(self.manager), [self.package.id])
        self.assertEqual(self.api('DELETE', f'{PACKAGES}/{silver.id}').status_code, 404, 'it is not a package any more')
        self.assertTrue(silver.exists() and silver.active, 'removing a package archives and deletes nothing')

    def test_a_package_that_became_archived_is_listed_as_archived_and_can_be_removed(self):
        self.package.active = False
        self.assertEqual(self.listed(self.agent), [])
        archived = self.as_agent().api('GET', f'{PACKAGES}?active=false').json()['items']
        self.assertEqual([(item['id'], item['active']) for item in archived], [(self.package.id, False)])
        self.assertEqual(self.as_manager().api('DELETE', f'{PACKAGES}/{self.package.id}').status_code, 200)
        self.assertEqual(self.api('GET', f'{PACKAGES}?active=all').json()['items'], [])

    def test_a_package_given_to_another_company_is_no_longer_offered(self):
        """A product that another company owns is never one of this company's packages, even while linked."""
        self.package.company_id = self.other_company
        self.assertEqual(self.listed(self.manager), [])
        self.assertEqual(self.env['liwan.crm.settings']._liwan_packages(self.company), self.env['product.template'])
        self.package.company_id = False
        self.assertEqual(self.listed(self.manager), [self.package.id])

    def test_a_product_that_cannot_be_picked_is_refused(self):
        archived = self.env['product.template'].create({'name': 'Old', 'liwan_product': True, 'active': False})
        stock = self.env['product.template'].create({'name': 'Stock'})
        foreign = self.env['product.template'].create({
            'name': 'Foreign', 'liwan_product': True, 'company_id': self.other_company.id,
        })
        for product in (archived, stock, foreign):
            response = self.add(self.manager, product.id)
            self.assertEqual((response.status_code, response.json()['code']), (404, 'not_found'), product.name)
        self.assertEqual(self.add(self.manager, 999999).status_code, 404)
        self.assertEqual(self.listed(self.manager), [self.package.id])

    def test_a_package_body_is_validated_and_needs_the_settings_capability(self):
        for body in ({}, {'product_id': 'x'}, {'product_id': True}, {'product_id': 0}, {'product_id': None},
                     {'product_id': self.package.id, 'company_id': 1}):
            response = self.as_manager().api('POST', PACKAGES, body)
            self.assertEqual(response.status_code, 422, body)
        for user in (self.agent, self.outsider):
            self.assertEqual(self.add(user, self.package.id).status_code, 403, user.login)
            self.assertEqual(self.as_user(user).api('DELETE', f'{PACKAGES}/{self.package.id}').status_code, 403)
        self.assertEqual(self.as_user(self.outsider).api('GET', PACKAGES).status_code, 403)

    def test_both_commercial_modes(self):
        for mode in MODES:
            with self.subTest(mode=mode):
                self.set_mode(mode)
                created = self.as_manager().api('POST', PRODUCTS, {'name': f'Mode {mode}', 'type': 'service', 'list_price': 70})
                self.assertEqual(created.status_code, 201, created.text)
                product_id = created.json()['id']
                self.assertEqual(self.add(self.manager, product_id).status_code, 200)
                self.assertIn(product_id, self.listed(self.agent))
                self.assertEqual(self.as_agent().api('GET', PICK).status_code, 403)
                self.assertEqual(self.add(self.agent, product_id).status_code, 403)
                self.assertEqual(self.as_user(self.settings_only).api('POST', PRODUCTS, {'name': 'x', 'type': 'goods'}).status_code, 403)
                self.assertEqual(self.as_manager().api('DELETE', f'{PACKAGES}/{product_id}').status_code, 200)
                self.assertNotIn(product_id, self.listed(self.agent))

    # What a lead keeps

    def test_the_lead_package_field_offers_the_companys_packages(self):
        offered = self.env['crm.lead'].fields_get(['liwan_package_id'], ['domain'])['liwan_package_id']['domain']
        self.assertEqual(offered, [('id', 'in', [self.package.id])])
        other = self.env['crm.lead'].with_company(self.other_company)
        self.assertEqual(other.fields_get(['liwan_package_id'], ['domain'])['liwan_package_id']['domain'], [('id', 'in', [])])

    def test_a_sale_prices_the_package_through_the_price_function(self):
        calls = []

        def price(model, product, quantity=1.0, uom=None, company=None, customer=None, date=None):
            calls.append((product, company))
            return {'unit_price': 800.0}

        self.patch(type(self.service), '_liwan_price', price)
        self.set_settings(discount_allowed=True, discount_max_percent=50)
        lead = self.make_lead(self.agent)
        sold = self.as_agent().api('POST', f'{OPPORTUNITIES}/{lead.id}/won', {'package_id': self.package.id, 'final_price': 600})
        self.assertEqual(sold.status_code, 200, sold.text)
        body = sold.json()
        self.assertEqual((body['list_price'], body['final_price'], body['discount_percent']), (800, 600, 25))
        self.assertEqual(calls, [(self.package, self.company)])
        self.assertEqual(lead.liwan_list_price, 800, 'the lead stores the unit price as typed, whatever the product lists now')

    def test_an_import_stores_the_unit_price_of_the_price_function(self):
        self.patch(
            type(self.service), '_liwan_price',
            lambda model, product, quantity=1.0, uom=None, company=None, customer=None, date=None: {'unit_price': 321.0},
        )
        self.company.country_id = self.env.ref('base.sa')
        source = self.env['utm.source'].create({'name': 'Packages import'})
        content = b'Name,Phone,Package\nSara,0501234567,Gold\nHuda,0507654321,\n'
        response = self.as_manager().api('POST', IMPORTS, {
            'file_name': 'leads.csv', 'content_base64': base64.b64encode(content).decode(),
            'mapping': {'name': 'Name', 'phone': 'Phone', 'package': 'Package'}, 'source_id': source.id,
        })
        self.assertEqual(response.status_code, 200, response.text)
        leads = self.env['crm.lead'].search([('phone_sanitized', 'in', ['+966501234567', '+966507654321'])])
        self.assertEqual(sorted((lead.liwan_package_id.id, lead.liwan_list_price) for lead in leads),
                         sorted([(self.package.id, 321.0), (False, 0.0)]))

    def test_an_import_prices_a_package_at_the_real_price_for_a_caller_without_a_pick_right(self):
        self.company.country_id = self.env.ref('base.sa')
        importer = self.custom_user('crm_importer_only', ['crm.leads.read', 'crm.leads.assign', 'crm.leads.import'])
        source = self.env['utm.source'].create({'name': 'Real price import'})
        content = b'Name,Phone,Package\nSara,0501234567,Gold\n'
        response = self.as_user(importer).api('POST', IMPORTS, {
            'file_name': 'leads.csv', 'content_base64': base64.b64encode(content).decode(),
            'mapping': {'name': 'Name', 'phone': 'Phone', 'package': 'Package'}, 'source_id': source.id,
        })
        self.assertEqual(response.status_code, 200, response.text)
        lead = self.env['crm.lead'].search([('phone_sanitized', '=', '+966501234567')])
        self.assertEqual((lead.liwan_package_id, lead.liwan_list_price), (self.package, 1000.0))

    def test_a_package_that_is_not_offered_cannot_be_sold(self):
        unlisted = self.env['product.template'].create({'name': 'Unlisted', 'list_price': 5, 'liwan_product': True})
        lead = self.make_lead(self.agent)
        sold = self.as_agent().api('POST', f'{OPPORTUNITIES}/{lead.id}/won', {'package_id': unlisted.id, 'final_price': 5})
        self.assertEqual((sold.status_code, sold.json()['field']), (422, 'package_id'))
        self.assertEqual(lead.won_status, 'pending')

    def test_editing_or_archiving_a_product_leaves_an_existing_lead_unchanged(self):
        lead = self.make_lead(self.agent)
        sold = self.as_agent().api('POST', f'{OPPORTUNITIES}/{lead.id}/won', {'package_id': self.package.id, 'final_price': 1000})
        self.assertEqual(sold.status_code, 200, sold.text)
        self.as_manager()
        edited = self.api('PATCH', f'{PRODUCTS}/{self.package.id}', {'list_price': 2500, 'name': 'Gold plus'})
        self.assertEqual(edited.status_code, 200, edited.text)
        self.assertEqual(self.api('POST', f'{PRODUCTS}/{self.package.id}/archive').status_code, 200)
        self.env.invalidate_all()
        self.assertEqual((lead.liwan_package_id, lead.liwan_list_price, lead.liwan_final_price), (self.package, 1000, 1000))
        shown = self.api('GET', f'{OPPORTUNITIES}/{lead.id}').json()
        self.assertEqual((shown['package']['id'], shown['list_price'], shown['final_price']), (self.package.id, 1000, 1000))
