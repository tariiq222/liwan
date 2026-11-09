# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command
from odoo.exceptions import AccessError
from odoo.tests import tagged

from .common import RUNS, PayrollFinanceCase

# A company has one run per month, so each test builds its own.
POSTED_MONTH = '2026-11'
FOREIGN_MONTH = '2026-10'
PAID_MONTH = '2026-09'
PAY_DAY = '2026-12-01'
# ``finance.entries.post`` requires the rest of its family; the poster holds no payroll management.
POSTING = ('finance.entries.read', 'finance.entries.manage', 'finance.entries.post')
# ``finance.payments.manage`` requires its own family; the payer holds no payroll management either.
PAYING = ('finance.invoices.read', 'finance.payments.read', 'finance.payments.manage')
# The payroll reader every finance step needs; none of them holds payroll management.
PAYROLL_READ = ('hr.payroll.read', 'hr.employees.read')


@tagged('post_install', '-at_install', 'liwan')
class TestPayrollRunWriteGuard(PayrollFinanceCase):
    """A user without payroll management only moves a run along steps that link it to the record it books."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.dept = cls.make_department('Write Guard')
        cls.env['liwan.hr.payroll.cost.center'].create({
            'company_id': cls.company.id, 'department_id': cls.dept.id, 'analytic_account_id': cls.riyadh.id,
        })
        cls.employee = cls.make_employee('Guard Worker', cls.dept)
        cls.full_settings()
        cls.guard_poster = cls.user_with('guard_poster', list(POSTING))
        cls.guard_payer = cls.user_with('guard_payer', [*PAYROLL_READ, *PAYING])
        cls.route_poster = cls.user_with('guard_route_poster', [
            'hr.payroll.read', 'hr.employees.read', *POSTING,
        ])

    def _posted_run(self, month):
        """The run of ``month`` posted through the real route by a user without payroll management."""
        run = self._approved_run([self.employee], month)
        self.login_as(self.route_poster)
        res = self.api('POST', f"{RUNS}/{run['id']}/post")
        self.assertEqual(res.status_code, 200, res.text)
        record = self.env['hr.payslip.run'].browse(run['id'])
        self.assertEqual(record.liwan_state, 'posted')
        self.assertEqual(record.liwan_move_id.liwan_payroll_origin, 'run')
        self.assertEqual(record.liwan_move_id.state, 'posted')
        self.assertEqual(record.liwan_move_id.company_id, self.company)
        return record

    def _general_entry(self, journal, account):
        """A posted entry of ``journal`` that payroll did not make."""
        move = self.env['account.move'].create({
            'move_type': 'entry',
            'journal_id': journal.id,
            'line_ids': [
                Command.create({'account_id': account.id, 'debit': 100, 'credit': 0}),
                Command.create({'account_id': account.id, 'debit': 0, 'credit': 100}),
            ],
        })
        move.action_post()
        return move

    def test_post_route_still_posts_a_run(self):
        self._posted_run(POSTED_MONTH)

    def test_the_forward_steps_of_the_finance_bridge_still_write_the_run(self):
        """The posting and payment the finance bridge performs must survive the model freeze.

        Posting writes ``liwan_move_id`` and advances ``liwan_state`` to ``posted``; paying writes
        ``liwan_payment_id`` and advances it to ``paid``. Those are forward steps on an approved run, and the
        freeze refuses only the header the figures came from, so both must still land.
        """
        run = self._posted_run(POSTED_MONTH)
        self.assertEqual(run.liwan_state, 'posted')
        self.assertTrue(run.liwan_move_id)
        self.login_as(self.guard_payer)
        paid = self.api('POST', f'{RUNS}/{run.id}/payment', json={'journal_id': self.bank.id, 'date': PAY_DAY})
        self.assertEqual(paid.status_code, 200, paid.text)
        self.assertEqual(run.liwan_state, 'paid')
        self.assertTrue(run.liwan_payment_id)

    def test_the_approval_write_on_a_computed_run_is_allowed(self):
        """Approval itself is a write that turns the run from computed to approved and stamps the approver."""
        run = self.env['hr.payslip.run'].browse(self._approved_run([self.employee], PAID_MONTH)['id'])
        self.assertEqual(run.liwan_state, 'approved')
        self.assertEqual(run.liwan_approved_by_id, self.payroll_approver)
        self.assertTrue(run.liwan_approved_at)

    def test_forged_post_with_an_unrelated_entry_is_refused(self):
        run = self.env['hr.payslip.run'].browse(self._approved_run([self.employee], POSTED_MONTH)['id'])
        move = self._general_entry(self.general_journal, self.accounts['basic_expense'])
        self.assertNotEqual(move.liwan_payroll_origin, 'run')
        with self.assertRaises(AccessError):
            run.with_user(self.guard_poster).write({'liwan_move_id': move.id, 'liwan_state': 'posted'})
        self.assertEqual(run.liwan_state, 'approved')
        self.assertFalse(run.liwan_move_id)

    def test_forged_post_with_another_company_entry_is_refused(self):
        run = self.env['hr.payslip.run'].browse(self._approved_run([self.employee], FOREIGN_MONTH)['id'])
        move = self.env['account.move'].create({
            'move_type': 'entry',
            'journal_id': self._journal(self.other_company, 'general').id,
            'liwan_payroll_origin': 'run',
            'line_ids': [
                Command.create({'account_id': self.foreign_account.id, 'debit': 100, 'credit': 0}),
                Command.create({'account_id': self.foreign_account.id, 'debit': 0, 'credit': 100}),
            ],
        })
        move.action_post()
        self.assertEqual((move.company_id, move.state), (self.other_company, 'posted'))
        self.guard_poster.company_ids = [Command.set([self.company.id, self.other_company.id])]
        with self.assertRaises(AccessError):
            run.with_user(self.guard_poster).write({'liwan_move_id': move.id, 'liwan_state': 'posted'})
        self.assertEqual(run.liwan_state, 'approved')

    def test_forged_payment_is_refused(self):
        run = self._posted_run(PAID_MONTH)
        payment = self.env['account.payment'].create({
            'payment_type': 'outbound', 'partner_type': 'supplier', 'amount': 100.0, 'date': PAY_DAY,
            'journal_id': self.bank.id, 'memo': 'guard',
            'destination_account_id': self.accounts['salaries_payable'].id,
        })
        payment.action_post()
        self.assertNotEqual(payment.move_id.liwan_payroll_origin, 'payment')
        with self.assertRaises(AccessError):
            run.with_user(self.guard_poster).write({'liwan_payment_id': payment.id, 'liwan_state': 'paid'})
        self.assertEqual(run.liwan_state, 'posted')
        self.assertFalse(run.liwan_payment_id)
