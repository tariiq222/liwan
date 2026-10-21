# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date

from odoo.tests import tagged

from .payroll_common import PayrollCase
from odoo.addons.webvue_hr.rules import WebVueHrRule

NOVEMBER = (date(2026, 11, 1), date(2026, 11, 30))


@tagged('post_install', '-at_install', 'webvue')
class TestPayrollCompute(PayrollCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.manager = cls.payroll_user(cls, 'pay_compute', [
            'hr.payroll.read', 'hr.payroll.manage', 'hr.employees.read',
        ])
        cls.structure = cls.env.ref('webvue_hr.structure_saudi')
        cls.unpaid = cls.env.ref('hr_holidays.leave_type_unpaid')

    def _payslip(self, employee, inputs=None, structure=None):
        slip_model = self.env['hr.payslip'].with_user(self.manager)
        payslip = slip_model.create({
            'employee_id': employee.id,
            'date_from': NOVEMBER[0],
            'date_to': NOVEMBER[1],
            'company_id': employee.company_id.id,
            'struct_id': (structure or self.structure).id,
        })
        payslip.contract_id = payslip._webvue_period_version()
        payslip.write({'input_line_ids': [
            (0, 0, {**line, 'amount': (inputs or {}).get(line['code'], 0)})
            for line in payslip.get_inputs(payslip.contract_id, *NOVEMBER)
        ]})
        payslip.compute_sheet()
        return payslip

    def _lines(self, payslip):
        return {line.code: line.total for line in payslip.line_ids}

    def _leave(self, employee, start, end):
        leave = self.env['hr.leave'].create({
            'employee_id': employee.id,
            'holiday_status_id': self.unpaid.id,
            'request_date_from': start,
            'request_date_to': end,
        })
        leave.action_approve()
        self.assertEqual(leave.state, 'validate')
        return leave

    def test_full_month_saudi_payslip(self):
        employee = self.make_employee('Full Month')
        self.set_compensation(
            employee, 10000, 2500, 1000, gosi_registration_date=date(2020, 1, 1),
        )
        lines = self._lines(self._payslip(employee))
        self.assertEqual(lines['BASIC'], 10000)
        self.assertEqual(lines['HOUSING'], 2500)
        self.assertEqual(lines['TRANSPORT'], 1000)
        self.assertEqual(lines['GOSI_EE_ANN'], -1125.00)
        self.assertEqual(lines['GOSI_EE_SANED'], -93.75)
        self.assertEqual(
            round(lines['GOSI_ER_ANN'] + lines['GOSI_ER_SANED'] + lines['GOSI_ER_OH'], 2), 1468.75)
        self.assertEqual(lines['NET'], 12281.25)

    def test_joiner_mid_month_with_unpaid_leave(self):
        employee = self.make_employee('Joiner', start=date(2026, 11, 16))
        self.set_compensation(
            employee, 9000, 2250, 750, gosi_registration_date=date(2020, 1, 1),
        )
        self._leave(employee, date(2026, 11, 20), date(2026, 11, 22))
        lines = self._lines(self._payslip(employee))
        self.assertEqual(lines['BASIC'], 4500.00)
        self.assertEqual(lines['HOUSING'], 1125.00)
        self.assertEqual(lines['TRANSPORT'], 375.00)
        self.assertEqual(lines['UNPAID'], -1200.00)
        self.assertEqual(lines['GOSI_WAGE'], 5625.00)
        self.assertEqual(lines['GOSI_EE_ANN'], -506.25)
        self.assertEqual(lines['GOSI_EE_SANED'], -42.19)
        self.assertEqual(lines['NET'], 4251.56)

    def test_unpaid_leave_before_contract_start_is_not_counted(self):
        employee = self.make_employee('Early Leave', start=date(2026, 11, 16))
        self.set_compensation(
            employee, 9000, 2250, 750, gosi_registration_date=date(2020, 1, 1),
        )
        self._leave(employee, date(2026, 11, 10), date(2026, 11, 12))
        self.assertEqual(self._lines(self._payslip(employee))['UNPAID'], 0)

    def test_absence_input_and_cap(self):
        employee = self.make_employee('Absent', start=date(2026, 11, 16))
        self.set_compensation(
            employee, 9000, 2250, 750, gosi_registration_date=date(2020, 1, 1),
        )
        lines = self._lines(self._payslip(employee, {'WV_ABSENCE_DAYS': 40}))
        self.assertEqual(lines['ABSENCE'], -6000.00)
        gosi = lines['GOSI_EE_ANN'] + lines['GOSI_EE_SANED']
        self.assertGreaterEqual(lines['NET'], gosi)
        self.assertAlmostEqual(lines['NET'], gosi, places=2)

    def test_payslip_snapshots_department_of_period_end_version(self):
        first = self.env['hr.department'].create({'name': 'Dept A'})
        second = self.env['hr.department'].create({'name': 'Dept B'})
        employee = self.make_employee('Mover', start=date(2026, 1, 1), department=first)
        self.set_compensation(
            employee, 10000, 2500, 1000, gosi_registration_date=date(2020, 1, 1),
        )
        employee.create_version({'date_version': date(2026, 11, 16), 'department_id': second.id})
        payslip = self._payslip(employee)
        self.assertEqual(payslip.line_ids.filtered(lambda line: line.code == 'BASIC').mapped('total'), [10000])
        self.assertEqual(payslip.webvue_department_id, second)

    def test_engine_does_not_read_hr_version_wage(self):
        employee = self.make_employee('No Wage')
        self.set_compensation(
            employee, 10000, 2500, 1000, gosi_registration_date=date(2020, 1, 1),
        )
        employee.version_id.write({'wage': 0})
        self.assertEqual(employee.version_id.wage, 0)
        self.assertEqual(self._lines(self._payslip(employee))['BASIC'], 10000)

    def test_hour_unpaid_leave_deducts_its_fraction_of_a_day(self):
        hourly = self.env['hr.leave.type'].create({
            'name': 'Unpaid hours', 'requires_allocation': False, 'request_unit': 'hour',
        })
        self.env['webvue.hr.payroll.settings']._webvue_save(self.env.company, {
            'unpaid_leave_type_ids': [(4, hourly.id)],
        })
        employee = self.make_employee('Hourly')
        self.set_compensation(
            employee, 9000, 2250, 750, gosi_registration_date=date(2020, 1, 1),
        )
        leave = self.env['hr.leave'].create({
            'employee_id': employee.id, 'holiday_status_id': hourly.id,
            'request_date_from': date(2026, 11, 3), 'request_date_to': date(2026, 11, 3),
            'request_unit_hours': True, 'request_hour_from': 9, 'request_hour_to': 11,
        })
        leave.action_approve()
        self.assertEqual(leave.state, 'validate')
        self.assertEqual(leave.number_of_days, 0.25)
        self.assertEqual(self._lines(self._payslip(employee))['UNPAID'], -100.00)

    def test_structure_using_saudi_rules_must_be_the_company_structure(self):
        child = self.env['hr.payroll.structure'].create({
            'name': 'Child of Saudi', 'parent_id': self.structure.id,
        })
        other = self.env['hr.payroll.structure'].create({'name': 'Unrelated'})
        employee = self.make_employee('Mismatch')
        self.set_compensation(
            employee, 10000, 2500, 1000, gosi_registration_date=date(2020, 1, 1),
        )
        with self.assertRaises(WebVueHrRule) as refused:
            self._payslip(employee, structure=child)
        self.assertEqual(refused.exception.code, 'payroll_structure_mismatch')
        self.assertEqual(refused.exception.status, 422)
        self.assertEqual(self._payslip(employee, structure=other).state, 'verify')

    def test_structure_mismatch_is_refused_when_the_contract_misses_the_period(self):
        child = self.env['hr.payroll.structure'].create({
            'name': 'Child of Saudi', 'parent_id': self.structure.id,
        })
        employee = self.make_employee('Later Joiner', start=date(2027, 1, 1))
        with self.assertRaises(WebVueHrRule) as refused:
            self._payslip(employee, structure=child)
        self.assertEqual(refused.exception.code, 'payroll_structure_mismatch')

    def test_missing_contract_start_is_refused(self):
        employee = self.env['hr.employee'].create({'name': 'No Contract', 'company_id': self.env.company.id})
        employee.version_id.write({'contract_date_start': False})
        with self.assertRaises(WebVueHrRule) as refused:
            self._payslip(employee)
        self.assertEqual(refused.exception.code, 'contract_missing')
        self.assertEqual(refused.exception.field, 'employee_id')
