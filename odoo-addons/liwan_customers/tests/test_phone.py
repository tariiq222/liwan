# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""One phone normaliser for every customer: the tenant's phone country, Arabic digits and channel addresses."""
from odoo.tests import TransactionCase, tagged

from odoo.addons.liwan_core.models.access_service import LiwanAccessRule

E164 = '+966501234567'


@tagged('post_install', '-at_install', 'liwan')
class TestPhone(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.service = cls.env['liwan.customers.service']
        cls.settings = cls.env['liwan.customers.settings']._liwan_current()
        cls.root = cls.env['liwan.entitlement.service']._liwan_profile().root_company_id
        cls.root.country_id = cls.env.ref('base.sa')

    def test_the_phone_country_is_the_setting_then_the_root_company_then_saudi_arabia(self):
        self.assertEqual(self.service._liwan_phone_country(), self.env.ref('base.sa'))
        self.root.country_id = self.env.ref('base.eg')
        self.assertEqual(self.service._liwan_phone_country(), self.env.ref('base.eg'))
        self.settings.phone_country_id = self.env.ref('base.ae')
        self.assertEqual(self.service._liwan_phone_country(), self.env.ref('base.ae'))
        self.settings.phone_country_id = False
        self.root.country_id = False
        self.assertEqual(self.service._liwan_phone_country(), self.env.ref('base.sa'))

    def test_every_written_form_gives_one_number(self):
        for raw in ('0501234567', '+966501234567', '966501234567', '00966501234567', '050 123 4567',
                    '٠٥٠١٢٣٤٥٦٧', '۰۵۰۱۲۳۴۵۶۷', ' +966 50 123 4567 '):
            with self.subTest(raw=raw):
                self.assertEqual(self.service._liwan_normalize_phone(raw), E164)

    def test_a_channel_address_has_no_plus(self):
        self.assertEqual(self.service._liwan_normalize_phone('966501234567', channel=True), E164)
        self.assertEqual(self.service._liwan_normalize_phone('971501234567', channel=True), '+971501234567')

    def test_the_branch_country_does_not_change_the_reading(self):
        branch = self.env['res.company'].create({
            'name': 'Phone branch', 'parent_id': self.root.id, 'country_id': self.env.ref('base.ae').id,
        })
        self.assertEqual(self.service.with_company(branch)._liwan_normalize_phone('0501234567'), E164)

    def test_an_invalid_number_is_refused_on_the_phone_field(self):
        for raw in ('', '12', 'phone', '+9990000', None, 5):
            with self.subTest(raw=raw), self.assertRaises(LiwanAccessRule) as caught:
                self.service._liwan_normalize_phone(raw)
            self.assertEqual(
                (caught.exception.code, caught.exception.status, caught.exception.field), ('invalid_phone', 422, 'phone'),
            )
