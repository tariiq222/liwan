# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields
from odoo.exceptions import AccessError
from odoo.fields import Command
from odoo.tests import new_test_user, tagged

from .common import LiwanMeetingsCase
from odoo.addons.liwan_meetings.models.meeting_access_service import (
    MEETINGS_PERMISSIONS,
    VENDOR_SUPPORT_MEETINGS_PERMISSIONS,
)
from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT

SUPPORT_PASSWORD = 'meetings_support_pass_123'


@tagged('post_install', '-at_install', 'liwan')
class TestMeetingsVendorSupport(LiwanMeetingsCase):
    """Vendor support manages the meetings settings and never reads or writes a meeting."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.env.ref('liwan_platform.tenant_profile').with_context(**{OPERATOR_CONTEXT: True}).write({
            'support_access_enabled': True,
        })
        cls.support = new_test_user(
            cls.env, login='meetings_support_live', password=SUPPORT_PASSWORD,
            groups='liwan_core.group_vendor_support', company_id=cls.env.company.id,
            company_ids=[Command.set(cls.env.company.ids)],
        )

    def test_support_holds_only_the_settings_permission(self):
        effective = self.env['liwan.access.service'].with_user(self.support).with_company(self.env.company)
        self.assertEqual(effective._liwan_capability_keys() & MEETINGS_PERMISSIONS, set(VENDOR_SUPPORT_MEETINGS_PERMISSIONS))

    def test_support_holds_no_meeting_content_group(self):
        self.assertFalse(self.support.has_group('liwan_meetings.group_cap_meetings_manage'))
        self.assertFalse(self.support.has_group('liwan_platform.group_maintenance_manager'))
        with self.assertRaises(AccessError):
            self.env['liwan.meeting.event'].with_user(self.support).search([])

    def test_support_cannot_list_meetings(self):
        self.authenticate(self.support.login, SUPPORT_PASSWORD)
        response = self.api('GET', '/api/v1/meetings')
        self.assertEqual((response.status_code, response.json()['code']), (403, 'forbidden'), response.text)

    def test_support_cannot_create_a_meeting(self):
        self.authenticate(self.support.login, SUPPORT_PASSWORD)
        response = self.api('POST', '/api/v1/meetings', {
            'name': 'Support meeting', 'meeting_date': fields.Date.to_string(fields.Date.today()),
        })
        self.assertEqual((response.status_code, response.json()['code']), (403, 'forbidden'), response.text)

    def test_support_reads_the_meetings_settings(self):
        self.authenticate(self.support.login, SUPPORT_PASSWORD)
        response = self.api('GET', '/api/v1/meetings/settings')
        self.assertEqual(response.status_code, 200, response.text)
