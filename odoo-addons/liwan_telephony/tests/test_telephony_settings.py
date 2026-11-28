# Part of Odoo. See LICENSE file for copyright and licensing details.
"""The recording settings page (design 4.4, 8): what a read answers before and after a save, who may save, what a
write refuses, and the one push the agent receives."""
import json
import urllib.error

from odoo.fields import Command
from odoo.tests import new_test_user, tagged

from .common import (
    AGENT_KEY,
    AGENT_URL,
    MANAGER_PASSWORD,
    PHONE_USER_PASSWORD,
    LiwanTelephonyCase,
    set_feature,
)
from .test_telephony_calls import assert_refused
from odoo.addons.liwan_telephony.models.agent_client import (
    DATABASE_HEADER,
    SIGNATURE_HEADER,
    TIMESTAMP_HEADER,
    _liwan_sign_reverse,
)
from odoo.addons.liwan_telephony.models.feature_registry import EVENTS_FEATURE

SETTINGS = '/api/v1/telephony/settings'
OTHER_MANAGER_LOGIN = 'telephony_other_manager'
OTHER_MANAGER_PASSWORD = 'telephony_other_manager_pass_123'
DEFAULTS = {'recordingPolicy': 'off', 'recordingAnnouncement': True, 'recordingRetentionDays': 90}
SAVED = {'recordingPolicy': 'always', 'recordingAnnouncement': False, 'recordingRetentionDays': 30}


@tagged('post_install', '-at_install', 'liwan')
class TestTelephonySettings(LiwanTelephonyCase):

    def setUp(self):
        super().setUp()
        set_feature(self, EVENTS_FEATURE)
        self.sign_in(self.manager, MANAGER_PASSWORD)

    def test_a_company_without_a_row_reads_the_declared_defaults(self):
        """A fresh company is never a 404 and never a row written by a read."""
        response = self.api('GET', SETTINGS)
        self.assertEqual((response.status_code, response.json()), (200, DEFAULTS))
        self.assertFalse(self.env['liwan.telephony.settings'].search([]))

    def test_a_save_persists_and_answers_the_new_values(self):
        saved = self.api('PATCH', SETTINGS, json=SAVED)
        self.assertEqual((saved.status_code, saved.json()), (200, SAVED))
        self.assertEqual(self.api('GET', SETTINGS).json(), SAVED)
        row = self.env['liwan.telephony.settings'].search([])
        self.assertEqual(
            (row.recording_policy, row.recording_announcement, row.recording_retention_days),
            ('always', False, 30),
        )
        # An omitted key keeps its saved value: the page only sends what it changed.
        partial = self.api('PATCH', SETTINGS, json={'recordingRetentionDays': 7})
        self.assertEqual((partial.status_code, partial.json()), (200, {**SAVED, 'recordingRetentionDays': 7}))

    def test_only_a_manager_saves_the_settings(self):
        self.sign_in(self.phone_user, PHONE_USER_PASSWORD)
        self.assertEqual(self.api('GET', SETTINGS).json(), DEFAULTS)
        assert_refused(self, self.api('PATCH', SETTINGS, json={'recordingPolicy': 'always'}), 403, 'forbidden')
        self.assertFalse(self.env['liwan.telephony.settings'].search([]))

    def test_an_unknown_key_a_bad_enum_and_a_bad_value_answer_422(self):
        for payload, field in (
            ({'policy': 'always'}, 'policy'),
            ({'recordingPolicy': 'sometimes'}, 'recordingPolicy'),
            ({'recordingPolicy': None}, 'recordingPolicy'),
            ({'recordingPolicy': True}, 'recordingPolicy'),
            ({'recordingAnnouncement': 'yes'}, 'recordingAnnouncement'),
            ({'recordingAnnouncement': 1}, 'recordingAnnouncement'),
            ({'recordingRetentionDays': 0}, 'recordingRetentionDays'),
            ({'recordingRetentionDays': 3651}, 'recordingRetentionDays'),
            ({'recordingRetentionDays': '30'}, 'recordingRetentionDays'),
            ({'recordingRetentionDays': True}, 'recordingRetentionDays'),
        ):
            assert_refused(self, self.api('PATCH', SETTINGS, json=payload), 422, 'invalid', field)
        self.assertFalse(self.env['liwan.telephony.settings'].search([]))

    def test_each_company_reads_and_saves_its_own_settings(self):
        branch = self.env['res.company'].create({'name': 'Telephony settings branch'})
        self.manager.company_ids = [Command.link(branch.id)]
        self.env['liwan.access.assignment'].sudo().create({
            'user_id': self.manager.id,
            'role_id': self.env.ref('liwan_telephony.role_telephony_manager').id,
            'company_id': branch.id,
        })
        self.assertEqual(self.api('PATCH', SETTINGS, json=SAVED).status_code, 200)
        self.manager.company_id = branch.id
        self.authenticate(self.manager.login, MANAGER_PASSWORD)
        self.assertEqual(self.api('GET', SETTINGS).json(), DEFAULTS)
        branch_values = {'recordingPolicy': 'off', 'recordingAnnouncement': True, 'recordingRetentionDays': 3650}
        self.assertEqual(self.api('PATCH', SETTINGS, json=branch_values).json(), branch_values)
        self.manager.company_id = self.company.id
        self.authenticate(self.manager.login, MANAGER_PASSWORD)
        self.assertEqual(self.api('GET', SETTINGS).json(), SAVED)
        branch_row = self.env['liwan.telephony.settings'].search([('company_id', '=', branch.id)])
        self.assertEqual(branch_row.recording_retention_days, 3650)

    def test_a_manager_of_another_company_cannot_read_or_write_this_row(self):
        """The row is per company, not per session: a manager who belongs to another company only reads and writes
        that company's row, and this company's saved values never move."""
        self.assertEqual(self.api('PATCH', SETTINGS, json=SAVED).status_code, 200)
        other = self.env['res.company'].create({'name': 'Telephony settings other company'})
        other_manager = new_test_user(
            self.env, login=OTHER_MANAGER_LOGIN, password=OTHER_MANAGER_PASSWORD,
            name='Other Company Manager', groups='liwan_core.group_employee',
            company_id=other.id, company_ids=[Command.set([other.id])],
        )
        self.env['liwan.access.assignment'].sudo().create({
            'user_id': other_manager.id,
            'role_id': self.env.ref('liwan_telephony.role_telephony_manager').id,
            'company_id': other.id,
        })
        self.authenticate(OTHER_MANAGER_LOGIN, OTHER_MANAGER_PASSWORD)
        # Not this company's saved values: the row is not visible outside its company.
        self.assertEqual(self.api('GET', SETTINGS).json(), DEFAULTS)
        other_values = {'recordingPolicy': 'always', 'recordingAnnouncement': True, 'recordingRetentionDays': 3650}
        written = self.api('PATCH', SETTINGS, json=other_values)
        self.assertEqual((written.status_code, written.json()), (200, other_values))
        mine = self.env['liwan.telephony.settings'].search([('company_id', '=', self.company.id)])
        self.assertEqual(
            (mine.recording_policy, mine.recording_announcement, mine.recording_retention_days),
            ('always', False, 30),
        )
        other_row = self.env['liwan.telephony.settings'].search([('company_id', '=', other.id)])
        self.assertEqual(other_row.recording_retention_days, 3650)
        self.assertEqual(len(self.env['liwan.telephony.settings'].search([])), 2)

    def test_a_save_tells_the_agent_once_and_a_failure_keeps_the_write(self):
        self.set_agent()
        sent = []

        def record(method, url, payload, headers):
            sent.append((method, url, payload, headers))
            return {'ok': True}

        self.patch_agent(record)
        saved = self.api('PATCH', SETTINGS, json=SAVED)
        self.assertEqual(saved.status_code, 200, saved.text)
        self.assertEqual(len(sent), 1)
        method, url, payload, headers = sent[0]
        self.assertEqual((method, url), ('PUT', f'{AGENT_URL}/recording/config'))
        self.assertEqual(json.loads(payload), {'database': self.env.cr.dbname, 'policy': 'always', 'announce': False})
        self.assertEqual(headers[DATABASE_HEADER], self.env.cr.dbname)
        self.assertEqual(
            headers[SIGNATURE_HEADER],
            _liwan_sign_reverse(AGENT_KEY, headers[TIMESTAMP_HEADER], 'PUT', '/recording/config', payload),
        )

        def fail(method, url, payload, headers):
            reason = 'agent down'
            raise urllib.error.URLError(reason)

        self.patch_agent(fail)
        kept = self.api('PATCH', SETTINGS, json={'recordingPolicy': 'off', 'recordingRetentionDays': 14})
        self.assertEqual(
            (kept.status_code, kept.json()),
            (200, {'recordingPolicy': 'off', 'recordingAnnouncement': False, 'recordingRetentionDays': 14}),
        )
        self.assertEqual(self.api('GET', SETTINGS).json(), kept.json())
