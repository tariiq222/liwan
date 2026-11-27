# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Company isolation of the call routes: a call belongs to one company and is not-found in every other."""
from odoo.tests import tagged

from .common import EVENTS_FEATURE, set_feature
from odoo.addons.liwan_api.tests.common import (
    CompanyIsolationCase,
    assert_isolation_discovery,
    cover_isolation_routes,
)
from odoo.addons.liwan_telephony.models.feature_registry import RECORDING_FEATURE

CALL = '/api/v1/telephony/calls/{}'
EXPECTED_GET_RECORD_ROUTES = 2


@tagged('post_install', '-at_install', 'liwan')
class TestTelephonyCompanyIsolation(CompanyIsolationCase):
    """The company matrix, a telephony manager's grant in each company and one recorded call in each."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        set_feature(cls, EVENTS_FEATURE)
        set_feature(cls, RECORDING_FEATURE)
        role = cls.env.ref('liwan_telephony.role_telephony_manager')
        Assignment = cls.env['liwan.access.assignment'].sudo()
        cls.by_tag = {'p': cls.company_p, 'p1': cls.company_p1, 'p2': cls.company_p2, 'c': cls.company_c}
        for company in cls.by_tag.values():
            Assignment.create({'user_id': cls.iso_user.id, 'role_id': role.id, 'company_id': company.id})
        cls.calls = {
            tag: cls.env['liwan.telephony.call'].with_company(company).create({
                'linkedid': f'1764100000.{index}', 'direction': 'in', 'state': 'ended',
                'remote_number': '+966500000000', 'user_id': cls.iso_user.id,
                'company_id': company.id, 'recording_state': 'available',
                'started_at': '2026-11-25 09:00:00', 'ended_at': '2026-11-25 09:01:00',
            })
            for index, (tag, company) in enumerate(cls.by_tag.items())
        }

    def setUp(self):
        super().setUp()
        agent = type(self.env['liwan.telephony.agent'])
        self.patch(agent, '_liwan_post', lambda model, url, payload, key: {'url': 'https://recordings.test/x.wav'})
        params = self.env['ir.config_parameter'].sudo()
        params.set_param('liwan.telephony.agent_url', 'http://pbx-agent.test:8080')
        params.set_param('liwan.telephony.reverse_key', 'reverse-key')

    def test_a_call_and_its_recording_belong_to_one_company(self):
        for current, company in self.by_tag.items():
            self.env_in(company)
            listed = self.api('GET', '/api/v1/telephony/calls').json()
            self.assertEqual([item['companyId'] for item in listed['items']], [company.id])
            self.assertIs(self.assertVisible(CALL.format(self.calls[current].id)).json()['canListen'], True)
            self.assertEqual(self.api('GET', f'{CALL.format(self.calls[current].id)}/recording').status_code, 200)
            for tag, call in self.calls.items():
                if tag != current:
                    self.assertHiddenEveryWay('GET', CALL.format(call.id), self.by_tag[tag].id)
                    self.assertHidden(f'{CALL.format(call.id)}/recording')
        # Only the four calls of the four sessions were listened to: a hidden call never reached the agent.
        self.assertEqual(self.env['liwan.telephony.recording.access'].search_count([]), 4)

    def test_discovery_covers_every_get_record_route(self):
        assert_isolation_discovery(self, 'liwan_telephony', EXPECTED_GET_RECORD_ROUTES)


cover_isolation_routes((
    '/api/v1/telephony/calls/<int:call_id>',
    '/api/v1/telephony/calls/<int:call_id>/recording',
), 'liwan_telephony/tests/test_company_isolation.py')
