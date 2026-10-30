# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date

from odoo.exceptions import AccessError
from odoo.tests import tagged

from .payroll_common import PayrollCase

RUNS = '/api/v1/hr/payroll/runs'
MONTH = '2026-11'
VALID_IBAN = 'SA0380000000608010167519'
BONUS = 4321
DEDUCTION = 765


@tagged('post_install', '-at_install', 'liwan')
class TestPayrollRunAudit(PayrollCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        base = ['hr.payroll.read', 'hr.employees.read']
        cls.officer = cls.payroll_user(cls, 'runaud_officer', [*base, 'hr.payroll.manage'])
        cls.approver = cls.payroll_user(cls, 'runaud_approver', [*base, 'hr.payroll.approve'])
        cls.worker = cls.make_employee(cls, 'Run Audit Worker')
        cls.set_compensation(
            cls, cls.worker, 10000, 2500, 1000, iban=VALID_IBAN, gosi_registration_date=date(2020, 1, 1),
        )
        cls.Event = cls.env['liwan.hr.audit.event']

    def _login(self, user):
        self.authenticate(user.login, f'{user.login}_pass_123')

    def _call(self, user, method, path, body=None, status=200):
        self._login(user)
        res = self.api(method, path, json=body)
        self.assertEqual(res.status_code, status, res.text)
        return res

    def _run(self):
        run = self._call(self.officer, 'POST', RUNS, {'month': MONTH}, status=201).json()
        slip_id = self._call(self.officer, 'GET', f'{RUNS}/{run["id"]}/payslips').json()['items'][0]['id']
        return run['id'], slip_id

    def _inputs(self, run_id, slip_id, body, status=200):
        return self._call(self.officer, 'PATCH', f'{RUNS}/{run_id}/payslips/{slip_id}/inputs', body, status)

    def _events(self, action):
        return self.Event.search([('action', '=', action)])

    def _changes(self, event):
        return {change.field_name: (change.old_value, change.new_value) for change in event.change_ids}

    def _assert_no_amount(self):
        changes = self.env['liwan.hr.audit.change'].search([('company_id', '=', self.env.company.id)])
        values = [value for value in changes.mapped('old_value') + changes.mapped('new_value') if value]
        for amount in (str(BONUS), str(DEDUCTION), '10000', '2500'):
            self.assertFalse(any(amount in value for value in values), amount)

    def test_inputs_change_names_the_codes_without_amounts(self):
        run_id, slip_id = self._run()
        self._inputs(run_id, slip_id, {'bonus_amount': BONUS, 'deduction_amount': DEDUCTION})
        event = self._events('run_inputs_changed')
        self.assertEqual(len(event), 1)
        self.assertEqual((event.create_uid, event.res_model, event.res_id), (self.officer, 'hr.payslip.run', run_id))
        self.assertEqual(self._changes(event), {'WV_BONUS': (False, False), 'WV_DEDUCTION': (False, False)})
        self.assertFalse(self.Event.search([('res_model', 'in', ('hr.payslip.input', 'hr.payslip.line'))]))
        self._assert_no_amount()

    def test_inputs_change_of_a_computed_run_names_the_codes_and_the_state_reset(self):
        run_id, slip_id = self._run()
        self._call(self.officer, 'POST', f'{RUNS}/{run_id}/compute')
        self._inputs(run_id, slip_id, {'bonus_amount': BONUS})
        event = self._events('run_inputs_changed')
        self.assertEqual(self._changes(event), {'WV_BONUS': (False, False), 'liwan_state': ('computed', 'draft')})
        self._assert_no_amount()

    def test_resending_the_same_amounts_to_a_computed_run_logs_the_reset_only(self):
        run_id, slip_id = self._run()
        self._call(self.officer, 'POST', f'{RUNS}/{run_id}/compute')
        self._inputs(run_id, slip_id, {'bonus_amount': 0})
        event = self._events('run_inputs_changed')
        self.assertEqual(len(event), 1)
        self.assertEqual(self._changes(event), {'liwan_state': ('computed', 'draft')})

    def test_unchanged_or_refused_inputs_log_nothing(self):
        run_id, slip_id = self._run()
        self._inputs(run_id, slip_id, {'bonus_amount': 0})
        self._inputs(run_id, slip_id, {'bonus_amount': -1}, status=422)
        self.assertFalse(self._events('run_inputs_changed'))
        self._call(self.officer, 'POST', f'{RUNS}/{run_id}/compute')
        self._call(self.approver, 'POST', f'{RUNS}/{run_id}/approve')
        res = self._inputs(run_id, slip_id, {'bonus_amount': BONUS}, status=403)
        self.assertEqual(res.json()['code'], 'transition_forbidden')
        self.assertFalse(self._events('run_inputs_changed'))

    def test_approval_is_tracked_and_logged_once_by_the_approver(self):
        run_id, _slip_id = self._run()
        self._call(self.officer, 'POST', f'{RUNS}/{run_id}/compute')
        self._call(self.approver, 'POST', f'{RUNS}/{run_id}/approve')
        event = self._events('run_approved')
        self.assertEqual(len(event), 1)
        self.assertEqual((event.create_uid, event.company_id, event.res_id), (self.approver, self.env.company, run_id))
        changes = self._changes(event)
        self.assertEqual(changes['liwan_state'], ('computed', 'approved'))
        self.assertEqual(changes['liwan_approved_by_id'], (False, self.approver.name))
        self.assertTrue(changes['liwan_approved_at'][1])
        run = self.env['hr.payslip.run'].browse(run_id)
        approval = run.message_ids.filtered(
            lambda message: 'liwan_approved_by_id' in message.tracking_value_ids.mapped('field_id.name'),
        )
        self.assertEqual(len(approval), 1)
        self.assertLessEqual(
            {'state', 'liwan_state', 'liwan_approved_by_id', 'liwan_approved_at'},
            set(approval.tracking_value_ids.mapped('field_id.name')),
        )
        self._assert_no_amount()

    def test_refused_approval_logs_nothing(self):
        run_id, _slip_id = self._run()
        self._call(self.approver, 'POST', f'{RUNS}/{run_id}/approve', status=403)
        self.assertFalse(self._events('run_approved'))

    def test_cancel_logs_the_state_before_the_run_is_deleted(self):
        run_id, _slip_id = self._run()
        self._call(self.officer, 'POST', f'{RUNS}/{run_id}/compute')
        self._call(self.officer, 'DELETE', f'{RUNS}/{run_id}', status=204)
        self.assertFalse(self.env['hr.payslip.run'].browse(run_id).exists())
        event = self._events('run_cancelled')
        self.assertEqual(len(event), 1)
        self.assertEqual((event.create_uid, event.res_id), (self.officer, run_id))
        self.assertEqual(self._changes(event), {'liwan_state': ('computed', False)})

    def test_cancel_of_a_draft_run_logs_its_draft_state(self):
        run_id, _slip_id = self._run()
        self._call(self.officer, 'DELETE', f'{RUNS}/{run_id}', status=204)
        event = self._events('run_cancelled')
        self.assertEqual(len(event), 1)
        self.assertEqual(self._changes(event), {'liwan_state': ('draft', False)})

    def test_a_refused_cancel_leaves_no_cancellation_event(self):
        run_id, _slip_id = self._run()
        logged = self.Event.search([]).ids

        def refuse(records):
            msg = 'run_locked'
            raise AccessError(msg)

        self.patch(type(self.env['hr.payslip.run']), 'unlink', refuse)
        res = self._call(self.officer, 'DELETE', f'{RUNS}/{run_id}', status=403)
        self.assertEqual(res.json()['code'], 'forbidden')
        self.assertTrue(self.env['hr.payslip.run'].browse(run_id).exists())
        self.assertEqual(self.Event.search([]).ids, logged)
        self.assertFalse(self.env['liwan.hr.audit.change'].search([('event_id', 'not in', logged)]))
