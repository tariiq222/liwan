# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date

from odoo.exceptions import AccessError
from odoo.tests import new_test_user, tagged

from .payroll_common import PayrollCase

SNAPSHOT_FIELDS = ('iban', 'bank_code', 'identification')
PAYMENT = 'webvue.hr.payslip.payment'
EMPLOYEES_READ_SCOPE = ((('hr.employees.read',), 'all'),)


@tagged('post_install', '-at_install', 'webvue')
class TestPayrollCompanyFence(PayrollCase):
    """Payroll groups are global, payroll grants are per company: a payslip answers per owning company.

    ``mixed`` reads payroll in A and only employees in B (a branch of A) and C (an unrelated company). In B and C
    the employee read ACL opens hr.payslip and the global payroll group opens the (1, '=', 1) payroll rules, so
    without the fence they would read every payslip of B and C, with its lines. The payment snapshot is a model of
    its own (``webvue.hr.payslip.payment``) that only the payroll ACL opens, projected per company: even their own
    approved payslip in B shows its summary and lines, never where it is paid.
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
        slip.state = 'done'
        cls.env[PAYMENT].create({'payslip_id': slip.id, **{field: f'{name} {field}' for field in SNAPSHOT_FIELDS}})
        return slip

    def _as_mixed(self, *companies, scope=None):
        context = {'allowed_company_ids': [company.id for company in companies]}
        if scope:
            context['webvue_capability_scope'] = scope
        return self.env(user=self.mixed, context=context)

    def _visible(self, env):
        return env['hr.payslip'].search([]), env['hr.payslip.line'].search([]).slip_id

    def _payment(self, slip):
        return self.env[PAYMENT].search([('payslip_id', '=', slip.id)])

    def _visible_payments(self, env):
        return env[PAYMENT].search([]).payslip_id

    def _assign_payroll(self, company):
        return self.env['webvue.access.assignment'].create({
            'user_id': self.mixed.id, 'role_id': self.payroll_role.id, 'company_id': company.id,
        })

    def test_the_payroll_reader_reads_every_payslip_of_its_payroll_company(self):
        slips, line_slips = self._visible(self._as_mixed(self.company_a))
        self.assertEqual(slips, self.slip_a)
        self.assertEqual(line_slips, self.slip_a)
        env = self._as_mixed(self.company_a)
        self.assertEqual(self._visible_payments(env), self.slip_a)
        values = env[PAYMENT].browse(self._payment(self.slip_a).id).read(list(SNAPSHOT_FIELDS))[0]
        self.assertEqual(values['iban'], 'Fence worker A iban')

    def test_a_branch_with_only_employee_read_shows_only_the_own_approved_payslip(self):
        env = self._as_mixed(self.company_a, self.company_b, scope=EMPLOYEES_READ_SCOPE)
        slips, line_slips = self._visible(env)
        self.assertEqual(slips, self.slip_a | self.own_b)
        self.assertEqual(line_slips, self.slip_a | self.own_b)
        with self.assertRaises(AccessError):
            env['hr.payslip'].browse(self.slip_b.id).read(['name'])
        self.assertEqual(self._visible_payments(env), self.slip_a)
        for slip in (self.slip_b, self.own_b):
            with self.assertRaises(AccessError):
                env[PAYMENT].browse(self._payment(slip).id).read(list(SNAPSHOT_FIELDS))
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
                env['hr.payslip'].browse(slip.id).read(['name'])
        with self.assertRaises(AccessError):
            env['hr.payslip.line'].browse(self.slip_b.line_ids.ids).read(['amount', 'total'])
        env_c = self._as_mixed(self.company_c)
        self.assertFalse(env_c['hr.payslip'].search([]))
        self.assertFalse(env_c[PAYMENT].search([]))
        with self.assertRaises(AccessError):
            env_c[PAYMENT].browse(self._payment(self.slip_c).id).read(list(SNAPSHOT_FIELDS))

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
        self.assertEqual(self._visible_payments(env), self.slip_b | self.own_b)
        # The global payroll group stays (A still grants it): only the per-company fence closes B again.
        assignment.unlink()
        self.assertTrue(self.mixed.has_group('webvue_hr.group_cap_hr_payroll_read'))
        self.assertEqual(self._visible(env)[0], self.own_b)
        self.assertFalse(self._visible_payments(env))
        with self.assertRaises(AccessError):
            env[PAYMENT].browse(self._payment(self.slip_b).id).read(list(SNAPSHOT_FIELDS))
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
        self.assertTrue(env[PAYMENT].browse(self._payment(self.slip_b).id).read(list(SNAPSHOT_FIELDS)))
        inheritance.inherit = False
        self.assertEqual(self._visible_payments(env), self.slip_a)
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

    # --- the payment snapshot answers per payslip company, never the global payroll group -----------------

    def _snapshot_reads(self, env):
        """Every way the mixed actor could read ``own_b``'s snapshot; each raises or answers nothing."""
        Payment = env[PAYMENT]
        own = Payment.browse(self._payment(self.own_b).id)
        with self.assertRaises(AccessError):
            own.read(list(SNAPSHOT_FIELDS))
        self.assertNotIn(self.own_b, Payment.search([('iban', '!=', False)]).payslip_id)
        groups = Payment._read_group([], ['iban'], ['__count'])
        self.assertNotIn('Fence mixed in B iban', [iban for iban, _count in groups])
        with self.assertRaises(AccessError):
            own.export_data(['iban'])

    def test_a_payroll_reader_elsewhere_never_reads_the_snapshot_of_their_own_branch_payslip(self):
        """H1: payroll.read in A, employees.read in B; the own approved B payslip shows no payment data."""
        self.mixed.group_ids = [(4, self.env.ref('base.group_allow_export').id)]
        self.assertTrue(self.mixed.has_group('webvue_hr.group_cap_hr_payroll_read'))
        for env in (self._as_mixed(self.company_b, self.company_a),
                    self._as_mixed(self.company_a, self.company_b, scope=EMPLOYEES_READ_SCOPE)):
            self._snapshot_reads(env)
            # The summary and lines of the own approved payslip stay readable, with no snapshot key in them.
            summary = env['hr.payslip'].browse(self.own_b.id).read(['name', 'state'])[0]
            self.assertEqual((summary['name'], summary['state']), (self.own_b.name, 'done'))
            self.assertTrue(env['hr.payslip.line'].search([('slip_id', '=', self.own_b.id)]))
            self.assertFalse(set(SNAPSHOT_FIELDS) & set(env['hr.payslip'].fields_get()))
        # In A, where payroll is granted, the snapshot of the company's own payslip still reads.
        env_a = self._as_mixed(self.company_a)
        self.assertEqual(env_a[PAYMENT].browse(self._payment(self.slip_a).id).iban, 'Fence worker A iban')

    def test_a_branch_payroll_grant_opens_the_own_snapshot_at_once_and_its_revocation_closes_it(self):
        self.mixed.group_ids = [(4, self.env.ref('base.group_allow_export').id)]
        env = self._as_mixed(self.company_b, self.company_a)
        self._snapshot_reads(env)
        assignment = self._assign_payroll(self.company_b)
        own = env[PAYMENT].browse(self._payment(self.own_b).id)
        self.assertEqual(own.read(['iban'])[0]['iban'], 'Fence mixed in B iban')
        self.assertIn(self.own_b, env[PAYMENT].search([]).payslip_id)
        assignment.unlink()
        # Same warm environment, global payroll group still held through A: B's snapshot is closed again.
        self.assertTrue(self.mixed.has_group('webvue_hr.group_cap_hr_payroll_read'))
        self._snapshot_reads(env)

    def test_an_employee_only_reader_has_no_access_to_any_payment_snapshot(self):
        employee_only = self.payroll_user('fence_snapshot_employee', ['hr.employees.read'])
        employee = self.make_employee('Fence snapshot employee', user=employee_only)
        own = self._slip(employee)
        own.compute_sheet()
        own.state = 'done'
        payment = self.env[PAYMENT].create({'payslip_id': own.id, 'iban': 'SA00 own'})
        Payment = self.env[PAYMENT].with_user(employee_only)
        self.assertEqual(self.env['hr.payslip'].with_user(employee_only).search([]), own)
        with self.assertRaises(AccessError):
            Payment.search([])
        with self.assertRaises(AccessError):
            Payment.browse(payment.id).read(['iban'])

    def test_no_payroll_capability_rewrites_a_payment_snapshot(self):
        """Approval creates the row (the approver's create right); nobody writes or deletes it afterwards."""
        approver = self.payroll_user('fence_snapshot_approver', ['hr.employees.read', 'hr.payroll.read', 'hr.payroll.approve'])
        manager = self.payroll_user('fence_snapshot_manager', ['hr.employees.read', 'hr.payroll.read', 'hr.payroll.manage'])
        slip = self._slip(self.make_employee('Fence snapshot target'))
        payment = self.env[PAYMENT].with_user(approver).create({'payslip_id': slip.id, 'iban': 'SA00 fixed'})
        for user in (approver, manager):
            row = self.env[PAYMENT].with_user(user).browse(payment.id)
            self.assertEqual(row.iban, 'SA00 fixed')
            with self.assertRaises(AccessError):
                row.write({'iban': 'SA00 forged'})
            with self.assertRaises(AccessError):
                row.unlink()
        with self.assertRaises(AccessError):
            self.env[PAYMENT].with_user(manager).create({'payslip_id': self._slip(slip.employee_id).id})
