# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.fields import Command
from odoo.tests import new_test_user, tagged

from .common import WebVuePmoCase


@tagged('post_install', '-at_install', 'webvue')
class TestTags(WebVuePmoCase):

    def test_list_and_create(self):
        self.env['project.tags'].create({'name': 'urgent'})
        self.authenticate('api_emp', 'api_emp_pass_123')
        items = self.api('GET', '/api/v1/tags?q=urg').json()
        self.assertEqual([t['name'] for t in items], ['urgent'])
        self.assertEqual(set(items[0]), {'id', 'name', 'color'})
        res = self.api('POST', '/api/v1/tags', {'name': 'design'})
        self.assertEqual((res.status_code, res.json()['code']), (403, 'forbidden'))
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        res = self.api('POST', '/api/v1/tags', {'name': 'design'})
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.json()['name'], 'design')
        res = self.api('POST', '/api/v1/tags', {'name': 'Design'})
        self.assertEqual((res.status_code, res.json()['field']), (422, 'name'))
        res = self.api('POST', '/api/v1/tags', {'name': ' '})
        self.assertEqual(res.status_code, 422)

    def _managed_user(self, login, permission_keys):
        user = new_test_user(self.env, login=login, password=f'{login}_pass_123', groups='base.group_user')
        permissions = self.env['webvue.access.permission'].search([('key', 'in', permission_keys)])
        self.assertEqual(set(permissions.mapped('key')), set(permission_keys))
        role = self.env['webvue.access.role'].create({
            'name_ar': login, 'permission_ids': [Command.set(permissions.ids)],
        })
        self.env['webvue.access.assignment'].create({
            'user_id': user.id, 'role_id': role.id, 'company_id': self.env.company.id,
        })

    def test_list_needs_a_project_or_task_read_capability(self):
        self.env['project.tags'].create({'name': 'vocabulary'})
        self._managed_user('tags_projects_reader', ['pmo.projects.read'])
        self._managed_user('tags_tasks_reader', ['pmo.tasks.read'])
        self._managed_user('tags_no_pmo', ['settings.company.read'])
        for login, status in (
            ('tags_projects_reader', 200), ('tags_tasks_reader', 200), ('tags_no_pmo', 403),
        ):
            with self.subTest(login=login):
                self.authenticate(login, f'{login}_pass_123')
                res = self.api('GET', '/api/v1/tags')
                self.assertEqual(res.status_code, status, res.text)
                if status == 403:
                    self.assertEqual(res.json()['code'], 'forbidden')
