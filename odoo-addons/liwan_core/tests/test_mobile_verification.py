# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import timedelta
from unittest.mock import patch

from odoo import fields
from odoo.exceptions import AccessError, ValidationError
from odoo.tests import TransactionCase, new_test_user, tagged

from odoo.addons.liwan_core.models import login_code

PASSWORD = 'twelve-chars-ok'
MOBILE = '+966590000101'
OTHER_MOBILE = '+966590000102'


class MobileVerificationCase(TransactionCase):
    """The holder's number is saved unverified and carries a sign-in code only after its own code is consumed."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.user = new_test_user(
            cls.env, login='mobile_user', password=PASSWORD, name='Mobile User',
            email='mobile-user@example.test', groups='liwan_core.group_employee',
        )
        cls.service = cls.env['liwan.access.service']
        cls.codes = cls.env['liwan.login.code']

    def setUp(self):
        super().setUp()
        self.sent = []
        self.patch(
            type(self.env['liwan.sms.gateway']), '_liwan_send',
            lambda model, channel, destination, body: self.sent.append((channel, destination, body)),
        )

    def send(self, mobile=MOBILE, user=None):
        """Save USER's own number and ask for its verification code, as the account screen does."""
        return self.service.with_user(user or self.user)._liwan_send_mobile_code(mobile)

    def verify(self, code, user=None):
        return self.service.with_user(user or self.user)._liwan_verify_mobile_code(code)

    def sms_code(self):
        """The bare code the SMS carried: the SMS body is the code itself."""
        return self.sent[-1][2]

    def sent_code(self):
        """The 6-digit code of the last message, read back out of the body the gateway was handed."""
        return self.sent[-1][2].split()[-1]

    def age_cooldowns(self):
        """Age every code of the user past its cooldown, as waiting a minute would."""
        self.codes.search([]).write({'cooldown_until': fields.Datetime.now() - timedelta(seconds=1)})


@tagged('post_install', '-at_install', 'liwan', 'liwan_access')
class TestMobileVerification(MobileVerificationCase):

    def test_sending_a_code_saves_the_number_unverified_and_asks_for_its_own_code(self):
        outcome = self.send()
        self.assertEqual(outcome.error, '')
        self.assertEqual(outcome.channel, 'sms')
        self.assertEqual(outcome.record.purpose, 'verify_mobile')
        self.assertEqual(outcome.record.destination, MOBILE)
        self.assertEqual(self.sent[-1][:2], ('sms', MOBILE))
        self.user.invalidate_recordset()
        self.assertEqual(self.user.liwan_mobile, MOBILE)
        self.assertFalse(self.user.liwan_mobile_verified_at)

    def test_the_code_of_the_number_stamps_it_verified(self):
        self.assertEqual(self.send().error, '')
        self.assertIsNone(self.verify(self.sms_code()))
        self.user.invalidate_recordset()
        self.assertTrue(self.user.liwan_mobile_verified_at)

    def test_a_number_nobody_verified_carries_no_sign_in_code(self):
        self.send()
        refused = self.codes._liwan_issue(self.user, 'sms')
        self.assertEqual(refused.error, 'channel_unavailable')
        self.assertEqual(len(self.sent), 1, 'the saved number received its verification code only')
        # Email needs no number, so a pending sign-in still has a way in.
        email = self.codes._liwan_issue(self.user, 'email')
        self.assertEqual(email.error, '')
        self.assertEqual((email.channel, email.record.purpose), ('email', 'signin'))

    def test_verifying_the_number_enables_the_sms_sign_in(self):
        self.send()
        self.verify(self.sms_code())
        outcome = self.codes._liwan_issue(self.user, 'sms')
        self.assertEqual(outcome.error, '')
        self.assertEqual((outcome.channel, outcome.record.purpose), ('sms', 'signin'))
        self.assertEqual(self.sent[-1][:2], ('sms', MOBILE))

    def test_a_new_number_is_unverified_again(self):
        self.send()
        self.verify(self.sms_code())
        self.user.invalidate_recordset()
        self.assertTrue(self.user.liwan_mobile_verified_at)
        self.send(OTHER_MOBILE)
        self.user.invalidate_recordset()
        self.assertEqual(self.user.liwan_mobile, OTHER_MOBILE)
        self.assertFalse(self.user.liwan_mobile_verified_at)
        self.assertTrue(self.service._liwan_mobile_required(self.user))

    def test_writing_the_number_with_its_stamp_together_keeps_the_stamp(self):
        stamp = fields.Datetime.now() - timedelta(days=1)
        self.user.write({'liwan_mobile': MOBILE, 'liwan_mobile_verified_at': stamp})
        self.user.invalidate_recordset()
        self.assertEqual(self.user.liwan_mobile, MOBILE)
        self.assertEqual(self.user.liwan_mobile_verified_at, stamp)
        self.assertFalse(self.service._liwan_mobile_required(self.user))

    def test_the_holder_cannot_write_the_number_directly(self):
        for vals in ({'liwan_mobile': MOBILE}, {'liwan_mobile_verified_at': fields.Datetime.now()}):
            with self.subTest(vals=vals), self.assertRaisesRegex(
                AccessError, 'use_protected_liwan_access_operation:res_users_write',
            ):
                self.user.with_user(self.user).write(vals)
        self.user.invalidate_recordset()
        self.assertFalse(self.user.liwan_mobile)
        self.assertFalse(self.user.liwan_mobile_verified_at)

    def test_a_number_another_account_holds_is_refused(self):
        holder = new_test_user(
            self.env, login='mobile_holder', password=PASSWORD, name='Holder',
            groups='liwan_core.group_employee',
        )
        holder.write({'liwan_mobile': MOBILE, 'liwan_mobile_verified_at': fields.Datetime.now()})
        with self.assertRaises(ValidationError) as caught:
            self.send()
        self.assertEqual((caught.exception.code, caught.exception.status), ('mobile_taken', 409))
        self.assertEqual(self.sent, [])
        self.user.invalidate_recordset()
        self.assertFalse(self.user.liwan_mobile)
        # An archived account's number does not block.
        holder.sudo().action_archive()
        self.assertEqual(self.send().error, '')
        self.user.invalidate_recordset()
        self.assertEqual(self.user.liwan_mobile, MOBILE)

    def test_a_malformed_number_is_refused_before_anything_is_saved(self):
        for value in ('0500000001', '+0123456789', '+96650', '+9665000000000000', None, 12345678):
            with self.subTest(value=value), self.assertRaises(ValidationError) as caught:
                self.send(value)
            self.assertEqual((caught.exception.code, caught.exception.field), ('invalid_mobile', 'mobile'))
        self.assertEqual(self.sent, [])
        self.user.invalidate_recordset()
        self.assertFalse(self.user.liwan_mobile)

    def test_the_two_purposes_keep_their_own_codes_cooldowns_and_limits(self):
        self.assertEqual(self.send().error, '')
        verify_code = self.sms_code()
        self.assertGreater(self.codes._liwan_resend_after(self.user, 'verify_mobile'), 0)
        self.assertEqual(self.codes._liwan_resend_after(self.user, 'signin'), 0)
        with patch.object(login_code, 'HOURLY_SENDS', 1):
            # The verification code's cooldown and budget do not hold the sign-in purpose…
            self.assertEqual(self.codes._liwan_issue(self.user, 'email').error, '')
            self.assertEqual(self.codes._liwan_user_daily_sends(self.user, 'signin'), 1)
            self.assertEqual(self.codes._liwan_user_daily_sends(self.user, 'verify_mobile'), 1)
            signin_code = self.sent_code()
            # …while the spent sign-in hour refuses one more sign-in code, of that purpose alone.
            self.age_cooldowns()
            self.assertEqual(self.codes._liwan_issue(self.user, 'email').error, 'send_limit_reached')
        # A sign-in code verifies no number, and issuing one revoked no verification code.
        self.assertEqual(self.verify(signin_code), 'invalid_code')
        self.assertIsNone(self.verify(verify_code))
        self.user.invalidate_recordset()
        self.assertTrue(self.user.liwan_mobile_verified_at)

    def test_the_saved_number_is_audited_without_being_stored(self):
        self.send()
        entry = self.env['liwan.access.audit'].search([
            ('action', '=', 'user.mobile_set'), ('target_id', '=', self.user.id),
        ])
        self.assertEqual(len(entry), 1)
        self.assertEqual((entry.target_type, entry.actor_id), ('user', self.user))
        self.assertFalse(entry.before)
        self.assertEqual(entry.after, {'mobile_set': True})
        self.assertNotIn(MOBILE, str(entry.after) + str(entry.before) + entry.target_name)
