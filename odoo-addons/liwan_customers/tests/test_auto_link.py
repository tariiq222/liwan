# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The automatic-linking setting and its reader: one match on an authenticated channel, none otherwise."""
from odoo.exceptions import AccessError
from odoo.tests import tagged

from odoo.addons.liwan_customers.tests.common import (
    PHONE_E164,
    SETTINGS,
    CustomersCase,
)

ADDRESS = PHONE_E164.removeprefix('+')


@tagged('post_install', '-at_install', 'liwan')
class TestAutoLinkSetting(CustomersCase):

    def create(self, name, **values):
        return self.env['liwan.customers.service']._liwan_create({'name': name, **values})

    @property
    def service(self):
        return self.env['liwan.customers.service']

    def match(self, company=None):
        return self.service._liwan_authenticated_single_match(ADDRESS, company or self.branch_a)

    def test_the_setting_is_off_by_default_and_a_single_match_links_nothing(self):
        self.create('Only match', phone=PHONE_E164)
        self.assertFalse(self.settings.auto_link_single_match)
        self.assertFalse(self.match())

    def test_with_the_setting_on_exactly_one_match_is_returned(self):
        customer = self.create('Only match', phone=PHONE_E164)
        self.settings.auto_link_single_match = True
        self.assertEqual(self.match(), customer)

    def test_a_phone_shared_by_two_customers_matches_neither(self):
        self.create('First', phone=PHONE_E164)
        self.create('Second', phone=PHONE_E164)
        self.settings.auto_link_single_match = True
        self.assertFalse(self.match())

    def test_no_match_and_a_number_that_is_no_phone_return_nothing(self):
        self.settings.auto_link_single_match = True
        self.assertFalse(self.match())
        self.assertFalse(self.service._liwan_authenticated_single_match('not-a-number', self.branch_a))

    def test_an_archived_customer_is_not_a_match(self):
        customer = self.create('Archived', phone=PHONE_E164)
        self.service._liwan_archive(customer)
        self.settings.auto_link_single_match = True
        self.assertFalse(self.match())

    def test_the_scope_is_the_channels_company_and_the_shared_customers(self):
        self.settings.sharing = 'branch'
        mine = self.service.with_company(self.branch_a)._liwan_create({'name': 'Branch A', 'phone': PHONE_E164})
        self.settings.auto_link_single_match = True
        self.assertEqual(self.match(self.branch_a), mine)
        self.assertFalse(self.match(self.branch_b), 'a customer of branch A is not in the scope of branch B')
        self.settings.sharing = 'establishment'
        shared = self.create('Shared other', phone='+966507654321')
        self.assertEqual(self.service._liwan_authenticated_single_match('966507654321', self.branch_b), shared)

    def test_a_user_cannot_run_the_automatic_match(self):
        self.settings.auto_link_single_match = True
        with self.assertRaises(AccessError):
            self.service.with_user(self.a_staff)._liwan_authenticated_single_match(ADDRESS, self.branch_a)

    def test_the_setting_is_read_and_written_through_the_settings_route(self):
        self.sign_in('cu_root_settings')
        read = self.api('GET', SETTINGS).json()
        self.assertIs(read['auto_link_single_match'], False)
        changed = self.api('PATCH', SETTINGS, {'auto_link_single_match': True, 'revision': read['revision']})
        self.assertEqual((changed.status_code, changed.json()['auto_link_single_match']), (200, True))
        self.assertTrue(self.settings.auto_link_single_match)
        for value in ('yes', 1, None):
            with self.subTest(value=value):
                bad = self.api('PATCH', SETTINGS, {'auto_link_single_match': value, 'revision': read['revision'] + 1})
                self.assertEqual((bad.status_code, bad.json()['field']), (422, 'auto_link_single_match'))

    def test_the_setting_needs_the_settings_capability_in_the_root_company(self):
        self.sign_in('cu_a_settings')
        denied = self.api('PATCH', SETTINGS, {'auto_link_single_match': True, 'revision': self.settings.revision})
        self.assertEqual(denied.status_code, 403)
        self.sign_in('cu_a_staff')
        denied = self.api('PATCH', SETTINGS, {'auto_link_single_match': True, 'revision': self.settings.revision})
        self.assertEqual(denied.status_code, 403)
        self.assertFalse(self.settings.auto_link_single_match)
