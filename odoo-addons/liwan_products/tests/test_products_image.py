# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""A product's image: written only by the service, from a checked upload, and never sent back as bytes."""
import base64

from odoo.exceptions import AccessError
from odoo.tests import tagged

from odoo.addons.liwan_api.tests.common import set_probe_feature
from odoo.addons.liwan_products.models.product_image import MAX_IMAGE_BYTES
from odoo.addons.liwan_products.tests.common import (
    PRODUCTS,
    ProductsCase,
    image_bytes,
    image_upload,
)

MODES = ('saas', 'non_saas')


@tagged('post_install', '-at_install', 'liwan')
class TestProductsImage(ProductsCase):

    def test_a_product_is_created_and_cleared_with_its_image(self):
        for mode in MODES:
            with self.subTest(mode=mode), self.undone():
                self.set_mode(mode)
                set_probe_feature(self)
                plain = self.created({'name': f'Plain {mode}', 'type': 'goods'})
                self.assertIs(plain['has_image'], False)
                product = self.created({'name': f'Pictured {mode}', 'type': 'goods', 'image': image_upload()})
                self.assertIs(product['has_image'], True)
                self.assertNotIn('image', product)
                stored = self.env['product.template'].browse(product['id'])
                self.assertTrue(stored.image_1920)
                path = f'{PRODUCTS}/{product["id"]}'
                self.assertIs(self.api('GET', path).json()['has_image'], True)
                self.assertIn(True, [item['has_image'] for item in self.api('GET', PRODUCTS).json()['items']])
                response = self.api('PATCH', path, {'image': None})
                self.assertEqual(response.status_code, 200, response.text)
                self.assertIs(response.json()['has_image'], False)
                self.assertFalse(stored.image_1920)
                response = self.api('PATCH', path, {'image': image_upload(fmt='JPEG')})
                self.assertIs(response.json()['has_image'], True)
                self.assertEqual(self.api('PATCH', path, {'name': 'Renamed'}).json()['has_image'], True)

    def test_a_small_image_is_stored_as_the_catalog_decides_the_size_at_pick_time(self):
        product = self.created({'name': 'Thumb', 'type': 'goods', 'image': image_upload(size=(40, 40))})
        self.assertIs(product['has_image'], True)

    def test_a_bad_image_is_refused(self):
        too_big = base64.b64encode(b'\0' * (MAX_IMAGE_BYTES + 1)).decode()
        for mode in MODES:
            with self.subTest(mode=mode), self.undone():
                self.set_mode(mode)
                set_probe_feature(self)
                self.sign_in('pr_root_staff')
                for image in (
                    image_upload(mimetype='image/gif'),
                    image_upload(mimetype='image/jpeg'),
                    image_upload(fmt='JPEG', mimetype='image/png'),
                    image_upload(raw=b'not an image at all'),
                    {**image_upload(), 'data': 'not base64 !!'},
                    {**image_upload(), 'data': too_big},
                    {**image_upload(), 'data': ''},
                    {**image_upload(), 'name': ''},
                    {**image_upload(), 'name': []},
                    {**image_upload(), 'mimetype': []},
                    {**image_upload(), 'data': []},
                    {**image_upload(), 'extra': 1},
                    {'name': 'p.png', 'mimetype': 'image/png'},
                    'data:image/png;base64,AAAA', [], 7,
                ):
                    with self.subTest(image=str(image)[:60]):
                        response = self.api('POST', PRODUCTS, {'name': 'Bad image', 'type': 'goods', 'image': image})
                        self.assertRefused(response, 422, 'invalid')
                        self.assertEqual(response.json()['field'], 'image')
        self.assertFalse(self.env['product.template'].search([('name', '=', 'Bad image')]))

    def test_the_image_needs_products_manage_before_anything_is_read(self):
        product = self.created({'name': 'Guarded image', 'type': 'goods', 'list_price': 5})
        path = f'{PRODUCTS}/{product["id"]}'
        for login in ('pr_root_pricer', 'pr_nobody', 'pr_picker'):
            with self.subTest(login=login):
                self.sign_in(login)
                # A bad file as well: the refusal is the capability's, ahead of any parsing.
                for image in (image_upload(), image_upload(raw=b'junk'), None):
                    self.assertRefused(self.api('PATCH', path, {'image': image}), 403, 'forbidden')
                self.assertRefused(self.api('PATCH', path, {'list_price': 9, 'image': image_upload()}), 403, 'forbidden')
        self.assertFalse(self.env['product.template'].browse(product['id']).image_1920)
        self.sign_in('pr_root_pricer')
        self.assertRefused(
            self.api('POST', PRODUCTS, {'name': 'P', 'type': 'goods', 'image': image_upload()}), 403, 'forbidden',
        )

    def test_the_image_is_written_by_the_service_only(self):
        product = self.env['product.template'].browse(self.created({'name': 'Locked image', 'type': 'goods'})['id'])
        raw = base64.b64encode(image_bytes())
        for user in (self.root_staff, self.root_admin):
            with self.subTest(user=user.login):
                with self.assertRaisesRegex(AccessError, 'use_liwan_products_service'):
                    product.with_user(user).write({'image_1920': raw})
                with self.assertRaisesRegex(AccessError, 'use_liwan_products_service'):
                    product.product_variant_id.with_user(user).write({'image_variant_1920': raw})
        self.assertFalse(product.image_1920)
