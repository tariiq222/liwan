# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import new_test_user

from odoo.addons.liwan_api.tests.common import LiwanApiCase


class LiwanIntegrationsCase(LiwanApiCase):
    """The shared liwan_api fixture plus a system administrator user and the seeded ZATCA link."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.admin = new_test_user(
            cls.env, login='integrations_admin', password='integrations_admin_pass_123',
            name='Integrations administrator', groups='liwan_core.group_employee',
        )
        cls.env['liwan.access.service']._liwan_replace_assignments(cls.admin, [{
            'role_id': cls.env.ref('liwan_core.role_system_admin').id,
            'company_id': cls.env.company.id,
        }])
        cls.connection = cls.env['liwan.integration.connection'].search([
            ('company_id', '=', cls.env.company.id), ('kind', '=', 'zatca'),
        ])
