# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.fields import Command
from odoo.tests import TransactionCase, new_test_user, tagged

from odoo.addons.webvue_meetings.models.meeting_access_service import (
    EMPLOYEE_MEETINGS_PERMISSIONS,
    MEETINGS_PERMISSIONS,
)

RULES = (
    'rule_meeting_capability_scope', 'rule_resolution_capability_scope',
    'rule_meeting_series_capability_scope', 'rule_meeting_event_current_company',
    'rule_meeting_minutes_version_current_company',
)


@tagged('webvue', 'webvue_access')
class TestMeetingsAccessComposition(TransactionCase):
    """webvue_meetings owns the three meetings.* capabilities, their groups and
    record rules (spec R2); it runs at install, so it also proves the hooks
    work without webvue_pmo or webvue_hr."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.service = cls.env['webvue.access.service']
        cls.Permission = cls.env['webvue.access.permission']
        cls.company = cls.env.company

    def _keys(self, role_xmlid):
        return set(self.env.ref(role_xmlid).permission_ids.mapped('key'))

    def test_meetings_own_three_capabilities_and_their_groups(self):
        catalog = self.service._webvue_capability_map()
        self.assertEqual({key for key, item in catalog.items() if item['owner'] == 'webvue_meetings'}, set(MEETINGS_PERMISSIONS))
        permissions = self.Permission.search([('key', 'in', sorted(MEETINGS_PERMISSIONS))])
        self.assertEqual(len(permissions), 3)
        xmlids = permissions.get_external_id()
        for permission in permissions:
            self.assertTrue(xmlids[permission.id].startswith('webvue_meetings.permission_'), permission.key)
            self.assertTrue(permission.group_xmlid.startswith('webvue_meetings.group_cap_'), permission.key)
            self.assertTrue(self.env.ref(permission.group_xmlid, raise_if_not_found=False), permission.key)
        self.assertEqual(
            {permission.key: set(permission.dependency_ids.mapped('key')) for permission in permissions if permission.dependency_ids},
            {'meetings.create': {'meetings.read'}, 'meetings.manage': {'meetings.read'}},
        )

    def test_core_roles_get_their_meeting_grants(self):
        self.assertEqual(self._keys('webvue_core.role_employee') & MEETINGS_PERMISSIONS, set(EMPLOYEE_MEETINGS_PERMISSIONS))
        self.assertIn('meetings.read', self._keys('webvue_core.role_employee'))
        self.assertNotIn('meetings.create', self._keys('webvue_core.role_employee'))
        self.assertTrue(self._keys('webvue_core.role_system_admin') >= MEETINGS_PERMISSIONS)
        self.assertTrue(self._keys('webvue_core.role_vendor_support') >= MEETINGS_PERMISSIONS)

    def test_core_groups_reach_meetings_and_the_rules_are_active(self):
        manage = self.env.ref('webvue_meetings.group_cap_meetings_manage')
        self.assertIn(manage, self.env.ref('webvue_core.group_access_admin').all_implied_ids)
        self.assertIn(manage, self.env.ref('webvue_core.group_vendor_support').all_implied_ids)
        self.assertIn(
            self.env.ref('cyan_meeting_minutes.group_meeting_user'),
            self.env.ref('webvue_meetings.group_cap_meetings_read').all_implied_ids,
        )
        for name in RULES:
            self.assertTrue(self.env.ref(f'webvue_meetings.{name}').active, name)

    def test_meeting_grants_are_repaired_additively_and_idempotently(self):
        roles = {key: self.env.ref(f'webvue_core.role_{key}') for key in ('employee', 'system_admin', 'vendor_support')}
        expected = {
            'employee': {'meetings.read'},
            'system_admin': set(MEETINGS_PERMISSIONS),
            'vendor_support': set(MEETINGS_PERMISSIONS),
        }
        meetings = self.Permission.search([('key', 'in', sorted(MEETINGS_PERMISSIONS))])
        for role in roles.values():
            role.write({'permission_ids': [Command.unlink(permission.id) for permission in meetings]})
        other_before = {key: set(role.permission_ids.mapped('key')) for key, role in roles.items()}
        custom = self.env['webvue.access.role'].create({
            'name_ar': 'دور اختبار الترحيل', 'name_en': 'Migration test role', 'type': 'custom',
            'company_id': self.company.id,
            'permission_ids': [Command.link(self.env.ref('webvue_meetings.permission_meetings_read').id)],
        })
        custom_keys, custom_version = set(custom.permission_ids.mapped('key')), custom.version

        self.assertTrue(self.service._webvue_repair_builtin_role_grants())
        for key, role in roles.items():
            keys = set(role.permission_ids.mapped('key'))
            self.assertEqual(keys & MEETINGS_PERMISSIONS, expected[key], key)
            self.assertEqual(keys - MEETINGS_PERMISSIONS, other_before[key], key)
        self.assertEqual(set(custom.permission_ids.mapped('key')), custom_keys)
        self.assertEqual(custom.version, custom_version)

        versions = {key: role.version for key, role in roles.items()}
        self.assertTrue(self.service._webvue_repair_builtin_role_grants())
        self.assertEqual({key: role.version for key, role in roles.items()}, versions)

    def test_legacy_groups_still_grant_meeting_capabilities(self):
        access_admin = new_test_user(self.env, login='meet_comp_access_admin', groups='webvue_core.group_access_admin')
        employee = new_test_user(self.env, login='meet_comp_employee', groups='webvue_core.group_employee')
        self.assertTrue(self.service._webvue_capability_keys(access_admin) >= MEETINGS_PERMISSIONS)
        self.assertIn('meetings.read', self.service._webvue_capability_keys(employee))
        self.assertNotIn('meetings.create', self.service._webvue_capability_keys(employee))
