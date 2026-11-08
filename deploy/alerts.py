# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Owner alerts for the five operational events, by email and Telegram, nothing else.

One fact lives here: which five things are worth telling the owner about, what the
owner is told about each, and over which two channels the message travels. The
events are fixed, so no module can send an arbitrary text through this file: it
names one of :class:`AlertEvent` or it does not send. The channels are fixed for
the same reason (owner decision: email and Telegram, never WhatsApp).

Three rules shape the code, each with a test that fails when the rule is removed:

* Nothing is silent. A channel that cannot deliver raises, the fan-out keeps the
  other channel working, and the returned report names every failed channel. A
  channel the operator did not configure is disabled with a recorded reason, while
  a half-configured channel is refused before anything is sent.
* No secret leaves its environment variable. Tokens and passwords are read from
  the environment, are excluded from ``repr``, are scrubbed from a transport error
  before it is reported, and a message that would render one is withheld from every
  channel and reported as an undelivered alert — loud, never a quiet drop.
* A threshold is an argument with a named default, never a literal inside a
  comparison: RPO one hour (owner decision 2026-11-06) and a disk threshold the
  operator sets.

``deploy/ci/main-alert.sh`` is this repository's earlier alert and keeps its own
CI job; this module is the operations channel of
``docs/operations/saas-commercial-runbook.md`` §5.
"""
from __future__ import annotations

import argparse
import json
import os
import smtplib
import ssl
import sys
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timezone
from email.message import EmailMessage
from enum import Enum
from typing import TYPE_CHECKING, NoReturn, Protocol

if TYPE_CHECKING:
    from collections.abc import Callable, Mapping

# Owner decision 2026-11-06: a backup older than one hour is a stale backup.
DEFAULT_BACKUP_RPO_SECONDS = 3600
# Operator-set value until a capacity measurement replaces it; the runbook says so.
DEFAULT_DISK_USAGE_PERCENT = 85
# Docker's own health states; only UNHEALTHY is an alert, STARTING settles by itself.
DOCKER_HEALTHY = 'healthy'
DOCKER_STARTING = 'starting'
DOCKER_UNHEALTHY = 'unhealthy'
DOCKER_HEALTH_STATES = frozenset({DOCKER_HEALTHY, DOCKER_STARTING, DOCKER_UNHEALTHY})
# The submission port of the SMTP relay this deployment uses.
DEFAULT_SMTP_PORT = 587
# A hung relay or a black-holed Bot API call must end the run instead of blocking it.
SMTP_TIMEOUT_SECONDS = 30
TELEGRAM_TIMEOUT_SECONDS = 30
TELEGRAM_API_BASE = 'https://api.telegram.org'
# Nothing was sent: a refused environment or a refused input, for the operator to fix;
# a failed delivery is the relay's, and it is a different exit so a cron can tell them apart.
EXIT_OK = 0
EXIT_DELIVERY_FAILED = 1
EXIT_REFUSED = 2
REDACTED = '[redacted]'
WITHHELD_CREDENTIAL = 'refused to send an alert carrying a configured credential'

EMAIL_CHANNEL = 'email'
TELEGRAM_CHANNEL = 'telegram'

ENV_SMTP_HOST = 'LIWAN_ALERT_SMTP_HOST'
ENV_SMTP_PORT = 'LIWAN_ALERT_SMTP_PORT'
ENV_SMTP_FROM = 'LIWAN_ALERT_SMTP_FROM'
ENV_SMTP_TO = 'LIWAN_ALERT_SMTP_TO'
ENV_SMTP_USER = 'LIWAN_ALERT_SMTP_USER'
ENV_SMTP_PASSWORD = 'LIWAN_ALERT_SMTP_PASSWORD'
ENV_SMTP_STARTTLS = 'LIWAN_ALERT_SMTP_STARTTLS'
ENV_TELEGRAM_BOT_TOKEN = 'LIWAN_ALERT_TELEGRAM_BOT_TOKEN'
ENV_TELEGRAM_CHAT_ID = 'LIWAN_ALERT_TELEGRAM_CHAT_ID'

EMAIL_REQUIRED_VARIABLES = (ENV_SMTP_HOST, ENV_SMTP_FROM, ENV_SMTP_TO)
EMAIL_VARIABLES = (*EMAIL_REQUIRED_VARIABLES, ENV_SMTP_PORT, ENV_SMTP_USER, ENV_SMTP_PASSWORD,
                   ENV_SMTP_STARTTLS)
TELEGRAM_VARIABLES = (ENV_TELEGRAM_BOT_TOKEN, ENV_TELEGRAM_CHAT_ID)

TRUE_VALUES = frozenset({'1', 'true', 'yes', 'on'})
FALSE_VALUES = frozenset({'0', 'false', 'no', 'off'})


class AlertError(Exception):
    """An alert cannot be built or sent as asked."""


class AlertConfigError(AlertError):
    """The environment does not describe a usable set of channels."""


class DeliveryError(AlertError):
    """One channel could not deliver one message."""


class AlertDeliveryError(AlertError):
    """A delivery was attempted and at least one channel failed; the text names them."""


class Severity(Enum):
    """How urgent the owner-facing message is; the label is what the owner reads."""

    CRITICAL = 'critical'
    WARNING = 'warning'

    @property
    def label(self) -> str:
        return 'حرجة' if self is Severity.CRITICAL else 'تحذير'


@dataclass(frozen=True)
class EventSpec:
    """One of the five events: its stable machine name and its owner-facing text."""

    name: str
    title: str
    severity: Severity
    first_action: str


class AlertEvent(Enum):
    """The five events an alert may name. Nothing else can be sent (owner decision)."""

    BACKUP_FAILED = EventSpec(
        name='backup_failed',
        title='فشل النسخ الاحتياطي',
        severity=Severity.CRITICAL,
        first_action='افحص سجل أداة النسخ ومخرجات pg_dump، ثم أعد النسخة بعد إصلاح السبب.',
    )
    BACKUP_STALE = EventSpec(
        name='backup_stale',
        title='تقادم النسخة الاحتياطية',
        severity=Severity.CRITICAL,
        first_action='شغّل نسخة احتياطية الآن، ثم افحص مجدول النسخ والمساحة الحرة على مضيف النسخ.',
    )
    DISK_HIGH = EventSpec(
        name='disk_high',
        title='امتلاء قرص المضيف',
        severity=Severity.WARNING,
        first_action='حرّر مساحة على المضيف (سجلات أو نسخ قديمة) أو وسّع القرص قبل أن يمتلئ.',
    )
    CONTAINER_UNHEALTHY = EventSpec(
        name='container_unhealthy',
        title='حاوية غير سليمة',
        severity=Severity.CRITICAL,
        first_action='افحص الحالة بأمر docker inspect وسجلاتها بأمر docker logs، '
                     'ثم أعد تشغيلها بعد تحديد السبب.',
    )
    RESTORE_DRILL_FAILED = EventSpec(
        name='restore_drill_failed',
        title='فشل تمرين الاستعادة',
        severity=Severity.CRITICAL,
        first_action='لا تعتبر هذه النسخة قابلة للاستعادة؛ أعد تمرين الاستعادة على قاعدة scratch '
                     'واقرأ تقرير التحقق.',
    )

    @classmethod
    def by_name(cls, name: str) -> AlertEvent:
        """Resolve the stable machine name; anything else is refused."""
        for event in cls:
            if event.value.name == name:
                return event
        raise AlertError(f'unknown alert event: {name!r}')


@dataclass(frozen=True)
class AlertMessage:
    """One alert, rendered from its structured fields in exactly one place.

    ``observed`` is the measured value, or the short failure reason for the two
    events that have no threshold. It is an operational state, never a document:
    no path of a secret file, no credential, no customer personal data.
    """

    event: AlertEvent
    target: str
    observed: str
    timestamp: datetime
    threshold: str | None = None

    def __post_init__(self) -> None:
        _require(isinstance(self.event, AlertEvent), f'unknown alert event: {self.event!r}')
        _require(bool(self.target.strip()),
                 'an alert names the tenant, database, host or container it concerns')
        _require(bool(self.observed.strip()), 'an alert states what was observed or why it failed')
        _require(self.timestamp.utcoffset() is not None, 'an alert timestamp is timezone aware')

    @property
    def severity(self) -> Severity:
        return self.event.value.severity

    @property
    def subject(self) -> str:
        return f'[{self.severity.label}] {self.event.value.title}: {self.target}'

    @property
    def body(self) -> str:
        lines = [
            f'الحدث: {self.event.value.title} ({self.event.value.name})',
            f'الخطورة: {self.severity.label}',
            f'الهدف: {self.target}',
            f'الملاحظ: {self.observed}',
        ]
        if self.threshold is not None:
            lines.append(f'العتبة: {self.threshold}')
        lines.append(f'الوقت (UTC): {self.timestamp.isoformat()}')
        lines.append(f'الإجراء الأول: {self.event.value.first_action}')
        return '\n'.join(lines) + '\n'


class Notifier(Protocol):
    """One delivery channel: a name the report can cite, and one send call."""

    channel: str

    def send(self, message: AlertMessage) -> None:
        """Deliver the message or raise :class:`DeliveryError`."""


@dataclass(frozen=True)
class Delivery:
    """What one channel did with one message."""

    channel: str
    error: str | None = None

    @property
    def delivered(self) -> bool:
        return self.error is None


@dataclass(frozen=True)
class DeliveryReport:
    """Every channel's outcome, with each failed channel named.

    ``withheld_reason`` is set only when the fan-out refused to send at all; the
    message then exists but was never rendered to a channel or to a log.
    """

    deliveries: tuple[Delivery, ...]
    withheld_reason: str | None = None

    @property
    def failed_channels(self) -> tuple[str, ...]:
        return tuple(delivery.channel for delivery in self.deliveries if not delivery.delivered)

    def raise_for_failures(self) -> None:
        """Refuse to end a run that left an alert undelivered."""
        failed = [delivery for delivery in self.deliveries if not delivery.delivered]
        if failed:
            reasons = '; '.join(f'{delivery.channel}: {delivery.error}' for delivery in failed)
            raise AlertDeliveryError(f'alert not delivered by {reasons}')


@dataclass(frozen=True)
class NotifierSet:
    """The configured channels, behind one call that fans out to all of them."""

    notifiers: tuple[Notifier, ...]
    secrets: tuple[str, ...] = ()

    def notify(self, message: AlertMessage) -> DeliveryReport:
        """Send to every channel, then report each outcome.

        One failing channel never stops the other: the loop always reaches every
        channel and the report keeps the failure. Only a transport failure is kept
        here; any other exception is a defect and propagates.

        The credential guard sits here because this set is what knows every
        configured secret: a message that would render one is withheld from all
        channels and reported as a failed delivery, so the leak cannot happen and
        cannot be quiet. Such a message is a caller defect to fix, and it stays
        visible as an undelivered alert on the same run.
        """
        _require(bool(self.notifiers), 'no alert channel is configured: refusing to drop the alert')
        if _carries_credential(message, self.secrets):
            return DeliveryReport(
                tuple(Delivery(channel=notifier.channel, error=WITHHELD_CREDENTIAL)
                      for notifier in self.notifiers),
                withheld_reason=WITHHELD_CREDENTIAL,
            )
        return DeliveryReport(tuple(_deliver(notifier, message) for notifier in self.notifiers))


def _deliver(notifier: Notifier, message: AlertMessage) -> Delivery:
    try:
        notifier.send(message)
    except DeliveryError as error:
        return Delivery(channel=notifier.channel, error=str(error))
    return Delivery(channel=notifier.channel)


@dataclass(frozen=True)
class EmailSettings:
    """The SMTP relay and the owner's mailbox, all from the environment."""

    host: str
    port: int
    sender: str
    recipients: tuple[str, ...]
    username: str
    password: str = field(repr=False)
    starttls: bool = True

    @property
    def secrets(self) -> tuple[str, ...]:
        return (self.password,)


@dataclass(frozen=True)
class TelegramSettings:
    """The bot and the owner's chat, all from the environment."""

    bot_token: str = field(repr=False)
    chat_id: str

    @property
    def secrets(self) -> tuple[str, ...]:
        return (self.bot_token,)


@dataclass(frozen=True)
class ChannelState:
    """A channel as configuration left it: enabled, or disabled with its reason."""

    channel: str
    reason: str | None = None

    @property
    def enabled(self) -> bool:
        return self.reason is None


@dataclass(frozen=True)
class Transports:
    """The seams a test replaces; ``None`` means the real SMTP/HTTP transport."""

    email: Callable[[EmailMessage], None] | None = None
    telegram: Callable[[str], None] | None = None


class EmailSender:
    """Deliver one alert per call over SMTP, STARTTLS by default."""

    channel = EMAIL_CHANNEL

    def __init__(self, settings: EmailSettings, transport: Callable[[EmailMessage], None] | None = None,
                 smtp_factory: Callable[..., smtplib.SMTP] = smtplib.SMTP) -> None:
        self.settings = settings
        self.transport = transport if transport is not None else self.send_over_smtp
        self.smtp_factory = smtp_factory

    def send(self, message: AlertMessage) -> None:
        try:
            self.transport(self.compose(message))
        except OSError as error:
            # smtplib's SMTPException is an OSError, so a refused connection, a TLS
            # failure and a rejected login all arrive here.
            raise DeliveryError(_describe(error, self.settings.secrets)) from error

    def compose(self, message: AlertMessage) -> EmailMessage:
        email = EmailMessage()
        email['From'] = self.settings.sender
        email['To'] = ', '.join(self.settings.recipients)
        email['Subject'] = message.subject
        email.set_content(message.body, subtype='plain', charset='utf-8')
        return email

    def send_over_smtp(self, email: EmailMessage) -> None:
        settings = self.settings
        with self.smtp_factory(settings.host, settings.port, timeout=SMTP_TIMEOUT_SECONDS) as client:
            client.ehlo()
            if settings.starttls:
                client.starttls(context=ssl.create_default_context())
                client.ehlo()
            if settings.username:
                client.login(settings.username, settings.password)
            client.send_message(email)


class TelegramSender:
    """Deliver one alert per call through the Bot API ``sendMessage`` method."""

    channel = TELEGRAM_CHANNEL

    def __init__(self, settings: TelegramSettings, transport: Callable[[str], None] | None = None,
                 opener: Callable[..., object] = urllib.request.urlopen) -> None:
        self.settings = settings
        self.transport = transport if transport is not None else self.send_over_bot_api
        self.opener = opener

    def send(self, message: AlertMessage) -> None:
        try:
            self.transport(self.render(message))
        except OSError as error:
            # URLError, HTTPError and socket timeouts are all OSErrors.
            raise DeliveryError(_describe(error, self.settings.secrets)) from error

    @staticmethod
    def render(message: AlertMessage) -> str:
        """The subject first, so the notification preview carries the event and its target."""
        return f'{message.subject}\n\n{message.body}'

    def send_over_bot_api(self, text: str) -> None:
        settings = self.settings
        payload = urllib.parse.urlencode({'chat_id': settings.chat_id, 'text': text}).encode('ascii')
        url = f'{TELEGRAM_API_BASE}/bot{settings.bot_token}/sendMessage'
        request = urllib.request.Request(url, data=payload, method='POST')
        with self.opener(request, timeout=TELEGRAM_TIMEOUT_SECONDS) as response:
            if response.status != 200:
                raise DeliveryError(f'the Bot API answered {response.status}')


@dataclass(frozen=True)
class AlertConfig:
    """The channels this environment configures, and the reason for each it does not."""

    email: EmailSettings | None
    telegram: TelegramSettings | None
    states: tuple[ChannelState, ...]

    @classmethod
    def from_environment(cls, env: Mapping[str, str]) -> AlertConfig:
        email, email_state = _email_from_environment(env)
        telegram, telegram_state = _telegram_from_environment(env)
        return cls(email=email, telegram=telegram, states=(email_state, telegram_state))

    @property
    def secrets(self) -> tuple[str, ...]:
        """Every credential this configuration holds; the fan-out never renders one."""
        secrets: list[str] = []
        for settings in (self.email, self.telegram):
            if settings is not None:
                secrets.extend(settings.secrets)
        return tuple(secrets)

    def state(self, channel: str) -> ChannelState:
        for state in self.states:
            if state.channel == channel:
                return state
        raise AlertConfigError(f'unknown alert channel: {channel!r}')

    def build_notifier_set(self, transports: Transports | None = None) -> NotifierSet:
        """Build the enabled channels; a configuration with none is a refusal."""
        seams = transports if transports is not None else Transports()
        notifiers: list[Notifier] = []
        if self.email is not None:
            notifiers.append(EmailSender(self.email, transport=seams.email))
        if self.telegram is not None:
            notifiers.append(TelegramSender(self.telegram, transport=seams.telegram))
        if not notifiers:
            _refuse('no alert channel is configured, so the alert would be dropped')
        return NotifierSet(tuple(notifiers), self.secrets)


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise AlertError(message)


def _refuse(reason: str, channel: str | None = None) -> NoReturn:
    prefix = f'{channel} alerting: ' if channel else ''
    raise AlertConfigError(f'{prefix}{reason}')


def _carries_credential(message: AlertMessage, secrets: tuple[str, ...]) -> bool:
    rendered = f'{message.subject}\n{message.body}'
    return any(secret and secret in rendered for secret in secrets)


def _describe(error: BaseException, secrets: tuple[str, ...]) -> str:
    """The error's own text, with every configured secret scrubbed out of it."""
    text = f'{type(error).__name__}: {error}'
    for secret in secrets:
        if secret:
            text = text.replace(secret, REDACTED)
    return text


def _present(env: Mapping[str, str], name: str) -> bool:
    return bool(env.get(name, '').strip())


def _require_all(env: Mapping[str, str], channel: str, names: tuple[str, ...]) -> None:
    missing = [name for name in names if not _present(env, name)]
    if missing:
        _refuse(f'{" and ".join(missing)} '
                f'{"is" if len(missing) == 1 else "are"} not set', channel)


def _parse_tls_flag(env: Mapping[str, str]) -> bool:
    """STARTTLS is on unless the operator says otherwise; anything else is refused."""
    value = env.get(ENV_SMTP_STARTTLS, '').strip().lower()
    if not value:
        return True
    if value in TRUE_VALUES:
        return True
    if value in FALSE_VALUES:
        return False
    _refuse(f'{ENV_SMTP_STARTTLS} must be one of {", ".join(sorted(TRUE_VALUES | FALSE_VALUES))}',
            EMAIL_CHANNEL)


def _unset_reason(names: tuple[str, ...]) -> str:
    return f'none of {", ".join(names)} is set'


def _parse_port(env: Mapping[str, str]) -> int:
    raw = env.get(ENV_SMTP_PORT, '').strip()
    if not raw:
        return DEFAULT_SMTP_PORT
    port = int(raw) if raw.isdigit() else 0
    if not 0 < port < 65536:
        _refuse(f'{ENV_SMTP_PORT} must be a port number between 1 and 65535', EMAIL_CHANNEL)
    return port


def _recipients(env: Mapping[str, str]) -> tuple[str, ...]:
    addresses = tuple(part.strip() for part in env[ENV_SMTP_TO].split(',') if part.strip())
    if not addresses:
        _refuse(f'{ENV_SMTP_TO} lists no address', EMAIL_CHANNEL)
    return addresses


def _email_from_environment(env: Mapping[str, str]) -> tuple[EmailSettings | None, ChannelState]:
    if not any(_present(env, name) for name in EMAIL_VARIABLES):
        return None, ChannelState(EMAIL_CHANNEL, _unset_reason(EMAIL_VARIABLES))
    _require_all(env, EMAIL_CHANNEL, EMAIL_REQUIRED_VARIABLES)
    if _present(env, ENV_SMTP_USER) != _present(env, ENV_SMTP_PASSWORD):
        _refuse(f'{ENV_SMTP_USER} and {ENV_SMTP_PASSWORD} are set together or not at all', EMAIL_CHANNEL)
    settings = EmailSettings(
        host=env[ENV_SMTP_HOST].strip(),
        port=_parse_port(env),
        sender=env[ENV_SMTP_FROM].strip(),
        recipients=_recipients(env),
        username=env.get(ENV_SMTP_USER, '').strip(),
        password=env.get(ENV_SMTP_PASSWORD, ''),
        starttls=_parse_tls_flag(env),
    )
    return settings, ChannelState(EMAIL_CHANNEL)


def _telegram_from_environment(env: Mapping[str, str]) -> tuple[TelegramSettings | None, ChannelState]:
    if not any(_present(env, name) for name in TELEGRAM_VARIABLES):
        return None, ChannelState(TELEGRAM_CHANNEL, _unset_reason(TELEGRAM_VARIABLES))
    _require_all(env, TELEGRAM_CHANNEL, TELEGRAM_VARIABLES)
    settings = TelegramSettings(
        bot_token=env[ENV_TELEGRAM_BOT_TOKEN].strip(),
        chat_id=env[ENV_TELEGRAM_CHAT_ID].strip(),
    )
    return settings, ChannelState(TELEGRAM_CHANNEL)


def backup_failed_message(*, database: str, reason: str, timestamp: datetime) -> AlertMessage:
    """A backup run reported a failure; there is no threshold to compare."""
    return AlertMessage(event=AlertEvent.BACKUP_FAILED, target=database, observed=reason,
                        timestamp=timestamp)


def restore_drill_failed_message(*, database: str, reason: str, timestamp: datetime) -> AlertMessage:
    """A restore drill failed; the backup it exercised is not proven restorable."""
    return AlertMessage(event=AlertEvent.RESTORE_DRILL_FAILED, target=database, observed=reason,
                        timestamp=timestamp)


def evaluate_backup_age(*, database: str, age_seconds: float, timestamp: datetime,
                        rpo_seconds: int = DEFAULT_BACKUP_RPO_SECONDS) -> AlertMessage | None:
    """Alert when the newest good backup is older than the RPO; silent at or within it."""
    _require(rpo_seconds > 0, 'the RPO must be a positive number of seconds')
    _require(age_seconds >= 0, 'a backup age cannot be negative')
    if age_seconds <= rpo_seconds:
        return None
    return AlertMessage(
        event=AlertEvent.BACKUP_STALE,
        target=database,
        observed=f'عمر آخر نسخة ناجحة {int(age_seconds)} ثانية',
        threshold=f'RPO {rpo_seconds} ثانية',
        timestamp=timestamp,
    )


def evaluate_disk_usage(*, host: str, used_percent: float, timestamp: datetime,
                        threshold_percent: float = DEFAULT_DISK_USAGE_PERCENT) -> AlertMessage | None:
    """Alert at or above the threshold; below it is silent."""
    _require(0 < threshold_percent <= 100, 'the disk threshold is a percentage between 0 and 100')
    _require(0 <= used_percent <= 100, 'disk usage is a percentage between 0 and 100')
    if used_percent < threshold_percent:
        return None
    return AlertMessage(
        event=AlertEvent.DISK_HIGH,
        target=host,
        observed=f'{used_percent:.1f}% مستخدمة',
        threshold=f'{threshold_percent:.1f}%',
        timestamp=timestamp,
    )


def evaluate_container_health(*, container: str, health: str, timestamp: datetime) -> AlertMessage | None:
    """Alert only for ``unhealthy``; ``starting`` is Docker's own settling window.

    A state Docker does not report is refused rather than read as healthy: a
    container without a healthcheck, or a probe that returned nothing, must not
    look like a passing probe.
    """
    _require(health in DOCKER_HEALTH_STATES,
             f'a container health state is one of {", ".join(sorted(DOCKER_HEALTH_STATES))}')
    if health != DOCKER_UNHEALTHY:
        return None
    return AlertMessage(
        event=AlertEvent.CONTAINER_UNHEALTHY,
        target=container,
        observed=f'الحالة {health}',
        threshold=f'الحالة المطلوبة {DOCKER_HEALTHY}',
        timestamp=timestamp,
    )


def _message_for(args: argparse.Namespace, timestamp: datetime) -> AlertMessage | None:
    """Build the message the subcommand asked for, or ``None`` when its threshold is not met."""
    event = AlertEvent.by_name(args.command)
    if event is AlertEvent.BACKUP_FAILED:
        return backup_failed_message(database=args.database, reason=args.reason, timestamp=timestamp)
    if event is AlertEvent.BACKUP_STALE:
        return evaluate_backup_age(database=args.database, age_seconds=args.age_seconds,
                                   rpo_seconds=args.rpo_seconds, timestamp=timestamp)
    if event is AlertEvent.DISK_HIGH:
        return evaluate_disk_usage(host=args.host, used_percent=args.used_percent,
                                   threshold_percent=args.threshold_percent, timestamp=timestamp)
    if event is AlertEvent.CONTAINER_UNHEALTHY:
        return evaluate_container_health(container=args.container, health=args.health,
                                         timestamp=timestamp)
    if event is AlertEvent.RESTORE_DRILL_FAILED:
        return restore_drill_failed_message(database=args.database, reason=args.reason,
                                            timestamp=timestamp)
    raise AlertError(f'no message is defined for the event {event.value.name!r}')


def _report_payload(message: AlertMessage, report: DeliveryReport,
                    config: AlertConfig) -> dict[str, object]:
    """The run's own record. A withheld message contributes no text of its own."""
    payload: dict[str, object] = {
        'event': message.event.value.name,
        'severity': message.severity.value,
        'alerted': True,
        'channels': {delivery.channel: {'delivered': delivery.delivered, 'error': delivery.error}
                     for delivery in report.deliveries},
        'disabled': {state.channel: state.reason for state in config.states if not state.enabled},
    }
    if report.withheld_reason is None:
        payload['target'] = message.target
        payload['subject'] = message.subject
        payload['body'] = message.body
    else:
        payload['withheld'] = report.withheld_reason
    return payload


def _write_json(payload: dict[str, object]) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False, indent=2) + '\n')


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog='alerts.py',
        description='Send one owner alert for one of the five operational events.',
    )
    commands = parser.add_subparsers(dest='command', required=True)
    failed = commands.add_parser(AlertEvent.BACKUP_FAILED.value.name,
                                 help=AlertEvent.BACKUP_FAILED.value.title)
    failed.add_argument('--database', required=True, help='database the backup was taken from')
    failed.add_argument('--reason', required=True,
                        help='short failure reason, never a path or a secret')
    stale = commands.add_parser(AlertEvent.BACKUP_STALE.value.name,
                                help=AlertEvent.BACKUP_STALE.value.title)
    stale.add_argument('--database', required=True, help='database of the newest good backup')
    stale.add_argument('--age-seconds', type=float, required=True,
                       help='seconds since the newest successful backup')
    stale.add_argument('--rpo-seconds', type=int, default=DEFAULT_BACKUP_RPO_SECONDS,
                       help=f'the RPO in seconds (default {DEFAULT_BACKUP_RPO_SECONDS})')
    disk = commands.add_parser(AlertEvent.DISK_HIGH.value.name, help=AlertEvent.DISK_HIGH.value.title)
    disk.add_argument('--host', required=True, help='host whose filesystem was measured')
    disk.add_argument('--used-percent', type=float, required=True,
                      help='used percentage of the filesystem')
    disk.add_argument('--threshold-percent', type=float, default=DEFAULT_DISK_USAGE_PERCENT,
                      help=f'the alert threshold (default {DEFAULT_DISK_USAGE_PERCENT})')
    unhealthy = commands.add_parser(AlertEvent.CONTAINER_UNHEALTHY.value.name,
                                    help=AlertEvent.CONTAINER_UNHEALTHY.value.title)
    unhealthy.add_argument('--container', required=True, help='container whose health was read')
    unhealthy.add_argument('--health', default=DOCKER_UNHEALTHY,
                           choices=sorted(DOCKER_HEALTH_STATES),
                           help=f'the state Docker reported (default {DOCKER_UNHEALTHY})')
    drill = commands.add_parser(AlertEvent.RESTORE_DRILL_FAILED.value.name,
                                help=AlertEvent.RESTORE_DRILL_FAILED.value.title)
    drill.add_argument('--database', required=True, help='database the restore drill targeted')
    drill.add_argument('--reason', required=True,
                       help='short failure reason, never a path or a secret')
    return parser


def main(argv: list[str] | None = None, *, env: Mapping[str, str] | None = None,
         transports: Transports | None = None, now: datetime | None = None) -> int:
    """Fire one event from the command line; JSON on stdout, never a credential."""
    args = build_parser().parse_args(argv)
    timestamp = now if now is not None else datetime.now(timezone.utc)
    try:
        # The channels are resolved before the event is evaluated, so a
        # misconfigured environment is refused on every run and not only on the
        # day the alert was needed.
        config = AlertConfig.from_environment(env if env is not None else os.environ)
        notifiers = config.build_notifier_set(transports)
        message = _message_for(args, timestamp)
        if message is None:
            _write_json({'event': args.command, 'alerted': False})
            return EXIT_OK
        report = notifiers.notify(message)
    except AlertError as error:
        sys.stderr.write(f'alerts: {error}\n')
        return EXIT_REFUSED

    _write_json(_report_payload(message, report, config))
    try:
        report.raise_for_failures()
    except AlertDeliveryError as error:
        sys.stderr.write(f'alerts: {error}\n')
        return EXIT_DELIVERY_FAILED
    return EXIT_OK


if __name__ == '__main__':
    raise SystemExit(main())
