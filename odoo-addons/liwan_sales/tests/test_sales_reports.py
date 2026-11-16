# Part of Odoo. See LICENSE file for full copyright and licensing details.
import csv
import io
from datetime import datetime
from unittest.mock import patch

from odoo import Command
from odoo.exceptions import ValidationError
from odoo.tests import tagged

from .common import MODES, LiwanSalesCase
from odoo.addons.liwan_api.serializers import csv_export
from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT
from odoo.addons.liwan_sales.serializers.reports import EXPORT_COLUMNS

SUMMARY = '/api/v1/sales/reports/summary'
BREAKDOWN = '/api/v1/sales/reports/breakdown'
EXPORT = '/api/v1/sales/reports/export'
REPORT_KEYS = ('sales.read', 'sales.reports.read')
GROUP_KEYS = {'orders', 'amount_untaxed', 'amount_total'}
ITEM_KEYS = {'key', 'label', 'orders', 'quantity', 'amount_untaxed', 'amount_total'}


class SalesReportsCase(LiwanSalesCase):
    """A small book of known figures in the root, a branch and a company the caller never reaches.

    Root (no tax, so untaxed and total agree): ``o1`` 100 of A by agent for C1 on 2026-01-10 (confirmed); ``o2`` 110
    (A x1 at 50 and B x3 at 20) by agent2 for C2 on 2026-01-20 (confirmed); ``o3`` a 50 quotation by agent on
    2026-02-10; ``o4`` a 200 cancelled order by agent; ``o5`` a 100 online order of B x5, nobody's, on 2026-02-05
    (confirmed). Branch: ``b1`` 500 by the branch agent. Another company: ``x1`` 500.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.product_b = cls.env['product.product'].create({
            'name': 'Report service B', 'type': 'service', 'list_price': 20.0, 'taxes_id': [Command.clear()],
        })
        cls.o1 = cls.booked(cls.agent, [(cls.product, 2, 50.0)], 'C1', '2026-01-10 09:00:00', 'sale')
        cls.o2 = cls.booked(cls.agent2, [(cls.product, 1, 50.0), (cls.product_b, 3, 20.0)], 'C2', '2026-01-20 09:00:00', 'sale')
        cls.o3 = cls.booked(cls.agent, [(cls.product, 1, 50.0)], 'C1', '2026-02-10 09:00:00', 'draft')
        cls.o4 = cls.booked(cls.agent, [(cls.product, 4, 50.0)], 'C1', '2026-02-12 09:00:00', 'cancel')
        cls.o5 = cls.booked(None, [(cls.product_b, 5, 20.0)], 'C3', '2026-02-05 09:00:00', 'sale', staff=False)
        cls.b1 = cls.booked(cls.in_branch.agent, [(cls.product, 10, 50.0)], 'BC', '2026-01-15 09:00:00', 'sale', company=cls.branch)
        cls.x1 = cls.booked(None, [(cls.product, 10, 50.0)], 'XC', '2026-01-15 09:00:00', 'sale', company=cls.other_company)
        cls.env.flush_all()
        cls.reporter = cls.custom_user('sales_reporter', set(REPORT_KEYS))
        cls.assigner = cls.custom_user('sales_assigner', {*REPORT_KEYS, 'sales.documents.assign'})
        cls.read_only = cls.custom_user('sales_read_only', {'sales.read'})
        cls.branch_reporter = cls.custom_user('sales_b_reporter', set(REPORT_KEYS), company=cls.branch)
        cls.set_visibility('own')

    @classmethod
    def booked(cls, user, lines, customer, when, state, *, staff=True, company=None):
        """An order of ``lines`` ``(product, quantity, price)`` placed at ``when`` in ``state``, made as the superuser."""
        order = cls.make_order(
            user, company, staff=staff, customer=customer, lines=[
                Command.create({'product_id': product.id, 'product_uom_qty': quantity, 'price_unit': price})
                for product, quantity, price in lines
            ],
        )
        if state == 'sale':
            order.with_company(order.company_id).action_confirm()
        elif state == 'cancel':
            order._action_cancel()
        order.write({'date_order': datetime.fromisoformat(when)})
        return order

    def summary(self, user, query='', expect=200):
        response = self.api_as(user, 'GET', f'{SUMMARY}{query}')
        self.assertEqual(response.status_code, expect, response.text)
        return response.json()

    def breakdown(self, user, by, query='', expect=200):
        response = self.api_as(user, 'GET', f'{BREAKDOWN}?by={by}{query}')
        self.assertEqual(response.status_code, expect, response.text)
        return response.json()

    @staticmethod
    def figures(group):
        return group['orders'], group['amount_untaxed'], group['amount_total']

    def amounts(self, body):
        """``{key: (orders, total)}`` of a breakdown."""
        return {item['key']: (item['orders'], item['amount_total']) for item in body['items']}


@tagged('post_install', '-at_install', 'liwan')
class TestSalesReportAccess(SalesReportsCase):

    def test_a_report_needs_the_reports_capability_and_the_read_capability(self):
        routes = (SUMMARY, f'{BREAKDOWN}?by=customer', EXPORT)
        allowed = (self.reporter, self.assigner, self.manager, self.in_branch.manager)
        refused = (self.agent, self.read_only, self.outsider)
        for path in routes:
            for user in allowed:
                with self.subTest(path=path, user=user.login, outcome='allowed'):
                    self.assertEqual(self.api_as(user, 'GET', path).status_code, 200, user.login)
            for user in refused:
                with self.subTest(path=path, user=user.login, outcome='refused'):
                    body = self.api_as(user, 'GET', path).json()
                    self.assertEqual(body['code'], 'forbidden')

    def test_the_capability_is_the_managers_and_not_the_agents_or_the_employees(self):
        keys = self.env['liwan.access.service']._liwan_capability_keys
        self.assertIn('sales.reports.read', keys(self.manager, company=self.company))
        self.assertNotIn('sales.reports.read', keys(self.agent, company=self.company))
        self.assertNotIn('sales.reports.read', keys(self.outsider, company=self.company))
        permission = self.env['liwan.access.permission'].search([('key', '=', 'sales.reports.read')])
        self.assertEqual(permission.dependency_ids.mapped('key'), ['sales.read'])

    def test_a_role_cannot_hold_the_reports_capability_without_the_read_capability(self):
        with self.assertRaises(ValidationError):
            self.custom_user('sales_reports_only', {'sales.reports.read'})

    def test_both_commercial_modes_serve_the_reports(self):
        for mode in MODES:
            with self.subTest(mode=mode):
                self.set_mode(mode)
                self.assertEqual(self.summary(self.manager)['confirmed']['orders'], 3)


@tagged('post_install', '-at_install', 'liwan')
class TestSalesReportVisibility(SalesReportsCase):

    def test_under_own_a_salesperson_reads_their_own_and_the_unassigned(self):
        self.set_visibility('own')
        own = self.booked(self.reporter, [(self.product_b, 1, 30.0)], 'C4', '2026-02-20 09:00:00', 'sale')
        self.env.flush_all()
        body = self.summary(self.reporter)
        self.assertEqual(self.figures(body['confirmed']), (2, 130.0, 130.0), 'their own order and the online one')
        customers = self.breakdown(self.reporter, 'customer')
        self.assertEqual({item['label'] for item in customers['items']}, {'C3', own.partner_id.name})

    def test_under_own_a_salesperson_never_sees_a_colleagues_numbers(self):
        self.set_visibility('own')
        body = self.summary(self.reporter)
        self.assertEqual(self.figures(body['confirmed']), (1, 100.0, 100.0), 'only the online order: nobody else is theirs')
        self.assertEqual(self.figures(body['quotations']), (0, 0.0, 0.0))
        self.assertEqual(self.figures(body['cancelled']), (0, 0.0, 0.0))
        self.assertEqual(self.amounts(self.breakdown(self.reporter, 'salesperson')), {None: (1, 100.0)})

    def test_a_holder_of_assign_sees_every_document_whatever_the_setting(self):
        for mode in ('own', 'all'):
            self.set_visibility(mode)
            with self.subTest(mode=mode):
                body = self.summary(self.assigner)
                self.assertEqual(self.figures(body['confirmed']), (3, 310.0, 310.0))
                self.assertEqual(self.figures(body['quotations']), (1, 50.0, 50.0))
                self.assertEqual(self.figures(body['cancelled']), (1, 200.0, 200.0))
        self.set_visibility('own')

    def test_under_all_a_reader_sees_the_whole_company(self):
        self.set_visibility('all')
        try:
            self.assertEqual(self.figures(self.summary(self.reporter)['confirmed']), (3, 310.0, 310.0))
        finally:
            self.set_visibility('own')

    def test_the_report_rows_and_the_list_agree_for_every_user_and_both_settings(self):
        fixture = {order.name: order for order in (self.o1, self.o2, self.o3, self.o4, self.o5)}
        for mode in ('own', 'all'):
            self.set_visibility(mode)
            for user in (self.reporter, self.assigner, self.manager):
                with self.subTest(mode=mode, user=user.login):
                    listed = {
                        item['number'] for item in self.api_as(user, 'GET', '/api/v1/sales/orders?limit=200').json()['items']
                    } & set(fixture)
                    rows = self.env['sale.report'].with_user(user).with_context(allowed_company_ids=[self.company.id])
                    in_orm = set(rows.search([('company_id', '=', self.company.id)]).mapped('name')) & set(fixture)
                    self.assertEqual(in_orm, listed, 'the record rules of sale.report give the list its documents')
                    exported = {row[0] for row in self.export_rows(user, 'state=draft,sent,confirmed,cancelled')[1:]} & set(fixture)
                    self.assertEqual(exported, listed)
        self.set_visibility('own')

    def test_the_analysis_itself_is_bounded_by_the_record_rules_for_a_salesperson(self):
        self.set_visibility('own')
        rows = self.env['sale.report'].with_user(self.reporter).with_context(allowed_company_ids=[self.company.id])
        names = set(rows.search([('company_id', '=', self.company.id)]).mapped('name'))
        self.assertEqual(names, {self.o5.name})
        self.set_visibility('all')
        try:
            # The rule domain reads a computed field of the user: a test that flips the setting drops what it cached.
            self.env.invalidate_all()
            names = set(rows.with_user(self.reporter).search([('company_id', '=', self.company.id)]).mapped('name'))
            self.assertEqual(names, {order.name for order in (self.o1, self.o2, self.o3, self.o4, self.o5)})
        finally:
            self.set_visibility('own')

    def test_the_root_and_a_branch_each_read_only_their_own_company(self):
        self.assertEqual(self.figures(self.summary(self.manager)['confirmed']), (3, 310.0, 310.0))
        self.assertEqual(self.figures(self.summary(self.in_branch.manager)['confirmed']), (1, 500.0, 500.0))
        self.set_visibility('all')
        try:
            self.assertEqual(self.figures(self.summary(self.branch_reporter)['confirmed']), (1, 500.0, 500.0))
        finally:
            self.set_visibility('own')

    def test_another_companys_orders_are_never_counted_or_exported(self):
        names = {row[0] for row in self.export_rows(self.manager, 'state=draft,sent,confirmed,cancelled')[1:]}
        self.assertNotIn(self.x1.name, names)
        self.assertNotIn(self.b1.name, names)
        by_customer = self.breakdown(self.manager, 'customer')
        self.assertNotIn('XC', {item['label'] for item in by_customer['items']})

    def export_rows(self, user, query=''):
        response = self.api_as(user, 'GET', f'{EXPORT}?{query}')
        self.assertEqual(response.status_code, 200, response.text)
        return list(csv.reader(io.StringIO(response.content.decode('utf-8-sig'))))


@tagged('post_install', '-at_install', 'liwan')
class TestSalesReportFigures(SalesReportsCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.set_visibility('all')

    def test_the_summary_counts_each_state_group_in_the_company_currency(self):
        body = self.summary(self.manager)
        self.assertEqual(set(body), {'currency', 'confirmed', 'quotations', 'cancelled'})
        for group in ('confirmed', 'quotations', 'cancelled'):
            self.assertEqual(set(body[group]), GROUP_KEYS)
        self.assertEqual(self.figures(body['confirmed']), (3, 310.0, 310.0))
        self.assertEqual(self.figures(body['quotations']), (1, 50.0, 50.0))
        self.assertEqual(self.figures(body['cancelled']), (1, 200.0, 200.0), 'cancelled orders stay out of the confirmed total')
        currency = self.company.currency_id
        self.assertEqual(body['currency'], {'id': currency.id, 'name': currency.name, 'symbol': currency.symbol})

    def test_a_tax_shows_in_the_total_and_not_in_the_untaxed_amount(self):
        tax = self.env['account.tax'].create({
            'name': 'Report VAT', 'amount': 15.0, 'amount_type': 'percent', 'type_tax_use': 'sale',
            'company_id': self.company.id, 'price_include_override': 'tax_excluded',
        })
        order = self.make_order(self.agent, lines=[Command.create({
            'product_id': self.product.id, 'product_uom_qty': 1, 'price_unit': 100.0, 'tax_ids': [Command.set(tax.ids)],
        })])
        order.action_confirm()
        order.write({'date_order': datetime(2026, 3, 1, 9)})
        self.env.flush_all()
        body = self.summary(self.manager, '?date_from=2026-03-01&date_to=2026-03-01')
        self.assertEqual(self.figures(body['confirmed']), (1, 100.0, 115.0))

    def test_the_state_filter_limits_the_groups_the_summary_counts(self):
        body = self.summary(self.manager, '?state=confirmed')
        self.assertEqual(self.figures(body['confirmed']), (3, 310.0, 310.0))
        self.assertEqual(self.figures(body['quotations']), (0, 0.0, 0.0))
        self.assertEqual(self.figures(self.summary(self.manager, '?state=draft,sent')['quotations']), (1, 50.0, 50.0))
        self.assertEqual(self.figures(self.summary(self.manager, '?state=cancelled')['confirmed']), (0, 0.0, 0.0))

    def test_the_breakdown_by_salesperson_groups_the_unassigned_under_null(self):
        body = self.breakdown(self.manager, 'salesperson')
        self.assertEqual((body['by'], body['period'], body['total']), ('salesperson', None, 3))
        self.assertEqual(set(body['items'][0]), ITEM_KEYS)
        self.assertEqual(self.amounts(body), {
            self.agent.id: (1, 100.0), self.agent2.id: (1, 110.0), None: (1, 100.0),
        })
        self.assertEqual(body['items'][0]['key'], self.agent2.id, 'the largest total comes first')
        self.assertIsNone(body['items'][0]['quantity'])
        online = next(item for item in body['items'] if item['key'] is None)
        self.assertIsNone(online['label'])

    def test_the_breakdown_by_customer(self):
        body = self.breakdown(self.manager, 'customer')
        self.assertEqual({item['label']: (item['orders'], item['amount_total']) for item in body['items']}, {
            'C1': (1, 100.0), 'C2': (1, 110.0), 'C3': (1, 100.0),
        })

    def test_the_breakdown_by_product_counts_units_and_never_a_down_payment_bucket(self):
        body = self.breakdown(self.manager, 'product')
        by_name = {item['label']: item for item in body['items']}
        self.assertEqual(set(by_name), {self.product.product_tmpl_id.name, self.product_b.product_tmpl_id.name})
        a, b = by_name[self.product.product_tmpl_id.name], by_name[self.product_b.product_tmpl_id.name]
        self.assertEqual((a['orders'], a['quantity'], a['amount_total']), (2, 3.0, 150.0))
        self.assertEqual((b['orders'], b['quantity'], b['amount_total']), (2, 8.0, 160.0))
        self.assertEqual(body['items'][0]['label'], b['label'], 'the largest total comes first')

    def test_the_breakdown_by_period(self):
        month = self.breakdown(self.manager, 'period')
        self.assertEqual((month['period'], month['total']), ('month', 2))
        self.assertEqual([item['key'] for item in month['items']], ['2026-01-01', '2026-02-01'])
        self.assertEqual([(item['orders'], item['amount_total']) for item in month['items']], [(2, 210.0), (1, 100.0)])
        day = self.breakdown(self.manager, 'period', '&period=day')
        self.assertEqual([item['key'] for item in day['items']], ['2026-01-10', '2026-01-20', '2026-02-05'])
        week = self.breakdown(self.manager, 'period', '&period=week')
        self.assertEqual(sum(item['orders'] for item in week['items']), 3)
        self.assertEqual(len(week['items']), 3)

    def test_the_breakdown_pages_its_groups(self):
        page = self.breakdown(self.manager, 'period', '&period=day&limit=2&offset=1')
        self.assertEqual((page['total'], [item['key'] for item in page['items']]), (3, ['2026-01-20', '2026-02-05']))

    def test_the_filters_narrow_every_figure(self):
        cases = {
            '?date_from=2026-01-15': (2, 210.0),
            '?date_to=2026-01-20': (2, 210.0),
            '?date_from=2026-01-10&date_to=2026-01-10': (1, 100.0),
            f'?salesperson_id={self.agent2.id}': (1, 110.0),
            f'?customer_id={self.o1.partner_id.id}': (1, 100.0),
            f'?product_id={self.product_b.product_tmpl_id.id}': (2, 160.0),
            '?source=online': (1, 100.0),
            '?source=staff': (2, 210.0),
            '?date_from=2027-01-01': (0, 0.0),
        }
        for query, (orders, total) in cases.items():
            with self.subTest(query=query):
                body = self.summary(self.manager, query)
                self.assertEqual((body['confirmed']['orders'], body['confirmed']['amount_total']), (orders, total))
        by_product = self.breakdown(self.manager, 'product', '&source=online')
        self.assertEqual({item['label'] for item in by_product['items']}, {self.product_b.product_tmpl_id.name})

    def test_a_day_is_the_callers_day(self):
        self.manager.tz = 'Asia/Riyadh'
        self.o1.write({'date_order': datetime(2026, 1, 9, 22, 30)})
        self.env.flush_all()
        body = self.summary(self.manager, '?date_from=2026-01-10&date_to=2026-01-10&state=confirmed')
        self.assertEqual(body['confirmed']['orders'], 1, '01:30 on the 10th in Riyadh')
        day = self.breakdown(self.manager, 'period', '&period=day')
        self.assertEqual(day['items'][0]['key'], '2026-01-10')

    def test_a_bad_filter_is_a_422_on_its_field(self):
        cases = (
            (SUMMARY, '?date_from=2026-1-1', 'date_from'),
            (SUMMARY, '?date_to=soon', 'date_to'),
            (SUMMARY, '?date_from=2026-02-01&date_to=2026-01-01', 'date_from'),
            (SUMMARY, '?salesperson_id=abc', 'salesperson_id'),
            (SUMMARY, '?customer_id=0', 'customer_id'),
            (SUMMARY, '?product_id=-3', 'product_id'),
            (SUMMARY, '?state=paid', 'state'),
            (SUMMARY, '?source=fax', 'source'),
            (BREAKDOWN, '', 'by'),
            (BREAKDOWN, '?by=team', 'by'),
            (f'{BREAKDOWN}?by=period', '&period=year', 'period'),
            (EXPORT, '?state=confirmed,nope', 'state'),
        )
        for path, query, field in cases:
            with self.subTest(path=path, query=query):
                response = self.api_as(self.manager, 'GET', f'{path}{query}')
                self.assertEqual((response.status_code, response.json()['code'], response.json()['field']), (422, 'invalid', field))


@tagged('post_install', '-at_install', 'liwan')
class TestSalesReportExport(SalesReportsCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.set_visibility('all')

    def download(self, user, query=''):
        response = self.api_as(user, 'GET', f'{EXPORT}{query}')
        self.assertEqual(response.status_code, 200, response.text)
        return response, list(csv.reader(io.StringIO(response.content.decode('utf-8-sig'))))

    def test_the_file_is_a_utf8_csv_of_the_detail_rows_with_a_stable_header(self):
        response, rows = self.download(self.manager)
        self.assertTrue(response.headers['Content-Type'].startswith('text/csv'))
        self.assertRegex(response.headers['Content-Disposition'], r'attachment;.*sales-report-\d{4}-\d{2}-\d{2}\.csv')
        self.assertEqual(response.headers['Cache-Control'], 'private, no-store')
        self.assertTrue(response.content.startswith(b'\xef\xbb\xbf'))
        self.assertEqual(rows[0], list(EXPORT_COLUMNS))
        self.assertEqual(len(rows) - 1, 4, 'confirmed lines: o1 x1, o2 x2, o5 x1')

    def test_a_row_carries_the_line_figures_in_the_company_currency(self):
        _, rows = self.download(self.manager, f'?customer_id={self.o2.partner_id.id}')
        by_product = {row[6]: row for row in rows[1:]}
        row = by_product[self.product_b.product_tmpl_id.name]
        self.assertEqual(row[:6], [self.o2.name, '2026-01-20T09:00:00Z', 'confirmed', 'staff', 'C2', 'sales_agent2'])
        self.assertEqual(row[7:], ['3.0', '20.0', '0.0', '60.0', '60.0', self.company.currency_id.name])

    def test_the_rows_are_newest_first_and_follow_the_filters(self):
        _, rows = self.download(self.manager, '?date_to=2026-01-31&source=staff')
        self.assertEqual([row[1] for row in rows[1:]], ['2026-01-20T09:00:00Z', '2026-01-20T09:00:00Z', '2026-01-10T09:00:00Z'])
        _, rows = self.download(self.manager, '?state=draft,sent')
        self.assertEqual([row[0] for row in rows[1:]], [self.o3.name])
        self.assertEqual(rows[1][2], 'draft')

    def test_a_cell_a_spreadsheet_would_run_as_a_formula_is_quoted(self):
        self.o1.partner_id.name = '=HYPERLINK("http://evil.test")'
        self.product.product_tmpl_id.name = '@SUM(A1)'
        self.env.flush_all()
        _, rows = self.download(self.manager, f'?customer_id={self.o1.partner_id.id}')
        self.assertEqual(rows[1][4], '\'=HYPERLINK("http://evil.test")')
        self.assertEqual(rows[1][6], "'@SUM(A1)")

    def test_the_export_follows_the_visibility_setting_and_the_company(self):
        self.set_visibility('own')
        try:
            _, rows = self.download(self.reporter, '?state=draft,sent,confirmed,cancelled')
            self.assertEqual({row[0] for row in rows[1:]}, {self.o5.name})
            _, rows = self.download(self.assigner, '?state=draft,sent,confirmed,cancelled')
            self.assertEqual({row[0] for row in rows[1:]}, {order.name for order in (self.o1, self.o2, self.o3, self.o4, self.o5)})
            _, rows = self.download(self.in_branch.manager)
            self.assertEqual({row[0] for row in rows[1:]}, {self.b1.name})
        finally:
            self.set_visibility('all')

    def test_an_export_over_the_row_cap_is_refused(self):
        with patch.object(csv_export, 'EXPORT_MAX_ROWS', 3):
            response = self.api_as(self.manager, 'GET', EXPORT)
        body = response.json()
        self.assertEqual((response.status_code, body['code']), (422, 'export_too_large'))
        self.assertEqual(body['details'], {'rows': 4, 'max_rows': 3})
        with patch.object(csv_export, 'EXPORT_MAX_ROWS', 4):
            self.assertEqual(self.api_as(self.manager, 'GET', EXPORT).status_code, 200)

    def test_a_refused_export_is_a_403_or_a_422(self):
        for user in (self.agent, self.read_only):
            self.assertEqual(self.api_as(user, 'GET', EXPORT).status_code, 403)
        self.assertEqual(self.api_as(self.manager, 'GET', f'{EXPORT}?state=nope').status_code, 422)


@tagged('post_install', '-at_install', 'liwan')
class TestSalesReportsReadOnly(SalesReportsCase):
    """The reports and the export write nothing, so a read-only tenant or branch still reads and exports."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.set_visibility('all')

    def assert_reports_served(self, user):
        for path in (SUMMARY, f'{BREAKDOWN}?by=customer', EXPORT):
            response = self.api_as(user, 'GET', path)
            self.assertEqual(response.status_code, 200, f'{path}: {response.text}')

    def test_a_payment_suspended_tenant_keeps_the_summary_the_breakdown_and_the_export(self):
        profile = self.env.ref('liwan_platform.tenant_profile')
        profile.with_context(**{OPERATOR_CONTEXT: True}).write({'status': 'suspended', 'suspension_reason': 'non_payment'})
        self.assert_reports_served(self.manager)

    def test_a_read_only_branch_keeps_the_summary_the_breakdown_and_the_export(self):
        self.env['liwan.tenant.branch'].create({
            'branch_uid': 'sales-report-ro', 'company_id': self.branch.id, 'operation_id': 'op-sales-report', 'read_only': True,
        })
        self.assert_reports_served(self.in_branch.manager)
