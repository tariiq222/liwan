# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""HTTP helpers for the /api/v1/my-tasks routes, reusable by other addons' route tests.

``TasksRoutesCase`` logs a fixture user in (their password is ``<login>_pass_123``,
the convention of ``LiwanTasksCase``) and returns ``(status, json)`` pairs.
"""
from odoo.fields import Command
from odoo.tests import new_test_user

from odoo.addons.liwan_tasks.tests.common import LiwanTasksCase

BASE = '/api/v1/my-tasks'
EMPLOYEE_PASSWORD = 'api_emp_pass_123'


class TasksRoutesCase(LiwanTasksCase):
    def password_of(self, login):
        return EMPLOYEE_PASSWORD if login == 'api_emp' else f'{login}_pass_123'

    def call(self, login, method, path, json=None):
        """Log ``login`` in, call ``method path`` and return ``(status_code, decoded_body)``."""
        self.authenticate(login, self.password_of(login))
        response = self.api(method, path, json=json)
        try:
            body = response.json()
        except ValueError:
            body = None
        return response.status_code, body

    def call_raw(self, login, method, path, data):
        """Like ``call`` with a raw string body (to send a JSON ``null`` or other odd body)."""
        self.authenticate(login, self.password_of(login))
        response = self.url_open(path, data=data, headers={'Content-Type': 'application/json'}, method=method)
        try:
            body = response.json()
        except ValueError:
            body = None
        return response.status_code, body

    def ok(self, login, method, path, json=None):
        """Like ``call`` but asserts a 200 and returns only the body."""
        status, body = self.call(login, method, path, json=json)
        self.assertEqual(status, 200, body)
        return body

    def assertError(self, result, status, code, field=None):
        got_status, body = result
        self.assertEqual(got_status, status, body)
        self.assertIsInstance(body, dict, 'an API error has a JSON body')
        self.assertEqual(body.get('code'), code, body)
        if field is not None:
            self.assertEqual(body.get('field'), field, body)

    def task_path(self, task_id, suffix=''):
        return f'{BASE}/{task_id}{suffix}'

    def managed_user(self, login, keys):
        """A user holding exactly the capability ``keys`` (through a custom role)."""
        user = new_test_user(self.env, login=login, password=f'{login}_pass_123',
                             groups='base.group_user')
        permissions = self.env['liwan.access.permission'].search([('key', 'in', keys)])
        self.assertEqual(set(permissions.mapped('key')), set(keys))
        role = self.env['liwan.access.role'].create({
            'name_ar': login, 'permission_ids': [Command.set(permissions.ids)],
        })
        self.env['liwan.access.assignment'].create({
            'user_id': user.id, 'role_id': role.id, 'company_id': self.env.company.id,
        })
        return user

    def make_project_task(self, name='Project task'):
        project = self.env['project.project'].create({'name': 'Routes project'})
        return self.env['project.task'].create({
            'name': name, 'project_id': project.id, 'user_ids': [Command.set(self.alice.ids)],
        })
