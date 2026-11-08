# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Request-scoped company isolation for /api/v1 record routes.

Phase 1 of the isolation work: these tests pin the matrix on current main and
MUST fail for the leak cases before the fix lands (the pin in api_handler).
"""

from odoo.tests import new_test_user, tagged
from odoo.tests.common import HOST

from odoo.addons.liwan_api.tests.common import (
    CompanyIsolationCase,
    assert_isolation_discovery,
    cover_isolation_routes,
    exempt_isolation_route,
)

# GET /api/v1 record routes served by liwan_api's own controllers, counted
# from the runtime routing map; re-asserted from discovery on every run.
# Pillar routes are held accountable by each pillar's own isolation tests.
EXPECTED_GET_RECORD_ROUTES = 5

BRANCH_MODES = ('isolated', 'delegated', 'inherited')

# liwan_api routes this file exercises with the full matrix.
COVERED = (
    '/api/v1/admin/users/<int:user_id>',
    '/api/v1/admin/access-log/<int:event_id>',
    '/api/v1/admin/users/<int:user_id>/branches',
)


# post_install like every other liwan_api test class: an at_install HttpCase
# runs mid-upgrade, before dependency-unrelated modules such as calendar load,
# so res.users.settings still lacks calendar_default_privacy and creating a
# user violates its NOT NULL constraint.
@tagged('post_install', '-at_install', 'liwan')
class LiwanApiCompanyIsolationCase(CompanyIsolationCase):
    """Isolation matrix for the routes liwan_api itself owns."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        # company_id stays inside the written company_ids (base's
        # _check_user_company); P is the admin's home company.
        cls.p_admin = new_test_user(cls.env, login='iso_admin', password='iso_admin_pass_123',
                                    name='Admin P', groups='liwan_core.group_access_admin',
                                    company_id=cls.company_p.id)
        cls.p_admin.company_ids = [(6, 0, [cls.company_p.id, cls.company_p1.id, cls.company_p2.id])]
        role = cls.env.ref('liwan_core.role_system_admin')
        Assignment = cls.env['liwan.access.assignment'].sudo()
        for company in (cls.company_p, cls.company_p1, cls.company_p2):
            Assignment.create({'user_id': cls.p_admin.id, 'role_id': role.id, 'company_id': company.id})
        cls.c_only_user = new_test_user(cls.env, login='iso_c_only', password='iso_c_pass_123',
                                        name='Only C', groups='liwan_core.group_employee',
                                        company_id=cls.company_c.id)
        cls.c_only_user.company_ids = [(6, 0, [cls.company_c.id])]
        cls.p_record_user = new_test_user(cls.env, login='iso_p_only', password='iso_p_pass_123',
                                          name='Only P', groups='liwan_core.group_employee',
                                          company_id=cls.company_p.id)

    def env_admin_in(self, company):
        """Authenticate p_admin with `company` as the server-side current company."""
        self.p_admin.company_id = company.id
        self.authenticate('iso_admin', 'iso_admin_pass_123')

    def test_me_ignores_a_cids_cookie(self):
        """The pinned company comes from the session user, never from cids."""
        self.env_in(self.company_p)
        self.opener.cookies.set('cids', f'{self.company_c.id}-{self.company_p.id}', domain=HOST, path='/')
        try:
            response = self.api('GET', '/api/v1/me')
        finally:
            self.opener.cookies.clear(domain=HOST, path='/', name='cids')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['company']['id'], self.company_p.id)

    def test_company_p_admin_cannot_read_company_c_users(self):
        """A company-P admin gets not-found for users belonging only to C."""
        self.env_admin_in(self.company_p)
        self.assertHidden(f'/api/v1/admin/users/{self.c_only_user.id}')
        listed = self.api('GET', '/api/v1/admin/users')
        self.assertEqual(listed.status_code, 200)
        ids = [item['id'] for item in listed.json()['items']]
        self.assertNotIn(self.c_only_user.id, ids)
        self.assertIn(self.p_record_user.id, ids)

    def test_admin_write_with_foreign_company_is_rejected(self):
        """Creating a user pinned to company C from a company-P session writes nothing."""
        self.env_admin_in(self.company_p)
        response = self.api('POST', '/api/v1/admin/users', json={
            'login': 'iso_foreign', 'name': 'Foreign', 'company_id': self.company_c.id,
        })
        self.assertEqual(response.status_code, 404, response.text[:200])
        self.assertEqual(response.json()['code'], 'not_found')
        self.assertFalse(self.env['res.users'].sudo().search([('login', '=', 'iso_foreign')]))

    def test_access_log_event_is_company_scoped(self):
        """Audit events recorded for company C are not readable from a P session."""
        Audit = self.env['liwan.access.audit'].sudo()
        p_event = Audit.create({'company_id': self.company_p.id, 'actor_id': self.iso_user.id,
                                'target_type': 'user', 'target_id': self.iso_user.id,
                                'target_name': 'p-event', 'action': 'read'})
        c_event = Audit.create({'company_id': self.company_c.id, 'actor_id': self.iso_user.id,
                                'target_type': 'user', 'target_id': self.iso_user.id,
                                'target_name': 'c-event', 'action': 'read'})
        self.env_admin_in(self.company_p)
        self.assertVisible(f'/api/v1/admin/access-log/{p_event.id}')
        # The detail route reads the record through get_record, so a foreign
        # event answers the uniform not-found and never marks itself real with a
        # 403.
        response = self.api('GET', f'/api/v1/admin/access-log/{c_event.id}')
        self.assertEqual(response.status_code, 404,
                         f'/api/v1/admin/access-log/{c_event.id} must be not-found from P: {response.text[:200]}')
        self.assertEqual(response.json()['code'], 'not_found')

    def test_branch_delegation_target_is_hidden_outside_current_company(self):
        self.env_admin_in(self.company_p)
        self.assertHidden(f'/api/v1/admin/users/{self.c_only_user.id}/branches')
        response = self.api('GET', f'/api/v1/admin/users/{self.p_record_user.id}/branches')
        self.assertEqual(response.status_code, 200, response.text)

    def test_branch_session_reads_its_own_and_shared_records_in_every_mode(self):
        """A branch session keeps its own records and the shared catalog, never the parent's.

        Current company P1 owns its user and audit event and reads both. A built-in role carries
        no company, so every company shares it and the branch reads it. A user, an audit event
        and a custom role owned by the parent are company P's private records: the branch gets
        the uniform not-found for them and only the parent session reads them. The parent's
        branch mode (isolated, delegated, inherited) changes neither half.
        """
        p1_user = new_test_user(self.env, login='iso_p1_only', password='iso_p1_pass_123',
                                name='Only P1', groups='liwan_core.group_employee',
                                company_id=self.company_p1.id)
        Audit = self.env['liwan.access.audit'].sudo()
        events = {
            company.id: Audit.create({'company_id': company.id, 'actor_id': self.iso_user.id,
                                      'target_type': 'user', 'target_id': self.iso_user.id,
                                      'target_name': f'{company.name}-event', 'action': 'read'})
            for company in (self.company_p, self.company_p1, self.company_p2, self.company_c)
        }
        parent_role = self.env['liwan.access.role'].with_company(self.company_p).create({
            'key': 'iso_parent_role', 'name_ar': 'Parent company role', 'type': 'custom',
        })
        shared_role = self.env.ref('liwan_core.role_employee')
        for mode in BRANCH_MODES:
            self.company_p.sudo().write({'liwan_branch_access_mode': mode})
            self.env_admin_in(self.company_p1)
            self.assertVisible(f'/api/v1/admin/users/{p1_user.id}')
            self.assertVisible(f'/api/v1/admin/access-log/{events[self.company_p1.id].id}')
            self.assertVisible(f'/api/v1/admin/roles/{shared_role.id}')
            self.assertHiddenEveryWay('GET', f'/api/v1/admin/users/{self.p_record_user.id}', self.company_p.id)
            for company in (self.company_p, self.company_p2, self.company_c):
                self.assertHiddenEveryWay('GET', f'/api/v1/admin/access-log/{events[company.id].id}', company.id)
            self.assertHiddenEveryWay('GET', f'/api/v1/admin/roles/{parent_role.id}', self.company_p.id)
            listed = self.api('GET', '/api/v1/admin/roles?limit=200')
            self.assertEqual(listed.status_code, 200, listed.text)
            role_ids = [item['id'] for item in listed.json()['items']]
            self.assertIn(shared_role.id, role_ids, f'{mode}: the shared catalog stays visible')
            self.assertNotIn(parent_role.id, role_ids, f'{mode}: the parent role stays out of the list')
            self.env_admin_in(self.company_p)
            self.assertVisible(f'/api/v1/admin/users/{self.p_record_user.id}')
            self.assertVisible(f'/api/v1/admin/access-log/{events[self.company_p.id].id}')
            self.assertVisible(f'/api/v1/admin/roles/{parent_role.id}')
            self.assertHidden(f'/api/v1/admin/users/{p1_user.id}')
            self.assertHidden(f'/api/v1/admin/access-log/{events[self.company_p1.id].id}')

    def test_discovery_covers_every_get_record_route(self):
        """Every GET /api/v1 record route liwan_api owns is covered or exempted."""
        assert_isolation_discovery(self, 'liwan_api', EXPECTED_GET_RECORD_ROUTES)


def register_api_isolation_coverage():
    cover_isolation_routes(COVERED, 'liwan_api/tests/test_company_isolation.py')
    exempt_isolation_route('/api/v1/admin/roles/<int:role_id>', 'roles are global capability templates, not company records')
    exempt_isolation_route('/api/v1/admin/company/countries/<int:country_id>/states', 'reference data shared by every company')


register_api_isolation_coverage()
