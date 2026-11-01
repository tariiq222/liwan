# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Request-scoped company isolation for the liwan_pmo GET record routes.

Phase 1 of the isolation work: these tests pin the matrix on current main and
MUST fail for the leak cases before the fix lands (the pin in api_handler).
"""
from datetime import datetime, timedelta

from odoo.tests import tagged
from odoo.tests.common import HOST

from odoo.addons.liwan_api.tests.common import (
    CompanyIsolationCase,
    assert_isolation_discovery,
    cover_isolation_routes,
)

# Every GET /api/v1 route with an <int:...> id that this addon owns, spelled
# exactly as the controllers declare them.
COVERED = (
    '/api/v1/projects/<int:project_id>',
    '/api/v1/projects/<int:project_id>/finance',
    '/api/v1/projects/<int:project_id>/finance/summary',
    '/api/v1/projects/<int:project_id>/finance/actual-lines',
    '/api/v1/projects/<int:project_id>/finance/<int:entry_id>',
    '/api/v1/projects/<int:project_id>/milestones',
    '/api/v1/projects/<int:project_id>/updates',
    '/api/v1/projects/<int:project_id>/stakeholders',
    '/api/v1/projects/<int:project_id>/stakeholders/<int:item_id>',
    '/api/v1/projects/<int:project_id>/raci',
    '/api/v1/projects/<int:project_id>/register',
    '/api/v1/projects/<int:project_id>/register/<int:item_id>',
    '/api/v1/projects/<int:project_id>/changes',
    '/api/v1/projects/<int:project_id>/changes/<int:change_id>',
    '/api/v1/projects/<int:project_id>/baselines',
    '/api/v1/projects/<int:project_id>/baselines/variance',
    '/api/v1/projects/<int:project_id>/baselines/<int:number>',
    '/api/v1/projects/<int:project_id>/schedule',
    '/api/v1/projects/<int:project_id>/followers',
    '/api/v1/tasks/<int:task_id>',
    '/api/v1/tasks/<int:task_id>/timeline',
    '/api/v1/tasks/<int:task_id>/thread-tasks',
    '/api/v1/tasks/<int:task_id>/attachments',
    '/api/v1/tasks/<int:task_id>/attachments/<int:attachment_id>/download',
    '/api/v1/tasks/<int:task_id>/dependencies',
    '/api/v1/tasks/<int:task_id>/dependencies/candidates',
    '/api/v1/notification-digests/<int:notification_id>',
    '/api/v1/project-charter/catalogs/<string:resource>',
    '/api/v1/project-charter/catalogs/<string:resource>/<int:item_id>',
)


EXPECTED_GET_RECORD_ROUTES = 29


@tagged('post_install', '-at_install', 'liwan')
class LiwanPmoIsolationCase(CompanyIsolationCase):
    """One project family per company: the records every PMO record route reads.

    The actual-cost extension point answers as if a bridge exposed readable
    external lines, so ``/finance/actual-lines`` has a visible answer to pin.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.iso_user.tz = 'UTC'
        source = type(cls.env['liwan.project.actual.source'])
        cls.classPatch(source, '_liwan_is_external', lambda _model, *_args, **_kwargs: True)
        cls.classPatch(source, '_liwan_can_read_actual_lines', lambda _model, *_args, **_kwargs: True)
        cls.classPatch(source, '_liwan_actual_lines', lambda _model, *_args, **_kwargs: ([], 0))
        now = datetime(2026, 1, 2, 10, 0, 0)
        cls.project_of, cls.task_of, cls.stakeholder_of = {}, {}, {}
        cls.register_of, cls.entry_of, cls.attachment_of, cls.catalog_of, cls.change_of = {}, {}, {}, {}, {}
        cls.baseline_of = {}
        for company in (cls.company_p, cls.company_p1, cls.company_p2, cls.company_c):
            # Every fixture is written in its own company: the governance create
            # checks compare the parent project with the active company.
            env = cls.env(context=dict(cls.env.context, allowed_company_ids=[company.id]))
            project = env['project.project'].sudo().create({
                'name': f'Isolation {company.name}', 'company_id': company.id, 'user_id': cls.iso_user.id,
            })
            task = env['project.task'].sudo().create({
                'name': f'Isolation task {company.name}', 'project_id': project.id,
                'company_id': company.id, 'user_ids': [(4, cls.iso_user.id)],
            })
            # The digest's own overdue task: due two days before the fixed now.
            env['project.task'].sudo().create({
                'name': f'Overdue {company.name}', 'project_id': project.id,
                'company_id': company.id, 'user_ids': [(4, cls.iso_user.id)],
                'date_deadline': now - timedelta(days=2),
            })
            cls.project_of[company.id] = project
            cls.task_of[company.id] = task
            cls.stakeholder_of[company.id] = env['liwan.project.stakeholder'].sudo().create({
                'project_id': project.id, 'name': f'Sponsor {company.name}',
            })
            cls.register_of[company.id] = env['liwan.project.register'].sudo().create({
                'project_id': project.id, 'kind': 'risk', 'title': f'Risk {company.name}',
                'probability': 2, 'impact': 2,
            })
            cls.change_of[company.id] = env(user=cls.iso_user.id)['liwan.project.change'].create({
                'project_id': project.id, 'title': f'Change {company.name}',
            })
            project.sudo().liwan_charter_state = 'approved'
            cls.baseline_of[company.id] = env(user=cls.iso_user.id)['liwan.project.baseline'].create({'project_id': project.id})
            cls.entry_of[company.id] = env['liwan.project.finance.entry'].sudo().create({
                'project_id': project.id, 'kind': 'budget', 'title': f'Budget {company.name}', 'amount': 100,
            })
            cls.attachment_of[company.id] = env['ir.attachment'].sudo().create({
                'name': 'plan.txt', 'raw': b'plan', 'mimetype': 'text/plain',
                'res_model': 'project.task', 'res_id': task.id, 'type': 'binary',
                'company_id': company.id,
            })
            cls.catalog_of[company.id] = env['liwan.project.type'].sudo().create({
                'name': f'Type {company.name}', 'company_id': company.id,
            })
        # One overdue digest per company, owned by iso_user as its project manager.
        cls.env['project.task']._liwan_run_deadline_notifications(now=now)
        cls.digest_of = {}
        for company in (cls.company_p, cls.company_p1, cls.company_p2, cls.company_c):
            digest = cls.env['mail.notification'].sudo().search([
                ('res_partner_id', '=', cls.iso_user.partner_id.id),
                ('mail_message_id.liwan_notification_kind', '=', 'overdue_digest'),
                ('mail_message_id.model', '=', 'res.company'),
                ('mail_message_id.res_id', '=', company.id),
            ], limit=1)
            if not digest:
                msg = f'no overdue digest was delivered for {company.name}'
                raise AssertionError(msg)
            cls.digest_of[company.id] = digest.id

    def assert_subtree_matrix(self, path_of):
        """current=P reads P, P1 and P2 (the company subtree) and stays blind to C;
        current=P1 reads only P1. Every hidden case must survive all three forgery
        vectors and answer 404 byte-identical to the route's missing-record response."""
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

    def test_project_detail_matrix(self):
        self.assert_subtree_matrix(lambda company: f'/api/v1/projects/{self.project_of[company.id].id}')

    def test_project_finance_lists_matrix(self):
        def finance(company):
            return f'/api/v1/projects/{self.project_of[company.id].id}/finance'
        self.assert_subtree_matrix(finance)
        self.assert_subtree_matrix(lambda company: finance(company) + '/summary')
        self.assert_subtree_matrix(lambda company: finance(company) + '/actual-lines')

    def test_project_finance_entry_matrix(self):
        self.assert_subtree_matrix(
            lambda company: f"/api/v1/projects/{self.project_of[company.id].id}/finance/{self.entry_of[company.id].id}")

    def test_project_milestones_matrix(self):
        self.assert_subtree_matrix(lambda company: f'/api/v1/projects/{self.project_of[company.id].id}/milestones')

    def test_project_updates_matrix(self):
        self.assert_subtree_matrix(lambda company: f'/api/v1/projects/{self.project_of[company.id].id}/updates')

    def test_project_stakeholders_matrix(self):
        def path_of(company):
            return f'/api/v1/projects/{self.project_of[company.id].id}/stakeholders'
        self.assert_subtree_matrix(path_of)
        self.assert_subtree_matrix(
            lambda company: f"{path_of(company)}/{self.stakeholder_of[company.id].id}")

    def test_project_raci_matrix(self):
        self.assert_subtree_matrix(lambda company: f'/api/v1/projects/{self.project_of[company.id].id}/raci')

    def test_project_register_matrix(self):
        def path_of(company):
            return f'/api/v1/projects/{self.project_of[company.id].id}/register'
        self.assert_subtree_matrix(path_of)
        self.assert_subtree_matrix(
            lambda company: f"{path_of(company)}/{self.register_of[company.id].id}")

    def test_project_changes_matrix(self):
        def path_of(company):
            return f'/api/v1/projects/{self.project_of[company.id].id}/changes'
        self.assert_subtree_matrix(path_of)
        self.assert_subtree_matrix(
            lambda company: f"{path_of(company)}/{self.change_of[company.id].id}")

    def test_project_baselines_matrix(self):
        def path_of(company):
            return f'/api/v1/projects/{self.project_of[company.id].id}/baselines'
        self.assert_subtree_matrix(path_of)
        self.assert_subtree_matrix(lambda company: f'{path_of(company)}/{self.baseline_of[company.id].number}')
        self.assert_subtree_matrix(lambda company: f'{path_of(company)}/variance')

    def test_change_category_list_is_pinned_to_the_current_company(self):
        categories = self.env['liwan.project.change.category'].sudo()
        own = categories.search([('company_id', '=', self.company_p1.id)])
        self.env_in(self.company_p1)
        ids = {item['id'] for item in self.assertVisible('/api/v1/pmo/change-categories').json()['items']}
        self.assertEqual(ids, set(own.ids))
        forged = self.forged_get('/api/v1/pmo/change-categories')
        self.assertEqual(forged.status_code, 200, forged.text[:200])
        self.assertEqual({item['id'] for item in forged.json()['items']}, set(own.ids))

    def test_project_schedule_matrix(self):
        self.assert_subtree_matrix(lambda company: f'/api/v1/projects/{self.project_of[company.id].id}/schedule')

    def test_project_followers_matrix(self):
        self.assert_subtree_matrix(lambda company: f'/api/v1/projects/{self.project_of[company.id].id}/followers')

    def test_charter_catalog_item_matrix(self):
        self.assert_subtree_matrix(
            lambda company: f"/api/v1/project-charter/catalogs/types/{self.catalog_of[company.id].id}")

    def test_charter_catalog_list_is_pinned_to_the_current_company(self):
        self.env_in(self.company_p1)
        path = '/api/v1/project-charter/catalogs/types'
        ids = {item['id'] for item in self.assertVisible(path).json()['items']}
        self.assertIn(self.catalog_of[self.company_p1.id].id, ids)
        for company in (self.company_p, self.company_p2, self.company_c):
            self.assertNotIn(self.catalog_of[company.id].id, ids)
        forged = self.forged_get(path)
        self.assertEqual(forged.status_code, 200, forged.text[:200])
        self.assertNotIn(self.catalog_of[self.company_c.id].id, {item['id'] for item in forged.json()['items']})

    def test_task_detail_matrix(self):
        self.assert_subtree_matrix(lambda company: f'/api/v1/tasks/{self.task_of[company.id].id}')

    def test_task_timeline_matrix(self):
        self.assert_subtree_matrix(lambda company: f'/api/v1/tasks/{self.task_of[company.id].id}/timeline')

    def test_task_thread_tasks_matrix(self):
        self.assert_subtree_matrix(lambda company: f'/api/v1/tasks/{self.task_of[company.id].id}/thread-tasks')

    def test_task_attachments_matrix(self):
        def path_of(company):
            return f'/api/v1/tasks/{self.task_of[company.id].id}/attachments'
        self.assert_subtree_matrix(path_of)
        self.assert_subtree_matrix(
            lambda company: f"{path_of(company)}/{self.attachment_of[company.id].id}/download")

    def test_task_dependencies_matrix(self):
        self.assert_subtree_matrix(lambda company: f'/api/v1/tasks/{self.task_of[company.id].id}/dependencies')

    def test_task_dependency_candidates_matrix(self):
        self.assert_subtree_matrix(
            lambda company: f'/api/v1/tasks/{self.task_of[company.id].id}/dependencies/candidates')

    def test_notification_digest_matrix(self):
        self.assert_subtree_matrix(
            lambda company: f'/api/v1/notification-digests/{self.digest_of[company.id]}')

    def test_project_list_is_pinned_to_the_current_company(self):
        self.env_in(self.company_p1)
        ids = {item['id'] for item in self.assertVisible('/api/v1/projects').json()['items']}
        self.assertIn(self.project_of[self.company_p1.id].id, ids)
        for company in (self.company_p, self.company_p2, self.company_c):
            self.assertNotIn(self.project_of[company.id].id, ids)
        # A forged cids cookie must not widen the list either.
        forged = self.forged_get('/api/v1/projects')
        self.assertEqual(forged.status_code, 200, forged.text[:200])
        self.assertNotIn(
            self.project_of[self.company_c.id].id, {item['id'] for item in forged.json()['items']})

    def test_task_list_is_pinned_to_the_current_company(self):
        self.env_in(self.company_p1)
        ids = {item['id'] for item in self.assertVisible('/api/v1/tasks?filter=mine').json()['items']}
        self.assertIn(self.task_of[self.company_p1.id].id, ids)
        for company in (self.company_p, self.company_p2, self.company_c):
            self.assertNotIn(self.task_of[company.id].id, ids)
        forged = self.forged_get('/api/v1/tasks?filter=mine')
        self.assertEqual(forged.status_code, 200, forged.text[:200])
        self.assertNotIn(
            self.task_of[self.company_c.id].id, {item['id'] for item in forged.json()['items']})

    def test_task_summary_is_pinned_to_the_current_company(self):
        self.env['project.task'].sudo().create({
            'name': 'Extra P1 task', 'project_id': self.project_of[self.company_p1.id].id,
            'company_id': self.company_p1.id, 'user_ids': [(4, self.iso_user.id)],
        })
        self.env_in(self.company_p1)
        self.assertEqual(self.assertVisible('/api/v1/tasks/summary?filter=mine').json()['total'], 3)
        # A forged cids cookie must not widen the counted set either.
        forged = self.forged_get('/api/v1/tasks/summary?filter=mine')
        self.assertEqual(forged.status_code, 200, forged.text[:200])
        self.assertEqual(forged.json()['total'], 3)

    def test_task_create_with_foreign_project_is_rejected(self):
        """Creating a task in company C's project from a P session writes nothing."""
        self.env_in(self.company_p)
        c_project = self.project_of[self.company_c.id]
        payload = {'name': 'Foreign task', 'project_id': c_project.id}
        for response in self.forged_writes('POST', '/api/v1/tasks', self.company_c.id, payload):
            self.assertEqual(response.status_code, 404, response.text[:200])
            self.assertEqual(response.json()['code'], 'not_found')
        self.assertFalse(self.env['project.task'].sudo().search([
            ('project_id', '=', c_project.id), ('name', '=', 'Foreign task')]))

    def test_task_create_with_foreign_parent_is_rejected(self):
        """A parent task of company C is not-found from a P session: nothing is written."""
        self.env_in(self.company_p)
        p_project = self.project_of[self.company_p.id]
        response = self.api('POST', '/api/v1/tasks', json={
            'name': 'Foreign parent', 'project_id': p_project.id,
            'parent_id': self.task_of[self.company_c.id].id,
        })
        self.assertEqual(response.status_code, 404, response.text[:200])
        self.assertEqual(response.json()['code'], 'not_found')
        self.assertFalse(self.env['project.task'].sudo().search([
            ('project_id', '=', p_project.id), ('name', '=', 'Foreign parent')]))

    def test_discovery_covers_every_get_record_route(self):
        assert_isolation_discovery(self, 'liwan_pmo', EXPECTED_GET_RECORD_ROUTES)


def register_pmo_isolation_coverage():
    cover_isolation_routes(COVERED, 'liwan_pmo/tests/test_company_isolation.py')


register_pmo_isolation_coverage()
