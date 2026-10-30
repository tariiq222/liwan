# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import TransactionCase, tagged


@tagged('post_install', '-at_install')
class TestPayrollFinanceRole(TransactionCase):
    """The built-in payroll finance manager posts and pays payroll and holds nothing wider (owner decision 2026-10-29)."""

    def test_role_posts_and_pays_payroll_only(self):
        role = self.env.ref('liwan_hr_finance.role_payroll_finance_manager')
        self.assertEqual((role.key, role.type, role.protected), ('payroll_finance_manager', 'built_in', True))
        keys = set(role.permission_ids.mapped('key'))
        self.assertLessEqual(
            {
                'hr.payroll.read', 'hr.payroll.finance.manage', 'finance.entries.post', 'finance.payments.manage',
                'finance.journals.read',
            }, keys,
        )
        self.assertFalse(keys & {
            'hr.payroll.manage', 'hr.payroll.approve', 'hr.payroll.config', 'hr.payroll.audit.read',
            'finance.setup.manage', 'finance.closing.manage', 'finance.accounts.manage',
        })

    def test_role_grants_are_registered_for_repair(self):
        grants = self.env['liwan.access.service']._liwan_builtin_role_grants()
        self.assertIn('liwan_hr_finance.role_payroll_finance_manager', grants)
