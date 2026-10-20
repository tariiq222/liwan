# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import TransactionCase, tagged

ENGINE_GROUPS = ('payroll.group_payroll_user', 'payroll.group_payroll_manager')


@tagged('webvue', 'webvue_access')
class TestPayrollEngine(TransactionCase):
    def test_payroll_engine_is_installed(self):
        module = self.env['ir.module.module'].search([('name', '=', 'payroll')])
        self.assertEqual(module.state, 'installed')
        self.assertIn('hr.payslip', self.env)

    def test_no_webvue_group_implies_a_payroll_group(self):
        engine_groups = self.env['res.groups']
        for xml_id in ENGINE_GROUPS:
            engine_groups |= self.env.ref(xml_id)
        webvue_data = self.env['ir.model.data'].search([
            ('model', '=', 'res.groups'), ('module', '=like', 'webvue_%')])
        webvue_groups = self.env['res.groups'].browse(webvue_data.mapped('res_id'))
        self.assertTrue(webvue_groups)
        for group in webvue_groups:
            self.assertFalse(
                group.all_implied_ids & engine_groups,
                f'{group.full_name} implies an OCA payroll group',
            )

    def test_payroll_groups_hold_only_system_users(self):
        group = self.env.ref('payroll.group_payroll_user')
        system = self.env.ref('base.group_system')
        for user in group.all_user_ids if 'all_user_ids' in group._fields else group.user_ids:
            self.assertIn(system, user.group_ids, f'{user.login} holds a payroll group')
