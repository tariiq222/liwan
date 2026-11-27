# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .common import LiwanTelephonyCase, set_feature


@tagged('post_install', '-at_install', 'liwan')
class TestTelephonySettings(LiwanTelephonyCase):

    def setUp(self):
        super().setUp()
        set_feature(self, 'telephony.enabled')

    def test_the_settings_are_read_and_patched(self):
        self.authenticate('telephony_manager', 'telephony_manager_pass_123')
        before = self.api('GET', '/api/v1/telephony/settings')
        self.assertEqual(before.status_code, 200)
        self.assertEqual(before.json()['recordingPolicy'], 'always')
        after = self.api('PATCH', '/api/v1/telephony/settings', json={'retentionDays': 30})
        self.assertEqual(after.status_code, 200, after.text)
        self.assertEqual(after.json()['retentionDays'], 30)

    def test_the_announcement_cannot_be_turned_off_while_recording_always(self):
        self.authenticate('telephony_manager', 'telephony_manager_pass_123')
        result = self.api('PATCH', '/api/v1/telephony/settings', json={'recordingAnnouncement': False})
        self.assertIn(result.status_code, (400, 422, 500))

    def test_a_line_never_returns_its_password(self):
        self.authenticate('telephony_manager', 'telephony_manager_pass_123')
        result = self.api('GET', '/api/v1/telephony/lines')
        self.assertEqual(result.status_code, 200, result.text)
        line = result.json()['items'][0]
        self.assertNotIn('password', line)
        self.assertFalse(line['hasPassword'])

    def test_an_existing_pbx_is_refused(self):
        self.authenticate('telephony_manager', 'telephony_manager_pass_123')
        result = self.api('POST', '/api/v1/telephony/lines', json={
            'name': 'Old PBX', 'kind': 'existing_pbx',
        })
        self.assertIn(result.status_code, (400, 422, 500))
