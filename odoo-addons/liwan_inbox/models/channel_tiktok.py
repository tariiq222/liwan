# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The TikTok account behind one `liwan.inbox.channel` of kind `tiktok`.

The channel is keyed by the business account's own `open_id` (`tiktok_business_id`), which every
webhook delivery names as `user_openid`. The TikTok app key, app secret and redirect URI are
operator configuration (`adapters/tiktok.py: app_config`); a channel stores only its own tokens,
encrypted with `secret_box`.
"""
from odoo import api, fields, models
from odoo.exceptions import ValidationError

from .channel import SECRET_GROUPS


class LiwanInboxChannel(models.Model):
    _inherit = 'liwan.inbox.channel'

    # The business account identity (D2): unique, and the routing key of its webhook deliveries.
    tiktok_business_id = fields.Char(copy=False)
    tiktok_username = fields.Char(copy=False)
    refresh_token_enc = fields.Char(groups=SECRET_GROUPS, copy=False)
    token_expires_at = fields.Datetime(copy=False)
    refresh_expires_at = fields.Datetime(copy=False)
    # The account's own welcome message (D10): TikTok holds its content and its audit status.
    tiktok_welcome_id = fields.Char(copy=False)
    tiktok_welcome_audit = fields.Selection(
        [('reviewing', 'Reviewing'), ('approved', 'Approved'), ('rejected', 'Rejected')], copy=False,
    )
    # Whether the shared relay holds this account's binding (D13); only the shared SaaS topology has one.
    tiktok_bound = fields.Boolean(default=False, copy=False)

    _tiktok_business_id_unique = models.Constraint(
        'UNIQUE(tiktok_business_id)', 'This TikTok business account is already connected.',
    )

    @api.constrains('kind', 'tiktok_business_id')
    def _check_tiktok_business_id(self):
        for channel in self.filtered(lambda channel: channel.kind == 'tiktok'):
            if not channel.tiktok_business_id:
                raise ValidationError(self.env._('A TikTok channel needs the business account open id.'))
