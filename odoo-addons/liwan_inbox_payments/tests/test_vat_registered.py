# Part of Odoo. See LICENSE file for full copyright and licensing details.
import base64

from odoo import Command
from odoo.exceptions import AccessError
from odoo.tests import new_test_user, tagged

from .common import CATALOG_ID, SAUDI_VAT, TaxModeCase, image_bytes
from odoo.addons.liwan_inbox_payments.serializers.catalog import dump_catalog
from odoo.addons.liwan_payments.tests.common import TAX_EXCLUDED, TAX_INCLUDED

PASSWORD = 'inbox_pay_pass_123'


@tagged('post_install', '-at_install', 'liwan')
class TestCatalogPriceIsTheCustomerTotal(TaxModeCase):
    """A Meta item shows the total the customer pays; stock's company setting decides where the tax sits."""

    def test_an_item_of_115_with_a_15_percent_tax_shows_115_included_and_132_25_added(self):
        for mode, expected in ((TAX_INCLUDED, 115.0), (TAX_EXCLUDED, 132.25)):
            with self.subTest(mode=mode):
                self.set_mode(mode)
                item = self.make_item(self.catalog, self.taxed_product(f'Taxed {mode}'))
                self.assertEqual(item.price, expected)
                self.assertEqual(self.pushed_price(self.run_sync()), f'{expected:.2f}')

    def test_an_unregistered_company_shows_the_typed_price_under_both_modes(self):
        self.tax_company.write({'liwan_vat_registered': False})
        for mode in (TAX_INCLUDED, TAX_EXCLUDED):
            with self.subTest(mode=mode):
                self.set_mode(mode)
                item = self.make_item(self.catalog, self.taxed_product(f'Untaxed {mode}'))
                self.assertEqual(item.price, 115.0)
                self.assertEqual(self.pushed_price(self.run_sync()), '115.00')

    def test_the_catalog_answer_carries_no_tax_choice_of_the_establishment(self):
        # Registration and price mode belong to the company's tax settings: the catalog answer neither offers nor repeats them.
        body = dump_catalog(self.catalog)
        self.assertFalse({'prices_include_tax', 'vat_registered'} & set(body))


@tagged('post_install', '-at_install', 'liwan')
class TestCatalogBranchUsesTheRootTax(TaxModeCase):
    """A branch catalog's product carries a tax the root owns: stock's hierarchy decides, not the catalog company."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        # The establishment's registration is the root's one decision (``TaxModeCase`` registered it), so the branch
        # row stores nothing of its own: ``_liwan_vat_registered()`` answers from the root for both.
        cls.branch = cls.catalog_company('Catalog branch', parent=cls.tax_company)
        cls.branch_business_account = '200000000077'
        cls.make_channel(phone_id='100000000010', business_account_id=cls.branch_business_account,
                         owner_company_id=cls.branch.id)
        cls.branch_catalog = cls.env['liwan.inbox.catalog'].create({
            'company_id': cls.branch.id, 'business_account_id': cls.branch_business_account,
            'meta_catalog_id': CATALOG_ID, 'name': 'Branch prices', 'brand': 'Acme',
            'default_link': 'https://shop.example.test',
        })
        cls.branch_tax_group = cls.env['account.tax.group'].create({'name': 'Branch taxes', 'company_id': cls.branch.id})
        cls.branch_owned_tax = cls.env['account.tax'].with_company(cls.branch).create({
            'name': 'Branch VAT 15', 'amount': 15, 'amount_type': 'percent', 'type_tax_use': 'sale',
            'company_id': cls.branch.id, 'tax_group_id': cls.branch_tax_group.id,
        })

    def test_a_branch_catalog_shows_the_branch_owned_tax_under_both_modes(self):
        product = self.env['product.product'].create({
            'name': 'Branch owned tax', 'type': 'consu', 'list_price': 115.0, 'company_id': self.branch.id,
            'taxes_id': [Command.set(self.branch_owned_tax.ids)], 'image_1920': base64.b64encode(image_bytes()),
        })
        for mode, expected in ((TAX_INCLUDED, 115.0), (TAX_EXCLUDED, 132.25)):
            with self.subTest(mode=mode):
                self.set_mode(mode)
                item = self.make_item(self.branch_catalog, product, retailer_id=f'own-{mode}')
                self.assertEqual(item.product_id.taxes_id._filter_taxes_by_company(self.branch), self.branch_owned_tax)
                self.assertEqual(item.price, expected)
                self.assertEqual(self.pushed_price(self.run_sync(self.branch)), f'{expected:.2f}')
                item.unlink()

    def test_a_branch_catalog_of_an_unregistered_establishment_shows_the_typed_price_under_both_modes(self):
        self.tax_company.write({'liwan_vat_registered': False})
        for mode in (TAX_INCLUDED, TAX_EXCLUDED):
            with self.subTest(mode=mode):
                self.set_mode(mode)
                item = self.make_item(
                    self.branch_catalog, self.taxed_product(f'Branch untaxed {mode}', company=self.branch),
                )
                self.assertEqual(item.price, 115.0)
                self.assertEqual(self.pushed_price(self.run_sync(self.branch)), '115.00')

    def test_a_branch_catalog_shows_the_root_tax_under_both_modes(self):
        for mode, expected in ((TAX_INCLUDED, 115.0), (TAX_EXCLUDED, 132.25)):
            with self.subTest(mode=mode):
                self.set_mode(mode)
                item = self.make_item(self.branch_catalog, self.taxed_product(f'Branch taxed {mode}', company=self.branch))
                self.assertEqual(item.catalog_id.company_id, self.branch)
                self.assertEqual(item.price, expected)
                self.assertEqual(self.pushed_price(self.run_sync(self.branch)), f'{expected:.2f}')

    def test_a_branch_only_session_shows_the_root_owned_tax_it_cannot_read_and_the_preview_equals_the_push(self):
        """Plan decision D24: the price function reads the establishment's tax elevated, after the capability check.

        The fence hides a root-owned tax from a branch-only session, yet the branch manager sees the same total the sync
        pushes to Meta, on the item read route and the item list alike.
        """
        self.set_mode(TAX_EXCLUDED)
        item = self.synced(self.make_item(self.branch_catalog, self.taxed_product('Branch session', company=self.branch)))
        user = new_test_user(
            self.env, login='branch_catalog_manager', password=PASSWORD, name='Branch catalog manager',
            groups='liwan_core.group_employee', company_id=self.branch.id,
        )
        user.company_ids = [Command.set(self.branch.ids)]
        self.env['liwan.access.assignment'].create({
            'user_id': user.id, 'role_id': self.env.ref('liwan_inbox.role_inbox_manager').id,
            'company_id': self.branch.id,
        })
        item.invalidate_recordset(['price', 'unit_price', 'currency'])
        self.assertEqual(item.with_user(user).price, 132.25)
        self.authenticate(user.login, PASSWORD)
        shown = self.api('GET', f'/api/v1/inbox/catalog-items/{item.id}')
        self.assertEqual(shown.status_code, 200, shown.text)
        listed = self.api('GET', f'/api/v1/inbox/catalogs/{self.branch_catalog.id}/items')
        self.assertEqual([row['price'] for row in listed.json()['items']], [132.25])
        item.write({'sync_state': 'pending'})
        pushed = self.pushed_price(self.run_sync(self.branch))
        self.assertEqual(f"{shown.json()['price']:.2f}", pushed)
        self.assertEqual(pushed, '132.25')


@tagged('post_install', '-at_install', 'liwan')
class TestCatalogResyncOnTaxMode(TaxModeCase):
    """A price-mode change republishes the synced prices of its establishment (root and branches), and only those."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.branch = cls.catalog_company('Mode branch', parent=cls.tax_company)
        cls.branch_catalog = cls.make_company_catalog(cls.branch, '100000000013', '200000000080', 'Branch')
        cls.other_company = cls.catalog_company('Other tenant branch', price_mode=TAX_INCLUDED)
        cls.other_catalog = cls.make_company_catalog(cls.other_company, '100000000011', '200000000078', 'Other')

    @classmethod
    def make_company_catalog(cls, company, phone_id, business_account, name):
        cls.make_channel(phone_id=phone_id, business_account_id=business_account, owner_company_id=company.id)
        return cls.env['liwan.inbox.catalog'].create({
            'company_id': company.id, 'business_account_id': business_account, 'meta_catalog_id': CATALOG_ID,
            'name': name, 'brand': name, 'default_link': 'https://shop.example.test',
        })

    def setUp(self):
        super().setUp()
        self.item = self.synced(self.make_item(self.catalog, self.taxed_product('Mode taxed')))
        self.branch_item = self.synced(self.make_item(
            self.branch_catalog, self.taxed_product('Mode branch taxed', company=self.branch),
        ))
        self.other_item = self.synced(self.make_item(self.other_catalog, self.product2))

    def states(self):
        return (self.item.sync_state, self.branch_item.sync_state, self.other_item.sync_state)

    def test_a_price_mode_change_republishes_the_synced_prices(self):
        # Both ends are stated: the fixture computes under tax_included (115 is the total the customer pays), and the
        # write below moves it to tax_excluded (132.25). Writing the value the company already has is not a change.
        self.assertEqual(self.tax_company.account_price_include, TAX_INCLUDED)
        self.set_mode(TAX_EXCLUDED)
        self.assertEqual(self.item.sync_state, 'pending')
        self.assertEqual(self.pushed_price(self.run_sync()), '132.25')
        self.assertEqual(self.item.sync_state, 'synced')
        self.set_mode(TAX_INCLUDED)
        self.assertEqual(self.item.sync_state, 'pending')
        self.assertEqual(self.pushed_price(self.run_sync()), '115.00')

    def test_a_root_price_mode_change_resends_the_root_and_branch_items_once_each(self):
        self.set_mode(TAX_EXCLUDED)
        self.assertEqual(self.states(), ('pending', 'pending', 'synced'))
        # One request per item: the root's own and the branch's, never the other establishment's.
        self.assertEqual(self.pushed_prices(self.run_sync()), ['132.25', '132.25'])
        self.assertEqual(self.states(), ('synced', 'synced', 'synced'))
        self.assertEqual(self.pushed_prices(self.run_sync()), [], 'nothing is sent twice')

    def test_a_price_mode_write_that_changes_nothing_resends_nothing(self):
        self.set_mode(TAX_EXCLUDED)
        self.run_sync()
        self.assertEqual(self.states(), ('synced', 'synced', 'synced'))
        self.set_mode(TAX_EXCLUDED)
        self.assertEqual(self.states(), ('synced', 'synced', 'synced'))

    def test_another_establishments_items_are_untouched_by_a_price_mode_change(self):
        self.set_mode(TAX_EXCLUDED)
        self.assertEqual(self.states(), ('pending', 'pending', 'synced'))

    def test_removing_and_pending_items_keep_their_state_when_the_mode_changes(self):
        removing = self.synced(self.make_item(self.catalog, self.taxed_product('Mode removing', price=10.0)))
        removing.sync_state = 'removing'
        pending = self.make_item(self.catalog, self.taxed_product('Mode pending', price=20.0))
        self.set_mode(TAX_EXCLUDED)
        self.assertEqual((removing.sync_state, pending.sync_state, self.item.sync_state), ('removing', 'pending', 'pending'))

    def test_a_branch_taking_its_roots_new_mode_resends_the_establishment_items(self):
        """What the bridge does for a reactivated branch: the archived row, left behind by the root's change, catches up.

        Base copies a root's value to its active branches only, so the branch keeps the old mode while it is archived
        and a sync may run meanwhile on that stale mode. The later write of the root's value to the branch row is a
        change of the establishment's price facts again.
        """
        self.branch.active = False
        self.tax_company.write({'account_price_include': TAX_EXCLUDED})
        self.assertEqual(self.branch.with_context(active_test=False).account_price_include, TAX_INCLUDED)
        self.synced(self.branch_item)
        self.assertEqual(self.branch_item.sync_state, 'synced')
        self.branch.with_context(active_test=False).write({'account_price_include': TAX_EXCLUDED})
        self.assertEqual(self.branch_item.sync_state, 'pending')

    def test_reactivating_an_archived_branch_resends_its_items_through_the_bridge(self):
        if 'liwan.company.tax.service' not in self.env:
            self.skipTest('liwan_api_account is not installed: its res.company.write copies the root mode on reactivation')
        self.branch.active = False
        self.tax_company.write({'account_price_include': TAX_EXCLUDED})
        self.synced(self.branch_item)
        self.branch.active = True
        self.assertEqual(self.branch.account_price_include, TAX_EXCLUDED)
        self.assertEqual(self.branch_item.sync_state, 'pending')

    def test_the_tax_service_resends_the_items_of_the_whole_establishment(self):
        if 'liwan.company.tax.service' not in self.env:
            self.skipTest('liwan_api_account is not installed: it owns liwan.company.tax.service')
        manager = new_test_user(
            self.env, login='price_mode_manager', groups='liwan_core.group_employee',
            company_id=self.tax_company.id, company_ids=[Command.set(self.tax_company.ids)],
        )
        self.env['liwan.access.service']._liwan_replace_assignments(manager, [{
            'role_id': self.env.ref('liwan_core.role_system_admin').id, 'company_id': self.tax_company.id,
        }])
        service = self.env['liwan.company.tax.service'].with_user(manager).with_company(self.tax_company)
        service._liwan_write(price_mode=TAX_EXCLUDED)
        self.assertEqual(self.states(), ('pending', 'pending', 'synced'))
        service._liwan_write(price_mode=TAX_EXCLUDED)
        self.run_sync()
        service._liwan_write(price_mode=TAX_EXCLUDED)
        self.assertEqual(self.states(), ('synced', 'synced', 'synced'))


@tagged('post_install', '-at_install', 'liwan')
class TestBranchCatalogResyncOnVatRegistration(TaxModeCase):
    """A catalog owned by a BRANCH follows its establishment's registration, which only the ROOT stores."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.branch = cls.catalog_company('Resync branch', parent=cls.tax_company)
        cls.branch_business_account = '200000000079'
        cls.make_channel(phone_id='100000000012', business_account_id=cls.branch_business_account,
                         owner_company_id=cls.branch.id)
        cls.branch_catalog = cls.env['liwan.inbox.catalog'].create({
            'company_id': cls.branch.id, 'business_account_id': cls.branch_business_account,
            'meta_catalog_id': CATALOG_ID, 'name': 'Branch prices', 'brand': 'Acme',
            'default_link': 'https://shop.example.test',
        })

    def setUp(self):
        super().setUp()
        # "Tax added", so registering changes the shown total from 115 to 132.25 and the resync is observable.
        self.set_mode(TAX_EXCLUDED)
        self.register(False)
        self.branch_item = self.synced(self.make_item(self.branch_catalog, self.taxed_product('Branch registration taxed')))
        self.assertEqual(self.branch_item.price, 115.0)

    def register(self, registered):
        """The establishment's one decision, written where it is stored: on the root company."""
        self.tax_company.write({'vat': SAUDI_VAT, 'liwan_vat_registered': registered})

    def test_the_branch_item_is_republished_when_the_root_registration_changes(self):
        self.assertFalse(self.branch.liwan_vat_registered, 'the branch row never stores the decision')
        self.register(True)
        self.assertTrue(self.branch._liwan_vat_registered())
        self.assertEqual(self.branch_item.sync_state, 'pending')
        self.assertEqual(self.branch_item.price, 132.25)
        self.assertEqual(self.pushed_price(self.run_sync(self.branch)), '132.25')
        self.assertEqual(self.branch_item.sync_state, 'synced')
        self.register(False)
        self.assertFalse(self.branch._liwan_vat_registered())
        self.assertEqual(self.branch_item.sync_state, 'pending')
        self.assertEqual(self.branch_item.price, 115.0)
        self.assertEqual(self.pushed_price(self.run_sync(self.branch)), '115.00')

    def test_a_root_write_that_leaves_the_registration_unchanged_resends_nothing(self):
        self.register(True)
        self.run_sync(self.branch)
        self.register(True)
        self.assertEqual(self.branch_item.sync_state, 'synced')


@tagged('post_install', '-at_install', 'liwan')
class TestCatalogResyncOnVatRegistration(TaxModeCase):
    """Switching the establishment's registration republishes the prices Meta already holds, and only its catalogs'."""

    def setUp(self):
        super().setUp()
        # "Tax added", so registering changes the shown total from 115 to 132.25 and the resync is observable.
        self.set_mode(TAX_EXCLUDED)
        self.tax_company.write({'liwan_vat_registered': False})
        self.item = self.synced(self.make_item(self.catalog, self.taxed_product('Registration taxed')))
        self.other_item = self.synced(self.make_item(self.catalog, self.product2))

    def register(self, registered):
        self.tax_company.write({'liwan_vat_registered': registered})

    def test_turning_registration_on_and_off_republishes_the_synced_prices(self):
        self.assertEqual(self.item.price, 115.0)
        self.register(True)
        self.assertEqual(self.item.sync_state, 'pending')
        self.assertEqual(self.item.price, 132.25, 'the price follows the registration with no manual refresh')
        self.assertEqual(self.pushed_price(self.run_sync()), '132.25')
        self.assertEqual(self.item.sync_state, 'synced')
        self.register(False)
        self.assertEqual(self.item.sync_state, 'pending')
        self.assertEqual(self.item.price, 115.0)
        self.assertEqual(self.pushed_price(self.run_sync()), '115.00')

    def test_a_write_that_leaves_the_registration_unchanged_resends_nothing(self):
        self.register(True)
        self.run_sync()
        self.register(True)
        self.assertEqual(self.item.sync_state, 'synced')

    def test_removing_and_pending_items_keep_their_state(self):
        removing = self.synced(self.make_item(self.catalog, self.taxed_product('Removing', price=10.0)))
        removing.sync_state = 'removing'
        pending = self.make_item(self.catalog, self.taxed_product('Pending', price=20.0))
        self.assertEqual(pending.sync_state, 'pending')
        self.register(True)
        self.assertEqual((removing.sync_state, pending.sync_state, self.item.sync_state), ('removing', 'pending', 'pending'))

    def test_a_system_administrator_with_no_inbox_right_can_switch_it_and_the_items_are_republished(self):
        admin = new_test_user(
            self.env, login='vat_flip_admin', groups='liwan_core.group_employee',
            company_id=self.tax_company.id, company_ids=[Command.set(self.tax_company.ids)],
        )
        self.env['liwan.access.service']._liwan_replace_assignments(admin, [{
            'role_id': self.env.ref('liwan_core.role_system_admin').id, 'company_id': self.tax_company.id,
        }])
        with self.assertRaises(AccessError):
            self.item.with_user(admin).catalog_id  # noqa: B018 - the precondition: the administrator reads no catalog item
        self.tax_company.with_user(admin).with_company(self.tax_company)._liwan_write_company_profile({
            'vat': SAUDI_VAT, 'liwan_vat_registered': True,
        })
        self.assertEqual(self.item.sync_state, 'pending')
        self.assertEqual(self.pushed_price(self.run_sync()), '132.25')
