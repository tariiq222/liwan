# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.http import root
from odoo.tests import new_test_user, tagged
from odoo.tests.common import HOST, Opener

from .common import NasqApiCase


def assert_secret_absent(case, payload, secret):
    if isinstance(payload, dict):
        forbidden_keys = {'password', 'new_password', 'password_hash'}
        case.assertTrue(forbidden_keys.isdisjoint({str(key).lower() for key in payload}))
        for value in payload.values():
            assert_secret_absent(case, value, secret)
    elif isinstance(payload, list):
        for value in payload:
            assert_secret_absent(case, value, secret)
    else:
        case.assertNotEqual(payload, secret)


@tagged('post_install', '-at_install', 'nasq', 'nasq_access')
class TestAccessAdminUsers(NasqApiCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.admin = new_test_user(
            cls.env, login='access_api_admin', password='access_api_admin_pass_123',
            groups='nasq_core.group_access_admin',
        )
        cls.department = cls.env['hr.department'].create({'name': 'Access API'})
        cls.target_employee = cls.env['hr.employee'].create({
            'name': 'Access Target', 'work_email': 'access.target@example.com',
            'department_id': cls.department.id, 'company_id': cls.env.company.id,
        })

    def _admin(self):
        self.authenticate('access_api_admin', 'access_api_admin_pass_123')

    def test_user_list_is_capability_gated_and_server_counted(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        response = self.api('GET', '/api/v1/admin/users')
        self.assertEqual((response.status_code, response.json()['code']), (403, 'forbidden'))
        self._admin()
        response = self.api('GET', f'/api/v1/admin/users?department_id={self.department.id}&limit=20&offset=0')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(set(response.json()), {'items', 'total'})

        candidates = self.api('GET', '/api/v1/admin/users/candidates?q=Access%20Target&limit=20&offset=0')
        self.assertEqual(candidates.status_code, 200, candidates.text)
        self.assertEqual(candidates.json()['total'], 1)
        self.assertEqual(candidates.json()['items'][0]['id'], self.target_employee.id)
        self.assertEqual(set(candidates.json()['items'][0]), {
            'id', 'name', 'department', 'work_email', 'active', 'user_id', 'access_active',
        })

    def test_grant_reset_disable_reactivate_and_old_session(self):
        self._admin()
        role = self.env.ref('nasq_core.role_employee')
        response = self.api('POST', '/api/v1/admin/users', {
            'employee_id': self.target_employee.id,
            'password': 'target_password_123',
            'assignments': [{'role_id': role.id, 'scope': {
                'kind': 'company', 'id': self.env.company.id,
            }}],
        })
        self.assertEqual(response.status_code, 201, response.text)
        created = response.json()
        self.assertEqual(created['employee']['id'], self.target_employee.id)
        assert_secret_absent(self, created, 'target_password_123')

        old_session = self.authenticate('access.target@example.com', 'target_password_123')
        root.session_store.save(old_session)
        self._admin()
        response = self.api('POST', f"/api/v1/admin/users/{created['id']}/password", {
            'password': 'target_password_456', 'expected_version': created['version'],
        })
        self.assertEqual(response.status_code, 200, response.text)
        changed = response.json()
        assert_secret_absent(self, changed, 'target_password_456')

        self.opener = Opener(self)
        self.opener.cookies.set('session_id', old_session.sid, domain=HOST)
        self.assertEqual(self.api('GET', '/api/v1/me').status_code, 403)

        self._admin()
        stopped = self.api('POST', f"/api/v1/admin/users/{created['id']}/disable", {
            'expected_version': changed['version'],
        })
        self.assertEqual(stopped.status_code, 200, stopped.text)
        self.assertFalse(stopped.json()['active'])
        failed = self.api('POST', f"/api/v1/admin/users/{created['id']}/reactivate", {
            'expected_version': 'stale-version',
            'password': 'target_password_789',
        })
        self.assertEqual((failed.status_code, failed.json()['code']), (409, 'conflict'))
        self.env['res.users'].with_context(active_test=False).browse(created['id']).invalidate_recordset(['active'])
        self.assertFalse(self.env['res.users'].with_context(active_test=False).browse(created['id']).active)
        reactivated = self.api('POST', f"/api/v1/admin/users/{created['id']}/reactivate", {
            'expected_version': stopped.json()['version'],
            'password': 'target_password_789',
        })
        self.assertEqual(reactivated.status_code, 200, reactivated.text)
        self.assertTrue(reactivated.json()['active'])
        self.assertEqual(reactivated.json()['id'], created['id'])

    def test_failed_grant_rolls_back_user_employee_link_and_audit(self):
        self._admin()
        audit_count = self.env['nasq.access.audit'].search_count([])
        response = self.api('POST', '/api/v1/admin/users', {
            'employee_id': self.target_employee.id,
            'password': 'target_password_123',
            'assignments': [{'role_id': 2147483647, 'scope': {
                'kind': 'company', 'id': self.env.company.id,
            }}],
        })
        self.assertEqual((response.status_code, response.json()['code']), (422, 'invalid'))
        self.target_employee.invalidate_recordset(['user_id'])
        self.assertFalse(self.target_employee.user_id)
        self.assertFalse(self.env['res.users'].with_context(active_test=False).search([
            ('login', '=', self.target_employee.work_email),
        ]))
        self.assertEqual(self.env['nasq.access.audit'].search_count([]), audit_count)

    def test_archived_employee_and_vendor_mutation_are_rejected(self):
        self.target_employee.write({'active': False})
        self._admin()
        role = self.env.ref('nasq_core.role_employee')
        response = self.api('POST', '/api/v1/admin/users', {
            'employee_id': self.target_employee.id,
            'password': 'target_password_123',
            'assignments': [{'role_id': role.id, 'scope': {
                'kind': 'company', 'id': self.env.company.id,
            }}],
        })
        self.assertEqual((response.status_code, response.json()['code']), (422, 'employee_archived'))
        vendor = new_test_user(self.env, login='access_api_vendor', groups='nasq_core.group_vendor_support')
        detail = self.api('GET', f'/api/v1/admin/users/{vendor.id}')
        self.assertEqual(detail.status_code, 200)
        self.assertTrue(detail.json()['protected'])
        self.assertNotIn('disable', detail.json()['allowed_actions'])


@tagged('post_install', '-at_install', 'nasq', 'nasq_access')
class TestAccessAdminRoles(NasqApiCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.admin = new_test_user(
            cls.env, login='roles_api_admin', password='roles_api_admin_pass_123',
            groups='nasq_core.group_access_admin',
        )

    def setUp(self):
        super().setUp()
        self.authenticate('roles_api_admin', 'roles_api_admin_pass_123')

    def test_catalog_is_exact_and_protects_access_changes(self):
        response = self.api('GET', '/api/v1/admin/permissions')
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual((len(body['items']), body['total']), (25, 25))
        permission = next(item for item in body['items'] if item['key'] == 'access.users.assign_roles')
        self.assertFalse(permission['custom_role_allowed'])
        self.assertEqual(permission['scopes'], [{'kind': 'company', 'assignable': True}])

    def test_custom_role_lifecycle_version_and_protection(self):
        response = self.api('POST', '/api/v1/admin/roles', {
            'name': {'ar': 'قارئ المستخدمين', 'en': 'User reader'},
            'description': 'Read-only access administration',
            'permissions': ['access.users.read'],
        })
        self.assertEqual(response.status_code, 201, response.text)
        role = response.json()
        stale = self.api('PATCH', f"/api/v1/admin/roles/{role['id']}", {
            'description': 'Changed', 'expected_version': 'stale-version',
        })
        self.assertEqual((stale.status_code, stale.json()['code']), (409, 'conflict'))
        disabled = self.api('POST', f"/api/v1/admin/roles/{role['id']}/disable", {
            'expected_version': role['version'],
        })
        self.assertEqual(disabled.status_code, 200, disabled.text)
        self.assertFalse(disabled.json()['active'])

        forbidden = self.api('POST', '/api/v1/admin/roles', {
            'name': {'ar': 'دور ممنوع', 'en': None}, 'description': 'must fail',
            'permissions': ['access.users.read', 'access.roles.read', 'access.users.assign_roles'],
        })
        self.assertEqual((forbidden.status_code, forbidden.json()['code']), (
            422, 'custom_role_permission_forbidden',
        ))
        built_in = self.env.ref('nasq_core.role_system_admin')
        protected = self.api('PATCH', f'/api/v1/admin/roles/{built_in.id}', {
            'description': 'No',
            'expected_version': self.env['nasq.access.service']._nasq_role_version(built_in),
        })
        self.assertEqual((protected.status_code, protected.json()['code']), (403, 'protected_role'))


@tagged('post_install', '-at_install', 'nasq', 'nasq_access')
class TestAccessAdminAudit(NasqApiCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.admin = new_test_user(
            cls.env, login='audit_api_admin', password='audit_api_admin_pass_123',
            groups='nasq_core.group_access_admin',
        )
        cls.event = cls.env['nasq.access.audit']._nasq_log(
            action='user.password_reset', target=cls.employee,
            after={'sessions_revoked': True}, reason='fixture',
        )

    def test_audit_read_is_gated_filtered_and_sanitized(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        denied = self.api('GET', '/api/v1/admin/access-log')
        self.assertEqual((denied.status_code, denied.json()['code']), (403, 'forbidden'))
        self.authenticate('audit_api_admin', 'audit_api_admin_pass_123')
        response = self.api('GET', '/api/v1/admin/access-log?action=user.password_reset&limit=10&offset=0')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(set(response.json()), {'items', 'total'})
        detail = self.api('GET', f'/api/v1/admin/access-log/{self.event.id}')
        self.assertEqual(detail.status_code, 200, detail.text)
        self.assertEqual(detail.json()['after'], {'sessions_revoked': True})
        self.assertNotIn('session_id', str(detail.json()).lower())
        unknown = self.api('GET', '/api/v1/admin/access-log?unknown=1')
        self.assertEqual((unknown.status_code, unknown.json()['code']), (400, 'unsupported_filter'))
        self.assertEqual(self.api('DELETE', f'/api/v1/admin/access-log/{self.event.id}').status_code, 405)
