# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from odoo.addons.webvue_tasks.tests.routes_common import BASE, TasksRoutesCase


@tagged('post_install', '-at_install', 'webvue', 'webvue_tasks')
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
        for body in ([], ['name'], 'name', 5):
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

    def test_json_null_body_is_422(self):
        created = self.create_as('tasks_alice')
        for method, path in (('POST', BASE), ('PATCH', self.task_path(created['id']))):
            with self.subTest(method=method):
                status, payload = self.call_raw('tasks_alice', method, path, 'null')
                self.assertEqual(status, 422, payload)
                self.assertEqual((payload['code'], payload.get('field')), ('invalid', 'body'))

    def test_nul_characters_are_rejected(self):
        created = self.create_as('tasks_alice')
        path = self.task_path(created['id'])
        for field in ('name', 'description'):
            body = {'name': 'ok', field: 'a\x00b'}
            with self.subTest(field=field):
                self.assertError(self.call('tasks_alice', 'POST', BASE, body), 422, 'invalid', field)
                self.assertError(self.call('tasks_alice', 'PATCH', path, body), 422, 'invalid', field)
        self.assertError(self.call('tasks_alice', 'GET', f'{BASE}?q=a%00b'), 422, 'invalid', 'q')

    def test_lone_surrogates_in_name_and_description_are_rejected(self):
        created = self.create_as('tasks_alice')
        path = self.task_path(created['id'])
        for field in ('name', 'description'):
            body = {'name': 'ok', field: 'a\ud800b'}
            with self.subTest(field=field):
                self.assertError(self.call('tasks_alice', 'POST', BASE, body), 422, 'invalid', field)
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

    def test_summary_counts_follow_the_list_filters(self):
        past = '2020-01-01T00:00:00Z'
        future = '2999-01-01T00:00:00Z'
        self.create_as('tasks_bob', name='Late apple', date_deadline=past)
        self.create_as('tasks_bob', name='Later apple', date_deadline=future)
        self.create_as('tasks_bob', name='Undated')
        done = self.create_as('tasks_bob', name='Done apple', date_deadline=past)
        cancelled = self.create_as('tasks_bob', name='Cancelled')
        self.ok('tasks_bob', 'POST', self.task_path(done['id'], '/done'))
        self.ok('tasks_bob', 'POST', self.task_path(cancelled['id'], '/cancel'))
        self.create_as('tasks_alice', name='Alices own', assignees=[], date_deadline=past)

        summary = self.ok('tasks_bob', 'GET', f'{BASE}/summary')
        self.assertEqual(summary, {'total': 5, 'open': 3, 'overdue': 1, 'done': 1})
        # the list's closed flag, sort and paging do not narrow the counts
        self.assertEqual(self.ok('tasks_bob', 'GET', f'{BASE}/summary?closed=1&sort=name&limit=1&offset=3'), summary)
        # the search and the scope narrow them like the list
        self.assertEqual(
            self.ok('tasks_bob', 'GET', f'{BASE}/summary?q=apple'),
            {'total': 3, 'open': 2, 'overdue': 1, 'done': 1})
        self.assertEqual(
            self.ok('tasks_alice', 'GET', f'{BASE}/summary?created=me'),
            {'total': 1, 'open': 1, 'overdue': 1, 'done': 0})
        self.assertEqual(self.ok('tasks_alice', 'GET', f'{BASE}/summary?assigned=me&q=nothing-matches')['total'], 0)
        self.assertError(self.call('tasks_bob', 'GET', f'{BASE}/summary?assigned=you'), 422, 'invalid', 'assigned')

    def test_summary_needs_the_read_capability(self):
        self.managed_user('tasks_nocap_summary', [])
        self.assertError(self.call('tasks_nocap_summary', 'GET', f'{BASE}/summary'), 403, 'forbidden')

    def test_huge_numbers_in_the_query_are_422_or_clamped(self):
        self.create_as('tasks_alice')
        for field in ('offset', 'limit'):
            for value in ('99999999999999999999', '9' * 5000, '12345678901'):
                with self.subTest(field=field, digits=len(value)):
                    self.assertError(
                        self.call('tasks_alice', 'GET', f'{BASE}?{field}={value}'), 422, 'invalid', field)
        # ten digits still parse and are clamped to a value PostgreSQL accepts
        for query in ('offset=9999999999', 'limit=9999999999'):
            with self.subTest(query=query):
                page = self.ok('tasks_alice', 'GET', f'{BASE}?{query}')
                self.assertEqual(page['total'], 1)
                self.assertEqual(len(page['items']), 0 if query.startswith('offset') else 1)

    def test_capability_is_checked_before_the_parameters(self):
        self.managed_user('tasks_nocap', [])
        reader = self.managed_user('tasks_readonly', ['tasks.tasks.read'])
        created = self.create_as('tasks_alice', assignees=[reader.id])
        path = self.task_path(created['id'])
        for login, method, target, body in (
            ('tasks_nocap', 'GET', f'{BASE}?limit=abc&closed=7', None),
            ('tasks_nocap', 'POST', BASE, []),
            ('tasks_nocap', 'POST', BASE, {'name': ''}),
            ('tasks_nocap', 'PATCH', path, []),
            ('tasks_nocap', 'PATCH', path, {}),
            ('tasks_readonly', 'POST', BASE, []),
            ('tasks_readonly', 'POST', BASE, {'name': ''}),
            ('tasks_readonly', 'PATCH', path, []),
            ('tasks_readonly', 'PATCH', path, {}),
            ('tasks_readonly', 'PATCH', path, {'bogus': 1}),
        ):
            with self.subTest(login=login, method=method, body=body):
                self.assertError(self.call(login, method, target, body), 403, 'forbidden')
        self.assertError(self.call('tasks_readonly', 'GET', f'{BASE}?limit=abc'), 422, 'invalid', 'limit')

    def test_sort_orders(self):
        for name, deadline in (
            ('A', '2026-12-03T00:00:00Z'), ('B', '2026-12-01T00:00:00Z'),
            ('C', None), ('D', '2026-12-02T00:00:00Z'),
        ):
            self.create_as('tasks_alice', name=name, date_deadline=deadline)

        def names(sort):
            return [i['name'] for i in self.ok('tasks_alice', 'GET', f'{BASE}?sort={sort}')['items']]

        self.assertEqual(names('deadline'), ['B', 'D', 'A', 'C'])
        self.assertEqual(names('created'), ['D', 'C', 'B', 'A'])
        self.assertEqual(names('name'), ['A', 'B', 'C', 'D'])

    def test_limit_clamped_and_offset_past_total(self):
        for index in range(3):
            self.create_as('tasks_alice', name=f'Task {index}')
        page = self.ok('tasks_alice', 'GET', f'{BASE}?limit=2&offset=0')
        self.assertEqual((len(page['items']), page['total']), (2, 3))
        rest = self.ok('tasks_alice', 'GET', f'{BASE}?limit=2&offset=2')
        self.assertEqual((len(rest['items']), rest['total']), (1, 3))
        past = self.ok('tasks_alice', 'GET', f'{BASE}?offset=1000')
        self.assertEqual((past['items'], past['total']), ([], 3))

    def test_limit_is_capped_at_100_and_defaults_to_50(self):
        service = self.env['webvue.my.task.service'].with_user(self.alice)
        for index in range(101):
            service._create_task({'name': f'Bulk {index}'})
        for query, count in (('', 50), ('?limit=100000', 100), ('?limit=100', 100), ('?limit=7', 7)):
            with self.subTest(query=query):
                page = self.ok('tasks_alice', 'GET', f'{BASE}{query}')
                self.assertEqual((len(page['items']), page['total']), (count, 101))

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

    # archive

    def closed_as(self, login, action='done'):
        created = self.create_as(login)
        self.ok(login, 'POST', self.task_path(created['id'], f'/{action}'))
        return created['id']

    def test_archive_and_unarchive_return_the_detail_and_move_the_task_between_tabs(self):
        task_id = self.closed_as('tasks_alice')

        def ids(query):
            return {item['id'] for item in self.ok('tasks_alice', 'GET', f'{BASE}{query}')['items']}

        archived = self.ok('tasks_alice', 'POST', self.task_path(task_id, '/archive'))
        self.assertEqual(archived['id'], task_id)
        self.assertEqual({key for key, value in archived['allowed_actions'].items() if value}, {'unarchive'})
        self.assertNotIn(task_id, ids('?closed=1'))
        self.assertNotIn(task_id, ids(''))
        self.assertEqual(ids('?archived=1'), {task_id})
        self.assertEqual(self.ok('tasks_alice', 'GET', self.task_path(task_id))['id'], task_id)
        restored = self.ok('tasks_alice', 'POST', self.task_path(task_id, '/unarchive'))
        self.assertTrue(restored['allowed_actions']['archive'])
        self.assertIn(task_id, ids('?closed=1'))
        self.assertEqual(ids('?archived=1'), set())

    def test_archive_of_an_open_or_archived_task_is_422(self):
        open_id = self.create_as('tasks_alice')['id']
        self.assertError(self.call('tasks_alice', 'POST', self.task_path(open_id, '/archive')), 422, 'invalid', 'action')
        self.assertError(self.call('tasks_alice', 'POST', self.task_path(open_id, '/unarchive')), 422, 'invalid', 'action')
        task_id = self.closed_as('tasks_alice', 'cancel')
        self.ok('tasks_alice', 'POST', self.task_path(task_id, '/archive'))
        self.assertError(self.call('tasks_alice', 'POST', self.task_path(task_id, '/archive')), 422, 'invalid', 'action')
        self.assertError(self.call('tasks_alice', 'PATCH', self.task_path(task_id), {'name': 'x'}), 422, 'invalid', 'action')
        self.assertError(self.call('tasks_alice', 'POST', self.task_path(task_id, '/reopen')), 422, 'invalid', 'action')

    def test_archived_flag_is_validated_and_exclusive_with_closed(self):
        self.assertError(self.call('tasks_alice', 'GET', f'{BASE}?archived=2'), 422, 'invalid', 'archived')
        self.assertError(self.call('tasks_alice', 'GET', f'{BASE}?archived=1&closed=1'), 422, 'invalid', 'archived')

    def test_archive_of_a_stranger_or_missing_task_is_404(self):
        task_id = self.closed_as('tasks_alice')
        self.assertError(self.call('tasks_carol', 'POST', self.task_path(task_id, '/archive')), 404, 'not_found')
        self.assertError(self.call('tasks_alice', 'POST', self.task_path(2 ** 31 - 1, '/archive')), 404, 'not_found')
        self.assertError(self.call('tasks_alice', 'POST', self.task_path(2 ** 31 - 1, '/unarchive')), 404, 'not_found')

    def test_archive_needs_the_write_capability(self):
        reader = self.managed_user('tasks_archive_readonly', ['tasks.tasks.read'])
        task_id = self.ok('tasks_alice', 'POST', BASE, {'name': 'x', 'assignees': [reader.id]})['id']
        self.ok('tasks_alice', 'POST', self.task_path(task_id, '/done'))
        for suffix in ('/archive', '/unarchive'):
            self.assertError(self.call('tasks_archive_readonly', 'POST', self.task_path(task_id, suffix)), 403, 'forbidden')

    # capabilities

    def test_missing_capability_403(self):
        self.managed_user('tasks_nocap', [])
        reader = self.managed_user('tasks_readonly', ['tasks.tasks.read'])
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
