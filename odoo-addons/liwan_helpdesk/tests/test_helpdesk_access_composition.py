# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The capability catalog of the application: one owner per key, the roles that grant them, and the
vendor support exclusion that keeps the platform identity out of a tenant's tickets."""
from odoo.tests import TransactionCase, new_test_user, tagged

from odoo.addons.liwan_helpdesk.models.access_service import (
    AGENT_PERMISSIONS,
    PERMISSION_DEPENDENCIES,
    PERMISSIONS,
    REQUESTS_CREATE,
    REQUESTS_READ,
    SETTINGS_MANAGE,
    SETTINGS_READ,
    SUPERVISOR_PERMISSIONS,
)


@tagged('post_install', '-at_install', 'liwan', 'liwan_access')
class HelpdeskAccessCompositionTest(TransactionCase):

    def setUp(self):
        super().setUp()
        self.service = self.env['liwan.access.service']

    def test_every_key_is_owned_by_this_addon_once(self):
        definitions = self.service._liwan_capability_definitions()
        owned = [item for item in definitions if item['owner'] == 'liwan_helpdesk']
        self.assertEqual(sorted(item['key'] for item in owned), sorted(PERMISSIONS))
        catalog = self.service._liwan_capability_map()
        for key in PERMISSIONS:
            self.assertEqual(catalog[key]['owner'], 'liwan_helpdesk', key)
        permissions = self.env['liwan.access.permission'].search([('key', 'in', sorted(PERMISSIONS))])
        self.assertEqual(len(permissions), len(PERMISSIONS))
        xmlids = permissions.get_external_id()
        for permission in permissions:
            self.assertEqual(xmlids[permission.id].split('.')[0], 'liwan_helpdesk')
            self.assertTrue(self.env.ref(permission.group_xmlid, raise_if_not_found=False))

    def test_the_composed_dependencies_are_the_declared_ones(self):
        composed = self.service._liwan_permission_dependencies()
        for key, required in PERMISSION_DEPENDENCIES.items():
            self.assertEqual(composed[key], required, key)

    def test_the_built_in_roles_hold_their_grants(self):
        grants = self.service._liwan_builtin_role_grants()
        self.assertEqual(grants['liwan_helpdesk.role_helpdesk_agent'] & PERMISSIONS, AGENT_PERMISSIONS)
        self.assertEqual(grants['liwan_helpdesk.role_helpdesk_supervisor'] & PERMISSIONS, SUPERVISOR_PERMISSIONS)
        self.assertEqual(grants['liwan_helpdesk.role_helpdesk_manager'] & PERMISSIONS, PERMISSIONS)
        self.assertLessEqual({REQUESTS_READ, REQUESTS_CREATE}, grants['liwan_core.role_employee'])
        for xmlid in ('liwan_helpdesk.role_helpdesk_agent', 'liwan_helpdesk.role_helpdesk_supervisor',
                      'liwan_helpdesk.role_helpdesk_manager'):
            role = self.env.ref(xmlid)
            self.assertEqual(role.type, 'built_in')
            self.assertTrue(role.assignable)

    def test_vendor_support_never_reaches_a_ticket(self):
        vendor = new_test_user(
            self.env, login='helpdesk_vendor', name='Vendor', groups='liwan_core.group_vendor_support',
        )
        keys = self.service._liwan_capability_keys(vendor, company=self.env.company)
        self.assertFalse(keys & PERMISSIONS)

    def test_the_manager_role_reads_and_writes_the_settings(self):
        manager = new_test_user(
            self.env, login='helpdesk_roles_manager', name='Manager', groups='liwan_core.group_employee',
        )
        self.env['liwan.access.service']._liwan_replace_assignments(manager, [{
            'role_id': self.env.ref('liwan_helpdesk.role_helpdesk_manager').id,
            'company_id': self.env.company.id,
        }])
        keys = self.service._liwan_capability_keys(manager, company=self.env.company)
        self.assertLessEqual({SETTINGS_READ, SETTINGS_MANAGE}, keys)
        agent = new_test_user(
            self.env, login='helpdesk_roles_agent', name='Agent', groups='liwan_core.group_employee',
        )
        self.env['liwan.access.service']._liwan_replace_assignments(agent, [{
            'role_id': self.env.ref('liwan_helpdesk.role_helpdesk_agent').id,
            'company_id': self.env.company.id,
        }])
        agent_keys = self.service._liwan_capability_keys(agent, company=self.env.company)
        self.assertFalse({SETTINGS_READ, SETTINGS_MANAGE} & agent_keys)
