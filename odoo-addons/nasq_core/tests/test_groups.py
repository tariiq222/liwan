# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import TransactionCase, tagged


@tagged('nasq')
class TestNasqGroups(TransactionCase):

    def test_groups_imply_odoo_groups(self):
        employee = self.env.ref('nasq_core.group_employee')
        admin = self.env.ref('nasq_core.group_customer_admin')
        vendor = self.env.ref('nasq_core.group_vendor_support')

        self.assertIn(self.env.ref('base.group_user'), employee.all_implied_ids)
        self.assertIn(self.env.ref('project.group_project_user'), employee.all_implied_ids)
        self.assertIn(self.env.ref('hr_timesheet.group_hr_timesheet_user'), employee.all_implied_ids)

        self.assertIn(employee, admin.all_implied_ids)
        self.assertIn(self.env.ref('project.group_project_manager'), admin.all_implied_ids)
        self.assertIn(self.env.ref('hr.group_hr_manager'), admin.all_implied_ids)
        self.assertIn(self.env.ref('base.group_erp_manager'), admin.all_implied_ids)
        self.assertNotIn(self.env.ref('base.group_system'), admin.all_implied_ids)

        self.assertIn(self.env.ref('base.group_system'), vendor.all_implied_ids)

    def test_company_branding_defaults(self):
        company = self.env.ref('base.main_company')
        self.assertEqual(company.font, 'IBM_Plex_Sans_Arabic')
        self.assertEqual(company.primary_color, '#18181b')
        selection = dict(self.env['res.company']._fields['font'].get_description(self.env)['selection'])
        self.assertEqual(selection['IBM_Plex_Sans_Arabic'], 'IBM Plex Sans Arabic')

    def test_admin_is_vendor_support(self):
        admin = self.env.ref('base.user_admin')
        self.assertTrue(admin.has_group('nasq_core.group_vendor_support'))
        self.assertTrue(admin.has_group('nasq_core.group_employee'))
