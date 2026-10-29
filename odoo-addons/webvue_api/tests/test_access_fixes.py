# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import new_test_user, tagged

from .common import WebVueApiCase


@tagged('post_install', '-at_install', 'webvue', 'webvue_access')
class TestAccessFixes(WebVueApiCase):
    """Access-log naming and completeness, duplicate operations, role names, readable errors, 401."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        new_test_user(
            cls.env, login='access_fix_admin', password='access_fix_admin_pass_123',
            groups='webvue_core.group_access_admin',
        )
        cls.service = cls.env['webvue.access.service']

    def _admin(self):
        self.authenticate('access_fix_admin', 'access_fix_admin_pass_123')

    def _role(self, name='دور اختبار', permissions=('access.users.read', 'access.roles.read')):
        return self.api('POST', '/api/v1/admin/roles', {
            'name': {'ar': name, 'en': None}, 'description': '', 'permissions': list(permissions),
        })

    def _events(self, action):
        return self.env['webvue.access.audit'].search([('action', '=', action)])

    def test_role_events_carry_the_role_name(self):
        self._admin()
        role = self._role('دور السجل').json()
        self.assertEqual(self._events('role.created').target_name, 'دور السجل')
        disabled = self.api('POST', f"/api/v1/admin/roles/{role['id']}/disable", {'expected_version': role['version']})
        self.assertEqual(self._events('role.disabled').target_name, 'دور السجل')
        listed = self.api('GET', '/api/v1/admin/access-log?target_type=role').json()
        self.assertEqual({item['target']['name'] for item in listed['items']}, {'دور السجل'})
        self.assertEqual(disabled.status_code, 200, disabled.text)

    def test_a_custom_role_name_is_unique_in_the_company(self):
        self._admin()
        self.assertEqual(self._role('دور فريد').status_code, 201)
        duplicate = self._role(' دور فريد ')
        self.assertEqual((duplicate.status_code, duplicate.json()['code']), (409, 'role_name_exists'))
        self.assertEqual(duplicate.json()['field'], 'name')
        self.assertEqual(self.env['webvue.access.role'].search_count([('name_ar', '=', 'دور فريد')]), 1)

    def test_repeating_a_role_state_is_refused_without_an_event(self):
        self._admin()
        role = self._role('دور الحالة').json()
        first = self.api('POST', f"/api/v1/admin/roles/{role['id']}/disable", {'expected_version': role['version']})
        again = self.api('POST', f"/api/v1/admin/roles/{role['id']}/disable", {'expected_version': first.json()['version']})
        self.assertEqual((again.status_code, again.json()['code']), (409, 'role_state_unchanged'))
        self.assertEqual(len(self._events('role.disabled')), 1)

    def test_disabling_or_reactivating_twice_is_refused_without_an_event(self):
        self._admin()
        target = new_test_user(self.env, login='access_fix_target', groups='webvue_core.group_employee')
        version = self.service._webvue_user_version(target)
        first = self.api('POST', f'/api/v1/admin/users/{target.id}/disable', {'expected_version': version})
        self.assertEqual(first.status_code, 200, first.text)
        again = self.api('POST', f'/api/v1/admin/users/{target.id}/disable', {'expected_version': first.json()['version']})
        self.assertEqual((again.status_code, again.json()['code']), (409, 'user_already_disabled'))
        self.assertEqual(len(self._events('user.disabled')), 1)
        back = self.api('POST', f'/api/v1/admin/users/{target.id}/reactivate', {
            'expected_version': first.json()['version'], 'password': 'access_fix_pass_123',
        })
        self.assertEqual(back.status_code, 200, back.text)
        twice = self.api('POST', f'/api/v1/admin/users/{target.id}/reactivate', {
            'expected_version': back.json()['version'], 'password': 'access_fix_pass_123',
        })
        self.assertEqual((twice.status_code, twice.json()['code']), (409, 'user_already_active'))
        self.assertEqual(len(self._events('user.reactivated')), 1)

    def test_a_missing_dependency_answers_in_readable_arabic(self):
        self._admin()
        response = self._role('دور ناقص', permissions=('access.users.read',))
        body = response.json()
        self.assertEqual((response.status_code, body['code']), (422, 'missing_dependency'))
        self.assertEqual(body['message'], 'أضف الصلاحيات التابعة أولًا.')
        self.assertEqual(body['details']['permission'], 'access.users.read')

    def test_the_user_version_ignores_unrelated_policy_changes(self):
        target = new_test_user(self.env, login='access_fix_version', groups='webvue_core.group_employee')
        before = self.service._webvue_user_version(target)
        self.service._webvue_bump_policy(self.env.company)
        self.assertEqual(self.service._webvue_user_version(target), before)
        self.service._webvue_check_user_version(target, before)
        target._webvue_bump_record_versions()
        self.assertNotEqual(self.service._webvue_user_version(target), before)

    def test_company_profile_and_branding_changes_are_logged(self):
        company = self.env.company
        owner = new_test_user(self.env, login='access_fix_owner', groups='webvue_core.group_customer_admin')
        company.with_user(owner)._webvue_write_company_profile({'city': 'الرياض'})
        company.with_user(owner)._webvue_write_branding({'primary_color': '#0055ff'})
        profile = self._events('company.profile_changed')
        branding = self._events('company.branding_changed')
        self.assertEqual((profile.target_type, profile.target_id, profile.after), ('company', company.id, {'fields': ['city']}))
        self.assertEqual(branding.after, {'fields': ['primary_color']})

    def test_a_request_without_a_session_is_401(self):
        for path in ('/api/v1/me', '/api/v1/admin/users', '/api/v1/admin/roles'):
            with self.subTest(path=path):
                response = self.api('GET', path)
                self.assertEqual(response.status_code, 401)
                self.assertEqual(response.json()['code'], 'session_required')

    def test_a_settings_manager_without_access_administration_still_saves_and_is_logged(self):
        role = self.env['webvue.access.role'].create({
            'name_ar': 'مدير إعدادات الشركة', 'type': 'custom', 'company_id': self.env.company.id,
            'permission_ids': [(6, 0, self.env['webvue.access.permission'].search([
                ('key', 'in', ['settings.company.manage', 'settings.company.read', 'settings.branding.manage', 'settings.branding.read']),
            ]).ids)],
        })
        manager = new_test_user(self.env, login='access_fix_settings', groups='webvue_core.group_employee')
        self.service._webvue_replace_assignments(manager, [{'role_id': role.id, 'company_id': self.env.company.id}])
        self.assertFalse(manager.has_group('base.group_system'))
        company = self.env.company.with_user(manager)
        company._webvue_write_company_profile({'city': 'جدة'})
        company._webvue_write_branding({'primary_color': '#112233'})
        self.assertEqual(self._events('company.profile_changed').actor_id, manager)
        self.assertTrue(self._events('company.branding_changed'))
