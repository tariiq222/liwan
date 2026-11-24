# Part of Odoo. See LICENSE file for full copyright and licensing details.
import hashlib
import hmac
import re
import secrets
from datetime import timedelta
from typing import NamedTuple

from odoo import api, fields, models
from odoo.exceptions import LockError
from odoo.tools import SQL, escape_psql
from odoo.tools.mail import email_split

from .sms_gateway import SmsDeliveryError

# Every limit of the sign-in code lives here, in one place, so no route repeats a number:
# six digits, five minutes, five attempts, a 60-second resend cooldown, and three send caps: hourly and
# daily per user, and a tenant-wide daily ceiling that only guards the messaging bill.
CODE_LENGTH = 6
CODE_TTL = timedelta(minutes=5)
CODE_ATTEMPTS = 5
RESEND_COOLDOWN = timedelta(seconds=60)
HOURLY_SENDS = 5
USER_DAILY_SENDS = 10
# The tenant ceiling is a multiple of the per-user cap, so one user can never reach it alone.
TENANT_CEILING_USERS = 5
DAILY_SENDS = USER_DAILY_SENDS * TENANT_CEILING_USERS
PURGE_AFTER = timedelta(days=30)
CHANNELS = ('sms', 'email')
# What a code is for: finishing a sign-in, or verifying the mobile number it is sent to. The two purposes
# keep separate budgets, cooldowns and usable codes; only the tenant ceiling is shared (it guards the bill).
PURPOSES = ('signin', 'verify_mobile')
# A code nobody revoked and nobody consumed is the one a user may enter; the newest one wins.
ACTIVE = [('revoked_at', '=', False), ('consumed_at', '=', False)]
# The cooldown follows the newest sent code, consumed or not: a resend inside the minute still waits.
LIVE = [('revoked_at', '=', False)]
# Arabic-Indic and Eastern Arabic-Indic digits, so a code typed on an Arabic keyboard is accepted.
DIGITS = str.maketrans('٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789')
CODE_PATTERN = re.compile(r'^[0-9]{%d}$' % CODE_LENGTH)


def hash_value(raw):
    return hashlib.sha256(raw.encode()).hexdigest()


def normalize_code(value):
    """The six ASCII digits of VALUE, or None when it is not a well-formed code."""
    if not isinstance(value, str):
        return None
    cleaned = re.sub(r'\s', '', value).translate(DIGITS)
    return cleaned if CODE_PATTERN.fullmatch(cleaned) else None


def mask_destination(destination):
    """The destination with its identifying middle hidden: a tel keeps its last three digits, an email its domain."""
    if '@' in destination:
        local, _, domain = destination.partition('@')
        return f'{local[:1]}***@{domain}'
    return f'***{destination[-3:]}'


class IssueOutcome(NamedTuple):
    """What ``_liwan_issue`` answers: the row it wrote, and the refusal code when it wrote none.

    A refusal is an outcome, never an exception: the cooldown counter and the daily-cap alert are
    part of the same transaction as the request, and an exception would roll them back with it.
    """
    record: object
    channel: str
    destination: str
    resend_after: int
    error: str


class LiwanLoginCodeQuota(models.Model):
    """Singleton write fence for sign-in code sends in this tenant database."""
    _name = 'liwan.login.code.quota'
    _description = 'LiwanOS Sign-in Code Quota'
    _liwan_scope = 'tenant'

    def _liwan_lock(self):
        self.ensure_one()
        self.check_access('write')
        # Odoo uses REPEATABLE READ. Mutate the fence row so a contender with an older
        # snapshot retries the whole request before counting newly committed code rows.
        self.env.cr.execute(SQL(
            "UPDATE %s SET write_date = CURRENT_TIMESTAMP AT TIME ZONE 'UTC' WHERE id = %s",
            SQL.identifier(self._table), self.id,
        ))
        self.invalidate_recordset(['write_date'])


class LiwanLoginCode(models.Model):
    """One sign-in code of one user, for one delivery channel.

    Only the SHA-256 of the code is stored; the plain code exists in the sent message and in the
    caller's request, and never in this table. The table is system-only.
    """
    _name = 'liwan.login.code'
    _description = 'LiwanOS Sign-in Code'
    _liwan_scope = 'tenant'
    _order = 'id desc'

    user_id = fields.Many2one('res.users', required=True, ondelete='cascade', index=True)
    purpose = fields.Selection([(value, value.replace('_', ' ')) for value in PURPOSES], required=True, default='signin')
    channel = fields.Selection([('sms', 'SMS'), ('email', 'Email')], required=True)
    destination = fields.Char(required=True)
    code_hash = fields.Char(required=True)
    expires_at = fields.Datetime(required=True)
    consumed_at = fields.Datetime()
    revoked_at = fields.Datetime()
    attempts = fields.Integer(default=0, required=True)
    cooldown_until = fields.Datetime(required=True)

    # -- issuing ---------------------------------------------------------------------------------

    @api.model
    def _liwan_issue(self, user, channel, purpose='signin'):
        """Send a new code of PURPOSE to USER over CHANNEL and return an :class:`IssueOutcome`.

        The user row is locked first, so two overlapping requests for one account run one after the
        other and only the later code stays usable.
        """
        if channel not in CHANNELS or purpose not in PURPOSES or not user.active or user.share:
            return IssueOutcome(self.browse(), channel, '', 0, 'channel_unavailable')
        user.lock_for_update(allow_referencing=True)
        gateway = self.env['liwan.sms.gateway']
        if channel == 'email':
            recipients = email_split(user.email)
            destination = recipients[0] if len(recipients) == 1 else ''
        else:
            destination = user.liwan_mobile
            if purpose == 'signin' and not user.liwan_mobile_verified_at:
                # A number no code has verified is not a sign-in address yet; the pending sign-in falls back to email.
                return IssueOutcome(self.browse(), channel, '', 0, 'channel_unavailable')
        if not destination or (channel == 'sms' and not gateway._liwan_sms_available()):
            return IssueOutcome(self.browse(), channel, '', 0, 'channel_unavailable')
        self.env.ref('liwan_core.login_code_quota')._liwan_lock()
        refusal = self._liwan_send_refusal(user, destination, channel, purpose)
        if refusal:
            return IssueOutcome(self.browse(), channel, '', self._liwan_resend_after(user, purpose), refusal)
        raw = ''.join(secrets.choice('0123456789') for _ in range(CODE_LENGTH))
        self._liwan_revoke_user(user, purpose=purpose)
        now = fields.Datetime.now()
        record = self.create({
            'user_id': user.id,
            'purpose': purpose,
            'channel': channel,
            'destination': destination,
            'code_hash': hash_value(raw),
            'expires_at': now + CODE_TTL,
            'cooldown_until': now + RESEND_COOLDOWN,
        })
        # SMS carries the bare code, the provider's template supplies the wording; email carries the full message.
        message = raw if channel == 'sms' else self._liwan_body(raw, user.lang or 'ar_001')
        try:
            gateway._liwan_send(channel, destination, message)
        except SmsDeliveryError:
            # The row stays so the attempt counts toward every cap, but it is revoked: it must not hold the
            # resend cooldown, or the user could not switch to email at once.
            record.revoked_at = now
            return IssueOutcome(record, channel, '', 0, 'channel_unavailable')
        return IssueOutcome(record, channel, mask_destination(destination), int(RESEND_COOLDOWN.total_seconds()), '')

    @api.model
    def _liwan_send_refusal(self, user, destination, channel, purpose):
        """The refusal code the cooldown or a cap raises for this send, or None when it may go out.

        The cooldown and the per-user and per-destination caps count the codes of one purpose; the
        tenant ceiling counts every send, whatever it is for.
        """
        now = fields.Datetime.now()
        latest = self.search([('user_id', '=', user.id), ('purpose', '=', purpose), *LIVE], limit=1)
        if latest and latest.cooldown_until > now:
            return 'resend_cooldown'
        cutoff = now - timedelta(hours=1)
        if self.search_count([
            ('user_id', '=', user.id), ('purpose', '=', purpose), ('create_date', '>=', cutoff),
        ]) >= HOURLY_SENDS:
            return 'send_limit_reached'
        if self._liwan_user_daily_sends(user, purpose) >= USER_DAILY_SENDS:
            return 'send_limit_reached'
        destination_match = ('destination', '=ilike', escape_psql(destination)) if channel == 'email' else (
            'destination', '=', destination,
        )
        if self.search_count([
            destination_match, ('channel', '=', channel), ('purpose', '=', purpose), ('create_date', '>=', cutoff),
        ]) >= HOURLY_SENDS:
            return 'send_limit_reached'
        if self._liwan_daily_sends() >= DAILY_SENDS:
            self.env['liwan.login.code.alert']._liwan_raise()
            return 'daily_send_cap'
        return None

    @api.model
    def _liwan_daily_sends(self):
        """How many codes went out today, across every user: the ceiling that guards the messaging bill."""
        return self.search_count([('create_date', '>=', self._liwan_midnight())])

    @api.model
    def _liwan_user_daily_sends(self, user, purpose):
        """How many codes of PURPOSE went out to USER today."""
        return self.search_count([
            ('user_id', '=', user.id), ('purpose', '=', purpose), ('create_date', '>=', self._liwan_midnight()),
        ])

    @api.model
    def _liwan_midnight(self):
        return fields.Datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)

    @api.model
    def _liwan_body(self, raw, lang='ar_001'):
        """The message in the recipient's language first, then the other one, as the account links are."""
        ar = f'رمز الدخول إلى ليوان: {raw}'
        en = f'Your LiwanOS sign-in code: {raw}'
        return f'{ar}\n{en}' if lang.startswith('ar') else f'{en}\n{ar}'

    def _liwan_revoke_user(self, user, purpose=None):
        """Revoke every still-usable code of USER (of PURPOSE when given): a new one replaces them."""
        domain = [('user_id', '=', user.id), *LIVE]
        if purpose:
            domain.append(('purpose', '=', purpose))
        return self.search(domain).write({'revoked_at': fields.Datetime.now()})

    @api.model
    def _liwan_resend_after(self, user, purpose='signin'):
        """The seconds left of the cooldown of USER's codes of PURPOSE, 0 when a resend may go out now."""
        latest = self.search([
            ('user_id', '=', user.id), ('purpose', '=', purpose), *LIVE,
        ], limit=1)
        if not latest:
            return 0
        remaining = (latest.cooldown_until - fields.Datetime.now()).total_seconds()
        return max(0, int(remaining + 0.999))

    # -- verifying ------------------------------------------------------------------------------

    @api.model
    def _liwan_verify(self, user, value, purpose='signin'):
        """Consume the newest usable code of USER for VALUE of PURPOSE.

        Returns None on success and the refusal code otherwise. A wrong attempt is counted in the
        caller's transaction (no exception, so it survives), and the last allowed one burns the code.
        """
        code = normalize_code(value)
        if code is None:
            return 'invalid_code_format'
        record = self.search([
            ('user_id', '=', user.id), ('purpose', '=', purpose), *ACTIVE,
        ], limit=1)
        if not record or record.expires_at <= fields.Datetime.now():
            return 'invalid_code'
        try:
            # One attempt at a time per code: parallel guesses would otherwise all read the same count.
            record.lock_for_update()
        except LockError:
            # Another attempt on this code is in flight; this one is refused without being compared.
            return 'invalid_code'
        if not hmac.compare_digest(record.code_hash, hash_value(code)):
            record.attempts += 1
            if record.attempts >= CODE_ATTEMPTS:
                # A spent code cannot be guessed any further: the next sign-in sends a fresh one.
                record.revoked_at = fields.Datetime.now()
            return 'invalid_code'
        record.consumed_at = fields.Datetime.now()
        return None

    @api.model
    def _liwan_purge(self):
        """Cron: delete the codes consumed or revoked more than 30 days ago."""
        cutoff = fields.Datetime.now() - PURGE_AFTER
        self.search([
            '|', ('consumed_at', '<', cutoff), ('revoked_at', '<', cutoff),
        ]).unlink()
