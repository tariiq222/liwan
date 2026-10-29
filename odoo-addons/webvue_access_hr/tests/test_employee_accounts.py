# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.http import root
from odoo.tests import new_test_user, tagged
from odoo.tests.common import HOST, Opener

from odoo.addons.webvue_api.tests.common import WebVueApiCase, set_probe_feature


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
class TestEmployeeAccounts(WebVueApiCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.admin = new_test_user(
            cls.env, login='employee_accounts_admin',
            password='employee_accounts_admin_pass_123',
            groups='webvue_core.group_access_admin,webvue_core.group_employee',
        )
        cls.department = cls.env['hr.department'].create({'name': 'Access API'})
        cls.target_employee = cls.env['hr.employee'].create({
            'name': 'Access Target', 'work_email': 'access.target@example.com',
            'department_id': cls.department.id, 'company_id': cls.env.company.id,
        })
        cls.role = cls.env.ref('webvue_core.role_employee')

    def _admin(self):
        self.authenticate('employee_accounts_admin', 'employee_accounts_admin_pass_123')

    def _assignments(self):
        return [{'role_id': self.role.id, 'scope': {
            'kind': 'company', 'id': self.env.company.id,
        }}]

    def _grant(self, employee=None, **overrides):
        return self.api('POST', '/api/v1/admin/employee-accounts', {
            'employee_id': (employee or self.target_employee).id,
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

    def test_routes_are_capability_gated(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        listed = self.api('GET', '/api/v1/admin/employee-accounts/candidates')
        self.assertEqual((listed.status_code, listed.json()['code']), (403, 'forbidden'))
        granted = self._grant()
        self.assertEqual((granted.status_code, granted.json()['code']), (403, 'forbidden'))

    def test_candidates_and_department_filter_are_server_counted(self):
        self._admin()
        candidates = self.api(
            'GET', '/api/v1/admin/employee-accounts/candidates?q=Access%20Target&limit=20&offset=0',
        )
        self.assertEqual(candidates.status_code, 200, candidates.text)
        self.assertEqual(set(candidates.json()), {'items', 'total'})
        self.assertEqual(candidates.json()['total'], 1)
        self.assertEqual(candidates.json()['items'][0]['id'], self.target_employee.id)
        self.assertEqual(set(candidates.json()['items'][0]), {
            'id', 'name', 'department', 'work_email', 'active', 'user_id', 'access_active',
        })
        by_department = self.api(
            'GET', f'/api/v1/admin/employee-accounts/candidates?department_id={self.department.id}',
        )
        self.assertEqual(by_department.json()['total'], 1)
        self.target_employee.write({'active': False})
        self.assertEqual(
            self.api('GET', '/api/v1/admin/employee-accounts/candidates?status=active&q=Access%20Target')
            .json()['total'], 0,
        )
        self.assertEqual(
            self.api('GET', '/api/v1/admin/employee-accounts/candidates?status=archived&q=Access%20Target')
            .json()['total'], 1,
        )
        for query in ('status=gone', 'department_id=0', 'employee_id=abc'):
            response = self.api('GET', f'/api/v1/admin/employee-accounts/candidates?{query}')
            self.assertEqual((response.status_code, response.json()['code']), (422, 'invalid'), query)
        unknown = self.api('GET', '/api/v1/admin/employee-accounts/candidates?color=red')
        self.assertEqual((unknown.status_code, unknown.json()['code']), (400, 'unsupported_filter'))

    def test_user_list_filters_by_department_and_reports_the_employee(self):
        self._admin()
        created = self._grant()
        self.assertEqual(created.status_code, 201, created.text)
        listed = self.api('GET', f'/api/v1/admin/users?department_id={self.department.id}')
        self.assertEqual(listed.status_code, 200, listed.text)
        self.assertEqual([item['id'] for item in listed.json()['items']], [created.json()['id']])
        self.assertEqual(listed.json()['items'][0]['employee']['id'], self.target_employee.id)
        other = self.env['hr.department'].create({'name': 'Other Access API'})
        empty = self.api('GET', f'/api/v1/admin/users?department_id={other.id}')
        self.assertEqual(empty.json(), {'items': [], 'total': 0})
        invalid = self.api('GET', '/api/v1/admin/users?department_id=abc')
        self.assertEqual((invalid.status_code, invalid.json()['code']), (422, 'invalid'))
        self.assertEqual(invalid.json()['field'], 'department_id')
        plain = self.api('GET', f"/api/v1/admin/users/{self.admin.id}")
        self.assertIsNone(plain.json()['employee'])

    def test_department_filter_needs_the_departments_capability(self):
        reader = new_test_user(
            self.env, login='access_reader_no_dept', password='access_reader_no_dept_pass',
            groups='webvue_core.group_access_admin',
        )
        self.assertFalse(self.env['webvue.access.service']._webvue_has_capability(
            reader, 'hr.departments.read',
        ))
        self.authenticate('access_reader_no_dept', 'access_reader_no_dept_pass')
        response = self.api('GET', f'/api/v1/admin/users?department_id={self.department.id}')
        self.assertEqual((response.status_code, response.json()['code']), (403, 'forbidden'))

    def test_account_routes_expose_no_hr_data_when_hr_is_off(self):
        self._admin()
        created = self._grant()
        self.assertEqual(created.status_code, 201, created.text)
        set_probe_feature(self, 'hr.enabled', enabled=False)
        detail = self.api('GET', f"/api/v1/admin/users/{created.json()['id']}")
        self.assertEqual(detail.status_code, 200, detail.text)
        self.assertNotIn('employee', detail.json())
        listed = self.api('GET', '/api/v1/admin/users')
        self.assertTrue(all('employee' not in item for item in listed.json()['items']))
        filtered = self.api('GET', f'/api/v1/admin/users?department_id={self.department.id}')
        self.assertEqual(
            (filtered.status_code, filtered.json()['code']), (400, 'unsupported_filter'),
        )

    def test_grant_reset_disable_reactivate_and_old_session(self):
        self._admin()
        response = self._grant()
        self.assertEqual(response.status_code, 201, response.text)
        created = response.json()
        self.assertEqual(created['employee']['id'], self.target_employee.id)
        self.assertEqual(created['login'], 'access.target@example.com')
        assert_secret_absent(self, created, 'target_password_123')
        self.target_employee.invalidate_recordset(['user_id'])
        self.assertEqual(self.target_employee.user_id.id, created['id'])
        audit = self.env['webvue.access.audit']
        self.assertEqual(audit.search_count([
            ('action', '=', 'user.granted'), ('target_id', '=', created['id']),
        ]), 1)
        self.assertEqual(audit.search_count([
            ('action', '=', 'user.employee_linked'), ('target_id', '=', created['id']),
        ]), 1)

        old_session = self.authenticate('access.target@example.com', 'target_password_123')
        root.session_store.save(old_session)
        self._admin()
        response = self.api('POST', f"/api/v1/admin/users/{created['id']}/password", {
            'password': 'target_password_456', 'expected_version': created['version'],
        })
        self.assertEqual(response.status_code, 200, response.text)
        changed = response.json()
        self.assertEqual(changed['employee']['id'], self.target_employee.id)
        self.opener = Opener(self)
        self.opener.cookies.set('session_id', old_session.sid, domain=HOST)
        self.assertEqual(self.api('GET', '/api/v1/me').status_code, 401)

        self._admin()
        stopped = self.api('POST', f"/api/v1/admin/users/{created['id']}/disable", {
            'expected_version': changed['version'],
        })
        self.assertEqual(stopped.status_code, 200, stopped.text)
        self.assertFalse(stopped.json()['active'])
        reactivated = self.api('POST', f"/api/v1/admin/users/{created['id']}/reactivate", {
            'expected_version': stopped.json()['version'],
            'password': 'target_password_789',
        })
        self.assertEqual(reactivated.status_code, 200, reactivated.text)
        self.assertTrue(reactivated.json()['active'])

    def test_reactivating_the_account_of_an_archived_employee_is_a_conflict(self):
        self._admin()
        created = self._grant().json()
        stopped = self.api('POST', f"/api/v1/admin/users/{created['id']}/disable", {
            'expected_version': created['version'],
        })
        self.assertEqual(stopped.status_code, 200, stopped.text)
        self.target_employee.write({'active': False})
        response = self.api('POST', f"/api/v1/admin/users/{created['id']}/reactivate", {
            'expected_version': stopped.json()['version'],
            'password': 'target_password_789',
        })
        self.assertEqual((response.status_code, response.json()['code']), (409, 'employee_archived'))
        user = self.env['res.users'].with_context(active_test=False).browse(created['id'])
        user.invalidate_recordset(['active'])
        self.assertFalse(user.active)

    def test_failed_grant_rolls_back_user_employee_link_and_audit(self):
        self._admin()
        audit_count = self.env['webvue.access.audit'].search_count([])
        response = self._grant(assignments=[{'role_id': 2147483647, 'scope': {
            'kind': 'company', 'id': self.env.company.id,
        }}])
        self.assertEqual((response.status_code, response.json()['code']), (422, 'invalid'))
        self.target_employee.invalidate_recordset(['user_id'])
        self.assertFalse(self.target_employee.user_id)
        self.assertFalse(self.env['res.users'].with_context(active_test=False).search([
            ('login', '=', self.target_employee.work_email),
        ]))
        self.assertEqual(self.env['webvue.access.audit'].search_count([]), audit_count)

    def test_grant_refusals(self):
        self._admin()
        missing = self._grant(employee=self.env['hr.employee'].browse(2147483647))
        self.assertEqual((missing.status_code, missing.json()['code']), (404, 'not_found'))

        no_email = self.env['hr.employee'].create({
            'name': 'No Email', 'company_id': self.env.company.id,
        })
        response = self._grant(employee=no_email)
        self.assertEqual((response.status_code, response.json()['code']), (422, 'work_email_required'))
        self.assertEqual(response.json()['field'], 'employee_id')

        first = self._grant()
        self.assertEqual(first.status_code, 201, first.text)
        again = self._grant()
        self.assertEqual((again.status_code, again.json()['code']), (409, 'account_exists'))
        self.assertEqual(again.json()['field'], 'employee_id')

        taken = self.env['hr.employee'].create({
            'name': 'Taken Login', 'work_email': 'ACCESS.TARGET@example.com',
            'company_id': self.env.company.id,
        })
        clash = self._grant(employee=taken)
        self.assertEqual((clash.status_code, clash.json()['code']), (409, 'account_exists'))
        self.assertEqual(clash.json()['field'], 'login')

        extra = self._grant(login='x@example.com')
        self.assertEqual((extra.status_code, extra.json()['field']), (422, 'login'))

    def test_archived_employee_is_rejected(self):
        self.target_employee.write({'active': False})
        self._admin()
        response = self._grant()
        self.assertEqual((response.status_code, response.json()['code']), (422, 'employee_archived'))
        self.assertEqual(response.json()['field'], 'employee_id')

    def test_invalid_integer_shapes_do_not_write(self):
        self._admin()
        login = self.target_employee.work_email
        for employee_id in (True, False, 1.5, 0, -1, '1.5', 'abc', [], {}, None, '0', ' 1'):
            response = self.api('POST', '/api/v1/admin/employee-accounts', {
                'employee_id': employee_id,
                'password': 'target_password_123',
                'assignments': self._assignments(),
            })
            self.assertEqual(response.status_code, 422, response.text)
            self.assertEqual(response.json()['code'], 'invalid')
            self.assertEqual(response.json()['field'], 'employee_id')
        self.target_employee.invalidate_recordset(['user_id'])
        self.assertFalse(self.target_employee.user_id)
        self.assertFalse(self.env['res.users'].with_context(active_test=False).search([
            ('login', '=', login),
        ]))

    def test_admin_password_preserves_original_whitespace_on_granted_accounts(self):
        self._admin()
        grant_employee = self.env['hr.employee'].create({
            'name': 'Padded Grant',
            'work_email': 'padded.grant@example.com',
            'company_id': self.env.company.id,
        })
        grant_password = '  padded_grant_pass_123  '
        weak = self._grant(employee=grant_employee, password='  1234567  ')
        self.assertEqual((weak.status_code, weak.json()['code']), (422, 'weak_password'))
        granted = self._grant(employee=grant_employee, password=grant_password)
        self.assertEqual(granted.status_code, 201, granted.text)
        self._assert_stored_password('padded.grant@example.com', grant_password)
        self.authenticate('padded.grant@example.com', grant_password)
        self.assertEqual(self.api('GET', '/api/v1/me').status_code, 200)
