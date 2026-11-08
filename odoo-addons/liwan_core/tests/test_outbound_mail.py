# Part of Odoo. See LICENSE file for full copyright and licensing details.
import threading

from odoo.tests import TransactionCase, new_test_user, tagged
from odoo.tools import config

SENDER = 'LiwanOS <no-reply@liwanos.com>'


@tagged('post_install', '-at_install', 'liwan')
class TestOutboundMail(TransactionCase):

    def setUp(self):
        super().setUp()
        self.mail = self.env['liwan.outbound.mail']
        self.sent = []
        self.patch(
            type(self.env['ir.mail_server']), 'send_email',
            lambda server, message, *args, **kwargs: self.sent.append((server.env.uid, message)),
        )

    def _run_postcommit(self):
        """Run the postcommit hooks, then the delivery threads they started (captured, not spawned)."""
        started = []

        class CapturedThread:
            def __init__(thread, target=None, args=(), name=None, daemon=None):
                thread.target, thread.args, thread.daemon = target, args, daemon

            def start(thread):
                started.append(thread)

        self.patch(threading, 'Thread', CapturedThread)
        self.env.flush_all()
        with self.enter_registry_test_mode():
            self.env.cr.postcommit.run()
            for thread in started:
                thread.target(*thread.args)
        return started

    def test_sender_is_the_configured_no_reply_address(self):
        self.env['ir.config_parameter'].set_param('mail.default.from', SENDER)
        self.assertEqual(self.mail._liwan_sender(), SENDER)

    def test_sender_falls_back_to_the_server_config_then_none(self):
        self.env['ir.config_parameter'].set_param('mail.default.from', '')
        self.patch(config, 'get', lambda key, *args: 'fallback@liwanos.com' if key == 'email_from' else None)
        self.assertEqual(self.mail._liwan_sender(), 'fallback@liwanos.com')
        self.patch(config, 'get', lambda *args: 'not-an-address')
        self.assertIsNone(self.mail._liwan_sender())
        self.patch(config, 'get', lambda *args: None)
        self.assertIsNone(self.mail._liwan_sender())

    def test_message_carries_both_languages_and_the_link(self):
        message = self.mail._liwan_compose(
            SENDER, 'to@example.com', 'موضوع | Subject', ('مرحبًا <b>', 'Hello <b>'), 'https://t.example.com/x?a=1&b=2',
        )
        self.assertEqual((message['From'], message['To'], message['Subject']), (SENDER, 'to@example.com', 'موضوع | Subject'))
        text = message.get_body(('plain',)).get_content()
        html = message.get_body(('html',)).get_content()
        self.assertEqual(text.count('https://t.example.com/x?a=1&b=2'), 2)
        self.assertIn('مرحبًا <b>', text)
        self.assertIn('Hello <b>', text)
        self.assertIn('dir="rtl"', html)
        self.assertIn('dir="ltr"', html)
        self.assertIn('Hello &lt;b&gt;', html)
        self.assertIn('a=1&amp;b=2', html)

    def test_send_waits_for_the_commit_and_runs_in_a_daemon_thread_as_the_given_user(self):
        user = new_test_user(self.env, login='outbound_user', groups='base.group_user')
        message = self.mail._liwan_compose(SENDER, 'to@example.com', 'Subject', ('a', 'b'), 'https://t.example.com')
        self.mail.with_user(user)._liwan_send_after_commit('test mail', user.id, lambda env: message)
        self.assertEqual(self.sent, [])
        started = self._run_postcommit()
        self.assertEqual(len(started), 1)
        self.assertTrue(started[0].daemon)
        self.assertEqual(self.sent, [(user.id, message)])

    def test_on_sent_runs_on_the_threads_environment_after_the_send(self):
        message = self.mail._liwan_compose(SENDER, 'to@example.com', 'Subject', ('a', 'b'), 'https://t.example.com')
        seen = []
        self.mail._liwan_send_after_commit(
            'test mail', self.env.uid, lambda env: message,
            on_sent=lambda env: seen.append((env.uid, len(self.sent))),
            on_failed=lambda registry: seen.append('failed'),
        )
        self._run_postcommit()
        self.assertEqual(seen, [(self.env.uid, 1)])

    def test_a_failure_is_logged_by_class_only_and_reported_to_on_failed(self):
        def failing(server, message, *args, **kwargs):
            msg = 'secret@example.com smtp is down'
            raise OSError(msg)

        self.patch(type(self.env['ir.mail_server']), 'send_email', failing)
        failed = []
        self.mail._liwan_send_after_commit(
            'test mail', self.env.uid, lambda env: 'ignored',
            on_sent=lambda env: failed.append('sent'), on_failed=failed.append,
        )
        with self.assertLogs('odoo.addons.liwan_core.models.outbound_mail', 'WARNING') as logs:
            self._run_postcommit()
        self.assertEqual(logs.output[0].split(':', 2)[2], 'test mail not delivered: OSError')
        self.assertNotIn('secret', ''.join(logs.output))
        self.assertEqual(failed, [self.env.registry])

    def test_a_failure_without_on_failed_never_raises(self):
        def failing_build(env):
            msg = 'no message'
            raise ValueError(msg)

        self.mail._liwan_send_after_commit('test mail', self.env.uid, failing_build)
        with self.assertLogs('odoo.addons.liwan_core.models.outbound_mail', 'WARNING'):
            self._run_postcommit()
        self.assertEqual(self.sent, [])
