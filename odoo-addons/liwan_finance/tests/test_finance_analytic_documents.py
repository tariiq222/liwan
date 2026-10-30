# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .analytic_common import ACCOUNTS, OCTOBER, REPORT, AnalyticCase
from .test_finance_entries import EntryCase
from .write_common import INVOICES, PASSWORD

ENTRIES = '/api/v1/finance/entries'
LINES = '/api/v1/finance/reports/analytic/lines'


def share(account, percent):
    return {'account': {'id': account.id, 'name': account.name, 'code': account.code or ''}, 'percent': percent}


@tagged('post_install', '-at_install', 'liwan')
class TestFinanceAnalyticInvoices(AnalyticCase):

    def line_of(self, invoice):
        return self.api('GET', f'{INVOICES}/{invoice["id"]}').json()['lines'][0]

    def test_a_line_carries_its_distribution_in_and_out(self):
        invoice = self.create_invoice(self.split_body())
        self.assertEqual(invoice['lines'][0]['analytic_distribution'], [share(self.riyadh, 60), share(self.jeddah, 40)])
        self.assertEqual(self.line_of(invoice)['analytic_distribution'], invoice['lines'][0]['analytic_distribution'])
        line = self.env['account.move'].browse(invoice['id']).invoice_line_ids
        self.assertEqual(line.analytic_distribution, {str(self.riyadh.id): 60, str(self.jeddah.id): 40})

    def test_a_line_without_a_distribution_has_an_empty_list(self):
        self.assertEqual(self.create_invoice()['lines'][0]['analytic_distribution'], [])

    def test_patch_replaces_the_lines_with_their_distribution_and_keeps_it_without_lines(self):
        invoice = self.create_invoice(self.split_body())
        self.api('PATCH', f'{INVOICES}/{invoice["id"]}', json={'ref': 'kept'})
        self.assertEqual(len(self.line_of(invoice)['analytic_distribution']), 2)
        body = self.split_body({str(self.alpha.id): 100})
        patched = self.api('PATCH', f'{INVOICES}/{invoice["id"]}', json={'lines': body['lines']}).json()
        self.assertEqual(patched['lines'][0]['analytic_distribution'], [share(self.alpha, 100)])

    def test_two_plans_may_each_take_the_whole_line(self):
        invoice = self.create_invoice(self.split_body({str(self.riyadh.id): 100, str(self.alpha.id): 100}))
        self.assertEqual(len(invoice['lines'][0]['analytic_distribution']), 2)

    def test_a_part_of_a_plan_may_stay_unallocated(self):
        invoice = self.create_invoice(self.split_body({str(self.riyadh.id): 30}))
        self.assertEqual(invoice['lines'][0]['analytic_distribution'], [share(self.riyadh, 30)])

    def test_an_absent_key_leaves_the_line_to_odoo_and_an_empty_object_means_none(self):
        self.env['account.analytic.distribution.model'].create({
            'partner_id': self.partner.id, 'company_id': self.company.id,
            'analytic_distribution': {str(self.alpha.id): 100},
        })
        absent = self.create_invoice()['lines'][0]['analytic_distribution']
        self.assertEqual(absent, [share(self.alpha, 100)])
        self.assertEqual(self.create_invoice(self.split_body({}))['lines'][0]['analytic_distribution'], [])
        explicit = self.create_invoice(self.split_body())['lines'][0]['analytic_distribution']
        self.assertEqual(explicit, [share(self.riyadh, 60), share(self.jeddah, 40)])
        # A lines PATCH sends every line again: an absent key means the Odoo default again, {} none.
        invoice = self.create_invoice(self.split_body({}))
        kept = self.api('PATCH', f'{INVOICES}/{invoice["id"]}', json={'lines': self.invoice_body()['lines']}).json()
        self.assertEqual(kept['lines'][0]['analytic_distribution'], [share(self.alpha, 100)])

    def legacy_invoice(self, distribution):
        """A draft invoice written through the ORM, as Odoo's own screens or old data would leave it."""
        return self.env['account.move'].with_company(self.company).create({
            'move_type': 'out_invoice', 'partner_id': self.partner.id, 'invoice_date': '2026-10-18',
            'invoice_line_ids': [(0, 0, {'name': 'Legacy', 'price_unit': 100, 'analytic_distribution': distribution})],
        })

    def test_an_account_of_another_company_in_legacy_data_does_not_fail_the_document(self):
        invoice = self.legacy_invoice({str(self.other_branch.id): 100})
        result = self.api('GET', f'{INVOICES}/{invoice.id}')
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(
            result.json()['lines'][0]['analytic_distribution'],
            [{'account': {'id': self.other_branch.id, 'name': '', 'code': ''}, 'percent': 100}],
        )
        shared = self.legacy_invoice({str(self.shared.id): 100})
        self.assertEqual(
            self.api('GET', f'{INVOICES}/{shared.id}').json()['lines'][0]['analytic_distribution'], [share(self.shared, 100)],
        )

    def test_a_combined_key_shows_per_account_and_cannot_be_rewritten(self):
        invoice = self.legacy_invoice({f'{self.riyadh.id},{self.alpha.id}': 100})
        url = f'{INVOICES}/{invoice.id}'
        shown = self.api('GET', url).json()['lines'][0]['analytic_distribution']
        self.assertEqual(shown, [share(self.riyadh, 100), share(self.alpha, 100)])
        self.assertRefused(self.api('PATCH', url, json={'lines': self.invoice_body()['lines']}), 422, 'invalid', 'lines')
        self.assertEqual(self.api('PATCH', url, json={'ref': 'still editable'}).status_code, 200)
        self.assertEqual(invoice.invoice_line_ids.analytic_distribution, {f'{self.riyadh.id},{self.alpha.id}': 100})

    def test_invalid_distributions_are_refused_on_the_line_field(self):
        field = 'lines[0].analytic_distribution'
        riyadh, jeddah = str(self.riyadh.id), str(self.jeddah.id)
        cases = {
            'a list': [{'account_id': self.riyadh.id, 'percent': 100}],
            'a null': None,
            'a text key': {'riyadh': 100},
            'a zero key': {'0': 100},
            'a decimal key': {'1.5': 100},
            'a zero percent': {riyadh: 0},
            'a negative percent': {riyadh: -5},
            'a percent above 100': {riyadh: 100.5},
            'a text percent': {riyadh: '60'},
            'a boolean percent': {riyadh: True},
            'a leading zero key': {f'0{riyadh}': 50},
            'a signed key': {f'+{riyadh}': 50},
            'more than 100 in one plan': {riyadh: 60, jeddah: 50},
            'an unknown account': {'999999': 100},
            'an account of another company': {str(self.other_branch.id): 100},
            'a shared account': {str(self.shared.id): 100},
        }
        for name, distribution in cases.items():
            with self.subTest(name):
                self.assertRefused(self.api('POST', INVOICES, json=self.split_body(distribution)), 422, 'invalid', field)

    def test_an_archived_account_is_refused(self):
        self.jeddah.active = False
        self.assertRefused(
            self.api('POST', INVOICES, json=self.split_body()), 422, 'invalid', 'lines[0].analytic_distribution',
        )

    def test_the_field_is_strict_on_other_lines(self):
        body = self.split_body()
        body['lines'].append({'name': 'Second', 'price_unit': 1, 'analytic_distribution': {'x': 1}})
        self.assertRefused(self.api('POST', INVOICES, json=body), 422, 'invalid', 'lines[1].analytic_distribution')

    def test_posting_creates_the_analytic_items_and_a_reset_removes_them(self):
        invoice = self.posted_invoice(self.split_body())
        items = self.env['account.analytic.line'].search([('move_line_id.move_id', '=', invoice['id'])])
        self.assertEqual(sorted(items.mapped('amount')), [400, 600])
        self.api('POST', f'{INVOICES}/{invoice["id"]}/reset-to-draft', json={})
        self.assertFalse(self.env['account.analytic.line'].search([('move_line_id.move_id', '=', invoice['id'])]))
        self.assertEqual(self.line_of(invoice)['analytic_distribution'], [share(self.riyadh, 60), share(self.jeddah, 40)])

    def test_a_writer_without_the_cost_center_capability_still_uses_and_posts_a_distribution(self):
        self.user_with('invoice_writer', ['finance.invoices.read', 'finance.invoices.manage', 'finance.invoices.post'])
        self.authenticate('invoice_writer', PASSWORD)
        invoice = self.posted_invoice(self.split_body())
        self.assertEqual(invoice['state'], 'posted')
        self.assertEqual(len(invoice['lines'][0]['analytic_distribution']), 2)
        self.assertEqual(self.api('GET', f'{INVOICES}/{invoice["id"]}').json()['lines'][0]['analytic_distribution'][0], share(self.riyadh, 60))


@tagged('post_install', '-at_install', 'liwan')
class TestFinanceAnalyticReport(AnalyticCase):

    def test_a_60_40_invoice_splits_the_income_between_two_cost_centers(self):
        self.posted_invoice(self.split_body())
        report = self.report(f'{OCTOBER}&plan_id={self.branches.id}')
        self.assertEqual(
            set(report), {'date_from', 'date_to', 'currency', 'plan', 'accounts', 'totals'},
        )
        self.assertEqual((report['currency'], report['plan']['id']), ('SAR', self.branches.id))
        riyadh, jeddah = self.row(report, self.riyadh), self.row(report, self.jeddah)
        self.assertEqual(set(riyadh), {'account', 'plan', 'income', 'expense', 'net'})
        self.assertEqual((riyadh['income'], riyadh['expense'], riyadh['net']), (600, 0, 600))
        self.assertEqual((jeddah['income'], jeddah['expense'], jeddah['net']), (400, 0, 400))
        self.assertEqual(riyadh['account'], {'id': self.riyadh.id, 'name': 'Riyadh', 'code': 'RYD'})
        self.assertEqual(report['totals'], {'income': 1000, 'expense': 0, 'net': 1000})
        self.assertNotIn(self.alpha.id, [row['account']['id'] for row in report['accounts']])
        self.assertNotIn(self.other_branch.id, [row['account']['id'] for row in report['accounts']])
        self.assertNotIn(self.shared.id, [row['account']['id'] for row in report['accounts']])

    def test_without_a_plan_every_plan_is_reported_and_accounts_without_activity_show_zero(self):
        self.posted_invoice(self.split_body({str(self.riyadh.id): 100, str(self.alpha.id): 100}))
        report = self.report()
        self.assertEqual(report['plan'], None)
        self.assertEqual(self.row(report, self.riyadh)['net'], 1000)
        self.assertEqual(self.row(report, self.alpha)['net'], 1000)
        self.assertEqual((self.row(report, self.jeddah)['income'], self.row(report, self.jeddah)['net']), (0, 0))

    def test_a_vendor_bill_is_an_expense_and_net_is_income_less_expense(self):
        self.posted_invoice(self.split_body({str(self.riyadh.id): 100}))
        bill = self.bill_body()
        bill['lines'][0]['analytic_distribution'] = {str(self.riyadh.id): 50, str(self.jeddah.id): 50}
        self.posted_invoice(bill)
        report = self.report(f'{OCTOBER}&plan_id={self.branches.id}')
        riyadh, jeddah = self.row(report, self.riyadh), self.row(report, self.jeddah)
        self.assertEqual((riyadh['income'], riyadh['expense'], riyadh['net']), (1000, 500, 500))
        self.assertEqual((jeddah['income'], jeddah['expense'], jeddah['net']), (0, 500, -500))
        self.assertEqual(report['totals'], {'income': 1000, 'expense': 1000, 'net': 0})

    def test_a_draft_and_a_date_outside_the_period_are_not_counted(self):
        self.create_invoice(self.split_body())
        self.posted_invoice(self.split_body(invoice_date='2026-09-15'))
        report = self.report(f'{OCTOBER}&plan_id={self.branches.id}')
        self.assertEqual(report['totals'], {'income': 0, 'expense': 0, 'net': 0})
        september = self.report(f'date_from=2026-09-01&date_to=2026-09-30&plan_id={self.branches.id}')
        self.assertEqual(september['totals']['income'], 1000)

    def test_a_sub_plan_filter_reports_its_own_accounts(self):
        cities = self.env['account.analytic.plan'].create({'name': 'Cities', 'parent_id': self.branches.id})
        tabuk = self.env['account.analytic.account'].create({'name': 'Tabuk', 'plan_id': cities.id, 'company_id': self.company.id})
        self.posted_invoice(self.split_body({str(self.riyadh.id): 50, str(tabuk.id): 50}))
        whole = self.report(f'{OCTOBER}&plan_id={self.branches.id}')
        self.assertEqual({row['account']['name'] for row in whole['accounts'] if row['income']}, {'Riyadh', 'Tabuk'})
        sub = self.report(f'{OCTOBER}&plan_id={cities.id}')
        self.assertEqual([row['account']['name'] for row in sub['accounts']], ['Tabuk'])
        self.assertEqual(sub['totals']['income'], 500)

    def test_other_company_items_are_not_reported(self):
        foreign = self.env['account.move'].with_company(self.other_company).create({
            'move_type': 'out_invoice', 'partner_id': self.partner.id, 'invoice_date': '2026-10-18',
            'invoice_line_ids': [(0, 0, {
                'name': 'Foreign', 'price_unit': 777, 'analytic_distribution': {str(self.other_branch.id): 100},
            })],
        })
        foreign.action_post()
        self.assertTrue(self.env['account.analytic.line'].search([('company_id', '=', self.other_company.id)]))
        report = self.report()
        self.assertEqual(report['totals']['income'], 0)
        self.assertNotIn(self.other_branch.id, [row['account']['id'] for row in report['accounts']])
        self.assertEqual(self.api('GET', f'{LINES}?account_id={self.other_branch.id}&{OCTOBER}').status_code, 404)

    def test_report_query_validation(self):
        self.assertRefused(self.api('GET', REPORT), 422, 'invalid', 'date_from')
        self.assertRefused(self.api('GET', f'{REPORT}?date_from=2026-10-01'), 422, 'invalid', 'date_to')
        self.assertRefused(self.api('GET', f'{REPORT}?date_from=2026-11-01&date_to=2026-10-01'), 422, 'invalid', 'date_to')
        self.assertRefused(self.api('GET', f'{REPORT}?{OCTOBER}&plan_id=999999'), 422, 'invalid', 'plan_id')
        self.assertRefused(self.api('GET', f'{REPORT}?{OCTOBER}&plan_id=abc'), 422, 'invalid', 'plan_id')
        self.assertRefused(self.api('GET', f'{LINES}?{OCTOBER}'), 422, 'invalid', 'account_id')

    def test_a_credit_note_reduces_its_cost_center(self):
        self.posted_invoice(self.split_body({str(self.riyadh.id): 100}))
        credit = self.split_body({str(self.riyadh.id): 100}, move_type='out_refund')
        credit['lines'][0]['price_unit'] = 300
        self.posted_invoice(credit)
        row = self.row(self.report(f'{OCTOBER}&plan_id={self.branches.id}'), self.riyadh)
        self.assertEqual((row['income'], row['expense'], row['net']), (700, 0, 700))

    def test_shared_accounts_are_left_out_of_the_report(self):
        invoice = self.env['account.move'].with_company(self.company).create({
            'move_type': 'out_invoice', 'partner_id': self.partner.id, 'invoice_date': '2026-10-18',
            'invoice_line_ids': [(0, 0, {'name': 'Shared', 'price_unit': 250, 'analytic_distribution': {str(self.shared.id): 100}})],
        })
        invoice.action_post()
        self.assertTrue(self.env['account.analytic.line'].search([('auto_account_id', '=', self.shared.id)]))
        report = self.report()
        self.assertNotIn(self.shared.id, [row['account']['id'] for row in report['accounts']])
        self.assertEqual(report['totals']['income'], 0)

    def test_the_drill_down_lists_the_items_of_one_cost_center_paged(self):
        first = self.posted_invoice(self.split_body())
        self.posted_invoice(self.split_body(invoice_date='2026-10-19'))
        listing = self.api('GET', f'{LINES}?account_id={self.riyadh.id}&{OCTOBER}').json()
        self.assertEqual(set(listing), {'items', 'total'})
        self.assertEqual((listing['total'], [item['amount'] for item in listing['items']]), (2, [600, 600]))
        item = listing['items'][1]
        self.assertEqual(
            set(item), {'id', 'date', 'name', 'ref', 'move', 'general_account', 'partner', 'kind', 'amount'},
        )
        self.assertEqual((item['kind'], item['date'], item['move']['id']), ('income', '2026-10-18', first['id']))
        self.assertEqual(item['partner']['id'], self.partner.id)
        page = self.api('GET', f'{LINES}?account_id={self.riyadh.id}&{OCTOBER}&limit=1&offset=1').json()
        self.assertEqual((page['total'], len(page['items']), page['items'][0]['id']), (2, 1, item['id']))
        # An archived cost center keeps its history.
        self.api('PATCH', f'{ACCOUNTS}/{self.riyadh.id}', json={'active': False})
        self.assertEqual(self.api('GET', f'{LINES}?account_id={self.riyadh.id}&{OCTOBER}').json()['total'], 2)
        archived = self.report(f'{OCTOBER}&plan_id={self.branches.id}')
        self.assertEqual(self.row(archived, self.riyadh)['income'], 1200)


@tagged('post_install', '-at_install', 'liwan')
class TestFinanceAnalyticEntries(EntryCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        plan = cls.env['account.analytic.plan'].create({'name': 'Entry branches'})
        cls.riyadh = cls.env['account.analytic.account'].create({'name': 'Riyadh', 'plan_id': plan.id, 'company_id': cls.company.id})
        cls.jeddah = cls.env['account.analytic.account'].create({'name': 'Jeddah', 'plan_id': plan.id, 'company_id': cls.company.id})
        cls.other = cls.env['account.analytic.account'].create({'name': 'Other', 'plan_id': plan.id, 'company_id': cls.other_company.id})

    def distributed_body(self, distribution):
        body = self.entry_body()
        body['lines'][0]['analytic_distribution'] = distribution
        return body

    def test_an_entry_line_carries_and_returns_its_distribution(self):
        distribution = {str(self.riyadh.id): 25, str(self.jeddah.id): 75}
        entry = self.create_entry(self.distributed_body(distribution))
        shares = {line['account']['id']: line['analytic_distribution'] for line in entry['lines']}
        expected = [
            {'account': {'id': self.riyadh.id, 'name': 'Riyadh', 'code': ''}, 'percent': 25},
            {'account': {'id': self.jeddah.id, 'name': 'Jeddah', 'code': ''}, 'percent': 75},
        ]
        self.assertEqual(shares[self.expense.id], expected)
        self.assertEqual(shares[self.income.id], [])
        patched = self.api('PATCH', f'{ENTRIES}/{entry["id"]}', json={'lines': self.distributed_body({})['lines']}).json()
        self.assertEqual([line['analytic_distribution'] for line in patched['lines']], [[], []])

    def test_an_edited_draft_sends_its_lines_back_with_the_split_it_read(self):
        # The draft editor rebuilds every line from the record, its split included, and replaces the lines.
        entry = self.create_entry(self.distributed_body({str(self.riyadh.id): 60, str(self.jeddah.id): 40}))
        lines = [
            {
                'account_id': line['account']['id'],
                'name': line['name'],
                **({'debit': 300} if line['debit'] else {'credit': 300}),
                **({'analytic_distribution': {str(share['account']['id']): share['percent'] for share in line['analytic_distribution']}}
                   if line['analytic_distribution'] else {}),
            }
            for line in entry['lines']
        ]
        patched = self.api('PATCH', f'{ENTRIES}/{entry["id"]}', json={'ref': 'EDIT', 'lines': lines})
        self.assertEqual(patched.status_code, 200, patched.text)
        shares = {line['account']['id']: [share['percent'] for share in line['analytic_distribution']] for line in patched.json()['lines']}
        self.assertEqual((patched.json()['amount_total'], shares[self.expense.id], shares[self.income.id]), (300, [60, 40], []))

    def test_a_posted_entry_reports_an_expense_per_cost_center(self):
        entry = self.create_entry(self.distributed_body({str(self.riyadh.id): 80, str(self.jeddah.id): 20}))
        self.post_entry(entry['id'])
        report = self.api('GET', f'{REPORT}?date_from=2026-10-01&date_to=2026-10-31').json()
        rows = {row['account']['name']: row for row in report['accounts']}
        self.assertEqual((rows['Riyadh']['expense'], rows['Riyadh']['net']), (400, -400))
        self.assertEqual((rows['Jeddah']['expense'], rows['Jeddah']['net']), (100, -100))
        self.assertEqual(report['totals']['expense'], 500)

    def test_balance_sheet_items_are_not_part_of_the_report(self):
        asset = self._account(self.company, 'asset_current')
        body = self.entry_body(lines=[
            {'account_id': asset.id, 'name': 'Prepaid', 'debit': 500, 'analytic_distribution': {str(self.riyadh.id): 100}},
            {'account_id': self.income.id, 'name': 'Prepaid', 'credit': 500},
        ])
        self.post_entry(self.create_entry(body)['id'])
        items = self.env['account.analytic.line'].search([('auto_account_id', '=', self.riyadh.id)])
        self.assertEqual(items.mapped('amount'), [-500])
        report = self.api('GET', f'{REPORT}?date_from=2026-10-01&date_to=2026-10-31').json()
        row = next(row for row in report['accounts'] if row['account']['id'] == self.riyadh.id)
        self.assertEqual((row['income'], row['expense'], row['net']), (0, 0, 0))
        lines = self.api('GET', f'{LINES}?account_id={self.riyadh.id}&date_from=2026-10-01&date_to=2026-10-31').json()
        self.assertEqual(lines['total'], 0)

    def test_a_combined_key_blocks_an_entry_lines_patch(self):
        entry = self.env['account.move'].with_company(self.company).create({
            'move_type': 'entry', 'journal_id': self.general.id, 'date': '2026-10-18',
            'line_ids': [
                (0, 0, {'account_id': self.expense.id, 'name': 'x', 'debit': 10, 'analytic_distribution': {f'{self.riyadh.id},{self.jeddah.id}': 100}}),
                (0, 0, {'account_id': self.income.id, 'name': 'x', 'credit': 10}),
            ],
        })
        self.assertRefused(
            self.api('PATCH', f'{ENTRIES}/{entry.id}', json={'lines': self.entry_body()['lines']}), 422, 'invalid', 'lines',
        )

    def test_invalid_entry_distributions_are_refused(self):
        field = 'lines[0].analytic_distribution'
        for name, distribution in {
            'a foreign account': {str(self.other.id): 100},
            'more than 100': {str(self.riyadh.id): 70, str(self.jeddah.id): 40},
            'a text percent': {str(self.riyadh.id): 'all'},
        }.items():
            with self.subTest(name):
                self.assertRefused(self.api('POST', ENTRIES, json=self.distributed_body(distribution)), 422, 'invalid', field)
