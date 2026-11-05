# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The TikTok history import: the job its cron advances, its counters, its failures and its routes."""
import json
import os
import time
from datetime import timedelta
from unittest.mock import MagicMock, patch

import requests

from odoo import fields
from odoo.tests import tagged
from odoo.tests.common import HOST

from . import tiktok_payloads as tt
from .common import LiwanInboxCase
from odoo.addons.liwan_api.tests.common import cover_isolation_routes, set_probe_feature
from odoo.addons.liwan_inbox.adapters import tiktok
from odoo.addons.liwan_inbox.controllers.tiktok_oauth import encode_state
from odoo.addons.liwan_inbox.models.constants import (
    AUTOMATION_FEATURE,
    TIKTOK_ECHO_SETTLE,
    TIKTOK_FEATURE,
)

ACCESS_TOKEN = 'tiktok-access-token-sync'
REFRESH_TOKEN = 'tiktok-refresh-token-sync'
CONNECTED_OPEN_ID = 'business-open-id-connected'
REDIRECT_URI = 'https://liwan.test/api/v1/inbox/tiktok/callback'
CALLBACK = '/api/v1/inbox/tiktok/callback'
SYNC_PATH = '/api/v1/inbox/channels/%d/tiktok/sync'
# A conversation last updated outside the import window (D11: the last 90 days), in milliseconds like the fixtures.
OLD = 1_780_000_000_000
HISTORY = (('conv-a1', 'msg-a1'), ('conv-a2', 'msg-a2'), ('conv-b1', 'msg-b1'))
REASON_RUNNING = 'inbox_tiktok_sync_running'
PENDING = 'pending_conversation_ids'
cover_isolation_routes((
    '/api/v1/inbox/channels/<int:channel_id>/tiktok/sync',
), source='liwan_inbox/tests/test_tiktok_sync.py')


def response(body, status=200):
    """One HTTP answer for `requests.request`."""
    answer = MagicMock()
    answer.status_code = status
    answer.json.return_value = body
    return answer


def page(*conversation_ids, has_more=False, cursor=0):
    """One page of TikTok's conversation list, the shape `list_conversations` reads."""
    return response(tt.conversation_list(
        [tt.conversation_item(name) for name in conversation_ids], has_more=has_more, cursor=cursor,
    ))


def content(conversation_id, message_id, sender_id=tt.SENDER_ID, sender_name=tt.SENDER_NAME, body='Hi', timestamp=tt.SENT_AT):
    """One conversation's content list: a customer message whose sender name comes from the participants."""
    return response(tt.content_list(
        [tt.rest_message(
            'TEXT', {'body': body}, message_id=message_id, conversation_id=conversation_id,
            from_id=sender_id, timestamp=timestamp,
        )],
        [tt.participant('PERSONAL_ACCOUNT', sender_id, sender_name),
         tt.participant('BUSINESS_ACCOUNT', tt.BUSINESS_ID, 'liwan')],
    ))


@tagged('post_install', '-at_install', 'liwan')
class TestTikTokSync(LiwanInboxCase):
    """One connected business account imports its history in steps the cron runs, never twice."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        now = fields.Datetime.now()
        cls.tiktok = cls.env['liwan.inbox.channel'].create({
            'name': 'TikTok shop', 'kind': 'tiktok', 'tiktok_business_id': tt.BUSINESS_ID, 'state': 'connected',
        })
        cls.tiktok._liwan_tiktok_store(tiktok.TokenGrant(
            open_id=tt.BUSINESS_ID, scopes=frozenset(tiktok.SCOPES),
            access_token=ACCESS_TOKEN, refresh_token=REFRESH_TOKEN,
            expires_at=now + timedelta(days=1), refresh_expires_at=now + timedelta(days=365),
        ))

    def setUp(self):
        super().setUp()
        set_probe_feature(self, key=TIKTOK_FEATURE, enabled=True)
        self.login(self.manager)
        # The per-conversation image capability is one request of its own and the adapter tests cover its answer:
        # stubbing it keeps every expected HTTP answer below the one answer the history import reads.
        capability = patch.object(tiktok, 'image_send_capable', return_value=True)
        capability.start()
        self.addCleanup(capability.stop)

    # helpers

    def path(self, channel=None):
        return SYNC_PATH % (channel or self.tiktok).id

    def jobs(self, channel=None):
        return self.env['liwan.inbox.tiktok.sync'].search([('channel_id', '=', (channel or self.tiktok).id)], order='id')

    def queue(self):
        return self.tiktok._liwan_tiktok_queue_sync()

    def pending(self, job):
        job.invalidate_recordset([PENDING])
        return json.loads(job.pending_conversation_ids)

    def reload_job(self, job, *names):
        job.invalidate_recordset(names)
        return job

    def step(self, job):
        job._liwan_run_step()
        return job

    def run_steps(self, job, answers, steps):
        """Run `steps` steps of the job, feeding TikTok's answers in order; returns the request mock."""
        with patch.object(requests, 'request', side_effect=list(answers)) as request:
            for _step in range(steps):
                self.step(job)
        return request

    def customer(self, conversation_id, message_id):
        """One conversation of the history whose customer is that conversation's own participant."""
        return content(
            conversation_id, message_id,
            sender_id=f'sender-{conversation_id}', sender_name=f'sara-{conversation_id}',
        )

    def history(self):
        """TikTok's answers of a full import: two SINGLE pages, one STRANGER page, then one message per conversation."""
        return [
            page('conv-a1', has_more=True, cursor=7),
            response(tt.conversation_list([
                tt.conversation_item('conv-a2'), tt.conversation_item('conv-old', update_time=OLD),
            ])),
            page('conv-b1'),
            *(self.customer(conversation_id, message_id) for conversation_id, message_id in HISTORY),
        ]

    def callback(self, channel=None):
        """The connect callback of a new channel (or of `channel`), against a stubbed TikTok answer."""
        config = tiktok.AppConfig(tt.CLIENT_KEY, tt.CLIENT_SECRET, REDIRECT_URI)
        state = encode_state(config, {
            'c': self.env.company.id, 'u': self.manager.id, 'ch': channel.id if channel else 0,
            'n': 'TikTok shop', 'd': 0, 'h': HOST, 'x': int(time.time()) + 600,
        })
        now = fields.Datetime.now()
        grant = tiktok.TokenGrant(
            open_id=CONNECTED_OPEN_ID, scopes=frozenset(tiktok.SCOPES), access_token=ACCESS_TOKEN,
            refresh_token=REFRESH_TOKEN, expires_at=now + timedelta(days=1), refresh_expires_at=now + timedelta(days=365),
        )
        with patch.dict(os.environ, {
            'LIWAN_TIKTOK_CLIENT_KEY': tt.CLIENT_KEY,
            'LIWAN_TIKTOK_CLIENT_SECRET': tt.CLIENT_SECRET,
            'LIWAN_TIKTOK_REDIRECT_URI': REDIRECT_URI,
        }), patch.object(tiktok, 'exchange_code', return_value=grant), patch.object(
            tiktok, 'business_profile', return_value=tiktok.Profile('liwan_shop', 'Liwan Shop'),
        ):
            return self.url_open(f'{CALLBACK}?code=code-1&state={state}', method='GET', allow_redirects=False)

    def deliver(self, payload):
        """Deliver one webhook payload and process it on the next cron run, after the echo settle time."""
        self.env['liwan.inbox.event'].create({
            'channel_id': self.tiktok.id, 'owner_company_id': self.tiktok.owner_company_id.id,
            'payload': json.dumps(payload),
        })
        later = fields.Datetime.now() + TIKTOK_ECHO_SETTLE + timedelta(seconds=1)
        with patch('odoo.fields.Datetime.now', return_value=later):
            self.env['liwan.inbox.event']._liwan_run_events()

    def bell(self, conversation):
        return self.env['mail.message'].search_count([
            ('liwan_inbox_conversation_id', '=', conversation.id), ('liwan_notification_kind', '=', 'inbox.assigned'),
        ])

    # the job

    def test_a_new_channel_starts_with_a_queued_job(self):
        job = self.queue()
        self.assertEqual((job.state, job.phase, job.cursor), ('queued', 'single', 0))
        self.assertEqual((job.conversations_count, job.messages_count, job.error), (0, 0, False))
        self.assertFalse(job.started_at or job.finished_at)
        self.assertEqual(job.owner_company_id, self.tiktok.owner_company_id)
        self.assertEqual(self.pending(job), [])

    def test_the_connect_callback_queues_the_first_import(self):
        self.assertEqual(self.callback().status_code, 302)
        channel = self.env['liwan.inbox.channel'].search([('tiktok_business_id', '=', CONNECTED_OPEN_ID)])
        self.assertEqual(len(channel), 1)
        job = self.jobs(channel)
        self.assertEqual(len(job), 1)
        self.assertEqual((job.state, job.phase), ('queued', 'single'))
        self.assertEqual(job.owner_company_id, channel.owner_company_id)

    def test_a_reconnect_of_an_imported_account_queues_nothing(self):
        self.queue().write({'state': 'done'})
        self.assertEqual(self.callback(self.tiktok).status_code, 302)
        self.assertEqual(len(self.jobs()), 1)

    def test_steps_walk_single_then_stranger_pages_then_messages(self):
        job = self.queue()
        request = self.run_steps(job, self.history(), 4)
        self.assertEqual(request.call_count, 6)
        pages = [call.kwargs['params'] for call in request.call_args_list[:3]]
        self.assertEqual(
            [(params['conversation_type'], params['cursor']) for params in pages],
            [('SINGLE', 0), ('SINGLE', 7), ('STRANGER', 0)],
        )
        self.assertEqual(
            [call.args[1].partition('conversation_id=')[2].partition('&')[0] for call in request.call_args_list[3:]],
            [conversation_id for conversation_id, _message_id in HISTORY],
        )
        job = self.reload_job(job, 'state', 'phase', 'cursor', 'conversations_count', 'messages_count', 'finished_at')
        self.assertEqual((job.state, job.phase, job.cursor), ('done', 'messages', 0))
        self.assertEqual((job.conversations_count, job.messages_count), (3, 3))
        self.assertTrue(job.finished_at)
        self.assertFalse(self.env['liwan.inbox.conversation'].search([('provider_conversation_id', '=', 'conv-old')]))
        for conversation_id, message_id in HISTORY:
            message = self.env['liwan.inbox.message'].search([('provider_message_id', '=', message_id)])
            self.assertEqual(len(message), 1)
            self.assertEqual((message.direction, message.kind, message.body), ('in', 'text', 'Hi'))
            self.assertEqual(
                (message.conversation_id.provider_conversation_id, message.conversation_id.contact_id.name),
                (conversation_id, f'sara-{conversation_id}'),
                'the contact is named after the conversation participants, not after the open id',
            )

    def test_the_import_window_reads_both_timestamp_units(self):
        """TikTok answers the conversation update in milliseconds; a seconds value is read as one too."""
        job = self.queue()
        now = int(time.time())
        self.run_steps(job, [response(tt.conversation_list([
            {'conversation_id': 'conv-ms', 'update_time': (now - 3600) * 1000},
            {'conversation_id': 'conv-seconds', 'update_time': now - 3600},
            {'conversation_id': 'conv-old', 'update_time': OLD},
        ]))], 1)
        self.assertEqual(self.pending(job), ['conv-ms', 'conv-seconds'])

    def test_ten_conversations_of_messages_are_imported_per_step(self):
        job = self.queue()
        names = [f'conv-{number}' for number in range(12)]
        job.write({'phase': 'messages', PENDING: json.dumps(names)})
        answers = [content(name, f'msg-{name}', sender_id=f'sender-{name}', sender_name=f'sara-{name}') for name in names]
        self.run_steps(job, answers[:10], 1)
        self.assertEqual((len(self.pending(job)), job.messages_count, job.state), (2, 10, 'running'))
        self.run_steps(job, answers[10:], 1)
        self.assertEqual((self.pending(job), job.messages_count, job.state), ([], 12, 'done'))

    def test_an_empty_history_finishes_without_a_message_step(self):
        job = self.queue()
        request = self.run_steps(job, [page(), page()], 2)
        self.assertEqual(request.call_count, 2)
        self.assertEqual((job.state, job.phase), ('done', 'messages'))
        self.assertEqual((job.conversations_count, job.messages_count), (0, 0))

    def test_a_rerun_imports_nothing_twice(self):
        answers = self.history()
        first = self.queue()
        self.run_steps(first, answers, 4)
        self.assertEqual((first.messages_count, first.state), (3, 'done'))
        messages = self.env['liwan.inbox.message'].search_count([('provider_message_id', '!=', False)])
        second = self.queue()
        self.run_steps(second, answers, 4)
        self.reload_job(second, 'messages_count', 'state')
        self.assertEqual((second.messages_count, second.state), (0, 'done'))
        self.assertEqual(self.env['liwan.inbox.message'].search_count([('provider_message_id', '!=', False)]), messages)
        self.assertEqual(
            self.env['liwan.inbox.conversation'].search_count([
                ('provider_conversation_id', 'in', [conversation_id for conversation_id, _message_id in HISTORY]),
            ]),
            len(HISTORY),
        )

    def test_imported_messages_leave_the_conversation_as_it_was(self):
        """A historical message never reopens, unread-alerts, bells or answers (D11)."""
        set_probe_feature(self, key=AUTOMATION_FEATURE, enabled=True)
        rule = self.env['liwan.inbox.rule'].create({'name': 'Always', 'match_kind': 'any', 'assignee_id': self.agent.id})
        rule._liwan_set_reply({'body': 'auto reply'})
        contact = self.env['liwan.inbox.contact'].create({
            'name': 'Customer E', 'company_id': self.tiktok.owner_company_id.id,
        })
        identity = self.env['liwan.inbox.contact.identity'].create({
            'contact_id': contact.id, 'channel_kind': 'tiktok', 'address': tt.SENDER_ID,
            'company_id': self.tiktok.owner_company_id.id,
        })
        conversation = self.env['liwan.inbox.conversation'].create({
            'channel_id': self.tiktok.id, 'contact_id': contact.id, 'identity_id': identity.id,
            'company_id': self.tiktok.owner_company_id.id, 'provider_conversation_id': 'conv-e1', 'state': 'resolved',
        })
        job = self.queue()
        job.write({'phase': 'messages', PENDING: json.dumps(['conv-e1'])})
        recent = int(fields.Datetime.now().timestamp() * 1000)
        self.run_steps(job, [content('conv-e1', 'msg-e1', timestamp=recent)], 1)
        conversation.invalidate_recordset(['state', 'unread', 'assignee_id'])
        self.assertEqual((conversation.state, conversation.unread), ('resolved', False))
        self.assertFalse(conversation.assignee_id)
        self.assertFalse(self.env['liwan.inbox.message'].search_count([
            ('conversation_id', '=', conversation.id), ('automated', '=', True),
        ]))
        self.assertEqual(self.bell(conversation), 0)
        # The control: the same customer writing live runs the rule, so the assertions above are real.
        self.deliver(tt.receive_text(body='Live', message_id='msg-live', conversation_id='conv-e1', timestamp=recent))
        conversation.invalidate_recordset(['assignee_id'])
        self.assertEqual(conversation.assignee_id, self.agent)
        self.assertTrue(self.env['liwan.inbox.message'].search_count([
            ('conversation_id', '=', conversation.id), ('automated', '=', True),
        ]))
        self.assertEqual(self.bell(conversation), 1)

    # provider failures

    def test_a_non_retryable_provider_error_fails_the_job_without_a_retry(self):
        job = self.queue()
        refused = response(tt.answer({}, code=10001, message='the access token is invalid'))
        with patch.object(requests, 'request', return_value=refused) as request:
            self.step(job)
            self.assertEqual((job.state, job.error), ('failed', 'the access token is invalid'))
            self.assertTrue(job.finished_at)
            with patch.object(tiktok, 'list_conversations') as listing:
                self.env['liwan.inbox.tiktok.sync']._liwan_run_tiktok_sync()
            listing.assert_not_called()
        self.assertEqual(request.call_count, 1)

    def test_a_retryable_provider_error_waits_for_the_next_run(self):
        job = self.queue()
        with patch.object(requests, 'request', return_value=response({'message': 'provider is busy'}, status=503)):
            self.step(job)
        self.assertEqual((job.state, job.error, job.finished_at), ('running', False, False))
        self.run_steps(job, [page('conv-a1')], 1)
        self.assertEqual((job.phase, job.cursor, job.conversations_count), ('stranger', 0, 1))

    def test_an_expired_refresh_token_fails_the_job(self):
        job = self.queue()
        expired = fields.Datetime.now() - timedelta(minutes=1)
        self.tiktok.write({'token_expires_at': expired, 'refresh_expires_at': expired})
        with patch.object(requests, 'request') as request:
            self.step(job)
        self.assertEqual(job.state, 'failed')
        self.assertIn('Reconnect the TikTok account', job.error)
        self.assertEqual(request.call_count, 0)
        self.assertEqual(self.tiktok.state, 'error')

    # the cron

    def test_the_cron_advances_each_active_job_and_stops_with_the_feature(self):
        job = self.queue()
        with patch.object(tiktok, 'list_conversations', return_value=([], None)) as listing:
            self.env['liwan.inbox.tiktok.sync']._liwan_run_tiktok_sync()
            self.assertEqual((job.phase, listing.call_count), ('stranger', 1))
            self.env['liwan.inbox.tiktok.sync']._liwan_run_tiktok_sync()
        self.assertEqual((job.state, job.phase, listing.call_count), ('done', 'messages', 2))
        set_probe_feature(self, key=TIKTOK_FEATURE, enabled=False)
        other = self.queue()
        with patch.object(tiktok, 'list_conversations') as listing:
            self.env['liwan.inbox.tiktok.sync']._liwan_run_tiktok_sync()
        listing.assert_not_called()
        self.assertEqual(other.state, 'queued')
        self.assertEqual(self.env['liwan.inbox.tiktok.sync'].search_count([]), 2)

    # routes

    def test_the_routes_queue_and_report_the_latest_job(self):
        self.assertEqual(self.api('GET', self.path()).json(), {'job': None})
        started = self.api('POST', self.path())
        self.assertEqual(started.status_code, 201, started.text)
        job = self.jobs()
        self.assertEqual(len(job), 1)
        body = started.json()
        self.assertEqual(
            (body['id'], body['state'], body['phase'], body['conversations_count'], body['messages_count'], body['error']),
            (job.id, 'queued', 'single', 0, 0, None),
        )
        latest = self.api('GET', self.path())
        self.assertEqual(latest.status_code, 200, latest.text)
        self.assertEqual(latest.json()['job']['id'], job.id)

    def test_a_second_request_while_one_runs_is_refused(self):
        self.assertEqual(self.api('POST', self.path()).status_code, 201)
        refused = self.api('POST', self.path())
        self.assertError(refused, 422, 'invalid')
        self.assertEqual(refused.json()['details']['reason'], REASON_RUNNING)
        self.assertEqual(len(self.jobs()), 1)
        self.jobs().write({'state': 'done'})
        self.assertEqual(self.api('POST', self.path()).status_code, 201)
        self.assertEqual(len(self.jobs()), 2)

    def test_the_routes_need_the_capability_the_feature_and_the_company(self):
        self.login(self.agent)
        self.assertError(self.api('POST', self.path()), 403, 'forbidden')
        self.assertError(self.api('GET', self.path()), 403, 'forbidden')
        self.login(self.manager)
        set_probe_feature(self, key=TIKTOK_FEATURE, enabled=False)
        self.assertError(self.api('POST', self.path()), 403, 'feature_not_included')
        self.assertError(self.api('GET', self.path()), 403, 'feature_not_included')
        set_probe_feature(self, key=TIKTOK_FEATURE, enabled=True)
        self.assertError(self.api('GET', self.path(self.channel)), 404, 'not_found')
        other = self.env['res.company'].create({'name': 'Other tenant'})
        channel = self.env['liwan.inbox.channel'].create({
            'name': 'Other TikTok', 'kind': 'tiktok', 'owner_company_id': other.id,
            'tiktok_business_id': 'other-business-open-id',
        })
        job = self.env['liwan.inbox.tiktok.sync'].create({'channel_id': channel.id, 'owner_company_id': other.id})
        self.assertError(self.api('GET', self.path(channel)), 404, 'not_found')
        self.assertError(self.api('POST', self.path(channel)), 404, 'not_found')
        self.assertTrue(job.exists())
        Sync = self.env['liwan.inbox.tiktok.sync']
        self.assertFalse(Sync.with_user(self.manager).search([('id', '=', job.id)]))
