# Part of Odoo. See LICENSE file for full copyright and licensing details.
import importlib.util
from pathlib import Path

from odoo.tests import tagged
from odoo.tools.sql import column_exists, create_column

from .common import CATALOG_ID, LiwanCatalogCase
from odoo.addons.liwan_payments.tests.common import TAX_INCLUDED

MIGRATION_DIR = Path(__file__).parents[1] / 'migrations' / '19.0.1.3.0'
DROP_OPTION = MIGRATION_DIR / 'post-drop-prices-include-tax.py'
RESEND = MIGRATION_DIR / 'post-resend-synced-prices.py'
PREVIOUS_VERSION = '19.0.1.2.0'


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@tagged('post_install', '-at_install', 'liwan')
class TestCatalogMigrations(LiwanCatalogCase):
    """The 19.0.1.3.0 migrations: the removed per-catalog tax option, and the one-time resend of the synced prices."""

    def test_the_removed_tax_option_column_is_dropped_on_an_upgrade_and_left_on_a_fresh_install(self):
        migration = load(DROP_OPTION, 'post_drop_prices_include_tax')
        create_column(self.env.cr, 'liwan_inbox_catalog', 'prices_include_tax', 'bool')
        migration.migrate(self.env.cr, False)
        self.assertTrue(column_exists(self.env.cr, 'liwan_inbox_catalog', 'prices_include_tax'))
        migration.migrate(self.env.cr, PREVIOUS_VERSION)
        self.assertFalse(column_exists(self.env.cr, 'liwan_inbox_catalog', 'prices_include_tax'))
        migration.migrate(self.env.cr, PREVIOUS_VERSION)  # a rerun finds no column and changes nothing

    def make_establishment_catalog(self, name, phone_id, business_account, parent=None):
        company = self.catalog_company(name, price_mode=TAX_INCLUDED, parent=parent)
        self.make_channel(phone_id=phone_id, business_account_id=business_account, owner_company_id=company.id)
        return self.env['liwan.inbox.catalog'].create({
            'company_id': company.id, 'business_account_id': business_account, 'meta_catalog_id': CATALOG_ID,
            'name': name, 'brand': name, 'default_link': 'https://shop.example.test',
        })

    def test_every_synced_listed_item_of_every_establishment_is_marked_for_resend(self):
        root_catalog = self.make_establishment_catalog('Resend root', '100000000021', '200000000091')
        branch_catalog = self.make_establishment_catalog(
            'Resend branch', '100000000022', '200000000092', parent=root_catalog.company_id,
        )
        cases = {
            'root synced': self.synced(self.make_item(root_catalog, self.product)),
            'branch synced': self.synced(self.make_item(branch_catalog, self.product)),
            'unlisted synced': self.synced(self.make_item(root_catalog, self.product2, listed=False)),
        }
        removing = self.synced(self.make_item(branch_catalog, self.product2))
        removing.sync_state = 'removing'
        errored = self.make_item(root_catalog, self.image_product('Errored', 10.0))
        errored.sync_state = 'error'
        migration = load(RESEND, 'post_resend_synced_prices')
        migration.migrate(self.env.cr, PREVIOUS_VERSION)
        self.env.invalidate_all()
        self.assertEqual(cases['root synced'].sync_state, 'pending')
        self.assertEqual(cases['branch synced'].sync_state, 'pending')
        self.assertEqual(cases['unlisted synced'].sync_state, 'synced')
        self.assertEqual((removing.sync_state, errored.sync_state), ('removing', 'error'))
        # A rerun marks only what was synced meanwhile.
        cases['root synced'].sync_state = 'synced'
        migration.migrate(self.env.cr, PREVIOUS_VERSION)
        self.env.invalidate_all()
        self.assertEqual((cases['root synced'].sync_state, cases['branch synced'].sync_state), ('pending', 'pending'))

    def test_a_fresh_install_resends_nothing(self):
        catalog = self.make_establishment_catalog('Fresh install', '100000000023', '200000000093')
        item = self.synced(self.make_item(catalog, self.product))
        load(RESEND, 'post_resend_synced_prices').migrate(self.env.cr, False)
        self.env.invalidate_all()
        self.assertEqual(item.sync_state, 'synced')

    def test_the_establishment_of_an_item_is_the_root_of_its_catalog_company(self):
        root_catalog = self.make_establishment_catalog('Establishment root', '100000000024', '200000000094')
        branch_catalog = self.make_establishment_catalog(
            'Establishment branch', '100000000025', '200000000095', parent=root_catalog.company_id,
        )
        for catalog in (root_catalog, branch_catalog):
            with self.subTest(company=catalog.company_id.name):
                item = self.make_item(catalog, self.product)
                self.assertEqual(item.establishment_id, root_catalog.company_id)
                item.unlink()
