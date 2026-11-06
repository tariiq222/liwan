# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""TikTok suggested questions and chat prompts: the mirrored model, its limits, its audit and its routes."""
import json
from datetime import timedelta
from unittest.mock import patch

from odoo import fields
from odoo.exceptions import AccessError
from odoo.tests import tagged

from . import tiktok_payloads as tt
from .common import LiwanInboxCase
from odoo.addons.liwan_api.tests.common import cover_isolation_routes, set_probe_feature
from odoo.addons.liwan_inbox.adapters import errors, tiktok
from odoo.addons.liwan_inbox.models.constants import TIKTOK_ECHO_SETTLE, TIKTOK_FEATURE

ACCESS_TOKEN = 'tiktok-access-token-shortcuts'
REFRESH_TOKEN = 'tiktok-refresh-token-shortcuts'
REASON_REVIEWING = 'inbox_tiktok_auto_message_reviewing'
REASON_LIMIT = 'inbox_tiktok_auto_message_limit'
REASON_REFUSED = 'inbox_tiktok_auto_message_refused'
QUESTION = {'kind': 'question', 'question': 'Do you deliver?', 'answer': 'Yes, city-wide.'}
PROMPT = {'kind': 'prompt', 'title': 'Order', 'content': 'I want to order'}
cover_isolation_routes((
    '/api/v1/inbox/channels/<int:channel_id>/tiktok/shortcuts',
), source='liwan_inbox/tests/test_tiktok_shortcuts.py')


@tagged('post_install', '-at_install', 'liwan')
class TestTikTokShortcuts(LiwanInboxCase):
    """A TikTok channel's suggested questions and chat prompts, mirrored to TikTok with their audit status."""

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

    def path(self, suffix='', channel=None):
        return f'/api/v1/inbox/channels/{(channel or self.tiktok).id}/tiktok/shortcuts{suffix}'

    def create(self, payload, channel=None):
        return self.api('POST', self.path(channel=channel), payload)

    def shortcut(self, payload=None, **values):
        return self.env['liwan.inbox.tiktok.shortcut'].create({
            'channel_id': self.tiktok.id, **(payload or QUESTION), **values,
        })

    def deliver(self, payload):
        self.env['liwan.inbox.event'].create({
            'channel_id': self.tiktok.id, 'owner_company_id': self.tiktok.owner_company_id.id,
            'payload': json.dumps(payload),
        })
        later = fields.Datetime.now() + TIKTOK_ECHO_SETTLE + timedelta(seconds=1)
        with patch('odoo.fields.Datetime.now', return_value=later):
            self.env['liwan.inbox.event']._liwan_run_events()

    def test_a_question_is_pushed_and_stored_as_reviewing(self):
        with patch.object(tiktok, 'create_auto_message', return_value='am-1') as create:
            response = self.create(QUESTION)
        self.assertEqual(response.status_code, 201, response.text)
        body = response.json()
        self.assertEqual((body['kind'], body['provider_id'], body['audit']), ('question', 'am-1', 'reviewing'))
        credentials, auto_type, content = create.call_args.args
        self.assertEqual((credentials.business_id, auto_type), (tt.BUSINESS_ID, 'SUGGESTED_QUESTION'))
        self.assertEqual(content, {'suggested_question': {'question': QUESTION['question'], 'answer': QUESTION['answer']}})

    def test_a_prompt_is_pushed_as_a_chat_prompt(self):
        with patch.object(tiktok, 'create_auto_message', return_value='am-2') as create:
            response = self.create(PROMPT)
        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(response.json()['kind'], 'prompt')
        self.assertEqual(create.call_args.args[1], 'CHAT_PROMPT')
        self.assertEqual(create.call_args.args[2], {
            'chat_prompt': {'title': PROMPT['title'], 'content': PROMPT['content']},
        })

    def test_three_questions_and_six_prompts_are_the_limits(self):
        with patch.object(tiktok, 'create_auto_message', side_effect=[f'am-q{number}' for number in range(3)]):
            for _number in range(3):
                self.assertEqual(self.create(QUESTION).status_code, 201)
        refused = self.create(QUESTION)
        self.assertError(refused, 422, 'invalid')
        self.assertEqual(refused.json()['details']['reason'], REASON_LIMIT)
        with patch.object(tiktok, 'create_auto_message', side_effect=[f'am-p{number}' for number in range(6)]):
            for _number in range(6):
                self.assertEqual(self.create(PROMPT).status_code, 201)
        refused = self.create(PROMPT)
        self.assertError(refused, 422, 'invalid')
        self.assertEqual(refused.json()['details']['reason'], REASON_LIMIT)

    def test_the_lengths_of_the_contract_are_enforced(self):
        for payload in (
            {**QUESTION, 'question': 'x' * (tiktok.QUESTION_MAX + 1)},
            {**QUESTION, 'answer': 'x' * (tiktok.ANSWER_MAX + 1)},
            {**QUESTION, 'title': 'Not a prompt'},
            {**PROMPT, 'title': 'x' * (tiktok.PROMPT_TITLE_MAX + 1)},
            {**PROMPT, 'content': 'x' * (tiktok.PROMPT_CONTENT_MAX + 1)},
            {**PROMPT, 'question': 'Not a question'},
        ):
            self.assertError(self.create(payload), 422, 'invalid')

    def test_a_reviewing_item_cannot_be_edited(self):
        with patch.object(tiktok, 'create_auto_message', return_value='am-1'):
            created = self.create(QUESTION).json()
        shortcut = self.env['liwan.inbox.tiktok.shortcut'].browse(created['id'])
        self.assertEqual(shortcut.audit, 'reviewing')
        response = self.api('PATCH', self.path(f'/{shortcut.id}'), {'question': 'Still there?'})
        self.assertError(response, 422, 'invalid')
        self.assertEqual(response.json()['details']['reason'], REASON_REVIEWING)
        shortcut.write({'audit': 'approved'})
        with patch.object(tiktok, 'update_auto_message') as update:
            accepted = self.api('PATCH', self.path(f'/{shortcut.id}'), {'question': 'Still there?'})
        self.assertEqual(accepted.status_code, 200, accepted.text)
        self.assertEqual(accepted.json()['question'], 'Still there?')
        self.assertEqual(update.call_args.args[2:], ('am-1', {'suggested_question': {'question': 'Still there?', 'answer': QUESTION['answer']}}))

    def test_enabling_recreates_every_stored_item(self):
        with patch.object(tiktok, 'create_auto_message', side_effect=['am-1', 'am-2']):
            self.assertEqual(self.create(QUESTION).status_code, 201)
            self.assertEqual(self.create({**QUESTION, 'question': 'Are you open?'}).status_code, 201)
        with patch.object(tiktok, 'set_auto_message_status') as status, patch.object(
            tiktok, 'create_auto_message', side_effect=['am-3', 'am-4'],
        ) as create:
            response = self.api('POST', self.path('/enable'), {'kind': 'question', 'enabled': True})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(status.call_args.args[1:], ('SUGGESTED_QUESTION', True))
        self.assertEqual(create.call_count, 2)
        shortcuts = self.env['liwan.inbox.tiktok.shortcut'].search([('channel_id', '=', self.tiktok.id)], order='id')
        self.assertEqual([shortcut.provider_id for shortcut in shortcuts], ['am-3', 'am-4'])
        self.assertEqual(set(shortcuts.mapped('audit')), {'reviewing'})
        self.tiktok.invalidate_recordset(['tiktok_questions_enabled'])
        self.assertTrue(self.tiktok.tiktok_questions_enabled)

    def test_a_refusal_to_switch_the_kind_is_422_not_500(self):
        with patch.object(tiktok, 'set_auto_message_status', side_effect=errors.ProviderError(
            'auto message refused', retryable=False, code=40001,
        )):
            response = self.api('POST', self.path('/enable'), {'kind': 'question', 'enabled': True})
        self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(response.json()['details']['reason'], REASON_REFUSED)
        self.tiktok.invalidate_recordset(['tiktok_questions_enabled'])
        self.assertFalse(self.tiktok.tiktok_questions_enabled, 'a refused switch must not be stored as enabled')

    def test_disabling_keeps_the_stored_items(self):
        with patch.object(tiktok, 'create_auto_message', return_value='am-1'):
            self.create(QUESTION)
        with patch.object(tiktok, 'set_auto_message_status') as status, patch.object(tiktok, 'create_auto_message') as create:
            response = self.api('POST', self.path('/enable'), {'kind': 'question', 'enabled': False})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(status.call_args.args[1:], ('SUGGESTED_QUESTION', False))
        self.assertEqual(create.call_count, 0)
        self.assertEqual(self.env['liwan.inbox.tiktok.shortcut'].search([('channel_id', '=', self.tiktok.id)]).provider_id, 'am-1')

    def test_an_audit_event_updates_the_stored_status(self):
        with patch.object(tiktok, 'create_auto_message', return_value='am-1'):
            created = self.create(QUESTION).json()
        shortcut = self.env['liwan.inbox.tiktok.shortcut'].browse(created['id'])
        self.tiktok.write({'tiktok_welcome_id': 'am-w', 'tiktok_questions_enabled': True})
        welcome = tt.auto_message_item('WELCOME_MESSAGE', 'am-w', 'APPROVED', {'content': 'Welcome'})
        question = tt.auto_message_item('SUGGESTED_QUESTION', 'am-1', 'APPROVED')
        with patch.object(tiktok, 'get_auto_messages', side_effect=[
            ('ENABLE', [welcome]), ('ENABLE', [question]),
        ]) as listing:
            self.deliver(tt.auto_message_audit_update(audit_status='APPROVED', auto_message_id='am-1'))
        self.assertEqual(listing.call_count, 2)
        self.tiktok.invalidate_recordset(['tiktok_welcome_audit'])
        self.assertEqual((self.tiktok.tiktok_welcome_audit, shortcut.audit), ('approved', 'approved'))
        rejected = tt.auto_message_item('SUGGESTED_QUESTION', 'am-1', 'REJECTED')
        with patch.object(tiktok, 'get_auto_messages', side_effect=[('DISABLE', [welcome]), ('DISABLE', [rejected])]):
            self.deliver(tt.auto_message_config_update(action='DISABLE'))
        self.assertEqual(shortcut.audit, 'rejected')
        self.tiktok.invalidate_recordset(['tiktok_questions_enabled'])
        self.assertFalse(self.tiktok.tiktok_questions_enabled)

    def test_delete_removes_the_item_at_tiktok(self):
        with patch.object(tiktok, 'create_auto_message', return_value='am-1'):
            created = self.create(QUESTION).json()
        with patch.object(tiktok, 'delete_auto_message') as delete:
            self.assertEqual(self.api('DELETE', self.path(f'/{created["id"]}')).status_code, 204)
        self.assertEqual(delete.call_args.args[1:], ('SUGGESTED_QUESTION', 'am-1'))
        self.assertFalse(self.env['liwan.inbox.tiktok.shortcut'].browse(created['id']).exists())

    def test_another_companys_channel_is_not_found(self):
        other = self.env['res.company'].create({'name': 'Other tenant'})
        channel = self.env['liwan.inbox.channel'].create({
            'name': 'Other TikTok', 'kind': 'tiktok', 'owner_company_id': other.id,
            'tiktok_business_id': 'other-business-open-id',
        })
        shortcut = self.env['liwan.inbox.tiktok.shortcut'].create({
            'channel_id': channel.id, 'kind': 'question', 'question': 'Q?', 'answer': 'A.',
        })
        for response in (
            self.api('GET', self.path(channel=channel)),
            self.create(QUESTION, channel=channel),
            self.api('PATCH', self.path(f'/{shortcut.id}', channel=channel), {'question': 'Q2?'}),
            self.api('DELETE', self.path(f'/{shortcut.id}', channel=channel)),
            self.api('POST', self.path('/enable', channel=channel), {'kind': 'question', 'enabled': True}),
        ):
            self.assertError(response, 404, 'not_found')
        self.assertTrue(shortcut.exists())
        Shortcut = self.env['liwan.inbox.tiktok.shortcut']
        self.assertFalse(Shortcut.with_user(self.manager).search([('id', '=', shortcut.id)]))
        with self.assertRaises(AccessError):
            Shortcut.with_user(self.reader_only).search([])
