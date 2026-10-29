# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import timedelta

from odoo import Command, fields
from odoo.tests import tagged

from .common import CATALOG_ID, FakeMeta, WebVueCatalogCase, meta_response


@tagged('post_install', '-at_install', 'webvue')
class TestCatalogSync(WebVueCatalogCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.tax = cls.env['account.tax'].create({'name': 'VAT 15', 'amount': 15, 'amount_type': 'percent', 'type_tax_use': 'sale'})
        cls.taxed = cls.image_product('Taxed', 100.0, taxes_id=[Command.set(cls.tax.ids)])

    def setUp(self):
        super().setUp()
        self.catalog = self.make_catalog()
        self.sync = self.env['webvue.inbox.catalog']._webvue_run_sync

    def run_sync(self, meta=None):
        meta = meta or FakeMeta()
        with meta.patch():
            self.sync()
        return meta

    def test_the_item_payload_is_exact(self):
        item = self.make_item(self.catalog, self.taxed)
        self.catalog.default_link = None
        meta = self.run_sync()
        request = meta.bodies('items_batch')[0]['requests'][0]
        currency = self.env.company.currency_id.name
        self.assertEqual(request['method'], 'CREATE')
        self.assertEqual(request['data'], {
            'id': f'wv-{self.taxed.id}', 'title': 'Taxed', 'description': 'Taxed', 'availability': 'in stock', 'condition': 'new',
            'price': f'115.00 {currency}', 'link': 'https://wa.me/966501112222',
            'image_link': f'https://tenant.example.test/api/v1/public/inbox/catalog/images/{item.id}/{item.image_token}',
            'brand': 'Acme',
        })

    def test_prices_without_tax_and_a_catalog_link(self):
        self.catalog.write({'prices_include_tax': False, 'default_link': 'https://shop.example.test'})
        self.make_item(self.catalog, self.taxed, link_override='https://shop.example.test/taxed')
        data = self.run_sync().bodies('items_batch')[0]['requests'][0]['data']
        self.assertEqual((data['price'].split()[0], data['link']), ('100.00', 'https://shop.example.test/taxed'))

    def test_variants_share_an_item_group(self):
        size = self.env['product.attribute'].create({
            'name': 'Size', 'value_ids': [Command.create({'name': 'S'}), Command.create({'name': 'M'})],
        })
        template = self.env['product.template'].create({
            'name': 'Tee', 'type': 'consu', 'list_price': 10,
            'attribute_line_ids': [Command.create({'attribute_id': size.id, 'value_ids': [Command.set(size.value_ids.ids)]})],
        })
        for variant in template.product_variant_ids:
            variant.image_variant_1920 = self.product.image_1920
            self.make_item(self.catalog, variant)
        self.assertEqual(len(template.product_variant_ids), 2)
        groups = {request['data']['item_group_id'] for request in self.run_sync().bodies('items_batch')[0]['requests']}
        self.assertEqual(groups, {f'wv-t{template.id}'})

    def test_create_then_update_then_delete(self):
        item = self.make_item(self.catalog)
        self.run_sync()
        self.assertEqual((item.sync_state, item.review_status), ('synced', 'unknown'))
        self.assertTrue(item.synced_hash and item.last_synced_at)
        self.assertEqual(self.run_sync().bodies('items_batch'), [])  # nothing changed: no new batch
        item.availability = 'out_of_stock'
        meta = self.run_sync()
        self.assertEqual(meta.bodies('items_batch')[0]['requests'][0]['method'], 'UPDATE')
        item.listed = False
        meta = self.run_sync()
        self.assertEqual(meta.bodies('items_batch')[0]['requests'], [{'method': 'DELETE', 'data': {'id': 'SHIRT-1'}}])
        self.assertEqual((item.sync_state, item.synced_hash), ('synced', False))

    def test_a_save_that_changes_nothing_is_not_resent(self):
        item = self.synced(self.make_item(self.catalog))
        item.synced_hash = item._webvue_payload_hash()
        item.sync_state = 'pending'
        meta = self.run_sync()
        self.assertEqual(meta.bodies('items_batch'), [])
        self.assertEqual(item.sync_state, 'synced')

    def test_a_product_change_marks_the_item_for_resync_and_a_new_image_rotates_the_token(self):
        item = self.synced(self.make_item(self.catalog))
        token = item.image_token
        self.product.product_tmpl_id.list_price = 120
        item.invalidate_recordset()
        self.assertEqual(item.sync_state, 'pending')
        self.assertEqual(item.image_token, token)
        item.sync_state = 'synced'
        self.product.product_tmpl_id.image_1920 = self.product2.image_1920
        self.assertNotEqual(item.image_token, token)

    def test_errors_are_attached_to_the_item_that_caused_them(self):
        good, bad = self.make_item(self.catalog), self.make_item(self.catalog, self.product2)
        self.run_sync(FakeMeta({
            f'POST {CATALOG_ID}/items_batch': {
                'handles': ['h2'], 'validation_status': [{'retailer_id': bad.retailer_id, 'errors': [{'message': 'Bad price'}]}],
            },
            f'GET {CATALOG_ID}/check_batch_request_status': {'data': [{
                'status': 'finished', 'errors': [{'id': good.retailer_id, 'message': 'Image not reachable'}],
            }]},
        }))
        self.assertEqual((bad.sync_state, bad.sync_error), ('error', 'Bad price'))
        self.assertEqual((good.sync_state, good.sync_error), ('error', 'Image not reachable'))

    def test_a_batch_in_progress_waits_then_times_out(self):
        item = self.make_item(self.catalog)
        waiting = FakeMeta({f'GET {CATALOG_ID}/check_batch_request_status': {'data': [{'status': 'in_progress'}]}})
        self.run_sync(waiting)
        self.assertEqual(item.sync_state, 'syncing')
        self.env.flush_all()
        self.env.cr.execute('UPDATE webvue_inbox_catalog_item SET write_date = %s', [fields.Datetime.now() - timedelta(hours=2)])
        item.invalidate_recordset()
        self.run_sync(waiting)
        self.assertEqual(item.sync_state, 'error')

    def test_the_review_status_is_refreshed(self):
        item = self.synced(self.make_item(self.catalog))
        item.write({'review_status': 'pending', 'reviewed_at': False})
        self.run_sync(FakeMeta({f'GET {CATALOG_ID}/products': {'data': [{
            'retailer_id': 'SHIRT-1', 'review_status': 'rejected', 'review_rejection_reasons': ['adult_content'],
        }]}}))
        self.assertEqual((item.review_status, item.review_reason), ('rejected', 'adult_content'))

    def test_a_provider_failure_marks_the_catalog_and_the_next_run_retries(self):
        item = self.make_item(self.catalog)
        down = FakeMeta({f'POST {CATALOG_ID}/items_batch': meta_response(500, {})})
        self.run_sync(down)
        self.assertEqual(self.catalog.state, 'error')
        self.assertTrue(self.catalog.last_error)
        self.assertEqual(item.sync_state, 'pending')
        self.run_sync()
        self.assertEqual((self.catalog.state, self.catalog.last_error), ('connected', False))
        self.assertEqual(item.sync_state, 'synced')
