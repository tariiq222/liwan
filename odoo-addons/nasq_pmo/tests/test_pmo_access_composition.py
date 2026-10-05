# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.fields import Command
from odoo.tests import TransactionCase, new_test_user, tagged

from odoo.addons.nasq_pmo.models.access_service import (
    EMPLOYEE_PMO_PERMISSIONS,
    MEETINGS_PERMISSIONS,
    PMO_PERMISSIONS,
)


@tagged('nasq', 'nasq_access')
class TestPmoAccessComposition(TransactionCase):
    """nasq_pmo owns the PMO and meeting capabilities (spec 3.2, ruling R-B); it runs
    at install, so it also proves the hooks work without nasq_hr."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.service = cls.env['nasq.access.service']
        cls.Permission = cls.env['nasq.access.permission']
        cls.company = cls.env.company
        cls.owner = new_test_user(cls.env, login='pmo_comp_owner', groups='nasq_core.group_employee')
        cls.other = new_test_user(cls.env, login='pmo_comp_other', groups='nasq_core.group_employee')
        cls.owned = cls.env['project.project'].create({
            'name': 'Composition owned', 'user_id': cls.owner.id, 'company_id': cls.company.id,
        })
        cls.foreign = cls.env['project.project'].create({
            'name': 'Composition foreign', 'user_id': cls.other.id, 'company_id': cls.company.id,
        })
        cls.owned_task = cls.env['project.task'].create({'name': 'Owned', 'project_id': cls.owned.id})
        cls.foreign_task = cls.env['project.task'].create({'name': 'Foreign', 'project_id': cls.foreign.id})

    def _keys(self, role_xmlid):
        return set(self.env.ref(role_xmlid).permission_ids.mapped('key'))

    def test_pmo_owns_eleven_capabilities_and_their_groups(self):
        owned = PMO_PERMISSIONS | MEETINGS_PERMISSIONS
        catalog = self.service._nasq_capability_map()
        self.assertEqual(len(owned), 11)
        self.assertEqual({key for key, item in catalog.items() if item['owner'] == 'nasq_pmo'}, set(owned))
        permissions = self.Permission.search([('key', 'in', sorted(owned))])
        self.assertEqual(len(permissions), 11)
        xmlids = permissions.get_external_id()
        for permission in permissions:
            self.assertTrue(xmlids[permission.id].startswith('nasq_pmo.permission_'), permission.key)
            self.assertTrue(permission.group_xmlid.startswith('nasq_pmo.group_cap_'), permission.key)
            self.assertTrue(self.env.ref(permission.group_xmlid, raise_if_not_found=False), permission.key)

    def test_pmo_manager_role_is_unique_and_core_roles_get_pmo_grants(self):
        role = self.env.ref('nasq_pmo.role_pmo_manager')
        self.assertEqual((role.key, role.type, role.protected), ('pmo_manager', 'built_in', True))
        self.assertEqual(self.env['nasq.access.role'].search_count([('key', '=', 'pmo_manager')]), 1)
        self.assertFalse(self.env.ref('nasq_core.role_pmo_manager', raise_if_not_found=False))
        self.assertFalse(self.env.ref('nasq_core.group_pmo_manager', raise_if_not_found=False))
        self.assertEqual(self._keys('nasq_pmo.role_pmo_manager'), set(PMO_PERMISSIONS))
        self.assertTrue(self._keys('nasq_core.role_employee') >= EMPLOYEE_PMO_PERMISSIONS)
        self.assertTrue(self._keys('nasq_core.role_system_admin') >= MEETINGS_PERMISSIONS)
        self.assertTrue(self._keys('nasq_core.role_vendor_support') >= PMO_PERMISSIONS | MEETINGS_PERMISSIONS)
        self.assertNotIn('meetings.create', self._keys('nasq_core.role_employee'))

    def test_pmo_links_reach_core_groups(self):
        self.assertIn(
            self.env.ref('project.group_project_user'),
            self.env.ref('nasq_core.group_employee').all_implied_ids,
        )
        meetings_manage = self.env.ref('nasq_pmo.group_cap_meetings_manage')
        self.assertIn(meetings_manage, self.env.ref('nasq_core.group_access_admin').all_implied_ids)
        vendor = self.env.ref('nasq_core.group_vendor_support')
        self.assertIn(self.env.ref('nasq_pmo.group_pmo_manager'), vendor.all_implied_ids)
        self.assertIn(meetings_manage, vendor.all_implied_ids)
        self.assertTrue(self.env.ref('nasq_pmo.rule_meeting_capability_scope').active)
        self.assertTrue(self.env.ref('nasq_pmo.rule_resolution_capability_scope').active)

    def test_meeting_grants_are_repaired_additively_and_idempotently(self):
        roles = {
            'employee': self.env.ref('nasq_core.role_employee'),
            'pmo_manager': self.env.ref('nasq_pmo.role_pmo_manager'),
            'system_admin': self.env.ref('nasq_core.role_system_admin'),
            'vendor_support': self.env.ref('nasq_core.role_vendor_support'),
        }
        expected = {
            'employee': {'meetings.read'},
            'pmo_manager': set(),
            'system_admin': set(MEETINGS_PERMISSIONS),
            'vendor_support': set(MEETINGS_PERMISSIONS),
        }
        meetings = self.Permission.search([('key', 'in', sorted(MEETINGS_PERMISSIONS))])
        for role in roles.values():
            role.write({'permission_ids': [Command.unlink(permission.id) for permission in meetings]})
        other_before = {key: set(role.permission_ids.mapped('key')) for key, role in roles.items()}
        custom = self.env['nasq.access.role'].create({
            'name_ar': 'دور اختبار الترحيل', 'name_en': 'Migration test role', 'type': 'custom',
            'company_id': self.company.id,
            'permission_ids': [Command.link(self.env.ref('nasq_pmo.permission_meetings_read').id)],
        })
        custom_keys, custom_version = set(custom.permission_ids.mapped('key')), custom.version

        self.assertTrue(self.service._nasq_repair_builtin_role_grants())
        for key, role in roles.items():
            keys = set(role.permission_ids.mapped('key'))
            self.assertEqual(keys & MEETINGS_PERMISSIONS, expected[key], key)
            self.assertEqual(keys - MEETINGS_PERMISSIONS, other_before[key], key)
        self.assertEqual(set(custom.permission_ids.mapped('key')), custom_keys)
        self.assertEqual(custom.version, custom_version)

        versions = {key: role.version for key, role in roles.items()}
        self.assertTrue(self.service._nasq_repair_builtin_role_grants())
        self.assertEqual({key: role.version for key, role in roles.items()}, versions)

    def test_project_owner_grant_needs_the_pmo_hook(self):
        held = self.service._nasq_capability_keys(self.owner)
        self.assertNotIn('pmo.projects.manage', held)
        self.assertNotIn('pmo.tasks.approve', held)
        for key in ('pmo.projects.manage', 'pmo.tasks.write', 'pmo.tasks.approve'):
            self.assertTrue(self.service._nasq_has_capability(self.owner, key, record=self.owned_task), key)
            self.assertTrue(self.service._nasq_has_capability(self.owner, key, record=self.owned), key)
        for key in ('pmo.projects.manage', 'pmo.tasks.approve'):
            self.assertFalse(self.service._nasq_has_capability(self.owner, key, record=self.foreign_task), key)
        self.assertFalse(self.service._nasq_has_capability(self.owner, 'pmo.settings.manage', record=self.owned))
        identity = self.service._nasq_identity(self.owner)
        self.assertIn('project_owner', {role['key'] for role in identity['roles']})
        self.assertTrue({'pmo.projects.manage', 'pmo.tasks.write', 'pmo.tasks.approve'} <= set(identity['capabilities']))

    def test_record_without_company_uses_its_project_company(self):
        company_b = self.env['res.company'].create({'name': 'Composition company B'})
        project_b = self.env['project.project'].create({
            'name': 'Composition B', 'company_id': company_b.id, 'user_id': self.owner.id,
        })
        milestone = self.env['project.milestone'].create({'name': 'B milestone', 'project_id': project_b.id})
        self.assertNotIn('company_id', milestone._fields)
        self.assertEqual(self.service._nasq_record_company(milestone), company_b)
        self.assertFalse(self.service._nasq_has_capability(self.owner, 'pmo.projects.manage', record=milestone))

    def test_legacy_pmo_groups_still_grant_pmo_and_meeting_capabilities(self):
        nasq_group = new_test_user(self.env, login='pmo_comp_nasq_group', groups='nasq_pmo.group_pmo_manager')
        odoo_group = new_test_user(
            self.env, login='pmo_comp_odoo_group', groups='base.group_user,project.group_project_manager',
        )
        access_admin = new_test_user(self.env, login='pmo_comp_access_admin', groups='nasq_core.group_access_admin')
        self.assertTrue(self.service._nasq_capability_keys(nasq_group) >= PMO_PERMISSIONS)
        self.assertTrue(self.service._nasq_capability_keys(odoo_group) >= PMO_PERMISSIONS)
        self.assertTrue(self.service._nasq_capability_keys(access_admin) >= MEETINGS_PERMISSIONS)
        self.assertTrue(self.service._nasq_capability_keys(self.other) >= EMPLOYEE_PMO_PERMISSIONS)
        self.assertIn('pmo_manager', self.service._nasq_legacy_admin_roles())
