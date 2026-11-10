# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .payroll_common import PayrollCase
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule


@tagged('post_install', '-at_install', 'liwan')
class TestEmployeeLifecycleReadOnly(PayrollCase):
    """Archive and unarchive write through SQL, so they must meet the same write fence as the ORM."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.hr = cls.payroll_user(cls, 'life_hr', ['hr.employees.read', 'hr.employees.archive'])
        cls.service = cls.env['liwan.entitlement.service'].sudo()

    def _assert_fenced(self, employee, code):
        actor = employee.with_user(self.hr)
        for operation in ('_liwan_archive', '_liwan_unarchive'):
            with self.subTest(operation=operation), self.assertRaises(LiwanAccessRule) as caught, self.cr.savepoint():
                getattr(actor, operation)()
            self.assertEqual(caught.exception.code, code)

    def test_a_read_only_account_cannot_archive_or_unarchive(self):
        employee = self.make_employee('Fenced by account')
        self.service._liwan_apply_flags(self.hr, {'liwan_read_only': True})
        self._assert_fenced(employee, 'user_read_only')
        self.assertTrue(employee.active)

    def test_a_read_only_branch_cannot_archive_or_unarchive(self):
        employee = self.make_employee('Fenced by branch')
        self.env['liwan.tenant.branch'].create({
            'branch_uid': 'life-ro-branch', 'company_id': employee.company_id.id,
            'operation_id': 'op-life', 'read_only': True,
        })
        self._assert_fenced(employee, 'branch_read_only')
        self.assertTrue(employee.active)

    def test_a_writable_account_still_unarchives(self):
        employee = self.make_employee('Unfenced')
        employee.write({'active': False})
        employee.with_user(self.hr)._liwan_unarchive()
        self.assertTrue(employee.active)
        self.assertTrue(employee.resource_id.active)
