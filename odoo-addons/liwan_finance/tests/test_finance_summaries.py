# Part of Odoo. See LICENSE file for full copyright and licensing details.
from unittest.mock import patch
from urllib.parse import urlencode

from odoo.tests import tagged

from .common import OUTSIDER_LOGIN, OUTSIDER_PASSWORD
from .oca_common import LiwanFinanceOcaCase
from odoo.addons.liwan_api.tests.common import set_probe_feature

RESOURCES = {
    'invoices': ('account.move', ('draft', 'posted', 'cancel')),
    'entries': ('account.move', ('draft', 'posted', 'cancel')),
    'assets': ('account.asset', ('draft', 'open', 'close')),
    'budgets': ('mis.budget.by.account', ('draft', 'confirmed', 'cancelled')),
}
MARKER = 'KPI summary fixture'


@tagged('post_install', '-at_install', 'liwan', 'finance_summary')
class TestFinanceSummaries(LiwanFinanceOcaCase):
    """Summary totals are the authorized full filtered lists, with one grouped count."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.invoice.ref = MARKER
        cls.other_invoice.ref = MARKER
        cls.summary_draft = cls._draft_sale_invoice(cls.company, cls.partner)
        cls.summary_draft.ref = MARKER
        cls.summary_entry = cls.env['account.move'].with_company(cls.company).create({
            'move_type': 'entry', 'date': '2026-10-18', 'ref': MARKER,
            'journal_id': cls._journal(cls.company, 'general').id,
        })
        cls.env['account.move'].with_company(cls.other_company).create({
            'move_type': 'entry', 'date': '2026-10-18', 'ref': MARKER,
            'journal_id': cls._journal(cls.other_company, 'general').id,
        })
        cls.summary_profile = cls.asset_profile(cls.company)
        cls.foreign_profile = cls.asset_profile(cls.other_company)
        for company, profile in ((cls.company, cls.summary_profile), (cls.other_company, cls.foreign_profile)):
            for state in ('draft', 'open', 'close', 'removed'):
                cls.env['account.asset'].with_company(company).create({
                    'name': MARKER, 'code': f'KPI-{company.id}-{state}', 'profile_id': profile.id,
                    'purchase_value': 1200, 'date_start': '2026-01-01', 'state': state,
                })
            for state in ('draft', 'confirmed', 'cancelled'):
                cls.env['mis.budget.by.account'].create({
                    'name': MARKER, 'company_id': company.id, 'state': state,
                    'date_from': '2026-01-01', 'date_to': '2026-12-31',
                })

    def _get(self, resource, *, summary=False, **filters):
        path = f'/api/v1/finance/{resource}' + ('/summary' if summary else '')
        result = self.api('GET', f'{path}?{urlencode(filters)}')
        self.assertEqual(result.status_code, 200, result.text)
        return result.json()

    def _assert_parity(self, resource, **filters):
        _, states = RESOURCES[resource]
        expected = {'total': self._get(resource, **filters)['total']}
        expected.update({state: self._get(resource, **filters, state=state)['total'] for state in states})
        # State and page window never constrain the tile counts, but every other list filter does.
        summary = self._get(resource, summary=True, **filters, state=states[0], limit=1, offset=100)
        self.assertEqual(summary, expected)
        return summary

    def test_each_summary_matches_lists_and_omits_invisible_company(self):
        self.assertEqual(self._assert_parity('invoices', q=MARKER, move_type='out_invoice'), {
            'total': 2, 'draft': 1, 'posted': 1, 'cancel': 0,
        })
        self.assertEqual(self._assert_parity('entries', q=MARKER)['total'], 1)
        # All four states, including removed, contribute to total; only three have tiles.
        self.assertEqual(self._assert_parity('assets', q=MARKER), {'total': 4, 'draft': 1, 'open': 1, 'close': 1})
        self.assertEqual(self._assert_parity('budgets', q=MARKER), {'total': 3, 'draft': 1, 'confirmed': 1, 'cancelled': 1})

    def test_every_supported_filter_matches_the_list(self):
        invoice = dict(q=MARKER, move_type='out_invoice', partner_id=self.partner.id,
                       date_from='2026-10-18', date_to='2026-10-18')
        self.assertEqual(self._assert_parity('invoices', **invoice)['total'], 2)
        self.assertEqual(self._assert_parity('invoices', **{**invoice, 'partner_id': self.vendor.id})['total'], 0)
        self.assertEqual(self._assert_parity('invoices', **{**invoice, 'date_from': '2027-01-01', 'date_to': '2027-12-31'})['total'], 0)
        self.assertEqual(self._assert_parity('entries', q=MARKER, journal_id=self.summary_entry.journal_id.id,
                                            date_from='2026-10-18', date_to='2026-10-18')['total'], 1)
        self.assertEqual(self._assert_parity('entries', q=MARKER, journal_id=self._journal(self.company, 'sale').id)['total'], 0)
        self.assertEqual(self._assert_parity('assets', q=MARKER, profile_id=self.summary_profile.id)['total'], 4)
        self.assertEqual(self._assert_parity('assets', q=MARKER, profile_id=self.foreign_profile.id)['total'], 0)

    def test_no_matches_emit_zero_for_every_key(self):
        for resource, (_, states) in RESOURCES.items():
            with self.subTest(resource=resource):
                self.assertEqual(self._get(resource, summary=True, q='no-such-summary-record'),
                                 {key: 0 for key in ('total', *states)})

    def test_each_summary_performs_one_state_aggregate_without_row_serialization(self):
        for resource, (model, _) in RESOURCES.items():
            with self.subTest(resource=resource):
                aggregate_calls = []
                cls = type(self.env[model])
                original = cls._read_group

                def grouped(records, domain, *args, **kwargs):
                    if kwargs.get('groupby') == ['state'] and kwargs.get('aggregates') == ['__count']:
                        aggregate_calls.append(domain)
                    return original(records, domain, *args, **kwargs)

                with patch.object(cls, '_read_group', grouped), \
                     patch(f'odoo.addons.liwan_finance.controllers.finance_{resource}.list_page',
                           side_effect=AssertionError('summary must not search/serialize list rows')):
                    self._get(resource, summary=True, q=MARKER)
                self.assertEqual(len(aggregate_calls), 1)
                self.assertIn(('company_id', 'in', [self.company.id]), aggregate_calls[0])
                self.assertFalse(any(isinstance(term, tuple) and term[0] == 'state' for term in aggregate_calls[0]))

    def test_invalid_filter_values_are_refused_like_the_list(self):
        bad = {
            'invoices': [{'state': 'unsupported'}, {'move_type': 'entry'}, {'partner_id': '-1'},
                         {'date_from': '2026-02-30'}, {'date_from': '2026-02-01', 'date_to': '2026-01-01'}],
            'entries': [{'state': 'unsupported'}, {'journal_id': 'abc'}, {'partner_id': '-1'}, {'date_to': 'tomorrow'}],
            'assets': [{'state': 'unsupported'}, {'profile_id': '-1'}],
            'budgets': [{'state': 'unsupported'}],
        }
        for resource, filters in bad.items():
            for query in filters:
                for suffix in ('', '/summary'):
                    with self.subTest(resource=resource, suffix=suffix, query=query):
                        result = self.api('GET', f'/api/v1/finance/{resource}{suffix}?{urlencode(query)}')
                        self.assertEqual((result.status_code, result.json()['code']), (422, 'invalid'))

    def test_summary_requires_the_same_read_capability(self):
        self.authenticate(OUTSIDER_LOGIN, OUTSIDER_PASSWORD)
        for resource in RESOURCES:
            result = self.api('GET', f'/api/v1/finance/{resource}/summary')
            self.assertEqual((result.status_code, result.json()['code']), (403, 'forbidden'))

    def test_summary_requires_finance_feature(self):
        set_probe_feature(self, key='finance.enabled', enabled=False)
        for resource in RESOURCES:
            result = self.api('GET', f'/api/v1/finance/{resource}/summary')
            self.assertEqual(result.status_code, 403, result.text)
