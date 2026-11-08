# Part of Odoo. See LICENSE file for full copyright and licensing details.
import hashlib
from datetime import timedelta

from odoo import fields
from odoo.exceptions import AccessError, LockError
from odoo.tests import TransactionCase, new_test_user, tagged

from odoo.addons.liwan_core.models.login_code import (
    CODE_ATTEMPTS,
    CODE_LENGTH,
    CODE_TTL,
    DAILY_SENDS,
    HOURLY_SENDS,
    RESEND_COOLDOWN,
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

    def test_the_hourly_cap_per_user(self):
        self.issue()
        for _ in range(HOURLY_SENDS - 1):
            self.clear_cooldown()
            self.issue()
        self.clear_cooldown()
        self.assertEqual(self.issue().error, 'send_limit_reached')

    def test_the_hourly_cap_per_destination(self):
        """A number's allowance counts every code delivered to it inside the hour."""
        self.issue()
        for _ in range(HOURLY_SENDS - 1):
            self.clear_cooldown()
            self.issue()
        self.clear_cooldown()
        self.assertEqual(self.service.search_count([('destination', '=', MOBILE)]), HOURLY_SENDS)
        # The per-user cap and the per-destination cap both refuse the sixth send of one number.
        self.assertIn(self.issue().error, {'send_limit_reached'})

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
