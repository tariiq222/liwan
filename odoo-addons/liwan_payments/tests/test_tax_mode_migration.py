# Part of Odoo. See LICENSE file for full copyright and licensing details.
import importlib.util
from pathlib import Path
from unittest.mock import patch

from odoo import Command
from odoo.exceptions import UserError
from odoo.tests import tagged
from odoo.tools.sql import column_exists, create_column

from .common import (
    TAX_EXCLUDED,
    TAX_INCLUDED,
    LiwanOrderCase,
    branch_values,
    company_values,
)

MIGRATION_DIR = Path(__file__).parents[1] / 'migrations' / '19.0.1.8.0'
ARCHIVE = MIGRATION_DIR / 'post-archive-tax-copies.py'
CARRY = MIGRATION_DIR / 'post-carry-tax-mode.py'


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@tagged('post_install', '-at_install', 'liwan')
class TestTaxModeMigration(LiwanOrderCase):
    """The 19.0.1.8.0 migration archives the tax copies and carries the old payments tax mode into stock.

    Both columns the migration reads are the ones this version removes, and Odoo 19 leaves a removed field's column
    behind, so the test recreates them as the earlier version had them. The transaction rolls the DDL back with the
    rows.
    """

    def setUp(self):
        super().setUp()
        if not column_exists(self.env.cr, 'liwan_payments_settings', 'tax_mode'):
            create_column(self.env.cr, 'liwan_payments_settings', 'tax_mode', 'varchar')
        if not column_exists(self.env.cr, 'account_tax', 'liwan_copy_of_id'):
            create_column(self.env.cr, 'account_tax', 'liwan_copy_of_id', 'int4')

    def set_stored_mode(self, company, mode):
        self.env['liwan.payments.settings'].create({'company_id': company.id})
        self.env.cr.execute('UPDATE liwan_payments_settings SET tax_mode = %s WHERE company_id = %s', [mode, company.id])
        self.env.invalidate_all()

    def migrate_carry(self):
        with patch.object(self.env.registry, '_liwan_payments_price_mode_carried', False, create=True):
            load(CARRY, 'carry_tax_mode').migrate(self.env.cr, '19.0.1.7.0')
        self.env.invalidate_all()

    def _legacy_open_quote(self, tax_amount):
        root = self.env['res.company'].create(company_values(
            'Legacy quote root', country_id=self.env.ref('base.sa').id, currency_id=self.env.ref('base.SAR').id,
        ))
        tax_group = self.env['account.tax.group'].create({'name': 'Legacy quote tax group', 'company_id': root.id})
        tax = self.env['account.tax'].with_company(root).create({
            'name': 'Legacy quote VAT', 'type_tax_use': 'sale', 'amount': tax_amount, 'tax_group_id': tax_group.id,
        })
        order = self.env['sale.order'].with_company(root).create({'partner_id': self.customer.id, 'company_id': root.id})
        self.env['sale.order.line'].create({
            'order_id': order.id, 'product_id': self.service.id, 'price_unit': 115, 'tax_ids': [Command.set(tax.ids)],
        })
        self.set_stored_mode(root, 'included')
        return root, tax, order

    def test_a_company_mode_change_reports_an_open_quote_before_changing_its_tax(self):
        root, tax, order = self._legacy_open_quote(15)
        self.assertFalse(tax.price_include_override)
        self.assertEqual(order.amount_total, 132.25)
        with self.assertRaises(UserError) as refusal:
            self.migrate_carry()
        self.assertIn(f'sale.order #{order.id}', str(refusal.exception))
        self.assertEqual(root.account_price_include, TAX_EXCLUDED)
        self.assertEqual(order.amount_total, 132.25)

    def test_a_company_mode_change_preserves_a_zero_rated_open_quote(self):
        root, _, order = self._legacy_open_quote(0)
        self.assertEqual(order.amount_total, 115)
        self.migrate_carry()
        self.assertEqual(root.account_price_include, TAX_INCLUDED)
        self.assertEqual((order.state, order.amount_total), ('draft', 115))

    def test_the_tax_copies_are_archived_and_stay_for_the_posted_documents_that_name_them(self):
        original = self.env['account.tax'].create({
            'name': 'VAT 15%', 'amount': 15.0, 'amount_type': 'percent', 'type_tax_use': 'sale',
            'company_id': self.env.company.id,
        })
        copy = original.copy({'name': 'VAT 15% (price included)'})
        self.env.cr.execute('UPDATE account_tax SET liwan_copy_of_id = %s WHERE id = %s', [original.id, copy.id])
        archive = load(ARCHIVE, 'post_archive_tax_copies')
        archive.migrate(self.env.cr, '19.0.1.7.0')
        # A rerun, which the real upgrade may make after an interrupted attempt, changes nothing new.
        archive.migrate(self.env.cr, '19.0.1.7.0')
        self.env.invalidate_all()
        taxes = self.env['account.tax'].with_context(active_test=False)
        self.assertFalse(taxes.browse(copy.id).active)
        self.assertTrue(taxes.browse(original.id).active)
        self.assertFalse(column_exists(self.env.cr, 'account_tax', 'liwan_copy_of_id'))

    def test_a_root_without_a_journal_item_carries_included_to_the_root_and_its_branches(self):
        # The stock value the carry must move is stated: ``tax_excluded`` here, whatever the installation default.
        root = self.env['res.company'].create(company_values('Carry root'))
        branch = self.env['res.company'].create(branch_values('Carry branch', root))
        self.set_stored_mode(root, 'included')
        self.assertEqual((root.account_price_include, branch.account_price_include), (TAX_EXCLUDED, TAX_EXCLUDED))
        self.migrate_carry()
        self.assertEqual((root.account_price_include, branch.account_price_include), (TAX_INCLUDED, TAX_INCLUDED))
        self.assertFalse(column_exists(self.env.cr, 'liwan_payments_settings', 'tax_mode'))

    def test_an_added_mode_becomes_tax_excluded_on_the_root_and_its_branches(self):
        # The opposite starting value, stated: the carry has to move it to ``tax_excluded``.
        root = self.env['res.company'].create(company_values('Added carry root', price_mode=TAX_INCLUDED))
        branch = self.env['res.company'].create(branch_values('Added carry branch', root))
        self.set_stored_mode(root, 'added')
        self.migrate_carry()
        self.assertEqual((root.account_price_include, branch.account_price_include), (TAX_EXCLUDED, TAX_EXCLUDED))

    def test_the_carry_reaches_an_archived_branch_that_base_does_not_propagate_to(self):
        """The carry reaches an archived branch, with or without base's own copy of a root-delegated field.

        An archived branch keeps the establishment's one value: it can be reactivated, and a branch whose value
        differs from its root's is refused. Base's copy searches with the root's context and the bridge may not even
        be installed, so the migration writes the branches it read with ``active_test=False`` as well as the root.
        """
        root = self.env['res.company'].create(company_values('Archived carry root'))
        branch = self.env['res.company'].create(branch_values('Archived carry branch', root))
        branch.active = False
        self.set_stored_mode(root, 'included')
        self.migrate_carry()
        companies = self.env['res.company'].with_context(active_test=False)
        self.assertEqual(companies.browse(root.id).account_price_include, TAX_INCLUDED)
        self.assertEqual(companies.browse(branch.id).account_price_include, TAX_INCLUDED)

    def test_a_root_without_a_row_defaults_to_included(self):
        root = self.env['res.company'].create(company_values('Default carry root'))
        self.assertEqual(root.account_price_include, TAX_EXCLUDED, 'the carry must have something to change')
        self.migrate_carry()
        self.assertEqual(root.account_price_include, TAX_INCLUDED)

    def test_a_root_with_a_journal_item_keeps_the_stock_value_it_computed_its_documents_under(self):
        # The fixture company is the tenant's root and it already posted an invoice.
        root = self.env.company
        self.assertTrue(root._existing_accounting())
        stock_value = root.account_price_include
        carried = 'tax_excluded' if stock_value == 'tax_included' else 'tax_included'
        self.set_stored_mode(root, 'included' if carried == 'tax_included' else 'added')
        with self.assertLogs(level='WARNING') as logs:
            self.migrate_carry()
        self.assertEqual(root.account_price_include, stock_value)
        self.assertIn(root.display_name, '\n'.join(logs.output))
        self.assertIn(carried, '\n'.join(logs.output))
        self.assertIn(stock_value, '\n'.join(logs.output))

    def test_a_branch_whose_mode_differs_from_its_root_stops_the_upgrade_and_names_both(self):
        # The refused state is the old payments column, not stock's field: the two companies still state the same
        # stock mode, which base's delegation requires of a branch.
        root = self.env['res.company'].create(company_values('Ambiguous root'))
        branch = self.env['res.company'].create(branch_values('Ambiguous branch', root))
        self.set_stored_mode(root, 'included')
        self.set_stored_mode(branch, 'added')
        with self.assertRaises(UserError) as raised:
            self.migrate_carry()
        self.assertIn('Ambiguous root', str(raised.exception))
        self.assertIn('Ambiguous branch', str(raised.exception))
        # Nothing was written for that establishment before the refusal.
        self.assertEqual((root.account_price_include, branch.account_price_include), (TAX_EXCLUDED, TAX_EXCLUDED))
