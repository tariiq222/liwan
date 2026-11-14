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
ADOPT = Path(__file__).parents[1] / 'migrations' / '19.0.1.4.0' / 'end-adopt-catalog-products.py'
DROP_RULES = Path(__file__).parents[1] / 'migrations' / '19.0.1.4.0' / 'pre-drop-catalog-product-rules.py'
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


@tagged('post_install', '-at_install', 'liwan')
class TestCatalogProductsAdoption(LiwanCatalogCase):
    """The 19.0.1.4.0 migration: the products a catalog lists become service products and every item keeps its product."""

    def test_every_listed_and_marked_product_is_adopted_and_every_item_keeps_its_product(self):
        catalog = self.make_catalog()
        company = catalog.company_id
        listed = self.image_product('Legacy listed', 10.0, liwan_product=False, company_id=company.id)
        archived = self.image_product('Legacy archived', 10.0, liwan_product=False)
        marked = self.image_product('Legacy marked only', 10.0, liwan_product=False)
        items = [self.make_item(catalog, listed), self.make_item(catalog, archived)]
        items[1].active = False
        archived.active = False
        create_column(self.env.cr, 'product_template', 'liwan_inbox_catalog', 'bool')
        self.env.cr.execute('UPDATE product_template SET liwan_inbox_catalog = TRUE WHERE id = %s', [marked.product_tmpl_id.id])
        migration = load(ADOPT, 'end_adopt_catalog_products')
        migration.migrate(self.env.cr, False)
        self.env.invalidate_all()
        self.assertFalse(listed.product_tmpl_id.liwan_product)
        self.assertTrue(column_exists(self.env.cr, 'product_template', 'liwan_inbox_catalog'))
        migration.migrate(self.env.cr, '19.0.1.3.0')
        self.env.invalidate_all()
        for product in (listed, archived, marked):
            with self.subTest(product=product.name):
                template = product.with_context(active_test=False).product_tmpl_id
                self.assertTrue(template.liwan_product)
                self.assertFalse(template.company_id)
        self.assertEqual([item.product_id for item in items], [listed, archived])
        self.assertFalse(column_exists(self.env.cr, 'product_template', 'liwan_inbox_catalog'))
        migration.migrate(self.env.cr, '19.0.1.3.0')  # a rerun finds nothing to adopt and no column


@tagged('post_install', '-at_install', 'liwan')
class TestCatalogProductRulesRemoval(LiwanCatalogCase):
    """The pre script of 19.0.1.4.0 deletes the two rules on the removed catalog marker before anything can search."""

    def make_stale_rules(self):
        group = self.env.ref('liwan_inbox_payments.group_cap_inbox_catalog_manage')
        rules = self.env['ir.rule']
        for model, field, suffix in (
            ('product.template', 'liwan_inbox_catalog', 'template'),
            ('product.product', 'product_tmpl_id.liwan_inbox_catalog', 'product'),
        ):
            rule = self.env['ir.rule'].create({
                'name': f'stale {suffix}', 'model_id': self.env['ir.model']._get_id(model),
                'domain_force': '[("id", ">", 0)]', 'groups': [(6, 0, group.ids)], 'perm_read': False,
            })
            self.env['ir.model.data'].create({
                'module': 'liwan_inbox_payments', 'name': f'product_{suffix}_catalog_manage_rule',
                'model': 'ir.rule', 'res_id': rule.id,
            })
            self.env.cr.execute('UPDATE ir_rule SET domain_force = %s WHERE id = %s', [f'[("{field}", "=", True)]', rule.id])
            rules |= rule
        rules.invalidate_recordset(['domain_force'])
        self.env.registry.clear_cache()
        return rules

    def run_rule(self, model, mode):
        """What an access check does with the catalog manager's rule: its domain is searched, so a gone field fails here."""
        domain = self.env['ir.rule'].with_user(self.catalog_only)._compute_domain(model, mode)
        return self.env[model].sudo().search(domain, limit=1)

    def test_the_stale_rules_break_a_catalog_manager_until_the_script_deletes_them(self):
        stale = self.make_stale_rules()
        checks = [(model, mode) for model in ('product.template', 'product.product') for mode in ('write', 'create')]
        for model, mode in checks:
            with self.subTest(model=model, mode=mode, stale=True), self.assertRaises(ValueError):
                self.run_rule(model, mode)
        migration = load(DROP_RULES, 'pre_drop_catalog_product_rules')
        migration.migrate(self.env.cr, False)
        self.assertEqual(len(stale.exists()), 2, 'a fresh install deletes nothing')
        migration.migrate(self.env.cr, '19.0.1.3.0')
        self.env.invalidate_all()
        self.assertFalse(stale.exists())
        for xmlid in migration.REMOVED_RULES:
            self.assertFalse(self.env.ref(xmlid, raise_if_not_found=False), xmlid)
        self.env.registry.clear_cache()
        for model, mode in checks:
            with self.subTest(model=model, mode=mode, stale=False):
                self.run_rule(model, mode)
        migration.migrate(self.env.cr, '19.0.1.3.0')  # a rerun finds no rule and changes nothing
