# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The /api/v1/products routes: sharing between branches, the capabilities, D23 and the settings."""
from odoo.tests import tagged

from odoo.addons.liwan_api.tests.common import set_probe_feature
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule
from odoo.addons.liwan_products.tests.common import (
    PICK,
    PRODUCTS,
    SETTINGS,
    ProductsCase,
)

MODES = ('saas', 'non_saas')


@tagged('post_install', '-at_install', 'liwan')
class TestProductsRoutes(ProductsCase):

    def test_an_establishment_product_is_found_by_every_branch(self):
        for mode in MODES:
            with self.subTest(mode=mode), self.undone():
                self.set_mode(mode)
                set_probe_feature(self)
                product = self.created({'name': f'Shared {mode}', 'type': 'service', 'list_price': 50})
                self.assertIsNone(product['company'])
                for login in ('pr_a_staff', 'pr_b_staff'):
                    self.sign_in(login)
                    self.assertIn(product['id'], self.listed_ids('Shared'))
                    self.assertEqual(self.api('GET', f'{PRODUCTS}/{product["id"]}').status_code, 200)
                self.sign_in('pr_picker')
                self.assertIn(product['id'], self.picked_ids())

    def test_a_branch_product_is_found_by_its_branch_only(self):
        for mode in MODES:
            with self.subTest(mode=mode), self.undone():
                self.set_mode(mode)
                set_probe_feature(self)
                self.settings.sharing = 'branch'
                product = self.created({'name': f'Branch {mode}', 'type': 'goods'}, login='pr_a_staff')
                self.assertEqual(product['company'], {'id': self.branch_a.id, 'name': self.branch_a.name})
                self.assertIn(product['id'], self.listed_ids('Branch'))
                self.sign_in('pr_b_staff')
                self.assertNotIn(product['id'], self.listed_ids('Branch'))
                self.assertEqual(self.api('GET', f'{PRODUCTS}/{product["id"]}').status_code, 404)

    def test_the_detail_shape_carries_the_three_amounts(self):
        product = self.created({'name': 'Shaped', 'type': 'goods', 'list_price': 115, 'description': 'A thing'})
        self.assertEqual(product['type'], 'goods')
        self.assertEqual(product['description'], 'A thing')
        self.assertEqual(product['list_price'], 115)
        self.assertTrue(product['active'])
        price = product['price']
        self.assertEqual(price['unit_price'], 115)
        self.assertEqual(price['currency']['id'], self.root_company.currency_id.id)
        self.assertEqual(
            set(price), {'unit_price', 'amount_untaxed', 'amount_tax', 'amount_total', 'currency'},
        )

    def test_without_products_manage_nothing_is_created_or_written(self):
        product = self.created({'name': 'Guarded', 'type': 'service', 'list_price': 10})
        for mode in MODES:
            for login in ('pr_nobody', 'pr_picker', 'mb_root_plain'):
                with self.subTest(mode=mode, login=login), self.undone():
                    self.set_mode(mode)
                    set_probe_feature(self)
                    self.sign_in(login)
                    self.assertRefused(self.api('POST', PRODUCTS, {'name': 'X', 'type': 'goods'}), 403, 'forbidden')
                    path = f'{PRODUCTS}/{product["id"]}'
                    self.assertRefused(self.api('PATCH', path, {'name': 'X'}), 403, 'forbidden')
                    for action in ('archive', 'restore'):
                        self.assertRefused(self.api('POST', f'{path}/{action}'), 403, 'forbidden')
        self.assertEqual(self.env['product.template'].browse(product['id']).name, 'Guarded')

    def test_a_price_needs_the_price_capability(self):
        for mode in MODES:
            with self.subTest(mode=mode), self.undone():
                self.set_mode(mode)
                set_probe_feature(self)
                self._check_price_capability()

    def _check_price_capability(self):
        self.sign_in('pr_root_manager')
        self.assertRefused(self.api('POST', PRODUCTS, {'name': 'P', 'type': 'goods', 'list_price': 5}), 403, 'forbidden')
        product = self.created({'name': 'Unpriced', 'type': 'goods'}, login='pr_root_manager')
        self.assertEqual(product['list_price'], 0)
        path = f'{PRODUCTS}/{product["id"]}'
        self.assertRefused(self.api('PATCH', path, {'list_price': 9}), 403, 'forbidden')
        self.assertRefused(self.api('PATCH', path, {'name': 'Renamed', 'list_price': 9}), 403, 'forbidden')
        self.sign_in('pr_root_pricer')
        response = self.api('PATCH', path, {'list_price': 9})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['list_price'], 9)
        self.assertRefused(self.api('PATCH', path, {'name': 'Pricer rename'}), 403, 'forbidden')
        self.assertRefused(self.api('POST', f'{path}/archive'), 403, 'forbidden')
        self.assertRefused(self.api('POST', PRODUCTS, {'name': 'P', 'type': 'goods', 'list_price': 5}), 403, 'forbidden')
        self.assertEqual(self.env['product.template'].browse(product['id']).name, 'Unpriced')

    def test_a_shared_product_is_written_in_the_root_only(self):
        product = self.created({'name': 'Root managed', 'type': 'service', 'list_price': 10})
        path = f'{PRODUCTS}/{product["id"]}'
        for mode in MODES:
            with self.subTest(mode=mode), self.undone():
                self.set_mode(mode)
                set_probe_feature(self)
                self.sign_in('pr_a_staff')
                for method, url, body in (
                    ('PATCH', path, {'name': 'From A'}), ('PATCH', path, {'list_price': 1}),
                    ('POST', f'{path}/archive', None), ('POST', PRODUCTS, {'name': 'A new', 'type': 'goods'}),
                ):
                    response = self.api(method, url, body)
                    self.assertRefused(response, 403, 'forbidden')
                    self.assertEqual(response.json()['details']['reason'], 'managed_in_root_company')
                self.sign_in('pr_root_staff')
                response = self.api('PATCH', path, {'name': 'From root', 'list_price': 12})
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(self.api('POST', f'{path}/archive').json()['active'], False)
                self.assertEqual(self.api('POST', f'{path}/restore').json()['active'], True)

    def test_a_branch_product_is_written_in_its_branch_only(self):
        self.settings.sharing = 'branch'
        product = self.created({'name': 'A own', 'type': 'goods', 'list_price': 3}, login='pr_a_staff')
        path = f'{PRODUCTS}/{product["id"]}'
        response = self.api('PATCH', path, {'name': 'A renamed', 'list_price': 4})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.api('POST', f'{path}/archive').status_code, 200)
        self.assertEqual(self.api('POST', f'{path}/restore').status_code, 200)
        self.sign_in('pr_b_staff')
        self.assertEqual(self.api('PATCH', path, {'name': 'From B'}).status_code, 404)
        self.assertEqual(self.env['product.template'].browse(product['id']).name, 'A renamed')

    def test_the_service_refuses_what_the_route_would(self):
        """An application calls the service from its own route: the capability and D23 checks are the service's."""
        service = self.env['liwan.products.service']
        product = service.with_user(self.root_staff).with_company(self.root_company)._liwan_create(
            {'name': 'Direct', 'type': 'goods', 'list_price': 2},
        )
        for user, company in ((self.nobody, self.branch_a), (self.a_staff, self.branch_a), (self.root_manager, self.root_company)):
            with self.subTest(user=user.login), self.assertRaisesRegex(LiwanAccessRule, 'forbidden'):
                service.with_user(user).with_company(company)._liwan_update(product, {'list_price': 3})
        with self.assertRaisesRegex(LiwanAccessRule, 'forbidden'):
            service.with_user(self.nobody).with_company(self.branch_a)._liwan_create({'name': 'N', 'type': 'goods'})

    def test_unknown_and_invalid_values_are_refused(self):
        self.sign_in('pr_root_staff')
        for body, field in (
            ({'name': 'X', 'type': 'goods', 'colour': 'red'}, 'colour'),
            ({'name': 'X', 'type': 'combo'}, 'type'),
            ({'name': '', 'type': 'goods'}, 'name'),
            ({'name': 'X', 'type': 'goods', 'list_price': -1}, 'list_price'),
            ({'name': 'X', 'type': 'goods', 'list_price': True}, 'list_price'),
            ({'type': 'goods'}, 'name'),
        ):
            with self.subTest(body=body):
                response = self.api('POST', PRODUCTS, body)
                self.assertRefused(response, 422, 'invalid')
                self.assertEqual(response.json()['field'], field)

    def test_the_settings(self):
        self.sign_in('pr_a_staff')
        current = self.api('GET', SETTINGS).json()
        self.assertEqual(current, {'sharing': 'establishment', 'can_manage': False, 'revision': self.settings.revision})
        self.sign_in('pr_a_settings')
        self.assertRefused(self.api('PATCH', SETTINGS, {'sharing': 'branch', 'revision': current['revision']}), 403, 'forbidden')
        self.sign_in('pr_root_settings')
        self.assertRefused(self.api('PATCH', SETTINGS, {'sharing': 'branch', 'revision': current['revision'] + 5}), 409, 'conflict')
        response = self.api('PATCH', SETTINGS, {'sharing': 'branch', 'revision': current['revision']})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['sharing'], 'branch')
        self.assertTrue(response.json()['can_manage'])
        revision = response.json()['revision']
        self.created({'name': 'Blocks sharing', 'type': 'goods'}, login='pr_a_staff')
        self.sign_in('pr_root_settings')
        response = self.api('PATCH', SETTINGS, {'sharing': 'establishment', 'revision': revision})
        self.assertRefused(response, 409, 'sharing_transfer_required')
        self.assertEqual(self.settings.sharing, 'branch')

    def test_an_archived_product_still_blocks_the_sharing_change(self):
        product = self.created({'name': 'Archived blocker', 'type': 'goods'})
        self.api('POST', f'{PRODUCTS}/{product["id"]}/archive')
        self.sign_in('pr_root_settings')
        response = self.api('PATCH', SETTINGS, {'sharing': 'branch', 'revision': self.settings.revision})
        self.assertRefused(response, 409, 'sharing_transfer_required')

    def test_the_routes_follow_the_registered_feature(self):
        for mode in MODES:
            with self.subTest(mode=mode), self.undone():
                self.set_mode(mode)
                set_probe_feature(self, enabled=False)
                self.sign_in('pr_root_staff')
                for path in (PRODUCTS, PICK, SETTINGS):
                    self.assertEqual(self.api('GET', path).status_code, 403, path)
                set_probe_feature(self)
                for path in (PRODUCTS, PICK, SETTINGS):
                    self.assertEqual(self.api('GET', path).status_code, 200, path)

    def test_nothing_is_open_while_no_feature_is_registered(self):
        self.patch(type(self.env['liwan.products.service']), '_liwan_products_feature_keys', lambda model: ())
        self.sign_in('pr_root_staff')
        response = self.api('GET', PRODUCTS)
        self.assertRefused(response, 403, 'feature_not_included')

    def test_the_pick_list_is_for_pick_holders(self):
        product = self.created({'name': 'Pickable', 'type': 'service', 'list_price': 20})
        self.sign_in('pr_picker')
        response = self.api('GET', PICK)
        self.assertEqual(response.status_code, 200, response.text)
        item = next(item for item in response.json()['items'] if item['id'] == product['id'])
        self.assertEqual(
            set(item), {'id', 'name', 'type', 'unit_price', 'amount_untaxed', 'amount_tax', 'amount_total', 'currency'},
        )
        self.assertEqual(self.api('GET', PRODUCTS).status_code, 403)
        self.sign_in('pr_nobody')
        self.assertRefused(self.api('GET', PICK), 403, 'forbidden')
