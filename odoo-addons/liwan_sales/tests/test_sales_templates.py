# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Quotation templates: the routes, who may use and manage them, and a quotation started from one."""
from datetime import timedelta

from odoo import Command, fields
from odoo.tests import tagged

from .common import MODES, SalesWriteCase

TEMPLATES = '/api/v1/sales/templates'
ORDERS = '/api/v1/sales/orders'
ITEM_KEYS = {'id', 'name', 'validity_days', 'archived', 'line_count', 'usable', 'can_manage'}
LINE_KEYS = {'kind', 'product', 'name', 'quantity', 'usable'}


class TemplateCase(SalesWriteCase):

    def section(self, name='Scope'):
        return {'kind': 'section', 'name': name}

    def note(self, name='Delivery within a week'):
        return {'kind': 'note', 'name': name}

    def template_body(self, *lines, **extra):
        return {
            'name': 'Standard offer', 'validity_days': 14, 'terms': 'Pay within 14 days',
            'lines': list(lines or [self.section(), self.product_line(self.taxed, 2), self.note()]),
            **extra,
        }

    def make_template(self, user=None, expect=200, **body):
        response = self.api_as(user or self.manager, 'POST', TEMPLATES, self.template_body(**body) if 'name' not in body else body)
        self.assertEqual(response.status_code, expect, response.text)
        return response.json()

    def start(self, user, template, expect=200, **extra):
        response = self.api_as(user, 'POST', ORDERS, {'customer_id': self.customer.id, 'template_id': template['id'], **extra})
        self.assertEqual(response.status_code, expect, response.text)
        return response.json()


@tagged('post_install', '-at_install', 'liwan')
class TestSalesTemplateRoutes(TemplateCase):

    def test_a_manager_creates_reads_edits_archives_and_restores_a_template_in_each_session(self):
        for name, scope in self.scopes.items():
            with self.subTest(session=name):
                created = self.make_template(scope.manager)
                self.assertEqual(
                    {key: created[key] for key in ('name', 'validity_days', 'terms', 'archived', 'line_count', 'can_manage')},
                    {'name': 'Standard offer', 'validity_days': 14, 'terms': 'Pay within 14 days', 'archived': False,
                     'line_count': 3, 'can_manage': True},
                )
                self.assertEqual(set(created), ITEM_KEYS | {'terms', 'lines'})
                self.assertEqual([line['kind'] for line in created['lines']], ['section', 'product', 'note'])
                self.assertEqual(set(created['lines'][1]), LINE_KEYS)
                self.assertEqual(created['lines'][1]['product'], {'id': self.taxed.id, 'name': 'Taxed service'})
                self.assertEqual(created['lines'][1]['quantity'], 2)
                template = self.env['sale.order.template'].browse(created['id'])
                self.assertEqual(template.company_id, scope.company)
                edited = self.api_as(scope.manager, 'PATCH', f'{TEMPLATES}/{created["id"]}', {
                    'name': 'Renamed', 'validity_days': 0, 'terms': '', 'lines': [self.product_line(self.plain, 5)],
                })
                self.assertEqual(edited.status_code, 200, edited.text)
                body = edited.json()
                self.assertEqual((body['name'], body['validity_days'], body['terms'], body['line_count']), ('Renamed', 0, '', 1))
                self.assertEqual(body['lines'][0]['product']['id'], self.plain.id)
                archived = self.api_as(scope.manager, 'POST', f'{TEMPLATES}/{created["id"]}/archive')
                self.assertEqual((archived.status_code, archived.json()['archived']), (200, True))
                listed = self.api_as(scope.manager, 'GET', f'{TEMPLATES}?archived=true').json()
                self.assertEqual([item['id'] for item in listed['items']], [created['id']])
                self.assertEqual(self.api_as(scope.manager, 'GET', TEMPLATES).json()['total'], 0)
                restored = self.api_as(scope.manager, 'POST', f'{TEMPLATES}/{created["id"]}/restore')
                self.assertEqual((restored.status_code, restored.json()['archived']), (200, False))

    def test_the_list_is_searchable_and_paged_and_the_items_hold_no_lines(self):
        for name in ('Alpha offer', 'Beta offer', 'Gamma'):
            self.make_template(name=name, lines=[self.product_line(self.taxed)])
        found = self.api_as(self.agent, 'GET', f'{TEMPLATES}?q=offer').json()
        self.assertEqual((found['total'], [item['name'] for item in found['items']]), (2, ['Alpha offer', 'Beta offer']))
        self.assertTrue(all(set(item) == ITEM_KEYS for item in found['items']))
        self.assertFalse(found['items'][0]['can_manage'])
        paged = self.api_as(self.agent, 'GET', f'{TEMPLATES}?limit=1&offset=1').json()
        self.assertEqual((paged['total'], [item['name'] for item in paged['items']]), (3, ['Beta offer']))
        self.refused(self.api_as(self.agent, 'GET', f'{TEMPLATES}?archived=maybe'), 422, 'invalid', 'archived')

    def test_a_quotation_writer_picks_and_reads_but_does_not_manage(self):
        created = self.make_template()
        self.assertEqual(self.api_as(self.agent, 'GET', TEMPLATES).json()['total'], 1)
        self.assertEqual(self.api_as(self.agent, 'GET', f'{TEMPLATES}/{created["id"]}').status_code, 200)
        for method, path, body in (
            ('POST', TEMPLATES, self.template_body()),
            ('PATCH', f'{TEMPLATES}/{created["id"]}', {'name': 'x'}),
            ('POST', f'{TEMPLATES}/{created["id"]}/archive', None),
            ('POST', f'{TEMPLATES}/{created["id"]}/restore', None),
        ):
            with self.subTest(route=f'{method} {path}'):
                response = self.api_as(self.agent, method, path, body)
                self.assertEqual((response.status_code, response.json()['code']), (403, 'forbidden'))
        self.refused(self.api_as(self.agent, 'GET', f'{TEMPLATES}?archived=true'), 403, 'forbidden')

    def test_an_archived_template_is_hidden_from_a_quotation_writer(self):
        created = self.make_template()
        self.api_as(self.manager, 'POST', f'{TEMPLATES}/{created["id"]}/archive')
        self.refused(self.api_as(self.agent, 'GET', f'{TEMPLATES}/{created["id"]}'), 404, 'not_found')
        self.assertEqual(self.api_as(self.manager, 'GET', f'{TEMPLATES}/{created["id"]}').status_code, 200)
        self.refused(self.api_as(self.manager, 'PATCH', f'{TEMPLATES}/{created["id"]}', {'name': 'x'}), 403, 'transition_forbidden')
        self.refused(self.api_as(self.manager, 'POST', f'{TEMPLATES}/{created["id"]}/archive'), 403, 'transition_forbidden')
        self.api_as(self.manager, 'POST', f'{TEMPLATES}/{created["id"]}/restore')
        self.refused(self.api_as(self.manager, 'POST', f'{TEMPLATES}/{created["id"]}/restore'), 403, 'transition_forbidden')

    def test_a_reader_and_an_outsider_get_nothing_and_a_settings_only_role_manages(self):
        created = self.make_template()
        reader = self.custom_user('sales_tpl_reader', ['sales.read'])
        for user in (reader, self.outsider):
            for method, path in (('GET', TEMPLATES), ('GET', f'{TEMPLATES}/{created["id"]}')):
                with self.subTest(user=user.login, route=path):
                    response = self.api_as(user, method, path)
                    self.assertEqual((response.status_code, response.json()['code']), (403, 'forbidden'))
        settings_only = self.custom_user('sales_tpl_settings', ['sales.settings.manage'])
        own = self.make_template(settings_only, name='By settings only', lines=[self.product_line(self.taxed)])
        self.assertTrue(own['can_manage'])
        self.assertEqual(self.api_as(settings_only, 'GET', TEMPLATES).json()['total'], 2)
        self.assertEqual(self.api_as(settings_only, 'PATCH', f'{TEMPLATES}/{own["id"]}', {'name': 'Edited'}).status_code, 200)

    def test_a_template_belongs_to_its_company(self):
        root = self.make_template(self.root.manager)
        branch = self.make_template(self.in_branch.manager, name='Branch offer', lines=[self.product_line(self.taxed)])
        self.assertEqual([item['id'] for item in self.api_as(self.manager, 'GET', TEMPLATES).json()['items']], [root['id']])
        self.assertEqual(
            [item['id'] for item in self.api_as(self.in_branch.manager, 'GET', TEMPLATES).json()['items']], [branch['id']],
        )
        self.refused(self.api_as(self.in_branch.agent, 'GET', f'{TEMPLATES}/{root["id"]}'), 404, 'not_found')
        self.refused(self.api_as(self.manager, 'PATCH', f'{TEMPLATES}/{branch["id"]}', {'name': 'x'}), 404, 'not_found')
        self.refused(self.api_as(self.manager, 'POST', f'{TEMPLATES}/{branch["id"]}/archive'), 404, 'not_found')
        response = self.api_as(self.agent, 'POST', ORDERS, {'customer_id': self.customer.id, 'template_id': branch['id']})
        self.refused(response, 422, 'invalid', 'template_id')

    def test_the_body_is_checked_field_by_field(self):
        cases = (
            ({'name': ''}, 'name'), ({'name': 'x' * 201}, 'name'), ({'name': 5}, 'name'),
            ({'validity_days': -1}, 'validity_days'), ({'validity_days': 3651}, 'validity_days'),
            ({'validity_days': True}, 'validity_days'), ({'validity_days': '5'}, 'validity_days'),
            ({'terms': 5}, 'terms'), ({'terms': 'x' * 10_001}, 'terms'), ({'lines': 'x'}, 'lines'),
            ({'lines': [self.product_line(self.taxed, quantity=0)]}, 'lines.0.quantity'),
            ({'lines': [self.product_line(self.taxed, discount_percent=5)]}, 'lines.0.discount_percent'),
            ({'lines': [self.product_line(self.taxed, unit_price=5)]}, 'lines.0.unit_price'),
            ({'lines': [self.product_line(self.taxed, tax_ids=[])]}, 'lines.0.tax_ids'),
            ({'lines': [{'kind': 'product', 'quantity': 1}]}, 'lines.0.product_id'),
            ({'lines': [{'kind': 'product', 'product_id': 'x', 'quantity': 1}]}, 'lines.0.product_id'),
            ({'lines': [{'kind': 'section'}]}, 'lines.0.name'),
            ({'lines': [{'kind': 'note', 'name': 'n', 'quantity': 1}]}, 'lines.0.quantity'),
            ({'lines': [{'kind': 'other', 'name': 'n'}]}, 'lines.0.kind'),
            ({'lines': [{'id': 1, 'kind': 'note', 'name': 'n'}]}, 'lines.0.id'),
            ({'company_id': 1}, 'company_id'), ({'active': False}, 'active'),
        )
        for extra, field in cases:
            with self.subTest(field=field, extra=extra):
                body = {**self.template_body(), **extra}
                self.refused(self.api_as(self.manager, 'POST', TEMPLATES, body), 422, 'invalid', field)
        self.refused(self.api_as(self.manager, 'POST', TEMPLATES, {'lines': []}), 422, 'invalid', 'name')
        created = self.make_template()
        self.refused(self.api_as(self.manager, 'PATCH', f'{TEMPLATES}/{created["id"]}', {}), 422, 'invalid')

    def test_a_product_must_be_usable_in_the_template(self):
        old = self.service_product('Archived template service', 10.0)
        old.active = False
        sized = self.variant_template()
        self.env['liwan.products.settings']._liwan_current().sharing = 'branch'
        root_owned = self.service_product('Root owned service', 10.0, user=self.catalog, company=self.company)
        self.env['liwan.products.settings']._liwan_current().sharing = 'establishment'
        for product in (old, sized, self.product.product_tmpl_id):
            with self.subTest(product=product.name):
                body = self.template_body(self.product_line(self.plain), self.product_line(product))
                self.refused(self.api_as(self.manager, 'POST', TEMPLATES, body), 422, 'invalid', 'lines.1.product_id')
        # A product owned by the root company cannot sit in a branch template (stock's company check): a 422, never a server error.
        body = self.template_body(self.product_line(root_owned))
        self.refused(self.api_as(self.in_branch.manager, 'POST', TEMPLATES, body), 422, 'invalid', 'lines.0.product_id')
        self.assertEqual(self.api_as(self.manager, 'POST', TEMPLATES, body).status_code, 200)

    def test_the_usable_check_costs_the_same_queries_whatever_the_number_of_lines(self):
        products = [self.service_product(f'Counted {index}', 10.0) for index in range(12)]
        small = self.make_template(name='Small', lines=[self.product_line(products[0])])
        large = self.make_template(name='Large', lines=[self.product_line(product) for product in products])
        products[5].active = False
        service = self.env['liwan.sales.template'].with_user(self.manager)

        def measure(*ids):
            self.env.flush_all()
            self.env.invalidate_all()
            templates = service._liwan_model().browse(ids)
            before = self.env.cr.sql_log_count
            usable = service._liwan_usable_product_ids(templates)
            return self.env.cr.sql_log_count - before, usable

        measure(small['id'])  # warm the caches the check shares with every call
        small_queries, small_usable = measure(small['id'])
        large_queries, large_usable = measure(small['id'], large['id'])
        # Twelve more lines (and a second template) may not cost twelve more queries: the growth is bounded, not nil.
        self.assertLessEqual(large_queries, small_queries + 1)
        self.assertEqual(small_usable, {products[0].id})
        self.assertEqual(large_usable, {product.id for product in products if product.active})
        listed = {item['name']: item['usable'] for item in self.api_as(self.manager, 'GET', TEMPLATES).json()['items']}
        self.assertEqual((listed['Small'], listed['Large']), (True, False))

    def test_a_template_with_an_archived_product_reads_as_unusable(self):
        old = self.service_product('Soon archived', 10.0)
        created = self.make_template(lines=[self.product_line(old), self.note()])
        self.assertTrue(created['usable'])
        old.active = False
        detail = self.api_as(self.manager, 'GET', f'{TEMPLATES}/{created["id"]}').json()
        self.assertEqual((detail['usable'], [line['usable'] for line in detail['lines']]), (False, [False, True]))
        self.assertEqual(detail['lines'][0]['product']['name'], 'Soon archived')
        self.assertFalse(self.api_as(self.manager, 'GET', TEMPLATES).json()['items'][0]['usable'])

    def test_the_routes_work_in_both_commercial_modes(self):
        for mode in MODES:
            with self.subTest(mode=mode):
                self.set_mode(mode)
                created = self.make_template(name=f'Offer {mode}', lines=[self.product_line(self.taxed)])
                self.assertEqual(self.api_as(self.agent, 'GET', f'{TEMPLATES}/{created["id"]}').status_code, 200)
                self.start(self.agent, created)


@tagged('post_install', '-at_install', 'liwan')
class TestSalesQuotationFromTemplate(TemplateCase):

    def test_a_quotation_takes_the_lines_the_validity_and_the_terms_of_the_template(self):
        template = self.make_template()
        today = fields.Date.context_today(self.env['sale.order'])
        for name, scope in self.scopes.items():
            with self.subTest(session=name):
                body = self.start(scope.agent, template if name == 'root' else self.make_template(scope.manager))
                self.assertEqual(body['state'], 'draft')
                self.assertEqual([line['kind'] for line in body['lines']], ['section', 'product', 'note'])
                self.assertEqual([line['name'] for line in body['lines']][0::2], ['Scope', 'Delivery within a week'])
                product = body['lines'][1]
                self.assertEqual((product['quantity'], product['discount_percent']), (2, 0))
                self.assertEqual(body['validity_date'], (today + timedelta(days=14)).isoformat())
                self.assertEqual(body['terms'], 'Pay within 14 days')
                order = self.env['sale.order'].browse(body['id'])
                self.assertEqual((order.company_id, order.user_id, order.liwan_staff_document), (scope.company, scope.agent, True))
                self.assertFalse(order.sale_order_template_id)

    def test_what_the_body_gives_wins_and_what_the_template_leaves_empty_falls_back_to_the_settings(self):
        settings = self.env['liwan.sales.settings']._liwan_current()
        settings.write({'default_terms': 'Settings terms', 'validity_days': 40})
        today = fields.Date.context_today(self.env['sale.order'])
        bare = self.make_template(name='Bare', validity_days=0, terms='', lines=[self.product_line(self.taxed)])
        body = self.start(self.agent, bare)
        self.assertEqual((body['terms'], body['validity_date']), ('Settings terms', (today + timedelta(days=40)).isoformat()))
        full = self.make_template()
        given = self.start(self.agent, full, validity_date='2099-01-31', terms='Own terms')
        self.assertEqual((given['terms'], given['validity_date']), ('Own terms', '2099-01-31'))
        none = self.start(self.agent, full, validity_date=None)
        self.assertIsNone(none['validity_date'])

    def test_the_lines_are_priced_and_taxed_now_not_as_the_template_saw_them(self):
        template = self.make_template(lines=[self.product_line(self.taxed, 2)])
        before = self.start(self.agent, template)['lines'][0]
        self.taxed.list_price = 130.0
        after = self.start(self.agent, template)['lines'][0]
        self.assertEqual(before['unit_price'], self.price_of(self.taxed, 2) - 30.0)
        self.assertEqual(after['unit_price'], self.price_of(self.taxed, 2))
        self.assertNotEqual(before['unit_price'], after['unit_price'])
        self.assertEqual(after['amount_tax'], round(after['amount_untaxed'] * 0.15, 2))
        # The establishment stops being registered for VAT: the next quotation from the same template carries no tax.
        self.register(False)
        untaxed = self.start(self.agent, template)['lines'][0]
        self.assertEqual(untaxed['amount_tax'], 0.0)
        # The same lines written by hand come out the same.
        by_hand = self.post(self.agent, self.body(self.product_line(self.taxed, 2)))['lines'][0]
        self.assertEqual((untaxed['unit_price'], untaxed['amount_tax']), (by_hand['unit_price'], by_hand['amount_tax']))

    def test_the_template_is_not_the_source_of_a_price_even_when_stock_holds_one(self):
        template = self.make_template(lines=[self.product_line(self.taxed)])
        line = self.env['sale.order.template'].browse(template['id']).sale_order_template_line_ids
        self.assertFalse(any(field for field in line._fields if 'price' in field))
        self.assertEqual(self.start(self.agent, template)['lines'][0]['unit_price'], self.price_of(self.taxed, 1))

    def test_an_optional_line_is_left_out(self):
        template = self.make_template(lines=[self.product_line(self.taxed), self.note('Kept')])
        record = self.env['sale.order.template'].browse(template['id'])
        record.write({'sale_order_template_line_ids': [Command.create({
            'product_id': self.plain.product_variant_id.id, 'product_uom_qty': 1, 'is_optional': True, 'sequence': 99,
        })]})
        body = self.start(self.agent, template)
        self.assertEqual([line['kind'] for line in body['lines']], ['product', 'note'])

    def test_a_template_whose_product_is_gone_refuses_the_quotation_and_names_it(self):
        old = self.service_product('Gone service', 10.0)
        template = self.make_template(lines=[self.product_line(self.taxed), self.product_line(old)])
        old.active = False
        response = self.api_as(self.agent, 'POST', ORDERS, {'customer_id': self.customer.id, 'template_id': template['id']})
        body = self.refused(response, 422, 'template_unusable', 'template_id')
        self.assertEqual(body['details'], {'product': 'Gone service'})
        self.assertFalse(self.env['sale.order'].search([('partner_id', '=', self.customer.id), ('state', '=', 'draft')]))

    def test_a_product_renamed_after_the_template_was_saved_gives_its_current_name(self):
        product = self.service_product('Before the rename', 10.0)
        # The editor echoes the default description back: it is not kept as the template's own text.
        template = self.make_template(lines=[self.product_line(product, name='Before the rename')])
        line = self.env['sale.order.template'].browse(template['id']).sale_order_template_line_ids
        self.assertFalse(line.name)
        product.name = 'After the rename'
        self.assertIn('After the rename', self.start(self.agent, template)['lines'][0]['name'])

    def test_a_product_with_an_arabic_translation_reads_in_the_language_of_the_quotation(self):
        self.env['res.lang']._activate_lang('ar_001')
        product = self.service_product('English product', 10.0)
        product.with_context(lang='ar_001').name = 'منتج عربي'
        template = self.make_template(lines=[self.product_line(product)])
        self.customer.lang = 'ar_001'
        self.assertIn('منتج عربي', self.start(self.agent, template)['lines'][0]['name'])
        self.customer.lang = 'en_US'
        self.assertIn('English product', self.start(self.agent, template)['lines'][0]['name'])

    def test_a_template_line_with_its_own_text_keeps_it(self):
        template = self.make_template(lines=[self.product_line(self.taxed, name='Our own wording')])
        self.assertEqual(self.api_as(self.manager, 'GET', f'{TEMPLATES}/{template["id"]}').json()['lines'][0]['name'], 'Our own wording')
        self.assertEqual(self.start(self.agent, template)['lines'][0]['name'], 'Our own wording')

    def test_a_missing_or_archived_template_and_a_template_with_lines_are_a_422(self):
        template = self.make_template()
        cases = (
            ({'template_id': 999_999}, 'template_id'),
            ({'template_id': 'x'}, 'template_id'),
            ({'template_id': template['id'], 'lines': []}, 'template_id'),
        )
        for extra, field in cases:
            with self.subTest(extra=extra):
                response = self.api_as(self.agent, 'POST', ORDERS, {'customer_id': self.customer.id, **extra})
                self.refused(response, 422, 'invalid', field)
        self.api_as(self.manager, 'POST', f'{TEMPLATES}/{template["id"]}/archive')
        response = self.api_as(self.agent, 'POST', ORDERS, {'customer_id': self.customer.id, 'template_id': template['id']})
        self.refused(response, 422, 'invalid', 'template_id')

    def test_a_template_starts_a_quotation_only_on_create(self):
        template = self.make_template()
        order = self.post(self.agent, self.body())
        response = self.api_as(self.agent, 'PATCH', f'{ORDERS}/{order["id"]}', {'template_id': template['id']})
        self.refused(response, 422, 'invalid', 'template_id')

    def test_starting_a_quotation_still_needs_the_quotation_capability_and_the_customer(self):
        template = self.make_template()
        settings_only = self.custom_user('sales_tpl_start', ['sales.settings.manage'])
        response = self.api_as(settings_only, 'POST', ORDERS, {'customer_id': self.customer.id, 'template_id': template['id']})
        self.assertEqual((response.status_code, response.json()['code']), (403, 'forbidden'))
        response = self.api_as(self.agent, 'POST', ORDERS, {'template_id': template['id']})
        self.refused(response, 422, 'invalid', 'customer_id')

    def test_a_discount_limit_does_not_apply_to_a_template_line_that_has_no_discount(self):
        self.set_discount_limit(5)
        template = self.make_template(lines=[self.product_line(self.taxed)])
        self.assertEqual(self.start(self.agent, template)['lines'][0]['discount_percent'], 0)


@tagged('post_install', '-at_install', 'liwan')
class TestSalesTemplateOdooSurface(TemplateCase):

    def test_the_stock_quotation_template_routes_and_portal_stay_closed(self):
        order = self.make_order(self.agent)
        params = {'order_id': order.id, 'line_id': 1, 'access_token': order._portal_ensure_token()}
        for signed_in in (False, True):
            if signed_in:
                self.as_user(self.agent)
            else:
                self.opener.cookies.clear()
            with self.subTest(signed_in=signed_in):
                response = self.url_open(
                    f'/my/orders/{order.id}/update_line_dict',
                    json={'jsonrpc': '2.0', 'method': 'call', 'params': params},
                )
                self.assertEqual(response.status_code, 404, response.text)
                for path in (f'/my/orders/{order.id}?access_token={params["access_token"]}', '/my/quotes'):
                    self.assertEqual(self.url_open(path).status_code, 404, path)
