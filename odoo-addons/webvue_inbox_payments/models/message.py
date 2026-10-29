# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models
from odoo.exceptions import ValidationError


class WebVueInboxMessage(models.Model):
    _inherit = 'webvue.inbox.message'

    @api.model
    def _webvue_sendable_items(self, channel, retailer_ids):
        """The items of the channel's catalog the composer may send: listed, in Meta's catalog and not rejected."""
        catalog = channel._webvue_catalog()
        return self.env['webvue.inbox.catalog.item'].search([
            ('catalog_id', '=', catalog.id), ('retailer_id', 'in', list(retailer_ids)), ('listed', '=', True),
            ('sync_state', '=', 'synced'), ('review_status', '!=', 'rejected'),
        ]) if catalog else self.env['webvue.inbox.catalog.item']

    @api.model
    def _webvue_check_commerce(self, channel, retailer_ids):
        if not self.env['webvue.inbox.catalog']._webvue_enabled():
            raise ValidationError(self.env._('The product catalog is not included in the plan.'))
        unknown = sorted(set(retailer_ids) - set(self._webvue_sendable_items(channel, retailer_ids).mapped('retailer_id')))
        if unknown:
            raise ValidationError(self.env._('These products cannot be sent from the catalog: %(ids)s', ids=', '.join(unknown)))

    @api.model
    def _webvue_commerce_titles(self, channel, retailer_ids):
        items = self.env['webvue.inbox.catalog.item'].search([
            ('catalog_id', '=', channel._webvue_catalog().id), ('retailer_id', 'in', list(retailer_ids)),
        ])
        return {item.retailer_id: item.name for item in items}

    @api.model
    def _webvue_commerce_products(self, channel, retailer_ids):
        catalog = channel._webvue_catalog()
        items = self.env['webvue.inbox.catalog.item'].search([
            ('catalog_id', '=', catalog.id), ('retailer_id', 'in', list(retailer_ids)),
        ])
        return {item.retailer_id: {
            'catalog_item_id': item.id, 'name': item.name, 'price': item.price, 'currency': item.currency,
            'availability': item.availability, 'image_url': item.image_url or None,
        } for item in items}

    def _webvue_commerce_order_summary(self):
        self.ensure_one()
        order = self.env['webvue.inbox.order'].search([('message_id', '=', self.id)], limit=1)
        if not order:
            return None
        return {
            'id': order.id, 'state': order.state, 'reference': order.reference or None,
            'payment_status': order._webvue_payment_status(),
        }

    def _webvue_on_ingested(self):
        super()._webvue_on_ingested()
        if self.kind == 'order' and self.env['webvue.inbox.catalog']._webvue_enabled():
            self.env['webvue.inbox.order']._webvue_from_cart(self)
