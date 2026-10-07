# Part of Odoo. See LICENSE file for full copyright and licensing details.
from unittest.mock import patch

from odoo.exceptions import AccessDenied, UserError
from odoo.http import root
from odoo.tests import HttpCase, new_test_user, tagged
from odoo.tests.common import HOST, Opener

from odoo.addons.nasq_api.controllers.common import (
    clear_security_caches_after_commit,
    fresh_session_token,
)
from odoo.addons.nasq_api.serializers.user import dump_me, dump_platform
from odoo.addons.nasq_api.tests.common import NasqApiCase


@tagged('post_install', '-at_install', 'nasq')
class TestMeEndpoint(HttpCase):

    def test_anonymous_is_403(self):
        res = self.url_open('/api/v1/me')
        self.assertEqual(res.status_code, 403)

    def test_employee(self):
        new_test_user(self.env, login='emp', password='emp_password_123',
                      name='Sara', email='sara@example.com', tz='Asia/Riyadh',
                      groups='nasq_core.group_employee')
        self.authenticate('emp', 'emp_password_123')

        res = self.url_open('/api/v1/me')

        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body['login'], 'emp')
        self.assertEqual(body['name'], 'Sara')
        self.assertEqual(body['email'], 'sara@example.com')
        self.assertEqual(body['tz'], 'Asia/Riyadh')
        self.assertEqual(body['role'], 'employee')
        self.assertEqual(body['company']['id'], self.env.ref('base.main_company').id)
        self.assertEqual(set(body), {
            'id', 'name', 'login', 'email', 'lang', 'tz', 'role', 'company',
            'roles', 'capabilities', 'access_policy_version', 'appearance',
            'modules', 'entitlements', 'platform', 'terminology', 'commercial',
        })
        self.assertEqual(body['platform']['schema_version'], 1)
        self.assertIn(body['platform']['state'], ('active', 'expired', 'suspended'))
        self.assertEqual(body['appearance'], {'mode': 'light', 'font_size': 'small'})

    def patch_appearance(self, payload):
        return self.url_open(
            '/api/v1/me/appearance', json=payload, method='PATCH',
            headers={'Content-Type': 'application/json'},
        )

    def test_appearance_is_personal_and_self_writable(self):
        emp = new_test_user(self.env, login='emp_look', password='emp_look_pass_123',
                            groups='nasq_core.group_employee')
        other = new_test_user(self.env, login='emp_other', password='emp_other_pass_123',
                              groups='nasq_core.group_employee')
        version_before = emp.nasq_access_version
        self.authenticate('emp_look', 'emp_look_pass_123')
        res = self.patch_appearance({'mode': 'dark', 'font_size': 'large'})
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(res.json()['appearance'], {'mode': 'dark', 'font_size': 'large'})
        self.assertEqual(self.url_open('/api/v1/me').json()['appearance'], {'mode': 'dark', 'font_size': 'large'})
        emp.invalidate_recordset()
        self.assertEqual((emp.nasq_appearance_mode, emp.nasq_font_size), ('dark', 'large'))
        # A display preference never counts as an access change.
        self.assertEqual(emp.nasq_access_version, version_before)
        # Nobody else's preference moves.
        self.assertEqual((other.nasq_appearance_mode, other.nasq_font_size), ('light', 'small'))
        partial = self.patch_appearance({'mode': 'cream'})
        self.assertEqual(partial.json()['appearance'], {'mode': 'cream', 'font_size': 'large'})
        bad_mode = self.patch_appearance({'mode': 'sepia'})
        self.assertEqual((bad_mode.status_code, bad_mode.json()['field']), (422, 'mode'))
        bad_size = self.patch_appearance({'font_size': 'huge'})
        self.assertEqual((bad_size.status_code, bad_size.json()['field']), (422, 'font_size'))
        unknown = self.patch_appearance({'name': 'x'})
        self.assertEqual((unknown.status_code, unknown.json()['field']), (422, 'name'))
        self.assertEqual(self.patch_appearance({}).status_code, 422)
        self.authenticate('emp_other', 'emp_other_pass_123')
        self.assertEqual(self.url_open('/api/v1/me').json()['appearance'], {'mode': 'light', 'font_size': 'small'})

    def test_customer_admin(self):
        new_test_user(self.env, login='cadmin', password='cadmin_password_123',
                      groups='nasq_core.group_customer_admin')
        self.authenticate('cadmin', 'cadmin_password_123')
        self.assertEqual(self.url_open('/api/v1/me').json()['role'], 'admin')

    def test_access_identity_is_additive_sorted_and_versioned(self):
        user = new_test_user(
            self.env, login='me_multi_role', password='me_multi_role_pass_123',
            groups='nasq_core.group_employee',
        )
        installed = {
            module.name for module in self.env['ir.module.module'].search([
                ('name', 'in', ['nasq_hr', 'nasq_pmo']), ('state', '=', 'installed'),
            ])
        }
        roles = {
            'nasq_hr': ('nasq_hr.role_hr_manager', 'hr.employees.manage', 'hr_manager'),
            'nasq_pmo': ('nasq_pmo.role_pmo_manager', 'pmo.projects.manage', 'pmo_manager'),
        }
        for app in installed:
            role_xmlid = roles[app][0]
            self.env['nasq.access.assignment'].create({
                'user_id': user.id,
                'role_id': self.env.ref(role_xmlid).id,
                'company_id': self.env.company.id,
            })
        self.authenticate('me_multi_role', 'me_multi_role_pass_123')
        body = self.url_open('/api/v1/me').json()
        self.assertEqual(body['capabilities'], sorted(set(body['capabilities'])))
        for app in installed:
            self.assertIn(roles[app][1], body['capabilities'])
        self.assertNotIn('access.users.assign_roles', body['capabilities'])
        self.assertEqual({role['key'] for role in body['roles']}, {roles[app][2] for app in installed})
        self.assertGreaterEqual(body['access_policy_version'], 1)

    def test_vendor(self):
        new_test_user(self.env, login='vendor', password='vendor_password_123',
                      groups='nasq_core.group_vendor_support')
        self.authenticate('vendor', 'vendor_password_123')

        vendor = self.env['res.users'].search([('login', '=', 'vendor')])
        # implied_ids: vendor_support ⊃ customer_admin ⊃ employee — role_of must pick the highest
        self.assertTrue(vendor.has_group('nasq_core.group_customer_admin'))
        # nasq_core's legacy chain stops at base.group_user: the link to the nasq employee
        # group is made by an application (nasq_hr or nasq_pmo), so it holds only with one.
        linked = self.env['ir.module.module'].search_count([
            ('name', 'in', ['nasq_hr', 'nasq_pmo']), ('state', '=', 'installed'),
        ])
        if linked:
            self.assertTrue(vendor.has_group('nasq_core.group_employee'))
        else:
            # meetings-only install: the vendor is not an employee
            self.assertFalse(vendor.has_group('nasq_core.group_employee'))

        self.assertEqual(self.url_open('/api/v1/me').json()['role'], 'vendor')

    def test_user_without_nasq_group_is_employee(self):
        new_test_user(self.env, login='plain', password='plain_password_123',
                      groups='base.group_user')
        self.authenticate('plain', 'plain_password_123')
        self.assertEqual(self.url_open('/api/v1/me').json()['role'], 'employee')

    def test_user_without_lang_falls_back_to_arabic(self):
        # lang is False whenever the linked partner has no language; MeSchema
        # requires a string, so a null would break every page for that user.
        user = new_test_user(self.env, login='nolang', password='nolang_password_123',
                             groups='nasq_core.group_employee')
        user.write({'lang': False})
        self.assertFalse(user.lang)
        self.authenticate('nolang', 'nolang_password_123')

        self.assertEqual(self.url_open('/api/v1/me').json()['lang'], 'ar_001')

    def test_me_uses_current_company_for_scoped_capabilities(self):
        company_b = self.env['res.company'].create({'name': 'Me company B'})
        user = new_test_user(
            self.env, login='me_company_scope', groups='base.group_user',
            company_id=self.env.company.id,
        )
        user.write({
            'company_ids': [(6, 0, [self.env.company.id, company_b.id])],
        })
        self.env['nasq.access.service']._nasq_replace_assignments(user, [{
            'role_id': self.env.ref('nasq_core.role_system_admin').id,
            'company_id': self.env.company.id,
        }])
        env_b = self.env(
            user=user,
            context={'allowed_company_ids': [company_b.id, self.env.company.id]},
        )

        body = dump_me(user.with_env(env_b))

        self.assertEqual(body['company']['id'], company_b.id)
        self.assertNotIn('access.users.assign_roles', body['capabilities'])


@tagged('post_install', '-at_install', 'nasq')
class TestMeCommercial(NasqApiCase):

    def test_anonymous_metadata_is_not_public(self):
        self.assertEqual(self.api('GET', '/api/v1/me').status_code, 403)

    def test_saas_metadata_is_local_disabled_and_whitelisted(self):
        before = dump_me(self.employee)
        self.authenticate('api_emp', 'api_emp_pass_123')
        response = self.api('GET', '/api/v1/me')
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body['commercial'], {
            'schema_version': 1, 'mode': 'saas', 'self_service_available': False,
        })
        self.assertEqual(set(body['platform']), {
            'schema_version', 'policy_revision', 'state', 'valid_until',
            'read_only', 'readable_features', 'writable_features',
        })
        self.assertFalse(any(key.startswith('billing.') for key in body['capabilities']))
        for key in ('capabilities', 'roles', 'entitlements', 'modules', 'platform'):
            self.assertEqual(body[key], before[key])

    def test_non_saas_metadata_does_not_change_business_identity(self):
        before = dump_me(self.employee)
        # Fixture conversion only; the production write API prohibits mode changes.
        self.env.cr.execute("""
            UPDATE nasq_tenant_profile SET commercial_mode='non_saas',
                entitlement_source='local_policy', valid_until=NULL
        """)
        self.env['nasq.tenant.profile'].invalidate_model()
        self.authenticate('api_emp', 'api_emp_pass_123')
        response = self.api('GET', '/api/v1/me')
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body['commercial'], {
            'schema_version': 1, 'mode': 'non_saas', 'self_service_available': False,
        })
        for key in ('capabilities', 'roles', 'entitlements', 'modules', 'platform'):
            self.assertEqual(body[key], before[key])

    def test_missing_profile_does_not_guess_commercial_mode(self):
        service = type(self.env['nasq.entitlement.service'])
        with patch.object(service, '_nasq_profile', side_effect=UserError('missing profile')):
            self.assertNotIn('commercial', dump_me(self.employee))

    def test_profile_unavailable_during_serialization_over_http(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        service = type(self.env['nasq.entitlement.service'])

        def unavailable_at_serialization(user):
            # Authentication/lifecycle must still use the real profile. Simulate a
            # failure specifically at the optional metadata serialization boundary.
            with patch.object(service, '_nasq_profile', side_effect=UserError('missing profile')):
                return dump_platform(user)

        with patch('odoo.addons.nasq_api.serializers.user.dump_platform',
                   side_effect=unavailable_at_serialization):
            response = self.api('GET', '/api/v1/me')
        self.assertEqual(response.status_code, 200)
        self.assertNotIn('commercial', response.json())
        self.assertEqual(response.json()['platform']['schema_version'], 1)


@tagged('post_install', '-at_install', 'nasq')
class TestChangePassword(HttpCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.user = new_test_user(
            cls.env,
            login='password_change_user',
            password='old_password_123',
            name='Password Change User',
            groups='nasq_core.group_employee',
        )

    def api(self, method, path, json=None):
        return self.url_open(
            path,
            json=json,
            headers={'Content-Type': 'application/json'},
            method=method,
        )

    def use_session(self, sid):
        self.opener = Opener(self)
        self.opener.cookies.set('session_id', sid, domain=HOST)

    def test_anonymous_and_invalid_inputs_are_rejected(self):
        response = self.api('POST', '/api/v1/me/password', {
            'current': 'old_password_123',
            'new': 'new_password_123',
        })
        self.assertEqual(response.status_code, 403)

        self.authenticate('password_change_user', 'old_password_123')
        response = self.api('POST', '/api/v1/me/password', {'new': 'new_password_123'})
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()['code'], 'wrong_password')
        self.assertEqual(response.json()['field'], 'current')

        response = self.api('POST', '/api/v1/me/password', {
            'current': 'wrong_password',
            'new': 'new_password_123',
        })
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()['code'], 'wrong_password')
        self.assertEqual(response.json()['field'], 'current')

        response = self.api('POST', '/api/v1/me/password', {
            'current': 'old_password_123',
            'new': '  1234567  ',
        })
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()['code'], 'weak_password')
        self.assertEqual(response.json()['field'], 'new')

    def test_postcommit_clear_discards_a_concurrent_old_token_refill(self):
        sid = 'password-cache-refill'
        old_values = self.user._session_token_get_values()
        old_token = self.user._session_token_hash_compute(sid, old_values)
        self.env.cr.postcommit.clear()

        self.user._change_password('new_password_123')
        clear_security_caches_after_commit(self.env)

        self.env.registry.clear_cache()
        with patch.object(type(self.user), '_session_token_get_values', return_value=old_values):
            self.assertEqual(self.user._compute_session_token(sid), old_token)

        self.assertNotEqual(fresh_session_token(self.user, sid), old_token)
        self.env.cr.postcommit.run()
        self.assertNotEqual(self.user._compute_session_token(sid), old_token)

    def test_success_preserves_caller_session_and_invalidates_other_sessions(self):
        old_session = self.authenticate('password_change_user', 'old_password_123')
        old_sid = old_session.sid
        caller_session = self.authenticate('password_change_user', 'old_password_123')
        caller_sid = caller_session.sid
        root.session_store.save(old_session)

        response = self.api('POST', '/api/v1/me/password', {
            'current': 'old_password_123',
            'new': 'new_password_123',
        })
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['login'], 'password_change_user')
        self.assertEqual(self.api('GET', '/api/v1/me').status_code, 200)

        self.use_session(old_sid)
        self.assertEqual(self.api('GET', '/api/v1/me').status_code, 403)

        self.use_session(caller_sid)
        self.assertEqual(self.api('GET', '/api/v1/me').status_code, 200)

        authenticated = self.env['res.users'].authenticate(
            {
                'login': 'password_change_user',
                'password': 'new_password_123',
                'type': 'password',
            },
            {'interactive': False},
        )
        self.assertEqual(authenticated['uid'], self.user.id)
        with self.assertRaises(AccessDenied):
            self.env['res.users'].authenticate(
                {
                    'login': 'password_change_user',
                    'password': 'old_password_123',
                    'type': 'password',
                },
                {'interactive': False},
            )
