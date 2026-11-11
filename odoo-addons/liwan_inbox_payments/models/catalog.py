# Part of Odoo. See LICENSE file for full copyright and licensing details.
from urllib.parse import urlsplit

from odoo import api, fields, models
from odoo.exceptions import ValidationError

from .constants import CATALOG_FEATURE, MAX_BRAND, META_ID, SYNC_CRON


def is_https_url(value):
    try:
        parts = urlsplit(value)
    except ValueError:
        return False
    return parts.scheme == 'https' and bool(parts.hostname) and not any(char.isspace() for char in value) and len(value) <= 2000


class LiwanInboxCatalog(models.Model):
    """The Meta commerce catalog of a WhatsApp Business Account; every phone number of the account shares it."""
    _name = 'liwan.inbox.catalog'
    _description = 'Customer Inbox product catalog'
    _order = 'id'
    _liwan_scope = 'company'

    company_id = fields.Many2one('res.company', required=True, index=True, ondelete='cascade',
                                 default=lambda self: self.env.company)
    business_account_id = fields.Char(required=True)
    meta_catalog_id = fields.Char(required=True)
    name = fields.Char()
    state = fields.Selection([('connected', 'Connected'), ('error', 'Error')], required=True, default='connected')
    last_error = fields.Char()
    brand = fields.Char(required=True)
    # The product page link Meta requires; empty sends the click-to-chat link of the WhatsApp number.
    default_link = fields.Char()
    prices_include_tax = fields.Boolean(default=True)
    last_sync_at = fields.Datetime()
    item_ids = fields.One2many('liwan.inbox.catalog.item', 'catalog_id')

    _business_account_unique = models.Constraint(
        'UNIQUE(business_account_id)', 'A WhatsApp business account has one catalog.',
    )

    @api.constrains('meta_catalog_id', 'brand', 'default_link')
    def _check_values(self):
        for catalog in self:
            if not META_ID.match(catalog.meta_catalog_id or ''):
                raise ValidationError(self.env._('The catalog id must be 5 to 32 digits.'))
            if not 1 <= len((catalog.brand or '').strip()) <= MAX_BRAND:
                raise ValidationError(self.env._('The brand is 1 to %(max)s characters.', max=MAX_BRAND))
            if catalog.default_link and not is_https_url(catalog.default_link):
                raise ValidationError(self.env._('The product link must be an https address.'))

    @api.constrains('business_account_id', 'company_id')
    def _check_channels_company(self):
        for catalog in self:
            self.env.cr.execute(
                'SELECT 1 FROM liwan_inbox_channel WHERE business_account_id = %s AND owner_company_id != %s LIMIT 1',
                [catalog.business_account_id, catalog.company_id.id],
            )
            if self.env.cr.fetchone():
                raise ValidationError(self.env._('Every phone number of the WhatsApp account must belong to the catalog company.'))

    @api.model_create_multi
    def create(self, vals_list):
        catalogs = super().create(vals_list)
        catalogs._liwan_request_sync()
        return catalogs

    def write(self, vals):
        result = super().write(vals)
        if {'brand', 'default_link', 'prices_include_tax'} & set(vals):
            self._liwan_mark_all_pending()
        return result

    @api.model
    def _liwan_enabled(self):
        """Whether the tenant's plan includes the catalog: without it nothing is sent, ingested or synced (carts stay messages)."""
        return self.env['liwan.entitlement.service']._liwan_feature_write(CATALOG_FEATURE)

    def _liwan_channels(self):
        """The channels (phone numbers) of this catalog's WhatsApp account that the caller reaches."""
        self.ensure_one()
        return self.env['liwan.inbox.channel'].search([
            ('business_account_id', '=', self.business_account_id), ('owner_company_id', '=', self.company_id.id),
        ])

    def _liwan_usable_channel(self):
        """The first channel of the account that can call Meta (the numbers of an account share one business token)."""
        self.ensure_one()
        return self._liwan_channels().filtered(lambda channel: channel.state != 'disabled' and channel.access_token_enc)[:1]

    def _liwan_credentials(self):
        channel = self._liwan_usable_channel()
        return channel._liwan_credentials() if channel else None

    def _liwan_mark_all_pending(self):
        """Resync every listed item (brand, link or tax mode changed, or the owner asked for it)."""
        self.item_ids.filtered(lambda item: item.listed and item.sync_state != 'removing').write({'sync_state': 'pending'})
        self._liwan_request_sync()

    def _liwan_request_sync(self):
        """Ask the cron worker to run the sync now."""
        cron_id = self.env['ir.model.data']._xmlid_to_res_id(SYNC_CRON)
        self.env['ir.cron'].browse(cron_id)._trigger()

    def _liwan_whatsapp_link(self):
        """The product page link of an item with none of its own: click-to-chat with the account's number."""
        self.ensure_one()
        phone = next((channel.commerce_phone for channel in self._liwan_channels() if channel.commerce_phone), None)
        return f'https://wa.me/{phone}' if phone else self.get_base_url()

    def _liwan_counts(self):
        items = self.item_ids
        return {
            'items': len(items),
            'synced': len(items.filtered(lambda item: item.sync_state == 'synced')),
            'pending': len(items.filtered(lambda item: item.sync_state in ('pending', 'syncing', 'removing'))),
            'error': len(items.filtered(lambda item: item.sync_state == 'error')),
            'rejected': len(items.filtered(lambda item: item.review_status == 'rejected')),
        }
