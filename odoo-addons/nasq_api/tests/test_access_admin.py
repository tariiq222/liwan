# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.http import root
from odoo.tests import new_test_user, tagged
from odoo.tests.common import HOST, Opener

from .common import NasqApiCase
from odoo.addons.nasq_api.controllers.common import ApiError, parse_positive_int
from odoo.addons.nasq_api.serializers.access import role_user_count, role_user_counts


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

    def _assert_stored_password(self, login, original):
        """HttpCase.authenticate patches _check_credentials and cannot prove the hash."""
        user = self.env['res.users'].search([('login', '=', login)], limit=1)
        self.assertTrue(user, 'dedicated account %s was not created' % login)
        self.env.cr.execute('SELECT password FROM res_users WHERE id = %s', [user.id])
        hashed = self.env.cr.fetchone()[0]
        crypt = user._crypt_context()
        self.assertTrue(crypt.verify(original, hashed))
        self.assertFalse(crypt.verify(original.strip(), hashed))
        self.assertFalse(crypt.verify('wrong_password_000', hashed))

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

    def test_parse_positive_int_rejects_invalid_shapes_and_keeps_digit_strings(self):
        for value in (
            True, False, 1.0, 1.5, 0, -3, None, [], {}, set(),
            '1.5', '1e2', ' 1', '1 ', '+1', '0x10', '0', '-3', '', '١٢٣',
        ):
            with self.assertRaises(ApiError) as ctx:
                parse_positive_int(value, 'employee_id')
            self.assertEqual(ctx.exception.status, 422)
            self.assertEqual(ctx.exception.code, 'invalid')
            self.assertEqual(ctx.exception.field, 'employee_id')
        self.assertEqual(parse_positive_int(3, 'employee_id'), 3)
        self.assertEqual(parse_positive_int('42', 'employee_id'), 42)
        self.assertEqual(parse_positive_int('007', 'role_id'), 7)

    def test_invalid_integer_shapes_do_not_write(self):
        self._admin()
        login = self.target_employee.work_email
        role = self.env.ref('nasq_core.role_employee')
        assignment = {'role_id': role.id, 'scope': {'kind': 'company', 'id': self.env.company.id}}
        for employee_id in (True, False, 1.5, 0, -1, '1.5', 'abc', [], {}, None, '0', ' 1'):
            response = self.api('POST', '/api/v1/admin/users', {
                'employee_id': employee_id,
                'password': 'target_password_123',
                'assignments': [assignment],
            })
            self.assertEqual(response.status_code, 422, response.text)
            self.assertEqual(response.json()['code'], 'invalid')
            self.assertEqual(response.json()['field'], 'employee_id')
        self.target_employee.invalidate_recordset(['user_id'])
        self.assertFalse(self.target_employee.user_id)
        self.assertFalse(self.env['res.users'].with_context(active_test=False).search([
            ('login', '=', login),
        ]))

    def test_admin_password_preserves_original_whitespace_on_dedicated_accounts(self):
        self._admin()
        role = self.env.ref('nasq_core.role_employee')
        grant_employee = self.env['hr.employee'].create({
            'name': 'Padded Grant',
            'work_email': 'padded.grant@example.com',
            'company_id': self.env.company.id,
        })
        grant_password = '  padded_grant_pass_123  '
        weak = self.api('POST', '/api/v1/admin/users', {
            'employee_id': grant_employee.id,
            'password': '  1234567  ',
            'assignments': [{'role_id': role.id, 'scope': {
                'kind': 'company', 'id': self.env.company.id,
            }}],
        })
        self.assertEqual((weak.status_code, weak.json()['code']), (422, 'weak_password'))
        granted = self.api('POST', '/api/v1/admin/users', {
            'employee_id': grant_employee.id,
            'password': grant_password,
            'assignments': [{'role_id': role.id, 'scope': {
                'kind': 'company', 'id': self.env.company.id,
            }}],
        })
        self.assertEqual(granted.status_code, 201, granted.text)
        self._assert_stored_password('padded.grant@example.com', grant_password)
        self.authenticate('padded.grant@example.com', grant_password)
        self.assertEqual(self.api('GET', '/api/v1/me').status_code, 200)

        reset_employee = self.env['hr.employee'].create({
            'name': 'Padded Reset',
            'work_email': 'padded.reset@example.com',
            'company_id': self.env.company.id,
        })
        self._admin()
        created = self.api('POST', '/api/v1/admin/users', {
            'employee_id': reset_employee.id,
            'password': 'reset_initial_pass_123',
            'assignments': [{'role_id': role.id, 'scope': {
                'kind': 'company', 'id': self.env.company.id,
            }}],
        })
        self.assertEqual(created.status_code, 201, created.text)
        reset_password = '  padded_reset_pass_456  '
        reset = self.api('POST', f"/api/v1/admin/users/{created.json()['id']}/password", {
            'password': reset_password, 'expected_version': created.json()['version'],
        })
        self.assertEqual(reset.status_code, 200, reset.text)
        self._assert_stored_password('padded.reset@example.com', reset_password)
        self.authenticate('padded.reset@example.com', reset_password)
        self.assertEqual(self.api('GET', '/api/v1/me').status_code, 200)


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
        self.assertEqual((len(body['items']), body['total']), (28, 28))
        self.assertEqual(
            {item['key'] for item in body['items'] if item['key'].startswith('meetings.')},
            {'meetings.read', 'meetings.create', 'meetings.manage'},
        )
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

    def test_invalid_permission_shapes_do_not_write(self):
        before = self.env['nasq.access.role'].with_context(active_test=False).search_count([])
        for permissions in (
            [{'key': 'access.users.read'}], [None], [1], 'access.users.read',
            {'access.users.read': True},
            ['access.users.read', {'key': 'access.roles.read'}],
        ):
            response = self.api('POST', '/api/v1/admin/roles', {
                'name': {'ar': 'دور شكل خاطئ', 'en': None},
                'description': 'must not write',
                'permissions': permissions,
            })
            self.assertEqual(response.status_code, 422, response.text)
            self.assertEqual(response.json()['code'], 'invalid')
            self.assertEqual(response.json()['field'], 'permissions')
        self.assertEqual(
            self.env['nasq.access.role'].with_context(active_test=False).search_count([]),
            before,
        )

    def test_role_user_count_is_batched_and_current_company_only(self):
        company_b = self.env['res.company'].create({'name': 'Role count company B'})
        role = self.env.ref('nasq_core.role_employee')
        listed = self.api('GET', '/api/v1/admin/roles?limit=200')
        self.assertEqual(listed.status_code, 200, listed.text)
        before = next(item['user_count'] for item in listed.json()['items'] if item['id'] == role.id)

        user_a = new_test_user(
            self.env, login='role_count_user_a', groups='base.group_user',
            company_id=self.env.company.id,
        )
        user_b = new_test_user(
            self.env, login='role_count_user_b', groups='base.group_user',
            company_id=company_b.id,
        )
        user_b.write({'company_ids': [(6, 0, [company_b.id])]})
        self.env['nasq.access.assignment'].create({
            'user_id': user_a.id, 'role_id': role.id, 'company_id': self.env.company.id,
        })
        self.env['nasq.access.assignment'].create({
            'user_id': user_b.id, 'role_id': role.id, 'company_id': company_b.id,
        })

        other = self.env.ref('nasq_core.role_hr_manager')
        counts = role_user_counts(role | other)
        self.assertEqual(counts[role.id], before + 1)
        self.assertEqual(counts[role.id], role_user_count(role))
        self.assertEqual(counts[other.id], role_user_count(other))

        listed = self.api('GET', '/api/v1/admin/roles?limit=200')
        self.assertEqual(listed.status_code, 200, listed.text)
        after = next(item['user_count'] for item in listed.json()['items'] if item['id'] == role.id)
        self.assertEqual(after, before + 1)
        detail = self.api('GET', f'/api/v1/admin/roles/{role.id}')
        self.assertEqual(detail.status_code, 200, detail.text)
        self.assertEqual(detail.json()['user_count'], after)


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
