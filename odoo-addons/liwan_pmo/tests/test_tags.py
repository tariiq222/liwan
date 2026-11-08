# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.fields import Command
from odoo.tests import new_test_user, tagged

from .common import LiwanPmoCase


@tagged('post_install', '-at_install', 'liwan')
class TestTags(LiwanPmoCase):

    def test_list_and_create(self):
        self.env['project.tags'].create({'name': 'urgent'})
        self.authenticate('api_emp', 'api_emp_pass_123')
        body = self.api('GET', '/api/v1/tags?q=urg').json()
        self.assertEqual([t['name'] for t in body['items']], ['urgent'])
        self.assertEqual(body['total'], 1)
        self.assertEqual(set(body['items'][0]), {'id', 'name', 'color'})
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
        permissions = self.env['liwan.access.permission'].search([('key', 'in', permission_keys)])
        self.assertEqual(set(permissions.mapped('key')), set(permission_keys))
        role = self.env['liwan.access.role'].create({
            'name_ar': login, 'permission_ids': [Command.set(permissions.ids)],
        })
        self.env['liwan.access.assignment'].create({
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

    def test_the_vocabulary_is_paged_with_a_true_total(self):
        """The old 100-row cap hid tags from the picker; `total` now names the whole vocabulary."""
        self.env['project.tags'].create([{'name': f'Paged tag {index:03d}'} for index in range(101)])
        self.authenticate('api_emp', 'api_emp_pass_123')
        body = self.api('GET', '/api/v1/tags?limit=2').json()
        self.assertEqual((len(body['items']), body['total']), (2, 101))
        second = self.api('GET', '/api/v1/tags?limit=2&offset=2').json()
        self.assertEqual((len(second['items']), second['total']), (2, 101))
        # The pages are a prefix of the server's own order (`name, id`), not of the creation order.
        ordered = self.api('GET', '/api/v1/tags?limit=200').json()
        self.assertEqual([item['id'] for item in ordered['items']][:4], [
            *[item['id'] for item in body['items']], *[item['id'] for item in second['items']],
        ])
        # A missing limit is the picker's own 100-row default, not an unbounded list.
        self.assertEqual(len(self.api('GET', '/api/v1/tags').json()['items']), 100)
        self.assertEqual(self.api('GET', '/api/v1/tags').json()['total'], 101)
