# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import AccessError
from odoo.tests import TransactionCase, new_test_user, tagged

from .common import NasqPmoCase


@tagged('nasq', 'nasq_access')
class TestPmoAccessCapabilityModels(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company = cls.env.company
        cls.owner = new_test_user(
            cls.env, login='cap_project_owner', groups='nasq_core.group_employee',
        )
        cls.other = new_test_user(
            cls.env, login='cap_project_other', groups='nasq_core.group_employee',
        )
        cls.pmo_manager = new_test_user(
            cls.env, login='cap_pmo_manager', groups='nasq_core.group_employee',
        )
        cls.system_admin = new_test_user(
            cls.env, login='cap_system_admin', groups='base.group_user',
        )
        cls.read_only = new_test_user(
            cls.env, login='cap_pmo_read_only', groups='base.group_user',
        )
        cls.assigned_employee = new_test_user(
            cls.env, login='cap_assigned_employee', groups='base.group_user',
        )
        Assignment = cls.env['nasq.access.assignment']
        Assignment.create({
            'user_id': cls.pmo_manager.id,
            'role_id': cls.env.ref('nasq_core.role_pmo_manager').id,
            'company_id': cls.company.id,
        })
        Assignment.create({
            'user_id': cls.system_admin.id,
            'role_id': cls.env.ref('nasq_core.role_system_admin').id,
            'company_id': cls.company.id,
        })
        read_only_role = cls.env['nasq.access.role'].create({
            'name_ar': 'قارئ المشاريع والمهام',
            'company_id': cls.company.id,
            'permission_ids': [(6, 0, cls.env['nasq.access.permission'].search([
                ('key', 'in', ['pmo.projects.read', 'pmo.tasks.read']),
            ]).ids)],
        })
        Assignment.create({
            'user_id': cls.read_only.id,
            'role_id': read_only_role.id,
            'company_id': cls.company.id,
        })
        Assignment.create({
            'user_id': cls.assigned_employee.id,
            'role_id': cls.env.ref('nasq_core.role_employee').id,
            'company_id': cls.company.id,
        })
        cls.owned = cls.env['project.project'].create({
            'name': 'Owned scope', 'user_id': cls.owner.id,
            'company_id': cls.company.id,
        })
        cls.other_project = cls.env['project.project'].create({
            'name': 'Other scope', 'user_id': cls.other.id,
            'company_id': cls.company.id,
        })
        cls.owned_task = cls.env['project.task'].create({
            'name': 'Owned task', 'project_id': cls.owned.id,
            'user_ids': [(4, cls.other.id)],
        })
        cls.other_task = cls.env['project.task'].create({
            'name': 'Other task', 'project_id': cls.other_project.id,
            'user_ids': [(4, cls.owner.id)],
        })

    def test_project_owner_scope_and_system_admin_separation(self):
        self.assertTrue(self.owned.with_user(self.owner)._nasq_can_manage())
        self.assertFalse(self.other_project.with_user(self.owner)._nasq_can_manage())
        self.assertTrue(self.owned.with_user(self.pmo_manager)._nasq_can_manage())
        self.assertTrue(self.other_project.with_user(self.pmo_manager)._nasq_can_manage())
        self.assertFalse(self.owned.with_user(self.system_admin)._nasq_can_manage())

    def test_project_owner_approves_only_owned_project_tasks(self):
        self.assertTrue(self.owned_task.with_user(self.owner)._nasq_can_approve())
        self.owned_task.with_user(self.owner)._nasq_transition('03_approved')
        with self.assertRaises(AccessError):
            self.other_task.with_user(self.owner)._nasq_transition('02_changes_requested')

    def test_task_archive_requires_write_and_creator_or_approval(self):
        self.assertTrue(self.owned_task.with_user(self.owner)._nasq_can_archive())
        self.assertTrue(self.owned_task.with_user(self.pmo_manager)._nasq_can_archive())
        self.assertTrue(self.owned_task.with_user(self.other)._nasq_can_write())
        self.assertFalse(self.owned_task.with_user(self.other)._nasq_can_archive())

    def test_reassigning_project_changes_contextual_authority(self):
        self.owned.with_user(self.owner)._nasq_write_as_manager({'user_id': self.other.id})
        self.owned.invalidate_recordset(['user_id'])
        self.assertFalse(self.owned.with_user(self.owner)._nasq_can_manage())
        self.assertTrue(self.owned.with_user(self.other)._nasq_can_manage())
        self.assertFalse(self.owned_task.with_user(self.owner)._nasq_can_approve())
        self.assertTrue(self.owned_task.with_user(self.other)._nasq_can_approve())

    def test_read_only_capabilities_cannot_bypass_api_through_generic_orm(self):
        with self.assertRaises(AccessError):
            self.owned.with_user(self.read_only).write({'name': 'Bypass'})
        with self.assertRaises(AccessError):
            self.env['project.project'].with_user(self.read_only).create({'name': 'Bypass'})
        with self.assertRaises(AccessError):
            self.owned.with_user(self.read_only).unlink()
        with self.assertRaises(AccessError):
            self.owned_task.with_user(self.read_only).write({'name': 'Bypass'})
        with self.assertRaises(AccessError):
            self.owned_task.with_user(self.read_only).write({'state': '03_approved'})
        with self.assertRaises(AccessError):
            self.env['project.task'].with_user(self.read_only).create({
                'name': 'Bypass', 'project_id': self.owned.id,
            })
        with self.assertRaises(AccessError):
            self.owned_task.with_user(self.read_only).unlink()

    def test_task_write_cannot_claim_hidden_task_or_hard_delete(self):
        hidden_project = self.env['project.project'].create({
            'name': 'Hidden project', 'privacy_visibility': 'followers',
            'user_id': self.other.id,
        })
        hidden_task = self.env['project.task'].create({
            'name': 'Hidden task', 'project_id': hidden_project.id,
            'user_ids': [(4, self.other.id)],
        })
        with self.assertRaises(AccessError):
            hidden_task.with_user(self.assigned_employee).write({
                'user_ids': [(6, 0, [self.assigned_employee.id])],
            })
        with self.assertRaises(AccessError):
            self.owned_task.with_user(self.pmo_manager).unlink()
        with self.assertRaises(AccessError):
            self.owned.with_user(self.pmo_manager).unlink()
        with self.assertRaises(AccessError):
            self.owned_task.with_user(self.pmo_manager).write({
                'project_id': self.other_project.id,
            })

    def test_employee_assignment_honors_creation_policy_but_system_admin_does_not(self):
        self.env['nasq.pmo.settings'].set_values({'project_creators': 'employees'})
        employee_identity = self.env['nasq.access.service']._nasq_identity(self.assigned_employee)
        self.assertIn('pmo.projects.create', employee_identity['capabilities'])
        self.assertIn('project_creation_policy', {
            role['key'] for role in employee_identity['roles']
        })
        project = self.env['project.project'].with_user(
            self.assigned_employee,
        )._nasq_create_from_policy('Assigned employee project', date_end='2031-01-01')
        self.assertEqual(project.user_id, self.assigned_employee)

        admin_identity = self.env['nasq.access.service']._nasq_identity(self.system_admin)
        self.assertNotIn('pmo.projects.create', admin_identity['capabilities'])
        with self.assertRaises(AccessError):
            self.env['project.project'].with_user(
                self.system_admin,
            )._nasq_create_from_policy('System admin project')

    def test_company_switch_does_not_reuse_pmo_assignment(self):
        company_b = self.env['res.company'].create({'name': 'PMO company B'})
        self.pmo_manager.write({
            'company_ids': [(6, 0, [self.company.id, company_b.id])],
        })
        project_b = self.env['project.project'].create({
            'name': 'Other-company project',
            'company_id': company_b.id,
            'user_id': self.other.id,
        })
        env_b = self.env(
            user=self.pmo_manager,
            context={'allowed_company_ids': [company_b.id, self.company.id]},
        )
        actor_b = self.pmo_manager.with_env(env_b)
        self.assertEqual(env_b.company, company_b)
        self.assertFalse(env_b['nasq.access.service']._nasq_has_capability(
            actor_b, 'pmo.projects.manage',
        ))
        with self.assertRaises(AccessError):
            env_b['project.project'].search([])
        with self.assertRaises(AccessError):
            project_b.with_env(env_b).write({'name': 'Cross-company takeover'})
        self.read_only.write({
            'company_ids': [(6, 0, [self.company.id, company_b.id])],
        })
        read_only_env_b = self.env(
            user=self.read_only,
            context={'allowed_company_ids': [company_b.id, self.company.id]},
        )
        with self.assertRaises(AccessError):
            read_only_env_b['project.project'].search([])
        with self.assertRaises(AccessError):
            project_b.with_env(env_b).write({'name': 'Cross-company takeover'})


@tagged('post_install', '-at_install', 'nasq', 'nasq_access')
class TestPmoAccessCapabilityApi(NasqPmoCase):

    def test_project_and_task_details_return_allowed_actions(self):
        self.project.write({'user_id': self.employee.id})
        self.authenticate('api_emp', 'api_emp_pass_123')
        project = self.api('GET', f'/api/v1/projects/{self.project.id}')
        self.assertEqual(project.status_code, 200, project.text)
        self.assertIn('write', project.json()['allowed_actions'])
        task = self.api('GET', f'/api/v1/tasks/{self.task_overdue.id}')
        self.assertEqual(task.status_code, 200, task.text)
        self.assertIn('approve', task.json()['allowed_actions'])

    def test_project_list_has_server_total_without_losing_metadata(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        body = self.api('GET', '/api/v1/projects').json()
        self.assertIn('items', body)
        self.assertIn('total', body)
        self.assertIn('can_create', body)
        self.assertIn('can_list_archived', body)
        self.assertGreaterEqual(body['total'], len(body['items']))
