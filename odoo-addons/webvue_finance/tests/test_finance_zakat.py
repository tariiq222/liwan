# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import AccessError
from odoo.tests import tagged

from .oca_common import REPORTS, WebVueFinanceOcaCase
from .write_common import PASSWORD

ZAKAT = '/api/v1/finance/zakat'
BASE = f'{REPORTS}/zakat-base?date_to=2026-12-31'
RATE = 0.025 * 365 / 354


@tagged('post_install', '-at_install', 'webvue')
class TestFinanceZakatWorkpaper(WebVueFinanceOcaCase):
    """The base of the books is 103900 at 2026-12-31 (see ``test_finance_mis_reports``); the company adds its own figures."""

    def adjust(self, kind='deduct', amount=3900, label='Exempt investment', **overrides):
        body = {'date_to': '2026-12-31', 'kind': kind, 'label': label, 'amount': amount, **overrides}
        result = self.api('POST', f'{ZAKAT}/adjustments', json=body)
        self.assertEqual(result.status_code, 201, result.text)
        return result.json()

    def report(self):
        result = self.api('GET', BASE)
        self.assertEqual(result.status_code, 200, result.text)
        return result.json()

    def review(self, **overrides):
        return self.api('POST', f'{ZAKAT}/reviews', json={'date_to': '2026-12-31', 'credential': 'SOCPA 12345', **overrides})

    def test_without_adjustments_the_base_is_the_templates_and_nothing_is_reviewed(self):
        report = self.report()
        self.assertEqual((report['template_base'], report['base'], report['adjustments'], report['adjustments_total']), (103900, 103900, [], 0))
        self.assertEqual((report['status'], report['filed'], report['review']), ('management_information', False, None))

    def test_adjustments_move_the_base_and_the_zakat_due(self):
        self.adjust('deduct', 3900, 'Exempt investment')
        self.adjust('add', 1000, 'Disallowed provision', note='Per the accountant')
        report = self.report()
        self.assertEqual((report['template_base'], report['adjustments_total'], report['base']), (103900, -2900, 101000))
        self.assertEqual(report['zakat_due'], round(101000 * RATE, 2))
        self.assertEqual([item['label'] for item in report['adjustments']], ['Exempt investment', 'Disallowed provision'])
        self.assertEqual(report['adjustments'][1]['note'], 'Per the accountant')
        listed = self.api('GET', f'{ZAKAT}/adjustments?date_to=2026-12-31').json()
        self.assertEqual(listed['total'], 2)
        self.assertEqual(self.api('GET', f'{ZAKAT}/adjustments?date_to=2025-12-31').json(), {'items': [], 'total': 0})

    def test_a_base_driven_below_zero_owes_nothing_and_a_removed_adjustment_goes_back(self):
        big = self.adjust('deduct', 500000, 'Everything')
        self.assertEqual((self.report()['base'], self.report()['zakat_due']), (-396100, 0))
        self.assertEqual(self.api('DELETE', f'{ZAKAT}/adjustments/{big["id"]}').status_code, 204)
        self.assertEqual(self.report()['base'], 103900)

    def test_a_review_is_current_until_the_figures_or_adjustments_change(self):
        created = self.review(note='Checked against the ledger')
        self.assertEqual(created.status_code, 201, created.text)
        review = created.json()
        self.assertEqual((review['base'], review['credential'], review['current']), (103900, 'SOCPA 12345', True))
        self.assertEqual(review['reviewer']['name'], self.manager.name)
        report = self.report()
        self.assertEqual((report['status'], report['review']['id'], report['filed']), ('reviewed', review['id'], False))
        self.adjust('deduct', 100)
        stale = self.report()
        self.assertEqual((stale['status'], stale['review']['current']), ('review_stale', False))
        self.assertEqual(self.review().status_code, 201)
        again = self.report()
        self.assertEqual((again['status'], again['review']['base']), ('reviewed', 103800))
        history = self.api('GET', f'{ZAKAT}/reviews?date_to=2026-12-31').json()
        self.assertEqual([(item['base'], item['current']) for item in history['items']], [(103800, True), (103900, False)])

    def test_new_postings_make_a_review_stale(self):
        self.review()
        self.entry('2026-12-01', [('101001', 500, 0), ('300001', 0, 500)])
        self.assertEqual(self.report()['status'], 'review_stale')

    def test_a_review_row_is_never_changed_or_deleted(self):
        review = self.env['webvue.finance.zakat.review'].browse(self.review().json()['id'])
        with self.assertRaises(AccessError):
            review.write({'note': 'edited'})
        with self.assertRaises(AccessError):
            review.unlink()

    def test_refusals(self):
        for body, field in (
            ({'kind': 'add', 'label': 'x', 'amount': 1}, 'date_to'),
            ({'date_to': '2026-12-31', 'label': 'x', 'amount': 1}, 'kind'),
            ({'date_to': '2026-12-31', 'kind': 'subtract', 'label': 'x', 'amount': 1}, 'kind'),
            ({'date_to': '2026-12-31', 'kind': 'add', 'label': ' ', 'amount': 1}, 'label'),
            ({'date_to': '2026-12-31', 'kind': 'add', 'label': 'x', 'amount': 0}, 'amount'),
            ({'date_to': '2026-12-31', 'kind': 'add', 'label': 'x', 'amount': 1, 'colour': 1}, 'colour'),
        ):
            with self.subTest(body=body):
                self.assertRefused(self.api('POST', f'{ZAKAT}/adjustments', json=body), 422, 'invalid', field)
        self.assertRefused(self.api('POST', f'{ZAKAT}/reviews', json={'date_to': '2026-12-31'}), 422, 'invalid', 'credential')
        self.assertRefused(self.api('POST', f'{ZAKAT}/reviews', json={'date_to': '2026-12-31', 'credential': ' '}), 422, 'invalid', 'credential')
        self.assertRefused(self.api('DELETE', f'{ZAKAT}/adjustments/999999'), 404, 'not_found')

    def test_other_company_adjustments_are_apart(self):
        foreign = self.env['webvue.finance.zakat.adjustment'].create({
            'company_id': self.other_company.id, 'date_to': '2026-12-31', 'kind': 'add', 'label': 'Foreign', 'amount': 9,
        })
        self.assertEqual(self.report()['adjustments'], [])
        self.assertRefused(self.api('DELETE', f'{ZAKAT}/adjustments/{foreign.id}'), 404, 'not_found')

    def test_each_step_has_its_own_capability_and_is_audited(self):
        self.user_with('zakat_reader', ['finance.zakat.read'])
        self.authenticate('zakat_reader', PASSWORD)
        self.assertEqual(self.api('GET', BASE).status_code, 200)
        adjust = {'date_to': '2026-12-31', 'kind': 'add', 'label': 'x', 'amount': 1}
        self.assertRefused(self.api('POST', f'{ZAKAT}/adjustments', json=adjust), 403, 'forbidden')
        self.assertRefused(self.review(), 403, 'forbidden')
        self.user_with('zakat_preparer', ['finance.zakat.read', 'finance.zakat.manage'])
        self.authenticate('zakat_preparer', PASSWORD)
        self.assertEqual(self.api('POST', f'{ZAKAT}/adjustments', json=adjust).status_code, 201)
        self.assertRefused(self.review(), 403, 'forbidden')
        self.user_with('zakat_reviewer', ['finance.zakat.read', 'finance.zakat.review'])
        self.authenticate('zakat_reviewer', PASSWORD)
        self.assertEqual(self.review().status_code, 201)
        self.assertRefused(self.api('POST', f'{ZAKAT}/adjustments', json=adjust), 403, 'forbidden')
        actions = set(self.env['webvue.finance.audit.event'].search([('res_model', 'like', 'webvue.finance.zakat')]).mapped('action'))
        self.assertEqual(actions, {'zakat_adjustment_added', 'zakat_reviewed'})
