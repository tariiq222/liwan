# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Request-scoped company isolation for the webvue_tasks GET record routes.

Phase 1 of the isolation work: these tests pin the matrix on current main and
MUST fail for the leak cases before the fix lands (the pin in api_handler).
"""
from odoo.tests import tagged
from odoo.tests.common import HOST

from odoo.addons.webvue_api.tests.common import (
    CompanyIsolationCase,
    cover_isolation_routes,
)

# Every GET /api/v1 route with an <int:...> id that this addon owns, spelled
# exactly as the controllers declare them.
COVERED = (
    '/api/v1/my-tasks/<int:task_id>',
    '/api/v1/my-tasks/<int:task_id>/comments',
    '/api/v1/my-tasks/<int:task_id>/attachments',
    '/api/v1/my-tasks/<int:task_id>/attachments/<int:att_id>/download',
)


@tagged('post_install', '-at_install', 'webvue')
class WebVueTasksIsolationCase(CompanyIsolationCase):
    """One personal task (plus its attachment) per company, assigned to iso_user.

    A project-less task is what the service itself creates: ``webvue_personal``
    computes True and ``company_id`` is pinned to the owning company.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.task_of, cls.attachment_of = {}, {}
        for company in (cls.company_p, cls.company_p1, cls.company_p2, cls.company_c):
            # Created as iso_user in that company: the personal-task list skips
            # rows created by the superuser, and a project-less task keeps its
            # company only when the creator pins it (the service does the same).
            task = cls.env['project.task'].with_user(cls.iso_user).with_company(company).create({
                'name': f'Personal {company.name}', 'company_id': company.id,
                'user_ids': [(4, cls.iso_user.id)],
            })
            cls.task_of[company.id] = task
            cls.attachment_of[company.id] = cls.env['ir.attachment'].sudo().create({
                'name': 'note.txt', 'raw': b'note', 'mimetype': 'text/plain',
                'res_model': 'project.task', 'res_id': task.id, 'type': 'binary',
            })

    def assert_subtree_matrix(self, path_of):
        """current=P reads P, P1 and P2 (the company subtree) and stays blind to C;
        current=P1 reads only P1. Every hidden case must survive the cids cookie,
        the cids query and a body carrying allowed_company_ids, and answer 404
        byte-identical to the route's own missing-record response."""
        self.env_in(self.company_p)
        for company in (self.company_p, self.company_p1, self.company_p2):
            self.assertVisible(path_of(company))
        self.assertHiddenEveryWay('GET', path_of(self.company_c), self.company_c.id)
        self.env_in(self.company_p1)
        self.assertVisible(path_of(self.company_p1))
        for company in (self.company_p, self.company_p2, self.company_c):
            self.assertHiddenEveryWay('GET', path_of(company), company.id)

    def forged_get(self, path):
        """One GET with a cids cookie naming company C before the current one."""
        self.opener.cookies.set('cids', f'{self.company_c.id}-{self.iso_user.company_id.id}', domain=HOST, path='/')
        try:
            return self.api('GET', path)
        finally:
            self.opener.cookies.clear(domain=HOST, path='/', name='cids')

    def forged_writes(self, method, path, hidden_id, payload):
        """One plain write plus the three forgery vectors, each carrying `payload`."""
        current = self.iso_user.company_id.id
        self.opener.cookies.set('cids', f'{hidden_id}-{current}', domain=HOST, path='/')
        try:
            responses = [self.api(method, path, json=payload)]
            responses.append(self.api(method, f'{path}?cids={hidden_id},{current}', json=payload))
            body = dict(payload)
            body['context'] = {'allowed_company_ids': [hidden_id, current]}
            responses.append(self.api(method, path, json=body))
        finally:
            self.opener.cookies.clear(domain=HOST, path='/', name='cids')
        return responses

    def test_my_task_record_matrix(self):
        def path_of(company):
            return f'/api/v1/my-tasks/{self.task_of[company.id].id}'
        self.assert_subtree_matrix(path_of)
        self.assert_subtree_matrix(lambda company: path_of(company) + '/comments')
        self.assert_subtree_matrix(lambda company: path_of(company) + '/attachments')

    def test_my_task_attachment_download_matrix(self):
        self.assert_subtree_matrix(lambda company: (
            f'/api/v1/my-tasks/{self.task_of[company.id].id}'
            f'/attachments/{self.attachment_of[company.id].id}/download'))

    def test_my_task_list_excludes_other_companies(self):
        self.env_in(self.company_p1)
        ids = {item['id'] for item in self.assertVisible('/api/v1/my-tasks').json()['items']}
        self.assertIn(self.task_of[self.company_p1.id].id, ids)
        for company in (self.company_p, self.company_p2, self.company_c):
            self.assertNotIn(self.task_of[company.id].id, ids)
        # A forged cids cookie must not widen the list either.
        forged = self.forged_get('/api/v1/my-tasks')
        self.assertEqual(forged.status_code, 200, forged.text[:200])
        self.assertNotIn(
            self.task_of[self.company_c.id].id, {item['id'] for item in forged.json()['items']})

    def test_my_task_patch_of_foreign_task_is_rejected(self):
        """Patching company C's task from a P1 session writes nothing, in every vector."""
        self.env_in(self.company_p1)
        c_task = self.task_of[self.company_c.id]
        payload = {'name': 'Forged name'}
        for response in self.forged_writes('PATCH', f'/api/v1/my-tasks/{c_task.id}', self.company_c.id, payload):
            self.assertEqual(response.status_code, 404, response.text[:200])
            self.assertEqual(response.json()['code'], 'not_found')
        self.assertEqual(
            self.env['project.task'].sudo().browse(c_task.id).name, f'Personal {self.company_c.name}')


def register_tasks_isolation_coverage():
    cover_isolation_routes(COVERED, 'webvue_tasks/tests/test_company_isolation.py')


register_tasks_isolation_coverage()
