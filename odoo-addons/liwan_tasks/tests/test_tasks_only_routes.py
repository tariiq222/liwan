# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""A user holding only ``tasks.tasks.*`` (a custom role, no ``pmo.*`` capability) over HTTP.

With liwan_pmo installed, PMO's task search demands ``pmo.tasks.read`` of every caller; the
bridge narrows a caller without it to personal tasks. A real request starts from a cold
cache (each one runs in its own transaction), which is the path Odoo's own column fetch
takes through a search that carries no personal-task leaf, so every call here is a
fresh-cache read. The role holds no ``pmo.tasks.read``: this file must never grant it.
"""
from odoo.fields import Command
from odoo.tests import tagged

from odoo.addons.liwan_tasks.tests.routes_common import BASE, TasksRoutesCase
from odoo.addons.liwan_tasks.tests.test_comments_attachments import upload

TASKS_KEYS = ['tasks.tasks.read', 'tasks.tasks.create', 'tasks.tasks.write']
LIST_KEYS = {
    'id', 'name', 'state', 'priority', 'date_deadline', 'assignees', 'source', 'project', 'href',
}
DETAIL_KEYS = {
    'id', 'name', 'description', 'state', 'priority', 'date_deadline', 'assignees', 'creator',
    'parent', 'is_subtask', 'subtasks', 'attachment_count', 'created_at', 'updated_at', 'allowed_actions',
}
ACTION_KEYS = {'write', 'done', 'reopen', 'cancel', 'convert', 'archive', 'unarchive'}


@tagged('post_install', '-at_install', 'liwan', 'liwan_tasks')
class TestTasksOnlyRoleRoutes(TasksRoutesCase):
    def setUp(self):
        super().setUp()
        self.only = self.managed_user('tasks_only_http', TASKS_KEYS)
        self.login = 'tasks_only_http'

    def api_ok(self, method, path, body=None):
        return self.ok(self.login, method, path, body)

    def person(self, user):
        return {'id': user.id, 'name': user.name, 'user_id': user.id}

    def test_the_role_holds_no_pmo_capability(self):
        keys = self.env['liwan.access.service']._liwan_capability_keys(self.only)
        self.assertEqual({key for key in keys if key.startswith(('pmo.', 'hr.'))}, set())
        self.assertTrue(set(TASKS_KEYS) <= set(keys))

    def test_list_and_detail_serialize_every_field(self):
        parent = self.api_ok('POST', BASE, {
            'name': 'Plan the trip', 'description': 'book flights', 'priority': 'high',
            'date_deadline': '2026-12-01T09:30:00Z', 'assignees': [self.only.id, self.alice.id]})
        child = self.api_ok('POST', BASE, {'name': 'Book hotel', 'parent_id': parent['id']})
        self.api_ok('POST', self.task_path(child['id'], '/done'))
        self.api_ok('POST', self.task_path(parent['id'], '/attachments'), upload())

        listing = self.api_ok('GET', BASE)
        self.assertEqual(listing['total'], 1)
        row = listing['items'][0]
        self.assertEqual(set(row), LIST_KEYS)
        self.assertCountEqual(row.pop('assignees'), [self.person(self.only), self.person(self.alice)])
        self.assertEqual(row, {
            'id': parent['id'], 'name': 'Plan the trip', 'state': 'open', 'priority': 'high',
            'date_deadline': '2026-12-01T09:30:00Z', 'source': 'personal', 'project': None,
            'href': f'/my-tasks/{parent["id"]}',
        })

        detail = self.api_ok('GET', self.task_path(parent['id']))
        self.assertEqual(set(detail), DETAIL_KEYS)
        self.assertEqual(set(detail['allowed_actions']), ACTION_KEYS)
        self.assertEqual(detail['name'], 'Plan the trip')
        self.assertEqual(detail['description'], 'book flights')
        self.assertEqual((detail['state'], detail['priority']), ('open', 'high'))
        self.assertEqual(detail['date_deadline'], '2026-12-01T09:30:00Z')
        self.assertCountEqual(detail['assignees'], [self.person(self.only), self.person(self.alice)])
        self.assertEqual(detail['creator'], self.person(self.only))
        self.assertIsNone(detail['parent'])
        self.assertEqual(detail['subtasks'], [{'id': child['id'], 'name': 'Book hotel', 'state': 'done'}])
        self.assertEqual(detail['attachment_count'], 1)
        for key in ('created_at', 'updated_at'):
            self.assertRegex(detail[key], r'^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$')
        self.assertTrue(detail['allowed_actions']['write'])
        self.assertTrue(detail['allowed_actions']['done'])
        self.assertFalse(detail['allowed_actions']['reopen'])

        sub_detail = self.api_ok('GET', self.task_path(child['id']))
        self.assertEqual(sub_detail['parent'], {'id': parent['id'], 'name': 'Plan the trip'})
        self.assertEqual(sub_detail['state'], 'done')
        self.assertEqual(sub_detail['subtasks'], [])
        # A sub-task shows inside its parent, not as a row of the unified list.
        self.assertEqual([item['id'] for item in self.api_ok('GET', BASE)['items']], [parent['id']])

    def test_create_patch_and_transitions(self):
        created = self.api_ok('POST', BASE, {'name': 'Draft'})
        self.assertEqual(created['assignees'], [self.person(self.only)])
        path = self.task_path(created['id'])
        patched = self.api_ok('PATCH', path, {
            'name': 'Final', 'description': 'text', 'priority': 'high',
            'date_deadline': '2026-12-05T00:00:00Z', 'assignees': [self.only.id, self.bob.id]})
        self.assertEqual((patched['name'], patched['description'], patched['priority']),
                         ('Final', 'text', 'high'))
        self.assertCountEqual(patched['assignees'], [self.person(self.only), self.person(self.bob)])
        reread = self.api_ok('GET', path)
        # The order of the assignees is not part of the contract.
        for body in (reread, patched):
            body['assignees'].sort(key=lambda person: person['id'])
        self.assertEqual(reread, patched)

        self.assertEqual(self.api_ok('POST', f'{path}/done')['state'], 'done')
        self.assertTrue(self.api_ok('GET', path)['allowed_actions']['reopen'])
        self.assertEqual(self.api_ok('POST', f'{path}/reopen')['state'], 'open')
        self.assertEqual(self.api_ok('POST', f'{path}/cancel')['state'], 'cancelled')
        self.assertEqual(self.api_ok('POST', f'{path}/reopen')['state'], 'open')
        done_ids = {item['id'] for item in self.api_ok('GET', f'{BASE}?closed=1')['items']}
        self.assertNotIn(created['id'], done_ids)

    def test_comments_and_attachments(self):
        task = self.api_ok('POST', BASE, {'name': 'With files'})
        comments = self.task_path(task['id'], '/comments')
        attachments = self.task_path(task['id'], '/attachments')

        posted = self.api_ok('POST', comments, {'body': 'first note'})
        self.assertEqual(posted['author'], self.person(self.only))
        self.assertEqual(self.api_ok('GET', comments), {'items': [posted], 'total': 1})

        made = self.api_ok('POST', attachments, upload('a.txt', b'hello'))
        self.assertEqual(made['name'], 'a.txt')
        self.assertEqual(self.api_ok('GET', attachments), {'items': [made], 'total': 1})
        self.assertEqual(self.api_ok('GET', self.task_path(task['id']))['attachment_count'], 1)
        status, _body = self.call(self.login, 'DELETE', f'{attachments}/{made["id"]}')
        self.assertEqual(status, 204)
        self.assertEqual(self.api_ok('GET', attachments), {'items': [], 'total': 0})
        self.assertEqual(self.api_ok('GET', self.task_path(task['id']))['attachment_count'], 0)

    def test_a_project_task_is_404_on_every_route(self):
        project = self.env['project.project'].create({'name': 'Hidden project'})
        task = self.env['project.task'].create({
            'name': 'Project task', 'project_id': project.id,
            'user_ids': [Command.set(self.only.ids)]})
        attachment = self.env['ir.attachment'].create({
            'name': 'secret.txt', 'raw': b'x', 'mimetype': 'text/plain',
            'res_model': 'project.task', 'res_id': task.id})
        mine = self.api_ok('POST', BASE, {'name': 'Mine'})
        path = self.task_path(task.id)
        for method, suffix, body in (
            ('GET', '', None), ('PATCH', '', {'name': 'x'}), ('POST', '/done', None),
            ('POST', '/reopen', None), ('POST', '/cancel', None),
            ('GET', '/comments', None), ('POST', '/comments', {'body': 'x'}),
            ('GET', '/attachments', None), ('POST', '/attachments', upload()),
            ('DELETE', f'/attachments/{attachment.id}', None),
        ):
            with self.subTest(method=method, suffix=suffix):
                self.assertError(self.call(self.login, method, path + suffix, body), 404, 'not_found')
        self.assertEqual(task.name, 'Project task')
        self.assertEqual(task.state, '01_in_progress')
        self.assertTrue(attachment.exists())
        self.assertFalse(self.env['mail.message'].search([
            ('model', '=', 'project.task'), ('res_id', '=', task.id), ('message_type', '=', 'comment')]))
        # The list holds the personal task only, never the project task assigned to the caller.
        self.assertEqual([item['id'] for item in self.api_ok('GET', BASE)['items']], [mine['id']])
