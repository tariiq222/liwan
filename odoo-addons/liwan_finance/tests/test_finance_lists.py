# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .common import MANAGER_LOGIN, MANAGER_PASSWORD, LiwanFinanceCase

PAYMENT_KEYS = {
    'id', 'name', 'payment_type', 'partner_type', 'state', 'partner', 'journal', 'date', 'memo',
    'currency', 'amount', 'unallocated', 'exchange_difference', 'invoices', 'allowed_actions', 'blocked_actions',
}
ACCOUNT_KEYS = {'id', 'code', 'name', 'account_type', 'reconcile', 'currency', 'active'}
JOURNAL_KEYS = {'id', 'name', 'code', 'type', 'currency', 'default_account', 'active'}


@tagged('post_install', '-at_install', 'liwan')
class TestFinanceLists(LiwanFinanceCase):

    @classmethod
    def _payment(cls, company, amount, memo):
        return cls.env['account.payment'].with_company(company).create({
            'payment_type': 'inbound', 'partner_type': 'customer', 'partner_id': cls.partner.id,
            'amount': amount, 'date': '2026-10-18', 'memo': memo,
            'journal_id': cls.env['account.journal'].search([
                ('company_id', '=', company.id), ('type', '=', 'bank'),
            ], limit=1).id,
        })

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.payment = cls._payment(cls.company, 1150, 'INV settlement')
        cls.other_payment = cls._payment(cls.other_company, 500, 'Foreign settlement')

    def setUp(self):
        super().setUp()
        self.authenticate(MANAGER_LOGIN, MANAGER_PASSWORD)

    def _get(self, route, query=''):
        result = self.api('GET', f'/api/v1/finance/{route}{query}')
        self.assertEqual(result.status_code, 200, result.text)
        return result.json()

    def test_payments_serialize_the_whitelisted_shape_with_the_currency(self):
        body = self._get('payments')
        self.assertEqual(set(body), {'items', 'total'})
        item = next(row for row in body['items'] if row['id'] == self.payment.id)
        self.assertEqual(set(item), PAYMENT_KEYS)
        self.assertEqual((item['amount'], item['currency'], item['payment_type']), (1150, 'SAR', 'inbound'))

    def test_payments_are_company_scoped_and_filterable(self):
        ids = {row['id'] for row in self._get('payments')['items']}
        self.assertEqual(ids, {self.payment.id})
        self.assertEqual(self._get('payments', '?payment_type=outbound')['total'], 0)
        self.assertEqual(self._get('payments', '?state=draft')['total'], 1)
        self.assertEqual(self._get('payments', '?q=settlement')['total'], 1)
        self.assertEqual(self._get('payments', '?date_from=2026-11-01')['total'], 0)

    def test_payments_reject_a_bad_filter(self):
        result = self.api('GET', '/api/v1/finance/payments?payment_type=sideways')
        self.assertEqual((result.status_code, result.json()['code']), (422, 'invalid'))

    def test_accounts_are_the_saudi_chart_of_the_current_company(self):
        body = self._get('accounts', '?limit=200')
        self.assertGreater(body['total'], 100)
        self.assertEqual(set(body['items'][0]), ACCOUNT_KEYS)
        own = self.env['account.account'].search([('company_ids', 'in', self.company.ids)])
        other = self.env['account.account'].search([('company_ids', 'in', self.other_company.ids)])
        self.assertEqual(body['total'], len(own))
        returned = {row['id'] for row in body['items']}
        self.assertFalse(returned & set(other.ids) - set(own.ids))

    def test_accounts_filter_by_type_and_text(self):
        receivable = self._get('accounts', '?account_type=asset_receivable')
        self.assertGreaterEqual(receivable['total'], 1)
        self.assertEqual({row['account_type'] for row in receivable['items']}, {'asset_receivable'})
        code = receivable['items'][0]['code']
        self.assertIn(code, {row['code'] for row in self._get('accounts', f'?q={code}')['items']})
        result = self.api('GET', '/api/v1/finance/accounts?account_type=nope')
        self.assertEqual((result.status_code, result.json()['code']), (422, 'invalid'))

    def test_journals_are_the_current_companys_with_their_currency(self):
        body = self._get('journals')
        self.assertEqual(set(body['items'][0]), JOURNAL_KEYS)
        own = self.env['account.journal'].search([('company_id', '=', self.company.id)])
        self.assertEqual({row['id'] for row in body['items']}, set(own.ids))
        self.assertEqual({row['currency'] for row in body['items']}, {'SAR'})
        sales = self._get('journals', '?type=sale')
        self.assertEqual({row['type'] for row in sales['items']}, {'sale'})
        result = self.api('GET', '/api/v1/finance/journals?type=nope')
        self.assertEqual((result.status_code, result.json()['code']), (422, 'invalid'))
