# Part of Odoo. See LICENSE file for full copyright and licensing details.
import importlib.util
from pathlib import Path

from odoo.tests import TransactionCase, tagged
from odoo.tools.sql import column_exists

MIGRATION = Path(__file__).parents[1] / 'migrations' / '19.0.1.7.0' / 'end-packages-to-products.py'
PREVIOUS = '19.0.1.6.0'


def load():
    spec = importlib.util.spec_from_file_location('end_packages_to_products', MIGRATION)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


@tagged('post_install', '-at_install', 'liwan')
class TestPackagesMigration(TransactionCase):
    """The end script moves CRM's marked packages and the products leads name onto the products service."""

    def setUp(self):
        super().setUp()
        self.company = self.env.company
        self.other = self.env['res.company'].create({'name': 'Migration other company'})
        Template = self.env['product.template']
        self.own = Template.create({'name': 'Own', 'company_id': self.company.id})
        self.foreign = Template.create({'name': 'Foreign', 'company_id': self.other.id})
        self.everywhere = Template.create({'name': 'Everywhere'})
        self.plain = Template.create({'name': 'Named by a lead only', 'company_id': self.company.id})
        self.unrelated = Template.create({'name': 'Unrelated'})
        self.env.cr.execute('ALTER TABLE product_template ADD COLUMN liwan_crm_package boolean')
        marked = [self.own.id, self.foreign.id, self.everywhere.id]
        self.env.cr.execute('UPDATE product_template SET liwan_crm_package = true WHERE id = ANY(%s)', [marked])
        self.lead = self.env['crm.lead'].create({
            'name': 'Old lead', 'type': 'opportunity', 'company_id': self.company.id, 'liwan_package_id': self.plain.id,
        })
        self.env['liwan.crm.settings'].search([]).unlink()

    def packages(self, company):
        return self.env['liwan.crm.settings']._liwan_packages(company, archived=True)

    def test_packages_and_named_products_are_adopted_and_recorded_per_company(self):
        load().migrate(self.env.cr, PREVIOUS)
        self.env.invalidate_all()
        for product in (self.own, self.foreign, self.everywhere, self.plain):
            self.assertTrue(product.liwan_product, product.name)
            self.assertFalse(product.company_id, product.name)
        self.assertFalse(self.unrelated.liwan_product)
        self.assertEqual(self.packages(self.company), self.own | self.everywhere)
        self.assertEqual(self.packages(self.other), self.foreign | self.everywhere)
        self.assertEqual(self.lead.liwan_package_id, self.plain, 'the lead keeps its package')
        self.assertNotIn(self.plain, self.packages(self.company), 'a product only a lead names is not offered')
        self.assertFalse(column_exists(self.env.cr, 'product_template', 'liwan_crm_package'))

    def test_a_second_run_changes_nothing(self):
        migration = load()
        migration.migrate(self.env.cr, PREVIOUS)
        migration.migrate(self.env.cr, PREVIOUS)
        self.env.invalidate_all()
        self.assertEqual(self.packages(self.company), self.own | self.everywhere)

    def test_a_fresh_install_runs_nothing(self):
        load().migrate(self.env.cr, None)
        self.assertTrue(column_exists(self.env.cr, 'product_template', 'liwan_crm_package'))
        self.assertFalse(self.own.liwan_product)
