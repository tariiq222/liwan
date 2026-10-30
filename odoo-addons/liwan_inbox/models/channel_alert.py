# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models

from .health_constants import (
    ALERT_KINDS,
    ALERT_REASON_LENGTH,
    ALERT_SEVERITIES,
    MESSAGING_LIMITS,
    QUALITY_RATINGS,
)


class LiwanInboxChannelAlert(models.Model):
    """One meaningful change of a number's health (quality, limit, name, account), kept as a timeline."""
    _name = 'liwan.inbox.channel.alert'
    _description = 'Customer Inbox channel health alert'
    _order = 'occurred_at desc, id desc'
    # Tenant scope with an owning company, like the channel it belongs to.
    _liwan_scope = 'tenant'

    owner_company_id = fields.Many2one('res.company', required=True, index=True, ondelete='cascade')
    channel_id = fields.Many2one('liwan.inbox.channel', required=True, index=True, ondelete='cascade')
    kind = fields.Selection(ALERT_KINDS, required=True)
    severity = fields.Selection(ALERT_SEVERITIES, required=True)
    occurred_at = fields.Datetime(required=True, default=fields.Datetime.now, index=True)
    quality_rating = fields.Selection(QUALITY_RATINGS)
    messaging_limit = fields.Selection(MESSAGING_LIMITS)
    previous_messaging_limit = fields.Selection(MESSAGING_LIMITS)
    requested_name = fields.Char()
    # Meta's code as received: a rejection reason, a restriction or violation type, an alert type or an error text.
    reason = fields.Char(size=ALERT_REASON_LENGTH)
    expires_at = fields.Datetime()
