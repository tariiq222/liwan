# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date

from odoo.exceptions import AccessError
from odoo.tests import TransactionCase, new_test_user, tagged


@tagged('post_install', '-at_install', 'webvue', 'webvue_access')
class TestRoleProjectWrites(TransactionCase):
    """Project writes granted by a WebVue role, not by Odoo's project-manager group (#132).

    Odoo reserves project creation and project stages to `project.group_project_manager`; a role
    or the contextual manager of a project holds the WebVue capability only, so each write runs on
    the caller's behalf after the capability check.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.env['webvue.pmo.settings'].set_values({'project_creators': 'managers'})
        Assignment = cls.env['webvue.access.assignment']
        cls.pmo_manager = new_test_user(cls.env, login='role_pmo_manager', groups='base.group_user')
        cls.owner = new_test_user(cls.env, login='role_project_owner', groups='base.group_user')
        cls.staff = new_test_user(cls.env, login='role_project_staff', groups='base.group_user')
        for user in (cls.pmo_manager, cls.owner, cls.staff):
            Assignment.create({'user_id': user.id, 'role_id': cls.env.ref('webvue_core.role_employee').id, 'company_id': cls.env.company.id})
        Assignment.create({'user_id': cls.pmo_manager.id, 'role_id': cls.env.ref('webvue_pmo.role_pmo_manager').id, 'company_id': cls.env.company.id})
        cls.owned = cls.env['project.project'].create({
            'name': 'Owned', 'user_id': cls.owner.id, 'company_id': cls.env.company.id,
            'date_start': date(2031, 1, 1), 'date': date(2031, 1, 31),
            'type_ids': [(0, 0, {'name': 'Todo', 'sequence': 10}), (0, 0, {'name': 'Done', 'sequence': 20})],
        })

    def test_role_holds_no_odoo_project_manager_group(self):
        self.assertFalse(self.pmo_manager.has_group('project.group_project_manager'))
        self.assertFalse(self.owner.has_group('project.group_project_manager'))

    def test_pmo_manager_role_creates_a_project(self):
        Project = self.env['project.project'].with_user(self.pmo_manager)
        project = Project._webvue_create_from_policy('By role', user_id=self.owner.id, date_end=date(2031, 1, 31))
        self.assertEqual(project.env.uid, self.pmo_manager.id)
        self.assertEqual((project.name, project.user_id, project.create_uid), ('By role', self.owner, self.pmo_manager))
        self.assertTrue(project.type_ids)

    def test_pmo_manager_role_copies_a_project(self):
        copy = self.owned.with_user(self.pmo_manager)._webvue_copy_structure('Copied', '2031-02-01')
        self.assertEqual(copy.type_ids.mapped('name'), ['Todo', 'Done'])

    def _manage_stages(self, user, project):
        as_user = project.with_user(user)
        stage = as_user._webvue_add_stage('Review')
        self.assertIn(stage, project.type_ids)
        as_user._webvue_update_stage(stage, {'name': 'Reviewed', 'fold': True})
        self.assertEqual((stage.name, stage.fold), ('Reviewed', True))
        order = list(reversed(project.type_ids.ids))
        self.assertEqual(as_user._webvue_reorder_stages(order).ids, order)
        as_user._webvue_delete_stage(stage)
        self.assertFalse(stage.exists())

    def test_pmo_manager_role_manages_stages_of_any_project(self):
        self._manage_stages(self.pmo_manager, self.owned)

    def test_contextual_manager_manages_stages_of_own_project(self):
        self._manage_stages(self.owner, self.owned)

    def test_contextual_manager_removes_a_follower_of_a_private_project(self):
        self.owned.write({'privacy_visibility': 'followers'})
        as_owner = self.owned.with_user(self.owner)
        as_owner._webvue_add_follower(self.owner)
        as_owner._webvue_add_follower(self.staff)
        self.assertNotIn(self.staff, as_owner._webvue_remove_follower(self.staff))

    def test_employee_still_refused_stage_and_project_writes(self):
        with self.assertRaises(AccessError):
            self.owned.with_user(self.staff)._webvue_add_stage('Nope')
        with self.assertRaises(AccessError):
            self.env['project.project'].with_user(self.staff)._webvue_create_from_policy('Nope')

    def test_a_shared_stage_is_changed_only_by_a_pmo_manager(self):
        other = self.env['project.project'].create({'name': 'Other', 'company_id': self.env.company.id})
        shared = self.owned.type_ids[:1]
        shared.write({'project_ids': [(4, other.id)]})
        as_owner = self.owned.with_user(self.owner)
        with self.assertRaises(AccessError):
            as_owner._webvue_update_stage(shared, {'name': 'Renamed for all'})
        with self.assertRaises(AccessError):
            as_owner._webvue_reorder_stages(list(reversed(self.owned.type_ids.ids)))
        self.assertEqual(shared.name, 'Todo')
        self.owned.with_user(self.pmo_manager)._webvue_update_stage(shared, {'name': 'Renamed for all'})
        self.assertEqual(shared.name, 'Renamed for all')
        as_owner._webvue_delete_stage(shared)
        self.assertEqual((shared.exists(), shared.project_ids), (shared, other))

    def test_a_stage_shared_with_another_company_is_not_changed(self):
        branch = self.env['res.company'].create({'name': 'Stage branch', 'parent_id': self.env.company.id})
        other = self.env['project.project'].create({'name': 'Branch project', 'company_id': branch.id})
        shared = self.owned.type_ids[:1]
        shared.write({'project_ids': [(4, other.id)]})
        with self.assertRaises(AccessError):
            self.owned.with_user(self.pmo_manager)._webvue_update_stage(shared, {'name': 'Renamed in the branch too'})
        self.assertEqual(shared.name, 'Todo')
