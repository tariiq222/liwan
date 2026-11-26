# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .common import LiwanTelephonyCase, set_feature


@tagged('post_install', '-at_install', 'liwan')
class TestTelephonyCalls(LiwanTelephonyCase):

    def setUp(self):
        super().setUp()
        set_feature(self, 'telephony.enabled')
        set_feature(self, 'telephony.recording')

    def test_the_call_shape_is_whitelisted(self):
        self.authenticate('telephony_manager', 'telephony_manager_pass_123')
        result = self.api('GET', f'/api/v1/telephony/calls/{self.call.id}')
        self.assertEqual(result.status_code, 200)
        body = result.json()
        self.assertEqual(body['linkedid'], '1764049999.1')
        self.assertEqual(body['durationSeconds'], 125)
        self.assertNotIn('password', body)

    def test_a_user_without_the_capability_is_refused(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        result = self.api('GET', '/api/v1/telephony/calls')
        self.assertEqual((result.status_code, result.json()['code']), (403, 'forbidden'))

    def test_the_duration_is_computed_not_stored(self):
        self.assertEqual(self.call.duration_seconds, 125)
        self.call.ended_at = '2026-11-25 09:01:00'
        self.assertEqual(self.call.duration_seconds, 60)

    def test_a_lookup_by_number_finds_the_call(self):
        self.authenticate('telephony_manager', 'telephony_manager_pass_123')
        result = self.api('GET', '/api/v1/telephony/lookup?number=%2B966500000000')
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()['lastCalls'][0]['linkedid'], '1764049999.1')
