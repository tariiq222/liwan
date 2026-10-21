# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date, timedelta
from unittest.mock import patch

from odoo import fields
from odoo.exceptions import AccessError
from odoo.tests import tagged

from .common import RUNS, PayrollFinanceCase

MONTH = '2026-11'
PAYROLL_READ = ('hr.payroll.read', 'hr.employees.read')
POSTING = ('finance.entries.read', 'finance.entries.manage', 'finance.entries.post')
PAYING = ('finance.invoices.read', 'finance.payments.read', 'finance.payments.manage')
PAY_DAY = '2026-12-01'


@tagged('post_install', '-at_install', 'webvue')
class TestPayrollPayment(PayrollFinanceCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.dept = cls.make_department('Payment A')
        cls.env['webvue.hr.payroll.cost.center'].create({
            'company_id': cls.company.id, 'department_id': cls.dept.id, 'analytic_account_id': cls.riyadh.id,
        })
        cls.e1 = cls.make_employee('Payment E1', cls.dept)
        cls.e2 = cls.make_employee('Payment E2', cls.dept)
        cls.settings = cls.full_settings()
        cls.bank_journal = cls._journal(cls.company, 'bank')
        cls.poster = cls.user_with('pay_poster', [*PAYROLL_READ, *POSTING])
        cls.payer = cls.user_with('pay_payer', [*PAYROLL_READ, *PAYING])
        cls.accountant = cls.user_with('pay_accountant', [*PAYROLL_READ, *POSTING, *PAYING])

    def _posted_run(self, month=MONTH):
        run = self._approved_run([self.e1, self.e2], month)
        self.login_as(self.poster)
        res = self.api('POST', f"{RUNS}/{run['id']}/post")
        self.assertEqual(res.status_code, 200, res.text)
        return res.json()

    def _pay(self, run_id, user=None, **body):
        self.login_as(user or self.payer)
        return self.api('POST', f'{RUNS}/{run_id}/payment', json={
            'journal_id': self.bank_journal.id, 'date': PAY_DAY, **body,
        })

    def _payable_lines(self, run_id):
        run = self.env['hr.payslip.run'].browse(run_id)
        return run.webvue_move_id.line_ids.filtered(
            lambda line: line.account_id == self.accounts['salaries_payable'],
        )

    def test_payment_clears_salaries_payable(self):
        run = self._posted_run()
        res = self._pay(run['id'])
        self.assertEqual(res.status_code, 200, res.text)
        body = res.json()
        self.assertEqual(body['state'], 'paid')
        payment = self.env['account.payment'].browse(body['finance']['payment_id'])
        self.assertEqual(payment.amount, 24562.50)
        self.assertEqual(payment.payment_type, 'outbound')
        self.assertEqual(payment.state, 'in_process')
        self.assertEqual(payment.date, date(2026, 12, 1))
        self.assertEqual(payment.memo, MONTH)
        self.assertEqual(payment.move_id.webvue_payroll_origin, 'payment')
        self.assertFalse(payment.partner_id)
        self.assertEqual(body['finance']['payment_name'], payment.name)
        lines = self._payable_lines(run['id'])
        self.assertTrue(lines)
        self.assertTrue(all(line.reconciled for line in lines))
        listed = self.api('GET', '/api/v1/finance/payments').json()['items']
        self.assertIn(payment.id, [row['id'] for row in listed])

    def test_payment_refuses_locked_date(self):
        run = self._posted_run()
        self.company.hard_lock_date = date(2026, 12, 31)
        res = self._pay(run['id'])
        self.assertEqual(res.status_code, 422, res.text)
        self.assertEqual(res.json()['code'], 'period_locked')
        self.assertEqual(res.json()['field'], 'date')
        self.assertFalse(self.env['account.payment'].search_count([('memo', '=', MONTH)]))
        self.assertEqual(self.api('GET', f"{RUNS}/{run['id']}").json()['state'], 'posted')

    def test_payment_needs_posted_run(self):
        run = self._approved_run([self.e1, self.e2], MONTH)
        res = self._pay(run['id'])
        self.assertEqual(res.status_code, 403, res.text)
        self.assertEqual(res.json()['code'], 'transition_forbidden')

    def test_paid_run_cannot_be_paid_twice(self):
        run = self._posted_run()
        self.assertEqual(self._pay(run['id']).status_code, 200)
        again = self._pay(run['id'])
        self.assertEqual(again.status_code, 403, again.text)
        self.assertEqual(again.json()['code'], 'transition_forbidden')

    def test_payment_needs_both_capabilities(self):
        run = self._posted_run()
        reader = self.user_with('pay_reader', list(PAYROLL_READ))
        for user in (reader, self.poster):
            res = self._pay(run['id'], user)
            self.assertEqual(res.status_code, 403, res.text)
            self.assertEqual(res.json()['code'], 'forbidden')
        only_payments = self.user_with('pay_only_payments', list(PAYING))
        self.assertEqual(self._pay(run['id'], only_payments).status_code, 403)
        self.assertEqual(self._pay(run['id']).status_code, 200)

    def test_payment_journal_must_be_bank_or_cash(self):
        run = self._posted_run()
        for journal in (self.general_journal, self._journal(self.other_company, 'bank')):
            res = self._pay(run['id'], journal_id=journal.id)
            self.assertEqual(res.status_code, 422, res.text)
            self.assertEqual(res.json()['code'], 'invalid')
            self.assertEqual(res.json()['field'], 'journal_id')
        self.assertEqual(self.api('GET', f"{RUNS}/{run['id']}").json()['state'], 'posted')

    def test_payment_journal_must_be_in_the_company_currency(self):
        run = self._posted_run()
        foreign = self.env['res.currency'].search([('id', '!=', self.company.currency_id.id)], limit=1)
        foreign.active = True
        journal = self.bank_journal.copy({'name': 'Foreign bank', 'code': 'FXB', 'currency_id': foreign.id})
        res = self._pay(run['id'], journal_id=journal.id)
        self.assertEqual(res.status_code, 422, res.text)
        self.assertEqual(res.json()['code'], 'invalid')
        self.assertEqual(res.json()['field'], 'journal_id')
        self.assertEqual(self.api('GET', f"{RUNS}/{run['id']}").json()['state'], 'posted')

    def test_payment_date_cannot_precede_the_run_entry(self):
        run = self._posted_run()
        move_date = self.env['hr.payslip.run'].browse(run['id']).webvue_move_id.date
        res = self._pay(run['id'], date=str(move_date - timedelta(days=1)))
        self.assertEqual(res.status_code, 422, res.text)
        self.assertEqual(res.json()['code'], 'invalid')
        self.assertEqual(res.json()['field'], 'date')
        self.assertEqual(self.api('GET', f"{RUNS}/{run['id']}").json()['state'], 'posted')

    def test_unreconciled_payable_refuses_the_payment(self):
        run = self._posted_run()
        with patch.object(self.env.registry['account.move.line'], 'reconcile', lambda lines: None):
            res = self._pay(run['id'])
        self.assertEqual(res.status_code, 422, res.text)
        self.assertEqual(res.json()['code'], 'invalid')
        self.assertEqual(res.json()['field'], 'state')
        self.assertEqual(self.api('GET', f"{RUNS}/{run['id']}").json()['state'], 'posted')
        self.assertFalse(self.env['hr.payslip.run'].browse(run['id']).webvue_payment_id)

    def test_approver_cannot_stamp_another_user(self):
        self.login_as(self.payroll_officer)
        run_id = self.api('POST', RUNS, json={'month': MONTH}).json()['id']
        self.assertEqual(self.api('POST', f'{RUNS}/{run_id}/compute').status_code, 200)
        run = self.env['hr.payslip.run'].browse(run_id).with_user(self.payroll_approver)
        with self.assertRaises(AccessError):
            run.write({
                'webvue_state': 'approved', 'webvue_approved_by_id': self.payroll_officer.id,
                'webvue_approved_at': fields.Datetime.now(),
            })
        with self.assertRaises(AccessError):
            run.write({'state': 'close'})

    def test_approver_can_only_approve(self):
        self.login_as(self.payroll_officer)
        created = self.api('POST', RUNS, json={'month': MONTH})
        run_id = created.json()['id']
        self.assertEqual(self.api('POST', f'{RUNS}/{run_id}/compute').status_code, 200)
        run = self.env['hr.payslip.run'].browse(run_id).with_user(self.payroll_approver)
        for vals in ({'date_start': date(2026, 11, 2)}, {'webvue_state': 'paid'}, {'webvue_state': 'approved'}):
            with self.assertRaises(AccessError):
                run.write(vals)
        self.login_as(self.payroll_approver)
        self.assertEqual(self.api('POST', f'{RUNS}/{run_id}/approve').status_code, 200)
        run.invalidate_recordset()
        with self.assertRaises(AccessError):
            run.write({'date_start': date(2026, 11, 2)})

    def test_per_employee_payable_lines_are_reconciled(self):
        self.settings.entry_detail = 'per_employee'
        run = self._posted_run()
        lines = self._payable_lines(run['id'])
        self.assertEqual(len(lines), 2)
        self.assertEqual(self._pay(run['id']).status_code, 200)
        self.assertTrue(all(line.reconciled for line in lines))

    def test_actions_and_refs_follow_the_run_state(self):
        run = self._posted_run()
        self.login_as(self.accountant)
        self.assertEqual(self.api('GET', f"{RUNS}/{run['id']}").json()['allowed_actions'], ['record_payment', 'eos_provision'])
        self.login_as(self.poster)
        self.assertEqual(self.api('GET', f"{RUNS}/{run['id']}").json()['allowed_actions'], ['eos_provision'])
        paid = self._pay(run['id']).json()
        self.assertEqual(paid['allowed_actions'], [])
        self.assertIsNotNone(paid['finance']['payment_name'])
        self.login_as(self.user_with('pay_no_pay_read', list(PAYROLL_READ)))
        finance = self.api('GET', f"{RUNS}/{run['id']}").json()['finance']
        self.assertEqual(finance['payment_id'], paid['finance']['payment_id'])
        self.assertIsNone(finance['payment_name'])

    def test_preview_refuses_a_run_that_is_not_approved(self):
        run = self._posted_run()
        self.login_as(self.poster)
        res = self.api('GET', f"{RUNS}/{run['id']}/posting-preview")
        self.assertEqual(res.status_code, 403, res.text)
        self.assertEqual(res.json()['code'], 'transition_forbidden')

    def test_run_write_guard_for_a_user_without_manage(self):
        approved = self._approved_run([self.e1, self.e2], MONTH)
        run = self.env['hr.payslip.run'].browse(approved['id']).with_user(self.accountant)
        with self.assertRaises(AccessError):
            run.write({'webvue_state': 'draft'})
        with self.assertRaises(AccessError):
            run.write({'date_end': date(2026, 12, 31)})
        with self.assertRaises(AccessError):
            run.write({'webvue_state': 'paid', 'webvue_payment_id': False})
        self.assertEqual(run.webvue_state, 'approved')
        self.login_as(self.accountant)
        self.assertEqual(self.api('POST', f"{RUNS}/{approved['id']}/post").status_code, 200)
        self.assertEqual(self._pay(approved['id'], self.accountant).status_code, 200)
        run.invalidate_recordset()
        with self.assertRaises(AccessError):
            run.write({'webvue_state': 'posted'})
