# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command
from odoo.tests import tagged

from .common import FakeMeta, LiwanCatalogCase
from odoo.addons.liwan_inbox_payments.serializers.catalog import dump_catalog

SAUDI_VAT = '300000000000003'


@tagged('post_install', '-at_install', 'liwan')
class TestCatalogNoTaxWithoutVatRegistration(LiwanCatalogCase):
    """An unregistered company's catalog prices carry no tax, whatever the "prices include tax" option says."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.tax = cls.env['account.tax'].create({
            'name': 'VAT 15', 'amount': 15, 'amount_type': 'percent', 'type_tax_use': 'sale',
            'company_id': cls.env.company.id,
        })
        cls.taxed = cls.image_product('Taxed', 100.0, taxes_id=[Command.set(cls.tax.ids)])
        cls.catalog = cls.make_catalog()

    def setUp(self):
        super().setUp()
        self.env.company.write({'vat': SAUDI_VAT, 'liwan_vat_registered': False})
        self.catalog.write({'prices_include_tax': True})

    def register(self, registered):
        self.env.company.write({'liwan_vat_registered': registered})

    def pushed_price(self):
        meta = FakeMeta()
        with meta.patch():
            self.env['liwan.inbox.catalog']._liwan_run_sync()
        return meta.bodies('items_batch')[0]['requests'][0]['data']['price'].split()[0]

    def test_the_catalog_price_of_an_unregistered_company_is_the_list_price(self):
        item = self.make_item(self.catalog, self.taxed)
        self.assertEqual((item.price, item._liwan_price()), (100.0, 100.0))
        self.assertEqual(self.pushed_price(), '100.00')

    def test_the_include_tax_option_has_no_effect_while_unregistered(self):
        item = self.make_item(self.catalog, self.taxed)
        for option in (False, True):
            with self.subTest(prices_include_tax=option):
                self.catalog.write({'prices_include_tax': option})
                item.invalidate_recordset()
                self.assertEqual(item._liwan_price(), 100.0)

    def test_the_serializer_tells_the_form_there_is_no_tax_option(self):
        body = dump_catalog(self.catalog)
        self.assertFalse(body['vat_registered'])
        self.assertFalse(body['prices_include_tax'])

    def test_a_registered_company_shows_the_taxed_price_again(self):
        self.register(True)
        self.assertEqual(self.make_item(self.catalog, self.taxed)._liwan_price(), 115.0)
        self.assertTrue(dump_catalog(self.catalog)['vat_registered'])

    def test_turning_registration_off_takes_the_tax_out_of_the_pushed_price(self):
        self.register(True)
        item = self.make_item(self.catalog, self.taxed)
        self.assertEqual(item._liwan_price(), 115.0)
        self.register(False)
        item.invalidate_recordset()
        self.assertEqual(item._liwan_price(), 100.0)
        self.assertEqual(self.pushed_price(), '100.00')
