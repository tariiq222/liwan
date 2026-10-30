# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date

from odoo.exceptions import UserError
from odoo.tests import TransactionCase, tagged


@tagged('liwan', '-at_install', 'post_install')
class TestEmployeeDeleteGuard(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company = cls.env.company

    def _employee(self, name='Delete Guard'):
        return self.env['hr.employee'].create({'name': name, 'company_id': self.company.id})

    def _assert_refused(self, employee):
        with self.assertRaises(UserError), self.cr.savepoint():
            employee.unlink()
        self.assertTrue(employee.exists())

    def test_employee_without_history_is_deleted(self):
        employee = self._employee()
        employee.unlink()
        self.assertFalse(employee.exists())

    def test_employee_with_leave_is_refused(self):
        employee = self._employee()
        kind = self.env['hr.leave.type'].create({'name': 'Guard leave', 'requires_allocation': False})
        self.env['hr.leave'].create({
            'employee_id': employee.id, 'holiday_status_id': kind.id,
            'request_date_from': date(2030, 1, 6), 'request_date_to': date(2030, 1, 6),
        })
        self._assert_refused(employee)

    def test_employee_with_allocation_is_refused(self):
        employee = self._employee()
        kind = self.env['hr.leave.type'].create({'name': 'Guard allocated', 'requires_allocation': True})
        self.env['hr.leave.allocation'].create({
            'employee_id': employee.id, 'holiday_status_id': kind.id,
            'number_of_days': 5, 'date_from': date(2030, 1, 1),
        })
        self._assert_refused(employee)

    def test_employee_with_payslip_is_refused(self):
        employee = self._employee()
        self.env['hr.payslip'].create({
            'employee_id': employee.id, 'date_from': date(2030, 1, 1), 'date_to': date(2030, 1, 31),
        })
        self._assert_refused(employee)

    def test_employee_with_compensation_is_refused(self):
        employee = self._employee()
        self.env['liwan.hr.compensation'].create({'employee_id': employee.id, 'basic_wage': 1000})
        self._assert_refused(employee)

    def test_employee_with_extra_version_is_refused(self):
        employee = self._employee()
        employee.create_version({'date_version': date(2031, 1, 1)})
        self.assertGreater(len(employee.with_context(active_test=False).version_ids), 1)
        self._assert_refused(employee)

    def test_batch_with_one_historic_employee_is_refused_whole(self):
        clean, historic = self._employee('Clean'), self._employee('Historic')
        self.env['liwan.hr.compensation'].create({'employee_id': historic.id, 'basic_wage': 1000})
        self._assert_refused(clean | historic)
        self.assertTrue(clean.exists())

    def _planning_row(self, employee, **dates):
        calendar = self.env['resource.calendar'].create({'name': 'Guard shift'})
        return self.env['hr.employee.calendar'].create({
            'employee_id': employee.id, 'calendar_id': calendar.id, **dates,
        })

    def test_employee_with_dated_shift_assignment_is_refused(self):
        employee = self._employee()
        self._planning_row(employee, date_start=date(2030, 1, 1), date_end=date(2030, 3, 1))
        self.assertEqual(len(employee.with_context(active_test=False).version_ids), 1)
        self._assert_refused(employee)

    def test_employee_with_open_started_shift_assignment_is_refused(self):
        employee = self._employee()
        self._planning_row(employee, date_start=date(2030, 1, 1))
        self._assert_refused(employee)

    def test_employee_with_only_default_planning_row_is_deleted(self):
        employee = self._employee()
        self.env['hr.employee.calendar'].create({
            'employee_id': employee.id, 'calendar_id': self.company.resource_calendar_id.id,
        })
        employee.unlink()
        self.assertFalse(employee.exists())

    def test_batch_with_one_shift_planned_employee_is_refused_whole(self):
        clean, planned = self._employee('Clean'), self._employee('Planned')
        self._planning_row(planned, date_start=date(2030, 1, 1), date_end=date(2030, 3, 1))
        self._assert_refused(clean | planned)
        self.assertTrue(clean.exists())

    def test_guard_sees_pending_unflushed_changes(self):
        employee, other = self._employee('Holder'), self._employee('Other')
        entry = self.env['liwan.hr.compensation'].create({'employee_id': other.id, 'basic_wage': 1000})
        self.env.flush_all()
        # The reassignment is pending in the ORM cache; the guard must flush before it looks.
        entry.employee_id = employee
        self._assert_refused(employee)
        entry.employee_id = other
        employee.unlink()
        self.assertFalse(employee.exists())
