# Part of Odoo. See LICENSE file for full copyright and licensing details.
from copy import deepcopy
from datetime import date
from unittest import TestCase as UnitTestCase
from unittest.mock import patch

from odoo.exceptions import AccessError, ValidationError
from odoo.tests import TransactionCase, new_test_user, tagged

from odoo.addons.nasq_platform.models.entitlement_service import OPERATOR_CONTEXT

from .common import NasqPmoCase
from odoo.addons.nasq_pmo.models.project_task import TEMPLATE_APPLY_MARKER
from odoo.addons.nasq_pmo.models.project_template import validate_template_definition

TEMPLATE = {
    'stages': [
        {'key': 'plan', 'name': 'Plan', 'fold': False},
        {'key': 'delivery', 'name': 'Delivery', 'fold': False},
    ],
    'milestones': [{'key': 'launch', 'name': 'Launch', 'offset_days': 4}],
    'tasks': [
        {
            'key': 'brief', 'name': 'Brief', 'stage_key': 'plan', 'start_offset': 0,
            'duration_days': 1, 'milestone_key': None, 'dependency_keys': [],
        },
        {
            'key': 'build', 'name': 'Build', 'stage_key': 'delivery', 'start_offset': 1,
            'duration_days': 3, 'milestone_key': 'launch', 'dependency_keys': ['brief'],
        },
    ],
}


@tagged('nasq')
class TestProjectTemplates(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.settings_manager = cls._managed_user('template_settings', [
            'pmo.projects.read', 'pmo.projects.create', 'pmo.settings.manage',
            'pmo.tasks.read', 'pmo.tasks.create', 'pmo.tasks.write',
        ])
        cls.creator = cls._managed_user('template_creator', ['pmo.projects.read', 'pmo.projects.create', 'pmo.tasks.read'])
        cls.reader = cls._managed_user('template_reader', ['pmo.projects.read', 'pmo.tasks.read'])
        cls.employee = new_test_user(cls.env, login='template_employee', groups='nasq_core.group_employee')

    @classmethod
    def _managed_user(cls, login, permission_keys):
        user = new_test_user(cls.env, login=login, groups='base.group_user')
        permissions = cls.env['nasq.access.permission'].search([('key', 'in', permission_keys)])
        role = cls.env['nasq.access.role'].create({
            'name_ar': login,
            'permission_ids': [(6, 0, permissions.ids)],
        })
        cls.env['nasq.access.assignment'].create({
            'user_id': user.id, 'role_id': role.id, 'company_id': cls.env.company.id,
        })
        return user

    def test_definition_rejects_duplicates_cycles_and_bad_references(self):
        with self.assertRaises(ValidationError):
            validate_template_definition({**TEMPLATE, 'stages': [TEMPLATE['stages'][0], TEMPLATE['stages'][0]]})
        with self.assertRaises(ValidationError):
            validate_template_definition({
                **TEMPLATE,
                'tasks': [
                    {**TEMPLATE['tasks'][0], 'dependency_keys': ['build']},
                    {**TEMPLATE['tasks'][1], 'dependency_keys': ['brief']},
                ],
            })
        with self.assertRaises(ValidationError):
            validate_template_definition({
                **TEMPLATE,
                'tasks': [{**TEMPLATE['tasks'][0], 'stage_key': ['plan']}],
            })

    def test_company_scoped_settings_crud_and_ordinary_user_denied(self):
        Template = self.env['nasq.project.template']
        with self.assertRaises(AccessError):
            Template.with_user(self.employee).create({'name': 'Blocked', 'definition': TEMPLATE})
        template = Template.with_user(self.settings_manager).create({'name': 'Reusable', 'definition': TEMPLATE})
        self.assertEqual(template.company_id, self.env.company)
        template.with_user(self.settings_manager).write({'name': 'Renamed'})
        self.assertEqual(template.name, 'Renamed')
        other = self.env['res.company'].create({'name': 'Template Other Co'})
        with self.assertRaises(AccessError):
            template.with_user(self.settings_manager).write({'company_id': other.id})

    def test_apply_creates_independent_unfinished_records_and_calendar_dates(self):
        Template = self.env['nasq.project.template']
        template = Template.with_user(self.settings_manager).create({'name': 'Reusable', 'definition': TEMPLATE})
        first = template.with_user(self.settings_manager)._nasq_apply('First', date(2030, 1, 10))
        second = template.with_user(self.settings_manager)._nasq_apply('Second', date(2030, 1, 10))
        self.assertNotEqual(first.id, second.id)
        self.assertNotEqual(first.type_ids.ids, second.type_ids.ids)
        self.assertEqual(first.date_start, date(2030, 1, 10))
        self.assertEqual(first.date, date(2030, 1, 14))
        tasks = self.env['project.task'].with_user(self.settings_manager).search([('project_id', '=', first.id)])
        self.assertEqual(len(tasks), 2)
        self.assertEqual(tasks.filtered(lambda task: task.name == 'Brief').state, '01_in_progress')
        self.assertEqual(tasks.filtered(lambda task: task.name == 'Build').state, '04_waiting_normal')
        self.assertFalse(tasks.filtered(lambda task: task.state in ('1_done', '1_canceled')))
        self.assertFalse(set(first.type_ids.ids) & set(second.type_ids.ids))
        second_tasks = self.env['project.task'].search([('project_id', '=', second.id)])
        self.assertFalse(set(tasks.ids) & set(second_tasks.ids))
        self.assertFalse(set(first.milestone_ids.ids) & set(second.milestone_ids.ids))
        self.assertFalse((tasks | second_tasks).user_ids)
        self.assertFalse((tasks | second_tasks).message_follower_ids)
        self.assertFalse((tasks | second_tasks).activity_ids)
        self.assertFalse((first | second).message_follower_ids)
        self.assertFalse((first | second).activity_ids)
        brief = tasks.filtered(lambda task: task.name == 'Brief')
        self.assertEqual(brief.nasq_planned_start, date(2030, 1, 10))
        self.assertEqual(brief.date_deadline.date(), date(2030, 1, 10))
        self.assertEqual(tasks.filtered(lambda task: task.name == 'Build').depend_on_ids.mapped('name'), ['Brief'])

    def test_apply_rejects_invalid_start_date_before_creating_project(self):
        template = self.env['nasq.project.template'].with_user(self.settings_manager).create({
            'name': 'Reusable', 'definition': TEMPLATE,
        })
        before = self.env['project.project'].with_user(self.settings_manager).search_count([('name', '=', 'Overflow')])
        with self.assertRaises(ValidationError):
            template.with_user(self.settings_manager)._nasq_apply('Overflow', '9999-12-31')
        after = self.env['project.project'].with_user(self.settings_manager).search_count([('name', '=', 'Overflow')])
        self.assertEqual(before, after)

    def test_minimal_creator_scope_and_context_cannot_grant_generic_task_create(self):
        user = self.creator
        self.assertFalse(user.has_group('base.group_system'))
        self.assertFalse(user.has_group('project.group_project_manager'))
        service = self.env['nasq.access.service'].with_user(user)
        self.assertFalse(service._nasq_has_capability(user, 'pmo.tasks.create'))
        template = self.env['nasq.project.template'].create({'name': 'Minimal', 'definition': TEMPLATE}).with_user(user)
        self.assertTrue(template._nasq_can_apply())
        project = template.with_context(
            default_user_ids=[(6, 0, self.employee.ids)],
            default_parent_id=self.env['project.task'].search([], limit=1).id,
            default_nasq_planned_start='2031-01-01',
            default_state='1_done',
            default_message_follower_ids=[(0, 0, {'partner_id': self.employee.partner_id.id})],
        )._nasq_apply('Minimal application', '2030-01-10')
        self.assertEqual(project.user_id, user)
        self.assertNotIn(TEMPLATE_APPLY_MARKER, self.env.cr.precommit.data)
        tasks = self.env['project.task'].with_user(user).search([('project_id', '=', project.id)])
        self.assertEqual(len(tasks), 2)
        self.assertFalse(tasks.user_ids)
        self.assertFalse(tasks.parent_id)
        self.assertFalse(tasks.message_follower_ids)
        with self.assertRaises(AccessError):
            self.env['project.task'].with_user(user).with_context(**{
                TEMPLATE_APPLY_MARKER: (user.id, self.env.company.id, project.id),
            }).create({'name': 'Not from a definition', 'project_id': project.id})
        with self.assertRaises(AccessError):
            self.env['project.task'].with_user(user)._nasq_create_for_template(
                project, {'name': 'No scope', 'project_id': project.id},
            )
        with self.assertRaises(AccessError):
            tasks[:1].copy()
        with self.assertRaises(AccessError):
            self.env['project.task'].with_user(user).create([
                {'name': 'Batch one', 'project_id': project.id},
                {'name': 'Batch two', 'project_id': project.id},
            ])
        self.assertNotIn(TEMPLATE_APPLY_MARKER, self.env.cr.precommit.data)
        with self.assertRaises(AccessError):
            template.with_user(self.reader)._nasq_apply('Denied', '2030-01-10')

    def test_project_only_creator_can_apply_without_granting_generic_task_read(self):
        user = self._managed_user('template_project_only', ['pmo.projects.read', 'pmo.projects.create'])
        service = self.env['nasq.access.service'].with_user(user)
        self.assertFalse(service._nasq_has_capability(user, 'pmo.tasks.read'))
        native = self.env['project.project'].with_user(user)._nasq_create_from_policy(
            'Native project-only', user_id=user.id, date_end='2030-12-31',
        )
        self.assertTrue(native)
        template = self.env['nasq.project.template'].create({'name': 'Project only', 'definition': TEMPLATE}).with_user(user)
        self.assertTrue(template._nasq_can_apply())
        project = template._nasq_apply('Project-only template', '2030-01-10')
        tasks = self.env['project.task'].search([('project_id', '=', project.id)])
        self.assertEqual(len(tasks), 2)
        with self.assertRaises(AccessError):
            tasks.with_user(user).read(['name'])
        self.assertNotIn(TEMPLATE_APPLY_MARKER, self.env.cr.precommit.data)

    def test_project_only_population_read_scope_is_bounded_and_cleaned(self):
        user = self._managed_user('template_scoped_only', ['pmo.projects.read', 'pmo.projects.create'])
        other_user = self._managed_user('template_scope_other', ['pmo.projects.read', 'pmo.projects.create'])
        outside_project = self.env['project.project'].create({
            'name': 'Outside existing project', 'user_id': user.id, 'company_id': self.env.company.id,
        })
        outside_task = self.env['project.task'].create({'name': 'Outside existing task', 'project_id': outside_project.id})
        foreign_company = self.env['res.company'].create({'name': 'Scope foreign company'})
        foreign_project = self.env['project.project'].with_company(foreign_company).create({
            'name': 'Foreign existing project', 'company_id': foreign_company.id,
        })
        foreign_task = self.env['project.task'].create({'name': 'Foreign task', 'project_id': foreign_project.id})
        template = self.env['nasq.project.template'].create({'name': 'Scope', 'definition': TEMPLATE}).with_user(user)
        Task = self.env.registry['project.task']
        original = Task._nasq_set_schedule
        seen = []

        def inspect_scope(task, start, end):
            seen.append(task.id)
            Model = task.env['project.task']
            scope = task.env.cr.precommit.data[TEMPLATE_APPLY_MARKER]
            self.assertEqual(scope, (user.id, self.env.company.id, task.project_id.id))
            self.assertEqual(task.read(['name'])[0]['name'], task.name)
            self.assertEqual(set(Model.search([]).ids), set(seen))
            self.assertEqual(Model.search_count([]), len(seen))
            self.assertEqual(Model.search(['|', ('id', '=', task.id), ('id', '=', outside_task.id)]).ids, task.ids)
            self.assertFalse(Model.search([('id', 'in', (outside_task | foreign_task).ids)]))
            # Odoo's assertRaises(AccessError) clears cr.precommit.data before
            # executing the body. Use unittest for these read-only/guard-first
            # probes, and invalidate field caches without deleting live scope.
            self.env.invalidate_all()
            for ids in ([outside_task.id], [foreign_task.id], [task.id, outside_task.id]):
                records = Model.browse(ids)
                with UnitTestCase.assertRaises(self, AccessError):
                    records.check_access('read')
                with UnitTestCase.assertRaises(self, AccessError):
                    records.read(['name'])
            with UnitTestCase.assertRaises(self, AccessError):
                task.with_user(other_user).read(['name'])
            with UnitTestCase.assertRaises(self, AccessError):
                task.with_company(foreign_company).read(['name'])
            self.assertEqual(task.env.cr.precommit.data.get(TEMPLATE_APPLY_MARKER), scope, 'scope after negative reads')
            self.assertEqual(Model.env.company.id, scope[1], 'original company after negative reads')
            self.assertEqual(Model.env.uid, scope[0], 'original uid after negative reads')
            forged = Model.with_context(**{TEMPLATE_APPLY_MARKER: (user.id, self.env.company.id, outside_project.id)})
            self.assertFalse(forged.search([('id', '=', outside_task.id)]))
            with UnitTestCase.assertRaises(self, AccessError):
                forged.browse(outside_task.id).read(['name'])
            with UnitTestCase.assertRaises(self, AccessError):
                Model.create({'name': 'Outside create denied', 'project_id': outside_project.id})
            with UnitTestCase.assertRaises(self, AccessError):
                Model.browse(outside_task.id).write({'name': 'Outside write denied'})
            return original(task, start, end)

        with patch.object(Task, '_nasq_set_schedule', inspect_scope):
            project = template._nasq_apply('Scoped new project', '2030-01-10')
        self.assertEqual(len(seen), 2)
        self.assertNotIn(TEMPLATE_APPLY_MARKER, self.env.cr.precommit.data)
        Model = self.env['project.task'].with_user(user).with_context(**{
            TEMPLATE_APPLY_MARKER: (user.id, self.env.company.id, project.id),
        })
        for operation in (
            lambda: Model.search([]),
            lambda: Model.browse(seen).read(['name']),
            lambda: Model.browse(seen).write({'name': 'Denied after apply'}),
            lambda: Model.browse(seen[:1]).copy(),
            lambda: Model.create([{'name': 'Batch denied', 'project_id': project.id}]),
        ):
            with self.assertRaises(AccessError):
                operation()

    def test_project_only_result_callback_failure_rolls_back_scope_and_population(self):
        user = self._managed_user('template_result_only', ['pmo.projects.read', 'pmo.projects.create'])
        template = self.env['nasq.project.template'].create({'name': 'Result rollback', 'definition': TEMPLATE}).with_user(user)
        models = ('project.project', 'project.task.type', 'project.milestone', 'project.task')
        before = {model: self.env[model].with_context(active_test=False).search_count([]) for model in models}
        seen = []

        def failed_result(project):
            self.assertFalse(project.env.su)
            tasks = project.env['project.task'].search([('project_id', '=', project.id)])
            seen.extend(tasks.ids)
            self.assertEqual(len(tasks), 2)
            self.assertEqual(len(tasks.read(['name'])), 2)
            self.assertEqual(project.task_count, 2)
            message = 'Result failure after successful population'
            raise ValidationError(message)

        with self.assertRaises(ValidationError):
            template._nasq_apply('Result must roll back', '2030-01-10', serialize=failed_result)
        self.assertEqual(len(seen), 2)
        self.assertNotIn(TEMPLATE_APPLY_MARKER, self.env.cr.precommit.data)
        self.assertFalse(self.env['project.task'].browse(seen).exists())
        self.assertEqual(before, {model: self.env[model].with_context(active_test=False).search_count([]) for model in models})
        with self.assertRaises(AccessError):
            self.env['project.task'].with_user(user).search([])

    def test_mid_application_failure_rolls_back_all_rows_and_scope(self):
        template = self.env['nasq.project.template'].create({'name': 'Rollback', 'definition': TEMPLATE}).with_user(self.creator)
        models = ('project.project', 'project.task.type', 'project.milestone', 'project.task')
        before = {model: self.env[model].with_context(active_test=False).search_count([]) for model in models}
        Task = self.env.registry['project.task']
        original = Task._nasq_set_schedule
        seen = []

        def fail_second(task, start, end):
            seen.append(task.id)
            if len(seen) == 2:
                self.assertEqual(task.env.cr.precommit.data[TEMPLATE_APPLY_MARKER], (self.creator.id, self.env.company.id, task.project_id.id))
                message = 'Controlled failure after both tasks and milestone exist'
                raise ValidationError(message)
            return original(task, start, end)

        with patch.object(Task, '_nasq_set_schedule', fail_second):
            with self.assertRaises(ValidationError):
                template._nasq_apply('Must roll back', '2030-01-10')
        self.assertEqual(len(seen), 2)
        self.assertNotIn(TEMPLATE_APPLY_MARKER, self.env.cr.precommit.data)
        self.assertFalse(self.env['project.task'].browse(seen).exists())
        self.assertEqual(before, {model: self.env[model].with_context(active_test=False).search_count([]) for model in models})

    def test_definition_create_update_and_direct_orm_guards(self):
        Template = self.env['nasq.project.template']
        template = Template.with_user(self.settings_manager).create({'name': 'Original', 'definition': TEMPLATE})
        for user in (self.employee, self.reader, self.creator):
            for operation in (lambda: template.with_user(user).write({'name': 'Denied'}), lambda: template.with_user(user).unlink(), lambda: template.with_user(user).copy()):
                with self.assertRaises(AccessError):
                    operation()
        other = self.env['res.company'].create({'name': 'Foreign templates'})
        foreign = Template.with_company(other).create({'name': 'Foreign', 'definition': TEMPLATE})
        with self.assertRaises(AccessError):
            foreign.with_user(self.settings_manager).with_company(self.env.company).read(['name'])
        for operation in (lambda: foreign.with_user(self.settings_manager).with_company(self.env.company).write({'name': 'Denied'}), lambda: foreign.with_user(self.settings_manager).with_company(self.env.company).unlink()):
            with self.assertRaises(AccessError):
                operation()
        current = Template.with_user(self.settings_manager).with_context(default_company_id=other.id).create({'name': 'Pinned', 'definition': TEMPLATE})
        self.assertEqual(current.company_id, self.env.company)
        with self.assertRaises(AccessError):
            Template.with_user(self.settings_manager).create([
                {'name': 'Valid', 'definition': TEMPLATE},
                {'name': 'Foreign', 'definition': TEMPLATE, 'company_id': other.id},
            ])
        self.assertFalse(Template.search([('name', '=', 'Valid')]))
        invalid_definitions = []
        for collection in ('stages', 'milestones', 'tasks'):
            invalid = deepcopy(TEMPLATE)
            invalid[collection][0]['name'] = '  '
            invalid_definitions.append(invalid)
        duplicate = deepcopy(TEMPLATE)
        duplicate['tasks'][1]['dependency_keys'] = ['brief', 'brief']
        invalid_definitions.append(duplicate)
        for invalid in invalid_definitions:
            with self.assertRaises(ValidationError):
                Template.with_user(self.settings_manager).create({'name': 'Invalid', 'definition': invalid})
            with self.assertRaises(ValidationError):
                template.write({'definition': invalid})
        self.assertEqual(template.definition, TEMPLATE)


@tagged('nasq', 'post_install', '-at_install')
class TestProjectTemplatesHttp(NasqPmoCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.template_manager = cls._template_user('tpl_http_manager', [
            'pmo.projects.read', 'pmo.projects.create', 'pmo.tasks.read', 'pmo.settings.manage',
        ])
        cls.template_creator = cls._template_user('tpl_http_creator', [
            'pmo.projects.read', 'pmo.projects.create', 'pmo.tasks.read',
        ])
        cls.project_only_creator = cls._template_user('tpl_http_project_only', ['pmo.projects.read', 'pmo.projects.create'])
        cls.template_reader = cls._template_user('tpl_http_reader', ['pmo.projects.read', 'pmo.tasks.read'])
        cls.outsider = cls._template_user('tpl_http_outsider', ['hr.employees.read'])
        cls.other_company = cls.env['res.company'].create({'name': 'HTTP foreign templates'})
        cls.foreign_template = cls.env['nasq.project.template'].with_company(cls.other_company).create({'name': 'Foreign HTTP', 'definition': TEMPLATE})
        cls.env['nasq.pmo.settings'].set_values({'project_creators': 'managers'})

    @classmethod
    def _template_user(cls, login, keys):
        user = new_test_user(cls.env, login=login, password='template_http_pass_123', groups='base.group_user')
        role = cls.env['nasq.access.role'].create({
            'name_ar': login,
            'permission_ids': [(6, 0, cls.env['nasq.access.permission'].search([('key', 'in', keys)]).ids)],
        })
        cls.env['nasq.access.assignment'].create({'user_id': user.id, 'role_id': role.id, 'company_id': cls.env.company.id})
        return user

    def _login(self, user):
        self.authenticate(user.login, 'template_http_pass_123')

    def test_http_crud_apply_pagination_and_negative_capabilities(self):
        self._login(self.template_manager)
        response = self.api('POST', '/api/v1/project-templates', {'name': 'HTTP template', 'definition': TEMPLATE})
        self.assertEqual(response.status_code, 201, response.text)
        template_id = response.json()['id']
        path = f'/api/v1/project-templates/{template_id}'
        response = self.api('GET', path)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['definition'], TEMPLATE)
        response = self.api('PATCH', path, {'name': 'HTTP renamed'})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['name'], 'HTTP renamed')
        response = self.api('PATCH', path, {'name': '  '})
        self.assertEqual(response.status_code, 422, response.text)
        for index in range(51):
            self.env['nasq.project.template'].create({'name': f'Paged {index:02}', 'definition': TEMPLATE})
        response = self.api('GET', '/api/v1/project-templates?q=Paged&limit=50&offset=50')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['total'], 51)
        self.assertEqual(len(response.json()['items']), 1)
        self._login(self.template_creator)
        self.assertFalse(self.template_creator.has_group('base.group_system'))
        self.assertFalse(self.template_creator.has_group('project.group_project_manager'))
        response = self.api('GET', path)
        self.assertTrue(response.json()['can_apply'])
        self.assertFalse(response.json()['can_manage'])
        for method, endpoint, payload in [('POST', '/api/v1/project-templates', {'name': 'Denied', 'definition': TEMPLATE}), ('PATCH', path, {'name': 'Denied'}), ('DELETE', path, None)]:
            response = self.api(method, endpoint, payload)
            self.assertEqual(response.status_code, 403, response.text)
        applied = []
        for index in range(2):
            response = self.api('POST', path + '/apply', {'name': f'HTTP applied {index}', 'start_date': '2030-01-10'})
            self.assertEqual(response.status_code, 201, response.text)
            applied.append(response.json()['id'])
        self.assertNotEqual(*applied)
        projects = self.env['project.project'].browse(applied)
        tasks = self.env['project.task'].search([('project_id', 'in', applied)])
        self.assertEqual(len(tasks), 4)
        self.assertEqual(len(projects.type_ids), 4)
        self.assertEqual(len(projects.milestone_ids), 2)
        self.assertFalse(tasks.user_ids)
        self.assertFalse(tasks.message_follower_ids)
        self.assertFalse(tasks.activity_ids)
        with self.assertRaises(AccessError):
            self.env['project.task'].with_user(self.template_creator).create({'name': 'Generic denied', 'project_id': applied[0]})
        self._login(self.template_reader)
        response = self.api('POST', path + '/apply', {'name': 'Denied', 'start_date': '2030-01-10'})
        self.assertEqual(response.status_code, 403, response.text)
        self._login(self.outsider)
        response = self.api('GET', '/api/v1/project-templates')
        self.assertEqual(response.status_code, 403, response.text)
        self._login(self.template_manager)
        response = self.api('DELETE', path)
        self.assertEqual(response.status_code, 204, response.text)
        self.assertEqual(self.api('GET', path).status_code, 404)

    def test_http_apply_at_project_quota_preserves_limit_error_and_population(self):
        template = self.env['nasq.project.template'].create({
            'name': 'Quota template', 'definition': TEMPLATE,
        })
        service = self.env['nasq.entitlement.service'].sudo()
        profile = self.env.ref('nasq_platform.tenant_profile')
        models = ('project.project', 'project.task.type', 'project.milestone', 'project.task')
        before = {
            model: self.env[model].with_context(active_test=False).search_count([])
            for model in models
        }
        project_count = service._nasq_count_projects()
        profile.with_context(**{OPERATOR_CONTEXT: True}).write({
            'features': {**profile.features, 'projects.max_projects': project_count},
        })
        quota_revision = profile.quota_revision

        self._login(self.template_creator)
        path = f'/api/v1/project-templates/{template.id}'
        self.assertTrue(self.api('GET', path).json()['can_apply'])
        response = self.api('POST', path + '/apply', {
            'name': 'Over quota template', 'start_date': '2030-01-10',
        })

        self.assertEqual(response.status_code, 403, response.text)
        self.assertEqual(response.json()['code'], 'feature_not_included')
        self.assertEqual(response.json()['details'], {
            'reason': 'limit', 'limit_key': 'projects.max_projects',
        })
        self.assertEqual(service._nasq_count_projects(), project_count)
        self.assertEqual(before, {
            model: self.env[model].with_context(active_test=False).search_count([])
            for model in models
        })
        profile.invalidate_recordset(['quota_revision'])
        self.assertEqual(profile.quota_revision, quota_revision)

    def test_http_foreign_company_and_mid_apply_rollback(self):
        self._login(self.template_manager)
        path = f'/api/v1/project-templates/{self.foreign_template.id}'
        for method, suffix, payload in [('GET', '', None), ('PATCH', '', {'name': 'Denied'}), ('DELETE', '', None), ('POST', '/apply', {'name': 'Denied', 'start_date': '2030-01-10'})]:
            response = self.api(method, path + suffix, payload)
            self.assertEqual(response.status_code, 403, response.text)
        definition = deepcopy(TEMPLATE)
        definition['tasks'][1]['start_offset'] = -2
        template = self.env['nasq.project.template'].create({'name': 'HTTP underflow', 'definition': definition})
        models = ('project.project', 'project.task.type', 'project.milestone', 'project.task')
        before = {model: self.env[model].with_context(active_test=False).search_count([]) for model in models}
        response = self.api('POST', f'/api/v1/project-templates/{template.id}/apply', {'name': 'HTTP rollback', 'start_date': '0001-01-01'})
        self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(before, {model: self.env[model].with_context(active_test=False).search_count([]) for model in models})

    def test_http_project_only_creator_applies_and_serializes_without_task_permission(self):
        user = self.project_only_creator
        self.assertFalse(user.has_group('base.group_system'))
        self.assertFalse(user.has_group('project.group_project_manager'))
        service = self.env['nasq.access.service'].with_user(user)
        self.assertFalse(service._nasq_has_capability(user, 'pmo.tasks.read'))
        self.assertFalse(service._nasq_has_capability(user, 'pmo.tasks.create'))
        template = self.env['nasq.project.template'].create({'name': 'HTTP project only', 'definition': TEMPLATE})
        self._login(user)
        path = f'/api/v1/project-templates/{template.id}'
        response = self.api('GET', path)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.json()['can_apply'])
        response = self.api('POST', path + '/apply', {'name': 'HTTP project-only apply', 'start_date': '2030-01-10'})
        self.assertEqual(response.status_code, 201, response.text)
        result = response.json()
        self.assertEqual(result['name'], 'HTTP project-only apply')
        self.assertEqual(result['task_count'], 2)
        self.assertEqual(result['closed_task_count'], 0)
        self.assertEqual(result['milestone_count'], 1)
        self.assertEqual(len(result['stages']), 2)
        self.assertEqual(result['manager']['id'], user.id)
        self.assertTrue(result['can_manage'])
        tasks = self.env['project.task'].search([('project_id', '=', result['id'])])
        self.assertEqual(len(tasks), 2)
        self.assertFalse(tasks.user_ids)
        self.assertFalse(tasks.message_follower_ids)
        self.assertFalse(tasks.activity_ids)
        # A new HTTP request gets no remaining template privilege, even when
        # it addresses the same freshly created project's tasks.
        response = self.api('GET', '/api/v1/tasks')
        self.assertEqual(response.status_code, 403, response.text)
        response = self.api('GET', f'/api/v1/tasks/{tasks[0].id}')
        self.assertEqual(response.status_code, 403, response.text)
        with self.assertRaises(AccessError):
            tasks.with_user(user).read(['name'])
        self.assertFalse(service._nasq_has_capability(user, 'pmo.tasks.read'))
        self.assertNotIn(TEMPLATE_APPLY_MARKER, self.env.cr.precommit.data)
