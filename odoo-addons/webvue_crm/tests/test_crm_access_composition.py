# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import new_test_user, tagged

from odoo.addons.webvue_crm.models.access_service import AGENT_PERMISSIONS, PERMISSIONS
from odoo.addons.webvue_crm.tests.common import WebVueCrmCase

CRM_KEYS = {
    'crm.leads.read', 'crm.leads.work', 'crm.leads.assign', 'crm.leads.import', 'crm.leads.export',
    'crm.discount.approve', 'crm.settings.read', 'crm.settings.manage', 'crm.audit.read',
}


@tagged('webvue', 'webvue_access', 'post_install', '-at_install')
class TestCrmAccessComposition(WebVueCrmCase):
    """webvue_crm owns its capabilities, groups and roles (spec R2); membership alone grants nothing."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.service = cls.env['webvue.access.service']

    def capabilities_of(self, user):
        return set(self.service._webvue_capability_keys(user, company=self.company))

    def test_capability_catalog_lists_crm_keys(self):
        keys = {c['key'] for c in self.service._webvue_capability_definitions() if c['owner'] == 'webvue_crm'}
        self.assertEqual(keys, CRM_KEYS)
        self.assertEqual(set(PERMISSIONS), CRM_KEYS)

    def test_every_capability_has_a_group_owned_by_the_addon(self):
        permissions = self.env['webvue.access.permission'].search([('key', 'in', sorted(CRM_KEYS))])
        self.assertEqual(set(permissions.mapped('key')), CRM_KEYS)
        for permission in permissions:
            self.assertTrue(permission.group_xmlid.startswith('webvue_crm.group_cap_crm_'), permission.key)
            self.assertTrue(self.env.ref(permission.group_xmlid, raise_if_not_found=False), permission.key)

    def test_agent_role_grants_only_read_and_work(self):
        self.assertEqual(self.capabilities_of(self.agent) & CRM_KEYS, {'crm.leads.read', 'crm.leads.work'})
        self.assertEqual(set(AGENT_PERMISSIONS), {'crm.leads.read', 'crm.leads.work'})

    def test_manager_role_grants_every_crm_key(self):
        self.assertEqual(self.capabilities_of(self.manager) & CRM_KEYS, CRM_KEYS)

    def test_membership_alone_grants_no_crm_key(self):
        self.assertFalse(self.capabilities_of(self.outsider) & CRM_KEYS)

    def test_roles_are_built_in_protected_and_unique(self):
        for xmlid, key in (('webvue_crm.role_crm_agent', 'crm_agent'), ('webvue_crm.role_crm_manager', 'crm_manager')):
            role = self.env.ref(xmlid)
            self.assertEqual((role.key, role.type, role.protected), (key, 'built_in', True))
            self.assertEqual(self.env['webvue.access.role'].search_count([('key', '=', key)]), 1)

    def test_every_other_key_requires_read_and_settings_manage_requires_settings_read(self):
        permissions = self.env['webvue.access.permission'].search([('key', 'in', sorted(CRM_KEYS))])
        by_key = {p.key: set(p.dependency_ids.mapped('key')) for p in permissions}
        for key in CRM_KEYS - {'crm.leads.read', 'crm.settings.read', 'crm.settings.manage'}:
            self.assertEqual(by_key[key], {'crm.leads.read'}, key)
        self.assertEqual(by_key['crm.settings.manage'], {'crm.settings.read'})
        self.assertEqual(by_key['crm.leads.read'], set())

    def test_roles_imply_the_stock_sales_groups_that_allow_orm_access(self):
        self.assertTrue(self.agent.has_group('sales_team.group_sale_salesman'))
        self.assertFalse(self.agent.has_group('sales_team.group_sale_salesman_all_leads'))
        self.assertTrue(self.manager.has_group('sales_team.group_sale_salesman_all_leads'))
        self.assertFalse(self.outsider.has_group('sales_team.group_sale_salesman'))

    def test_vendor_support_shortcut_grants_no_crm_key(self):
        support = new_test_user(
            self.env, login='crm_support', groups='webvue_core.group_vendor_support',
            company_id=self.company.id,
        )
        self.assertFalse(self.capabilities_of(support) & CRM_KEYS)
