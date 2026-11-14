# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""D5 defaults and the stock root-delegated price mode: a root starts included, branches follow it."""
from unittest.mock import patch

from odoo.exceptions import UserError, ValidationError
from odoo.tests import tagged

from odoo.addons.liwan_api.models.tax_upgrade import PAYMENTS_PRICE_MODE_CARRIED
from odoo.addons.liwan_api_account.hooks import post_init_hook
from odoo.addons.liwan_api_account.tests.common import CompanyTaxCase


@tagged('post_install', '-at_install', 'liwan')
class TestCompanyTaxDefaults(CompanyTaxCase):

    def setUp(self):
        super().setUp()
        self.enterContext(patch.object(self.env.registry, PAYMENTS_PRICE_MODE_CARRIED, False, create=True))

    def test_a_new_root_starts_with_the_price_included(self):
        company = self.env['res.company'].create({'name': 'Fresh root'})
        self.assertEqual(company.account_price_include, 'tax_included')

    def test_a_new_branch_takes_its_root_s_value(self):
        branch = self.env['res.company'].create({'name': 'Fresh branch', 'parent_id': self.root.id})
        self.assertEqual(branch.account_price_include, self.root.account_price_include)

    def test_a_branch_of_an_excluded_root_starts_excluded(self):
        excluded = self.env['res.company'].create({
            'name': 'Excluded root', 'account_price_include': 'tax_excluded',
        })
        branch = self.env['res.company'].create({'name': 'Excluded branch', 'parent_id': excluded.id})
        self.assertEqual(branch.account_price_include, 'tax_excluded')

    def test_an_explicit_value_wins_over_the_default(self):
        company = self.env['res.company'].create({
            'name': 'Explicit root', 'account_price_include': 'tax_excluded',
        })
        self.assertEqual(company.account_price_include, 'tax_excluded')

    def test_a_root_change_reaches_the_active_branches(self):
        self.root.write({'account_price_include': 'tax_excluded'})
        self.assertEqual(self.branch.account_price_include, 'tax_excluded')
        self.assertEqual(self.root_archived_branch.account_price_include, 'tax_included')

    def test_base_refuses_a_branch_whose_mode_differs_from_its_root(self):
        """Stock's ``_check_root_delegated_fields``: the branch carries its root's value, never its own."""
        for company in (self.branch, self.root_archived_branch):
            with self.subTest(company=company.name), self.env.cr.savepoint(), \
                    self.assertRaises(ValidationError):
                company.write({'account_price_include': 'tax_excluded'})
        with self.env.cr.savepoint(), self.assertRaises(ValidationError):
            self.env['res.company'].create({
                'name': 'Explicit branch', 'parent_id': self.root.id,
                'account_price_include': 'tax_excluded',
            })
        self.env.invalidate_all()
        for company in (self.root, self.branch, self.root_archived_branch):
            self.assertEqual(company.account_price_include, 'tax_included', company.name)

    def test_the_install_hook_sets_included_on_an_establishment_without_journal_items(self):
        clean = self.env['res.company'].create({
            'name': 'Hook root', 'account_price_include': 'tax_excluded',
        })
        clean_branch = self.saudi_branch(clean, 'Hook branch')
        self.assertEqual(clean_branch.account_price_include, 'tax_excluded')
        post_init_hook(self.env)
        self.assertEqual(clean.account_price_include, 'tax_included')
        self.assertEqual(clean_branch.account_price_include, 'tax_included')

    def test_the_install_hook_keeps_the_mode_carried_from_payments_during_this_upgrade(self):
        clean = self.saudi_root('Carried root', account_price_include='tax_excluded')
        clean_branch = self.saudi_branch(clean, 'Carried branch')
        with patch.object(self.env.registry, PAYMENTS_PRICE_MODE_CARRIED, True):
            post_init_hook(self.env)
        self.assertEqual(clean.account_price_include, 'tax_excluded')
        self.assertEqual(clean_branch.account_price_include, 'tax_excluded')

    def test_the_install_hook_leaves_a_started_establishment_alone(self):
        started = self.saudi_root('Started root')
        started.write({'account_price_include': 'tax_excluded'})
        started_branch = self.saudi_branch(started, 'Started branch')
        self.invoice(started_branch, self.sale_tax(started_branch))
        post_init_hook(self.env)
        # Stock refuses a change once the root or any branch has a journal item: the hook leaves it as it is.
        self.assertEqual(started.account_price_include, 'tax_excluded')
        self.assertEqual(started_branch.account_price_include, 'tax_excluded')

    def test_the_install_hook_sets_purchase_taxes_to_added_and_leaves_the_rest(self):
        purchase = self.purchase_tax(self.root, name='Hook purchase')
        override = self.purchase_tax(self.root, name='Hook overridden')
        override.price_include_override = 'tax_included'
        sale = self.sale_tax(self.root, name='Hook sale')
        post_init_hook(self.env)
        self.assertEqual(purchase.price_include_override, 'tax_excluded')
        self.assertFalse(sale.price_include_override)
        self.assertEqual(override.price_include_override, 'tax_included')

    def differing_branch(self, parent, name):
        """A branch of ``parent`` that holds 'tax_included' while its root holds 'tax_excluded', as the old model allowed.

        Base refuses such a row now, so the value is set in SQL underneath its constraint.
        """
        branch = self.saudi_branch(parent, name)
        self.env.cr.execute("UPDATE res_company SET account_price_include = 'tax_included' WHERE id = %s", [branch.id])
        self.env.invalidate_all()
        self.assertNotEqual(branch.account_price_include, branch.root_id.account_price_include)
        return branch

    def test_the_install_hook_aligns_a_differing_branch_without_a_journal_item_of_a_started_root(self):
        started = self.saudi_root('Started aligned root')
        started.write({'account_price_include': 'tax_excluded'})
        self.invoice(started, self.sale_tax(started))
        branch = self.differing_branch(started, 'Started aligned branch')
        sub_branch = self.differing_branch(branch, 'Started aligned sub-branch')
        post_init_hook(self.env)
        self.assertEqual(started.account_price_include, 'tax_excluded')
        self.assertEqual(branch.account_price_include, 'tax_excluded')
        self.assertEqual(sub_branch.account_price_include, 'tax_excluded')

    def test_the_install_hook_refuses_a_differing_branch_that_holds_a_journal_item(self):
        started = self.saudi_root('Started warned root')
        started.write({'account_price_include': 'tax_excluded'})
        branch = self.differing_branch(started, 'Started warned branch')
        self.invoice(branch, self.sale_tax(branch))
        with self.assertRaises(UserError) as refused:
            post_init_hook(self.env)
        message = str(refused.exception)
        self.assertIn(started.display_name, message)
        self.assertIn(branch.display_name, message)
        self.assertEqual(branch.account_price_include, 'tax_included', 'stock refuses a change under journal items')

    def test_the_install_hook_refuses_a_differing_branch_with_journal_items_in_its_subtree(self):
        started = self.saudi_root('Started chain root')
        started.write({'account_price_include': 'tax_excluded'})
        branch = self.differing_branch(started, 'Started chain branch')
        sub_branch = self.saudi_branch(branch, 'Started chain sub-branch')
        self.invoice(sub_branch, self.sale_tax(sub_branch))
        with self.assertRaises(UserError) as refused:
            post_init_hook(self.env)
        self.assertIn(started.display_name, str(refused.exception))
        self.assertIn(branch.display_name, str(refused.exception))
        self.assertEqual(sub_branch.account_price_include, 'tax_included', 'it stays equal to its parent')
