# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command
from odoo.tests import TransactionCase, new_test_user, tagged

ENGINE_GROUPS = ('payroll.group_payroll_user', 'payroll.group_payroll_manager')
SYSTEM_GROUP = 'base.group_system'


@tagged('liwan', 'liwan_access')
class TestPayrollEngine(TransactionCase):
    def _engine_users(self):
        """The users explicitly in an OCA payroll group (Odoo 19 spells the field ``group_ids``)."""
        groups = self.env['res.groups'].browse([self.env.ref(xml_id).id for xml_id in ENGINE_GROUPS])
        return self.env['res.users'].search([('group_ids', 'in', groups.ids)])

    def _users_without_system(self, users):
        """The given users that do not hold ``base.group_system``, directly or through an implied group."""
        system = self.env.ref(SYSTEM_GROUP)
        return users.filtered(lambda user: system not in user.all_group_ids)

    def test_payroll_engine_is_installed(self):
        module = self.env['ir.module.module'].search([('name', '=', 'payroll')])
        self.assertEqual(module.state, 'installed')
        self.assertIn('hr.payslip', self.env)

    def test_no_liwan_group_implies_a_payroll_group(self):
        engine_groups = self.env['res.groups']
        for xml_id in ENGINE_GROUPS:
            engine_groups |= self.env.ref(xml_id)
        liwan_data = self.env['ir.model.data'].search([
            ('model', '=', 'res.groups'), ('module', '=like', 'liwan_%')])
        liwan_groups = self.env['res.groups'].browse(liwan_data.mapped('res_id'))
        self.assertTrue(liwan_groups)
        for group in liwan_groups:
            self.assertFalse(
                group.all_implied_ids & engine_groups,
                f'{group.full_name} implies an OCA payroll group',
            )

    def test_payroll_groups_hold_only_system_users(self):
        users = self._engine_users()
        self.assertTrue(users, 'the OCA payroll groups must hold the default administrator users')
        intruders = self._users_without_system(users)
        self.assertFalse(
            intruders,
            f'{", ".join(intruders.mapped("login"))} hold an OCA payroll group without {SYSTEM_GROUP}',
        )

    def test_payroll_group_membership_check_flags_a_plain_user(self):
        user = new_test_user(self.env, login='payroll_intruder')
        user.write({'group_ids': [Command.link(self.env.ref('payroll.group_payroll_user').id)]})
        self.assertIn(user, self._users_without_system(self._engine_users()))
