# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date

from odoo.exceptions import AccessError
from odoo.tests import TransactionCase, new_test_user, tagged

PAYROLL_READ_KEYS = {'hr.employees.read', 'hr.payroll.read'}
PAYROLL_MANAGE_KEYS = {'hr.employees.read', 'hr.payroll.read', 'hr.payroll.manage'}
VERSION_READ_FIELDS = (
    'contract_date_start', 'date_start', 'date_end', 'country_id',
    'identification_id', 'departure_date',
)


@tagged('liwan', 'liwan_access')
class TestPayrollEngineAccess(TransactionCase):
    """The payroll engine is opened to the payroll capability groups and to an employee's
    own approved payslips only; no stock HR or OCA payroll group is involved."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company = cls.env.company
        Employee = cls.env['hr.employee']
        cls.own_user = cls._user_with('payroll_own', {'hr.employees.read'})
        cls.employee_a = Employee.create({
            'name': 'Payroll A', 'user_id': cls.own_user.id, 'company_id': cls.company.id,
        })
        cls.employee_b = Employee.create({
            'name': 'Payroll B', 'company_id': cls.company.id,
            'identification_id': '1234567890',
            'country_id': cls.env.ref('base.sa').id,
        })
        (cls.employee_a | cls.employee_b).write({'contract_date_start': date(2026, 1, 1)})
        category = cls.env['hr.salary.rule.category'].create({'name': 'Basic', 'code': 'BASIC'})
        cls.structure = cls.env['hr.payroll.structure'].create({
            'name': 'Access test structure',
            'rule_ids': [(0, 0, {
                'name': 'Basic', 'code': 'BASIC', 'sequence': 1,
                'category_id': category.id,
                'amount_select': 'fix', 'amount_fix': 1000.0,
            })],
        })
        cls.draft_a = cls._payslip(cls.employee_a)
        cls.draft_b = cls._payslip(cls.employee_b)
        cls.done_a = cls._payslip(cls.employee_a, state='done')
        cls.done_b = cls._payslip(cls.employee_b, state='done')
        cls.done_a.compute_sheet()
        cls.done_a.write({'state': 'done'})
        cls.done_b.compute_sheet()
        cls.done_b.write({'state': 'done'})
        cls.payslips = cls.draft_a | cls.draft_b | cls.done_a | cls.done_b
        Leave = cls.env['hr.leave'].with_context(
            mail_notrack=True, leave_skip_state_check=True)
        leave_type = cls.env['hr.leave.type'].create({
            'name': 'Payroll test leave', 'requires_allocation': False,
        })
        cls.allocation_type = cls.env['hr.leave.type'].create({
            'name': 'Payroll test allocation', 'requires_allocation': True,
        })
        cls.leave_b = Leave.create({
            'employee_id': cls.employee_b.id, 'holiday_status_id': leave_type.id,
            'request_date_from': date(2026, 11, 8), 'request_date_to': date(2026, 11, 8),
        })
        cls.allocation_b = cls.env['hr.leave.allocation'].create({
            'employee_id': cls.employee_b.id,
            'holiday_status_id': cls.allocation_type.id,
            'number_of_days': 5, 'date_from': date(2026, 1, 1),
        })
        cls.reader = cls._user_with('payroll_reader', PAYROLL_READ_KEYS)
        cls.manager = cls._user_with('payroll_manager', PAYROLL_MANAGE_KEYS)
        cls.hr_manager = new_test_user(
            cls.env, login='payroll_hr_manager', password='payroll_hr_manager_pass_123',
            name='payroll_hr_manager', groups='liwan_core.group_employee',
        )
        cls.env['liwan.access.service']._liwan_replace_assignments(cls.hr_manager, [{
            'role_id': cls.env.ref('liwan_hr.role_hr_manager').id,
            'company_id': cls.company.id,
        }])

    @classmethod
    def _user_with(cls, login, capability_keys):
        user = new_test_user(
            cls.env, login=login, password=f'{login}_pass_123', name=login,
            groups='liwan_core.group_employee',
        )
        role = cls.env['liwan.access.role'].create({
            'key': f'engine_access_{login}', 'name_ar': login, 'name_en': login,
            'type': 'custom', 'assignable': True,
            'permission_ids': [(6, 0, cls.env['liwan.access.permission'].search([
                ('key', 'in', list(capability_keys)),
            ]).ids)],
        })
        cls.env['liwan.access.service']._liwan_replace_assignments(user, [{
            'role_id': role.id, 'company_id': cls.company.id,
        }])
        return user

    @classmethod
    def _payslip(cls, employee, state='draft'):
        return cls.env['hr.payslip'].create({
            'name': f'Slip {employee.name} {state}',
            'employee_id': employee.id,
            'contract_id': employee.version_id.id,
            'struct_id': cls.structure.id,
            'date_from': date(2026, 10, 1),
            'date_to': date(2026, 10, 31),
            'company_id': cls.company.id,
        })

    def test_employee_reads_only_own_approved_payslips(self):
        Payslip = self.env['hr.payslip'].with_user(self.own_user)
        self.assertEqual(Payslip.search([]).ids, [self.done_a.id])
        Line = self.env['hr.payslip.line'].with_user(self.own_user)
        lines = Line.search([])
        self.assertTrue(lines)
        self.assertEqual(lines.slip_id, self.done_a)

    def test_payroll_reader_reads_all_company_payslips_without_hr_manage(self):
        Payslip = self.env['hr.payslip'].with_user(self.reader)
        self.assertEqual(set(Payslip.search([]).ids), set(self.payslips.ids))
        with self.assertRaises(AccessError):
            self.env['hr.employee'].with_user(self.reader).browse(
                self.employee_b.id).write({'name': 'x'})
        with self.assertRaises(AccessError):
            self.env['hr.version'].with_user(self.reader).search(
                [('employee_id', '=', self.employee_b.id)]).write({'job_title': 'x'})

    def test_payroll_reader_reads_version_dates_and_nationality(self):
        version = self.env['hr.version'].with_user(self.reader).search(
            [('employee_id', '=', self.employee_b.id)], limit=1)
        self.assertTrue(version)
        for field_name in VERSION_READ_FIELDS:
            version.read([field_name])

    def test_hr_manager_without_payroll_reads_no_payslip(self):
        # The employee read row stays: an HR manager sees only their own approved payslips.
        Payslip = self.env['hr.payslip'].with_user(self.hr_manager)
        self.assertFalse(Payslip.search([]))
        with self.assertRaises(AccessError):
            Payslip.browse(self.done_b.id).read(['name'])

    def test_payroll_reader_reads_company_leaves_and_allocations(self):
        domain = [('employee_id', '=', self.employee_b.id)]
        for model in ('hr.leave', 'hr.leave.allocation'):
            self.assertEqual(self.env[model].with_user(self.reader).search_count(domain), 1)
            self.assertEqual(self.env[model].with_user(self.own_user).search_count(domain), 0)

    def test_payroll_manager_computes_a_payslip(self):
        slip = self.draft_b.with_user(self.manager)
        slip.compute_sheet()
        self.assertEqual(slip.state, 'verify')
        self.assertTrue(slip.line_ids)

    def test_employee_cannot_read_other_payroll_records(self):
        run = self.env['hr.payslip.run'].create({'name': 'Run B'})
        self.done_b.write({'payslip_run_id': run.id})
        self.env['hr.payslip.input'].create({
            'name': 'Bonus', 'code': 'BONUS', 'payslip_id': self.done_b.id,
            'amount': 10.0, 'contract_id': self.employee_b.version_id.id,
        })
        user = self.own_user
        for model in ('hr.payslip.input', 'hr.payslip.worked_days', 'hr.payslip.run', 'hr.version'):
            with self.assertRaises(AccessError, msg=model):
                self.env[model].with_user(user).search([])
        with self.assertRaises(AccessError):
            self.done_b.line_ids.with_user(user).read(['name'])

    def test_payroll_reader_never_reads_another_company(self):
        other = self.env['res.company'].create({'name': 'Payroll Other Company'})
        employee = self.env['hr.employee'].create({
            'name': 'Payroll Other', 'company_id': other.id,
            'contract_date_start': date(2026, 1, 1),
        })
        structure = self.structure.copy({'name': 'Other structure', 'company_id': other.id})
        slip = self.env['hr.payslip'].create({
            'name': 'Slip other', 'employee_id': employee.id,
            'contract_id': employee.version_id.id, 'struct_id': structure.id,
            'date_from': date(2026, 10, 1), 'date_to': date(2026, 10, 31),
            'company_id': other.id,
        })
        slip.compute_sheet()
        run = self.env['hr.payslip.run'].create({'name': 'Run other', 'company_id': other.id})
        slip.write({'payslip_run_id': run.id, 'state': 'done'})
        slip_input = self.env['hr.payslip.input'].create({
            'name': 'Bonus', 'code': 'BONUS', 'payslip_id': slip.id,
            'amount': 10.0, 'contract_id': employee.version_id.id,
        })
        worked = self.env['hr.payslip.worked_days'].create({
            'name': 'Work', 'code': 'WORK100', 'payslip_id': slip.id,
            'contract_id': employee.version_id.id, 'number_of_days': 1,
        })
        self.assertTrue(slip.line_ids)
        reader = self.reader
        for record in (slip, slip.line_ids, slip_input, worked, run):
            found = self.env[record._name].with_user(reader).search([('id', 'in', record.ids)])
            self.assertFalse(found, record._name)
