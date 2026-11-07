# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import AccessError, ValidationError
from odoo.tests import TransactionCase, new_test_user, tagged

SAUDI_VAT = '300000000000003'
ACTION = 'company.vat_registration_changed'


@tagged('post_install', '-at_install', 'liwan')
class TestVatRegistered(TransactionCase):
    """The company's VAT registration: off by default, one helper every layer reads, and an audited change."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company = cls.env.company
        cls.country = cls.env.ref('base.sa')
        cls.settings_admin = new_test_user(
            cls.env, login='vat_settings_admin', password='vat_settings_admin_123',
            groups='liwan_core.group_employee',
        )
        cls.env['liwan.access.service']._liwan_replace_assignments(cls.settings_admin, [{
            'role_id': cls.env.ref('liwan_core.role_system_admin').id,
            'company_id': cls.company.id,
        }])

    def setUp(self):
        super().setUp()
        self.company.write({'country_id': self.country.id, 'liwan_vat_registered': False, 'vat': False})
        # base_vat validates a partner number; liwan_core depends on base only, so a foundation-only install has no check.
        self.vat_checked = hasattr(self.env['res.partner'], '_run_vat_checks')

    def events(self):
        return self.env['liwan.access.audit'].search([
            ('action', '=', ACTION), ('target_id', '=', self.company.id),
        ], order='id')

    def test_a_company_is_not_registered_for_vat_by_default(self):
        company = self.env['res.company'].create({'name': 'Unregistered', 'country_id': self.country.id})
        self.assertFalse(company.liwan_vat_registered)
        self.assertFalse(company._liwan_vat_registered())

    def test_the_helper_answers_for_the_company_it_is_called_on(self):
        other = self.env['res.company'].create({
            'name': 'Other', 'country_id': self.country.id, 'vat': SAUDI_VAT, 'liwan_vat_registered': True,
        })
        self.company.write({'vat': SAUDI_VAT, 'liwan_vat_registered': True})
        self.assertTrue(self.company._liwan_vat_registered())
        self.assertTrue(other._liwan_vat_registered())
        other.write({'liwan_vat_registered': False})
        self.assertTrue(self.company._liwan_vat_registered())
        self.assertFalse(other._liwan_vat_registered())
        with self.assertRaises(ValueError):
            self.env['res.company']._liwan_vat_registered()

    def test_registering_without_a_vat_number_is_refused(self):
        for vat in (False, ''):
            with self.subTest(vat=vat), self.assertRaises(ValidationError), self.cr.savepoint():
                self.company.write({'vat': vat, 'liwan_vat_registered': True})
        self.assertFalse(self.company.liwan_vat_registered)

    def test_registering_with_a_number_that_is_not_the_country_format_is_refused(self):
        if not self.vat_checked:
            self.skipTest('base_vat is not installed: liwan_core alone carries no number format')
        for vat in ('12345', '400000000000003'):
            with self.subTest(vat=vat), self.assertRaises(ValidationError), self.cr.savepoint():
                self.company.write({'vat': vat, 'liwan_vat_registered': True})
        self.assertFalse(self.company.liwan_vat_registered)

    def test_registering_with_a_valid_number_registers_the_company(self):
        self.company.write({'vat': SAUDI_VAT, 'liwan_vat_registered': True})
        self.assertTrue(self.company._liwan_vat_registered())
        self.assertEqual(self.company.vat, SAUDI_VAT)

    def test_a_registered_company_cannot_lose_its_number(self):
        self.company.write({'vat': SAUDI_VAT, 'liwan_vat_registered': True})
        with self.assertRaises(ValidationError), self.cr.savepoint():
            self.company.vat = False
        self.assertTrue(self.company._liwan_vat_registered())

    def test_turning_it_off_keeps_the_number_and_needs_none(self):
        self.company.write({'vat': SAUDI_VAT, 'liwan_vat_registered': True})
        self.company.write({'liwan_vat_registered': False})
        self.assertFalse(self.company._liwan_vat_registered())
        self.assertEqual(self.company.vat, SAUDI_VAT)

    def test_every_change_is_audited_without_the_number(self):
        self.company.write({'vat': SAUDI_VAT})
        self.company.write({'liwan_vat_registered': True})
        self.company.write({'liwan_vat_registered': False})
        events = self.events()
        self.assertEqual(events.mapped('after'), [{'vat_registered': True}, {'vat_registered': False}])
        self.assertEqual(set(events.mapped('target_type')), {'company'})
        for column in ('before', 'after'):
            self.assertNotIn(SAUDI_VAT, str(events.mapped(column)))

    def test_a_write_that_changes_nothing_else_audits_nothing_extra(self):
        self.company.write({'vat': SAUDI_VAT})
        self.company.write({'city': 'Riyadh'})
        self.assertFalse(self.events())

    def test_the_profile_helper_writes_it_and_records_its_author(self):
        company = self.company.with_user(self.settings_admin)
        company._liwan_write_company_profile({'vat': SAUDI_VAT, 'liwan_vat_registered': True})
        self.assertTrue(self.company._liwan_vat_registered())
        event = self.events()[-1:]
        self.assertEqual(event.actor_id, self.settings_admin)
        self.assertEqual(event.after, {'vat_registered': True})

    def test_an_ordinary_employee_cannot_change_it(self):
        employee = new_test_user(self.env, login='vat_employee', groups='liwan_core.group_employee')
        with self.assertRaises(AccessError), self.cr.savepoint():
            self.company.with_user(employee)._liwan_write_company_profile({'liwan_vat_registered': True})
        self.assertFalse(self.company.liwan_vat_registered)
