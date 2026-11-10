# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import new_test_user, tagged

from .common import (
    PROBE_FEATURE,
    LiwanApiCase,
    register_probe_feature,
    set_probe_feature,
)

PASSWORD = 'twelve-chars-ok'
MOBILE = '+966500000001'
PUBLIC = '/api/v1/public/account'


@tagged('post_install', '-at_install', 'liwan', 'liwan_access')
class TestAccountInvitationRoutes(LiwanApiCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.admin = new_test_user(
            cls.env, login='invite_api_admin', password='invite_api_admin_pass_123',
            groups='liwan_core.group_access_admin',
        )
        cls.role = cls.env.ref('liwan_core.role_employee')

    def setUp(self):
        super().setUp()
        self.sent = []
        self.patch(
            type(self.env['liwan.account.mail']), '_liwan_send',
            lambda model, token, raw: self.sent.append((token.purpose, token.user_id.login, raw)),
        )
        self.authenticate('invite_api_admin', 'invite_api_admin_pass_123')

    def _admin(self):
        self.authenticate('invite_api_admin', 'invite_api_admin_pass_123')

    def _assignments(self):
        return [{'role_id': self.role.id, 'scope': {'kind': 'company', 'id': self.env.company.id}}]

    def _create(self, login='invitee.api@example.com', **overrides):
        return self.api('POST', '/api/v1/admin/users', {
            'name': 'Invitee Api', 'login': login, 'assignments': self._assignments(), **overrides,
        })

    def _enable_mobile_gate(self):
        self.patch(type(self.env['liwan.access.service']), '_liwan_mobile_gate_enabled', lambda model: True)

    def _usable_invite_tokens(self, user_id):
        return self.env['liwan.account.token'].sudo().search_count([
            ('user_id', '=', user_id), ('purpose', '=', 'invite'),
            ('consumed_at', '=', False), ('revoked_at', '=', False),
        ])

    def test_create_rejects_password_key(self):
        response = self._create(password='twelve-chars-ok')
        self.assertEqual((response.status_code, response.json()['code']), (422, 'invalid'))
        self.assertEqual(response.json()['field'], 'password')
        self.assertFalse(self.env['res.users'].with_context(active_test=False).search([
            ('login', '=', 'invitee.api@example.com'),
        ]))
        self.assertEqual(self.sent, [])

    def test_create_returns_pending_invitation(self):
        response = self._create()
        self.assertEqual(response.status_code, 201, response.text)
        body = response.json()
        self.assertEqual(body['invitation']['state'], 'pending')
        self.assertEqual(body['invitation']['delivery'], 'pending')
        self.assertTrue(body['invitation']['expires_at'].endswith('Z'))
        self.assertIsNone(body['mobile'])
        self.assertNotIn('password', body)
        self.assertEqual(len(self.sent), 1)
        self.assertEqual(
            set(body['allowed_actions']) & {'resend_invitation', 'edit_invitation', 'cancel_invitation', 'send_reset_link'},
            {'resend_invitation', 'edit_invitation', 'cancel_invitation'},
        )
        listed = self.api('GET', '/api/v1/admin/users?q=invitee.api').json()['items'][0]
        self.assertEqual(listed['invitation']['state'], 'pending')

    def test_seats_reports_used_and_limit(self):
        entitlement = self.env['liwan.entitlement.service']
        used = entitlement._liwan_count_users()
        response = self.api('GET', '/api/v1/admin/users/seats')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['used'], used)
        self.assertEqual(response.json()['limit'], entitlement._liwan_limit_value('users.limit'))
        self.authenticate('api_emp', 'api_emp_pass_123')
        denied = self.api('GET', '/api/v1/admin/users/seats')
        self.assertEqual((denied.status_code, denied.json()['code']), (403, 'forbidden'))

    def test_a_pending_invitation_holds_no_seat_at_the_limit(self):
        """The seat is claimed at acceptance (read-only when none is free), so inviting at the limit is allowed."""
        used = self.env['liwan.entitlement.service']._liwan_count_users()
        service_class = type(self.env['liwan.entitlement.service'])
        original = service_class._liwan_limit_value
        self.patch(service_class, '_liwan_limit_value', lambda model, key: used if key == 'users.limit' else original(model, key))
        seats = self.api('GET', '/api/v1/admin/users/seats').json()
        self.assertEqual((seats['limit'], seats['used']), (used, used))
        response = self._create()
        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(self.env['liwan.entitlement.service']._liwan_count_users(), used)

    def test_resend_edit_cancel_routes(self):
        created = self._create().json()
        resent = self.api('POST', f"/api/v1/admin/users/{created['id']}/invitation/resend", {
            'expected_version': created['version'],
        })
        self.assertEqual(resent.status_code, 200, resent.text)
        edited = self.api('PATCH', f"/api/v1/admin/users/{created['id']}/invitation", {
            'login': 'Corrected.Api@Example.com', 'expected_version': resent.json()['version'],
        })
        self.assertEqual(edited.status_code, 200, edited.text)
        self.assertEqual(edited.json()['login'], 'corrected.api@example.com')
        self.assertEqual(self.sent[-1][1], 'corrected.api@example.com')
        self.assertEqual(self._usable_invite_tokens(created['id']), 1)
        bad = self.api('PATCH', f"/api/v1/admin/users/{created['id']}/invitation", {
            'login': 'not-an-email', 'expected_version': edited.json()['version'],
        })
        self.assertEqual((bad.status_code, bad.json()['field']), (422, 'login'))
        cancelled = self.api('POST', f"/api/v1/admin/users/{created['id']}/invitation/cancel", {
            'expected_version': edited.json()['version'],
        })
        self.assertEqual(cancelled.status_code, 200, cancelled.text)
        self.assertFalse(cancelled.json()['active'])
        self.assertIsNone(cancelled.json()['invitation'])
        self.assertEqual(self._usable_invite_tokens(created['id']), 0)
        again = self.api('POST', f"/api/v1/admin/users/{created['id']}/invitation/resend", {
            'expected_version': cancelled.json()['version'],
        })
        self.assertEqual((again.status_code, again.json()['code']), (409, 'invitation_not_pending'))

    def test_concurrent_resend_stale_version(self):
        created = self._create().json()
        first = self.api('POST', f"/api/v1/admin/users/{created['id']}/invitation/resend", {
            'expected_version': created['version'],
        })
        self.assertEqual(first.status_code, 200, first.text)
        stale = self.api('POST', f"/api/v1/admin/users/{created['id']}/invitation/resend", {
            'expected_version': created['version'],
        })
        self.assertEqual((stale.status_code, stale.json()['code']), (409, 'conflict'))
        self.assertEqual(self._usable_invite_tokens(created['id']), 1)
        stale_edit = self.api('PATCH', f"/api/v1/admin/users/{created['id']}/invitation", {
            'login': 'other.api@example.com', 'expected_version': created['version'],
        })
        self.assertEqual((stale_edit.status_code, stale_edit.json()['code']), (409, 'conflict'))
        self.assertEqual(self._usable_invite_tokens(created['id']), 1)

    def test_reset_link_route_and_old_password_route_gone(self):
        created = self._create().json()
        accepted = self.api('POST', f'{PUBLIC}/invitation/accept', {
            'token': self.sent[-1][2], 'mobile': MOBILE, 'password': PASSWORD,
        })
        self.assertEqual(accepted.status_code, 200, accepted.text)
        self._admin()
        detail = self.api('GET', f"/api/v1/admin/users/{created['id']}").json()
        sent = len(self.sent)
        response = self.api('POST', f"/api/v1/admin/users/{created['id']}/reset-link", {
            'expected_version': detail['version'],
        })
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(len(self.sent), sent + 1)
        self.assertEqual(self.sent[-1][0], 'reset')
        old = self.api('POST', f"/api/v1/admin/users/{created['id']}/password", {
            'password': PASSWORD, 'expected_version': response.json()['version'],
        })
        self.assertEqual(old.status_code, 404)
        reactivate = self.api('POST', f"/api/v1/admin/users/{created['id']}/reactivate", {
            'expected_version': response.json()['version'], 'password': PASSWORD,
        })
        self.assertEqual((reactivate.status_code, reactivate.json()['field']), (422, 'password'))

    def test_public_routes_need_no_session_and_set_no_cookie(self):
        self._create()
        raw = self.sent[-1][2]
        self.opener.cookies.clear()
        check = self.api('POST', f'{PUBLIC}/token', {'token': raw, 'purpose': 'invite'})
        self.assertEqual((check.status_code, check.json()), (200, {'usable': True}))
        self.assertNotIn('session_id', check.cookies)
        wrong_purpose = self.api('POST', f'{PUBLIC}/token', {'token': raw, 'purpose': 'reset'})
        self.assertEqual(wrong_purpose.json(), {'usable': False})
        unknown = self.api('POST', f'{PUBLIC}/token', {'token': 'nope', 'purpose': 'invite'})
        self.assertEqual(unknown.json(), {'usable': False})
        bad = self.api('POST', f'{PUBLIC}/token', {'token': raw, 'purpose': 'other'})
        self.assertEqual((bad.status_code, bad.json()['field']), (422, 'purpose'))
        accepted = self.api('POST', f'{PUBLIC}/invitation/accept', {
            'token': raw, 'mobile': MOBILE, 'password': PASSWORD,
        })
        self.assertEqual((accepted.status_code, accepted.json()), (200, {'login': 'invitee.api@example.com'}))
        self.assertNotIn('session_id', accepted.cookies)
        again = self.api('POST', f'{PUBLIC}/invitation/accept', {
            'token': raw, 'mobile': MOBILE, 'password': PASSWORD,
        })
        self.assertEqual((again.status_code, again.json()['code']), (404, 'invalid_token'))

    def test_accept_validation_errors_do_not_consume_the_link(self):
        self._create()
        raw = self.sent[-1][2]
        weak = self.api('POST', f'{PUBLIC}/invitation/accept', {'token': raw, 'mobile': MOBILE, 'password': 'short'})
        self.assertEqual((weak.status_code, weak.json()['code']), (422, 'weak_password'))
        mobile = self.api('POST', f'{PUBLIC}/invitation/accept', {'token': raw, 'mobile': '0500', 'password': PASSWORD})
        self.assertEqual((mobile.status_code, mobile.json()['code']), (422, 'invalid_mobile'))
        extra = self.api('POST', f'{PUBLIC}/invitation/accept', {
            'token': raw, 'mobile': MOBILE, 'password': PASSWORD, 'login': 'x',
        })
        self.assertEqual((extra.status_code, extra.json()['field']), (422, 'login'))
        self.assertEqual(self._usable_invite_tokens(self.env['res.users'].search([('login', '=', 'invitee.api@example.com')]).id), 1)

    def test_forgot_answers_202_for_unknown_email(self):
        self.opener.cookies.clear()
        response = self.api('POST', f'{PUBLIC}/password/forgot', {'email': 'nobody@example.com'})
        self.assertEqual((response.status_code, response.json()), (202, {}))
        self.assertEqual(self.sent, [])
        garbage = self.api('POST', f'{PUBLIC}/password/forgot', {'email': 12})
        self.assertEqual(garbage.status_code, 202)
        known = self.api('POST', f'{PUBLIC}/password/forgot', {'email': 'api_emp'})
        self.assertEqual(known.status_code, 202)

    def test_forgot_and_reset_round_trip(self):
        self._create()
        self.api('POST', f'{PUBLIC}/invitation/accept', {
            'token': self.sent[-1][2], 'mobile': MOBILE, 'password': PASSWORD,
        })
        response = self.api('POST', f'{PUBLIC}/password/forgot', {'email': 'Invitee.Api@Example.com'})
        self.assertEqual(response.status_code, 202)
        self.assertEqual(self.sent[-1][0], 'reset')
        reset = self.api('POST', f'{PUBLIC}/password/reset', {
            'token': self.sent[-1][2], 'password': 'a-new-twelve-chars',
        })
        self.assertEqual((reset.status_code, reset.json()), (200, {'login': 'invitee.api@example.com'}))
        used = self.api('POST', f'{PUBLIC}/password/reset', {
            'token': self.sent[-1][2], 'password': 'a-new-twelve-chars',
        })
        self.assertEqual((used.status_code, used.json()['code']), (404, 'invalid_token'))

    def test_accept_wrong_purpose_token_404(self):
        self._create()
        invite_raw = self.sent[-1][2]
        wrong = self.api('POST', f'{PUBLIC}/password/reset', {'token': invite_raw, 'password': PASSWORD})
        self.assertEqual((wrong.status_code, wrong.json()['code']), (404, 'invalid_token'))
        user = self.env['res.users'].search([('login', '=', 'invitee.api@example.com')])
        _token, reset_raw = self.env['liwan.account.token'].sudo()._liwan_issue(user, 'reset')
        wrong = self.api('POST', f'{PUBLIC}/invitation/accept', {
            'token': reset_raw, 'mobile': MOBILE, 'password': PASSWORD,
        })
        self.assertEqual((wrong.status_code, wrong.json()['code']), (404, 'invalid_token'))

    def test_mobile_gate_blocks_other_routes_but_not_me_mobile_password_logout(self):
        self._enable_mobile_gate()
        blocked = self.api('GET', '/api/v1/admin/roles')
        self.assertEqual((blocked.status_code, blocked.json()['code']), (403, 'mobile_required'))
        me = self.api('GET', '/api/v1/me')
        self.assertEqual(me.status_code, 200, me.text)
        self.assertEqual((me.json()['mobile'], me.json()['mobile_required']), (None, True))
        password = self.api('POST', '/api/v1/me/password', {'current': 'x', 'new': 'short'})
        self.assertEqual((password.status_code, password.json()['code']), (422, 'weak_password'))
        invalid = self.api('PATCH', '/api/v1/me/mobile', {'mobile': '0500'})
        self.assertEqual((invalid.status_code, invalid.json()['code']), (422, 'invalid_mobile'))
        saved = self.api('PATCH', '/api/v1/me/mobile', {'mobile': MOBILE})
        self.assertEqual(saved.status_code, 200, saved.text)
        self.assertEqual((saved.json()['mobile'], saved.json()['mobile_required']), (MOBILE, False))
        self.assertEqual(self.api('GET', '/api/v1/admin/roles').status_code, 200)
        taken = self.api('PATCH', '/api/v1/me/mobile', {'mobile': MOBILE})
        self.assertEqual(taken.status_code, 200)
        self.authenticate('api_emp', 'api_emp_pass_123')
        clash = self.api('PATCH', '/api/v1/me/mobile', {'mobile': MOBILE})
        self.assertEqual((clash.status_code, clash.json()['code']), (409, 'mobile_taken'))
        extra = self.api('PATCH', '/api/v1/me/mobile', {'mobile': MOBILE, 'name': 'x'})
        self.assertEqual((extra.status_code, extra.json()['field']), (422, 'name'))

    def test_mobile_gate_skips_root_and_vendor_support(self):
        self._enable_mobile_gate()
        new_test_user(
            self.env, login='gate_vendor', password='gate_vendor_pass_123',
            groups='liwan_core.group_vendor_support',
        )
        self.authenticate('gate_vendor', 'gate_vendor_pass_123')
        me = self.api('GET', '/api/v1/me').json()
        self.assertFalse(me['mobile_required'])
        self.assertNotEqual(self.api('GET', '/api/v1/admin/roles').json().get('code'), 'mobile_required')
        self.assertFalse(self.env['liwan.access.service']._liwan_mobile_required(self.env.ref('base.user_root')))

    def test_mobile_hidden_from_people_and_directory(self):
        if 'liwan.directory' not in self.env:
            self.skipTest('liwan_directory is not installed')
        register_probe_feature(self)
        set_probe_feature(self)
        self.patch(
            type(self.env['liwan.directory']), '_liwan_directory_feature_keys', lambda model: (PROBE_FEATURE,),
        )
        self.employee.liwan_mobile = MOBILE
        self.authenticate('api_emp', 'api_emp_pass_123')
        response = self.api('GET', '/api/v1/people?q=Sara')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.json())
        for item in response.json():
            self.assertEqual(set(item), {'id', 'name', 'user_id'})
        self.assertNotIn(MOBILE, response.text)
        self.assertEqual(self.api('GET', '/api/v1/me').json()['mobile'], MOBILE)
        denied = self.api('GET', f'/api/v1/admin/users/{self.employee.id}')
        self.assertEqual(denied.status_code, 403)
        self.assertNotIn(MOBILE, denied.text)
