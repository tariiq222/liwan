# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .write_common import PASSWORD, WebVueFinanceWriteCase

TERMS = '/api/v1/finance/payment-terms'
TERM_KEYS = {'id', 'name', 'shared', 'active', 'lines'}
LINE_KEYS = {'value', 'value_amount', 'nb_days', 'delay_type'}
HALF_AND_HALF = [
    {'value': 'percent', 'value_amount': 50, 'nb_days': 0},
    {'value': 'percent', 'value_amount': 50, 'nb_days': 30},
]


@tagged('post_install', '-at_install', 'webvue')
class TestFinancePaymentTermWrite(WebVueFinanceWriteCase):

    def create_term(self, **overrides):
        body = {'name': '50% now, 50% in 30 days', 'lines': HALF_AND_HALF, **overrides}
        result = self.api('POST', TERMS, json=body)
        self.assertEqual(result.status_code, 201, result.text)
        return result.json()

    def test_create_and_read(self):
        term = self.create_term()
        self.assertEqual(set(term), TERM_KEYS)
        self.assertEqual([set(line) for line in term['lines']], [LINE_KEYS, LINE_KEYS])
        self.assertEqual((term['shared'], term['active']), (False, True))
        self.assertEqual(self.api('GET', f'{TERMS}/{term["id"]}').json(), term)
        self.assertEqual(self.env['account.payment.term'].browse(term['id']).company_id, self.company)

    def test_the_term_splits_a_due_amount(self):
        term = self.env['account.payment.term'].browse(self.create_term()['id'])
        invoice = self.env['account.move'].with_company(self.company).create({
            'move_type': 'out_invoice', 'partner_id': self.partner.id, 'invoice_date': '2026-10-01',
            'invoice_payment_term_id': term.id,
            'invoice_line_ids': [(0, 0, {'name': 'x', 'price_unit': 1000, 'quantity': 1, 'tax_ids': False})],
        })
        invoice.action_post()
        dues = invoice.line_ids.filtered(lambda line: line.display_type == 'payment_term').sorted('date_maturity')
        self.assertEqual([(str(line.date_maturity), line.balance) for line in dues], [('2026-10-01', 500.0), ('2026-10-31', 500.0)])

    def test_patch_replaces_the_lines(self):
        term = self.create_term()
        changed = self.api('PATCH', f'{TERMS}/{term["id"]}', json={'name': 'Net 60', 'lines': [{'value': 'percent', 'value_amount': 100, 'nb_days': 60}]})
        self.assertEqual(changed.status_code, 200, changed.text)
        self.assertEqual((changed.json()['name'], len(changed.json()['lines'])), ('Net 60', 1))

    def test_percent_lines_must_add_up_to_100(self):
        body = {'name': 'Bad', 'lines': [{'value': 'percent', 'value_amount': 40, 'nb_days': 0}]}
        self.assertRefused(self.api('POST', TERMS, json=body), 422, 'invalid', 'lines')

    def test_refusals(self):
        for body, field in (
            ({'lines': HALF_AND_HALF}, 'name'),
            ({'name': 'x'}, 'lines'),
            ({'name': 'x', 'lines': []}, 'lines'),
            ({'name': 'x', 'lines': [{'value': 'percent', 'value_amount': 100, 'nb_days': -1}]}, 'lines[0].nb_days'),
            ({'name': 'x', 'lines': [{'value': 'ratio', 'value_amount': 100}]}, 'lines[0].value'),
            ({'name': 'x', 'lines': [{'value': 'percent', 'value_amount': 100, 'color': 1}]}, 'lines[0].color'),
        ):
            with self.subTest(body=body):
                self.assertRefused(self.api('POST', TERMS, json=body), 422, 'invalid', field)
        # A payload company_id outside the pinned request set is the uniform not-found.
        self.assertRefused(
            self.api('POST', TERMS, json={'name': 'x', 'lines': HALF_AND_HALF, 'company_id': 1}),
            404, 'not_found',
        )
        self.assertRefused(self.api('GET', f'{TERMS}/999999'), 404, 'not_found')

    def test_a_shared_term_is_listed_but_not_editable(self):
        shared = self.env['account.payment.term'].create({'name': 'Shared net 15', 'line_ids': [(0, 0, {'value': 'percent', 'value_amount': 100, 'nb_days': 15})]})
        self.assertTrue(self.api('GET', f'{TERMS}/{shared.id}').json()['shared'])
        self.assertRefused(self.api('PATCH', f'{TERMS}/{shared.id}', json={'name': 'x'}), 422, 'shared_record')
        self.assertRefused(self.api('POST', f'{TERMS}/{shared.id}/archive'), 422, 'shared_record')

    def test_another_company_term_is_not_found(self):
        foreign = self.env['account.payment.term'].create({
            'name': 'Other company', 'company_id': self.other_company.id,
            'line_ids': [(0, 0, {'value': 'percent', 'value_amount': 100, 'nb_days': 10})],
        })
        self.assertRefused(self.api('GET', f'{TERMS}/{foreign.id}'), 404, 'not_found')
        self.assertRefused(self.api('PATCH', f'{TERMS}/{foreign.id}', json={'name': 'x'}), 404, 'not_found')

    def test_archive_audit_and_capability(self):
        term = self.create_term()
        self.assertFalse(self.api('POST', f'{TERMS}/{term["id"]}/archive').json()['active'])
        self.assertNotIn(term['id'], [item['id'] for item in self.api('GET', TERMS).json()['items']])
        self.assertTrue(self.api('POST', f'{TERMS}/{term["id"]}/unarchive').json()['active'])
        events = self.env['webvue.finance.audit.event'].search([('res_model', '=', 'account.payment.term'), ('res_id', '=', term['id'])])
        self.assertEqual(set(events.mapped('action')), {'payment_term_created', 'payment_term_archived', 'payment_term_unarchived'})
        self.user_with('terms_reader', ['finance.payment_terms.read'])
        self.authenticate('terms_reader', PASSWORD)
        self.assertEqual(self.api('GET', TERMS).status_code, 200)
        self.assertRefused(self.api('POST', TERMS, json={'name': 'x', 'lines': HALF_AND_HALF}), 403, 'forbidden')
        self.user_with('terms_writer', ['finance.payment_terms.manage', 'finance.payment_terms.read'])
        self.authenticate('terms_writer', PASSWORD)
        self.assertEqual(self.api('POST', TERMS, json={'name': 'Allowed', 'lines': HALF_AND_HALF}).status_code, 201)
