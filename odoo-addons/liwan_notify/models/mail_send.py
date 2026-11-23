# Part of Odoo. See LICENSE file for full copyright and licensing details.
import logging
from datetime import datetime, time, timedelta, timezone
from email.utils import make_msgid
from math import ceil
from zoneinfo import ZoneInfo

from markupsafe import Markup

from odoo import api, fields, models
from odoo.exceptions import ValidationError
from odoo.fields import Command

from .mail_domain import LiwanMailRefused
from .mail_mail import (
    CHUNK_BYTES,
    DAILY_CEILING,
    DAILY_CEILING_PARAM,
    MAX_ENCODED_BYTES,
    MAX_RECIPIENTS,
    MINUTE_CEILING,
    MINUTE_CEILING_PARAM,
)
from odoo.addons.liwan_platform.models.usage_window import BILLING_TIMEZONE

_logger = logging.getLogger(__name__)
# One advisory lock key per database for the slot choice (pg advisory locks are scoped to the database).
SLOT_LOCK_KEY = 0x6C69_7761  # 'liwa'
# The settings card shows today's usage from this share of the daily ceiling (spec 5.7).
NEAR_CEILING_SHARE = 0.9


class LiwanMailSend(models.AbstractModel):
    """The one way tenant business mail leaves: a ``mail.mail`` row with our ``Message-Id``, then the stock send.

    The row is the queue, the failure record and the link to the business document. The caller needs no
    outgoing-mail right: the contract creates and counts the rows in one elevated environment
    (``_liwan_outbox``) and nothing else here elevates. The sender is never taken from the caller.

    Caller gate: the contract checks nothing about the caller's right to the business record or to the
    application feature. Every caller must have checked both before calling, and no route may pass a
    client-supplied ``model``, ``res_id``, sender or raw HTML.
    """
    _name = 'liwan.mail.send'
    _description = 'LiwanOS tenant business mail'
    _liwan_scope = 'global'

    @api.model
    def _liwan_outbox(self):
        """``mail.mail`` in the elevated environment; only the outgoing-mail ACL (administrators) blocks create and count."""
        return self.env['mail.mail'].sudo()

    @api.model
    def _liwan_sender(self):
        """The From address of tenant mail, decided on the server and never taken from a caller.

        Where the domain provider is configured it is ``"<Company name>" <local@verified-domain>`` from the tenant's
        ``liwan.mail.domain``, and a ``LiwanMailRefused`` (``mail_domain_unverified`` or ``mail_paused``) when that
        domain may not send. Where it is not configured (``non_saas``, or an installation without OCI) it is the
        operator's sender, or ``None`` when none is configured (spec 5.6).
        """
        domains = self.env['liwan.mail.domain']
        if not domains._liwan_provider_configured():
            return self.env['liwan.outbound.mail']._liwan_sender()
        return domains._liwan_tenant_domain()._liwan_sender()

    @api.model
    def _liwan_sender_or_refusal(self):
        """``(sender, None)``, or ``(None, refusal)`` when the tenant may not send now."""
        try:
            return self._liwan_sender(), None
        except LiwanMailRefused as refusal:
            return None, refusal

    @api.model
    def _liwan_lock_slots(self):
        """Serialise slot selection in this database until the transaction ends, so two sends cannot take one slot."""
        self.env.cr.execute('SELECT pg_advisory_xact_lock(%s)', [SLOT_LOCK_KEY])

    @api.model
    def _liwan_send(
        self, model, res_id, kind, recipients, subject, body, attachments=(), download_link=None, sensitive=False,
    ):
        """Queue one tenant email about ``model``/``res_id`` and send it after the commit; return its row (unelevated).

        ``body`` is HTML and ``attachments`` are ``(name, bytes)`` pairs. Recipients are deduplicated ignoring case
        and at most ``MAX_RECIPIENTS``. Over ``MAX_ENCODED_BYTES`` nothing is attached: the caller must then pass
        ``download_link`` (``https://``, or this instance's own base URL), which is appended to the body. With no sender
        configured nothing is queued and an empty recordset comes back; a tenant domain that may not send raises
        ``LiwanMailRefused`` and nothing is created. A ceiling defers the row (``scheduled_date``), never refuses it.
        Every row is kept for 90 days. A ``sensitive`` row (payroll) loses its body and attachments as soon as it can
        no longer be sent (sent, cancelled, or failed for good: a non-transient failure or the attempts exhausted; the retry cron sweeps rows a dropped relay session left behind),
        and keeps its weight, so it still counts toward the ceilings. While a retry may still come it keeps them.

        Caller gate: nothing here checks the caller's right to the record or the application feature; the caller
        must have checked both, and no route may pass a client-supplied ``model``, ``res_id``, sender or raw HTML.
        """
        sender = self._liwan_sender()
        if not sender:
            _logger.warning('tenant mail %s skipped: no sender address is configured', kind)
            return self.env['mail.mail']
        addresses = self._liwan_addresses(recipients)
        self._liwan_check_link(download_link)
        body, attachments = self._liwan_fit_size(body, attachments, download_link)
        weight = len(addresses) * max(ceil(self._liwan_encoded_size(body, attachments) / CHUNK_BYTES), 1)
        outbox = self._liwan_outbox()
        self._liwan_lock_slots()
        moment = self._liwan_slot(weight, fields.Datetime.now(), outbox.browse())
        mail = outbox.create({
            'model': model,
            'res_id': res_id,
            'subject': subject,
            'body_html': body,
            'email_from': sender,
            'email_to': ', '.join(addresses),
            'author_id': self.env.user.partner_id.id,
            'message_id': make_msgid(domain=sender.rsplit('@', 1)[-1].rstrip('>')),
            'auto_delete': False,
            'liwan_sensitive': sensitive,
            'scheduled_date': moment,
            'liwan_kind': kind,
            'liwan_attempts': 1,
            'liwan_weight': weight,
            'attachment_ids': [Command.create({'name': name, 'raw': data}) for name, data in attachments],
        })
        if moment > fields.Datetime.now():
            outbox.env.ref('mail.ir_cron_mail_scheduler_action')._trigger(at=moment + timedelta(seconds=59))
        else:
            mail.send_after_commit()
        return mail.with_env(self.env)

    @api.model
    def _liwan_addresses(self, recipients):
        """The recipients without blanks and without case-insensitive duplicates, in order; refuse none or too many."""
        seen = {}
        for address in recipients:
            address = (address or '').strip()
            if address:
                seen.setdefault(address.casefold(), address)
        if not seen:
            raise ValidationError(self.env._('The email has no recipient.'))
        if len(seen) > MAX_RECIPIENTS:
            raise ValidationError(self.env._('An email goes to at most %(limit)s recipients.', limit=MAX_RECIPIENTS))
        return list(seen.values())

    @api.model
    def _liwan_check_link(self, download_link):
        if not download_link:
            return
        own_base = f'{(self.env.user.get_base_url() or "").rstrip("/")}/'
        if not (download_link.startswith(('https://', own_base))):
            raise ValidationError(self.env._('The download link must start with https://.'))

    @api.model
    def _liwan_fit_size(self, body, attachments, download_link):
        """``(body, attachments)`` that fit the size rule: attachments become ``download_link`` in the body when they do not."""
        attachments = tuple(attachments)
        if not attachments:
            return body, attachments
        if self._liwan_encoded_size(body, attachments) <= MAX_ENCODED_BYTES:
            return body, attachments
        if not download_link:
            raise ValidationError(self.env._('The attachments are too large to email: a download link is required.'))
        return Markup('{}<p><a href="{}">{}</a></p>').format(Markup(body), download_link, download_link), ()

    @api.model
    def _liwan_encoded_size(self, body, attachments):
        """The size of the message as sent: the body plus each attachment in base64."""
        return len(str(body).encode()) + sum(4 * ceil(len(data) / 3) for _name, data in attachments)

    @api.model
    def _liwan_usage(self):
        """Today's weight against the daily ceiling, and the rows waiting for a later moment (the settings card)."""
        ceiling = self._liwan_ceiling(DAILY_CEILING_PARAM, DAILY_CEILING)
        now = fields.Datetime.now()
        start, end = self._liwan_day_bounds(now, self._liwan_zone())
        today = self._liwan_load(self._liwan_outbox().browse(), start, end)
        deferred = self._liwan_outbox().search_count([
            ('liwan_kind', '!=', False), ('state', '=', 'outgoing'), ('scheduled_date', '>', now),
        ])
        return {
            'today': today,
            'ceiling': ceiling,
            'near_ceiling': bool(ceiling) and today >= ceiling * NEAR_CEILING_SHARE,
            'deferred': deferred,
        }

    @api.model
    def _liwan_ceiling(self, param, default):
        """The ceiling from its parameter, read through the cached accessor an ordinary caller may use.

        A value that is not a whole number of 0 or more is a configuration error, raised as the layer's
        ``ValidationError`` (as the registry checks of this addon do) and naming the parameter.
        """
        value = self.env['ir.config_parameter']._get_param(param)
        if value is None:
            return default
        if not (value.isascii() and value.isdigit()):
            raise ValidationError(self.env._(
                'liwan_notify: the parameter %(param)s must be a whole number of 0 or more (0 turns the ceiling off).',
                param=param,
            ))
        return int(value)

    @api.model
    def _liwan_zone(self):
        """The tenant's timezone: the root company's, else the platform default (Asia/Riyadh)."""
        root = self.env['liwan.entitlement.service']._liwan_profile().root_company_id
        return ZoneInfo(root.partner_id.tz or BILLING_TIMEZONE)

    @api.model
    def _liwan_day_bounds(self, moment, zone):
        """``(start, end)``, naive UTC, of the tenant's calendar day that contains ``moment``."""
        local = moment.replace(tzinfo=timezone.utc).astimezone(zone)
        start = datetime.combine(local.date(), time(), tzinfo=zone)
        end = datetime.combine(local.date() + timedelta(days=1), time(), tzinfo=zone)
        return tuple(edge.astimezone(timezone.utc).replace(tzinfo=None) for edge in (start, end))

    @api.model
    def _liwan_load(self, exclude, start, end):
        """The billed weight of the other contract rows that leave in ``[start, end)``, summed by the database."""
        [(total,)] = self._liwan_outbox()._read_group(
            [
                ('liwan_kind', '!=', False),
                ('state', '!=', 'cancel'),
                ('id', 'not in', exclude.ids),
                ('scheduled_date', '>=', start),
                ('scheduled_date', '<', end),
            ],
            aggregates=['liwan_weight:sum'],
        )
        return total or 0

    @api.model
    def _liwan_slot(self, weight, earliest, exclude):
        """The first moment from ``earliest`` that a row of ``weight`` may leave without passing a ceiling.

        ``exclude`` is the row itself when it already exists (a retry). An empty window always takes the row, so a
        message heavier than a ceiling still leaves.
        """
        daily = self._liwan_ceiling(DAILY_CEILING_PARAM, DAILY_CEILING)
        per_minute = self._liwan_ceiling(MINUTE_CEILING_PARAM, MINUTE_CEILING)
        zone = self._liwan_zone()
        moment = earliest
        while True:
            day_start, day_end = self._liwan_day_bounds(moment, zone)
            load = self._liwan_load(exclude, day_start, day_end)
            if daily and load and load + weight > daily:
                moment = day_end
                continue
            minute = moment.replace(second=0, microsecond=0)
            load = self._liwan_load(exclude, minute, minute + timedelta(minutes=1))
            if per_minute and load and load + weight > per_minute:
                moment = minute + timedelta(minutes=1)
                continue
            return moment
