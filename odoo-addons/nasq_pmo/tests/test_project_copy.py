# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date
from unittest.mock import patch

from odoo.exceptions import AccessError, ValidationError
from odoo.tests import new_test_user, tagged

from .common import NasqPmoCase
from odoo.addons.nasq_platform.models.entitlement_service import OPERATOR_CONTEXT
from odoo.addons.nasq_pmo.models import project_project
from odoo.addons.nasq_pmo.models.project_task import PROJECT_COPY_MARKER

COUNTED_MODELS = ('project.project', 'project.task.type', 'project.milestone', 'project.task')


@tagged('post_install', '-at_install', 'nasq')
class TestProjectCopy(NasqPmoCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.env['nasq.pmo.settings'].set_values({'project_creators': 'managers'})
        cls.copier = cls._copy_user('copy_user', ['pmo.projects.read', 'pmo.projects.create', 'pmo.tasks.read'])
        cls.no_task_read = cls._copy_user('copy_no_tasks', ['pmo.projects.read', 'pmo.projects.create'])
        cls.no_create = cls._copy_user('copy_no_create', ['pmo.projects.read', 'pmo.tasks.read'])
        cls.source = cls._build_source()

    @classmethod
    def _copy_user(cls, login, keys):
        user = new_test_user(cls.env, login=login, password='copy_pass_123', groups='base.group_user')
        role = cls.env['nasq.access.role'].create({
            'name_ar': login,
            'permission_ids': [(6, 0, cls.env['nasq.access.permission'].search([('key', 'in', keys)]).ids)],
        })
        cls.env['nasq.access.assignment'].create({
            'user_id': user.id, 'role_id': role.id, 'company_id': cls.env.company.id,
        })
        return user

    @classmethod
    def _build_source(cls):
        Project = cls.env['project.project']
        source = Project.create({
            'name': 'Source', 'user_id': cls.manager.id, 'company_id': cls.env.company.id,
            'privacy_visibility': 'employees', 'allow_milestones': True,
            'allow_task_dependencies': True,
            'date_start': date(2030, 1, 1), 'date': date(2030, 1, 31),
            'type_ids': [
                (0, 0, {'name': 'Plan', 'sequence': 10}),
                (0, 0, {'name': 'Archive', 'sequence': 20, 'fold': True}),
            ],
        })
        as_manager = source.with_user(cls.manager)
        cls.plan, cls.archive = source.type_ids.sorted('sequence')
        launch = as_manager._nasq_create_milestone('Launch', deadline=date(2030, 1, 20))
        cls.tag = cls.env['project.tags'].create({'name': 'copy-tag'})
        Task = cls.env['project.task']
        cls.first = Task.create({
            'name': 'First', 'project_id': source.id, 'stage_id': cls.plan.id,
            'description': '<p>Do it</p>', 'tag_ids': [(6, 0, cls.tag.ids)],
            'user_ids': [(4, cls.employee.id)], 'milestone_id': launch.id,
        })
        cls.second = Task.create({'name': 'Second', 'project_id': source.id, 'stage_id': cls.archive.id})
        cls.first.with_user(cls.manager)._nasq_set_schedule(date(2030, 1, 3), date(2030, 1, 5))
        cls.second.with_user(cls.manager)._nasq_set_schedule(date(2030, 1, 6), date(2030, 1, 10))
        cls.second.with_user(cls.manager)._nasq_set_dependencies([cls.first.id])
        cls.sub = Task.create({'name': 'Sub', 'project_id': source.id, 'parent_id': cls.first.id})
        cls.gone = Task.create({'name': 'Archived', 'project_id': source.id, 'active': False})
        cls.env['nasq.project.finance.entry'].create({
            'project_id': source.id, 'kind': 'budget', 'title': 'Budget', 'amount': 10,
        })
        cls.env['nasq.project.stakeholder'].create({
            'project_id': source.id, 'name': 'Stakeholder', 'user_id': cls.employee.id,
        })
        return source

    def _copy(self, user=None, name='Copy', start='2030-03-01', source=None, **kwargs):
        source = (source or self.source).with_user(user or self.copier)
        return source._nasq_copy_structure(name, start, **kwargs)

    def _counts(self):
        return {
            model: self.env[model].with_context(active_test=False).search_count([])
            for model in COUNTED_MODELS
        }

    def test_copies_structure_with_shifted_dates(self):
        copy = self._copy()
        self.assertNotEqual(copy, self.source)
        self.assertEqual(copy.name, 'Copy')
        self.assertEqual(copy.date_start, date(2030, 3, 1))
        self.assertEqual(copy.date, date(2030, 3, 31))
        self.assertTrue(copy.allow_task_dependencies)
        stages = copy.type_ids.sorted('sequence')
        self.assertEqual(stages.mapped('name'), ['Plan', 'Archive'])
        self.assertEqual(stages.mapped('fold'), [False, True])
        self.assertFalse(set(stages.ids) & set(self.source.type_ids.ids))
        milestone = copy.milestone_ids
        self.assertEqual(milestone.name, 'Launch')
        self.assertEqual(milestone.deadline, date(2030, 3, 20))
        self.assertNotEqual(milestone, self.source.milestone_ids)
        tasks = self.env['project.task'].search([('project_id', '=', copy.id)])
        self.assertEqual(sorted(tasks.mapped('name')), ['First', 'Second'])
        first = tasks.filtered(lambda task: task.name == 'First')
        second = tasks.filtered(lambda task: task.name == 'Second')
        self.assertEqual(first.stage_id.name, 'Plan')
        self.assertEqual(first.stage_id.project_ids, copy)
        self.assertEqual(second.stage_id.name, 'Archive')
        self.assertEqual(first.milestone_id, milestone)
        self.assertEqual(first.description, '<p>Do it</p>')
        self.assertEqual(first.tag_ids, self.tag)
        self.assertEqual(first.nasq_planned_start, date(2030, 3, 3))
        self.assertEqual(first.date_deadline.date(), date(2030, 3, 5))
        self.assertEqual(second.nasq_planned_start, date(2030, 3, 6))
        self.assertEqual(second.date_deadline.date(), date(2030, 3, 10))
        self.assertEqual(second.depend_on_ids, first)

    def test_copies_catalog_references(self):
        company = self.env.company
        kind = self.env['nasq.project.type'].create({'name': 'Kind', 'company_id': company.id})
        unit = self.env['nasq.project.owning.unit'].create({'name': 'Unit', 'company_id': company.id})
        self.source.write({'nasq_type_id': kind.id, 'nasq_owning_unit_id': unit.id})
        try:
            copy = self._copy(name='Catalog copy')
            self.assertEqual((copy.nasq_type_id, copy.nasq_owning_unit_id), (kind, unit))
        finally:
            self.source.write({'nasq_type_id': False, 'nasq_owning_unit_id': False})

    def test_copy_excludes_people_state_governance_and_finance(self):
        copy = self._copy()
        tasks = self.env['project.task'].search([('project_id', '=', copy.id)])
        self.assertEqual(len(tasks), 2)  # no sub-task, no archived task
        self.assertFalse(self.env['project.task'].with_context(active_test=False).search([
            ('project_id', '=', copy.id), ('name', 'in', ('Sub', 'Archived')),
        ]))
        self.assertFalse(tasks.user_ids)
        self.assertFalse(tasks.message_follower_ids)
        self.assertFalse(tasks.activity_ids)
        self.assertFalse(tasks.parent_id)
        self.assertFalse(tasks.filtered(lambda task: task.state in ('1_done', '1_canceled')))
        self.assertEqual(tasks.filtered(lambda task: task.name == 'First').state, '01_in_progress')
        self.assertFalse(copy.message_follower_ids)
        self.assertFalse(copy.activity_ids)
        for model in ('nasq.project.finance.entry', 'nasq.project.stakeholder',
                      'nasq.project.raci', 'nasq.project.register'):
            self.assertFalse(self.env[model].search([('project_id', '=', copy.id)]), model)
        self.assertFalse(copy.nasq_sponsor_id)
        self.assertFalse(copy.nasq_authority)

    def test_caller_becomes_manager_and_claims_quota(self):
        service = self.env['nasq.entitlement.service'].sudo()
        before = service._nasq_count_projects()
        copy = self._copy()
        self.assertEqual(copy.user_id, self.copier)
        self.assertTrue(copy.with_user(self.copier)._nasq_can_manage())
        self.assertTrue(copy.nasq_code)
        self.assertNotEqual(copy.nasq_code, self.source.nasq_code)
        self.assertEqual(service._nasq_count_projects(), before + 1)

    def test_anchor_falls_back_to_earliest_task_or_milestone(self):
        self.env['nasq.pmo.settings'].set_values({'require_end_date_on_create': False})
        undated = self.env['project.project'].create({
            'name': 'No start', 'user_id': self.manager.id, 'company_id': self.env.company.id,
            'privacy_visibility': 'employees', 'allow_milestones': True,
        })
        task = self.env['project.task'].create({'name': 'Anchored', 'project_id': undated.id})
        task.with_user(self.manager)._nasq_set_schedule(date(2030, 5, 10), date(2030, 5, 12))
        undated.with_user(self.manager)._nasq_create_milestone('Early', deadline=date(2030, 5, 8))
        copy = self._copy(source=undated, name='Anchored copy', start='2031-01-01')
        self.assertEqual(copy.milestone_ids.deadline, date(2031, 1, 1))
        new_task = self.env['project.task'].search([('project_id', '=', copy.id)])
        self.assertEqual(new_task.nasq_planned_start, date(2031, 1, 3))
        self.assertEqual(new_task.date_deadline.date(), date(2031, 1, 5))
        self.assertFalse(copy.date)

    def test_undated_source_copies_without_dates(self):
        self.env['nasq.pmo.settings'].set_values({'require_end_date_on_create': False})
        bare = self.env['project.project'].create({
            'name': 'Bare', 'user_id': self.manager.id, 'company_id': self.env.company.id,
            'privacy_visibility': 'employees',
        })
        self.env['project.task'].create({'name': 'Loose', 'project_id': bare.id})
        copy = self._copy(source=bare, name='Bare copy')
        self.assertEqual(copy.date_start, date(2030, 3, 1))
        self.assertFalse(copy.date)
        task = self.env['project.task'].search([('project_id', '=', copy.id)])
        self.assertFalse(task.nasq_planned_start)
        self.assertFalse(task.date_deadline)

    def test_context_defaults_cannot_seed_the_copy(self):
        copy = self.source.with_user(self.copier).with_context(
            default_user_ids=[(6, 0, self.employee.ids)],
            default_state='1_done',
            default_message_follower_ids=[(0, 0, {'partner_id': self.employee.partner_id.id})],
        )._nasq_copy_structure('Defaults ignored', '2030-03-01')
        tasks = self.env['project.task'].search([('project_id', '=', copy.id)])
        self.assertFalse(tasks.user_ids)
        self.assertFalse(tasks.message_follower_ids)
        self.assertFalse(tasks.filtered(lambda task: task.state == '1_done'))

    def test_forbidden_callers(self):
        before = self._counts()
        with self.assertRaises(AccessError):
            self._copy(user=self.no_task_read)
        with self.assertRaises(AccessError):
            self._copy(user=self.no_create)
        self.assertEqual(before, self._counts())

    def test_forbidden_for_invisible_and_foreign_company_projects(self):
        hidden = self.env['project.project'].create({
            'name': 'Hidden', 'user_id': self.manager.id, 'company_id': self.env.company.id,
            'privacy_visibility': 'followers',
        })
        other = self.env['res.company'].create({'name': 'Copy foreign company'})
        foreign = self.env['project.project'].with_company(other).create({
            'name': 'Foreign', 'company_id': other.id, 'privacy_visibility': 'employees',
        })
        before = self._counts()
        with self.assertRaises(AccessError):
            self._copy(source=hidden)
        with self.assertRaises(AccessError):
            self._copy(source=foreign)
        self.assertEqual(before, self._counts())

    def test_invalid_input_is_rejected_before_creating_anything(self):
        before = self._counts()
        for name, start in (
            ('  ', '2030-03-01'), (None, '2030-03-01'), ('x' * 256, '2030-03-01'),
            ('Bad', 'not-a-date'), ('Bad', '2030-3-1'), ('Bad', 20300301), ('Bad', None),
            ('Overflow', '9999-12-31'),
        ):
            with self.assertRaises(ValidationError, msg=repr((name, start))):
                self._copy(name=name, start=start)
        self.assertEqual(before, self._counts())

    def test_oversized_source_is_rejected(self):
        before = self._counts()
        with patch.object(project_project, 'MAX_COPY_TASKS', 1), self.assertRaises(ValidationError):
            self._copy()
        with patch.object(project_project, 'MAX_COPY_MILESTONES', 0), self.assertRaises(ValidationError):
            self._copy()
        self.assertEqual(before, self._counts())

    def test_failure_rolls_back_everything_and_clears_scope(self):
        before = self._counts()
        Task = self.env.registry['project.task']
        original = Task._nasq_set_schedule
        seen = []

        def fail_second(task, start, end):
            seen.append(task.id)
            if len(seen) == 2:
                self.assertEqual(
                    task.env.cr.precommit.data[PROJECT_COPY_MARKER],
                    (self.copier.id, self.env.company.id, task.project_id.id),
                )
                message = 'Controlled failure after both tasks and milestone exist'
                raise ValidationError(message)
            return original(task, start, end)

        with patch.object(Task, '_nasq_set_schedule', fail_second), self.assertRaises(ValidationError):
            self._copy()
        self.assertEqual(len(seen), 2)
        self.assertNotIn(PROJECT_COPY_MARKER, self.env.cr.precommit.data)
        self.assertFalse(self.env['project.task'].browse(seen).exists())
        self.assertEqual(before, self._counts())

    def test_serializer_failure_rolls_back_and_scope_is_cleared_on_success(self):
        before = self._counts()

        def failed_result(project):
            self.assertEqual(
                project.env.cr.precommit.data[PROJECT_COPY_MARKER],
                (self.copier.id, self.env.company.id, project.id),
            )
            message = 'Result failure after successful population'
            raise ValidationError(message)

        with self.assertRaises(ValidationError):
            self._copy(serialize=failed_result)
        self.assertNotIn(PROJECT_COPY_MARKER, self.env.cr.precommit.data)
        self.assertEqual(before, self._counts())
        copy = self._copy(name='After failure')
        self.assertNotIn(PROJECT_COPY_MARKER, self.env.cr.precommit.data)
        Model = self.env['project.task'].with_user(self.no_task_read).with_context(**{
            PROJECT_COPY_MARKER: (self.no_task_read.id, self.env.company.id, copy.id),
        })
        with self.assertRaises(AccessError):
            Model.search([])
        with self.assertRaises(AccessError):
            Model.create({'name': 'Denied', 'project_id': copy.id})

    def test_scope_helper_requires_the_server_scope(self):
        copy = self._copy()
        with self.assertRaises(AccessError):
            self.env['project.task'].with_user(self.copier)._nasq_create_for_copy(
                copy, {'name': 'No scope', 'project_id': copy.id},
            )

    def test_http_copy(self):
        self.authenticate('copy_user', 'copy_pass_123')
        path = f'/api/v1/projects/{self.source.id}/copy'
        response = self.api('POST', path, {'name': 'HTTP copy', 'start_date': '2030-03-01'})
        self.assertEqual(response.status_code, 201, response.text)
        body = response.json()
        self.assertEqual(body['name'], 'HTTP copy')
        self.assertEqual(body['task_count'], 2)
        self.assertEqual(body['milestone_count'], 1)
        self.assertEqual(len(body['stages']), 2)
        self.assertEqual(body['manager']['id'], self.copier.id)
        self.assertTrue(body['can_manage'])
        self.assertNotIn(PROJECT_COPY_MARKER, self.env.cr.precommit.data)

    def test_http_errors(self):
        self.authenticate('copy_user', 'copy_pass_123')
        path = f'/api/v1/projects/{self.source.id}/copy'
        before = self._counts()
        for payload in (
            {'name': 'Bad', 'start_date': 'nope'},
            {'name': '  ', 'start_date': '2030-03-01'},
            {'start_date': '2030-03-01'},
            {'name': 'Bad'},
            {'name': 'Bad', 'start_date': '2030-03-01', 'user_ids': [1]},
            {'name': 'Bad', 'start_date': '9999-12-31'},
        ):
            response = self.api('POST', path, payload)
            self.assertEqual(response.status_code, 422, (payload, response.text))
            self.assertEqual(response.json()['code'] in ('invalid', 'unknown_field'), True)
        self.assertEqual(self.api('POST', '/api/v1/projects/99999999/copy', {
            'name': 'Missing', 'start_date': '2030-03-01',
        }).status_code, 404)
        self.assertEqual(before, self._counts())
        for login in ('copy_no_tasks', 'copy_no_create'):
            self.authenticate(login, 'copy_pass_123')
            response = self.api('POST', path, {'name': 'Denied', 'start_date': '2030-03-01'})
            self.assertEqual(response.status_code, 403, (login, response.text))
            self.assertEqual(response.json()['code'], 'forbidden')
        self.assertEqual(before, self._counts())

    def test_http_at_project_quota_preserves_limit_error_and_population(self):
        service = self.env['nasq.entitlement.service'].sudo()
        profile = self.env.ref('nasq_platform.tenant_profile')
        before = self._counts()
        project_count = service._nasq_count_projects()
        profile.with_context(**{OPERATOR_CONTEXT: True}).write({
            'features': {**profile.features, 'projects.max_projects': project_count},
        })
        self.authenticate('copy_user', 'copy_pass_123')
        response = self.api('POST', f'/api/v1/projects/{self.source.id}/copy', {
            'name': 'Over quota', 'start_date': '2030-03-01',
        })
        self.assertEqual(response.status_code, 403, response.text)
        self.assertEqual(response.json()['code'], 'feature_not_included')
        self.assertEqual(service._nasq_count_projects(), project_count)
        self.assertEqual(before, self._counts())
