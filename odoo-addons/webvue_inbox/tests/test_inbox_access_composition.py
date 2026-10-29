# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import TransactionCase, tagged

from odoo.addons.webvue_inbox.models.access_service import (
    ASSIGN,
    EXPORT,
    MANAGE_CHANNELS,
    MANAGE_SETTINGS,
    PERMISSIONS,
    READ,
    REPLY,
    REPORTS_READ,
)


@tagged('webvue', 'webvue_access')
class TestInboxAccessComposition(TransactionCase):
    """webvue_inbox owns its capabilities, groups and roles (spec R2) and runs at install."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.service = cls.env['webvue.access.service']
        cls.Permission = cls.env['webvue.access.permission']

    def _keys(self, role_xmlid):
        return set(self.env.ref(role_xmlid).permission_ids.mapped('key'))

    def test_owns_its_capabilities_and_their_groups(self):
        catalog = self.service._webvue_capability_map()
        self.assertEqual({k for k, item in catalog.items() if item['owner'] == 'webvue_inbox'}, set(PERMISSIONS))
        permissions = self.Permission.search([('key', 'in', sorted(PERMISSIONS))])
        self.assertEqual(len(permissions), len(PERMISSIONS))
        for permission in permissions:
            self.assertTrue(permission.group_xmlid.startswith('webvue_inbox.group_cap_inbox_'), permission.key)
            self.assertTrue(self.env.ref(permission.group_xmlid, raise_if_not_found=False), permission.key)

    def test_sensitive_capabilities(self):
        sensitive = set(self.Permission.search([('key', 'in', sorted(PERMISSIONS)), ('sensitive', '=', True)]).mapped('key'))
        self.assertEqual(sensitive, {EXPORT, MANAGE_CHANNELS, MANAGE_SETTINGS, REPORTS_READ})

    def test_roles_hold_the_designed_grants(self):
        self.assertEqual(self._keys('webvue_inbox.role_inbox_agent'), {READ, REPLY})
        self.assertEqual(self._keys('webvue_inbox.role_inbox_supervisor'), {READ, REPLY, ASSIGN, EXPORT, REPORTS_READ})
        self.assertEqual(self._keys('webvue_inbox.role_inbox_manager'), set(PERMISSIONS))
        self.assertTrue(self._keys('webvue_core.role_vendor_support') >= PERMISSIONS)

    def test_the_employee_role_gets_nothing(self):
        self.assertFalse(self._keys('webvue_core.role_employee') & PERMISSIONS)

    def test_dependencies_require_read(self):
        for key in (REPLY, ASSIGN, EXPORT):
            permission = self.Permission.search([('key', '=', key)])
            self.assertEqual(permission.dependency_ids.mapped('key'), [READ], key)

    def test_hook_identity_is_inactive_and_only_in_its_group(self):
        hook = self.env.ref('webvue_inbox.user_inbox_hook')
        self.assertFalse(hook.active)
        self.assertEqual(hook.group_ids, self.env.ref('webvue_inbox.group_inbox_hook'))
        self.assertFalse(self.env['res.users'].search_count([('id', '=', hook.id)]))
