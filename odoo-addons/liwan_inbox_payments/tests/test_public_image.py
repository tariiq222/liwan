# Part of Odoo. See LICENSE file for full copyright and licensing details.
import base64

from odoo.tests import tagged

from .common import LiwanCatalogCase, image_bytes


@tagged('post_install', '-at_install', 'liwan')
class TestPublicImage(LiwanCatalogCase):

    def setUp(self):
        super().setUp()
        self.item = self.make_item(self.make_catalog())

    def fetch(self, item_id=None, token=None):
        return self.url_open(f'/api/v1/public/inbox/catalog/images/{item_id or self.item.id}/{token or self.item.image_token}')

    def test_the_image_is_served_with_the_right_token_and_no_session(self):
        response = self.fetch()
        self.assertEqual((response.status_code, response.headers['Content-Type']), (200, 'image/png'))
        self.assertIn('max-age', response.headers['Cache-Control'])
        self.assertEqual(response.content[:8], b'\x89PNG\r\n\x1a\n')

    def test_other_formats_are_converted_to_png(self):
        self.product.image_1920 = base64.b64encode(image_bytes(fmt='GIF'))
        self.assertEqual(self.fetch().headers['Content-Type'], 'image/png')

    def test_a_wrong_token_an_unknown_or_unlisted_or_deleted_item_is_a_404(self):
        self.assertEqual(self.fetch(token='wrong').status_code, 404)
        self.assertEqual(self.fetch(item_id=self.item.id + 999).status_code, 404)
        self.item.listed = False
        self.assertEqual(self.fetch().status_code, 404)
        self.item.listed = True
        self.item.active = False
        self.assertEqual(self.fetch().status_code, 404)

    def test_the_token_rotates_when_the_image_changes(self):
        token = self.item.image_token
        self.product.product_tmpl_id.image_1920 = base64.b64encode(image_bytes((700, 700)))
        self.item.invalidate_recordset()
        self.assertEqual(self.fetch(token=token).status_code, 404)
        self.assertEqual(self.fetch().status_code, 200)
