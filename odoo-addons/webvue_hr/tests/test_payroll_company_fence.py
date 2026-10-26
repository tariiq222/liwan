# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date

from odoo.exceptions import AccessError
from odoo.tests import new_test_user, tagged

from .payroll_common import PayrollCase

SNAPSHOT_FIELDS = ('webvue_iban', 'webvue_bank_code', 'webvue_identification')
EMPLOYEES_READ_SCOPE = ((('hr.employees.read',), 'all'),)


@tagged('post_install', '-at_install', 'webvue')
class TestPayrollCompanyFence(PayrollCase):
    """Payroll groups are global, payroll grants are per company: a payslip answers per owning company.

    ``mixed`` reads payroll in A and only employees in B (a branch of A) and C (an unrelated company). In B and C
    the employee read ACL opens hr.payslip and the global payroll group opens the (1, '=', 1) payroll rules, so
    without the fence they would read every payslip of B and C, with its lines and payment snapshot.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        Company = cls.env['res.company']
        cls.company_a = Company.create({'name': 'Fence A'})
        cls.company_b = Company.create({'name': 'Fence B', 'parent_id': cls.company_a.id})
        cls.company_c = Company.create({'name': 'Fence C'})
        companies = cls.company_a | cls.company_b | cls.company_c
        cls.mixed = new_test_user(
            cls.env, login='fence_mixed', password='fence_mixed_pass_123', name='Fence Mixed',
            groups='webvue_core.group_employee', company_id=cls.company_a.id, company_ids=companies.ids,
        )
        cls.payroll_role = cls.env.ref('webvue_hr.role_payroll_manager')
        employee_role = cls.env.ref('webvue_core.role_employee')
        assignments = [{'role_id': employee_role.id, 'company_id': company.id} for company in companies]
        assignments.append({'role_id': cls.payroll_role.id, 'company_id': cls.company_a.id})
        cls.env['webvue.access.assignment'].create([{'user_id': cls.mixed.id, **item} for item in assignments])
        category = cls.env['hr.salary.rule.category'].create({'name': 'Fence basic', 'code': 'FENCE_BASIC'})
        cls.structure = cls.env['hr.payroll.structure'].create({
            'name': 'Fence structure', 'code': 'FENCE',
            'rule_ids': [(0, 0, {
                'name': 'Basic', 'code': 'FENCE_BASIC', 'sequence': 1, 'category_id': category.id,
                'amount_select': 'fix', 'amount_fix': 1000.0,
            })],
        })
        cls.slip_a = cls._done_slip(cls.company_a, 'Fence worker A')
        cls.slip_b = cls._done_slip(cls.company_b, 'Fence worker B')
        cls.slip_c = cls._done_slip(cls.company_c, 'Fence worker C')
        cls.own_b = cls._done_slip(cls.company_b, 'Fence mixed in B', user=cls.mixed)
        cls.own_draft_b = cls._slip(cls.own_b.employee_id)
        cls.attachment_b = cls.env['ir.attachment'].create({
            'name': 'B payslip file', 'raw': b'B payslip', 'type': 'binary',
            'res_model': 'hr.payslip', 'res_id': cls.slip_b.id, 'company_id': cls.company_b.id,
        })

    @classmethod
    def _slip(cls, employee):
        return cls.env['hr.payslip'].create({
            'name': f'Slip {employee.name}', 'employee_id': employee.id, 'contract_id': employee.version_id.id,
            'struct_id': cls.structure.id, 'date_from': date(2026, 10, 1), 'date_to': date(2026, 10, 31),
            'company_id': employee.company_id.id,
        })

    @classmethod
    def _done_slip(cls, company, name, user=None):
        employee = cls.env['hr.employee'].create({
            'name': name, 'company_id': company.id, 'user_id': user.id if user else False,
        })
        employee.version_id.contract_date_start = date(2026, 1, 1)
        slip = cls._slip(employee)
        # The engine stamps each line with the computing company, as a run computed in its own company does.
        slip.with_company(company).compute_sheet()
        slip.write({'state': 'done', **{field: f'{name} {field}' for field in SNAPSHOT_FIELDS}})
        return slip

    def _as_mixed(self, *companies, scope=None):
        context = {'allowed_company_ids': [company.id for company in companies]}
        if scope:
            context['webvue_capability_scope'] = scope
        return self.env(user=self.mixed, context=context)

    def _visible(self, env):
        return env['hr.payslip'].search([]), env['hr.payslip.line'].search([]).slip_id

    def _assign_payroll(self, company):
        return self.env['webvue.access.assignment'].create({
            'user_id': self.mixed.id, 'role_id': self.payroll_role.id, 'company_id': company.id,
        })

    def test_the_payroll_reader_reads_every_payslip_of_its_payroll_company(self):
        slips, line_slips = self._visible(self._as_mixed(self.company_a))
        self.assertEqual(slips, self.slip_a)
        self.assertEqual(line_slips, self.slip_a)
        values = slips.read(['name', *SNAPSHOT_FIELDS])[0]
        self.assertEqual(values['webvue_iban'], 'Fence worker A webvue_iban')

    def test_a_branch_with_only_employee_read_shows_only_the_own_approved_payslip(self):
        env = self._as_mixed(self.company_a, self.company_b, scope=EMPLOYEES_READ_SCOPE)
        slips, line_slips = self._visible(env)
        self.assertEqual(slips, self.slip_a | self.own_b)
        self.assertEqual(line_slips, self.slip_a | self.own_b)
        for fields in (['name'], list(SNAPSHOT_FIELDS)):
            with self.assertRaises(AccessError):
                env['hr.payslip'].browse(self.slip_b.id).read(fields)
        with self.assertRaises(AccessError):
            env['hr.payslip.line'].browse(self.slip_b.line_ids.ids).read(['total'])

    def test_a_current_company_with_only_employee_read_shows_only_the_own_approved_payslip(self):
        env = self._as_mixed(self.company_b, self.company_a)
        slips, line_slips = self._visible(env)
        self.assertEqual(slips, self.own_b)
        self.assertEqual(line_slips, self.own_b)
        self.assertEqual(env['hr.payslip'].browse(self.own_b.id).read(['name'])[0]['name'], self.own_b.name)
        for slip in (self.slip_b, self.own_draft_b):
            with self.assertRaises(AccessError):
                env['hr.payslip'].browse(slip.id).read(['name', *SNAPSHOT_FIELDS])
        with self.assertRaises(AccessError):
            env['hr.payslip.line'].browse(self.slip_b.line_ids.ids).read(['amount', 'total'])
        env_c = self._as_mixed(self.company_c)
        self.assertFalse(env_c['hr.payslip'].search([]))
        with self.assertRaises(AccessError):
            env_c['hr.payslip'].browse(self.slip_c.id).read(list(SNAPSHOT_FIELDS))

    def test_a_payslip_attachment_of_a_company_without_payroll_read_is_refused(self):
        env = self._as_mixed(self.company_b, self.company_a)
        target = [('res_model', '=', 'hr.payslip'), ('res_id', '=', self.slip_b.id)]
        file = env['ir.attachment'].browse(self.attachment_b.id)
        self.assertFalse(env['ir.attachment'].search(target))
        self.assertFalse(file.has_access('read'))
        with self.assertRaises(AccessError):
            file.read(['raw'])

    def test_a_grant_and_its_revocation_take_effect_at_once(self):
        env = self._as_mixed(self.company_b, self.company_a)
        self.assertEqual(self._visible(env)[0], self.own_b)
        assignment = self._assign_payroll(self.company_b)
        self.assertEqual(self._visible(env)[0], self.slip_b | self.own_b | self.own_draft_b)
        # The global payroll group stays (A still grants it): only the per-company fence closes B again.
        assignment.unlink()
        self.assertTrue(self.mixed.has_group('webvue_hr.group_cap_hr_payroll_read'))
        self.assertEqual(self._visible(env)[0], self.own_b)
        with self.assertRaises(AccessError):
            env['hr.payslip'].browse(self.slip_b.id).read(list(SNAPSHOT_FIELDS))
        # Removing A's payroll grant closes A as well, in the same warm environment.
        env_a = self._as_mixed(self.company_a)
        self.assertEqual(self._visible(env_a)[0], self.slip_a)
        self.env['webvue.access.assignment'].search([
            ('user_id', '=', self.mixed.id), ('role_id', '=', self.payroll_role.id),
        ]).unlink()
        self.assertFalse(self._visible(env_a)[0])

    def test_an_inherited_branch_grant_opens_the_branch_until_it_is_withdrawn(self):
        env = self._as_mixed(self.company_a, self.company_b, scope=EMPLOYEES_READ_SCOPE)
        self.company_a.webvue_branch_access_mode = 'inherited'
        inheritance = self.env['webvue.access.branch.rule'].create({
            'company_id': self.company_a.id, 'branch_id': self.company_b.id, 'inherit': True,
            'role_ids': [(6, 0, self.payroll_role.ids)],
        })
        self.assertEqual(self._visible(env)[0], self.slip_a | self.slip_b | self.own_b | self.own_draft_b)
        self.assertTrue(env['hr.payslip'].browse(self.slip_b.id).read(list(SNAPSHOT_FIELDS)))
        inheritance.inherit = False
        self.assertEqual(self._visible(env)[0], self.slip_a | self.own_b)
        with self.assertRaises(AccessError):
            env['hr.payslip'].browse(self.slip_b.id).read(['name'])

    def test_an_employee_only_reader_reads_only_their_own_approved_payslips(self):
        employee_only = self.payroll_user('fence_employee_only', ['hr.employees.read'])
        employee = self.make_employee('Fence employee only', user=employee_only)
        own = self._slip(employee)
        own.compute_sheet()
        own.state = 'done'
        draft = self._slip(employee)
        colleague = self._slip(self.make_employee('Fence colleague'))
        colleague.compute_sheet()
        colleague.state = 'done'
        Payslip = self.env['hr.payslip'].with_user(employee_only)
        self.assertEqual(Payslip.search([]), own)
        self.assertEqual(self.env['hr.payslip.line'].with_user(employee_only).search([]).slip_id, own)
        for slip in (draft, colleague):
            with self.assertRaises(AccessError):
                Payslip.browse(slip.id).read(['name'])
