# Part of Odoo. See LICENSE file for copyright and licensing details.
"""The daily retention run (design 4.4): which recordings the agent is asked to delete, what the answer expires, and
what stays available for the next run."""
import json
from datetime import timedelta

from odoo import fields
from odoo.tests import tagged

from .common import AGENT_KEY, AGENT_URL, LiwanTelephonyCase, set_feature
from odoo.addons.liwan_telephony.models.feature_registry import EVENTS_FEATURE
from odoo.addons.liwan_telephony.models.telephony_cron import (
    DELETE_RECORDINGS_PATH,
    RETENTION_BATCH,
)

RETENTION_DAYS = 30
CRON_LOGGER = 'odoo.addons.liwan_telephony.models.telephony_cron'


@tagged('post_install', '-at_install', 'liwan')
class TestRecordingRetention(LiwanTelephonyCase):

    def setUp(self):
        super().setUp()
        set_feature(self, EVENTS_FEATURE)
        self.env['liwan.telephony.settings']._liwan_current().write({
            'recording_policy': 'always',
            'recording_retention_days': RETENTION_DAYS,
        })
        self.set_agent(AGENT_URL, AGENT_KEY)
        self.sent = []
        self.patch_agent(self.answer_deleted)

    def answer_deleted(self, method, url, payload, headers):
        """The agent deletes every recording the run asks about."""
        asked = json.loads(payload)['linkedids']
        self.sent.append((method, url, asked))
        return {'deleted': asked, 'missing': []}

    def recorded_call(self, linkedid, *, state='ended', days_ago=RETENTION_DAYS + 1, ended=True, **values):
        stamp = fields.Datetime.now() - timedelta(days=days_ago)
        return self.env['liwan.telephony.call'].create({
            'linkedid': linkedid,
            'direction': 'out',
            'state': state,
            'recording_state': 'available',
            'started_at': stamp,
            'ended_at': stamp if ended else False,
            **values,
        })

    def expire(self):
        return self.env['liwan.telephony.cron']._liwan_expire_recordings()

    def test_a_recording_past_retention_is_expired_after_one_batched_request(self):
        old = self.recorded_call('1764200000.1')
        older = self.recorded_call('1764200000.2', days_ago=RETENTION_DAYS + 40)
        self.assertEqual(self.expire(), 2)
        self.assertEqual((old.recording_state, older.recording_state), ('expired', 'expired'))
        self.assertEqual(len(self.sent), 1)
        method, url, asked = self.sent[0]
        self.assertEqual((method, url), ('POST', f'{AGENT_URL}{DELETE_RECORDINGS_PATH}'))
        self.assertEqual(sorted(asked), ['1764200000.1', '1764200000.2'])
        # A second run asks nothing: nothing is available any more, so the run is idempotent.
        self.assertEqual(self.expire(), 0)
        self.assertEqual(len(self.sent), 1)

    def test_one_run_asks_about_one_bounded_batch_however_many_recordings_are_past_retention(self):
        """A database with more expired recordings than one batch keeps each request small: the rest wait a day."""
        oldest = self.recorded_call('1764200100.1', days_ago=RETENTION_DAYS + 400)
        for index in range(2, RETENTION_BATCH + 6):
            self.recorded_call(f'1764200100.{index}', days_ago=RETENTION_DAYS + 1)
        self.assertEqual(self.expire(), RETENTION_BATCH)
        self.assertEqual(len(self.sent), 1)
        self.assertEqual(len(self.sent[0][2]), RETENTION_BATCH)
        # The oldest is in the batch: the run is ordered by end time, so nothing expires ahead of older rows.
        self.assertIn(oldest.linkedid, self.sent[0][2])
        self.assertEqual(self.env['liwan.telephony.call'].search_count([
            ('recording_state', '=', 'available'),
        ]), 5)
        self.assertEqual(self.expire(), 5)
        self.assertEqual(self.sent[-1][2], [
            f'1764200100.{index}' for index in range(RETENTION_BATCH + 1, RETENTION_BATCH + 6)
        ])

    def test_every_company_expires_on_the_database_retention_window(self):
        """The one policy binds the database: the branch's call expires in the same batch as the root company's."""
        branch = self.env['res.company'].create({'name': 'Telephony retention branch'})
        mine = self.recorded_call('1764200007.1')
        theirs = self.env['liwan.telephony.call'].with_company(branch).create({
            'linkedid': '1764200007.2',
            'direction': 'out',
            'state': 'ended',
            'recording_state': 'available',
            'started_at': fields.Datetime.now() - timedelta(days=RETENTION_DAYS + 1),
            'ended_at': fields.Datetime.now() - timedelta(days=RETENTION_DAYS + 1),
        })
        self.assertEqual(self.expire(), 2)
        self.assertEqual((mine.recording_state, theirs.recording_state), ('expired', 'expired'))
        self.assertEqual(len(self.sent), 1)
        self.assertEqual(sorted(self.sent[0][2]), ['1764200007.1', '1764200007.2'])

    def test_a_recording_inside_retention_is_left_available_and_never_asked_about(self):
        recent = self.recorded_call('1764200001.1', days_ago=RETENTION_DAYS - 1)
        self.assertEqual(self.expire(), 0)
        self.assertEqual(recent.recording_state, 'available')
        self.assertEqual(self.sent, [])

    def test_an_in_progress_call_is_never_asked_about(self):
        answered = self.recorded_call('1764200002.1', state='answered', days_ago=RETENTION_DAYS + 10)
        self.assertEqual(self.expire(), 0)
        self.assertEqual((answered.state, answered.recording_state), ('answered', 'available'))
        self.assertEqual(self.sent, [])

    def test_a_recording_the_agent_reports_missing_is_expired(self):
        call = self.recorded_call('1764200003.1')

        def answer_missing(method, url, payload, headers):
            asked = json.loads(payload)['linkedids']
            self.sent.append((method, url, asked))
            return {'deleted': [], 'missing': asked}

        self.patch_agent(answer_missing)
        self.assertEqual(self.expire(), 1)
        self.assertEqual(call.recording_state, 'expired')

    def test_a_recording_the_agent_still_holds_stays_available(self):
        call = self.recorded_call('1764200004.1')
        self.patch_agent(lambda method, url, payload, headers: {'deleted': [], 'missing': []})
        with self.assertLogs(CRON_LOGGER, level='WARNING'):
            self.assertEqual(self.expire(), 0)
        self.assertEqual(call.recording_state, 'available')

    def test_a_finished_call_without_an_end_time_falls_back_to_its_creation(self):
        missed = self.recorded_call('1764200005.1', state='missed', ended=False)
        # Odoo strips the log-access columns from create and write vals, so the row is aged the way the other tests
        # of this repository age a record: one SQL update, then a fresh read.
        self.env.cr.execute(
            'UPDATE liwan_telephony_call SET create_date = %s WHERE id = %s',
            (fields.Datetime.now() - timedelta(days=RETENTION_DAYS + 5), missed.id),
        )
        missed.invalidate_recordset()
        self.assertEqual(self.expire(), 1)
        self.assertEqual(missed.recording_state, 'expired')

    def test_no_agent_leaves_every_recording_available(self):
        self.env['ir.config_parameter'].sudo().set_param('liwan.telephony.agent_url', '')
        call = self.recorded_call('1764200006.1')
        with self.assertLogs(CRON_LOGGER, level='WARNING'):
            self.assertEqual(self.expire(), 0)
        self.assertEqual(call.recording_state, 'available')
        self.assertEqual(self.sent, [])
