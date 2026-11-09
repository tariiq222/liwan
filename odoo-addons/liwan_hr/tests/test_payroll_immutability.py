# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date

from odoo.exceptions import AccessError
from odoo.tests import tagged

from .payroll_common import PayrollCase

RUNS = '/api/v1/hr/payroll/runs'
MONTH = '2026-11'
IBAN = 'SA0380000000608010167519'


@tagged('post_install', '-at_install', 'liwan')
class TestPayrollImmutability(PayrollCase):
    """An approved payroll month is fixed at the model, not only in the routes that approve it."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.officer = cls.payroll_user(cls, 'fixed_officer', ['hr.payroll.read', 'hr.payroll.manage', 'hr.employees.read'])
        cls.approver = cls.payroll_user(cls, 'fixed_approver', ['hr.payroll.read', 'hr.payroll.approve', 'hr.employees.read'])
        cls.worker = cls.make_employee(cls, 'Fixed Worker')
        cls.set_compensation(
            cls, cls.worker, 10000, 2500, 1000, iban=IBAN, gosi_registration_date=date(2020, 1, 1),
        )

    def _login(self, user):
        self.authenticate(user.login, f'{user.login}_pass_123')

    def _approved_run(self):
        self._login(self.officer)
        run = self.env['hr.payslip.run'].browse(self.api('POST', RUNS, json={'month': MONTH}).json()['id'])
        self.assertEqual(self.api('POST', f'{RUNS}/{run.id}/compute').status_code, 200)
        self._login(self.approver)
        self.assertEqual(self.api('POST', f'{RUNS}/{run.id}/approve').status_code, 200)
        self.assertEqual(run.liwan_state, 'approved')
        return run

    def test_a_written_payslip_line_of_an_approved_run_is_refused(self):
        run = self._approved_run()
        slip = run.slip_ids
        self.assertEqual(slip.state, 'done')
        # The model guard is what the routes and every script meet: it runs for the payroll manager too.
        holder = slip.with_user(self.officer)
        with self.assertRaises(AccessError):
            holder.line_ids[0].write({'total': 99999})
        with self.assertRaises(AccessError):
            holder.write({'liwan_paid_days': 1})

    def test_an_unlinked_payslip_of_an_approved_run_is_refused(self):
        run = self._approved_run()
        slip = run.slip_ids
        holder = slip.with_user(self.officer)
        with self.assertRaises(AccessError):
            holder.unlink()
        with self.assertRaises(AccessError):
            holder.with_user(self.officer).line_ids.unlink()
        self.assertTrue(slip.exists())
        self.assertTrue(slip.line_ids)

    def test_an_entered_input_of_an_approved_run_is_refused(self):
        run = self._approved_run()
        slip = run.slip_ids
        self.assertTrue(slip.input_line_ids)
        with self.assertRaises(AccessError):
            slip.with_user(self.officer).input_line_ids[0].write({'amount': 500})

    def test_a_line_added_to_an_approved_payslip_is_refused(self):
        """The net is summed from the lines, so a created line moves the figures as surely as an edited one."""
        run = self._approved_run()
        slip = run.slip_ids
        net = slip._liwan_amounts()[slip.id]['net']
        holder = slip.with_user(self.officer)
        with self.assertRaises(AccessError):
            holder.write({'line_ids': [(0, 0, {
                'name': 'Extra', 'code': 'EXTRA', 'category_id': slip.line_ids[0].category_id.id,
                'salary_rule_id': slip.line_ids[0].salary_rule_id.id, 'amount': 5000,
            })]})
        # The same create through the line model directly, outside the computed fields of the payslip.
        sample = slip.line_ids[0]
        with self.assertRaises(AccessError):
            self.env['hr.payslip.line'].with_user(self.officer).create({
                'slip_id': slip.id, 'name': 'Extra', 'code': 'EXTRA', 'category_id': sample.category_id.id,
                'salary_rule_id': sample.salary_rule_id.id, 'employee_id': slip.employee_id.id,
                'contract_id': slip.contract_id.id, 'amount': 5000, 'quantity': 1, 'rate': 100,
            })
        self.assertEqual(slip._liwan_amounts()[slip.id]['net'], net)
        self.assertNotIn('EXTRA', {line.code for line in slip.line_ids})

    def test_an_input_added_to_an_approved_payslip_is_refused(self):
        run = self._approved_run()
        slip = run.slip_ids
        sample = slip.input_line_ids[0]
        for vals in (
            {'payslip_id': slip.id, 'name': sample.name, 'code': 'WV_EXTRA', 'contract_id': slip.contract_id.id},
            {'payslip_id': slip.id, 'name': sample.name, 'code': sample.code, 'contract_id': slip.contract_id.id, 'amount': 5},
        ):
            with self.subTest(code=vals['code']), self.assertRaises(AccessError):
                self.env['hr.payslip.input'].with_user(self.officer).create(vals)
        with self.assertRaises(AccessError):
            slip.with_user(self.officer).write({
                'input_line_ids': [(0, 0, {
                    'name': 'Extra', 'code': 'WV_EXTRA', 'contract_id': slip.contract_id.id, 'amount': 5,
                })],
            })
        self.assertNotIn('WV_EXTRA', {line.code for line in slip.input_line_ids})

    def test_a_line_added_to_a_payslip_of_an_editable_run_is_allowed(self):
        """The guard freezes a fixed month only: a draft payslip still computes its lines."""
        self._login(self.officer)
        run = self.env['hr.payslip.run'].browse(self.api('POST', RUNS, json={'month': MONTH}).json()['id'])
        self.assertEqual(run.liwan_state, 'draft')
        slip = run.slip_ids
        sample = slip.line_ids[:1]
        if not sample:
            self.env['hr.payslip'].with_user(self.officer).browse(slip.id).compute_sheet()
            sample = slip.line_ids[:1]
        self.assertTrue(sample)
        line = self.env['hr.payslip.line'].with_user(self.officer).create({
            'slip_id': slip.id, 'name': 'Extra', 'code': 'EXTRA', 'category_id': sample.category_id.id,
            'salary_rule_id': sample.salary_rule_id.id, 'employee_id': slip.employee_id.id,
            'contract_id': slip.contract_id.id, 'amount': 1, 'quantity': 1, 'rate': 100,
        })
        self.assertTrue(line.exists())

    def test_an_approved_run_cannot_go_back_to_draft(self):
        run = self._approved_run()
        holder = self.env['hr.payslip.run'].with_user(self.officer)
        with self.assertRaises(AccessError):
            holder.browse(run.id).write({'liwan_state': 'draft'})
        with self.assertRaises(AccessError):
            holder.browse(run.id).write({'liwan_state': 'computed'})
        # The engine's own state is the same unlock one layer down.
        with self.assertRaises(AccessError):
            holder.browse(run.id).write({'state': 'draft'})
        self.assertEqual((run.liwan_state, run.state), ('approved', 'close'))

    def test_an_approved_run_cannot_be_deleted(self):
        run = self._approved_run()
        with self.assertRaises(AccessError):
            self.env['hr.payslip.run'].with_user(self.officer).browse(run.id).unlink()
        self.assertTrue(run.exists())

    def test_the_api_refuses_the_same_writes_before_the_model_does(self):
        run = self._approved_run()
        slip = run.slip_ids
        self._login(self.officer)
        for path in (f'{RUNS}/{run.id}', f'{RUNS}/{run.id}/payslips/{slip.id}/inputs'):
            res = self.api('DELETE', path) if path.endswith(str(run.id)) else self.api(
                'PATCH', path, json={'bonus_amount': 1},
            )
            self.assertEqual(res.status_code, 403, (path, res.text))
        self.assertEqual(self.api('POST', f'{RUNS}/{run.id}/compute').status_code, 403)
