# Part of Odoo. See LICENSE file for full copyright and licensing details.
import json
from datetime import timedelta
from unittest.mock import MagicMock, patch

import requests

from odoo import fields
from odoo.tests import tagged

from . import whatsapp_payloads as wa
from .common import ACCESS_TOKEN, WebVueInboxCase
from odoo.addons.webvue_api.tests.common import set_probe_feature
from odoo.addons.webvue_inbox.adapters import whatsapp

HOOK = '/api/v1/inbox/hooks/whatsapp'


def provider_response(status, body):
    mocked = MagicMock(status_code=status)
    mocked.json.return_value = body
    return mocked


@tagged('post_install', '-at_install', 'webvue')
class TestBranchCompanyWebhook(WebVueInboxCase):
    """The webhook reaches channels of every company, not only the main one."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.branch = cls.env['res.company'].create({'name': 'Branch inbox company'})
        cls.branch_channel = cls.make_channel(phone_id='700000000001', owner_company_id=cls.branch.id)

    def test_get_verify_reaches_a_branch_channel(self):
        query = f'hub.mode=subscribe&hub.verify_token={self.branch_channel.verify_token}&hub.challenge=77'
        response = self.url_open(f'{HOOK}?{query}')
        self.assertEqual((response.status_code, response.text), (200, '77'))

    def test_post_creates_the_event_in_the_branch_company(self):
        raw = wa.body_of(wa.inbound_text(phone_id='700000000001'))
        response = self.url_open(
            HOOK, data=raw, method='POST',
            headers={'Content-Type': 'application/json', 'X-Hub-Signature-256': wa.sign(raw)},
        )
        self.assertEqual((response.status_code, response.text), (200, 'ok'))
        event = self.env['webvue.inbox.event'].search([('channel_id', '=', self.branch_channel.id)])
        self.assertEqual((len(event), event.owner_company_id), (1, self.branch))

    def test_the_branch_channel_stays_invisible_to_main_company_staff(self):
        self.login(self.manager)
        ids = [c['id'] for c in self.get('/api/v1/inbox/channels').json()['items']]
        self.assertNotIn(self.branch_channel.id, ids)
        self.assertError(self.get(f'/api/v1/inbox/channels/{self.branch_channel.id}'), 404, 'not_found')


@tagged('post_install', '-at_install', 'webvue')
class TestWebhookMalformedShapes(WebVueInboxCase):

    def post(self, data):
        raw = json.dumps(data).encode()
        headers = {'Content-Type': 'application/json', 'X-Hub-Signature-256': wa.sign(raw)}
        return self.url_open(HOOK, data=raw, headers=headers, method='POST')

    def test_odd_shapes_answer_the_uniform_403_not_a_500(self):
        for body in (
            {'entry': [{'changes': [{'value': {'metadata': None}}]}]},
            {'entry': [{'changes': [{'value': {'metadata': {'phone_number_id': ['a', 1]}}}]}]},
            {'entry': [{'changes': [{'value': None}]}]},
            {'entry': 'text'}, {'entry': 5}, {'entry': [None, 3, 'x', {'changes': 7}]},
            {'entry': {'changes': []}}, {},
        ):
            self.assertError(self.post(body), 403, 'forbidden')
        self.assertFalse(self.env['webvue.inbox.event'].search([]))

    def test_an_unmatched_phone_still_computes_one_hmac(self):
        with patch.object(whatsapp, 'verify_signature', wraps=whatsapp.verify_signature) as verify:
            self.assertError(self.post(wa.inbound_text(phone_id='999999999999')), 403, 'forbidden')
        self.assertEqual(verify.call_count, 1)

    def test_parsing_ignores_malformed_pieces(self):
        payload = {'entry': [{'changes': [{'value': {
            'metadata': {'phone_number_id': 'p'}, 'contacts': 'x', 'messages': {'a': 1}, 'statuses': [1, None],
        }}]}]}
        self.assertEqual(whatsapp.parse_events(payload, 'p'), [])
        self.assertEqual(whatsapp.phone_number_ids(payload), {'p'})


@tagged('post_install', '-at_install', 'webvue')
class TestCronResilience(WebVueInboxCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.conversation = cls.make_conversation()

    def queue(self, body):
        return self.env['webvue.inbox.message'].create({
            'conversation_id': self.conversation.id, 'direction': 'out', 'body': body, 'delivery_state': 'queued',
            'next_attempt_at': fields.Datetime.now() - timedelta(seconds=1),
        })

    def test_the_outbox_commits_after_each_item_and_one_bad_item_does_not_block_the_queue(self):
        first, second = self.queue('one'), self.queue('two')
        sends = [RuntimeError(), 'wamid.OK2']

        def send(*_args):
            result = sends.pop(0)
            if isinstance(result, Exception):
                raise result
            return result

        with patch.object(whatsapp, 'send_text', side_effect=send):
            self.env['webvue.inbox.message']._webvue_run_outbox()
        self.assertEqual(self.commits.call_count, 3, 'once for the batch size and once per item')
        self.assertEqual((first.delivery_state, first.attempts, first.error), ('queued', 1, 'unexpected error: RuntimeError'))
        self.assertGreater(first.next_attempt_at, fields.Datetime.now())
        self.assertEqual((second.delivery_state, second.provider_message_id), ('sent', 'wamid.OK2'))

    def test_a_broken_event_keeps_its_attempt_counter_and_does_not_block_others(self):
        broken = self.env['webvue.inbox.event'].create({
            'channel_id': self.channel.id, 'owner_company_id': self.channel.owner_company_id.id, 'payload': '{}',
        })
        good = self.env['webvue.inbox.event'].create({
            'channel_id': self.channel.id, 'owner_company_id': self.channel.owner_company_id.id,
            'payload': json.dumps(wa.inbound_text()),
        })
        real = whatsapp.parse_events
        calls = []

        def parse(payload, phone_id):
            calls.append(payload)
            if len(calls) == 1:
                raise RuntimeError
            return real(payload, phone_id)

        with patch.object(whatsapp, 'parse_events', side_effect=parse):
            self.env['webvue.inbox.event']._webvue_run_events()
        self.assertEqual((broken.state, broken.attempts, broken.error), ('failed', 1, 'RuntimeError'))
        self.assertEqual(good.state, 'done')

    def test_a_disabled_channel_fails_the_message_with_a_clear_error(self):
        message = self.queue('x')
        self.channel.state = 'disabled'
        with patch.object(requests, 'request') as request:
            self.env['webvue.inbox.message']._webvue_run_outbox()
        self.assertEqual((request.call_count, message.delivery_state, message.error), (0, 'failed', 'The channel is disabled.'))

    def test_media_with_a_malformed_provider_answer_is_a_handled_failure(self):
        responses = [provider_response(200, {'mime_type': 'image/jpeg'})]
        with patch.object(requests, 'request', side_effect=responses):
            self.env['webvue.inbox.event'].create({
                'channel_id': self.channel.id, 'owner_company_id': self.channel.owner_company_id.id,
                'payload': json.dumps(wa.inbound_media()),
            })
            self.env['webvue.inbox.event']._webvue_run_events()
        message = self.env['webvue.inbox.message'].search([('provider_message_id', '=', 'wamid.IMG1')])
        self.assertEqual((message.body, message.error), ('[image]', 'malformed provider response'))


@tagged('post_install', '-at_install', 'webvue')
class TestReadStateAndStatuses(WebVueInboxCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.settings.visibility_policy = 'all'
        cls.conversation = cls.make_conversation(unread=True)

    def test_get_is_read_only_and_post_read_clears_the_flag(self):
        path = f'/api/v1/inbox/conversations/{self.conversation.id}'
        self.login(self.reader_only)
        self.assertTrue(self.get(path).json()['unread'])
        self.assertTrue(self.reload(self.conversation).unread)
        marked = self.api('POST', f'{path}/read')
        self.assertEqual((marked.status_code, marked.content), (204, b''))
        self.assertFalse(self.reload(self.conversation).unread)
        self.assertError(self.api('POST', '/api/v1/inbox/conversations/999999999/read'), 404, 'not_found')
        self.login(self.outsider)
        self.assertError(self.api('POST', f'{path}/read'), 403, 'forbidden')

    def test_a_read_only_role_opens_a_conversation_and_cannot_reply(self):
        self.login(self.reader_only)
        path = f'/api/v1/inbox/conversations/{self.conversation.id}'
        detail = self.get(path).json()
        self.assertEqual((detail['can_reply'], detail['can_assign']), (False, False))
        self.assertError(self.api('POST', f'{path}/messages', {'body': 'x'}), 403, 'forbidden')

    def test_a_read_only_tenant_can_still_open_a_conversation(self):
        set_probe_feature(self, key='inbox.enabled', enabled=True, retained=True)
        self.login(self.agent)
        self.assertEqual(self.get(f'/api/v1/inbox/conversations/{self.conversation.id}').status_code, 200)

    def test_statuses_never_regress_and_unknown_ones_are_ignored(self):
        sent = self.env['webvue.inbox.message'].create({
            'conversation_id': self.conversation.id, 'direction': 'out', 'body': 'x', 'delivery_state': 'sent',
            'provider_message_id': 'wamid.S1',
        })
        apply = self.env['webvue.inbox.message']._webvue_apply_status
        stamp = fields.Datetime.now()
        for status, expected in (('deleted', 'sent'), ('delivered', 'delivered'), ('sent', 'delivered'), ('read', 'read')):
            apply(whatsapp.StatusUpdate('wamid.S1', status, stamp, None))
            self.assertEqual(sent.delivery_state, expected, status)
        apply(whatsapp.StatusUpdate('wamid.S1', 'failed', stamp, 'x' * 500))
        self.assertEqual((sent.delivery_state, len(sent.error)), ('failed', 200))
        apply(whatsapp.StatusUpdate('wamid.S1', 'read', stamp, None))
        self.assertEqual(sent.delivery_state, 'failed', 'failed is terminal')
        self.assertFalse(apply(whatsapp.StatusUpdate('wamid.NONE', 'read', stamp, None)))


@tagged('post_install', '-at_install', 'webvue')
class TestSendRules(WebVueInboxCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.settings.visibility_policy = 'all'

    def failed_message(self, conversation, **values):
        return self.env['webvue.inbox.message'].create({
            'conversation_id': conversation.id, 'direction': 'out', 'body': 'x', 'delivery_state': 'failed', **values,
        })

    def test_retry_rechecks_the_window_for_free_text_but_not_for_templates(self):
        late = self.make_conversation(minutes_ago=30 * 60)
        free_text = self.failed_message(late)
        template = self.env['webvue.inbox.template'].create({
            'channel_id': self.channel.id, 'name': 't', 'language': 'ar', 'status': 'APPROVED', 'body': 'x', 'param_count': 0,
        })
        templated = self.failed_message(late, template_id=template.id, template_params=[])
        self.login(self.agent)
        self.assertError(self.api('POST', f'/api/v1/inbox/messages/{free_text.id}/retry'), 422, 'invalid')
        self.assertEqual(self.api('POST', f'/api/v1/inbox/messages/{templated.id}/retry').status_code, 200)

    def test_a_disabled_channel_refuses_replies_and_retries(self):
        conversation = self.make_conversation()
        failed = self.failed_message(conversation)
        self.channel.state = 'disabled'
        self.login(self.agent)
        self.assertError(self.api('POST', f'/api/v1/inbox/conversations/{conversation.id}/messages', {'body': 'x'}), 422, 'invalid')
        self.assertError(self.api('POST', f'/api/v1/inbox/messages/{failed.id}/retry'), 422, 'invalid')


@tagged('post_install', '-at_install', 'webvue')
class TestTemplateSyncRobustness(WebVueInboxCase):

    def sync(self, answer):
        self.login(self.manager)
        with patch.object(requests, 'request', MagicMock(return_value=answer)):
            return self.api('POST', f'/api/v1/inbox/channels/{self.channel.id}/templates/sync')

    def test_param_count_is_the_highest_placeholder_index(self):
        body = [{'name': 'gap', 'language': 'ar', 'status': 'APPROVED', 'components': [{'type': 'BODY', 'text': 'a {{3}} b {{1}}'}]}]
        result = self.sync(provider_response(200, {'data': body}))
        self.assertEqual([t['param_count'] for t in result.json()['items']], [3])

    def test_malformed_provider_answers_are_handled_errors(self):
        bad_json = MagicMock(status_code=200)
        bad_json.json.side_effect = ValueError('no json')
        for answer in (
            bad_json, provider_response(200, ['not', 'an', 'object']),
            provider_response(200, {'data': [{'language': 'ar'}]}),
            provider_response(200, {'data': [{'name': 'x', 'language': 5}]}),
            provider_response(500, {'error': {'message': 'down'}}),
        ):
            result = self.sync(answer)
            self.assertEqual(result.status_code, 422, result.text)
            self.assertEqual(set(result.json()), {'code', 'message'})

    def test_unusual_components_do_not_crash_the_sync(self):
        body = [{'name': 'odd', 'language': 'ar', 'category': ['x'], 'components': ['str', None, {'type': 'BODY'}]}]
        result = self.sync(provider_response(200, {'data': body}))
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json()['items'][0]['param_count'], 0)
        self.assertNotIn(ACCESS_TOKEN, result.text)


@tagged('post_install', '-at_install', 'webvue')
class TestRetentionExtras(WebVueInboxCase):

    def test_retention_also_deletes_stale_failed_events_and_bell_rows(self):
        self.settings.retention_months = 1
        self.settings.auto_close_hours = 0
        old = self.make_conversation(minutes_ago=40 * 24 * 60, assignee_id=self.agent.id)
        self.env['webvue.notify.service']._webvue_deliver(
            old._name, old.id, 'inbox.assigned', self.agent.partner_id, 'assigned',
            values={'webvue_inbox_conversation_id': old.id, 'webvue_inbox_contact_name': 'x'},
        )
        Event = self.env['webvue.inbox.event']
        values = {'channel_id': self.channel.id, 'owner_company_id': self.channel.owner_company_id.id, 'payload': '{}'}
        stale = Event.create({**values, 'state': 'failed', 'attempts': 5})
        fresh = Event.create({**values, 'state': 'failed'})
        self.env.cr.execute("UPDATE webvue_inbox_event SET create_date = now() - interval '40 days' WHERE id = %s", [stale.id])
        stale.invalidate_recordset()
        self.env['webvue.inbox.conversation']._webvue_run_maintenance()
        self.assertFalse(stale.exists())
        self.assertTrue(fresh.exists())
        self.assertFalse(self.env['mail.message'].search_count([('webvue_inbox_conversation_id', '=', old.id)]))
