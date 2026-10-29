# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Meta commerce catalog calls: pure functions over the inbox adapter's Graph API entry point (no Odoo environment)."""
import json

from odoo.addons.webvue_inbox.adapters.whatsapp import ProviderError, graph_request

# Meta's error codes of a token that lacks a permission or an asset (permission, no access, invalid token).
PERMISSION_CODES = frozenset({10, 190, 200})
MAX_BATCH = 1000
REVIEW_PAGE = 1000
ERROR_TEXT_LENGTH = 200
FINISHED = 'finished'
FAILED = 'failed'
IN_PROGRESS = 'in_progress'


def is_permission_error(error):
    """True when Meta refused for a missing permission or catalog asset (the token needs catalog_management)."""
    return error.code in PERMISSION_CODES


def _malformed():
    message = 'malformed provider response'
    raise ProviderError(message, retryable=False)


def _dicts(value):
    return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []


def get_catalog(credentials, catalog_id):
    """{id, name, vertical} of a catalog."""
    data = graph_request('GET', catalog_id, credentials, params={'fields': 'id,name,vertical'})
    if not isinstance(data.get('id'), str):
        _malformed()
    return {'id': data['id'], 'name': str(data.get('name') or ''), 'vertical': data.get('vertical')}


def list_waba_catalogs(credentials):
    """The ids of the catalogs connected to the business account."""
    data = graph_request('GET', f'{credentials.business_account_id}/product_catalogs', credentials)
    return [str(item['id']) for item in _dicts(data.get('data')) if item.get('id')]


def connect_catalog(credentials, catalog_id):
    """Connect the catalog to the business account (there is no update or delete on this edge)."""
    data = graph_request(
        'POST', f'{credentials.business_account_id}/product_catalogs', credentials, json={'catalog_id': catalog_id},
    )
    if data.get('success') is not True:
        _malformed()


def get_commerce_settings(credentials):
    """{cart_enabled, catalog_visible} of the phone number."""
    data = graph_request('GET', f'{credentials.phone_number_id}/whatsapp_commerce_settings', credentials)
    settings = (_dicts(data.get('data')) or [{}])[0]
    return {
        'cart_enabled': bool(settings.get('is_cart_enabled')),
        'catalog_visible': bool(settings.get('is_catalog_visible')),
    }


def set_commerce_settings(credentials, cart_enabled=None, catalog_visible=None):
    """Switch the cart and/or the catalog button of the phone number."""
    flags = {'is_cart_enabled': cart_enabled, 'is_catalog_visible': catalog_visible}
    params = {key: 'true' if value else 'false' for key, value in flags.items() if value is not None}
    data = graph_request('POST', f'{credentials.phone_number_id}/whatsapp_commerce_settings', credentials, params=params)
    if data.get('success') is not True:
        _malformed()


def get_display_phone(credentials):
    """The phone number as customers see it (digits only), or None."""
    data = graph_request('GET', credentials.phone_number_id, credentials, params={'fields': 'display_phone_number'})
    digits = ''.join(char for char in str(data.get('display_phone_number') or '') if char.isdigit())
    return digits or None


def _first_error(entry):
    errors = _dicts(entry.get('errors'))
    return str(errors[0].get('message') or errors[0].get('title') or 'rejected')[:ERROR_TEXT_LENGTH] if errors else None


def items_batch(credentials, catalog_id, requests):
    """Push `requests` ([{method, data}]) to the catalog. Returns (handle or None, {retailer id: error text})."""
    data = graph_request(
        'POST', f'{catalog_id}/items_batch', credentials,
        json={'item_type': 'PRODUCT_ITEM', 'requests': requests},
    )
    handles = data.get('handles')
    handle = handles[0] if isinstance(handles, list) and handles and isinstance(handles[0], str) else None
    errors = {
        str(entry['retailer_id']): _first_error(entry)
        for entry in _dicts(data.get('validation_status')) if entry.get('retailer_id') and _first_error(entry)
    }
    return handle, errors


def batch_status(credentials, catalog_id, handle):
    """(status word, {retailer id: error text}) of a batch: `finished`, `failed` or `in_progress`."""
    data = graph_request(
        'GET', f'{catalog_id}/check_batch_request_status', credentials, params={'handle': handle},
    )
    entry = (_dicts(data.get('data')) or [{}])[0]
    status = str(entry.get('status') or IN_PROGRESS).lower()
    errors = {}
    for error in _dicts(entry.get('errors')):
        retailer_id = error.get('id') or error.get('retailer_id')
        if retailer_id:
            errors.setdefault(str(retailer_id), str(error.get('message') or 'rejected')[:ERROR_TEXT_LENGTH])
    return status, errors


def list_item_reviews(credentials, catalog_id, retailer_ids):
    """{retailer id: (review status, reason)} for `retailer_ids`; Meta words are lower-cased."""
    reviews = {}
    for start in range(0, len(retailer_ids), REVIEW_PAGE):
        data = graph_request('GET', f'{catalog_id}/products', credentials, params={
            'fields': 'retailer_id,review_status,review_rejection_reasons', 'limit': REVIEW_PAGE,
            'filter': json.dumps({'retailer_id': {'is_any': retailer_ids[start:start + REVIEW_PAGE]}}),
        })
        for item in _dicts(data.get('data')):
            reasons = item.get('review_rejection_reasons')
            reason = ', '.join(str(reason) for reason in reasons)[:ERROR_TEXT_LENGTH] if isinstance(reasons, list) and reasons else None
            if item.get('retailer_id'):
                reviews[str(item['retailer_id'])] = (str(item.get('review_status') or '').lower(), reason)
    return reviews
