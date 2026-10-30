# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import TransactionCase, tagged


@tagged('webvue')
class TestWebVueGroups(TransactionCase):

    def test_groups_imply_odoo_groups(self):
        employee = self.env.ref('webvue_core.group_employee')
        admin = self.env.ref('webvue_core.group_customer_admin')
        vendor = self.env.ref('webvue_core.group_vendor_support')

        self.assertIn(self.env.ref('base.group_user'), employee.all_implied_ids)

        # webvue has no time logging (spec 2026-09-04): the employee role must not
        # carry the timesheet group even on a database where hr_timesheet happens
        # to be installed.
        timesheet_group = self.env.ref('hr_timesheet.group_hr_timesheet_user', raise_if_not_found=False)
        if timesheet_group:
            self.assertNotIn(timesheet_group, employee.all_implied_ids)
        self.assertNotIn('hr_timesheet', self.env['ir.module.module']._get('webvue_core').dependencies_id.mapped('name'))

        self.assertIn(self.env.ref('base.group_user'), admin.all_implied_ids)
        self.assertIn(self.env.ref('webvue_core.group_cap_access_users_assign_roles'), admin.all_implied_ids)
        self.assertNotIn(employee, admin.all_implied_ids)
        self.assertNotIn(self.env.ref('base.group_erp_manager'), admin.all_implied_ids)
        self.assertNotIn(self.env.ref('base.group_system'), admin.all_implied_ids)

        self.assertIn(self.env.ref('base.group_system'), vendor.all_implied_ids)

    def test_core_depends_on_base_only(self):
        module = self.env['ir.module.module']._get('webvue_core')
        self.assertEqual(module.dependencies_id.mapped('name'), ['base'])

    def test_company_branding_defaults(self):
        company = self.env.ref('base.main_company')
        self.assertEqual(company.font, 'IBM_Plex_Sans_Arabic')
        self.assertEqual(company.primary_color, '#5b3f8c')
        selection = dict(self.env['res.company']._fields['font'].get_description(self.env)['selection'])
        self.assertEqual(selection['IBM_Plex_Sans_Arabic'], 'IBM Plex Sans Arabic')

    def test_admin_is_vendor_support(self):
        admin = self.env.ref('base.user_admin')
        self.assertTrue(admin.has_group('webvue_core.group_vendor_support'))
