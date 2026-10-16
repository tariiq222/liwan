# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import SUPERUSER_ID
from odoo.exceptions import ValidationError
from odoo.fields import Command
from odoo.tests import new_test_user, tagged

from odoo.addons.webvue_api.controllers.common import ApiError
from odoo.addons.webvue_tasks.tests.common import WebVueTasksCase


@tagged('post_install', '-at_install', 'webvue', 'webvue_tasks')
class TestMyTaskService(WebVueTasksCase):
    def service(self, user):
        return self.env['webvue.my.task.service'].with_user(user)

    def create(self, user, name='t', **vals):
        return self.service(user)._create_task({'name': name, **vals})

    def list_ids(self, user, **kwargs):
        args = {
            'closed': False, 'q': None, 'assigned': True, 'created': True,
            'sort': 'deadline', 'limit': 50, 'offset': 0, **kwargs,
        }
        rows, _total = self.service(user)._search_list(**args)
        return set(rows.ids)

    def bridge_installed(self):
        module = self.env['ir.module.module'].sudo().search(
            [('name', '=', 'webvue_tasks_pmo'), ('state', '=', 'installed')])
        return bool(module)

    def assertApiError(self, status, code, func, *args, field=None, **kwargs):
        with self.assertRaises(ApiError) as cm:
            func(*args, **kwargs)
        self.assertEqual((cm.exception.status, cm.exception.code), (status, code))
        if field:
            self.assertEqual(cm.exception.field, field)

    def _managed_user(self, login, keys):
        user = new_test_user(self.env, login=login, groups='base.group_user')
        permissions = self.env['webvue.access.permission'].search([('key', 'in', keys)])
        self.assertEqual(set(permissions.mapped('key')), set(keys))
        role = self.env['webvue.access.role'].create({
            'name_ar': login, 'permission_ids': [Command.set(permissions.ids)],
        })
        self.env['webvue.access.assignment'].create({
            'user_id': user.id, 'role_id': role.id, 'company_id': self.env.company.id,
        })
        return user

    # create

    def test_create_sets_company_and_state(self):
        task = self.service(self.alice)._create_task({'name': 'Buy milk'})
        self.assertTrue(task.webvue_personal)
        self.assertEqual(task.company_id, self.alice.company_id)
        self.assertEqual(task.state, '01_in_progress')

    def test_create_without_pmo_and_with_pmo_both_work(self):
        # Runs in both configurations: standalone webvue_tasks and the full release list
        # (where the webvue_tasks_pmo bridge lets PMO accept a project-less create).
        task = self.create(self.alice, 'Plain', description='x', priority='high',
                           date_deadline='2026-12-01', assignees=[self.bob.id])
        self.assertTrue(task.webvue_personal)
        self.assertFalse(task.project_id)
        self.assertEqual(task.user_ids, self.alice | self.bob)
        child = self.create(self.alice, 'Sub', parent_id=task.id)
        self.assertEqual(child.webvue_parent_id, task)

    def test_create_maps_fields(self):
        task = self.create(self.alice, '  Spaced  ', description='a < b\nsecond line',
                           priority='high', date_deadline='2026-12-01T09:30:00Z')
        self.assertEqual(task.name, 'Spaced')
        self.assertEqual(task.priority, '1')
        self.assertIn('a &lt; b', task.description)
        self.assertIn('second line', task.description)
        self.assertNotIn('<script', task.description)
        self.assertEqual(str(task.date_deadline), '2026-12-01 09:30:00')
        self.assertEqual(self.create(self.alice, 'n').priority, '0')
        self.assertEqual(self.create(self.alice, 'n', priority='normal').priority, '0')

    def test_create_validation(self):
        service = self.service(self.alice)
        for vals, field in (
            ({}, 'name'),
            ({'name': '   '}, 'name'),
            ({'name': 'x' * 256}, 'name'),
            ({'name': 123}, 'name'),
            ({'name': 'a', 'priority': 'urgent'}, 'priority'),
            ({'name': 'a', 'priority': []}, 'priority'),
            ({'name': 'a', 'priority': {}}, 'priority'),
            ({'name': 'a', 'assignees': [2 ** 31]}, 'assignees'),
            ({'name': 'a', 'parent_id': 2 ** 31}, 'parent_id'),
            ({'name': 'a', 'date_deadline': 'tomorrow'}, 'date_deadline'),
            ({'name': 'a', 'date_deadline': '2026-12-01T09:00:00+03:00'}, 'date_deadline'),
            ({'name': 'a', 'description': 5}, 'description'),
            ({'name': 'a', 'assignees': 'bob'}, 'assignees'),
            ({'name': 'a', 'assignees': [True]}, 'assignees'),
            ({'name': 'a', 'project_id': 1}, 'project_id'),
            ({'name': 'a', 'state': '1_done'}, 'state'),
            ({'name': 'a', 'parent_id': 'x'}, 'parent_id'),
        ):
            with self.subTest(vals=vals):
                self.assertApiError(422, 'invalid', service._create_task, vals, field=field)
        self.assertEqual(self.create(self.alice, 'x' * 255).name, 'x' * 255)

    def test_assignee_must_be_directory_person(self):
        inactive = new_test_user(self.env, login='gone', active=False, email=False)
        with self.assertRaises(ApiError) as cm:
            self.service(self.alice)._create_task({'name': 'a', 'assignees': [inactive.id]})
        self.assertEqual(cm.exception.field, 'assignees')
        # A user of another company is outside the /people population too.
        self.assertApiError(
            422, 'invalid', self.service(self.alice)._create_task,
            {'name': 'a', 'assignees': [self.other_company_user.id]}, field='assignees')
        self.assertApiError(
            422, 'invalid', self.service(self.alice)._create_task,
            {'name': 'a', 'assignees': [self.env['res.users'].search([], order='id desc', limit=1).id + 99]},
            field='assignees')

    # sub-tasks

    def test_subtask_depth_limit(self):
        parent = self.service(self.alice)._create_task({'name': 'p'})
        child = self.service(self.alice)._create_task({'name': 'c', 'parent_id': parent.id})
        self.assertEqual(child.webvue_parent_id, parent)
        self.assertFalse(child.parent_id)   # Odoo's own parent_id is never used
        with self.assertRaises(ApiError) as cm:
            self.service(self.alice)._create_task({'name': 'gc', 'parent_id': child.id})
        self.assertEqual((cm.exception.status, cm.exception.code), (422, 'invalid'))

    def test_subtask_parent_must_be_readable_personal(self):
        other = self.service(self.alice)._create_task({'name': 'a'})
        with self.assertRaises(ApiError):
            self.service(self.carol)._create_task({'name': 'x', 'parent_id': other.id})
        # A project task is not a parent either.
        project = self.env['project.project'].create({'name': 'p', 'company_id': self.env.company.id})
        project_task = self.env['project.task'].create(
            {'name': 'pt', 'project_id': project.id, 'user_ids': [Command.set([self.alice.id])]})
        self.assertApiError(422, 'invalid', self.service(self.alice)._create_task,
                            {'name': 'x', 'parent_id': project_task.id}, field='parent_id')
        self.assertApiError(422, 'invalid', self.service(self.alice)._create_task,
                            {'name': 'x', 'parent_id': 0}, field='parent_id')

    def test_subtask_parent_in_other_company_rejected(self):
        self.alice.sudo().company_ids = [Command.link(self.other_company.id)]
        role = self.env.ref('webvue_core.role_employee')
        for company in (self.env.company, self.other_company):
            self.env['webvue.access.assignment'].create({
                'user_id': self.alice.id, 'role_id': role.id, 'company_id': company.id})
        other_env = self.service(self.alice).with_context(
            allowed_company_ids=[self.other_company.id, self.env.company.id])
        self.assertEqual(other_env.env.company, self.other_company)
        foreign_parent = other_env._create_task({'name': 'abroad'})
        self.assertEqual(foreign_parent.company_id, self.other_company)
        # Back in the main company the parent is neither visible nor in the company.
        self.assertApiError(422, 'invalid', self.service(self.alice)._create_task,
                            {'name': 'x', 'parent_id': foreign_parent.id}, field='parent_id')

    def test_subtask_model_constraint(self):
        parent = self.create(self.alice, 'p')
        child = self.create(self.alice, 'c', parent_id=parent.id)
        # Users cannot write webvue_parent_id after create (PMO's field whitelist); the
        # constraint is the last line of defence for any other writer, so use sudo here.
        with self.assertRaises(ValidationError):
            parent.sudo().webvue_parent_id = child  # cycle / depth 2
        with self.assertRaises(ValidationError):
            parent.sudo().webvue_parent_id = parent
        project = self.env['project.project'].create({'name': 'p', 'company_id': self.env.company.id})
        with self.assertRaises(ValidationError):
            child.sudo().project_id = project
        # A parent in another company, and a task that already has sub-tasks, are refused too.
        foreign = self.env['project.task'].with_company(self.other_company).create(
            {'name': 'abroad', 'company_id': self.other_company.id})
        with self.assertRaises(ValidationError):
            self.env['project.task'].create({
                'name': 'x', 'company_id': self.env.company.id, 'webvue_parent_id': foreign.id})
        other_parent = self.create(self.alice, 'other parent')
        with self.assertRaises(ValidationError):
            parent.sudo().webvue_parent_id = other_parent  # parent already has a child
        # A project task cannot become a sub-task of a personal task.
        project_task = self.env['project.task'].create({'name': 'pt', 'project_id': project.id})
        with self.assertRaises(ValidationError):
            project_task.sudo().webvue_parent_id = parent

    def test_subtasks_excluded_from_the_list_and_listed_on_the_parent(self):
        parent = self.create(self.alice, 'p')
        child = self.create(self.alice, 'c', parent_id=parent.id)
        self.assertEqual(self.list_ids(self.alice), {parent.id})
        self.assertEqual(parent.with_user(self.alice).webvue_child_ids, child)
        self.assertEqual(self.service(self.alice)._get_personal(child.id), child)

    def test_subtask_creator_and_assignee_can_toggle_done(self):
        parent = self.create(self.alice, 'p', assignees=[self.alice.id, self.bob.id])
        child = self.create(self.alice, 'c', parent_id=parent.id, assignees=[self.bob.id])
        self.assertEqual(child.create_uid, self.alice)
        for user in (self.alice, self.bob):
            service = self.service(user)
            task = service._transition(child.with_user(user), 'done')
            self.assertEqual(task.state, '1_done', user.login)
            task = service._transition(task, 'reopen')
            self.assertEqual(task.state, '01_in_progress', user.login)
            self.assertTrue(service._allowed_actions(task)['write'])
        self.assertApiError(404, 'not_found', self.service(self.carol)._get_personal, child.id)

    # transitions and actions

    def test_transitions_and_allowed_actions(self):
        t = self.service(self.alice)._create_task({'name': 'a'})
        self.assertEqual(self.service(self.alice)._allowed_actions(t),
                         {'write': True, 'done': True, 'reopen': False, 'cancel': True, 'convert': False})
        t = self.service(self.alice)._transition(t, 'done')
        self.assertEqual(t.state, '1_done')
        self.assertTrue(self.service(self.alice)._allowed_actions(t)['reopen'])
        with self.assertRaises(ApiError):
            self.service(self.alice)._transition(t, 'done')   # 422 invalid

    def test_transition_matrix(self):
        service = self.service(self.alice)
        task = self.create(self.alice)
        self.assertApiError(422, 'invalid', service._transition, task, 'reopen')
        self.assertApiError(422, 'invalid', service._transition, task, 'explode', field='action')
        self.assertApiError(422, 'invalid', service._transition, task, [], field='action')
        self.assertApiError(422, 'invalid', service._transition, task, {}, field='action')
        task = service._transition(task, 'cancel')
        self.assertEqual(task.state, '1_canceled')
        self.assertEqual(service._allowed_actions(task),
                         {'write': True, 'done': False, 'reopen': True, 'cancel': False, 'convert': False})
        self.assertApiError(422, 'invalid', service._transition, task, 'done')
        self.assertApiError(422, 'invalid', service._transition, task, 'cancel')
        task = service._transition(task, 'reopen')
        self.assertEqual(task.state, '01_in_progress')
        task = service._transition(task, 'done')
        self.assertEqual(service._transition(task, 'reopen').state, '01_in_progress')

    def _creator_only_task(self):
        """A task alice created and then handed to bob alone: alice is creator, not assignee.

        The three users get the employee role: the write rule of the creator belongs to the
        tasks.tasks.write capability group, which the role assignment syncs onto the user.
        """
        role = self.env.ref('webvue_core.role_employee')
        for user in (self.alice, self.bob, self.carol):
            self.env['webvue.access.assignment'].create({
                'user_id': user.id, 'role_id': role.id, 'company_id': self.env.company.id})
            self.assertTrue(user.has_group('webvue_tasks.group_cap_tasks_tasks_write'))
        task = self.create(self.alice, 'a', assignees=[self.bob.id])
        task = self.service(self.alice)._update_task(task, {'assignees': [self.bob.id]})
        self.assertNotIn(self.alice, task.user_ids)
        self.assertEqual(task.create_uid, self.alice)
        return task

    def test_creator_who_is_not_assignee_can_write_in_both_configs(self):
        task = self._creator_only_task()
        service = self.service(self.alice)
        self.assertTrue(task.with_user(self.alice).has_access('write'))
        self.assertEqual(service._allowed_actions(task), {
            'write': True, 'done': True, 'reopen': False, 'cancel': True, 'convert': False})
        task = service._update_task(task, {'name': 'renamed'})
        self.assertEqual(task.name, 'renamed')
        self.assertEqual(service._transition(task, 'done').state, '1_done')
        self.assertTrue(service._allowed_actions(task)['reopen'])
        self.assertEqual(service._transition(task, 'reopen').state, '01_in_progress')
        # The assignee still writes.
        self.assertTrue(self.service(self.bob)._allowed_actions(task)['write'])

    def test_creator_who_is_not_assignee_can_add_a_subtask(self):
        parent = self._creator_only_task()
        child = self.create(self.alice, 'c', parent_id=parent.id)
        self.assertEqual(child.webvue_parent_id, parent)

    def test_stranger_and_follower_still_cannot_write(self):
        task = self._creator_only_task()
        task.sudo().message_subscribe(partner_ids=[self.carol.partner_id.id])
        service = self.service(self.carol)
        self.assertFalse(task.with_user(self.carol).has_access('read'))
        self.assertApiError(404, 'not_found', service._update_task, task, {'name': 'x'})
        self.assertApiError(404, 'not_found', service._transition, task, 'done')
        self.assertEqual(service._allowed_actions(task)['write'], False)
        self.assertEqual(task.name, 'a')

    def test_allowed_actions_of_a_project_task_are_all_false(self):
        if not self.bridge_installed():
            self.skipTest('only the webvue_tasks_pmo bridge lists project tasks')
        project = self.env['project.project'].create({'name': 'p', 'company_id': self.env.company.id})
        project_task = self.env['project.task'].create(
            {'name': 'pt', 'project_id': project.id, 'user_ids': [Command.set([self.alice.id])]})
        self.assertEqual(self.service(self.alice)._allowed_actions(project_task), {
            'write': False, 'done': False, 'reopen': False, 'cancel': False, 'convert': False})

    def test_update(self):
        task = self.create(self.alice, 'a', priority='high')
        service = self.service(self.alice)
        task = service._update_task(task, {'name': ' b ', 'description': 'hi', 'priority': 'normal',
                                           'date_deadline': '2026-12-31', 'assignees': [self.alice.id, self.bob.id]})
        self.assertEqual((task.name, task.priority), ('b', '0'))
        self.assertEqual(str(task.date_deadline), '2026-12-31 00:00:00')
        self.assertEqual(task.user_ids, self.alice | self.bob)
        task = service._update_task(task, {'date_deadline': None, 'description': None})
        self.assertFalse(task.date_deadline)
        self.assertFalse(task.description)
        self.assertEqual(task.name, 'b')
        self.assertApiError(422, 'invalid', service._update_task, task, {'parent_id': 5}, field='parent_id')
        self.assertApiError(422, 'invalid', service._update_task, task, {'name': ''}, field='name')
        self.assertApiError(422, 'invalid', service._update_task, task, {'state': '1_done'}, field='state')
        self.assertApiError(422, 'invalid', service._update_task, task, {'assignees': [-1]}, field='assignees')

    def test_stranger_cannot_update_or_transition(self):
        task = self.create(self.alice)
        carol = self.service(self.carol)
        self.assertApiError(404, 'not_found', carol._update_task, task, {'name': 'x'})
        self.assertApiError(404, 'not_found', carol._transition, task, 'done')
        self.assertEqual(task.name, 't')

    def test_get_personal(self):
        task = self.create(self.alice)
        self.assertEqual(self.service(self.alice)._get_personal(task.id), task)
        self.assertApiError(404, 'not_found', self.service(self.carol)._get_personal, task.id)
        self.assertApiError(404, 'not_found', self.service(self.alice)._get_personal, task.id + 10000)
        self.assertApiError(404, 'not_found', self.service(self.alice)._get_personal, 0)
        project = self.env['project.project'].create({'name': 'p', 'company_id': self.env.company.id})
        project_task = self.env['project.task'].create(
            {'name': 'pt', 'project_id': project.id, 'user_ids': [Command.set([self.alice.id])]})
        self.assertApiError(404, 'not_found', self.service(self.alice)._get_personal, project_task.id)
        # A project task handed to the mutators is refused too.
        self.assertApiError(404, 'not_found', self.service(self.alice)._update_task,
                            project_task, {'name': 'x'})
        self.assertApiError(404, 'not_found', self.service(self.alice)._transition, project_task, 'done')

    # capabilities

    def test_every_service_method_checks_its_capability(self):
        task = self.create(self.alice)
        nobody = new_test_user(self.env, login='tasks_nocap_svc', groups='base.group_user')
        reader = self._managed_user('tasks_reader_svc', ['tasks.tasks.read'])
        read_only_calls = (
            (self.service(reader)._create_task, ({'name': 'x'},)),
            (self.service(reader)._update_task, (task, {'name': 'x'})),
            (self.service(reader)._transition, (task, 'done')),
        )
        for func, args in read_only_calls:
            with self.subTest(user='reader', method=func.__name__):
                self.assertApiError(403, 'forbidden', func, *args)
        for func, args in (
            (self.service(nobody)._create_task, ({'name': 'x'},)),
            (self.service(nobody)._update_task, (task, {'name': 'x'})),
            (self.service(nobody)._transition, (task, 'done')),
            (self.service(nobody)._get_personal, (task.id,)),
        ):
            with self.subTest(user='nobody', method=func.__name__):
                self.assertApiError(403, 'forbidden', func, *args)
        with self.subTest(user='nobody', method='_transition with an unknown action'):
            self.assertApiError(403, 'forbidden', self.service(nobody)._transition, task, 'explode')
        with self.subTest(user='nobody', method='_search_list'):
            self.assertApiError(
                403, 'forbidden', self.service(nobody)._search_list,
                closed=False, q=None, assigned=True, created=True, sort='deadline', limit=5, offset=0)
        self.assertEqual(task.name, 't')
        self.assertEqual(self.service(nobody)._allowed_actions(task)['write'], False)

    # list

    def test_parent_assignee_updates_and_closes_a_subtask_made_by_another_assignee(self):
        role = self.env.ref('webvue_core.role_employee')
        for user in (self.alice, self.bob):
            self.env['webvue.access.assignment'].create({
                'user_id': user.id, 'role_id': role.id, 'company_id': self.env.company.id})
        parent = self.create(self.alice, 'parent', assignees=[self.alice.id, self.bob.id])
        child = self.create(self.bob, 'child', parent_id=parent.id, assignees=[self.bob.id])
        self.assertNotIn(self.alice, child.user_ids)
        alice = self.service(self.alice)
        self.assertEqual(alice._get_personal(child.id), child)
        self.assertEqual(alice._update_task(child, {'name': 'by alice'}).name, 'by alice')
        self.assertEqual(alice._transition(child, 'done').state, '1_done')
        self.assertTrue(alice._allowed_actions(child)['write'])
        self.assertApiError(404, 'not_found', self.service(self.carol)._get_personal, child.id)

    def test_welcome_todo_excluded(self):
        self.env['project.task'].with_user(SUPERUSER_ID).create(
            {'name': 'Welcome!', 'company_id': self.alice.company_id.id,
             'user_ids': [(6, 0, [self.alice.id])]})
        rows, total = self.service(self.alice)._search_list(
            closed=False, q=None, assigned=True, created=True, sort='deadline', limit=50, offset=0)
        self.assertNotIn('Welcome!', rows.mapped('name'))
        self.assertEqual(total, len(rows))

    def test_list_scopes_and_closed_split(self):
        mine = self.create(self.alice, 'mine')                                   # alice creator + assignee
        gave = self.create(self.alice, 'gave', assignees=[self.bob.id])         # created by alice ...
        gave = self.service(self.alice)._update_task(gave, {'assignees': [self.bob.id]})  # ... bob only
        got = self.create(self.bob, 'got', assignees=[self.alice.id])           # created by bob ...
        got = self.service(self.bob)._update_task(got, {'assignees': [self.alice.id]})    # ... alice only
        self.create(self.bob, 'private')                                         # alice has no part in it
        self.assertEqual(self.list_ids(self.alice), {mine.id, gave.id, got.id})
        self.assertEqual(self.list_ids(self.alice, assigned=False), {mine.id, gave.id})
        self.assertEqual(self.list_ids(self.alice, created=False), {mine.id, got.id})
        self.assertEqual(self.list_ids(self.alice, assigned=False, created=False), set())
        # closed=1 shows done and cancelled only.
        done = self.service(self.alice)._transition(mine, 'done')
        cancelled = self.service(self.alice)._transition(
            self.create(self.alice, 'dropped'), 'cancel')
        self.assertEqual(self.list_ids(self.alice, closed=True), {done.id, cancelled.id})
        self.assertEqual(self.list_ids(self.alice), {gave.id, got.id})
        # a stranger sees nothing of it
        self.assertEqual(self.list_ids(self.carol), set())
        self.assertEqual(self.list_ids(self.carol, closed=True), set())

    def test_list_search_sort_and_paging(self):
        late = self.create(self.alice, 'Zeta', date_deadline='2026-12-31')
        soon = self.create(self.alice, 'Alpha', date_deadline='2026-11-01')
        none = self.create(self.alice, 'Mid')
        service = self.service(self.alice)

        def rows(**kwargs):
            args = {'closed': False, 'q': None, 'assigned': True, 'created': True,
                    'sort': 'deadline', 'limit': 50, 'offset': 0, **kwargs}
            return service._search_list(**args)

        self.assertEqual(rows()[0].ids, [soon.id, late.id, none.id])    # deadline, nulls last
        self.assertEqual(rows(sort='name')[0].ids, [soon.id, none.id, late.id])
        self.assertEqual(rows(sort='created')[0].ids, [none.id, soon.id, late.id])
        found, total = rows(q='alp')
        self.assertEqual((found.ids, total), ([soon.id], 1))
        page, total = rows(limit=2, offset=1)
        self.assertEqual((page.ids, total), ([late.id, none.id], 3))
        page, total = rows(limit=1000)
        self.assertEqual(total, 3)
        self.assertApiError(422, 'invalid', service._search_list, closed=False, q=None, assigned=True,
                            created=True, sort='bogus', limit=5, offset=0, field='sort')

    def test_list_search_is_literal_and_paging_is_clamped(self):
        percent = self.create(self.alice, 'a%b')
        underscore = self.create(self.alice, 'a_b')
        self.create(self.alice, 'axb')
        self.create(self.alice, 'azzb')

        def rows(**kwargs):
            args = {'closed': False, 'q': None, 'assigned': True, 'created': True,
                    'sort': 'name', 'limit': 50, 'offset': 0, **kwargs}
            return self.service(self.alice)._search_list(**args)

        self.assertEqual(rows(q='a%b')[0], percent)
        self.assertEqual(rows(q='a_b')[0], underscore)
        for limit in (0, -5):
            page, total = rows(limit=limit)
            self.assertEqual((len(page), total), (1, 4))
        self.assertEqual(rows(offset=-3), rows(offset=0))

    def test_list_limit_is_capped(self):
        self.env['project.task'].with_user(self.alice).create([{
            'name': f'bulk {i}', 'company_id': self.alice.company_id.id,
            'user_ids': [Command.set([self.alice.id])],
        } for i in range(101)])
        rows, total = self.service(self.alice)._search_list(
            closed=False, q=None, assigned=True, created=True, sort='created', limit=1000, offset=0)
        self.assertEqual((len(rows), total), (100, 101))

    def test_list_default_hook_lists_personal_only(self):
        if self.bridge_installed():
            self.skipTest('the webvue_tasks_pmo bridge adds project tasks; covered by its own tests')
        project = self.env['project.project'].create({'name': 'p', 'company_id': self.env.company.id})
        project_task = self.env['project.task'].create(
            {'name': 'pt', 'project_id': project.id, 'user_ids': [Command.set([self.alice.id])]})
        personal = self.create(self.alice, 'mine')
        self.assertEqual(self.list_ids(self.alice), {personal.id})
        self.assertNotIn(project_task.id, self.list_ids(self.alice))
        self.assertEqual(self.env['webvue.task.links'].with_user(self.alice)._webvue_project_ref(personal), None)

    def test_links_defaults(self):
        if self.bridge_installed():
            self.skipTest('the webvue_tasks_pmo bridge overrides the hooks')
        links = self.env['webvue.task.links'].with_user(self.alice)
        task = self.create(self.alice)
        self.assertFalse(self.env['project.task'].search(links._webvue_project_task_domain(self.alice.id)))
        self.assertIsNone(links._webvue_project_ref(task))
        self.assertFalse(links._webvue_can_convert(task))
