# Part of Odoo. See LICENSE file for full copyright and licensing details.
import base64
import hashlib
import json
import secrets

from odoo import api, fields, models
from odoo.exceptions import ValidationError

from .catalog import is_https_url
from .catalog_image import inspect_image
from .constants import (
    IMAGE_PATH,
    MAX_PRODUCT_DESCRIPTION,
    MAX_PRODUCT_NAME,
    MIN_IMAGE_SIDE,
    RETAILER_ID,
)

AVAILABILITY = [('in_stock', 'In stock'), ('out_of_stock', 'Out of stock')]
META_AVAILABILITY = {'in_stock': 'in stock', 'out_of_stock': 'out of stock'}
SYNC_STATES = [
    ('pending', 'Pending'), ('syncing', 'Syncing'), ('synced', 'Synced'), ('error', 'Error'), ('removing', 'Removing'),
]
REVIEW_STATUSES = [('pending', 'Pending'), ('approved', 'Approved'), ('rejected', 'Rejected'), ('unknown', 'Unknown')]
ERROR_TEXT_LENGTH = 200


def new_image_token():
    return secrets.token_urlsafe(24)


class LiwanInboxCatalogItem(models.Model):
    """A product listed in a Meta catalog. The product stays the one source of the name, price and image."""
    _name = 'liwan.inbox.catalog.item'
    _description = 'Customer Inbox catalog item'
    _order = 'id'
    _liwan_scope = 'company'

    catalog_id = fields.Many2one('liwan.inbox.catalog', required=True, index=True, ondelete='cascade')
    company_id = fields.Many2one(related='catalog_id.company_id', store=True, index=True)
    active = fields.Boolean(default=True)
    product_id = fields.Many2one('product.product', required=True, index=True, ondelete='restrict')
    # Meta's `retailer_id` ("Content ID"): the product's internal reference when it fits, else `wv-<product id>`.
    retailer_id = fields.Char(required=True)
    listed = fields.Boolean(default=True)
    availability = fields.Selection(AVAILABILITY, required=True, default='in_stock')
    link_override = fields.Char()
    sync_state = fields.Selection(SYNC_STATES, required=True, default='pending', index=True)
    sync_error = fields.Char()
    # The hash of the data Meta holds; of the data in flight; the batch carrying it.
    synced_hash = fields.Char()
    pushed_hash = fields.Char()
    batch_handle = fields.Char(index=True)
    review_status = fields.Selection(REVIEW_STATUSES, required=True, default='pending')
    review_reason = fields.Char()
    reviewed_at = fields.Datetime()
    last_synced_at = fields.Datetime()
    image_token = fields.Char(required=True, default=lambda self: new_image_token(), copy=False)

    name = fields.Char(compute='_compute_content')
    description = fields.Char(compute='_compute_content')
    price = fields.Float(compute='_compute_price', digits=(16, 2))
    currency = fields.Char(compute='_compute_price')
    link = fields.Char(compute='_compute_link')
    image_url = fields.Char(compute='_compute_image_url')

    _product_unique = models.Constraint(
        'UNIQUE(catalog_id, product_id)', 'A product is listed once in a catalog.',
    )
    _retailer_unique = models.Constraint(
        'UNIQUE(catalog_id, retailer_id)', 'A product id (retailer id) is used once in a catalog.',
    )

    @api.constrains('retailer_id', 'link_override')
    def _check_values(self):
        for item in self:
            if not RETAILER_ID.match(item.retailer_id or ''):
                raise ValidationError(self.env._('The product id may contain only letters, digits, dot, underscore and dash (1 to 100).'))
            if item.link_override and not is_https_url(item.link_override):
                raise ValidationError(self.env._('The product link must be an https address.'))

    @api.model_create_multi
    def create(self, vals_list):
        items = super().create(vals_list)
        items.catalog_id._liwan_request_sync()
        return items

    def write(self, vals):
        if 'retailer_id' in vals and any(item.retailer_id != vals['retailer_id'] and item._liwan_retailer_locked() for item in self):
            raise ValidationError(self.env._('The product id cannot change once the product was sent to Meta.'))
        result = super().write(vals)
        if {'listed', 'availability', 'link_override', 'product_id', 'active'} & set(vals):
            self._liwan_reset_sync()
        return result

    def _liwan_retailer_locked(self):
        """Whether the product id was, or is being, sent to Meta: it can no longer change."""
        self.ensure_one()
        return bool(self.last_synced_at or self.synced_hash or self.pushed_hash or self.sync_state == 'syncing')

    def _liwan_orderable(self):
        """Whether a cart or an agent may put this item in an order: listed in the catalog and not rejected by Meta."""
        self.ensure_one()
        return bool(self) and self.active and self.listed and self.review_status != 'rejected'

    def _liwan_reset_sync(self):
        """After a change that reaches Meta: unlisted and deleted items are removed there, the others resent.

        An item whose batch is still open keeps its state: a change is compared with what was pushed once the batch
        settles, and a removal waits for it, because the batch may still create the item at Meta.
        """
        for item in self:
            in_flight = item.sync_state == 'syncing'
            if not item.listed or not item.active:
                state = 'removing' if item.synced_hash or in_flight else 'synced'
            else:
                state = 'syncing' if in_flight else 'pending'
            if item.sync_state != state:
                item.sync_state = state
        self.catalog_id._liwan_request_sync()

    @api.model
    def _liwan_default_retailer_id(self, catalog, product):
        """The product's internal reference when it is a valid id unused in the catalog, else `wv-<product id>`."""
        code = product.default_code
        taken = self.with_context(active_test=False).search_count([('catalog_id', '=', catalog.id), ('retailer_id', '=', code)])
        return code if code and RETAILER_ID.match(code) and not taken else f'wv-{product.id}'

    @api.model
    def _liwan_product_changed(self, product_ids, image_changed):
        """Mark the items of changed products for resync; a changed image gets a new public address.

        Plain SQL on this model's own table: whoever edits a product (any product writer) may hold no right on items.
        """
        self.flush_model()
        self.env.cr.execute(
            "SELECT id FROM liwan_inbox_catalog_item WHERE product_id IN %s AND listed AND active", [tuple(product_ids) or (0,)],
        )
        ids = [row[0] for row in self.env.cr.fetchall()]
        if not ids:
            return
        self.env.cr.execute(
            "UPDATE liwan_inbox_catalog_item SET sync_state = 'pending' WHERE id IN %s AND sync_state IN ('synced', 'error')",
            [tuple(ids)],
        )
        if image_changed:
            for item_id in ids:
                self.env.cr.execute('UPDATE liwan_inbox_catalog_item SET image_token = %s WHERE id = %s', [new_image_token(), item_id])
        self.invalidate_model(['sync_state', 'image_token'])
        self.browse(ids).catalog_id._liwan_request_sync()

    # content

    @api.depends('product_id')
    def _compute_content(self):
        for item in self:
            product = item.product_id
            item.name = product.with_context(display_default_code=False).display_name[:MAX_PRODUCT_NAME]
            item.description = (product.description_sale or item.name)[:MAX_PRODUCT_DESCRIPTION]

    @api.depends('product_id', 'catalog_id.prices_include_tax')
    def _compute_price(self):
        for item in self:
            item.currency = item.catalog_id.company_id.currency_id.name
            item.price = item._liwan_price()

    def _liwan_price(self):
        """The unit price the catalog shows: the list price with or without taxes as the catalog says."""
        self.ensure_one()
        company = self.catalog_id.company_id
        product = self.product_id
        taxes = product.taxes_id.filtered(lambda tax: tax.company_id == company)
        totals = taxes.compute_all(product.lst_price, currency=company.currency_id, quantity=1.0, product=product)
        return totals['total_included' if self.catalog_id.prices_include_tax else 'total_excluded']

    @api.depends('link_override', 'catalog_id.default_link')
    def _compute_link(self):
        for item in self:
            item.link = item.link_override or item.catalog_id.default_link or item.catalog_id._liwan_whatsapp_link()

    @api.depends('image_token')
    def _compute_image_url(self):
        for item in self:
            item.image_url = f'{item.catalog_id.get_base_url()}{IMAGE_PATH}/{item.id}/{item.image_token}' if item.id else False

    def _liwan_group_id(self):
        """The id Meta groups the variants of one template by (none for a product with a single variant)."""
        template = self.product_id.product_tmpl_id
        return f'wv-t{template.id}' if template.product_variant_count > 1 else None

    def _liwan_payload(self):
        """The item as Meta's `items_batch` takes it."""
        self.ensure_one()
        payload = {
            'id': self.retailer_id, 'title': self.name, 'description': self.description,
            'availability': META_AVAILABILITY[self.availability], 'condition': 'new',
            'price': f'{self.price:.2f} {self.currency}', 'link': self.link, 'image_link': self.image_url,
            'brand': self.catalog_id.brand,
        }
        group = self._liwan_group_id()
        return {**payload, 'item_group_id': group} if group else payload

    def _liwan_payload_hash(self):
        return hashlib.sha256(json.dumps(self._liwan_payload(), sort_keys=True).encode()).hexdigest()

    def _liwan_image_info(self):
        """(width, height) of the product image Meta will fetch, or None when the product has none."""
        self.ensure_one()
        raw = self.product_id.image_1024
        info = inspect_image(base64.b64decode(raw)) if raw else None
        return (info[1], info[2]) if info else None

    @api.model
    def _liwan_check_product_image(self, product):
        """The reason a product's image cannot be listed, or None when it can."""
        raw = product.image_1024
        info = inspect_image(base64.b64decode(raw)) if raw else None
        if not info:
            return self.env._('The product needs an image.')
        if min(info[1], info[2]) < MIN_IMAGE_SIDE:
            return self.env._('The product image must be at least %(side)s x %(side)s pixels.', side=MIN_IMAGE_SIDE)
        return None

    def _liwan_batch_failed(self, reason):
        """The batch of this item failed: an item that waited for it is shown as failed, one changed meanwhile keeps its state."""
        self.ensure_one()
        values = {'batch_handle': False}
        if self.sync_state == 'syncing':
            values.update({'sync_state': 'error', 'sync_error': reason})
        self.write(values)

    def _liwan_batch_confirmed(self, now):
        """Meta confirmed the batch of this item: record what Meta now holds and settle the state."""
        self.ensure_one()
        deleted = not self.pushed_hash
        values = {'batch_handle': False, 'sync_error': False}
        if deleted:
            values['synced_hash'] = False
        else:
            values.update({'synced_hash': self.pushed_hash, 'last_synced_at': now, 'review_status': 'pending',
                           'review_reason': False, 'reviewed_at': False})
        self.write(values)
        if self.sync_state != 'syncing':
            return  # changed while the batch was open (removed, relisted): its own state decides what is sent next
        if deleted:
            self._liwan_removed()
        else:
            self.sync_state = 'synced' if self._liwan_payload_hash() == self.pushed_hash else 'pending'

    def _liwan_removed(self):
        """Meta no longer holds this item: a deleted one is dropped here too, an unlisted one stays, off Meta."""
        for item in self:
            if item.active:
                item.write({'sync_state': 'synced', 'synced_hash': False, 'batch_handle': False, 'sync_error': False})
            else:
                item.unlink()

    def _liwan_request(self):
        """The `items_batch` request that brings Meta in line with this item, or None when Meta already is.

        An item with nothing to send is settled here: an unlisted one never sent, a removal of an item Meta never had,
        and a save that changed nothing Meta shows (the hash of the data is unchanged).
        """
        self.ensure_one()
        if self.batch_handle:
            return None  # a batch is still open for this item: the next run settles it first
        if self.sync_state == 'removing':
            if self.synced_hash:
                self.pushed_hash = False
                return {'method': 'DELETE', 'data': {'id': self.retailer_id}}
            self._liwan_removed()
            return None
        if not self.listed or not self.active:
            self.sync_state = 'synced'
            return None
        digest = self._liwan_payload_hash()
        if digest == self.synced_hash:
            self.sync_state = 'synced'
            return None
        self.pushed_hash = digest
        return {'method': 'UPDATE' if self.synced_hash else 'CREATE', 'data': self._liwan_payload()}

    def _liwan_delete(self):
        """Delete the item: at once when Meta never had it, else once Meta's DELETE went through (after an open batch settled)."""
        for item in self:
            if item.synced_hash or item.sync_state == 'syncing':
                item.active = False
            else:
                item.unlink()
