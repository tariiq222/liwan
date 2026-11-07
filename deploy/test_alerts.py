# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The five owner alerts: which events exist, who receives them, and what a failure must show.

Every assertion here fails when the rule it defends is removed from
``deploy/alerts.py``: dropping an event from the enum, letting an unknown name
through, skipping the second channel after the first one failed, hiding a disabled
channel, or flipping the RPO comparison. The transports are always injected, so no
test opens a socket and no test needs a credential.
"""
from __future__ import annotations

import contextlib
import io
import json
import unittest
import urllib.error
import urllib.parse
from datetime import datetime, timezone
from email.message import EmailMessage

from deploy import alerts
from deploy.alerts import (
    AlertConfig,
    AlertEvent,
    AlertMessage,
    EmailSender,
    TelegramSender,
    Transports,
)

NOW = datetime(2026, 11, 8, 12, 0, tzinfo=timezone.utc)
SMTP_SECRET = 'smtp-password-9f3c1a'
BOT_SECRET = '123456:bot-token-7bd2e4'
TENANT_DATABASE = 'tenant_acme_scratch'
DEFECT = 'a bug in this repository, not a transport failure'

ARABIC_LETTERS = tuple(chr(code) for code in range(0x0621, 0x064B))


class FakeTransport:
    """One injected transport: records every call and fails on demand."""

    def __init__(self, error: Exception | None = None) -> None:
        self.calls: list[object] = []
        self.error = error

    def __call__(self, payload) -> None:
        self.calls.append(payload)
        if self.error is not None:
            raise self.error


class FakeNotifier:
    """A channel that is not email or Telegram, so the fan-out can be checked alone."""

    channel = 'fake'

    def __init__(self, error: Exception | None = None) -> None:
        self.messages: list[AlertMessage] = []
        self.error = error

    def send(self, message: AlertMessage) -> None:
        self.messages.append(message)
        if self.error is not None:
            raise self.error


def full_environment(**overrides: str) -> dict[str, str]:
    env = {
        alerts.ENV_SMTP_HOST: 'smtp.example.test',
        alerts.ENV_SMTP_PORT: '2525',
        alerts.ENV_SMTP_FROM: 'alerts@example.test',
        alerts.ENV_SMTP_TO: 'owner@example.test',
        alerts.ENV_SMTP_USER: 'alerts@example.test',
        alerts.ENV_SMTP_PASSWORD: SMTP_SECRET,
        alerts.ENV_TELEGRAM_BOT_TOKEN: BOT_SECRET,
        alerts.ENV_TELEGRAM_CHAT_ID: '424242',
    }
    for name, value in overrides.items():
        if value is None:
            env.pop(name, None)
        else:
            env[name] = value
    return env


def without_channel(env: dict[str, str], names: tuple[str, ...]) -> dict[str, str]:
    """The same environment with one whole channel left unconfigured."""
    return {name: value for name, value in env.items() if name not in names}


def one_message(event: AlertEvent) -> AlertMessage:
    """A message of the named event, built the way the module builds it for real."""
    if event is AlertEvent.BACKUP_FAILED:
        return alerts.backup_failed_message(database=TENANT_DATABASE, reason='pg_dump exited 1',
                                            timestamp=NOW)
    if event is AlertEvent.BACKUP_STALE:
        return alerts.evaluate_backup_age(database=TENANT_DATABASE, age_seconds=7200,
                                          timestamp=NOW)
    if event is AlertEvent.DISK_HIGH:
        return alerts.evaluate_disk_usage(host='app-1', used_percent=91.5, timestamp=NOW)
    if event is AlertEvent.CONTAINER_UNHEALTHY:
        return alerts.evaluate_container_health(container='liwan-odoo', health='unhealthy',
                                                timestamp=NOW)
    return alerts.restore_drill_failed_message(database=TENANT_DATABASE, reason='verify exited 1',
                                               timestamp=NOW)


def has_arabic(text: str) -> bool:
    return any(letter in text for letter in ARABIC_LETTERS)


class TestTheFiveEvents(unittest.TestCase):
    def test_exactly_the_five_decided_events_exist_and_no_other(self):
        self.assertEqual(
            sorted(event.value.name for event in AlertEvent),
            ['backup_failed', 'backup_stale', 'container_unhealthy', 'disk_high',
             'restore_drill_failed'],
        )

    def test_each_event_has_a_stable_name_an_arabic_title_and_a_severity(self):
        for event in AlertEvent:
            with self.subTest(event=event.value.name):
                self.assertRegex(event.value.name, r'^[a-z]+(_[a-z]+)*$')
                self.assertTrue(has_arabic(event.value.title), event.value.title)
                self.assertIsInstance(event.value.severity, alerts.Severity)
                self.assertTrue(has_arabic(event.value.first_action), event.value.first_action)

    def test_an_unknown_event_name_is_refused_rather_than_sent(self):
        for name in ('', 'whatsapp_message', 'backup_failed ', 'disk'):
            with self.subTest(name=name), self.assertRaises(alerts.AlertError):
                AlertEvent.by_name(name)

    def test_a_message_cannot_carry_an_event_outside_the_enum(self):
        with self.assertRaises(alerts.AlertError):
            AlertMessage(event='backup_failed', target=TENANT_DATABASE, observed='x', timestamp=NOW)

    def test_every_event_renders_an_arabic_subject_and_a_body_naming_its_target(self):
        for event in AlertEvent:
            message = one_message(event)
            with self.subTest(event=event.value.name):
                self.assertTrue(has_arabic(message.subject), message.subject)
                self.assertIn(message.target, message.subject)
                self.assertIn(message.target, message.body)
                self.assertTrue(has_arabic(message.body))
                self.assertIn(event.value.name, message.body)
                self.assertIn(event.value.severity.label, message.body)
                self.assertIn(event.value.first_action, message.body)
                self.assertIn(NOW.isoformat(), message.body)

    def test_each_message_states_what_was_observed_and_the_threshold_when_it_has_one(self):
        for event in AlertEvent:
            message = one_message(event)
            with self.subTest(event=event.value.name):
                self.assertIn(message.observed, message.body)
                if event in (AlertEvent.BACKUP_STALE, AlertEvent.DISK_HIGH,
                             AlertEvent.CONTAINER_UNHEALTHY):
                    self.assertIsNotNone(message.threshold)
                    self.assertIn(message.threshold, message.body)
                else:
                    self.assertIsNone(message.threshold)

    def test_a_message_incomplete_in_any_field_is_refused(self):
        for field, value in (('target', '  '), ('observed', ''),
                             ('timestamp', datetime(2026, 11, 8))):
            complete = {'event': AlertEvent.BACKUP_FAILED, 'target': TENANT_DATABASE,
                        'observed': 'pg_dump exited 1', 'timestamp': NOW}
            with self.subTest(field=field), self.assertRaises(alerts.AlertError):
                AlertMessage(**{**complete, field: value})


class TestEachChannelGetsTheMessageOnce(unittest.TestCase):
    def setUp(self):
        self.email = FakeTransport()
        self.telegram = FakeTransport()
        self.notifiers = AlertConfig.from_environment(full_environment()).build_notifier_set(
            Transports(email=self.email, telegram=self.telegram),
        )

    def test_every_event_reaches_both_channels_exactly_once(self):
        for event in AlertEvent:
            with self.subTest(event=event.value.name):
                self.email.calls.clear()
                self.telegram.calls.clear()
                message = one_message(event)
                report = self.notifiers.notify(message)
                self.assertEqual([delivery.channel for delivery in report.deliveries],
                                 ['email', 'telegram'])
                self.assertEqual(report.failed_channels, ())
                self.assertEqual(len(self.email.calls), 1)
                self.assertEqual(len(self.telegram.calls), 1)
                email = self.email.calls[0]
                self.assertIsInstance(email, EmailMessage)
                self.assertEqual(email['Subject'], message.subject)
                self.assertEqual(email['To'], 'owner@example.test')
                self.assertEqual(self.telegram.calls[0], TelegramSender.render(message))
                self.assertIn(message.target, self.telegram.calls[0])

    def test_a_disabled_channel_is_not_built_and_the_other_still_sends(self):
        env = without_channel(full_environment(), alerts.TELEGRAM_VARIABLES)
        notifiers = AlertConfig.from_environment(env).build_notifier_set(
            Transports(email=self.email, telegram=self.telegram),
        )
        report = notifiers.notify(one_message(AlertEvent.BACKUP_FAILED))
        self.assertEqual([delivery.channel for delivery in report.deliveries], ['email'])
        self.assertEqual(self.telegram.calls, [])


class TestRealTransportsAddressTheRightEndpoint(unittest.TestCase):
    def test_telegram_posts_to_the_bot_api_with_the_configured_chat_id(self):
        seen = {}

        class Response:
            status = 200

            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

        def opener(request, timeout):
            seen['url'] = request.full_url
            seen['body'] = request.data
            seen['method'] = request.get_method()
            seen['timeout'] = timeout
            return Response()

        env = without_channel(full_environment(), alerts.EMAIL_VARIABLES)
        settings = AlertConfig.from_environment(env).telegram
        TelegramSender(settings, opener=opener).send(one_message(AlertEvent.DISK_HIGH))
        self.assertEqual(seen['url'], f'{alerts.TELEGRAM_API_BASE}/bot{BOT_SECRET}/sendMessage')
        self.assertEqual(seen['method'], 'POST')
        self.assertEqual(seen['timeout'], alerts.TELEGRAM_TIMEOUT_SECONDS)
        body = seen['body'].decode('ascii')
        self.assertEqual(urllib.parse.parse_qs(body)['chat_id'], ['424242'])
        self.assertNotIn(BOT_SECRET, urllib.parse.parse_qs(body)['text'][0])

    def test_email_opens_the_configured_smtp_host_and_starts_tls_before_sending(self):
        calls = []

        class FakeSMTP:
            def __init__(self, host, port, timeout=None):
                calls.append(('connect', host, port, timeout))

            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

            def ehlo(self):
                calls.append(('ehlo',))

            def starttls(self):
                calls.append(('starttls',))

            def login(self, user, password):
                calls.append(('login', user, password))

            def send_message(self, message):
                calls.append(('send_message', message['Subject']))

        settings = AlertConfig.from_environment(full_environment()).email
        EmailSender(settings, smtp_factory=FakeSMTP).send(one_message(AlertEvent.BACKUP_STALE))
        self.assertEqual(calls[0], ('connect', 'smtp.example.test', 2525,
                                    alerts.SMTP_TIMEOUT_SECONDS))
        self.assertLess(calls.index(('starttls',)), calls.index(
            ('send_message', one_message(AlertEvent.BACKUP_STALE).subject)))
        self.assertIn(('login', 'alerts@example.test', SMTP_SECRET), calls)

    def test_starttls_is_on_by_default_and_can_be_switched_off_explicitly(self):
        calls = []

        class FakeSMTP:
            def __init__(self, host, port, timeout=None):
                pass

            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

            def ehlo(self):
                pass

            def starttls(self):
                calls.append('starttls')

            def login(self, user, password):
                pass

            def send_message(self, message):
                calls.append('send')

        plain = AlertConfig.from_environment(full_environment()).email
        self.assertTrue(plain.starttls)
        EmailSender(plain, smtp_factory=FakeSMTP).send(one_message(AlertEvent.BACKUP_FAILED))
        self.assertEqual(calls, ['starttls', 'send'])

        calls.clear()
        no_tls = AlertConfig.from_environment(
            full_environment(**{alerts.ENV_SMTP_STARTTLS: 'false'}),
        ).email
        self.assertFalse(no_tls.starttls)
        EmailSender(no_tls, smtp_factory=FakeSMTP).send(one_message(AlertEvent.BACKUP_FAILED))
        self.assertEqual(calls, ['send'])


class TestOneFailingChannelNeverSilencesTheOther(unittest.TestCase):
    def notify(self, *, email_error=None, telegram_error=None):
        config = AlertConfig.from_environment(full_environment())
        transports = Transports(email=FakeTransport(email_error),
                                telegram=FakeTransport(telegram_error))
        return config.build_notifier_set(transports), transports

    def test_a_failing_email_still_lets_telegram_deliver_and_the_report_names_email(self):
        notifiers, transports = self.notify(email_error=OSError('relay refused the connection'))
        report = notifiers.notify(one_message(AlertEvent.CONTAINER_UNHEALTHY))
        self.assertEqual(report.failed_channels, ('email',))
        self.assertEqual(len(transports.telegram.calls), 1)
        failure = next(delivery for delivery in report.deliveries if delivery.channel == 'email')
        self.assertIn('relay refused the connection', failure.error)

    def test_a_failing_telegram_still_lets_email_deliver_and_the_report_names_telegram(self):
        notifiers, transports = self.notify(telegram_error=OSError('the Bot API answered 502'))
        report = notifiers.notify(one_message(AlertEvent.CONTAINER_UNHEALTHY))
        self.assertEqual(report.failed_channels, ('telegram',))
        self.assertEqual(len(transports.email.calls), 1)
        failure = next(delivery for delivery in report.deliveries if delivery.channel == 'telegram')
        self.assertIn('the Bot API answered 502', failure.error)

    def test_a_failed_delivery_raises_rather_than_returning_quietly(self):
        notifiers, _ = self.notify(email_error=OSError('no route to host'))
        report = notifiers.notify(one_message(AlertEvent.DISK_HIGH))
        with self.assertRaises(alerts.AlertDeliveryError) as raised:
            report.raise_for_failures()
        self.assertIn('email', str(raised.exception))
        self.assertNotIn('telegram', str(raised.exception))

    def test_both_channels_failing_names_both(self):
        notifiers, _ = self.notify(email_error=OSError('relay down'),
                                   telegram_error=urllib.error.URLError('no dns'))
        report = notifiers.notify(one_message(AlertEvent.BACKUP_FAILED))
        self.assertEqual(set(report.failed_channels), {'email', 'telegram'})
        with self.assertRaises(alerts.AlertDeliveryError) as raised:
            report.raise_for_failures()
        for channel in ('email', 'telegram'):
            self.assertIn(channel, str(raised.exception))

    def test_a_successful_report_raises_nothing(self):
        notifiers, _ = self.notify()
        notifiers.notify(one_message(AlertEvent.BACKUP_FAILED)).raise_for_failures()

    def test_an_empty_notifier_set_is_refused_instead_of_dropping_the_alert(self):
        with self.assertRaises(alerts.AlertError):
            alerts.NotifierSet(()).notify(one_message(AlertEvent.BACKUP_FAILED))

    def test_a_defect_that_is_not_a_transport_failure_propagates(self):
        with self.assertRaises(RuntimeError):
            alerts.NotifierSet((FakeNotifier(RuntimeError(DEFECT)),)).notify(
                one_message(AlertEvent.BACKUP_FAILED))

    def test_every_channel_of_a_set_receives_the_same_message(self):
        notifiers = (FakeNotifier(), FakeNotifier())
        message = one_message(AlertEvent.RESTORE_DRILL_FAILED)
        report = alerts.NotifierSet(notifiers).notify(message)
        self.assertEqual(report.failed_channels, ())
        for notifier in notifiers:
            self.assertEqual(notifier.messages, [message])


class TestConfigurationDisablesOnlyWhatTheOperatorDidNotAskFor(unittest.TestCase):
    def test_an_entirely_unset_environment_disables_both_channels_with_a_reason(self):
        config = AlertConfig.from_environment({})
        self.assertIsNone(config.email)
        self.assertIsNone(config.telegram)
        for channel in (alerts.EMAIL_CHANNEL, alerts.TELEGRAM_CHANNEL):
            with self.subTest(channel=channel):
                state = config.state(channel)
                self.assertFalse(state.enabled)
                self.assertTrue(state.reason)
                self.assertIn('LIWAN_ALERT_', state.reason)

    def test_a_configured_channel_is_enabled_with_no_reason(self):
        config = AlertConfig.from_environment(full_environment())
        for channel in (alerts.EMAIL_CHANNEL, alerts.TELEGRAM_CHANNEL):
            with self.subTest(channel=channel):
                self.assertTrue(config.state(channel).enabled)
                self.assertIsNone(config.state(channel).reason)

    def test_a_half_configured_telegram_is_refused_not_disabled(self):
        for missing in (alerts.ENV_TELEGRAM_CHAT_ID, alerts.ENV_TELEGRAM_BOT_TOKEN):
            with self.subTest(missing=missing), self.assertRaises(alerts.AlertConfigError) as raised:
                AlertConfig.from_environment(full_environment(**{missing: None}))
            self.assertIn(alerts.TELEGRAM_CHANNEL, str(raised.exception))
            self.assertIn(missing, str(raised.exception))

    def test_a_half_configured_email_is_refused_not_disabled(self):
        for missing in (alerts.ENV_SMTP_HOST, alerts.ENV_SMTP_FROM, alerts.ENV_SMTP_TO):
            with self.subTest(missing=missing), self.assertRaises(alerts.AlertConfigError) as raised:
                AlertConfig.from_environment(full_environment(**{missing: None}))
            self.assertIn(alerts.EMAIL_CHANNEL, str(raised.exception))
            self.assertIn(missing, str(raised.exception))

    def test_an_smtp_user_without_a_password_is_refused(self):
        env = full_environment(**{alerts.ENV_SMTP_PASSWORD: None})
        with self.assertRaises(alerts.AlertConfigError) as raised:
            AlertConfig.from_environment(env)
        self.assertIn(alerts.ENV_SMTP_PASSWORD, str(raised.exception))

    def test_a_malformed_port_or_tls_flag_is_refused(self):
        for name, value in ((alerts.ENV_SMTP_PORT, 'smtp'),
                            (alerts.ENV_SMTP_PORT, '0'),
                            (alerts.ENV_SMTP_PORT, '70000'),
                            (alerts.ENV_SMTP_STARTTLS, 'maybe')):
            with self.subTest(name=name, value=value), self.assertRaises(
                    alerts.AlertConfigError) as raised:
                AlertConfig.from_environment(full_environment(**{name: value}))
            self.assertIn(name, str(raised.exception))

    def test_a_configuration_with_no_channel_at_all_refuses_to_build_a_notifier_set(self):
        with self.assertRaises(alerts.AlertConfigError):
            AlertConfig.from_environment({}).build_notifier_set()


class TestBackupAgeEvaluator(unittest.TestCase):
    def evaluate(self, age_seconds, **kwargs):
        return alerts.evaluate_backup_age(database=TENANT_DATABASE, age_seconds=age_seconds,
                                          timestamp=NOW, **kwargs)

    def test_the_rpo_default_is_one_hour(self):
        self.assertEqual(alerts.DEFAULT_BACKUP_RPO_SECONDS, 3600)

    def test_a_backup_older_than_the_rpo_alerts(self):
        for age in (3601, 7200, 86400):
            with self.subTest(age=age):
                message = self.evaluate(age)
                self.assertIsNotNone(message)
                self.assertIs(message.event, AlertEvent.BACKUP_STALE)
                self.assertIn('3600', message.threshold)

    def test_a_backup_within_the_rpo_stays_silent(self):
        for age in (0, 1, 1800, 3599, 3600):
            with self.subTest(age=age):
                self.assertIsNone(self.evaluate(age))

    def test_the_rpo_is_an_argument_not_a_literal_in_the_comparison(self):
        self.assertIsNone(self.evaluate(60, rpo_seconds=120))
        self.assertIsNotNone(self.evaluate(60, rpo_seconds=30))
        self.assertIsNotNone(self.evaluate(30 * 60, rpo_seconds=10 * 60))

    def test_a_nonsense_rpo_or_age_is_refused(self):
        for kwargs in ({'rpo_seconds': 0}, {'rpo_seconds': -60}):
            with self.subTest(**kwargs), self.assertRaises(alerts.AlertError):
                self.evaluate(10, **kwargs)
        with self.assertRaises(alerts.AlertError):
            self.evaluate(-1)


class TestDiskEvaluator(unittest.TestCase):
    def test_the_threshold_is_a_parameter_with_a_named_default(self):
        self.assertEqual(alerts.DEFAULT_DISK_USAGE_PERCENT, 85)
        at_default = alerts.evaluate_disk_usage(host='app-1', used_percent=85, timestamp=NOW)
        self.assertIsNotNone(at_default)
        self.assertIn('85.0%', at_default.threshold)

    def test_usage_below_the_threshold_stays_silent_and_at_or_above_alerts(self):
        for percent, expected in ((10, False), (84.9, False), (85, True), (99.5, True), (100, True)):
            with self.subTest(percent=percent):
                message = alerts.evaluate_disk_usage(host='app-1', used_percent=percent,
                                                     timestamp=NOW)
                self.assertEqual(message is not None, expected)

    def test_a_custom_threshold_moves_the_boundary(self):
        self.assertIsNone(alerts.evaluate_disk_usage(host='app-1', used_percent=70,
                                                     timestamp=NOW, threshold_percent=90))
        self.assertIsNotNone(alerts.evaluate_disk_usage(host='app-1', used_percent=90,
                                                        timestamp=NOW, threshold_percent=90))

    def test_an_impossible_threshold_or_usage_is_refused(self):
        for kwargs in ({'threshold_percent': 0}, {'threshold_percent': 101},
                       {'used_percent': -1}, {'used_percent': 120}):
            params = {'host': 'app-1', 'used_percent': 50, 'timestamp': NOW, **kwargs}
            with self.subTest(**kwargs), self.assertRaises(alerts.AlertError):
                alerts.evaluate_disk_usage(**params)


class TestContainerEvaluator(unittest.TestCase):
    def test_only_an_unhealthy_container_alerts(self):
        for health, expected in (('unhealthy', True), ('healthy', False), ('starting', False)):
            with self.subTest(health=health):
                message = alerts.evaluate_container_health(container='liwan-odoo', health=health,
                                                           timestamp=NOW)
                self.assertEqual(message is not None, expected)

    def test_an_unknown_health_state_is_refused_not_read_as_healthy(self):
        for health in ('', 'unknown', 'dead', 'Healthy'):
            with self.subTest(health=health), self.assertRaises(alerts.AlertError):
                alerts.evaluate_container_health(container='liwan-odoo', health=health,
                                                 timestamp=NOW)

    def test_the_unhealthy_message_names_the_container(self):
        message = alerts.evaluate_container_health(container='liwan-odoo', health='unhealthy',
                                                   timestamp=NOW)
        self.assertIn('liwan-odoo', message.subject)
        self.assertIn('liwan-odoo', message.body)


class TestNoSecretIsEverRendered(unittest.TestCase):
    def test_no_configured_secret_appears_in_a_subject_a_body_or_a_report(self):
        for secret in (SMTP_SECRET, BOT_SECRET):
            for event in AlertEvent:
                message = one_message(event)
                with self.subTest(secret=secret, event=event.value.name):
                    self.assertNotIn(secret, message.subject)
                    self.assertNotIn(secret, message.body)
                    self.assertNotIn(secret, TelegramSender.render(message))

    def test_a_secret_echoed_by_a_transport_error_is_scrubbed_from_the_report(self):
        config = AlertConfig.from_environment(full_environment())
        transports = Transports(
            email=FakeTransport(OSError(f'login rejected for password {SMTP_SECRET}')),
            telegram=FakeTransport(urllib.error.HTTPError(
                f'{alerts.TELEGRAM_API_BASE}/bot{BOT_SECRET}/sendMessage', 401, 'Unauthorized',
                {}, None)),
        )
        report = config.build_notifier_set(transports).notify(one_message(AlertEvent.BACKUP_FAILED))
        self.assertEqual(set(report.failed_channels), {'email', 'telegram'})
        with self.assertRaises(alerts.AlertDeliveryError) as raised:
            report.raise_for_failures()
        self.assertNotIn(SMTP_SECRET, str(raised.exception))
        self.assertNotIn(BOT_SECRET, str(raised.exception))
        self.assertIn(alerts.REDACTED, str(raised.exception))

    def test_a_settings_repr_carries_no_secret(self):
        config = AlertConfig.from_environment(full_environment())
        for settings in (config.email, config.telegram):
            with self.subTest(settings=type(settings).__name__):
                self.assertNotIn(SMTP_SECRET, repr(settings))
                self.assertNotIn(BOT_SECRET, repr(settings))

    def test_a_message_that_would_carry_a_credential_is_withheld_from_every_channel(self):
        """The guard is loud: the alert is reported undelivered, never delivered with a secret."""
        for secret in (SMTP_SECRET, BOT_SECRET):
            with self.subTest(secret=secret[:6]):
                config = AlertConfig.from_environment(full_environment())
                leaked = AlertMessage(event=AlertEvent.BACKUP_FAILED, target=TENANT_DATABASE,
                                      observed=f'pg_dump failed: secret={secret}', timestamp=NOW)
                channels = {alerts.EMAIL_CHANNEL: FakeTransport(),
                            alerts.TELEGRAM_CHANNEL: FakeTransport()}
                report = config.build_notifier_set(
                    Transports(email=channels[alerts.EMAIL_CHANNEL],
                               telegram=channels[alerts.TELEGRAM_CHANNEL]),
                ).notify(leaked)
                self.assertEqual(set(report.failed_channels), set(channels))
                for transport in channels.values():
                    self.assertEqual(transport.calls, [])
                with self.assertRaises(alerts.AlertDeliveryError) as raised:
                    report.raise_for_failures()
                self.assertIn('credential', str(raised.exception))
                self.assertNotIn(secret, str(raised.exception))


class TestCommandLine(unittest.TestCase):
    def run_main(self, argv, env=None, transports=None):
        stdout, stderr = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            code = alerts.main(argv, env=env if env is not None else {}, transports=transports,
                               now=NOW)
        return code, stdout.getvalue(), stderr.getvalue()

    def test_every_event_has_a_subcommand(self):
        choices = alerts.build_parser()._subparsers._group_actions[0].choices
        self.assertEqual(sorted(choices), sorted(event.value.name for event in AlertEvent))

    def test_no_configured_channel_is_a_refusal_exit_code_and_sends_nothing(self):
        email, telegram = FakeTransport(), FakeTransport()
        code, stdout, stderr = self.run_main(
            ['backup_failed', '--database', TENANT_DATABASE, '--reason', 'pg_dump exited 1'],
            env={}, transports=Transports(email=email, telegram=telegram),
        )
        self.assertEqual(code, alerts.EXIT_REFUSED)
        self.assertEqual(stdout, '')
        self.assertIn('no alert channel is configured', stderr)
        self.assertEqual((email.calls, telegram.calls), ([], []))

    def test_a_half_configured_environment_is_refused_before_any_send(self):
        email = FakeTransport()
        code, stdout, stderr = self.run_main(
            ['disk_high', '--host', 'app-1', '--used-percent', '99'],
            env=full_environment(**{alerts.ENV_TELEGRAM_CHAT_ID: None}),
            transports=Transports(email=email, telegram=FakeTransport()),
        )
        self.assertEqual(code, alerts.EXIT_REFUSED)
        self.assertEqual(stdout, '')
        self.assertIn(alerts.ENV_TELEGRAM_CHAT_ID, stderr)
        self.assertEqual(email.calls, [])

    def test_a_delivered_alert_prints_json_and_exits_zero(self):
        code, stdout, stderr = self.run_main(
            ['container_unhealthy', '--container', 'liwan-odoo'],
            env=full_environment(),
            transports=Transports(email=FakeTransport(), telegram=FakeTransport()),
        )
        self.assertEqual((code, stderr), (0, ''))
        payload = json.loads(stdout)
        self.assertEqual(payload['event'], 'container_unhealthy')
        self.assertEqual(payload['target'], 'liwan-odoo')
        self.assertTrue(payload['alerted'])
        self.assertEqual(set(payload['channels']), {'email', 'telegram'})
        for channel in payload['channels'].values():
            self.assertTrue(channel['delivered'])
        self.assertNotIn(SMTP_SECRET, stdout)
        self.assertNotIn(BOT_SECRET, stdout)

    def test_an_undelivered_alert_exits_non_zero_and_names_the_channel(self):
        code, stdout, stderr = self.run_main(
            ['restore_drill_failed', '--database', TENANT_DATABASE, '--reason', 'verify exited 1'],
            env=full_environment(),
            transports=Transports(email=FakeTransport(OSError('relay down')),
                                  telegram=FakeTransport()),
        )
        self.assertEqual(code, alerts.EXIT_DELIVERY_FAILED)
        self.assertIn('email', stderr)
        payload = json.loads(stdout)
        self.assertFalse(payload['channels']['email']['delivered'])
        self.assertTrue(payload['channels']['telegram']['delivered'])

    def test_an_event_whose_threshold_was_not_crossed_sends_nothing(self):
        for argv in (['backup_stale', '--database', TENANT_DATABASE, '--age-seconds', '600'],
                     ['disk_high', '--host', 'app-1', '--used-percent', '10']):
            email, telegram = FakeTransport(), FakeTransport()
            with self.subTest(argv=argv):
                code, stdout, _ = self.run_main(argv, env=full_environment(),
                                                transports=Transports(email=email,
                                                                      telegram=telegram))
                self.assertEqual(code, alerts.EXIT_OK)
                self.assertFalse(json.loads(stdout)['alerted'])
                self.assertEqual((email.calls, telegram.calls), ([], []))

    def test_the_default_rpo_reaches_the_command_line_unchanged(self):
        code, stdout, _ = self.run_main(
            ['backup_stale', '--database', TENANT_DATABASE, '--age-seconds', '3601'],
            env=full_environment(),
            transports=Transports(email=FakeTransport(), telegram=FakeTransport()),
        )
        self.assertEqual(code, alerts.EXIT_OK)
        self.assertIn('RPO 3600', json.loads(stdout)['body'])

    def test_a_withheld_message_prints_no_body_and_no_secret(self):
        code, stdout, stderr = self.run_main(
            ['backup_failed', '--database', TENANT_DATABASE,
             '--reason', f'pg_dump failed with {SMTP_SECRET}'],
            env=full_environment(),
            transports=Transports(email=FakeTransport(), telegram=FakeTransport()),
        )
        self.assertEqual(code, alerts.EXIT_DELIVERY_FAILED)
        self.assertNotIn(SMTP_SECRET, stdout)
        payload = json.loads(stdout)
        self.assertNotIn('body', payload)
        self.assertNotIn('subject', payload)
        self.assertIn('credential', payload['withheld'])
        self.assertIn('credential', stderr)

    def test_the_container_probe_reports_the_state_it_actually_read(self):
        email = FakeTransport()
        code, stdout, _ = self.run_main(
            ['container_unhealthy', '--container', 'liwan-odoo', '--health', 'healthy'],
            env=full_environment(),
            transports=Transports(email=email, telegram=FakeTransport()),
        )
        self.assertEqual(code, alerts.EXIT_OK)
        self.assertFalse(json.loads(stdout)['alerted'])
        self.assertEqual(email.calls, [])

    def test_an_unknown_container_state_is_refused_by_the_command_line_too(self):
        email = FakeTransport()
        with self.assertRaises(SystemExit) as raised, contextlib.redirect_stderr(io.StringIO()):
            self.run_main(['container_unhealthy', '--container', 'liwan-odoo', '--health', 'dead'],
                          env=full_environment(),
                          transports=Transports(email=email, telegram=FakeTransport()))
        self.assertEqual(raised.exception.code, alerts.EXIT_REFUSED)
        self.assertEqual(email.calls, [])

    def test_an_out_of_range_measurement_is_refused_before_any_send(self):
        email = FakeTransport()
        code, stdout, stderr = self.run_main(
            ['disk_high', '--host', 'app-1', '--used-percent', '120'],
            env=full_environment(),
            transports=Transports(email=email, telegram=FakeTransport()),
        )
        self.assertEqual(code, alerts.EXIT_REFUSED)
        self.assertEqual(stdout, '')
        self.assertIn('percentage', stderr)
        self.assertEqual(email.calls, [])

    def test_a_disabled_channel_is_reported_in_the_payload_with_its_reason(self):
        code, stdout, _ = self.run_main(
            ['backup_failed', '--database', TENANT_DATABASE, '--reason', 'pg_dump exited 1'],
            env=without_channel(full_environment(), alerts.TELEGRAM_VARIABLES),
            transports=Transports(email=FakeTransport(), telegram=FakeTransport()),
        )
        self.assertEqual(code, alerts.EXIT_OK)
        disabled = json.loads(stdout)['disabled']
        self.assertEqual(list(disabled), [alerts.TELEGRAM_CHANNEL])
        self.assertIn('LIWAN_ALERT_', disabled[alerts.TELEGRAM_CHANNEL])


if __name__ == '__main__':
    unittest.main()
