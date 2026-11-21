# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import TransactionCase, new_test_user, tagged

from odoo.addons.liwan_integrations_sa.models.access_service import (
    LOG_PERMISSIONS,
    PERMISSIONS,
)


@tagged('post_install', '-at_install', 'liwan', 'liwan_access')
class TestIntegrationsAccessComposition(TransactionCase):
    """liwan_integrations_sa owns its capabilities and groups (spec R2) and is checked once every module is loaded."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.service = cls.env['liwan.access.service']
        cls.Permission = cls.env['liwan.access.permission']

    def test_owns_its_capabilities_and_their_groups(self):
        catalog = self.service._liwan_capability_map()
        self.assertEqual(
            {key for key, item in catalog.items() if item['owner'] == 'liwan_integrations_sa'},
            set(PERMISSIONS | LOG_PERMISSIONS),
        )
        permissions = self.Permission.search([('key', 'in', sorted(PERMISSIONS | LOG_PERMISSIONS))])
        self.assertEqual(len(permissions), len(PERMISSIONS | LOG_PERMISSIONS))
        for permission in permissions:
            self.assertTrue(
                permission.group_xmlid.startswith('liwan_integrations_sa.group_cap_integrations_'), permission.key,
            )
            self.assertTrue(self.env.ref(permission.group_xmlid, raise_if_not_found=False), permission.key)

    def test_system_admin_role_holds_both_and_employee_none(self):
        admin_keys = set(self.env.ref('liwan_core.role_system_admin').permission_ids.mapped('key'))
        self.assertTrue(admin_keys >= PERMISSIONS)
        employee_keys = set(self.env.ref('liwan_core.role_employee').permission_ids.mapped('key'))
        self.assertFalse(employee_keys & PERMISSIONS)

    def test_manage_depends_on_read(self):
        manage = self.Permission.search([('key', '=', 'integrations.manage')])
        self.assertEqual(manage.dependency_ids.mapped('key'), ['integrations.read'])

    def test_legacy_access_admin_group_still_grants_capabilities(self):
        admin = new_test_user(self.env, login='integrations_comp_admin', groups='liwan_core.group_access_admin')
        employee = new_test_user(self.env, login='integrations_comp_employee', groups='liwan_core.group_employee')
        self.assertTrue(self.service._liwan_capability_keys(admin) >= PERMISSIONS)
        self.assertFalse(self.service._liwan_capability_keys(employee) & PERMISSIONS)

    def test_the_log_capability_is_granted_by_no_built_in_role_and_no_legacy_group(self):
        """D9 (owner decision 2026-11-20): the message log is opened only by a role an administrator assigns."""
        self.assertEqual(LOG_PERMISSIONS, {'integrations.log.read'})
        roles = self.env['liwan.access.role'].with_context(active_test=False).search([('type', '!=', 'custom')])
        self.assertTrue(roles)
        for role in roles:
            self.assertNotIn('integrations.log.read', role.permission_ids.mapped('key'), role.key)
        for role, keys in self.service._liwan_builtin_role_grants().items():
            self.assertFalse(keys & LOG_PERMISSIONS, role)
        admin = new_test_user(self.env, login='integrations_log_admin', groups='liwan_core.group_access_admin')
        self.assertFalse(self.service._liwan_capability_keys(admin) & LOG_PERMISSIONS)
        log = self.Permission.search([('key', '=', 'integrations.log.read')])
        self.assertFalse(log.dependency_ids)
        self.assertFalse(self.Permission.search([('dependency_ids', 'in', log.ids)]))
        self.assertTrue(log.sensitive)
