# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Request-scoped company isolation for the webvue_operations GET record routes.

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
    '/api/v1/operations/processes/<int:process_id>',
    '/api/v1/operations/processes/<int:process_id>/targets',
    '/api/v1/operations/requests/<int:request_id>',
    '/api/v1/operations/requests/<int:request_id>/attachments/<int:attachment_id>/download',
)


@tagged('post_install', '-at_install', 'webvue')
class WebVueOperationsIsolationCase(CompanyIsolationCase):
    """One published process, one draft request of iso_user and its attachment
    per company: the records every operations record route reads.

    Processes are created through the model (which forces a draft) and then
    published, because the visibility rule shows a non-manager only published
    processes.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.process_of, cls.request_of, cls.attachment_of = {}, {}, {}
        for company in (cls.company_p, cls.company_p1, cls.company_p2, cls.company_c):
            process = cls.env['webvue.operation.process'].sudo().with_company(company).create({
                'name': f'Process {company.name}',
            })
            process.sudo().write({'state': 'published'})
            # Created as iso_user in that company: the model pins the requester
            # to the creating user and requires the process to be published.
            request = cls.env['webvue.operation.request'].with_user(cls.iso_user).with_company(company).create({
                'name': f'Request {company.name}', 'process_id': process.id,
            })
            cls.process_of[company.id] = process
            cls.request_of[company.id] = request
            # Created as the request owner in the request's company: the company
            # comes from the fixture's with_company, not from a sudo default.
            cls.attachment_of[company.id] = cls.env['ir.attachment'].with_user(
                cls.iso_user).with_company(company).create({
                    'name': 'evidence.txt', 'raw': b'evidence', 'mimetype': 'text/plain',
                    'res_model': 'webvue.operation.request', 'res_id': request.id, 'type': 'binary',
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

    def test_process_record_matrix(self):
        def path_of(company):
            return f'/api/v1/operations/processes/{self.process_of[company.id].id}'
        self.assert_subtree_matrix(path_of)
        self.assert_subtree_matrix(lambda company: path_of(company) + '/targets')

    def test_request_record_matrix(self):
        def path_of(company):
            return f'/api/v1/operations/requests/{self.request_of[company.id].id}'
        self.assert_subtree_matrix(path_of)
        self.assert_subtree_matrix(lambda company: (
            f"{path_of(company)}/attachments/{self.attachment_of[company.id].id}/download"))

    def test_operations_lists_exclude_other_companies(self):
        self.env_in(self.company_p1)
        process_ids = {
            item['id'] for item in self.assertVisible('/api/v1/operations/processes').json()['items']}
        request_ids = {
            item['id']
            for item in self.assertVisible('/api/v1/operations/requests?scope=mine').json()['items']}
        self.assertIn(self.process_of[self.company_p1.id].id, process_ids)
        self.assertIn(self.request_of[self.company_p1.id].id, request_ids)
        for company in (self.company_p, self.company_p2, self.company_c):
            self.assertNotIn(self.process_of[company.id].id, process_ids)
            self.assertNotIn(self.request_of[company.id].id, request_ids)
        # A forged cids cookie must not widen either list.
        forged_processes = self.forged_get('/api/v1/operations/processes')
        forged_requests = self.forged_get('/api/v1/operations/requests?scope=mine')
        self.assertEqual(forged_processes.status_code, 200, forged_processes.text[:200])
        self.assertEqual(forged_requests.status_code, 200, forged_requests.text[:200])
        self.assertNotIn(
            self.process_of[self.company_c.id].id,
            {item['id'] for item in forged_processes.json()['items']})
        self.assertNotIn(
            self.request_of[self.company_c.id].id,
            {item['id'] for item in forged_requests.json()['items']})

    def test_request_patch_of_foreign_request_is_rejected(self):
        """Patching company C's request from a P1 session writes nothing, in every vector."""
        self.env_in(self.company_p1)
        c_request = self.request_of[self.company_c.id]
        payload = {'name': 'Forged name', 'revision': c_request.revision}
        path = f'/api/v1/operations/requests/{c_request.id}'
        for response in self.forged_writes('PATCH', path, self.company_c.id, payload):
            self.assertEqual(response.status_code, 404, response.text[:200])
            self.assertEqual(response.json()['code'], 'not_found')
        self.assertEqual(
            self.env['webvue.operation.request'].sudo().browse(c_request.id).name,
            f'Request {self.company_c.name}')


def register_operations_isolation_coverage():
    cover_isolation_routes(COVERED, 'webvue_operations/tests/test_company_isolation.py')


register_operations_isolation_coverage()
