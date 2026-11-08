# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command
from odoo.tests import tagged

from .write_common import PASSWORD, LiwanFinanceWriteCase

RETURN = '/api/v1/finance/reports/vat-return'
PERIOD_START = '2026-10-01'
PERIOD_END = '2026-10-31'
OCTOBER = f'date_from={PERIOD_START}&date_to={PERIOD_END}'


@tagged('post_install', '-at_install', 'liwan')
class TestFinanceVatReturn(LiwanFinanceWriteCase):
    """The fixture posts a 1000 SAR sale at 15% VAT on 2026-10-18 in each company; this adds a purchase and a credit note."""

    def box(self, report, code):
        return next(box for box in report['boxes'] if box['code'] == code)

    def get(self, query=OCTOBER):
        result = self.api('GET', f'{RETURN}?{query}')
        self.assertEqual(result.status_code, 200, result.text)
        return result.json()

    def ledger_amount(self, code, column):
        """The posted balances the column really selects, read from the ORM, not from the endpoint or the box."""
        expression = self.box_expression(code, column)
        items = self.env['account.move.line'].search([
            ('company_id', '=', self.company.id), ('parent_state', '=', 'posted'),
            ('date', '>=', PERIOD_START), ('date', '<=', PERIOD_END),
            ('tax_tag_ids', 'in', expression._get_matching_tags().ids),
        ])
        sign = -1 if expression.formula.startswith('-') else 1
        return self.company.currency_id.round(sum(items.mapped('balance')) * sign)

    def box_expression(self, code, column):
        """The ``tax_tags`` expression behind one box column of the installed return definition."""
        return self.env['liwan.finance.vat.return']._liwan_lines().filtered(
            lambda line: line.code == code,
        ).expression_ids.filtered(lambda item: item.label == column and item.engine == 'tax_tags')

    def test_sales_fill_the_standard_rated_box_and_the_totals(self):
        report = self.get()
        self.assertEqual((report['status'], report['filed']), ('draft_for_review', False))
        self.assertEqual([box['number'] for box in report['boxes']], list(range(1, 17)))
        standard = self.box(report, 'sa_1')
        self.assertEqual((standard['base'], standard['tax']), (1000, 150))
        self.assertEqual((self.box(report, 'sa_6')['base'], self.box(report, 'sa_6')['tax']), (1000, 150))
        self.assertEqual(self.box(report, 'sa_13')['tax'], 150)
        self.assertEqual(self.box(report, 'sa_16')['tax'], 150)
        self.assertIsNone(self.box(report, 'sa_13')['base'])

    def test_a_purchase_is_deducted_and_a_credit_note_reduces_sales(self):
        bill = self.posted_invoice(self.bill_body())
        self.assertEqual(bill['amount_total'], 1150)
        note = self.posted_invoice(self.invoice_body(move_type='out_refund', lines=[
            {'name': 'Return', 'quantity': 1, 'price_unit': 200, 'tax_ids': [self.sale_vat.id]},
        ]))
        self.assertEqual(note['state'], 'posted')
        report = self.get()
        self.assertEqual((self.box(report, 'sa_7')['base'], self.box(report, 'sa_7')['tax']), (1000, 150))
        self.assertEqual((self.box(report, 'sa_1')['base'], self.box(report, 'sa_1')['tax']), (800, 120))
        self.assertEqual(self.box(report, 'sa_12')['tax'], 150)
        self.assertEqual(self.box(report, 'sa_13')['tax'], -30)
        self.assertEqual(self.box(report, 'sa_16')['tax'], -30)

    def test_a_zero_rated_sale_goes_to_box_3_and_other_periods_and_companies_are_apart(self):
        zero = self.env['account.tax'].search([
            ('company_id', '=', self.company.id), ('type_tax_use', '=', 'sale'), ('amount', '=', 0),
            ('amount_type', '=', 'percent'), ('active', '=', True),
        ], limit=1)
        if zero:
            self.posted_invoice(self.invoice_body(lines=[{'name': 'Export', 'quantity': 1, 'price_unit': 500, 'tax_ids': [zero.id]}]))
            report = self.get()
            boxes = [self.box(report, code)['base'] for code in ('sa_3', 'sa_4', 'sa_5')]
            self.assertEqual(sum(boxes), 500)
        november = self.get('date_from=2026-11-01&date_to=2026-11-30')
        self.assertEqual([box['base'] or 0 for box in november['boxes']] + [box['tax'] or 0 for box in november['boxes']], [0] * 32)

    def test_the_items_behind_a_box_open_down_to_the_documents(self):
        listing = self.api('GET', f'{RETURN}/items?code=sa_1&column=tax&{OCTOBER}')
        self.assertEqual(listing.status_code, 200, listing.text)
        body = listing.json()
        self.assertEqual(body['total'], 1)
        item = body['items'][0]
        self.assertEqual((item['amount'], item['entry_type'], item['entry']['id']), (150, 'out_invoice', self.invoice.id))
        base = self.api('GET', f'{RETURN}/items?code=sa_1&column=base&{OCTOBER}').json()
        self.assertEqual(sum(row['amount'] for row in base['items']), 1000)
        self.assertEqual(self.api('GET', f'{RETURN}/items?code=sa_6&column=base&{OCTOBER}').json(), {'items': [], 'total': 0})

    def test_the_total_of_the_items_equals_the_posted_ledger(self):
        """The drill-down and the box are each compared to the ledger: two wrongs could otherwise agree."""
        self.posted_invoice(self.bill_body())
        report = self.get()
        for code, column in (('sa_1', 'base'), ('sa_1', 'tax'), ('sa_7', 'base'), ('sa_7', 'tax')):
            with self.subTest(code=code, column=column):
                items = self.api('GET', f'{RETURN}/items?code={code}&column={column}&{OCTOBER}').json()['items']
                ledger = self.ledger_amount(code, column)
                self.assertAlmostEqual(sum(row['amount'] for row in items), ledger, places=2)
                self.assertAlmostEqual(self.box(report, code)[column], ledger, places=2)

    def test_a_line_with_two_matching_tags_contributes_its_balance_once(self):
        """A line carrying two tags of one expression is listed once and counts once in the box.

        ``account.account.tag`` is unique on ``(name, applicability, country_id)``, but ``name`` is a translated
        value stored as one dictionary per language, so a second row can hold the same English name in the same
        country under a different other-language name. ``_get_matching_tags`` reads the name in ``en_US``, so the
        expression selects both rows, and one journal item can carry two tags of a single expression. Its balance
        must still reach the box once, not once per matching tag.
        """
        expression = self.box_expression('sa_1', 'base')
        base_line = self.invoice.invoice_line_ids
        original = base_line.tax_tag_ids & expression._get_matching_tags()
        self.assertEqual(len(original), 1, 'the sale line starts with one tag of this expression')

        # The unique index covers the stored translations, so a second row can hold the same English name in the
        # same country as long as it is also named in another language. The expression reads the name in ``en_US``,
        # so it selects this row too: a leftover duplicate is how one line ends up with two matching tags.
        self.env['res.lang']._activate_lang('fr_FR')
        duplicate = self.env['account.account.tag'].with_context(lang='fr_FR').create({
            'name': '1(B)', 'applicability': 'taxes', 'country_id': original.country_id.id,
        })
        base_line.tax_tag_ids = [Command.link(duplicate.id)]
        matching = base_line.tax_tag_ids & expression._get_matching_tags()
        self.assertEqual(len(matching), 2, 'the expression must select both tags of the line')

        rows = self.env['liwan.finance.vat.return']._liwan_items(self.company, 'sa_1', 'base', PERIOD_START, PERIOD_END)
        self.assertEqual([amount for item, amount in rows if item == base_line], [1000])
        self.assertEqual(self.box(self.get(), 'sa_1')['base'], 1000)
        listed = self.api('GET', f'{RETURN}/items?code=sa_1&column=base&{OCTOBER}').json()
        self.assertEqual(listed['total'], 1)
        self.assertEqual([row['amount'] for row in listed['items']], [1000])

    def test_bad_queries_and_capability(self):
        for query, field in (
            ('', 'date_from'), ('date_from=2026-10-01', 'date_to'),
            (f'code=sa_99&column=base&{OCTOBER}', 'code'), (f'code=sa_1&column=vat&{OCTOBER}', 'column'),
            (f'column=base&{OCTOBER}', 'code'), (f'code=sa_1&{OCTOBER}', 'column'),
        ):
            with self.subTest(query=query):
                route = f'{RETURN}/items' if 'code' in query or 'column' in query else RETURN
                self.assertRefused(self.api('GET', f'{route}?{query}'), 422, 'invalid', field)
        self.user_with('no_reports', ['finance.invoices.read'])
        self.authenticate('no_reports', PASSWORD)
        self.assertRefused(self.api('GET', f'{RETURN}?{OCTOBER}'), 403, 'forbidden')
        self.assertRefused(self.api('GET', f'{RETURN}/items?code=sa_1&column=base&{OCTOBER}'), 403, 'forbidden')
