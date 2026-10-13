# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from odoo.addons.nasq_tasks.tests.routes_common import BASE, TasksRoutesCase


@tagged('post_install', '-at_install', 'nasq', 'nasq_tasks')
class TestMyTasksRoutes(TasksRoutesCase):
    def create_as(self, login, **vals):
        return self.ok(login, 'POST', BASE, {'name': 'Task', **vals})

    # create and read

    def test_create_then_get_detail(self):
        created = self.create_as(
            'tasks_alice', name='Buy milk', description='two liters', priority='high',
            date_deadline='2026-12-01T00:00:00Z', assignees=[self.bob.id])
        detail = self.ok('tasks_alice', 'GET', self.task_path(created['id']))
        # The order of the assignees is not part of the contract.
        for body in (detail, created):
            body['assignees'].sort(key=lambda person: person['id'])
        self.assertEqual(detail, created)
        self.assertEqual(detail['name'], 'Buy milk')
        self.assertEqual(detail['state'], 'open')
        self.assertEqual(detail['priority'], 'high')
        self.assertEqual(detail['description'], 'two liters')
        self.assertEqual({a['id'] for a in detail['assignees']}, {self.alice.id, self.bob.id})
        self.assertEqual(detail['creator']['id'], self.alice.id)
        self.assertTrue(detail['allowed_actions']['write'])
        # An assignee who did not create it reads it too.
        self.assertEqual(self.ok('tasks_bob', 'GET', self.task_path(created['id']))['id'], created['id'])

    def test_assignee_can_patch(self):
        created = self.create_as('tasks_alice', assignees=[self.bob.id])
        patched = self.ok('tasks_bob', 'PATCH', self.task_path(created['id']),
                          {'name': 'Renamed', 'priority': 'high'})
        self.assertEqual((patched['name'], patched['priority']), ('Renamed', 'high'))
        self.assertEqual(self.ok('tasks_alice', 'GET', self.task_path(created['id']))['name'], 'Renamed')

    def test_patch_clears_nullable_fields(self):
        created = self.create_as('tasks_alice', description='x', date_deadline='2026-12-01T00:00:00Z')
        patched = self.ok('tasks_alice', 'PATCH', self.task_path(created['id']),
                          {'description': None, 'date_deadline': None})
        self.assertEqual((patched['description'], patched['date_deadline']), ('', None))

    def test_stranger_gets_404_on_detail_and_patch_and_done(self):
        created = self.create_as('tasks_alice', assignees=[])
        for method, suffix, body in (
            ('GET', '', None), ('PATCH', '', {'name': 'x'}), ('POST', '/done', None),
            ('POST', '/reopen', None), ('POST', '/cancel', None),
        ):
            with self.subTest(method=method, suffix=suffix):
                self.assertError(
                    self.call('tasks_carol', method, self.task_path(created['id'], suffix), body),
                    404, 'not_found')
        self.assertEqual(self.ok('tasks_alice', 'GET', self.task_path(created['id']))['state'], 'open')

    def test_project_task_id_is_404_for_all_methods(self):
        task = self.make_project_task()
        for method, suffix, body in (
            ('GET', '', None), ('PATCH', '', {'name': 'x'}), ('POST', '/done', None),
            ('POST', '/reopen', None), ('POST', '/cancel', None),
        ):
            with self.subTest(method=method, suffix=suffix):
                self.assertError(
                    self.call('tasks_alice', method, self.task_path(task.id, suffix), body),
                    404, 'not_found')
        self.assertEqual(task.name, 'Project task')
        self.assertEqual(task.state, '01_in_progress')

    def test_missing_task_id_is_404(self):
        for method, suffix, body in (
            ('GET', '', None), ('PATCH', '', {'name': 'x'}), ('POST', '/done', None),
        ):
            with self.subTest(method=method):
                self.assertError(
                    self.call('tasks_alice', method, self.task_path(999999999, suffix), body),
                    404, 'not_found')

    # validation

    def test_validation_errors_have_field(self):
        created = self.create_as('tasks_alice')
        cases = (
            ({'name': ''}, 'name'),
            ({'name': 'x' * 300}, 'name'),
            ({'name': 'ok', 'assignees': [999999999]}, 'assignees'),
            ({'name': 'ok', 'priority': 'urgent'}, 'priority'),
            ({'name': 'ok', 'date_deadline': 'tomorrow'}, 'date_deadline'),
            ({'name': 'ok', 'parent_id': 999999999}, 'parent_id'),
            ({}, 'name'),
        )
        for body, field in cases:
            with self.subTest(body=body):
                self.assertError(self.call('tasks_alice', 'POST', BASE, body), 422, 'invalid', field)
        self.assertError(
            self.call('tasks_alice', 'PATCH', self.task_path(created['id']), {'name': ''}),
            422, 'invalid', 'name')
        for query, field in (
            ('closed=2', 'closed'), ('closed=yes', 'closed'), ('assigned=you', 'assigned'),
            ('created=1', 'created'), ('sort=nope', 'sort'), ('limit=0', 'limit'),
            ('limit=abc', 'limit'), ('limit=-1', 'limit'), ('offset=-1', 'offset'),
            ('offset=1.5', 'offset'),
        ):
            with self.subTest(query=query):
                self.assertError(self.call('tasks_alice', 'GET', f'{BASE}?{query}'), 422, 'invalid', field)

    def test_route_rejects_malformed_bodies(self):
        created = self.create_as('tasks_alice')
        path = self.task_path(created['id'])
        for body in ([], ['name'], 'name', 5, None):
            with self.subTest(body=body):
                status, payload = self.call('tasks_alice', 'POST', BASE, body)
                self.assertEqual(status, 422, payload)
                self.assertEqual(payload['code'], 'invalid')
                status, payload = self.call('tasks_alice', 'PATCH', path, body)
                self.assertEqual(status, 422, payload)
        for body, field in (
            ({'name': ['a']}, 'name'),
            ({'name': 5}, 'name'),
            ({'name': 'ok', 'assignees': 'alice'}, 'assignees'),
            ({'name': 'ok', 'assignees': [True]}, 'assignees'),
            ({'name': 'ok', 'assignees': ['1']}, 'assignees'),
            ({'name': 'ok', 'priority': {'level': 'high'}}, 'priority'),
            ({'name': 'ok', 'priority': ['high']}, 'priority'),
            ({'name': 'ok', 'description': ['x']}, 'description'),
            ({'name': 'ok', 'date_deadline': 20261201}, 'date_deadline'),
            ({'name': 'ok', 'parent_id': 'abc'}, 'parent_id'),
        ):
            with self.subTest(body=body):
                self.assertError(self.call('tasks_alice', 'POST', BASE, body), 422, 'invalid', field)
                if field != 'parent_id':  # create-only, covered by test_unknown_keys_rejected
                    self.assertError(self.call('tasks_alice', 'PATCH', path, body), 422, 'invalid', field)

    def test_unknown_keys_rejected(self):
        created = self.create_as('tasks_alice')
        path = self.task_path(created['id'])
        for key in ('project_id', 'state', 'colour', 'create_uid', 'id', 'task_id'):
            with self.subTest(key=key):
                self.assertError(
                    self.call('tasks_alice', 'POST', BASE, {'name': 'x', key: 1}), 422, 'invalid', key)
                self.assertError(
                    self.call('tasks_alice', 'PATCH', path, {key: 1}), 422, 'invalid', key)
        # parent_id is a create-only field.
        self.assertError(
            self.call('tasks_alice', 'PATCH', path, {'parent_id': created['id']}),
            422, 'invalid', 'parent_id')
        self.assertEqual(self.ok('tasks_alice', 'GET', path)['name'], 'Task')

    def test_empty_patch_body_is_422(self):
        created = self.create_as('tasks_alice')
        self.assertError(self.call('tasks_alice', 'PATCH', self.task_path(created['id']), {}), 422, 'invalid')
        self.assertError(self.call('tasks_alice', 'PATCH', self.task_path(created['id'])), 422, 'invalid')

    def test_subtask_create_and_detail(self):
        parent = self.create_as('tasks_alice', name='Parent')
        child = self.create_as('tasks_alice', name='Child', parent_id=parent['id'])
        self.assertEqual(child['parent'], {'id': parent['id'], 'name': 'Parent'})
        detail = self.ok('tasks_alice', 'GET', self.task_path(parent['id']))
        self.assertEqual([s['id'] for s in detail['subtasks']], [child['id']])

    # list

    def test_list_returns_items_and_total(self):
        mine = self.create_as('tasks_alice', name='Mine')
        self.create_as('tasks_bob', name='Bobs', assignees=[])
        body = self.ok('tasks_alice', 'GET', BASE)
        self.assertEqual(set(body), {'items', 'total'})
        ids = [item['id'] for item in body['items']]
        self.assertIn(mine['id'], ids)
        self.assertEqual(body['total'], len(ids))
        item = next(i for i in body['items'] if i['id'] == mine['id'])
        self.assertEqual((item['source'], item['project']), ('personal', None))

    def test_href_for_personal_rows(self):
        created = self.create_as('tasks_alice')
        item = next(i for i in self.ok('tasks_alice', 'GET', BASE)['items'] if i['id'] == created['id'])
        self.assertEqual(item['href'], f'/my-tasks/{created["id"]}')

    def test_closed_and_scope_params(self):
        assigned_only = self.create_as('tasks_alice', name='Assigned to bob', assignees=[self.bob.id])
        both = self.create_as('tasks_bob', name='Bobs own')
        done = self.create_as('tasks_bob', name='Bobs done')
        self.ok('tasks_bob', 'POST', self.task_path(done['id'], '/done'))

        def ids(query, login='tasks_bob'):
            return {i['id'] for i in self.ok(login, 'GET', f'{BASE}{query}')['items']}

        # both scopes by default, open tasks only
        self.assertEqual(ids(''), {assigned_only['id'], both['id']})
        self.assertEqual(ids('?assigned=me&created=me'), {assigned_only['id'], both['id']})
        # a scope given alone narrows the list
        self.assertEqual(ids('?assigned=me'), {assigned_only['id'], both['id']})
        self.assertEqual(ids('?created=me'), {both['id']})
        self.assertEqual(ids('', login='tasks_alice'), {assigned_only['id']})
        self.assertEqual(ids('?created=me', login='tasks_alice'), {assigned_only['id']})
        # closed=1 swaps to finished tasks
        self.assertEqual(ids('?closed=1'), {done['id']})
        self.assertEqual(ids('?closed=0'), {assigned_only['id'], both['id']})

    def test_list_search_and_sort(self):
        for name in ('Banana', 'Apple', 'Cherry 100%'):
            self.create_as('tasks_alice', name=name)
        names = [i['name'] for i in self.ok('tasks_alice', 'GET', f'{BASE}?sort=name')['items']]
        self.assertEqual(names, sorted(names))
        found = self.ok('tasks_alice', 'GET', f'{BASE}?q=100%25')['items']
        self.assertEqual([i['name'] for i in found], ['Cherry 100%'])
        self.assertEqual(self.ok('tasks_alice', 'GET', f'{BASE}?q=%25')['items'][0]['name'], 'Cherry 100%')

    def test_limit_clamped_and_offset_past_total(self):
        for index in range(3):
            self.create_as('tasks_alice', name=f'Task {index}')
        page = self.ok('tasks_alice', 'GET', f'{BASE}?limit=2&offset=0')
        self.assertEqual((len(page['items']), page['total']), (2, 3))
        rest = self.ok('tasks_alice', 'GET', f'{BASE}?limit=2&offset=2')
        self.assertEqual((len(rest['items']), rest['total']), (1, 3))
        past = self.ok('tasks_alice', 'GET', f'{BASE}?offset=1000')
        self.assertEqual((past['items'], past['total']), ([], 3))
        huge = self.ok('tasks_alice', 'GET', f'{BASE}?limit=100000')
        self.assertEqual(len(huge['items']), 3)

    # transitions

    def test_done_reopen_cancel_return_detail(self):
        created = self.create_as('tasks_alice')
        done = self.ok('tasks_alice', 'POST', self.task_path(created['id'], '/done'))
        self.assertEqual(done['state'], 'done')
        self.assertEqual(set(done), set(created))
        self.assertTrue(done['allowed_actions']['reopen'])
        reopened = self.ok('tasks_alice', 'POST', self.task_path(created['id'], '/reopen'))
        self.assertEqual(reopened['state'], 'open')
        cancelled = self.ok('tasks_alice', 'POST', self.task_path(created['id'], '/cancel'))
        self.assertEqual(cancelled['state'], 'cancelled')
        self.assertEqual(self.ok('tasks_alice', 'POST', self.task_path(created['id'], '/reopen'))['state'], 'open')

    def test_invalid_transition_is_422(self):
        created = self.create_as('tasks_alice')
        self.assertError(
            self.call('tasks_alice', 'POST', self.task_path(created['id'], '/reopen')),
            422, 'invalid', 'action')
        self.ok('tasks_alice', 'POST', self.task_path(created['id'], '/done'))
        self.assertError(
            self.call('tasks_alice', 'POST', self.task_path(created['id'], '/done')),
            422, 'invalid', 'action')

    # capabilities

    def test_missing_capability_403(self):
        self.managed_user('tasks_nocap', [])
        # With nasq_pmo installed its project.task search additionally demands pmo.tasks.read
        # of anyone, so a reader who holds only tasks.tasks.read sees no task at all (404).
        pmo_read = self.env['nasq.access.permission'].search_count([('key', '=', 'pmo.tasks.read')])
        reader = self.managed_user(
            'tasks_readonly', ['tasks.tasks.read', *(['pmo.tasks.read'] if pmo_read else [])])
        created = self.create_as('tasks_alice', assignees=[reader.id])
        path = self.task_path(created['id'])
        for login in ('tasks_nocap', 'tasks_readonly'):
            for method, target, body in (
                ('POST', BASE, {'name': 'x'}),
                ('PATCH', path, {'name': 'x'}),
                ('POST', f'{path}/done', None),
                ('POST', f'{path}/cancel', None),
            ):
                with self.subTest(login=login, method=method, path=target):
                    self.assertError(self.call(login, method, target, body), 403, 'forbidden')
        for method, target in (('GET', BASE), ('GET', path)):
            with self.subTest(login='tasks_nocap', method=method, path=target):
                self.assertError(self.call('tasks_nocap', method, target), 403, 'forbidden')
        self.assertEqual(self.call('tasks_readonly', 'GET', path)[0], 200)
        self.assertEqual(self.call('tasks_readonly', 'GET', BASE)[0], 200)
