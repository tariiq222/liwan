# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The 19.0.1.25.0 migration: the catalog and orders move in from liwan_inbox_payments."""
import importlib.util
from pathlib import Path

from odoo.tests import tagged
from odoo.tools.sql import column_exists, create_column

from .catalog_common import CATALOG_ID, LiwanCatalogCase
from .removed_addon import REMOVED_ADDON, installed_removed_addon
from odoo.addons.liwan_api.models.removed_addons import forget_removed_addons
from odoo.addons.liwan_payments.tests.common import TAX_INCLUDED

MIGRATIONS = Path(__file__).parents[1] / 'migrations' / '19.0.1.25.0'
SOURCE = REMOVED_ADDON
OWNER = 'liwan_inbox'
PREVIOUS = '19.0.1.24.0'


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), MIGRATIONS / f'{name}.py')
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


@tagged('post_install', '-at_install', 'liwan')
class TestCatalogHandover(LiwanCatalogCase):
    """The pre script gives every data xml id of the removed addon to liwan_inbox, records unchanged."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.migration = load('pre-take_over_catalog')

    def rows(self, module, names):
        data = self.env['ir.model.data'].search([('module', '=', module), ('name', 'in', list(names))])
        return {row.name: (row.model, row.res_id) for row in data}

    def seed_removed_addon(self):
        """The rows as a database with the removed addon installed holds them."""
        current = self.rows(OWNER, self.migration.HANDED_OVER)
        stale_names = set(self.migration.STALE_ACCESS)
        self.assertEqual(set(current), set(self.migration.HANDED_OVER) - stale_names, 'a handed-over name is not loaded')
        group = self.env.ref('liwan_inbox.group_cap_inbox_catalog_manage')
        for name, model in zip(self.migration.STALE_ACCESS, ('product.model_product_template', 'product.model_product_product')):
            access = self.env['ir.model.access'].create({
                'name': name, 'model_id': self.env.ref(model).id, 'group_id': group.id, 'perm_read': True,
            })
            self.env['ir.model.data'].create({'module': OWNER, 'name': name, 'model': 'ir.model.access', 'res_id': access.id})
        expected = self.rows(OWNER, self.migration.HANDED_OVER)
        self.env['ir.model.data'].search([('module', '=', OWNER), ('name', 'in', list(self.migration.HANDED_OVER))]).write(
            {'module': SOURCE},
        )
        installed_removed_addon(self.env)
        return expected

    def test_every_data_xml_id_moves_with_its_record_and_the_addon_can_be_forgotten(self):
        expected = self.seed_removed_addon()
        for model in ('res.groups', 'ir.model.access', 'ir.rule', 'ir.cron', 'ir.actions.server', 'liwan.access.permission'):
            self.assertIn(model, {model for model, _ in expected.values()}, model)
        self.migration.migrate(self.env.cr, PREVIOUS)
        self.assertEqual(self.rows(OWNER, self.migration.HANDED_OVER), expected)
        self.assertFalse(self.rows(SOURCE, self.migration.HANDED_OVER))
        self.migration.migrate(self.env.cr, PREVIOUS)  # a rerun finds nothing left to move
        self.assertEqual(self.rows(OWNER, self.migration.HANDED_OVER), expected)
        forget_removed_addons(self.env, names=(SOURCE,))
        self.assertFalse(self.env['ir.module.module'].search([('name', '=', SOURCE)]))
        self.assertEqual(self.rows(OWNER, self.migration.HANDED_OVER), expected)

    def test_a_database_without_the_removed_addon_changes_nothing(self):
        before = self.rows(OWNER, self.migration.HANDED_OVER)
        self.migration.migrate(self.env.cr, PREVIOUS)
        self.migration.migrate(self.env.cr, PREVIOUS)
        self.assertEqual(self.rows(OWNER, self.migration.HANDED_OVER), before)

    def make_stale_rules(self):
        installed_removed_addon(self.env)
        group = self.env.ref('liwan_inbox.group_cap_inbox_catalog_manage')
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
                'module': SOURCE, 'name': f'product_{suffix}_catalog_manage_rule', 'model': 'ir.rule', 'res_id': rule.id,
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
        self.migration.migrate(self.env.cr, False)
        self.assertEqual(len(stale.exists()), 2, 'a fresh install deletes nothing')
        self.migration.migrate(self.env.cr, PREVIOUS)
        self.env.invalidate_all()
        self.assertFalse(stale.exists())
        for name in self.migration.STALE_RULES:
            self.assertFalse(self.env.ref(f'{SOURCE}.{name}', raise_if_not_found=False), name)
        self.env.registry.clear_cache()
        for model, mode in checks:
            with self.subTest(model=model, mode=mode, stale=False):
                self.run_rule(model, mode)
        self.migration.migrate(self.env.cr, PREVIOUS)  # a rerun finds no rule and changes nothing


@tagged('post_install', '-at_install', 'liwan')
class TestCatalogPriceResend(LiwanCatalogCase):
    """The post script: the removed tax option's column is dropped and the synced prices are resent once."""

    def make_establishment_catalog(self, name, phone_id, business_account, parent=None):
        company = self.catalog_company(name, price_mode=TAX_INCLUDED, parent=parent)
        self.make_channel(phone_id=phone_id, business_account_id=business_account, owner_company_id=company.id)
        return self.env['liwan.inbox.catalog'].create({
            'company_id': company.id, 'business_account_id': business_account, 'meta_catalog_id': CATALOG_ID,
            'name': name, 'brand': name, 'default_link': 'https://shop.example.test',
        })

    def test_the_removed_tax_option_column_is_dropped_on_an_upgrade_and_left_on_a_fresh_install(self):
        migration = load('post-resend_catalog_prices')
        create_column(self.env.cr, 'liwan_inbox_catalog', 'prices_include_tax', 'bool')
        migration.migrate(self.env.cr, False)
        self.assertTrue(column_exists(self.env.cr, 'liwan_inbox_catalog', 'prices_include_tax'))
        migration.migrate(self.env.cr, PREVIOUS)
        self.assertFalse(column_exists(self.env.cr, 'liwan_inbox_catalog', 'prices_include_tax'))
        migration.migrate(self.env.cr, PREVIOUS)  # a rerun finds no column and changes nothing

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
        create_column(self.env.cr, 'liwan_inbox_catalog', 'prices_include_tax', 'bool')
        load('post-resend_catalog_prices').migrate(self.env.cr, PREVIOUS)
        self.env.invalidate_all()
        self.assertEqual(cases['root synced'].sync_state, 'pending')
        self.assertEqual(cases['branch synced'].sync_state, 'pending')
        self.assertEqual(cases['unlisted synced'].sync_state, 'synced')
        self.assertEqual((removing.sync_state, errored.sync_state), ('removing', 'error'))

    def test_a_database_past_the_change_resends_nothing(self):
        catalog = self.make_establishment_catalog('Past the change', '100000000023', '200000000093')
        item = self.synced(self.make_item(catalog, self.product))
        load('post-resend_catalog_prices').migrate(self.env.cr, PREVIOUS)
        load('post-resend_catalog_prices').migrate(self.env.cr, False)
        self.env.invalidate_all()
        self.assertEqual(item.sync_state, 'synced')


@tagged('post_install', '-at_install', 'liwan')
class TestCatalogProductsAdoption(LiwanCatalogCase):
    """The end script: the products a catalog lists become service products and every item keeps its product."""

    def test_every_listed_and_marked_product_is_adopted_and_every_item_keeps_its_product(self):
        catalog = self.make_catalog()
        company = catalog.company_id
        listed = self.image_product('Legacy listed', 10.0, liwan_product=False, company_id=company.id)
        archived = self.image_product('Legacy archived', 10.0, liwan_product=False)
        marked = self.image_product('Legacy marked only', 10.0, liwan_product=False)
        items = [self.make_item(catalog, listed), self.make_item(catalog, archived)]
        items[1].active = False
        archived.active = False
        migration = load('end-adopt_catalog_products')
        migration.migrate(self.env.cr, PREVIOUS)
        self.env.invalidate_all()
        self.assertFalse(listed.product_tmpl_id.liwan_product, 'without the marker column nothing is adopted')
        create_column(self.env.cr, 'product_template', 'liwan_inbox_catalog', 'bool')
        self.env.cr.execute('UPDATE product_template SET liwan_inbox_catalog = TRUE WHERE id = %s', [marked.product_tmpl_id.id])
        migration.migrate(self.env.cr, False)
        self.env.invalidate_all()
        self.assertFalse(listed.product_tmpl_id.liwan_product)
        self.assertTrue(column_exists(self.env.cr, 'product_template', 'liwan_inbox_catalog'))
        migration.migrate(self.env.cr, PREVIOUS)
        self.env.invalidate_all()
        for product in (listed, archived, marked):
            with self.subTest(product=product.name):
                template = product.with_context(active_test=False).product_tmpl_id
                self.assertTrue(template.liwan_product)
                self.assertFalse(template.company_id)
        self.assertEqual([item.product_id for item in items], [listed, archived])
        self.assertFalse(column_exists(self.env.cr, 'product_template', 'liwan_inbox_catalog'))
        migration.migrate(self.env.cr, PREVIOUS)  # a rerun finds nothing to adopt and no column
