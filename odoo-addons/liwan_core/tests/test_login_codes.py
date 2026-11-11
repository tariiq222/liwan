# Part of Odoo. See LICENSE file for full copyright and licensing details.
import hashlib
from datetime import timedelta
from unittest.mock import patch
from uuid import uuid4

from psycopg2.errors import SerializationFailure

from odoo import SUPERUSER_ID, api, fields
from odoo.exceptions import AccessError, LockError
from odoo.tests import TransactionCase, new_test_user, tagged
from odoo.tools import mute_logger

from odoo.addons.liwan_core.models import login_code
from odoo.addons.liwan_core.models.login_code import (
    CODE_ATTEMPTS,
    CODE_LENGTH,
    CODE_TTL,
    DAILY_SENDS,
    HOURLY_SENDS,
    RESEND_COOLDOWN,
    TENANT_CEILING_USERS,
    USER_DAILY_SENDS,
)

PASSWORD = 'twelve-chars-ok'
MOBILE = '+966590000001'
OTHER_MOBILE = '+966590000002'


class LoginCodeCase(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.user = new_test_user(
            cls.env, login='code_user', password=PASSWORD, name='Code User',
            groups='liwan_core.group_employee',
        )
        cls.user.liwan_mobile = MOBILE
        cls.service = cls.env['liwan.login.code']

    def setUp(self):
        super().setUp()
        self.sent = []
        self.patch(
            type(self.env['liwan.sms.gateway']), '_liwan_send',
            lambda model, channel, destination, body: self.sent.append((channel, destination, body)),
        )

    def issue(self, channel='sms', user=None):
        return self.service._liwan_issue(user or self.user, channel)

    def sent_code(self):
        """The plain 6-digit code of the last message, read back out of the body the gateway was handed."""
        return self.sent[-1][2].split()[-1]

    def clear_cooldown(self, user=None):
        """Age every code of USER past its cooldown, as waiting a minute would."""
        self.env['liwan.login.code'].search([
            ('user_id', '=', (user or self.user).id),
        ]).write({'cooldown_until': fields.Datetime.now() - timedelta(seconds=1)})


@tagged('post_install', '-at_install', 'liwan', 'liwan_access')
class TestLoginCodeIssue(LoginCodeCase):

    def test_a_code_is_six_digits_and_only_its_hash_is_stored(self):
        outcome = self.issue()
        code = self.sent_code()
        self.assertEqual(outcome.error, '')
        self.assertEqual(len(code), CODE_LENGTH)
        self.assertTrue(code.isdigit())
        self.assertEqual(outcome.channel, 'sms')
        self.assertEqual(self.sent[-1][1], MOBILE)
        self.assertEqual(outcome.destination, f'***{MOBILE[-3:]}')
        self.assertNotEqual(outcome.record.code_hash, code)
        self.assertEqual(outcome.record.code_hash, hashlib.sha256(code.encode()).hexdigest())
        self.assertFalse(outcome.record.consumed_at)

    def test_the_code_expires_after_five_minutes(self):
        outcome = self.issue()
        self.assertEqual(outcome.record.expires_at - fields.Datetime.now(), CODE_TTL)
        outcome.record.expires_at = fields.Datetime.now() - timedelta(seconds=1)
        self.assertEqual(self.service._liwan_verify(self.user, self.sent_code()), 'invalid_code')

    def test_the_destination_is_masked_in_the_hint(self):
        outcome = self.issue()
        self.assertNotIn(MOBILE, outcome.destination)
        self.assertTrue(outcome.destination.endswith(MOBILE[-3:]))

    def test_email_is_the_channel_when_no_mobile_is_saved(self):
        self.user.liwan_mobile = False
        outcome = self.issue(channel='email')
        self.assertEqual(outcome.error, '')
        self.assertEqual(outcome.channel, 'email')
        self.assertEqual(self.sent[-1][1], self.user.email)
        self.assertIn('@', outcome.destination)
        self.assertNotIn(self.user.email, outcome.destination)

    def test_email_delivery_preserves_mailbox_case(self):
        mailbox = 'CaseSensitive@EXAMPLE.test'
        self.user.email = f'Code User <{mailbox}>'
        outcome = self.issue(channel='email')
        self.assertEqual(outcome.error, '')
        self.assertEqual(outcome.record.destination, mailbox)
        self.assertEqual(self.sent[-1][1], mailbox)

    def test_email_delivery_refuses_multiple_recipients(self):
        self.user.email = 'one@example.test, two@example.test'
        outcome = self.issue(channel='email')
        self.assertEqual(outcome.error, 'channel_unavailable')
        self.assertFalse(outcome.record)
        self.assertEqual(self.sent, [])

    def test_a_channel_without_a_destination_is_refused(self):
        self.user.liwan_mobile = False
        outcome = self.issue(channel='sms')
        self.assertEqual(outcome.error, 'channel_unavailable')
        self.assertEqual(outcome.record, self.service.browse())
        self.assertEqual(self.sent, [])

    def test_an_unknown_channel_is_refused(self):
        self.assertEqual(self.issue(channel='pigeon').error, 'channel_unavailable')

    def test_production_without_a_provider_refuses_sms(self):
        self.patch(type(self.env['liwan.sms.gateway']), '_liwan_is_production', lambda model: True)
        self.assertEqual(self.issue().error, 'channel_unavailable')
        self.assertEqual(self.sent, [])
        # Email never depends on the SMS provider.
        self.assertEqual(self.issue(channel='email').error, '')

    def test_issuing_again_revokes_the_previous_code(self):
        first = self.issue().record
        first_code = self.sent_code()
        self.clear_cooldown()
        second = self.issue().record
        self.assertNotEqual(first.id, second.id)
        self.assertTrue(first.revoked_at)
        self.assertEqual(self.service._liwan_verify(self.user, first_code), 'invalid_code')
        self.assertEqual(self.service._liwan_verify(self.user, self.sent_code()), None)

    def test_resend_waits_for_the_cooldown(self):
        self.issue()
        self.assertGreater(self.service._liwan_resend_after(self.user), 0)
        self.assertLessEqual(self.service._liwan_resend_after(self.user), int(RESEND_COOLDOWN.total_seconds()))
        refused = self.issue()
        self.assertEqual(refused.error, 'resend_cooldown')
        self.assertGreater(refused.resend_after, 0)
        self.assertEqual(len(self.sent), 1)
        self.assertEqual(self.service.search_count([('user_id', '=', self.user.id)]), 1)

    def test_the_hourly_cap_per_user_counts_every_channel(self):
        self.user.email = 'code-user@example.test'
        for _ in range(HOURLY_SENDS):
            self.clear_cooldown()
            self.assertEqual(self.issue().error, '')
        self.clear_cooldown()
        self.assertEqual(self.issue(channel='email').error, 'send_limit_reached')

    def test_the_hourly_cap_per_destination_counts_other_users(self):
        self.user.email = 'one-mailbox@example.test'
        for _ in range(HOURLY_SENDS):
            self.clear_cooldown()
            self.assertEqual(self.issue(channel='email').error, '')
        other = new_test_user(
            self.env, login='same_inbox', password=PASSWORD, name='Same Inbox',
            email='One-Mailbox@EXAMPLE.test', groups='liwan_core.group_employee',
        )
        self.assertEqual(self.issue(channel='email', user=other).error, 'send_limit_reached')

    def other_user(self, login):
        user = new_test_user(self.env, login=login, password=PASSWORD, name=login, groups='liwan_core.group_employee')
        user.liwan_mobile = OTHER_MOBILE
        return user

    def test_the_daily_cap_per_user_refuses_only_that_user(self):
        other = self.other_user('code_other')
        # The hourly caps are not under test: lift them so only the daily count can refuse.
        with patch.object(login_code, 'HOURLY_SENDS', USER_DAILY_SENDS * 2):
            for _ in range(USER_DAILY_SENDS):
                self.clear_cooldown()
                self.assertEqual(self.issue().error, '')
            self.clear_cooldown()
            self.assertEqual(self.issue().error, 'send_limit_reached')
            self.assertEqual(self.issue(user=other).error, '')
        self.assertFalse(self.env['liwan.login.code.alert'].search([]), 'one user at their cap raises no tenant alert')

    def test_the_tenant_ceiling_is_out_of_reach_of_one_user(self):
        self.assertEqual(DAILY_SENDS, USER_DAILY_SENDS * TENANT_CEILING_USERS)
        self.assertGreater(DAILY_SENDS, USER_DAILY_SENDS)

    def test_the_tenant_ceiling_refuses_when_many_users_together_exceed_it(self):
        users = [self.other_user(f'code_many_{index}') for index in range(2)]
        with patch.object(login_code, 'DAILY_SENDS', 2):
            self.assertEqual(self.issue(user=users[0]).error, '')
            self.assertEqual(self.issue(user=users[1]).error, '')
            self.assertEqual(self.issue().error, 'daily_send_cap')
        self.assertEqual(len(self.sent), 2)
        self.assertEqual(self.env['liwan.login.code.alert'].search([], limit=1).attempts, 1)

    def test_the_daily_global_cap_alerts_instead_of_sending(self):
        self.patch(type(self.service), '_liwan_daily_sends', lambda model: DAILY_SENDS)
        outcome = self.issue()
        self.assertEqual(outcome.error, 'daily_send_cap')
        self.assertEqual(self.sent, [], 'no message may go out over the daily cap')
        alert = self.env['liwan.login.code.alert'].search([], limit=1)
        self.assertEqual(alert.attempts, 1)
        self.issue()
        self.assertEqual(alert.attempts, 2)

    def test_the_daily_cap_alert_counts_one_row_per_day(self):
        self.patch(type(self.service), '_liwan_daily_sends', lambda model: DAILY_SENDS)
        self.issue()
        self.issue()
        self.assertEqual(self.env['liwan.login.code.alert'].search_count([]), 1)


@tagged('post_install', '-at_install', 'liwan', 'liwan_access')
class TestLoginCodeVerify(LoginCodeCase):

    def test_the_right_code_is_consumed_once(self):
        record = self.issue().record
        code = self.sent_code()
        self.assertIsNone(self.service._liwan_verify(self.user, code))
        self.assertTrue(record.consumed_at)
        self.assertEqual(self.service._liwan_verify(self.user, code), 'invalid_code')

    def test_five_wrong_attempts_burn_the_code(self):
        record = self.issue().record
        code = self.sent_code()
        wrong = '%06d' % ((int(code) + 1) % 1000000)
        for attempt in range(CODE_ATTEMPTS):
            self.assertEqual(self.service._liwan_verify(self.user, wrong), 'invalid_code')
            self.assertEqual(record.attempts, attempt + 1)
        self.assertTrue(record.revoked_at)
        self.assertEqual(self.service._liwan_verify(self.user, code), 'invalid_code')

    def test_an_attempt_on_a_code_locked_by_another_is_refused_uncompared(self):
        record = self.issue().record
        code = self.sent_code()

        def locked(records, **kwargs):
            msg = 'busy'
            raise LockError(msg)

        self.patch(type(record), 'lock_for_update', locked)
        self.assertEqual(self.service._liwan_verify(self.user, code), 'invalid_code')
        self.assertEqual(record.attempts, 0)
        self.assertFalse(record.consumed_at)

    def test_arabic_indic_digits_are_accepted(self):
        record = self.issue().record
        arabic = self.sent_code().translate(str.maketrans('0123456789', '٠١٢٣٤٥٦٧٨٩'))
        self.assertIsNone(self.service._liwan_verify(self.user, arabic))
        self.assertTrue(record.consumed_at)

    def test_a_malformed_code_is_refused_before_counting(self):
        record = self.issue().record
        for value in ('', '12345', 'abcdef', '1234567', None, '١٢٣'):
            with self.subTest(value=value):
                self.assertEqual(self.service._liwan_verify(self.user, value), 'invalid_code_format')
        self.assertEqual(record.attempts, 0)

    def test_a_code_is_bound_to_its_own_user(self):
        record = self.issue().record
        other = new_test_user(
            self.env, login='code_intruder', password=PASSWORD, name='Intruder',
            groups='liwan_core.group_employee',
        )
        self.assertEqual(self.service._liwan_verify(other, self.sent_code()), 'invalid_code')
        self.assertFalse(record.consumed_at)

    def test_the_code_table_is_system_only(self):
        record = self.issue().record
        with self.assertRaises(AccessError):
            self.env['liwan.login.code'].with_user(self.user).browse(record.id).read(['code_hash'])


@tagged('post_install', '-at_install', 'liwan', 'liwan_access')
class TestLoginCodeQuotaConcurrency(TransactionCase):

    def _assert_concurrent_cap(self, *, same_mailbox, limit, refusal):
        self.assertTrue(self.env.cr.dbname.startswith('liwan_scratch_'), 'A committed fixture needs a scratch database')
        prefix = 'quota_' + uuid4().hex
        with self.registry.cursor() as setup:
            env = api.Environment(setup, SUPERUSER_ID, {})
            first = new_test_user(env, login=prefix + '_a', password=PASSWORD, email=prefix + '@example.test')
            second = new_test_user(
                env, login=prefix + '_b', password=PASSWORD,
                email=prefix + ('@example.test' if same_mailbox else '_b@example.test'),
            )
            users = first.id, second.id
            setup.commit()

        def issue(cursor, user_id):
            env = api.Environment(cursor, SUPERUSER_ID, {})
            return env['liwan.login.code']._liwan_issue(env['res.users'].browse(user_id), 'email')

        try:
            with (
                patch.object(login_code, limit, 1),
                patch.object(type(self.env['liwan.sms.gateway']), '_liwan_send') as send,
            ):
                with self.registry.cursor() as stale:
                    stale.execute('SELECT 1')  # Fix B's snapshot before A's committed send.
                    with self.registry.cursor() as first_cursor:
                        self.assertEqual(issue(first_cursor, users[0]).error, '')
                        first_cursor.commit()
                    with self.assertRaises(SerializationFailure), mute_logger('odoo.sql_db'):
                        issue(stale, users[1])
                    stale.rollback()
                with self.registry.cursor() as retry:
                    self.assertEqual(issue(retry, users[1]).error, refusal)
                    retry.rollback()
                self.assertEqual(send.call_count, 1)
        finally:
            with self.registry.cursor() as cleanup:
                env = api.Environment(cleanup, SUPERUSER_ID, {})
                env['res.users'].browse(users).unlink()
                cleanup.commit()

    def test_stale_request_retries_against_the_destination_cap(self):
        self._assert_concurrent_cap(same_mailbox=True, limit='HOURLY_SENDS', refusal='send_limit_reached')

    def test_stale_request_retries_against_the_daily_cap(self):
        self._assert_concurrent_cap(same_mailbox=False, limit='DAILY_SENDS', refusal='daily_send_cap')
