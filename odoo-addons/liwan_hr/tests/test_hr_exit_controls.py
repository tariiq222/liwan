# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date

from odoo.tests import tagged

from .common import set_hr_feature
from .payroll_common import PayrollCase

ARCHIVE = '/api/v1/hr/employees/{}/archive'
EOS = '/api/v1/hr/payroll/eos'
RUNS = '/api/v1/hr/payroll/runs'
DEPARTURE = date(2026, 11, 30)
IBAN = 'SA0380000000608010167519'


@tagged('post_install', '-at_install', 'liwan')
class TestHrExitControls(PayrollCase):
    """Archiving an employee and approving a payroll run both wait for the exit blockers."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.hr = cls.payroll_user(cls, 'exit_hr', ['hr.employees.read', 'hr.employees.archive'])
        cls.officer = cls.payroll_user(
            cls, 'exit_officer', ['hr.payroll.read', 'hr.payroll.manage', 'hr.employees.read'])
        cls.approver = cls.payroll_user(
            cls, 'exit_approver', ['hr.payroll.read', 'hr.payroll.approve', 'hr.employees.read'])
        cls.category = cls.env['maintenance.equipment.category'].create({'name': 'Exit laptops'})

    def _leaver(self, name, departure=DEPARTURE):
        employee = self.make_employee(name, start=date(2023, 12, 1))
        self.set_compensation(employee, 8000, 2000, 500, iban=IBAN, gosi_registration_date=date(2020, 1, 1))
        if departure:
            employee.write({
                'departure_date': departure, 'departure_reason_id': self.env.ref('hr.departure_resigned').id,
            })
        return employee

    def _custody(self, employee):
        return self.env['maintenance.equipment'].create({
            'name': f'Laptop of {employee.name}', 'category_id': self.category.id,
            'equipment_assign_to': 'employee', 'employee_id': employee.id,
        })

    def _settle(self, employee):
        self.env['liwan.hr.payroll.eos.settlement']._liwan_save_draft(employee, 'resignation', 0)
        self.env['liwan.hr.payroll.eos.settlement']._liwan_current(employee)._liwan_confirm()

    def _archive(self, employee, user=None):
        self.authenticate((user or self.hr).login, f'{(user or self.hr).login}_pass_123')
        return self.api('POST', ARCHIVE.format(employee.id), json={})

    def _assert_refused(self, res, employee, code):
        self.assertEqual((res.status_code, res.json()['code']), (422, code))
        self.assertIn(employee.id, res.json()['details']['employee_ids'])
        employee.invalidate_recordset(['active'])
        self.assertTrue(employee.active)

    def test_archive_without_departure_is_refused(self):
        employee = self._leaver('No Departure', departure=None)
        self._assert_refused(self._archive(employee), employee, 'departure_missing')

    def test_archive_with_open_custody_is_refused_for_an_archive_only_caller(self):
        employee = self._leaver('Holds Custody')
        equipment = self._custody(employee)
        self._settle(employee)
        res = self._archive(employee)
        self._assert_refused(res, employee, 'custody_open')
        self.assertEqual(res.json()['details']['equipment_ids'], equipment.ids)

    def test_archive_without_a_confirmed_settlement_is_refused(self):
        employee = self._leaver('Unsettled')
        self._assert_refused(self._archive(employee), employee, 'settlement_missing')

    def test_a_draft_or_stale_settlement_is_not_a_confirmed_one(self):
        employee = self._leaver('Draft Only')
        self.env['liwan.hr.payroll.eos.settlement']._liwan_save_draft(employee, 'resignation', 0)
        self._assert_refused(self._archive(employee), employee, 'settlement_missing')
        self.env['liwan.hr.payroll.eos.settlement']._liwan_current(employee)._liwan_confirm()
        employee.write({'departure_date': date(2026, 12, 15)})
        self._assert_refused(self._archive(employee), employee, 'settlement_missing')

    def test_first_blocker_wins_in_the_documented_order(self):
        employee = self._leaver('Everything Open', departure=None)
        self._custody(employee)
        self._assert_refused(self._archive(employee), employee, 'departure_missing')

    def test_happy_path_archives(self):
        employee = self._leaver('Clean Exit')
        self._settle(employee)
        res = self._archive(employee)
        self.assertEqual(res.status_code, 200)
        self.assertFalse(res.json()['active'])

    def test_returned_custody_no_longer_blocks(self):
        employee = self._leaver('Returns Laptop')
        equipment = self._custody(employee)
        self._settle(employee)
        equipment.write({'employee_id': False, 'equipment_assign_to': 'other'})
        self.assertEqual(self._archive(employee).status_code, 200)

    def test_archived_equipment_still_assigned_does_not_block(self):
        employee = self._leaver('Archived Laptop')
        equipment = self._custody(employee)
        equipment.write({'active': False})
        self._settle(employee)
        self.assertEqual(employee._liwan_exit_blockers(), [])
        self.assertEqual(self._archive(employee).status_code, 200)
        self.assertFalse(employee.active)

    def test_active_equipment_blocks_even_when_another_is_archived(self):
        employee = self._leaver('Mixed Laptops')
        self._custody(employee).write({'active': False})
        active = self._custody(employee)
        self._settle(employee)
        res = self._archive(employee)
        self._assert_refused(res, employee, 'custody_open')
        self.assertEqual(res.json()['details']['equipment_ids'], active.ids)

    def test_payroll_custody_blocker_ignores_archived_equipment(self):
        employee = self._leaver('Payroll Archived')
        self._custody(employee).write({'active': False})
        self._settle(employee)
        self.authenticate(self.officer.login, f'{self.officer.login}_pass_123')
        run = self.api('POST', RUNS, json={'month': '2026-11'}).json()
        self.assertEqual(self.api('POST', f"{RUNS}/{run['id']}/compute").status_code, 200)
        self.assertEqual(self.env['hr.payslip.run'].browse(run['id'])._liwan_custody_blockers(), [])
        self.authenticate(self.approver.login, f'{self.approver.login}_pass_123')
        res = self.api('POST', f"{RUNS}/{run['id']}/approve")
        self.assertNotEqual(res.json().get('code'), 'custody_open')

    def test_open_clearance_alone_does_not_block(self):
        employee = self._leaver('Clearance Open')
        self._settle(employee)
        self.assertEqual(employee._liwan_exit_blockers(), [])
        self.assertEqual(self._archive(employee).status_code, 200)

    def test_archive_still_disables_the_linked_account(self):
        user = self.env['res.users'].create({
            'name': 'Exit Linked', 'login': 'exit_linked', 'password': 'exit_linked_pass_123',
            'group_ids': [(6, 0, [self.env.ref('liwan_core.group_employee').id])],
        })
        employee = self._leaver('Linked Leaver')
        employee.write({'user_id': user.id})
        self._settle(employee)
        self.assertEqual(self._archive(employee).status_code, 200)
        user.invalidate_recordset(['active'])
        self.assertFalse(user.active)

    def test_payroll_approval_refuses_a_leaver_holding_custody(self):
        employee = self._leaver('Payroll Custody')
        self._custody(employee)
        self._settle(employee)
        self.authenticate(self.officer.login, f'{self.officer.login}_pass_123')
        run = self.api('POST', RUNS, json={'month': '2026-11'}).json()
        self.assertEqual(self.api('POST', f"{RUNS}/{run['id']}/compute").status_code, 200)
        self.authenticate(self.approver.login, f'{self.approver.login}_pass_123')
        res = self.api('POST', f"{RUNS}/{run['id']}/approve")
        self.assertEqual((res.status_code, res.json()['code']), (422, 'custody_open'))
        self.assertEqual(res.json()['details']['employee_ids'], [employee.id])

    def test_departure_blocker_applies_only_with_offboarding(self):
        employee = self._leaver('No Departure Feature', departure=None)
        self._assert_refused(self._archive(employee), employee, 'departure_missing')
        set_hr_feature(self, 'hr.offboarding', False)
        self.assertEqual(self._archive(employee).status_code, 200)
        self.assertFalse(employee.active)

    def test_custody_blocker_applies_only_with_assets(self):
        employee = self._leaver('Custody Feature')
        self._custody(employee)
        self._settle(employee)
        self._assert_refused(self._archive(employee), employee, 'custody_open')
        set_hr_feature(self, 'hr.assets', False)
        self.assertEqual(self._archive(employee).status_code, 200)
        self.assertFalse(employee.active)

    def test_settlement_blocker_applies_only_with_payroll(self):
        employee = self._leaver('Settlement Feature')
        self._assert_refused(self._archive(employee), employee, 'settlement_missing')
        set_hr_feature(self, 'hr.payroll', False)
        self.assertEqual(self._archive(employee).status_code, 200)
        self.assertFalse(employee.active)

    def test_one_disabled_feature_keeps_the_other_blockers(self):
        employee = self._leaver('Partial Features', departure=None)
        self._custody(employee)
        set_hr_feature(self, 'hr.offboarding', False)
        set_hr_feature(self, 'hr.payroll', False)
        self._assert_refused(self._archive(employee), employee, 'custody_open')

    def test_every_sub_feature_off_blocks_nothing(self):
        employee = self._leaver('All Off', departure=None)
        self._custody(employee)
        for key in ('hr.offboarding', 'hr.assets', 'hr.payroll'):
            set_hr_feature(self, key, False)
        self.assertEqual(employee._liwan_exit_blockers(), [])
        self.assertEqual(self._archive(employee).status_code, 200)

    def test_all_features_enabled_keeps_the_documented_order(self):
        employee = self._leaver('All On', departure=None)
        self._custody(employee)
        self.assertEqual(
            [blocker['code'] for blocker in employee._liwan_exit_blockers()], ['departure_missing', 'custody_open'])
        employee.write({'departure_date': DEPARTURE})
        self.assertEqual(
            [blocker['code'] for blocker in employee._liwan_exit_blockers()], ['custody_open', 'settlement_missing'])
