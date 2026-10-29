# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Wire shapes of catalogs, catalog items and channel commerce (packages/contracts/src/inbox/catalog.ts)."""
from odoo.addons.webvue_api.serializers.common import iso
from odoo.addons.webvue_inbox.serializers.conversation import dump_ref


def dump_catalog(catalog):
    return {
        'id': catalog.id,
        'business_account_id': catalog.business_account_id,
        'meta_catalog_id': catalog.meta_catalog_id,
        'name': catalog.name or '',
        'state': catalog.state,
        'last_error': catalog.last_error or None,
        'brand': catalog.brand,
        'default_link': catalog.default_link or None,
        'prices_include_tax': catalog.prices_include_tax,
        'currency': catalog.company_id.currency_id.name,
        'channels': [{
            'id': channel.id, 'name': channel.name,
            'cart_enabled': channel.commerce_cart_enabled if channel.commerce_settings_read_at else None,
            'catalog_visible': channel.commerce_catalog_visible if channel.commerce_settings_read_at else None,
        } for channel in catalog._webvue_channels()],
        'counts': catalog._webvue_counts(),
        'last_sync_at': iso(catalog.last_sync_at),
        'created_at': iso(catalog.create_date),
    }


def dump_item(item):
    product = item.product_id
    size = item._webvue_image_info()
    return {
        'id': item.id,
        'catalog_id': item.catalog_id.id,
        'product': {'id': product.id, 'name': item.name},
        'product_retailer_id': item.retailer_id,
        'name': item.name,
        'description': item.description,
        'list_price': product.lst_price,
        'price': item.price,
        'currency': item.currency,
        'availability': item.availability,
        'listed': item.listed,
        'link': item.link,
        'link_override': item.link_override or None,
        'image': {'url': item.image_url, 'width': size[0], 'height': size[1]} if size else None,
        'sync_state': item.sync_state,
        'sync_error': item.sync_error or None,
        'review_status': item.review_status,
        'review_reason': item.review_reason or None,
        'last_synced_at': iso(item.last_synced_at),
    }


def dump_pick_item(item):
    return {
        'id': item.id,
        'product_retailer_id': item.retailer_id,
        'name': item.name,
        'price': item.price,
        'currency': item.currency,
        'availability': item.availability,
        'image_url': item.image_url or None,
    }


def dump_channel_commerce(channel):
    """The catalog of the channel's WhatsApp account and the mirror of Meta's cart and catalog button settings."""
    catalog = channel._webvue_catalog()
    read = bool(channel.commerce_settings_read_at)
    return {
        'channel_id': channel.id,
        'catalog': dump_ref(catalog) if catalog else None,
        'cart_enabled': channel.commerce_cart_enabled if catalog and read else None,
        'catalog_visible': channel.commerce_catalog_visible if catalog and read else None,
        'paid_notice_enabled': channel.paid_notice_enabled,
        'paid_notice_text': channel.paid_notice_text or '',
    }
