# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import TransactionCase, new_test_user, tagged

from odoo.addons.liwan_inbox.models.access_service import (
    ASSIGN,
    CAMPAIGNS,
    EXPORT,
    MANAGE_CHANNELS,
    MANAGE_SETTINGS,
    PERMISSIONS,
    READ,
    REPLY,
    REPORTS_READ,
    VENDOR_SUPPORT_PERMISSIONS,
)


@tagged('liwan', 'liwan_access')
class TestInboxAccessComposition(TransactionCase):
    """liwan_inbox owns its capabilities, groups and roles (spec R2) and runs at install."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.service = cls.env['liwan.access.service']
        cls.Permission = cls.env['liwan.access.permission']

    def _keys(self, role_xmlid):
        """The role's grants of this addon; the bridge liwan_inbox_payments (auto_install) adds its own to the same roles."""
        return set(self.env.ref(role_xmlid).permission_ids.mapped('key')) & PERMISSIONS

    def test_owns_its_capabilities_and_their_groups(self):
        catalog = self.service._liwan_capability_map()
        self.assertEqual({k for k, item in catalog.items() if item['owner'] == 'liwan_inbox'}, set(PERMISSIONS))
        permissions = self.Permission.search([('key', 'in', sorted(PERMISSIONS))])
        self.assertEqual(len(permissions), len(PERMISSIONS))
        for permission in permissions:
            self.assertTrue(permission.group_xmlid.startswith('liwan_inbox.group_cap_inbox_'), permission.key)
            self.assertTrue(self.env.ref(permission.group_xmlid, raise_if_not_found=False), permission.key)

    def test_sensitive_capabilities(self):
        sensitive = set(self.Permission.search([('key', 'in', sorted(PERMISSIONS)), ('sensitive', '=', True)]).mapped('key'))
        self.assertEqual(sensitive, {EXPORT, MANAGE_CHANNELS, MANAGE_SETTINGS, REPORTS_READ, CAMPAIGNS})

    def test_roles_hold_the_designed_grants(self):
        self.assertEqual(self._keys('liwan_inbox.role_inbox_agent'), {READ, REPLY})
        self.assertEqual(self._keys('liwan_inbox.role_inbox_supervisor'), {READ, REPLY, ASSIGN, EXPORT, REPORTS_READ})
        self.assertEqual(self._keys('liwan_inbox.role_inbox_manager'), set(PERMISSIONS))
        self.assertEqual(self._keys('liwan_core.role_vendor_support'), VENDOR_SUPPORT_PERMISSIONS)

    def test_vendor_support_runs_channels_and_settings_and_reads_no_conversation(self):
        vendor = new_test_user(self.env, login='inbox_vendor', groups='liwan_core.group_vendor_support')
        self.assertEqual(self.service._liwan_capability_keys(vendor) & PERMISSIONS, VENDOR_SUPPORT_PERMISSIONS)
        for group in ('group_cap_inbox_channels_manage', 'group_cap_inbox_settings_manage'):
            self.assertTrue(vendor.has_group(f'liwan_inbox.{group}'), group)
        for group in ('group_inbox_manager', 'group_cap_inbox_conversations_read', 'group_cap_inbox_conversations_reply'):
            self.assertFalse(vendor.has_group(f'liwan_inbox.{group}'), group)
        self.assertFalse(self.env['liwan.inbox.conversation'].with_user(vendor).has_access('read'))

    def test_the_employee_role_gets_nothing(self):
        self.assertFalse(self._keys('liwan_core.role_employee'))

    def test_dependencies_require_read(self):
        for key in (REPLY, ASSIGN, EXPORT):
            permission = self.Permission.search([('key', '=', key)])
            self.assertEqual(permission.dependency_ids.mapped('key'), [READ], key)

    def test_hook_identity_is_inactive_and_only_in_its_group(self):
        hook = self.env.ref('liwan_inbox.user_inbox_hook')
        self.assertFalse(hook.active)
        self.assertEqual(hook.group_ids, self.env.ref('liwan_inbox.group_inbox_hook'))
        self.assertFalse(self.env['res.users'].search_count([('id', '=', hook.id)]))
