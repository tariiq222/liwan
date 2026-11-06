# Part of Odoo. See LICENSE file for full copyright and licensing details.
from unittest import TestCase as PlainTestCase

from odoo.exceptions import AccessError, ValidationError
from odoo.tests import new_test_user, tagged

from .common import LiwanPmoCase
from odoo.addons.liwan_pmo.models import project_objective

MARKER = 'liwan_pmo.objective_commands'


@tagged('post_install', '-at_install', 'liwan')
class TestObjectiveHandoff(LiwanPmoCase):
    project_tool_policies = {'planning': 'optional', 'governance': 'optional', 'finance': 'optional'}

    def _new_project(self, goals=('Original goal',)):
        return self.env['project.project'].create({
            'name': 'Handoff project', 'company_id': self.env.company.id,
            'user_id': self.employee.id, 'privacy_visibility': 'employees',
            'liwan_objective_ids': [(0, 0, {'goal': goal}) for goal in goals],
        })

    def _handoff(self, project, objectives):
        self.authenticate('api_emp', 'api_emp_pass_123')
        return self.api('PATCH', f'/api/v1/projects/{project.id}', {
            'expected_updated_at': project._liwan_updated_at(), 'user_id': self.manager.id,
            'name': 'Saved handoff', 'objectives': [{'goal': goal} for goal in objectives],
        })

    def test_actual_patch_handoff_can_add_replace_and_remove_objectives(self):
        self.assertFalse(self.env['liwan.access.service']._liwan_has_capability(self.employee, 'pmo.projects.manage'))
        for before, after in (((), ('Added goal',)), (('Old one', 'Old two'), ('Replacement',)), (('Remove me',), ())):
            project = self._new_project(before)
            response = self._handoff(project, after)
            self.assertEqual(response.status_code, 200, response.text)
            body = response.json()
            self.assertEqual(body['manager']['id'], self.manager.id)
            self.assertEqual([row['goal'] for row in body['objectives']], list(after))
            self.assertFalse(body['can_manage'])
            self.assertEqual(project.name, 'Saved handoff')
            self.assertFalse(self.env.cr.precommit.data.get(MARKER))

    def test_independent_old_manager_objective_mutations_are_refused(self):
        project = self._new_project()
        row = project.liwan_objective_ids
        project.with_user(self.employee)._liwan_write_as_manager({'user_id': self.manager.id})
        with self.assertRaises(AccessError):
            row.with_user(self.employee).write({'goal': 'Unapproved edit'})
        with self.assertRaises(AccessError):
            row.with_user(self.employee).unlink()
        with self.assertRaises(AccessError):
            self.env['liwan.project.objective'].with_user(self.employee).create({'project_id': project.id, 'goal': 'Unapproved create'})
        forged = row.with_user(self.employee).with_context({MARKER: {
            'actor_id': self.employee.id, 'project_id': project.id,
            'write': [(row.id, {'goal': 'Forged'})], 'unlink': set(row.ids),
        }})
        with self.assertRaises(AccessError):
            forged.write({'goal': 'Forged'})
        self.assertEqual(row.goal, 'Original goal')
        self.assertFalse(self.env.cr.precommit.data.get(MARKER))

    def test_parent_commands_cannot_mutate_foreign_objectives_or_move_projects(self):
        foreign = self.env['project.project'].create({'name': 'Other objective owner', 'company_id': self.env.company.id})
        foreign_row = self.env['liwan.project.objective'].create({'project_id': foreign.id, 'goal': 'Other goal'})
        for command in ((1, foreign_row.id, {'goal': 'Bad'}), (2, foreign_row.id, 0), (3, foreign_row.id, 0)):
            project = self._new_project()
            with self.assertRaises(AccessError):
                project.with_user(self.employee)._liwan_write_as_manager({
                    'user_id': self.manager.id, 'liwan_objective_ids': [command],
                })
            self.assertEqual(project.user_id, self.employee)
            self.assertEqual(foreign_row.goal, 'Other goal')
            self.assertFalse(self.env.cr.precommit.data.get(MARKER))
        project = self._new_project()
        own_row = project.liwan_objective_ids
        with self.assertRaises(ValidationError):
            project.with_user(self.employee)._liwan_write_as_manager({
                'user_id': self.manager.id,
                'liwan_objective_ids': [(1, own_row.id, {'project_id': foreign.id})],
            })
        self.assertEqual(own_row.project_id, project)

    def test_nested_scope_is_actor_project_and_command_bounded(self):
        project = self._new_project()
        actor_project = project.with_user(self.employee)
        Objective = self.env['liwan.project.objective'].with_user(self.employee)
        outsider = new_test_user(self.env, login='objective_scope_outsider', groups='liwan_core.group_employee')
        with project_objective._objective_command_scope(actor_project, [(0, 0, {'goal': 'Allowed once'})]):
            project.write({'user_id': self.manager.id})
            # These checks fail before database writes. Odoo's assertRaises
            # rolls back a savepoint and clears all precommit markers, so use
            # plain assertions to keep the outer command scope alive here.
            with PlainTestCase.assertRaises(self, AccessError):
                Objective.create({'project_id': project.id, 'goal': 'Unexpected'})
            with PlainTestCase.assertRaises(self, AccessError):
                Objective.with_user(outsider).create({'project_id': project.id, 'goal': 'Allowed once'})
            allowed = Objective.create({'project_id': project.id, 'goal': 'Allowed once'})
            self.assertEqual(allowed.goal, 'Allowed once')
            with PlainTestCase.assertRaises(self, AccessError):
                Objective.create({'project_id': project.id, 'goal': 'Allowed once'})
        self.assertFalse(self.env.cr.precommit.data.get(MARKER))
        with self.assertRaises(AccessError):
            allowed.write({'goal': 'After scope'})

    def test_archive_and_invalid_payload_remain_atomic_and_scope_is_cleared(self):
        project = self._new_project()
        self.authenticate('api_emp', 'api_emp_pass_123')
        response = self.api('PATCH', f'/api/v1/projects/{project.id}', {
            'expected_updated_at': project._liwan_updated_at(), 'user_id': self.manager.id,
            'objectives': [{'goal': ' '}],
        })
        self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(project.user_id, self.employee)
        with self.assertRaises(AccessError):
            project.with_user(self.employee)._liwan_write_as_manager({
                'active': False, 'user_id': self.manager.id,
                'liwan_objective_ids': [(5, 0, 0)],
            })
        self.assertTrue(project.active)
        self.assertEqual(project.liwan_objective_ids.goal, 'Original goal')
        self.assertFalse(self.env.cr.precommit.data.get(MARKER))
