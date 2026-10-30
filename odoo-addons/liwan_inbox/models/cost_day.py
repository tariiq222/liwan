# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models

PRICING_CATEGORIES = [
    ('authentication', 'Authentication'), ('authentication_international', 'Authentication (international)'),
    ('marketing', 'Marketing'), ('marketing_lite', 'Marketing Lite'), ('service', 'Service'), ('utility', 'Utility'),
    ('referral_conversion', 'Referral conversion'), ('unknown', 'Unknown'),
]
PRICING_TYPES = [
    ('regular', 'Regular'), ('free_customer_service', 'Free customer service'), ('free_entry_point', 'Free entry point'),
    ('unknown', 'Unknown'),
]


class LiwanInboxCostDay(models.Model):
    """Meta's approximate daily volume and cost of a channel's number (UTC days), pulled from the pricing analytics."""
    _name = 'liwan.inbox.cost.day'
    _description = 'Customer Inbox Meta cost per day'
    _order = 'day desc, id'
    # Tenant scope with an owning company, like the channel it belongs to.
    _liwan_scope = 'tenant'

    owner_company_id = fields.Many2one('res.company', required=True, index=True, ondelete='cascade')
    channel_id = fields.Many2one('liwan.inbox.channel', required=True, index=True, ondelete='cascade')
    day = fields.Date(required=True, index=True)
    pricing_category = fields.Selection(PRICING_CATEGORIES, required=True)
    pricing_type = fields.Selection(PRICING_TYPES, required=True)
    country = fields.Char(size=2, required=True)
    volume = fields.Integer()
    # Empty when Meta reports no cost (a Solution Partner credit line).
    cost = fields.Float(digits=(16, 6))
    has_cost = fields.Boolean(default=False)
    synced_at = fields.Datetime(required=True)

    _point_unique = models.Constraint(
        'UNIQUE(channel_id, day, pricing_category, pricing_type, country)', 'A cost row is unique per channel, day, category, type and country.',
    )
