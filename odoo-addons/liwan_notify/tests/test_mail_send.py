# Part of Odoo. See LICENSE file for full copyright and licensing details.
import smtplib
from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from odoo import fields
from odoo.exceptions import AccessError, ValidationError
from odoo.tests import TransactionCase, new_test_user, tagged
from odoo.tools import config

from odoo.addons.liwan_notify.models.mail_mail import (
    CHUNK_BYTES,
    DAILY_CEILING_PARAM,
    HOLD_REASONS,
    MAX_ATTEMPTS,
    MAX_ENCODED_BYTES,
    MAX_RECIPIENTS,
    MINUTE_CEILING_PARAM,
    RETENTION,
    RETRY_DELAYS,
)

SENDER = 'no-reply@liwanos.example'
NOON = datetime(2026, 11, 16, 12, 30, 15)
# The tenant's next midnight after NOON is 2026-11-17 00:00 in Riyadh (UTC+3).
RIYADH_MIDNIGHT = datetime(2026, 11, 16, 21, 0)


@tagged('post_install', '-at_install', 'liwan')
class TestMailSend(TransactionCase):
    """The tenant business mail contract over ``mail.mail``: one row per send, retry, ceilings, size rule, retention."""

    def setUp(self):
        super().setUp()
        self.env['ir.config_parameter'].set_param('mail.default.from', SENDER)
        self.send_service = self.env['liwan.mail.send']
        self.partner = self.env['res.partner'].create({'name': 'Mail source'})
        self.env['liwan.entitlement.service']._liwan_profile().root_company_id.partner_id.tz = 'Asia/Riyadh'

    def _send(self, recipients=('a@example.com',), body='<p>Body</p>', **kwargs):
        mail = self.send_service._liwan_send(
            'res.partner', self.partner.id, 'test.kind', list(recipients), 'Subject', body, **kwargs,
        )
        return mail.sudo()

    def _clock(self, moment=NOON):
        return patch.object(fields.Datetime, 'now', staticmethod(lambda: moment))

    def _sends_after_commit(self):
        return patch.object(type(self.env['mail.mail']), 'send_after_commit', autospec=True)

    def _set_ceilings(self, daily, per_minute):
        params = self.env['ir.config_parameter']
        params.set_param(DAILY_CEILING_PARAM, daily)
        params.set_param(MINUTE_CEILING_PARAM, per_minute)

    def _fail(self, mail, failure_type, attempts):
        mail.write({'state': 'exception', 'failure_type': failure_type, 'liwan_attempts': attempts})

    def test_one_row_per_send_with_our_message_id_and_the_business_record(self):
        mail = self._send(('a@example.com', 'b@example.com'))
        self.assertEqual(self.env['mail.mail'].search_count([('liwan_kind', '=', 'test.kind')]), 1)
        self.assertEqual((mail.model, mail.res_id), ('res.partner', self.partner.id))
        self.assertEqual(mail.liwan_attempts, 1)
        self.assertEqual(mail.email_from, SENDER)
        self.assertEqual(mail.email_to, 'a@example.com, b@example.com')
        self.assertTrue(mail.message_id.startswith('<') and mail.message_id.endswith('@liwanos.example>'))
        self.assertFalse(mail.auto_delete)
        self.assertFalse(mail.liwan_sensitive)

    def test_the_message_id_is_ours_and_unique(self):
        first, second = self._send(), self._send()
        self.assertNotEqual(first.message_id, second.message_id)

    def test_no_sender_queues_nothing(self):
        self.env['ir.config_parameter'].set_param('mail.default.from', '')
        with patch.object(config, 'get', lambda *args: None):
            mail = self.send_service._liwan_send('res.partner', self.partner.id, 'test.kind', ['a@example.com'], 'S', '<p>B</p>')
        self.assertFalse(mail)
        self.assertFalse(self.env['mail.mail'].search([('liwan_kind', '=', 'test.kind')]))

    def test_a_send_without_a_recipient_is_refused(self):
        with self.assertRaises(ValidationError):
            self.send_service._liwan_send('res.partner', self.partner.id, 'test.kind', [' ', ''], 'S', '<p>B</p>')

    def test_a_user_cannot_create_rows_directly_while_the_contract_can(self):
        user = new_test_user(self.env, login='mail_plain_user', name='Plain', groups='base.group_user')
        with self.assertRaises(AccessError):
            self.env['mail.mail'].with_user(user).create({'subject': 'x', 'email_to': 'a@example.com'})
        mail = self.send_service.with_user(user)._liwan_send(
            'res.partner', self.partner.id, 'test.kind', ['a@example.com'], 'S', '<p>B</p>',
        )
        self.assertTrue(mail.sudo().liwan_kind)
        with self.assertRaises(AccessError):
            mail.read(['subject'])

    def test_a_transient_failure_is_retried_up_to_the_cap_then_stays_visible(self):
        mail = self._send()
        retry = self.env['mail.mail']._liwan_retry_failed
        for attempt in range(1, MAX_ATTEMPTS):
            self._fail(mail, 'mail_smtp', attempt)
            with self._clock():
                retry()
            self.assertEqual((mail.state, mail.liwan_attempts), ('outgoing', attempt + 1))
            self.assertEqual(mail.scheduled_date, NOON + RETRY_DELAYS[attempt - 1])
        self._fail(mail, 'unknown', MAX_ATTEMPTS)
        retry()
        self.assertEqual((mail.state, mail.liwan_attempts), ('exception', MAX_ATTEMPTS))

    def test_an_invalid_address_is_final(self):
        mail = self._send()
        self._fail(mail, 'mail_email_invalid', 1)
        self.env['mail.mail']._liwan_retry_failed()
        self.assertEqual((mail.state, mail.liwan_attempts), ('exception', 1))

    def test_stock_mail_without_a_kind_is_never_retried(self):
        stock = self.env['mail.mail'].create({'subject': 'stock', 'email_to': 'a@example.com', 'state': 'exception', 'failure_type': 'mail_smtp'})
        self.env['mail.mail']._liwan_retry_failed()
        self.assertEqual(stock.state, 'exception')

    def test_the_stored_weight_counts_each_recipient_and_each_two_mb_chunk(self):
        one = self._send()
        three = self._send(('a@example.com', 'b@example.com', 'c@example.com'))
        big = self._send(('a@example.com', 'b@example.com'), body='<p>' + 'x' * int(CHUNK_BYTES * 1.5) + '</p>')
        self.assertEqual((one.liwan_weight, three.liwan_weight, big.liwan_weight), (1, 3, 4))

    def test_the_ceiling_count_is_summed_by_the_database_over_the_stored_weight(self):
        self._set_ceilings(daily=0, per_minute=0)
        with self._clock():
            self._send(('a@example.com', 'b@example.com'))
            self._send()
            start, end = self.send_service._liwan_day_bounds(NOON, self.send_service._liwan_zone())
            self.assertEqual(self.send_service._liwan_load(self.env['mail.mail'], start, end), 3)

    def test_scheduled_date_is_indexed(self):
        self.assertTrue(self.env['mail.mail']._fields['scheduled_date'].index)

    def test_the_weight_counts_the_encoded_attachment_size(self):
        # 1.2 MB raw is 1.6 MB in base64: with a small body it fits one chunk, two recipients weigh 2.
        data = b'x' * 1_100_000
        mail = self._send(('a@example.com', 'b@example.com'), attachments=[('a.bin', data)])
        self.assertEqual(mail.liwan_weight, 2)
        heavy = self.send_service._liwan_encoded_size('<p>B</p>', [('a.bin', b'x' * (CHUNK_BYTES - 1000))])
        self.assertGreater(heavy, CHUNK_BYTES)

    def test_the_daily_ceiling_defers_to_the_next_day_and_loses_nothing(self):
        self._set_ceilings(daily=3, per_minute=0)
        with self._clock(), self._sends_after_commit() as send:
            mails = [self._send() for _ in range(3)]
            heavy = self._send(('a@example.com', 'b@example.com'))
            after = self._send()
        self.assertEqual(send.call_count, 3)
        self.assertEqual({mail.scheduled_date for mail in mails}, {NOON})
        tomorrow = RIYADH_MIDNIGHT
        self.assertEqual((heavy.state, heavy.scheduled_date), ('outgoing', tomorrow))
        self.assertEqual(after.scheduled_date, tomorrow)

    def test_a_full_next_day_pushes_a_row_further(self):
        self._set_ceilings(daily=1, per_minute=0)
        with self._clock():
            now_row, tomorrow_row, third = self._send(), self._send(), self._send()
        self.assertEqual(now_row.scheduled_date, NOON)
        self.assertEqual(tomorrow_row.scheduled_date, RIYADH_MIDNIGHT)
        self.assertEqual(third.scheduled_date, RIYADH_MIDNIGHT + timedelta(days=1))

    def test_the_per_minute_ceiling_defers_one_minute(self):
        self._set_ceilings(daily=0, per_minute=2)
        with self._clock(), self._sends_after_commit() as send:
            first, second, third = self._send(), self._send(), self._send()
        self.assertEqual(send.call_count, 2)
        self.assertEqual((first.scheduled_date, second.scheduled_date), (NOON, NOON))
        self.assertEqual((third.state, third.scheduled_date), ('outgoing', NOON.replace(second=0) + timedelta(minutes=1)))

    def test_a_message_heavier_than_a_ceiling_still_leaves_when_the_window_is_empty(self):
        self._set_ceilings(daily=2, per_minute=0)
        with self._clock():
            mail = self._send(('a@example.com', 'b@example.com', 'c@example.com'))
        self.assertEqual(mail.scheduled_date, NOON)

    def test_a_zero_ceiling_turns_it_off(self):
        self._set_ceilings(daily=0, per_minute=0)
        with self._clock():
            dates = {self._send().scheduled_date for _ in range(5)}
        self.assertEqual(dates, {NOON})

    def test_an_oversize_attachment_without_a_link_is_refused(self):
        big = ('report.pdf', b'x' * MAX_ENCODED_BYTES)
        with self.assertRaises(ValidationError):
            self._send(attachments=[big])
        self.assertFalse(self.env['mail.mail'].search([('liwan_kind', '=', 'test.kind')]))

    def test_an_oversize_attachment_goes_as_the_link(self):
        link = 'https://example.com/d?a=1&b=2'
        mail = self._send(attachments=[('report.pdf', b'x' * MAX_ENCODED_BYTES)], download_link=link)
        self.assertFalse(mail.attachment_ids)
        self.assertIn('https://example.com/d?a=1&amp;b=2', mail.body_html)

    def test_a_small_attachment_is_attached(self):
        mail = self._send(attachments=[('note.txt', b'hello')], download_link='https://example.com/d')
        self.assertEqual(mail.attachment_ids.mapped('name'), ['note.txt'])
        self.assertNotIn('https://example.com/d', mail.body_html)

    def test_retention_removes_old_contract_rows_only(self):
        old, recent = self._send(), self._send()
        stock = self.env['mail.mail'].create({'subject': 'stock', 'email_to': 'a@example.com'})
        attached = self._send(attachments=[('note.txt', b'hello')])
        attachment = attached.attachment_ids
        long_ago = fields.Datetime.now() - RETENTION - timedelta(days=1)
        for mail in (old, attached, stock):
            self.env.cr.execute('UPDATE mail_mail SET create_date = %s WHERE id = %s', (long_ago, mail.id))
        self.env['mail.mail'].invalidate_model(['create_date'])
        self.env['mail.mail']._liwan_purge_old()
        self.assertFalse(old.exists() or attached.exists() or attachment.exists())
        self.assertTrue(recent.exists() and stock.exists())

    def test_the_tenant_day_ends_at_riyadh_midnight_not_utc_midnight(self):
        self._set_ceilings(daily=1, per_minute=0)
        late = datetime(2026, 11, 16, 23, 30)
        with self._clock(late):
            self._send()
            deferred = self._send()
        self.assertEqual(deferred.scheduled_date, datetime(2026, 11, 17, 21, 0))

    def test_a_deferred_row_is_not_sent_and_the_queue_cron_is_triggered_for_its_moment(self):
        self._set_ceilings(daily=1, per_minute=0)
        trigger = patch.object(type(self.env['ir.cron']), '_trigger', autospec=True)
        with self._clock(), self._sends_after_commit() as send, trigger as triggered:
            self._send()
            self.assertEqual((send.call_count, triggered.call_count), (1, 0))
            deferred = self._send()
        self.assertEqual(send.call_count, 1)
        self.assertEqual(triggered.call_args.kwargs['at'], deferred.scheduled_date + timedelta(seconds=59))
        self.assertEqual(triggered.call_args.args[0], self.env.ref('mail.ir_cron_mail_scheduler_action'))

    def test_a_bad_ceiling_parameter_is_a_configuration_error_naming_it(self):
        for value in ('abc', '2000.0', '', '-1'):
            self.env['ir.config_parameter'].set_param(DAILY_CEILING_PARAM, value)
            with self.subTest(value=value), self.assertRaisesRegex(ValidationError, DAILY_CEILING_PARAM):
                self._send()

    def test_recipients_are_deduplicated_ignoring_case_and_keep_their_order(self):
        mail = self._send(('B@example.com', 'a@example.com', 'b@Example.com', ' A@example.com '))
        self.assertEqual(mail.email_to, 'B@example.com, a@example.com')
        self.assertEqual(mail.liwan_weight, 2)

    def test_more_than_the_recipient_cap_is_refused(self):
        many = [f'user{index}@example.com' for index in range(MAX_RECIPIENTS + 1)]
        with self.assertRaises(ValidationError):
            self._send(many)
        self.assertEqual(self._send(many[:MAX_RECIPIENTS]).liwan_weight, MAX_RECIPIENTS)

    def test_a_download_link_must_be_https_or_the_instance_itself(self):
        big = [('report.pdf', b'x' * MAX_ENCODED_BYTES)]
        for link in ('http://example.com/d', 'javascript:alert(1)', '//example.com/d', 'ftp://example.com/d'):
            with self.subTest(link=link), self.assertRaises(ValidationError):
                self._send(attachments=big, download_link=link)
        own = f'{self.env.user.get_base_url().rstrip("/")}/files/1'
        self.assertIn(own, self._send(attachments=big, download_link=own).body_html)

    def test_a_sent_sensitive_row_loses_its_content_and_keeps_counting(self):
        self._set_ceilings(daily=0, per_minute=0)
        with self._clock():
            sensitive = self._send(sensitive=True, attachments=[('slip.pdf', b'salary')])
            ordinary = self._send(attachments=[('note.txt', b'hello')])
        attachment = sensitive.attachment_ids
        self.assertEqual((sensitive.auto_delete, sensitive.liwan_sensitive), (False, True))
        (sensitive | ordinary).write({'state': 'sent'})
        (sensitive | ordinary)._postprocess_sent_message(success_pids=self.env['res.partner'], success_emails=[])
        self.assertTrue(sensitive.exists())
        self.assertFalse(sensitive.body_html or sensitive.attachment_ids or attachment.exists())
        self.assertTrue(ordinary.body_html and ordinary.attachment_ids)
        start, end = self.send_service._liwan_day_bounds(NOON, self.send_service._liwan_zone())
        self.assertEqual(self.send_service._liwan_load(self.env['mail.mail'], start, end), 2)

    def _assert_content(self, mail, kept):
        """``kept``: the row still has its body and attachments; otherwise both are gone, the attachment records too."""
        attachment = self._attachments[mail.id]
        if kept:
            self.assertTrue(mail.body_html and mail.attachment_ids and attachment.exists())
        else:
            self.assertFalse(mail.body_html or mail.attachment_ids or attachment.exists())
        self.assertTrue(mail.exists())

    def test_a_sensitive_row_keeps_its_content_only_while_a_send_is_still_possible(self):
        self._attachments = {}
        cases = [
            # (name, write values, content kept)
            ('first transient failure', {'state': 'exception', 'failure_type': 'mail_smtp', 'liwan_attempts': 1}, True),
            ('last retry still allowed', {'state': 'exception', 'failure_type': 'unknown', 'liwan_attempts': MAX_ATTEMPTS - 1}, True),
            ('attempts exhausted', {'state': 'exception', 'failure_type': 'mail_smtp', 'liwan_attempts': MAX_ATTEMPTS}, False),
            ('permanent failure', {'state': 'exception', 'failure_type': 'mail_email_invalid', 'liwan_attempts': 1}, False),
            ('held row', {'state': 'exception', 'failure_type': 'unknown', 'failure_reason': HOLD_REASONS[0],
                          'liwan_attempts': MAX_ATTEMPTS}, True),
            ('waiting to be sent', {'state': 'outgoing'}, True),
        ]
        for name, values, kept in cases:
            for sensitive in (True, False):
                with self.subTest(case=name, sensitive=sensitive):
                    mail = self._send(sensitive=sensitive, attachments=[('slip.pdf', b'salary')])
                    self._attachments[mail.id] = mail.attachment_ids
                    mail.write(values)
                    mail._postprocess_sent_message(
                        success_pids=self.env['res.partner'], success_emails=[], failure_type=values.get('failure_type'),
                    )
                    self._assert_content(mail, kept or not sensitive)

    def test_a_cancelled_sensitive_row_is_wiped_at_once(self):
        self._attachments = {}
        sensitive = self._send(sensitive=True, attachments=[('slip.pdf', b'salary')])
        ordinary = self._send(attachments=[('note.txt', b'hello')])
        for mail in (sensitive, ordinary):
            self._attachments[mail.id] = mail.attachment_ids
        (sensitive | ordinary).cancel()
        self.assertEqual((sensitive.state, ordinary.state), ('cancel', 'cancel'))
        self._assert_content(sensitive, kept=False)
        self._assert_content(ordinary, kept=True)

    def _real_send(self, mail, connect_error=None, send_email=None):
        """Run the stock ``mail.send()`` with only the relay connection and the SMTP call replaced."""
        server = type(self.env['ir.mail_server'])
        with patch.object(server, '_connect__', autospec=True, side_effect=connect_error, return_value=MagicMock()), \
                patch.object(server, 'send_email', autospec=True, side_effect=send_email), \
                patch.object(server, '_disable_send', return_value=False):
            mail.send()

    def _sensitive(self):
        mail = self._send(sensitive=True, body='<p>Payslip body</p>', attachments=[('slip.pdf', b'salary')])
        self._attachments = {mail.id: mail.attachment_ids}
        return mail

    def _retry(self):
        with self._clock():
            self.env['mail.mail']._liwan_retry_failed()

    def test_a_relay_connection_failure_keeps_the_content_and_the_retry_delivers_it(self):
        mail = self._sensitive()
        self._real_send(mail, connect_error=OSError('relay down'))
        self.assertEqual((mail.state, mail.failure_type), ('exception', 'mail_smtp'))
        self._assert_content(mail, kept=True)
        self._retry()
        self.assertEqual((mail.state, mail.liwan_attempts), ('outgoing', 2))
        seen = []

        def deliver(server, message, **kwargs):
            seen.append(message.as_string())
            return '<delivered@liwanos.example>'
        self._real_send(mail, send_email=deliver)
        self.assertEqual(mail.state, 'sent')
        self.assertTrue(seen and 'Payslip body' in seen[0] and 'slip.pdf' in seen[0])
        self._assert_content(mail, kept=False)

    def test_a_retryable_send_failure_keeps_the_content_until_the_last_attempt(self):
        mail = self._sensitive()
        for attempt in range(1, MAX_ATTEMPTS + 1):
            self._real_send(mail, send_email=Exception('relay refused'))
            self.assertEqual((mail.state, mail.liwan_attempts), ('exception', attempt))
            if attempt < MAX_ATTEMPTS:
                self._assert_content(mail, kept=True)
                self._retry()
                self.assertEqual(mail.state, 'outgoing')
        self._assert_content(mail, kept=False)

    def test_a_non_retryable_send_failure_wipes_at_once(self):
        mail = self._sensitive()
        self._real_send(mail, send_email=AssertionError(self.env['ir.mail_server'].NO_VALID_RECIPIENT))
        self.assertEqual((mail.state, mail.failure_type), ('exception', 'mail_email_invalid'))
        self._assert_content(mail, kept=False)

    def test_the_pre_attempt_exception_state_never_wipes_before_the_send_uses_the_content(self):
        mail = self._sensitive()
        inside = []

        def deliver(server, message, **kwargs):
            inside.append((mail.state, mail.failure_type, bool(mail.body_html), bool(mail.attachment_ids)))
            return '<delivered@liwanos.example>'
        self._real_send(mail, send_email=deliver)
        self.assertEqual(inside, [('exception', 'unknown', True, True)])
        self.assertEqual(mail.state, 'sent')
        self._assert_content(mail, kept=False)

    def test_the_retry_cron_wipes_a_sensitive_row_a_dropped_session_left_failed_for_good(self):
        final = self._sensitive()
        retryable = self._send(sensitive=True, attachments=[('slip.pdf', b'salary')])
        ordinary = self._send(attachments=[('note.txt', b'hello')])
        for mail in (retryable, ordinary):
            self._attachments[mail.id] = mail.attachment_ids
        self._fail(final, 'unknown', MAX_ATTEMPTS)
        self._fail(retryable, 'unknown', 1)
        self._fail(ordinary, 'unknown', MAX_ATTEMPTS)
        refused = (None, SimpleNamespace(code='mail_paused'))
        with patch.object(type(self.send_service), '_liwan_sender_or_refusal', return_value=refused):
            self._retry()
        self._assert_content(final, kept=False)
        self._assert_content(retryable, kept=True)
        self._assert_content(ordinary, kept=True)
        self.assertEqual(retryable.state, 'exception')

    def test_a_dropped_relay_session_on_the_last_attempt_is_wiped_by_the_retry_cron(self):
        mail = self._sensitive()
        mail.write({'liwan_attempts': MAX_ATTEMPTS, 'scheduled_date': False})
        server = type(self.env['ir.mail_server'])
        with patch.object(server, '_connect__', autospec=True, return_value=MagicMock()), \
                patch.object(server, 'send_email', autospec=True, side_effect=smtplib.SMTPServerDisconnected()), \
                patch.object(server, '_disable_send', return_value=False), \
                patch.object(type(mail), '_postprocess_sent_message', autospec=True) as postprocess:
            self.env['mail.mail'].process_email_queue(email_ids=mail.ids)
        postprocess.assert_not_called()
        self.assertEqual((mail.state, mail.failure_type), ('exception', 'unknown'))
        self._assert_content(mail, kept=True)
        self._retry()
        self.assertEqual(mail.state, 'exception')
        self._assert_content(mail, kept=False)

    def test_slot_choice_takes_the_database_lock(self):
        with patch.object(type(self.send_service), '_liwan_lock_slots', autospec=True) as lock:
            mail = self._send()
            self._fail(mail, 'mail_smtp', 1)
            self.env['mail.mail']._liwan_retry_failed()
        self.assertEqual(lock.call_count, 2)
        self.send_service._liwan_lock_slots()  # the real lock runs inside the transaction

    def test_a_retry_writes_state_and_moment_together(self):
        mail = self._send()
        self._fail(mail, 'mail_smtp', 1)
        writes = []
        original = type(mail).write

        def spy(records, values):
            if records.ids == mail.ids:
                writes.append(set(values))
            return original(records, values)
        with patch.object(type(mail), 'write', spy), self._clock():
            self.env['mail.mail']._liwan_retry_failed()
        self.assertIn(
            {'state', 'scheduled_date', 'email_from', 'liwan_attempts', 'failure_type', 'failure_reason'}, writes,
        )
        self.assertNotIn({'state'}, writes)

    def test_an_http_base_url_link_is_accepted_and_a_lookalike_host_is_not(self):
        self.env['ir.config_parameter'].set_param('web.base.url', 'http://tenant.example')
        self.env['ir.config_parameter'].set_param('web.base.url.freeze', True)
        big = [('report.pdf', b'x' * MAX_ENCODED_BYTES)]
        self.assertIn('http://tenant.example/files/1', self._send(attachments=big, download_link='http://tenant.example/files/1').body_html)
        for link in ('http://tenant.example.evil.com/x', 'http://tenant.exampleevil/x'):
            with self.subTest(link=link), self.assertRaises(ValidationError):
                self._send(attachments=big, download_link=link)

    def test_retention_removes_a_row_that_still_fails(self):
        mail = self._send()
        self._fail(mail, 'mail_smtp', MAX_ATTEMPTS)
        long_ago = fields.Datetime.now() - RETENTION - timedelta(days=1)
        self.env.cr.execute('UPDATE mail_mail SET create_date = %s WHERE id = %s', (long_ago, mail.id))
        self.env['mail.mail'].invalidate_model(['create_date'])
        self.env['mail.mail']._liwan_purge_old()
        self.assertFalse(mail.exists())

    def test_a_retry_into_a_full_minute_is_deferred(self):
        self._set_ceilings(daily=0, per_minute=1)
        with self._clock():
            failed = self._send()
            self._fail(failed, 'mail_smtp', 1)
            # the retry lands at NOON + 5 minutes; fill that minute first
            filler = self.env['mail.mail'].create({
                'email_to': 'a@example.com', 'liwan_kind': 'test.kind', 'liwan_weight': 1,
                'scheduled_date': NOON + RETRY_DELAYS[0],
            })
            self.env['mail.mail']._liwan_retry_failed()
        self.assertEqual(failed.state, 'outgoing')
        self.assertEqual(failed.scheduled_date, (NOON + RETRY_DELAYS[0]).replace(second=0) + timedelta(minutes=1))
        self.assertTrue(filler.exists())

    def test_the_retry_cron_leaves_other_states_and_non_contract_rows_alone(self):
        sent = self._send()
        sent.write({'state': 'sent'})
        cancelled = self._send()
        cancelled.write({'state': 'cancel'})
        stock = self.env['mail.mail'].create({'email_to': 'a@example.com', 'state': 'exception', 'failure_type': 'unknown'})
        out_of_range = self._send()
        self._fail(out_of_range, 'mail_smtp', 0)
        self.env['mail.mail']._liwan_retry_failed()
        self.assertEqual((sent.state, cancelled.state, stock.state, out_of_range.state), ('sent', 'cancel', 'exception', 'exception'))
