# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .write_common import PASSWORD, PAYMENTS, LiwanFinanceWriteCase

TRANSFERS = f'{PAYMENTS}/transfer'


@tagged('post_install', '-at_install', 'liwan')
class TestFinanceTransfers(LiwanFinanceWriteCase):
    """Money moved between two of the company's liquidity journals through its transfer account."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.cash = cls._journal(cls.company, 'cash') or cls.env['account.journal'].create({
            'name': 'Petty cash', 'type': 'cash', 'code': 'PCSH', 'company_id': cls.company.id,
        })
        cls.reader = cls.user_with('transfer_reader', ['finance.payments.read'])

    def body(self, **overrides):
        return {'from_journal_id': self.bank.id, 'to_journal_id': self.cash.id, 'amount': 500, 'payment_date': '2026-10-20', **overrides}

    def move(self, amount=500, **overrides):
        result = self.api('POST', TRANSFERS, json=self.body(amount=amount, **overrides))
        self.assertEqual(result.status_code, 201, result.text)
        return result.json()

    def test_a_transfer_posts_two_paired_payments_and_nets_the_transfer_account(self):
        body = self.move(memo='Petty cash top-up')
        out, inn = body['outbound'], body['inbound']
        self.assertEqual((out['payment_type'], out['journal']['id'], out['amount']), ('outbound', self.bank.id, 500))
        self.assertEqual((inn['payment_type'], inn['journal']['id'], inn['amount']), ('inbound', self.cash.id, 500))
        outbound = self.env['account.payment'].browse(out['id'])
        inbound = self.env['account.payment'].browse(inn['id'])
        self.assertEqual(outbound.paired_internal_transfer_payment_id, inbound)
        self.assertEqual(inbound.paired_internal_transfer_payment_id, outbound)
        account = self.company.transfer_account_id
        lines = (outbound | inbound).move_id.line_ids.filtered(lambda line: line.account_id == account)
        self.assertEqual((len(lines), sum(lines.mapped('balance')), all(lines.mapped('reconciled'))), (2, 0, True))

    def test_the_same_or_a_non_liquidity_journal_is_refused(self):
        same = self.api('POST', TRANSFERS, json=self.body(to_journal_id=self.bank.id))
        self.assertRefused(same, 422, 'invalid')
        sales = self._journal(self.company, 'sale')
        result = self.api('POST', TRANSFERS, json=self.body(to_journal_id=sales.id))
        self.assertEqual((result.status_code, result.json()['field']), (422, 'to_journal_id'))
        foreign = self.api('POST', TRANSFERS, json=self.body(to_journal_id=self.other_bank.id))
        self.assertEqual((foreign.status_code, foreign.json()['field']), (422, 'to_journal_id'))

    def test_a_company_without_a_transfer_account_is_refused(self):
        self.company.transfer_account_id = False
        self.assertRefused(self.api('POST', TRANSFERS, json=self.body()), 422, 'transfer_account_missing')

    def test_an_amount_must_be_positive(self):
        for amount in (0, -5, 'x'):
            self.assertEqual(self.api('POST', TRANSFERS, json=self.body(amount=amount)).status_code, 422, amount)

    def test_a_reader_cannot_transfer(self):
        self.authenticate('transfer_reader', PASSWORD)
        self.assertRefused(self.api('POST', TRANSFERS, json=self.body()), 403, 'forbidden')

    def test_a_transfer_is_audited_once_per_leg(self):
        events = self.env['liwan.finance.audit.event']
        before = set(events.search([]).ids)
        self.move()
        new = events.search([('id', 'not in', list(before))])
        self.assertEqual(new.mapped('action'), ['transfer_created'] * 2)

    def test_a_locked_period_is_refused_before_either_leg_is_posted(self):
        self.company.fiscalyear_lock_date = '2026-10-31'
        before = self.env['account.payment'].search_count([])
        result = self.api('POST', TRANSFERS, json=self.body())
        self.assertRefused(result, 422, 'period_locked')
        self.assertEqual(self.env['account.payment'].search_count([]), before)
