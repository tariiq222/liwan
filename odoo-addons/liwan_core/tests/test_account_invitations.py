# Part of Odoo. See LICENSE file for full copyright and licensing details.
import threading
from datetime import timedelta

from odoo import fields
from odoo.exceptions import AccessDenied, UserError, ValidationError
from odoo.tests import TransactionCase, new_test_user, tagged

from odoo.addons.liwan_core.models.account_token import hash_token

PASSWORD = 'twelve-chars-ok'
MOBILE = '+966500000001'


@tagged('post_install', '-at_install', 'liwan', 'liwan_access')
class TestAccountInvitations(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company = cls.env.company
        cls.admin = new_test_user(cls.env, login='invite_admin', groups='base.group_user')
        system_role = cls.env.ref('liwan_core.role_system_admin')
        cls.env['liwan.access.service']._liwan_replace_assignments(
            cls.admin, [{'role_id': system_role.id, 'company_id': cls.company.id}],
        )
        cls.role = cls.env.ref('liwan_core.role_employee')
        cls.assignments = [{'role_id': cls.role.id, 'company_id': cls.company.id}]

    def setUp(self):
        super().setUp()
        self.sent = []
        self.real_send = type(self.env['liwan.account.mail'])._liwan_send
        self.patch(
            type(self.env['liwan.account.mail']), '_liwan_send',
            lambda model, token, raw: self.sent.append((token, raw)),
        )
        self.service = self.env['liwan.access.service'].with_user(self.admin)
        self.public = self.env['liwan.access.service'].with_user(self.env.ref('base.public_user'))

    def _invite(self, login='invitee@example.com', name='Invitee'):
        return self.service._liwan_invite_account(name, login, self.assignments)

    def _version(self, user):
        return self.service._liwan_user_version(user)

    def _seats(self):
        return self.env['res.users'].search_count([('share', '=', False), ('id', '!=', self.env.ref('base.user_root').id)])

    def _stored_password(self, user):
        self.env.cr.execute('SELECT password FROM res_users WHERE id = %s', [user.id])
        return self.env.cr.fetchone()[0]

    def _can_sign_in(self, user, password):
        try:
            user.with_user(user)._check_credentials({'type': 'password', 'login': user.login, 'password': password}, {'interactive': True})
        except AccessDenied:
            return False
        return True

    def _run_postcommit(self):
        """Run the postcommit hooks, then the delivery threads they started (captured, not spawned)."""
        started = []

        class CapturedThread:
            def __init__(thread, target=None, args=(), name=None, daemon=None):
                thread.target, thread.args, thread.daemon = target, args, daemon
                thread.name = name

            def start(thread):
                started.append(thread)

        self.patch(threading, 'Thread', CapturedThread)
        self.env.flush_all()
        with self.enter_registry_test_mode():
            self.env.cr.postcommit.run()
            for thread in started:
                thread.target(*thread.args)
        return started

    def _assert_invalid_token(self, call, *args):
        with self.assertRaises(ValidationError) as caught:
            call(*args)
        self.assertEqual(caught.exception.code, 'invalid_token')
        self.assertEqual(caught.exception.status, 404)

    def test_invite_creates_passwordless_active_user_holding_a_seat(self):
        seats = self._seats()
        user = self._invite()
        self.assertTrue(user.active)
        self.assertFalse(self._stored_password(user))
        self.assertEqual(self._seats(), seats + 1)
        token = self.env['liwan.account.token'].sudo().search([('user_id', '=', user.id)])
        self.assertEqual((token.purpose, token.delivery), ('invite', 'pending'))
        self.assertEqual(len(self.sent), 1)
        self.assertEqual(self.sent[0][0], token)
        self.assertEqual(token.token_hash, hash_token(self.sent[0][1]))
        self.assertEqual(self.service._liwan_invitation_state(user)['state'], 'pending')

    def test_accept_sets_password_and_mobile_once(self):
        user = self._invite()
        raw = self.sent[0][1]
        accepted = self.public._liwan_accept_invitation(raw, MOBILE, PASSWORD)
        self.assertEqual(accepted, user)
        self.assertEqual(user.liwan_mobile, MOBILE)
        self.assertTrue(self._can_sign_in(user, PASSWORD))
        self.assertTrue(self.env['liwan.account.token'].sudo().search([('user_id', '=', user.id)]).consumed_at)
        self._assert_invalid_token(self.public._liwan_accept_invitation, raw, MOBILE, PASSWORD)
        self.assertIsNone(self.service._liwan_invitation_state(user)['state'])

    def test_resend_and_login_change_revoke_previous_link(self):
        user = self._invite()
        first = self.sent[-1][1]
        self.service._liwan_resend_invitation(user, self._version(user))
        second = self.sent[-1][1]
        self.assertNotEqual(first, second)
        self._assert_invalid_token(self.public._liwan_accept_invitation, first, MOBILE, PASSWORD)
        self.service._liwan_change_invitation_login(user, 'fixed@example.com', self._version(user))
        third = self.sent[-1][1]
        self._assert_invalid_token(self.public._liwan_accept_invitation, second, MOBILE, PASSWORD)
        self.assertEqual((user.login, user.email), ('fixed@example.com', 'fixed@example.com'))
        self.public._liwan_accept_invitation(third, MOBILE, PASSWORD)
        self.assertTrue(self._can_sign_in(user, PASSWORD))

    def test_stale_version_refused_and_only_one_link_stays_usable(self):
        user = self._invite()
        stale = self._version(user)
        self.service._liwan_resend_invitation(user, stale)
        winner = self.sent[-1][1]
        with self.assertRaises(ValidationError) as caught:
            self.service._liwan_resend_invitation(user, stale)
        self.assertEqual((caught.exception.code, caught.exception.status), ('conflict', 409))
        self.assertTrue(self.service._liwan_token_usable(winner, 'invite'))

    def test_cancel_archives_and_frees_seat_and_kills_link(self):
        seats = self._seats()
        user = self._invite()
        raw = self.sent[0][1]
        self.service._liwan_cancel_invitation(user, self._version(user))
        self.assertFalse(user.active)
        self.assertEqual(self._seats(), seats)
        self.assertFalse(self.service._liwan_token_usable(raw, 'invite'))

    def test_accept_after_cancel_fails_and_keeps_user_archived(self):
        user = self._invite()
        raw = self.sent[0][1]
        self.service._liwan_cancel_invitation(user, self._version(user))
        self._assert_invalid_token(self.public._liwan_accept_invitation, raw, MOBILE, PASSWORD)
        self.assertFalse(user.active)
        self.assertFalse(self._stored_password(user))

    def test_reinvite_same_email_reactivates_archived_row(self):
        user = self._invite()
        self.service._liwan_cancel_invitation(user, self._version(user))
        again = self._invite(name='Invitee Again')
        self.assertEqual(again, user)
        self.assertTrue(user.active)
        self.assertEqual(user.name, 'Invitee Again')
        self.assertEqual(self.env['res.users'].with_context(active_test=False).search_count(
            [('login', '=', 'invitee@example.com')]), 1)
        self.assertTrue(self.service._liwan_token_usable(self.sent[-1][1], 'invite'))

    def test_existing_login_is_refused(self):
        user = self._invite()
        self.public._liwan_accept_invitation(self.sent[0][1], MOBILE, PASSWORD)
        with self.assertRaises(ValidationError) as caught:
            self._invite()
        self.assertEqual((caught.exception.code, caught.exception.status), ('account_exists', 409))
        user.sudo().action_archive()
        with self.assertRaises(ValidationError) as caught:
            self._invite()
        self.assertEqual(caught.exception.code, 'account_exists')

    def test_expired_invite_keeps_seat_and_reports_expired(self):
        seats = self._seats()
        user = self._invite()
        token = self.env['liwan.account.token'].sudo().search([('user_id', '=', user.id)])
        token.expires_at = fields.Datetime.now() - timedelta(minutes=1)
        state = self.service._liwan_invitation_state(user)
        self.assertEqual(state['state'], 'expired')
        self.assertEqual(self._seats(), seats + 1)
        self._assert_invalid_token(self.public._liwan_accept_invitation, self.sent[0][1], MOBILE, PASSWORD)
        self.service._liwan_resend_invitation(user, self._version(user))
        self.assertEqual(self.service._liwan_invitation_state(user)['state'], 'pending')

    def test_reset_token_rejected_on_accept_and_invite_token_rejected_on_reset(self):
        accepted = self._invite()
        self.public._liwan_accept_invitation(self.sent[0][1], MOBILE, PASSWORD)
        self.service._liwan_send_reset_link(accepted, self._version(accepted))
        reset_raw = self.sent[-1][1]
        self._assert_invalid_token(self.public._liwan_accept_invitation, reset_raw, MOBILE, PASSWORD)
        pending = self._invite('pending@example.com')
        invite_raw = self.sent[-1][1]
        self._assert_invalid_token(self.public._liwan_reset_password_with_token, invite_raw, PASSWORD)
        self.assertIs(self.service._liwan_token_usable(invite_raw, 'reset'), False)
        self.assertTrue(self.service._liwan_token_usable(invite_raw, 'invite'))
        with self.assertRaises(ValidationError) as caught:
            self.service._liwan_send_reset_link(pending, self._version(pending))
        self.assertEqual(caught.exception.code, 'invitation_pending')

    def test_forgot_password_silent_for_unknown_and_rate_limited(self):
        user = self._invite()
        self.public._liwan_accept_invitation(self.sent[0][1], MOBILE, PASSWORD)
        self.sent.clear()
        for email in ('nobody@example.com', '', None, 7, 'not-an-email'):
            self.assertIsNone(self.public._liwan_request_password_reset(email))
        self.assertEqual(self.sent, [])
        for _ in range(4):
            self.assertIsNone(self.public._liwan_request_password_reset('Invitee@Example.com'))
        self.assertEqual(len(self.sent), 3)
        self.assertEqual({token.user_id for token, _raw in self.sent}, {user})

    def test_forgot_password_audit_row_has_no_actor(self):
        user = self._invite()
        self.public._liwan_accept_invitation(self.sent[0][1], MOBILE, PASSWORD)
        self.public._liwan_request_password_reset(user.login)
        entry = self.env['liwan.access.audit'].search([
            ('action', '=', 'user.reset_link_requested'), ('target_id', '=', user.id),
        ])
        self.assertEqual(len(entry), 1)
        self.assertFalse(entry.actor_id)

    def test_forgot_password_ignores_pending_archived_and_protected_users(self):
        self._invite('pending@example.com')
        archived = self._invite('archived@example.com')
        self.service._liwan_cancel_invitation(archived, self._version(archived))
        new_test_user(self.env, login='vendor@example.com', groups='liwan_core.group_vendor_support')
        self.sent.clear()
        for email in ('pending@example.com', 'archived@example.com', 'vendor@example.com'):
            self.public._liwan_request_password_reset(email)
        self.assertEqual(self.sent, [])

    def test_reset_with_token_revokes_other_sessions(self):
        user = self._invite()
        self.public._liwan_accept_invitation(self.sent[0][1], MOBILE, PASSWORD)
        before = user._session_token_hash_compute('sid', user._session_token_get_values())
        self.public._liwan_request_password_reset(user.login)
        self.public._liwan_reset_password_with_token(self.sent[-1][1], 'another-twelve-chars')
        user.invalidate_recordset()
        after = user._session_token_hash_compute('sid', user._session_token_get_values())
        self.assertNotEqual(before, after)
        self.assertTrue(self._can_sign_in(user, 'another-twelve-chars'))
        self.assertFalse(self._can_sign_in(user, PASSWORD))
        self._assert_invalid_token(self.public._liwan_reset_password_with_token, self.sent[-1][1], PASSWORD + 'x')

    def test_weak_password_and_bad_mobile_and_duplicate_mobile(self):
        first = self._invite()
        raw = self.sent[0][1]
        with self.assertRaises(ValidationError) as caught:
            self.public._liwan_accept_invitation(raw, MOBILE, 'x' * 11)
        self.assertEqual((caught.exception.code, caught.exception.field), ('weak_password', 'password'))
        for bad in ('0500000001', '+0123456789', '+96650', '+9665000000000000', '٠٥٠٠', None, 12345678):
            with self.assertRaises(ValidationError) as caught:
                self.public._liwan_accept_invitation(raw, bad, PASSWORD)
            self.assertEqual((caught.exception.code, caught.exception.field), ('invalid_mobile', 'mobile'))
        self.assertTrue(self.service._liwan_token_usable(raw, 'invite'))
        self.public._liwan_accept_invitation(raw, '+966 50-000 0001', PASSWORD)
        self.assertEqual(first.liwan_mobile, MOBILE)

        second = self._invite('second@example.com')
        with self.assertRaises(ValidationError) as caught:
            self.public._liwan_accept_invitation(self.sent[-1][1], MOBILE, PASSWORD)
        self.assertEqual((caught.exception.code, caught.exception.status), ('mobile_taken', 409))
        self.assertTrue(self.service._liwan_token_usable(self.sent[-1][1], 'invite'))
        # An archived user's number does not block.
        first.sudo().action_archive()
        self.public._liwan_accept_invitation(self.sent[-1][1], MOBILE, PASSWORD)
        self.assertEqual(second.liwan_mobile, MOBILE)

    def test_set_own_mobile(self):
        user = self._invite()
        self.public._liwan_accept_invitation(self.sent[0][1], MOBILE, PASSWORD)
        self.env['liwan.access.service'].with_user(user)._liwan_set_own_mobile('+966500000002')
        self.assertEqual(user.liwan_mobile, '+966500000002')
        other = self._invite('other@example.com')
        self.public._liwan_accept_invitation(self.sent[-1][1], '+966500000003', PASSWORD)
        with self.assertRaises(ValidationError) as caught:
            self.env['liwan.access.service'].with_user(other)._liwan_set_own_mobile('+966500000002')
        self.assertEqual(caught.exception.code, 'mobile_taken')

    def test_mobile_required_rules(self):
        service = self.env['liwan.access.service']
        user = self._invite()
        self.assertTrue(service._liwan_mobile_required(user))
        self.public._liwan_accept_invitation(self.sent[0][1], MOBILE, PASSWORD)
        self.assertFalse(service._liwan_mobile_required(user))
        self.assertFalse(service._liwan_mobile_required(self.env.ref('base.user_root')))
        vendor = new_test_user(self.env, login='vendor_mobile', groups='liwan_core.group_vendor_support')
        self.assertFalse(service._liwan_mobile_required(vendor))
        self.assertFalse(service._liwan_mobile_required(self.env.ref('base.public_user')))

    def test_send_failure_marks_delivery_failed(self):
        self.patch(type(self.env['liwan.account.mail']), '_liwan_send', self.real_send)
        self.env['ir.config_parameter'].set_param('web.base.url', 'https://tenant.example.com')
        self.env['ir.config_parameter'].set_param('mail.default.from', 'LiwanOS <no-reply@liwanos.com>')

        def failing(server, message, *args, **kwargs):
            msg = 'smtp is down'
            raise OSError(msg)

        self.patch(type(self.env['ir.mail_server']), 'send_email', failing)
        user = self._invite()
        token = self.env['liwan.account.token'].sudo().search([('user_id', '=', user.id)])
        self.assertTrue(user.active)
        self._run_postcommit()
        token.invalidate_recordset()
        self.assertEqual(token.delivery, 'failed')
        self.assertEqual(self.service._liwan_invitation_state(user)['delivery'], 'failed')
        self.service._liwan_resend_invitation(user, self._version(user))

    def test_postcommit_hands_the_send_to_a_daemon_thread(self):
        self.patch(type(self.env['liwan.account.mail']), '_liwan_send', self.real_send)
        self.env['ir.config_parameter'].set_param('web.base.url', 'https://tenant.example.com')
        self.env['ir.config_parameter'].set_param('mail.default.from', 'LiwanOS <no-reply@liwanos.com>')
        calls = []
        self.patch(
            type(self.env['ir.mail_server']), 'send_email',
            lambda server, message, *args, **kwargs: calls.append(message),
        )
        user = self._invite()
        token = self.env['liwan.account.token'].sudo().search([('user_id', '=', user.id)])
        started = []

        class CapturedThread:
            def __init__(thread, target=None, args=(), name=None, daemon=None):
                thread.daemon = daemon
                started.append(thread)

            def start(thread):
                thread.started = True

        self.patch(threading, 'Thread', CapturedThread)
        self.env.flush_all()
        with self.enter_registry_test_mode():
            self.env.cr.postcommit.run()
        self.assertEqual(len(started), 1)
        self.assertTrue(started[0].started)
        self.assertTrue(started[0].daemon)
        self.assertEqual(calls, [])
        token.invalidate_recordset()
        self.assertEqual(token.delivery, 'pending')

    def test_mail_server_user_error_marks_delivery_failed(self):
        self.patch(type(self.env['liwan.account.mail']), '_liwan_send', self.real_send)
        self.env['ir.config_parameter'].set_param('web.base.url', 'https://tenant.example.com')
        self.env['ir.config_parameter'].set_param('mail.default.from', 'LiwanOS <no-reply@liwanos.com>')

        def refusing(server, message, *args, **kwargs):
            msg = 'the mail server refused the message'
            raise UserError(msg)

        self.patch(type(self.env['ir.mail_server']), 'send_email', refusing)
        user = self._invite()
        token = self.env['liwan.account.token'].sudo().search([('user_id', '=', user.id)])
        self._run_postcommit()
        token.invalidate_recordset()
        self.assertEqual(token.delivery, 'failed')

    def test_sent_mail_carries_link_in_both_languages_and_marks_sent(self):
        self.patch(type(self.env['liwan.account.mail']), '_liwan_send', self.real_send)
        self.env['ir.config_parameter'].set_param('web.base.url', 'https://tenant.example.com/')
        self.env['ir.config_parameter'].set_param('mail.default.from', 'LiwanOS <no-reply@liwanos.com>')
        captured = []
        self.patch(
            type(self.env['ir.mail_server']), 'send_email',
            lambda server, message, *args, **kwargs: captured.append(message),
        )
        user = self._invite(name='Layla')
        self._run_postcommit()
        token = self.env['liwan.account.token'].sudo().search([('user_id', '=', user.id)])
        self.assertEqual((token.delivery, bool(token.sent_at)), ('sent', True))
        message = captured[0]
        self.assertEqual(message['To'], 'invitee@example.com')
        text = message.get_body(('plain',)).get_content()
        html = message.get_body(('html',)).get_content()
        self.assertIn('https://tenant.example.com/join?token=', text)
        self.assertIn('Layla', text)
        self.assertIn('Hello Layla', text)
        self.assertIn('مرحبًا', text)
        self.assertIn('https://tenant.example.com/join?token=', html)

    def test_no_raw_token_at_rest(self):
        user = self._invite()
        self.service._liwan_resend_invitation(user, self._version(user))
        raws = [raw for _token, raw in self.sent]
        self.env.cr.execute('SELECT * FROM liwan_account_token')
        columns = [column.name for column in self.env.cr.description]
        for row in self.env.cr.fetchall():
            for column, value in zip(columns, row, strict=True):
                self.assertFalse(any(raw in str(value) for raw in raws), column)
        audit = self.env['liwan.access.audit'].search([('target_id', '=', user.id)])
        for event in audit:
            self.assertFalse(any(raw in str(event.before) + str(event.after) for raw in raws))

    def test_reactivate_sends_invite_for_cancelled_invitee_and_reset_for_accepted(self):
        pending = self._invite()
        self.service._liwan_cancel_invitation(pending, self._version(pending))
        self.service._liwan_reactivate_user(pending, self._version(pending))
        self.assertEqual(self.sent[-1][0].purpose, 'invite')
        accepted = self._invite('accepted@example.com')
        self.public._liwan_accept_invitation(self.sent[-1][1], '+966500000009', PASSWORD)
        self.service._liwan_disable_user(accepted, self._version(accepted))
        self.service._liwan_reactivate_user(accepted, self._version(accepted))
        self.assertEqual(self.sent[-1][0].purpose, 'reset')
        self.assertTrue(accepted.active)

    def test_reactivation_does_not_revive_the_old_password(self):
        user = self._invite()
        self.public._liwan_accept_invitation(self.sent[-1][1], MOBILE, PASSWORD)
        self.assertTrue(self._can_sign_in(user, PASSWORD))
        self.service._liwan_disable_user(user, self._version(user))
        self.service._liwan_reactivate_user(user, self._version(user))
        self.assertFalse(self._can_sign_in(user, PASSWORD))
        self.public._liwan_reset_password_with_token(self.sent[-1][1], 'another-twelve-chars')
        self.assertTrue(self._can_sign_in(user, 'another-twelve-chars'))

    def test_admin_actions_need_the_right_capability_and_a_pending_user(self):
        accepted = self._invite()
        self.public._liwan_accept_invitation(self.sent[0][1], MOBILE, PASSWORD)
        with self.assertRaises(ValidationError) as caught:
            self.service._liwan_resend_invitation(accepted, self._version(accepted))
        self.assertEqual((caught.exception.code, caught.exception.status), ('invitation_not_pending', 409))
        plain = new_test_user(self.env, login='plain_employee', groups='base.group_user')
        with self.assertRaisesRegex(Exception, 'forbidden'):
            self.env['liwan.access.service'].with_user(plain)._liwan_invite_account(
                'X', 'x@example.com', self.assignments,
            )
