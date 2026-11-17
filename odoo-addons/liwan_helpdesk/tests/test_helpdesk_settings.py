# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The settings surface: the policy a tenant shapes, its revision guard and its presets."""
from .common import LiwanHelpdeskCase
from odoo.addons.liwan_helpdesk.models.helpdesk_settings import PRESET_VALUES


class SettingsApiTest(LiwanHelpdeskCase):

    def get_settings(self):
        response = self.api('GET', '/api/v1/helpdesk/settings')
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_a_manager_reads_the_policy_and_an_agent_does_not(self):
        self.as_user(self.agent)
        self.assertEqual(self.api('GET', '/api/v1/helpdesk/settings').status_code, 403)
        self.as_user(self.supervisor)
        self.assertEqual(self.api('GET', '/api/v1/helpdesk/settings').status_code, 200)
        self.as_user(self.manager)
        body = self.get_settings()
        self.assertEqual(body['visibility'], 'team')
        self.assertEqual(body['reference_prefix'], 'HD')
        self.assertEqual(body['options']['visibility'][0]['value'], 'own')
        self.assertEqual(body['options']['ranges']['reopen_days'], [0, 90])

    def test_the_manager_changes_the_policy_with_its_revision(self):
        self.as_user(self.manager)
        current = self.get_settings()
        response = self.api('PATCH', '/api/v1/helpdesk/settings', json={
            'revision': current['revision'], 'visibility': 'all', 'reference_prefix': 'TKT',
            'reopen_days': 3,
        })
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual((body['visibility'], body['reference_prefix'], body['reopen_days']), ('all', 'TKT', 3))
        self.assertEqual(body['revision'], current['revision'] + 1)
        stale = self.api('PATCH', '/api/v1/helpdesk/settings', json={
            'revision': current['revision'], 'visibility': 'team',
        })
        self.assertEqual((stale.status_code, stale.json()['code']), (409, 'conflict'))

    def test_a_preset_sets_several_values_and_explicit_keys_win(self):
        self.as_user(self.manager)
        current = self.get_settings()
        response = self.api('PATCH', '/api/v1/helpdesk/settings', json={
            'revision': current['revision'], 'preset': 'it', 'resolution_hours': 12,
        })
        body = response.json()
        self.assertEqual(body['preset'], 'it')
        self.assertEqual(body['first_response_hours'], PRESET_VALUES['it']['first_response_hours'])
        self.assertEqual(body['resolution_hours'], 12)

    def test_an_agent_cannot_change_the_policy_and_values_are_validated(self):
        self.as_user(self.agent)
        current = self.env['liwan.helpdesk.settings']._liwan_current().revision
        self.assertEqual(self.api('PATCH', '/api/v1/helpdesk/settings', json={
            'revision': current, 'visibility': 'all'}).status_code, 403)
        self.as_user(self.manager)
        for payload, field in (
            ({'visibility': 'everyone'}, 'visibility'),
            ({'preset': 'unknown'}, 'preset'),
            ({'reopen_days': 900}, 'reopen_days'),
            ({'first_response_hours': -1}, 'first_response_hours'),
            ({'reference_prefix': ''}, 'reference_prefix'),
            ({'default_priority': '9'}, 'default_priority'),
        ):
            response = self.api('PATCH', '/api/v1/helpdesk/settings',
                                json={'revision': self.env['liwan.helpdesk.settings']._liwan_current().revision,
                                      **payload})
            self.assertEqual((response.status_code, response.json()['code'], response.json()['field']),
                             (422, 'invalid', field))

    def test_the_sequence_carries_the_prefix(self):
        self.as_user(self.manager)
        current = self.get_settings()
        self.api('PATCH', '/api/v1/helpdesk/settings',
                 json={'revision': current['revision'], 'reference_prefix': 'SV'})
        self.as_user(self.agent)
        body = self.ticket_body()
        self.assertTrue(body['number'].startswith('SV'), body['number'])
