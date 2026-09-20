# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import ValidationError
from odoo.tests import TransactionCase, tagged


@tagged('post_install', '-at_install', 'nasq')
class TestTenantProfile(TransactionCase):

    def test_profile_is_singleton_with_one_root(self):
        profile = self.env.ref('nasq_platform.tenant_profile')
        self.assertEqual(profile.root_company_id, self.env.ref('base.main_company'))
        self.assertEqual(self.env['nasq.tenant.profile'].search_count([]), 1)

    def test_ensure_raises_when_multiple_roots_and_no_profile(self):
        Profile = self.env['nasq.tenant.profile'].sudo()
        self.env['ir.model.data'].search([
            ('module', '=', 'nasq_platform'), ('name', '=', 'tenant_profile'),
        ]).unlink()
        self.env.cr.execute('DELETE FROM nasq_tenant_profile')
        Profile.invalidate_model()
        self.env['res.company'].create({'name': 'Second root company'})
        with self.assertRaises(ValidationError) as error:
            Profile._nasq_ensure_root_company()
        self.assertIn('cannot guess root company', str(error.exception))
