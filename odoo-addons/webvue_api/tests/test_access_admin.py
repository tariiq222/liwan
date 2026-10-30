# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import timedelta

from odoo.exceptions import AccessError, ValidationError
from odoo.http import root
from odoo.tests import new_test_user, tagged
from odoo.tests.common import HOST, Opener
from odoo.tools import mute_logger

from .common import WebVueApiCase
from odoo.addons.webvue_api.controllers.common import ApiError, parse_positive_int
from odoo.addons.webvue_api.serializers.access import role_user_count, role_user_counts


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


@tagged('post_install', '-at_install', 'webvue', 'webvue_access')
class TestAccessAdminUsers(WebVueApiCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.admin = new_test_user(
            cls.env, login='access_api_admin', password='access_api_admin_pass_123',
            groups='webvue_core.group_access_admin',
        )
        cls.role = cls.env.ref('webvue_core.role_employee')

    def _admin(self):
        self.authenticate('access_api_admin', 'access_api_admin_pass_123')

    def _assignments(self):
        return [{'role_id': self.role.id, 'scope': {
            'kind': 'company', 'id': self.env.company.id,
        }}]

    def _create(self, **overrides):
        return self.api('POST', '/api/v1/admin/users', {
            'name': 'Access Target',
            'login': 'access.target@example.com',
            'password': 'target_password_123',
            'assignments': self._assignments(),
            **overrides,
        })

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
        response = self.api('GET', '/api/v1/admin/users?limit=20&offset=0')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(set(response.json()), {'items', 'total'})
        filtered = self.api('GET', '/api/v1/admin/users?color=red')
        self.assertEqual((filtered.status_code, filtered.json()['code']), (400, 'unsupported_filter'))
        self.assertEqual(filtered.json()['field'], 'color')

    def test_a_users_reader_role_opens_users_who_hold_roles(self):
        # #173: access.users.read alone could not read the roles of the users it lists.
        Role = self.env['webvue.access.role']
        Permission = self.env['webvue.access.permission']
        with self.assertRaisesRegex(ValidationError, 'missing_dependency: access.users.read requires access.roles.read'):
            Role.create({'name_ar': 'قراءة المستخدمين فقط', 'type': 'custom', 'company_id': self.env.company.id,
                         'permission_ids': [(6, 0, Permission.search([('key', '=', 'access.users.read')]).ids)]})
        reader_role = Role.create({
            'name_ar': 'قراءة المستخدمين', 'type': 'custom', 'company_id': self.env.company.id,
            'permission_ids': [(6, 0, Permission.search([('key', 'in', ['access.users.read', 'access.roles.read'])]).ids)],
        })
        reader = new_test_user(self.env, login='access_users_reader', password='access_users_reader_123', groups='base.group_user')
        service = self.env['webvue.access.service']
        service._webvue_replace_assignments(reader, [{'role_id': reader_role.id, 'company_id': self.env.company.id}])
        service._webvue_replace_assignments(self.employee, [{'role_id': self.role.id, 'company_id': self.env.company.id}])
        self.authenticate('access_users_reader', 'access_users_reader_123')
        listed = self.api('GET', '/api/v1/admin/users?limit=50')
        self.assertEqual(listed.status_code, 200, listed.text)
        detail = self.api('GET', f'/api/v1/admin/users/{self.employee.id}')
        self.assertEqual(detail.status_code, 200, detail.text)
        self.assertEqual([item['role']['id'] for item in detail.json()['assignments']], [self.role.id])
        self.assertEqual(detail.json()['allowed_actions'], ['read'])

    def test_create_reset_disable_reactivate_and_old_session(self):
        self._admin()
        response = self._create(login='  Access.Target@Example.com ')
        self.assertEqual(response.status_code, 201, response.text)
        created = response.json()
        self.assertEqual(created['login'], 'access.target@example.com')
        self.assertEqual(created['name'], 'Access Target')
        self.assertEqual([item['role']['id'] for item in created['assignments']], [self.role.id])
        assert_secret_absent(self, created, 'target_password_123')
        grants = self.env['webvue.access.audit'].search([
            ('action', '=', 'user.granted'), ('target_id', '=', created['id']),
        ])
        self.assertEqual(len(grants), 1)

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
        self.assertEqual(self.api('GET', '/api/v1/me').status_code, 401)

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

        listed = self.api('GET', '/api/v1/admin/users?q=access.target')
        self.assertEqual(listed.status_code, 200, listed.text)
        self.assertEqual([item['id'] for item in listed.json()['items']], [created['id']])
        self.assertEqual(listed.json()['total'], 1)

    def test_duplicate_login_is_a_conflict_in_any_state_or_company(self):
        self._admin()
        first = self._create()
        self.assertEqual(first.status_code, 201, first.text)
        again = self._create(login='ACCESS.target@example.com')
        self.assertEqual((again.status_code, again.json()['code']), (409, 'account_exists'))
        self.assertEqual(again.json()['field'], 'login')

        stopped = self.api('POST', f"/api/v1/admin/users/{first.json()['id']}/disable", {
            'expected_version': first.json()['version'],
        })
        self.assertEqual(stopped.status_code, 200, stopped.text)
        again = self._create()
        self.assertEqual((again.status_code, again.json()['code']), (409, 'account_exists'))

        other_company = self.env['res.company'].create({'name': 'Other Access Company'})
        new_test_user(
            self.env, login='elsewhere@example.com', company_id=other_company.id,
            company_ids=[other_company.id],
        )
        with mute_logger('odoo.sql_db'):
            elsewhere = self._create(login='elsewhere@example.com')
        self.assertEqual((elsewhere.status_code, elsewhere.json()['code']), (409, 'account_exists'))
        self.assertEqual(elsewhere.json()['field'], 'login')

    def test_create_rejects_invalid_bodies_without_writing(self):
        self._admin()
        audit_count = self.env['webvue.access.audit'].search_count([])
        cases = (
            ({'login': 'not-an-email'}, 'login'),
            ({'login': ''}, 'login'),
            ({'login': 7}, 'login'),
            ({'login': None}, 'login'),
            ({'name': '   '}, 'name'),
            ({'name': 7}, 'name'),
            ({'unknown': 1}, 'unknown'),
        )
        for overrides, field in cases:
            response = self._create(**overrides)
            self.assertEqual(response.status_code, 422, response.text)
            self.assertEqual(response.json()['code'], 'invalid')
            self.assertEqual(response.json()['field'], field)
        missing = self.api('POST', '/api/v1/admin/users', {
            'name': 'Access Target', 'login': 'access.target@example.com',
            'password': 'target_password_123',
        })
        self.assertEqual((missing.status_code, missing.json()['field']), (422, 'assignments'))
        failed = self._create(assignments=[{'role_id': 2147483647, 'scope': {
            'kind': 'company', 'id': self.env.company.id,
        }}])
        self.assertEqual((failed.status_code, failed.json()['code']), (422, 'invalid'))
        self.assertFalse(self.env['res.users'].with_context(active_test=False).search([
            ('login', '=', 'access.target@example.com'),
        ]))
        self.assertEqual(self.env['webvue.access.audit'].search_count([]), audit_count)

    def test_grant_capability_creates_a_contact_only_inside_the_account_create(self):
        Partner = self.env['res.partner'].with_user(self.admin)
        with self.assertRaises(AccessError):
            Partner.create({'name': 'Loose Contact', 'email': 'loose.contact@example.com'})
        self._admin()
        role = self.env.ref('webvue_core.role_employee')
        response = self.api('POST', '/api/v1/admin/users', {
            'name': 'Marked Contact', 'login': 'marked.contact@example.com',
            'password': 'marked_contact_pass_123',
            'assignments': [{'role_id': role.id, 'scope': {'kind': 'company', 'id': self.env.company.id}}],
        })
        self.assertEqual(response.status_code, 201, response.text)
        user = self.env['res.users'].browse(response.json()['id'])
        self.assertEqual(user.partner_id.email, 'marked.contact@example.com')
        with self.assertRaises(AccessError):
            Partner.create({'name': 'Loose Contact', 'email': 'loose.contact@example.com'})

    def test_vendor_mutation_is_rejected(self):
        self._admin()
        vendor = new_test_user(self.env, login='access_api_vendor', groups='webvue_core.group_vendor_support')
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
                parse_positive_int(value, 'role_id')
            self.assertEqual(ctx.exception.status, 422)
            self.assertEqual(ctx.exception.code, 'invalid')
            self.assertEqual(ctx.exception.field, 'role_id')
        self.assertEqual(parse_positive_int(3, 'role_id'), 3)
        self.assertEqual(parse_positive_int('42', 'role_id'), 42)
        self.assertEqual(parse_positive_int('007', 'role_id'), 7)

    def test_admin_password_preserves_original_whitespace_on_dedicated_accounts(self):
        self._admin()
        grant_password = '  padded_grant_pass_123  '
        weak = self._create(login='padded.grant@example.com', password='  1234567  ')
        self.assertEqual((weak.status_code, weak.json()['code']), (422, 'weak_password'))
        granted = self._create(login='padded.grant@example.com', password=grant_password)
        self.assertEqual(granted.status_code, 201, granted.text)
        self._assert_stored_password('padded.grant@example.com', grant_password)
        self.authenticate('padded.grant@example.com', grant_password)
        self.assertEqual(self.api('GET', '/api/v1/me').status_code, 200)

        self._admin()
        created = self._create(login='padded.reset@example.com', password='reset_initial_pass_123')
        self.assertEqual(created.status_code, 201, created.text)
        reset_password = '  padded_reset_pass_456  '
        reset = self.api('POST', f"/api/v1/admin/users/{created.json()['id']}/password", {
            'password': reset_password, 'expected_version': created.json()['version'],
        })
        self.assertEqual(reset.status_code, 200, reset.text)
        self._assert_stored_password('padded.reset@example.com', reset_password)
        self.authenticate('padded.reset@example.com', reset_password)
        self.assertEqual(self.api('GET', '/api/v1/me').status_code, 200)


@tagged('post_install', '-at_install', 'webvue', 'webvue_access')
class TestAccessAdminRoles(WebVueApiCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.admin = new_test_user(
            cls.env, login='roles_api_admin', password='roles_api_admin_pass_123',
            groups='webvue_core.group_access_admin',
        )

    def setUp(self):
        super().setUp()
        self.authenticate('roles_api_admin', 'roles_api_admin_pass_123')

    def test_catalog_is_exact_and_protects_access_changes(self):
        response = self.api('GET', '/api/v1/admin/permissions')
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        installed = {
            module.name for module in self.env['ir.module.module'].search([
                ('name', 'in', ['webvue_hr', 'webvue_documents', 'webvue_pmo', 'webvue_meetings']),
                ('state', '=', 'installed'),
            ])
        }
        installed_all = {
            module.name for module in self.env['ir.module.module'].search([('state', '=', 'installed')])
        }
        # 11 core capabilities; HR's two document permissions moved to Documents,
        # leaving 21 for HR (departments, employees, leave, recruitment, shifts,
        # onboarding, offboarding and assets) and 6 for payroll (its four keys, the audit
        # reader of owner decision D-7 and the finance mapping).
        total = (
            11 + 27 * ('webvue_hr' in installed) + 5 * ('webvue_documents' in installed)
            + 8 * ('webvue_pmo' in installed) + 4 * ('webvue_meetings' in installed)
        )
        # An application added later adds capabilities; today's are exact.
        owners = self.env['webvue.access.service']._webvue_capability_map()
        release = {'webvue_core', 'webvue_hr', 'webvue_documents', 'webvue_pmo', 'webvue_meetings'}
        items = [item for item in body['items'] if owners[item['key']]['owner'] in release]
        extra = len(body['items']) - len(items)
        self.assertEqual((len(items), body['total'] - extra), (total, total))
        self.assertTrue(all(
            owners[item['key']]['owner'] in installed_all for item in body['items'] if item not in items
        ))
        self.assertEqual(
            {item['key'] for item in body['items'] if item['key'].startswith('meetings.')},
            {'meetings.read', 'meetings.create', 'meetings.manage', 'meetings.settings.manage'} if 'webvue_meetings' in installed else set(),
        )
        self.assertEqual(
            {item['key'] for item in body['items'] if item['key'].startswith('documents.')},
            {
                'documents.items.read', 'documents.items.manage', 'documents.items.archive',
                'documents.access.manage', 'documents.library.manage',
            } if 'webvue_documents' in installed else set(),
        )
        permission = next(item for item in body['items'] if item['key'] == 'access.users.assign_roles')
        self.assertFalse(permission['custom_role_allowed'])
        self.assertEqual(permission['scopes'], [{'kind': 'company', 'assignable': True}])

    def test_custom_role_lifecycle_version_and_protection(self):
        response = self.api('POST', '/api/v1/admin/roles', {
            'name': {'ar': 'قارئ المستخدمين', 'en': 'User reader'},
            'description': 'Read-only access administration',
            'permissions': ['access.users.read', 'access.roles.read'],
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
        built_in = self.env.ref('webvue_core.role_system_admin')
        protected = self.api('PATCH', f'/api/v1/admin/roles/{built_in.id}', {
            'description': 'No',
            'expected_version': self.env['webvue.access.service']._webvue_role_version(built_in),
        })
        self.assertEqual((protected.status_code, protected.json()['code']), (403, 'protected_role'))

    def test_invalid_permission_shapes_do_not_write(self):
        before = self.env['webvue.access.role'].with_context(active_test=False).search_count([])
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
            self.env['webvue.access.role'].with_context(active_test=False).search_count([]),
            before,
        )

    def test_role_user_count_is_batched_and_current_company_only(self):
        company_b = self.env['res.company'].create({'name': 'Role count company B'})
        role = self.env.ref('webvue_core.role_employee')
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
        self.env['webvue.access.assignment'].create({
            'user_id': user_a.id, 'role_id': role.id, 'company_id': self.env.company.id,
        })
        self.env['webvue.access.assignment'].create({
            'user_id': user_b.id, 'role_id': role.id, 'company_id': company_b.id,
        })

        other = self.env.ref('webvue_core.role_system_admin')
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


@tagged('post_install', '-at_install', 'webvue', 'webvue_access')
class TestAccessAdminAudit(WebVueApiCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.admin = new_test_user(
            cls.env, login='audit_api_admin', password='audit_api_admin_pass_123',
            groups='webvue_core.group_access_admin',
        )
        cls.event = cls.env['webvue.access.audit']._webvue_log(
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

    def test_audit_date_filters(self):
        # #174: a bad date answered 500; a day names the whole day; an ISO datetime with Z is accepted.
        self.authenticate('audit_api_admin', 'audit_api_admin_pass_123')
        for query in ('from=garbage', 'to=2026-99-99', 'from=2026-10-28T25:00:00'):
            with self.subTest(query=query):
                response = self.api('GET', f'/api/v1/admin/access-log?{query}')
                self.assertEqual((response.status_code, response.json()['code']), (422, 'invalid'), response.text)
                self.assertEqual(response.json()['field'], query.split('=')[0])
        self.admin.tz = 'UTC'
        day = self.event.create_date.date().isoformat()

        def ids(query):
            return [item['id'] for item in self.api('GET', f'/api/v1/admin/access-log?{query}').json()['items']]
        self.assertIn(self.event.id, ids(f'from={day}&to={day}'))
        self.assertIn(self.event.id, ids(f'from={self.event.create_date.isoformat()}Z'))
        self.assertNotIn(self.event.id, ids(f'to={self.event.create_date.date() - timedelta(days=1)}'))
