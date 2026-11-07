# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command
from odoo.exceptions import AccessError
from odoo.tests import new_test_user, tagged

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

    def test_the_item_price_follows_the_registration_without_a_manual_refresh(self):
        item = self.make_item(self.catalog, self.taxed)
        self.assertEqual(item.price, 100.0)
        self.register(True)
        self.assertEqual(item.price, 115.0)
        self.register(False)
        self.assertEqual(item.price, 100.0)

    def test_turning_registration_off_takes_the_tax_out_of_the_pushed_price(self):
        self.register(True)
        item = self.make_item(self.catalog, self.taxed)
        self.assertEqual(item._liwan_price(), 115.0)
        self.register(False)
        item.invalidate_recordset()
        self.assertEqual(item._liwan_price(), 100.0)
        self.assertEqual(self.pushed_price(), '100.00')


@tagged('post_install', '-at_install', 'liwan')
class TestCatalogResyncOnVatRegistration(LiwanCatalogCase):
    """Switching the registration republishes the prices Meta already holds, and only this company's."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.tax = cls.env['account.tax'].create({
            'name': 'VAT 15', 'amount': 15, 'amount_type': 'percent', 'type_tax_use': 'sale',
            'company_id': cls.env.company.id,
        })
        cls.taxed = cls.image_product('Taxed', 100.0, taxes_id=[Command.set(cls.tax.ids)])
        cls.other_company = cls.env['res.company'].create({'name': 'Other tenant branch'})
        cls.other_catalog = cls.env['liwan.inbox.catalog'].create({
            'company_id': cls.other_company.id, 'business_account_id': 'other-account', 'meta_catalog_id': '300000000002',
            'name': 'Other', 'brand': 'Other',
        })

    def setUp(self):
        super().setUp()
        self.env.company.write({'vat': SAUDI_VAT, 'liwan_vat_registered': False})
        self.catalog = self.make_catalog(prices_include_tax=True)
        self.item = self.make_item(self.catalog, self.taxed)
        self.sync_all()
        self.other_item = self.synced(self.make_item(self.other_catalog, self.product2))

    def sync_all(self):
        meta = FakeMeta()
        with meta.patch():
            self.env['liwan.inbox.catalog']._liwan_run_sync()
        return meta

    def register(self, registered):
        self.env.company.write({'liwan_vat_registered': registered})

    def pushed_price(self, meta):
        return meta.bodies('items_batch')[0]['requests'][0]['data']['price'].split()[0]

    def test_the_first_sync_settles_the_item(self):
        self.assertEqual(self.item.sync_state, 'synced')

    def test_turning_registration_on_and_off_republishes_the_synced_prices(self):
        self.register(True)
        self.assertEqual(self.item.sync_state, 'pending')
        meta = self.sync_all()
        self.assertEqual((self.pushed_price(meta), self.item.sync_state), ('115.00', 'synced'))
        self.register(False)
        self.assertEqual(self.item.sync_state, 'pending')
        meta = self.sync_all()
        self.assertEqual((self.pushed_price(meta), self.item.sync_state), ('100.00', 'synced'))

    def test_a_write_that_leaves_the_registration_unchanged_resends_nothing(self):
        self.register(False)
        self.assertEqual(self.item.sync_state, 'synced')
        self.register(True)
        self.sync_all()
        self.register(True)
        self.assertEqual(self.item.sync_state, 'synced')

    def test_another_companys_items_are_untouched(self):
        self.register(True)
        self.assertEqual(self.other_item.sync_state, 'synced')
        self.other_company.write({'country_id': self.env.ref('base.sa').id, 'vat': SAUDI_VAT, 'liwan_vat_registered': True})
        self.assertEqual((self.item.sync_state, self.other_item.sync_state), ('pending', 'pending'))

    def test_removing_and_pending_items_keep_their_state(self):
        removing = self.synced(self.make_item(self.catalog, self.product))
        removing.sync_state = 'removing'
        pending = self.make_item(self.catalog, self.product2)
        self.assertEqual(pending.sync_state, 'pending')
        self.register(True)
        self.assertEqual((removing.sync_state, pending.sync_state, self.item.sync_state), ('removing', 'pending', 'pending'))

    def test_a_system_administrator_with_no_inbox_right_can_switch_it_and_the_items_are_republished(self):
        admin = new_test_user(self.env, login='vat_flip_admin', groups='liwan_core.group_employee')
        self.env['liwan.access.service']._liwan_replace_assignments(admin, [{
            'role_id': self.env.ref('liwan_core.role_system_admin').id, 'company_id': self.env.company.id,
        }])
        with self.assertRaises(AccessError):
            self.item.with_user(admin).catalog_id  # noqa: B018 - the precondition: the administrator reads no catalog item
        self.env.company.with_user(admin)._liwan_write_company_profile({'vat': SAUDI_VAT, 'liwan_vat_registered': True})
        self.assertEqual(self.item.sync_state, 'pending')
        meta = self.sync_all()
        self.assertEqual((self.pushed_price(meta), self.item.sync_state), ('115.00', 'synced'))
