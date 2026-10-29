# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models

from .constants import PAID_NOTICE_TEXT, SETTINGS_REFRESH
from odoo.addons.webvue_inbox.models.channel import SECRET_GROUPS
from odoo.addons.webvue_inbox_payments.adapters import meta_catalog

CATALOG_GROUP = 'webvue_inbox_payments.group_cap_inbox_catalog_manage'


class WebVueInboxChannel(models.Model):
    _inherit = 'webvue.inbox.channel'

    # The catalog manager calls Meta with the channel's token, like the template manager.
    access_token_enc = fields.Char(groups=f'{SECRET_GROUPS},{CATALOG_GROUP}')
    # Meta's commerce settings of the phone number (a mirror, read at most every SETTINGS_REFRESH) and its number
    # as customers see it (the click-to-chat link of catalog items).
    commerce_cart_enabled = fields.Boolean()
    commerce_catalog_visible = fields.Boolean()
    commerce_settings_read_at = fields.Datetime()
    commerce_phone = fields.Char()
    # The notice sent to the customer once an order is paid (inside the reply window only).
    paid_notice_enabled = fields.Boolean(default=True)
    paid_notice_text = fields.Char(default=PAID_NOTICE_TEXT)

    def _webvue_catalog(self):
        """The catalog of this channel's WhatsApp account (empty when none is connected)."""
        self.ensure_one()
        return self.env['webvue.inbox.catalog'].search([
            ('business_account_id', '=', self.business_account_id), ('company_id', '=', self.owner_company_id.id),
        ], limit=1)

    def _webvue_catalog_id(self):
        self.ensure_one()
        return self._webvue_catalog().meta_catalog_id or False

    def _webvue_read_commerce(self, force=False):
        """Refresh the mirror of Meta's commerce settings and phone number unless it is recent."""
        self.ensure_one()
        now = fields.Datetime.now()
        if not force and self.commerce_settings_read_at and now - self.commerce_settings_read_at < SETTINGS_REFRESH:
            return
        credentials = self._webvue_credentials()
        settings = meta_catalog.get_commerce_settings(credentials)
        values = {
            'commerce_cart_enabled': settings['cart_enabled'], 'commerce_catalog_visible': settings['catalog_visible'],
            'commerce_settings_read_at': now,
        }
        if not self.commerce_phone:
            values['commerce_phone'] = meta_catalog.get_display_phone(credentials) or False
        self.write(values)
