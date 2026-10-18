# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import new_test_user

from odoo.addons.webvue_api.tests.common import WebVueApiCase


class WebVueIntegrationsCase(WebVueApiCase):
    """The shared webvue_api fixture plus a system administrator user and the seeded ZATCA link."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.admin = new_test_user(
            cls.env, login='integrations_admin', password='integrations_admin_pass_123',
            name='Integrations administrator', groups='webvue_core.group_employee',
        )
        cls.env['webvue.access.service']._webvue_replace_assignments(cls.admin, [{
            'role_id': cls.env.ref('webvue_core.role_system_admin').id,
            'company_id': cls.env.company.id,
        }])
        cls.connection = cls.env['webvue.integration.connection'].search([
            ('company_id', '=', cls.env.company.id), ('kind', '=', 'zatca'),
        ])
