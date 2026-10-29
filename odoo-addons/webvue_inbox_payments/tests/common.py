# Part of Odoo. See LICENSE file for full copyright and licensing details.
import base64
import io
from unittest.mock import MagicMock, patch

import requests
from PIL import Image

from odoo import Command, fields

from odoo.addons.webvue_inbox.tests.common import PASSWORD, WebVueInboxCase
from odoo.addons.webvue_payments.tests.common import WebVueOrderCase

BASE_URL = 'https://tenant.example.test'
CATALOG_ID = '300000000001'


def image_bytes(size=(600, 600), fmt='PNG'):
    out = io.BytesIO()
    Image.new('RGB', size, 'red').save(out, format=fmt)
    return out.getvalue()


def upload(size=(600, 600), fmt='PNG', mimetype=None):
    return {
        'name': 'p.png', 'mimetype': mimetype or ('image/png' if fmt == 'PNG' else 'image/jpeg'),
        'data': base64.b64encode(image_bytes(size, fmt)).decode(),
    }


def meta_response(status=200, body=None):
    mocked = MagicMock(status_code=status)
    mocked.json.return_value = body if body is not None else {}
    return mocked


class FakeMeta:
    """Stands in for Meta's Graph API: answers by `METHOD path` and records every call."""

    def __init__(self, routes=None):
        self.routes = {
            f'GET {CATALOG_ID}': {'id': CATALOG_ID, 'name': 'Shop', 'vertical': 'commerce'},
            'GET 200000000001/product_catalogs': {'data': [{'id': CATALOG_ID}]},
            'POST 200000000001/product_catalogs': {'success': True},
            'GET 100000000001/whatsapp_commerce_settings': {'data': [{'is_cart_enabled': True, 'is_catalog_visible': False}]},
            'POST 100000000001/whatsapp_commerce_settings': {'success': True},
            'GET 100000000001': {'id': '100000000001', 'display_phone_number': '+966 50 111 2222'},
            f'POST {CATALOG_ID}/items_batch': {'handles': ['h1'], 'validation_status': []},
            f'GET {CATALOG_ID}/check_batch_request_status': {'data': [{'status': 'finished', 'errors': []}]},
            f'GET {CATALOG_ID}/products': {'data': []},
            **(routes or {}),
        }
        self.calls = []

    def __call__(self, method, url, **kwargs):
        path = url.split('/', 4)[4]
        self.calls.append((method, path, kwargs))
        answer = self.routes.get(f'{method} {path}')
        if isinstance(answer, Exception):
            raise answer
        if isinstance(answer, MagicMock):
            return answer
        if answer is None:
            return meta_response(404, {'error': {'message': f'no route {method} {path}', 'code': 100}})
        return meta_response(200, answer)

    def patch(self):
        return patch.object(requests, 'request', self)

    def bodies(self, suffix):
        return [kwargs.get('json') for method, path, kwargs in self.calls if path.endswith(suffix) and method == 'POST']


class WebVueCatalogCase(WebVueOrderCase, WebVueInboxCase):
    """Inbox users and channel, a live gateway and a customer with a SAR price list, and image products."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.env['ir.config_parameter'].sudo().set_param('web.base.url', BASE_URL)
        cls.settings.visibility_policy = 'all'
        cls.catalog_only = cls._capability_user('inbox_catalog_only', 'inbox.catalog.manage')
        cls.product = cls.image_product('Shirt', 100.0, default_code='SHIRT-1')
        cls.product2 = cls.image_product('Hat', 40.0)

    @classmethod
    def image_product(cls, name, price, **values):
        product = cls.env['product.product'].create({
            'name': name, 'type': 'consu', 'list_price': price, 'taxes_id': [Command.clear()],
            'image_1920': base64.b64encode(image_bytes()), **values,
        })
        cls.customer.property_product_pricelist.item_ids = [Command.create({
            'applied_on': '0_product_variant', 'product_id': product.id, 'compute_price': 'fixed', 'fixed_price': price,
        })]
        return product

    @classmethod
    def make_catalog(cls, **values):
        return cls.env['webvue.inbox.catalog'].create({
            'business_account_id': cls.channel.business_account_id, 'meta_catalog_id': CATALOG_ID, 'name': 'Shop',
            'brand': 'Acme', **values,
        })

    @classmethod
    def make_item(cls, catalog, product=None, **values):
        product = product or cls.product
        return cls.env['webvue.inbox.catalog.item'].create({
            'catalog_id': catalog.id, 'product_id': product.id,
            'retailer_id': product.default_code or f'wv-{product.id}', **values,
        })

    @classmethod
    def synced(cls, item):
        item.write({
            'sync_state': 'synced', 'synced_hash': 'x', 'last_synced_at': fields.Datetime.now(), 'review_status': 'approved',
        })
        return item

    def without_catalog(self):
        """The tenant's plan loses the `inbox.catalog` feature (every other feature stays as it is)."""
        service = type(self.env['webvue.entitlement.service'])
        original = service._webvue_feature_write

        def feature_write(this, key):
            return False if key == 'inbox.catalog' else original(this, key)

        return patch.object(service, '_webvue_feature_write', feature_write)

    def login_user(self, user):
        self.authenticate(user.login, PASSWORD)
