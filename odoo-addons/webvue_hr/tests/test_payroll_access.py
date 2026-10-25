# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import TransactionCase, tagged

from odoo.addons.webvue_hr.models.access_service import (
    HR_PERMISSIONS,
    PAYROLL_PERMISSIONS,
)

PAYROLL_GROUPS = (
    'webvue_hr.group_cap_hr_payroll_read',
    'webvue_hr.group_cap_hr_payroll_manage',
    'webvue_hr.group_cap_hr_payroll_approve',
    'webvue_hr.group_cap_hr_payroll_config',
    'webvue_hr.group_cap_hr_payroll_audit_read',
)
FORBIDDEN_IMPLIED = (
    'hr.group_hr_user',
    'hr.group_hr_manager',
    'payroll.group_payroll_user',
    'payroll.group_payroll_manager',
    'webvue_hr.group_cap_hr_employees_manage',
)


@tagged('webvue', 'webvue_access')
class TestPayrollAccess(TransactionCase):
    def setUp(self):
        super().setUp()
        self.service = self.env['webvue.access.service']

    def _closure(self, key):
        dependencies = self.service._webvue_permission_dependencies()
        seen, pending = set(), [key]
        while pending:
            for required in dependencies.get(pending.pop(), ()):
                if required not in seen:
                    seen.add(required)
                    pending.append(required)
        return seen

    def _role_grants(self, xmlid):
        return self.service._webvue_builtin_role_grants()[xmlid]

    def test_payroll_keys_are_owned_by_webvue_hr_and_sensitive(self):
        catalog = self.service._webvue_capability_map()
        for key in PAYROLL_PERMISSIONS:
            self.assertEqual(catalog[key]['owner'], 'webvue_hr', key)
        permissions = self.env['webvue.access.permission'].search(
            [('key', 'in', sorted(PAYROLL_PERMISSIONS))])
        self.assertEqual(set(permissions.mapped('key')), PAYROLL_PERMISSIONS)
        for permission in permissions:
            self.assertTrue(permission.sensitive, permission.key)

    def test_no_hr_capability_implies_payroll(self):
        for key in HR_PERMISSIONS:
            self.assertFalse(self._closure(key) & PAYROLL_PERMISSIONS, key)
        for xmlid in (
            'webvue_hr.role_hr_manager',
            'webvue_core.role_vendor_support',
            'webvue_core.role_employee',
        ):
            self.assertFalse(self._role_grants(xmlid) & PAYROLL_PERMISSIONS, xmlid)
        manager = self.env.ref('webvue_hr.group_hr_manager')
        for xmlid in PAYROLL_GROUPS:
            self.assertNotIn(self.env.ref(xmlid), manager.all_implied_ids, xmlid)

    def test_payroll_implies_no_broader_hr_write(self):
        allowed = PAYROLL_PERMISSIONS | {'hr.employees.read'}
        for key in PAYROLL_PERMISSIONS:
            self.assertLessEqual(self._closure(key), allowed, key)
        forbidden = self.env['res.groups']
        for xmlid in FORBIDDEN_IMPLIED:
            forbidden |= self.env.ref(xmlid)
        for xmlid in PAYROLL_GROUPS:
            group = self.env.ref(xmlid)
            self.assertFalse(group.all_implied_ids & forbidden, xmlid)

    def test_payroll_role_grants_exactly_the_payroll_keys(self):
        role = self.env.ref('webvue_hr.role_payroll_manager')
        self.assertEqual(role.key, 'payroll_manager')
        self.assertEqual(set(role.permission_ids.mapped('key')), PAYROLL_PERMISSIONS)
        self.assertEqual(self._role_grants('webvue_hr.role_payroll_manager'), PAYROLL_PERMISSIONS)

    def test_audit_read_is_a_separate_payroll_key_only_the_payroll_role_holds(self):
        self.assertEqual(self._closure('hr.payroll.audit.read'), {'hr.payroll.read', 'hr.employees.read'})
        for key in PAYROLL_PERMISSIONS - {'hr.payroll.audit.read'}:
            self.assertNotIn('hr.payroll.audit.read', self._closure(key), key)
        hr_manager = self.env.ref('webvue_hr.role_hr_manager')
        self.assertNotIn('hr.payroll.audit.read', hr_manager.permission_ids.mapped('key'))
        self.assertNotIn('hr.payroll.audit.read', self._role_grants('webvue_hr.role_hr_manager'))
        self.assertIn('hr.payroll.audit.read', self.env.ref('webvue_hr.role_payroll_manager').permission_ids.mapped('key'))
        group = self.env.ref('webvue_hr.group_cap_hr_payroll_audit_read')
        self.assertNotIn(group, self.env.ref('webvue_hr.group_hr_manager').all_implied_ids)
        self.assertNotIn(group, self.env.ref('hr.group_hr_manager').all_implied_ids)

    def test_hr_payroll_feature_is_registered(self):
        definitions = {
            definition['key']: definition
            for definition in self.env['webvue.feature.registry']._webvue_feature_definitions()
        }
        self.assertEqual(definitions['hr.payroll']['owner'], 'webvue_hr')
        self.assertEqual(definitions['hr.payroll']['type'], 'boolean')
