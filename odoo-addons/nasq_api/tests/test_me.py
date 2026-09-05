# Part of Odoo. See LICENSE file for full copyright and licensing details.
from unittest.mock import patch

from odoo.exceptions import AccessDenied
from odoo.http import root
from odoo.tests import HttpCase, new_test_user, tagged
from odoo.tests.common import HOST, Opener

from odoo.addons.nasq_api.controllers.common import (
    clear_security_caches_after_commit,
    fresh_session_token,
)


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
        self.assertEqual(set(body), {'id', 'name', 'login', 'email', 'lang', 'tz', 'role', 'company'})

    def test_customer_admin(self):
        new_test_user(self.env, login='cadmin', password='cadmin_password_123',
                      groups='nasq_core.group_customer_admin')
        self.authenticate('cadmin', 'cadmin_password_123')
        self.assertEqual(self.url_open('/api/v1/me').json()['role'], 'admin')

    def test_vendor(self):
        new_test_user(self.env, login='vendor', password='vendor_password_123',
                      groups='nasq_core.group_vendor_support')
        self.authenticate('vendor', 'vendor_password_123')

        vendor = self.env['res.users'].search([('login', '=', 'vendor')])
        # implied_ids: vendor_support ⊃ customer_admin ⊃ employee — role_of must pick the highest
        self.assertTrue(vendor.has_group('nasq_core.group_customer_admin'))
        self.assertTrue(vendor.has_group('nasq_core.group_employee'))

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
