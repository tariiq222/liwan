# Part of Odoo. See LICENSE file for full copyright and licensing details.
import json
import pathlib
from datetime import timedelta
from unittest.mock import MagicMock, patch
from urllib.parse import urlsplit

import requests

from odoo import Command, fields
from odoo.exceptions import AccessError
from odoo.tests import new_test_user, tagged

from .common import PASSWORD
from .test_integrations_twilio import (
    AUTH_TOKEN,
    BASE,
    NUMBER,
    NUMBERS,
    OTHER_SID,
    SID,
    TwilioCase,
    answer,
    sign,
    twilio_http,
)
from odoo.addons.liwan_api.tests.common import cover_isolation_routes
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule
from odoo.addons.liwan_integrations_sa.models.message import estimate_segments
from odoo.addons.liwan_integrations_sa.providers import twilio
from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT

MESSAGING = f'{BASE}/messaging'
cover_isolation_routes(
    ['/api/v1/integrations/messaging/messages/<int:message_id>', '/api/v1/integrations/messaging/test/<int:message_id>'],
    'liwan_integrations_sa test_integrations_messaging',
)
RECIPIENT = '+966501234567'
WHATSAPP_NUMBER = '+15005550009'
TEMPLATE = 'HX' + 'b' * 32
ARABIC = 'مرحبا، هذه رسالة تجريبية من ليوان'
STATE_KEYS = {
    'id', 'channel', 'origin', 'state', 'to', 'sender_value', 'segments', 'error_code', 'error_message', 'has_receipt',
    'created_at', 'sent_at', 'read_at',
}
MESSAGE_KEYS = STATE_KEYS | {
    'connection_id', 'sender_id', 'provider', 'account_ref', 'body', 'content_sid', 'content_variables', 'requested_by',
    'provider_message_id', 'attempts',
}


def accepted(sid='SM' + '1' * 32, status='queued', segments='1'):
    return answer(201, {'sid': sid, 'status': status, 'num_segments': segments})


def sent_data(call, index=0):
    return call.call_args_list[index].kwargs['data']


class MessagingCase(TwilioCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.logger = cls.make_role_user('integrations_log_reader', ('integrations.log.read',))
        cls.log_manager = cls.make_role_user('integrations_log_manager', ('integrations.read', 'integrations.manage', 'integrations.log.read'))
        cls.manager = cls.make_role_user('integrations_manager', ('integrations.read', 'integrations.manage'))

    @classmethod
    def make_role_user(cls, login, keys):
        user = new_test_user(cls.env, login=login, password=PASSWORD, name=login, groups='liwan_core.group_employee')
        role = cls.env['liwan.access.role'].create({
            'key': login, 'name_ar': login, 'name_en': login, 'type': 'custom',
            'permission_ids': [Command.set(cls.env['liwan.access.permission'].search([('key', 'in', keys)]).ids)],
        })
        cls.env['liwan.access.service']._liwan_replace_assignments(user, [{'role_id': role.id, 'company_id': cls.env.company.id}])
        return user

    def setUp(self):
        super().setUp()
        self.startPatcher(patch.object(twilio, 'list_numbers', return_value=NUMBERS))
        self.commits = MagicMock(return_value=float('inf'))
        self.startPatcher(patch.object(type(self.env['ir.cron']), '_commit_progress', self.commits))
        self.connection = self.make_twilio()
        Sender = self.env['liwan.integration.sender']
        self.sms = Sender.create({'connection_id': self.connection.id, 'channel': 'sms', 'kind': 'number', 'value': NUMBER, 'is_default': True})
        self.whatsapp = Sender.create({
            'connection_id': self.connection.id, 'channel': 'whatsapp', 'kind': 'number', 'value': WHATSAPP_NUMBER, 'is_default': True,
        })
        self.Messaging = self.env['liwan.integration.messaging']
        self.Message = self.env['liwan.integration.message']

    def send(self, **kwargs):
        values = {'to': RECIPIENT, 'origin': 'test', 'body': 'hello', **kwargs}
        return self.Message.browse(self.Messaging._liwan_send(**values)['id'])

    def run_outbox(self):
        self.Message._liwan_run_outbox()
        self.Message.invalidate_model()

    def due_now(self, row):
        row.next_attempt_at = fields.Datetime.now() - timedelta(seconds=1)

    def callback(self, row, status, **extra):
        params = {'MessageSid': row.provider_message_id, 'MessageStatus': status, 'AccountSid': SID, **extra}
        response = self.url_open(
            urlsplit(row.status_callback_url).path, data=params,
            headers={'X-Twilio-Signature': sign(row.status_callback_url, params)}, method='POST',
        )
        row.invalidate_recordset()
        return response


@tagged('post_install', '-at_install', 'liwan')
class TestMessagingFlow(MessagingCase):

    def test_a_test_sms_is_queued_then_sent_then_delivered_by_a_signed_callback(self):
        self.env.company.country_id = self.env.ref('base.sa')
        self.login(self.admin)
        result = self.api('POST', f'{MESSAGING}/test', {'sender_id': self.sms.id, 'to': '0501234567'})
        self.assertEqual(result.status_code, 201, result.text)
        body = result.json()
        self.assertEqual(set(body), STATE_KEYS)
        self.assertEqual((body['state'], body['to'], body['has_receipt']), ('queued', RECIPIENT, True))
        row = self.Message.browse(body['id'])
        with twilio_http(accepted()) as call:
            self.run_outbox()
        data = sent_data(call)
        self.assertEqual((data['To'], data['From']), (RECIPIENT, NUMBER))
        self.assertEqual(data['StatusCallback'], f'https://liwan.test/api/v1/public/integrations/hooks/twilio/{self.connection.id}/message-status')
        self.assertTrue(data['Body'])
        self.assertEqual(call.call_args_list[0].kwargs['auth'], (SID, AUTH_TOKEN))
        self.assertEqual((row.state, row.provider_message_id, row.segments, row.send_token), ('sent', 'SM' + '1' * 32, 1, False))
        self.assertEqual(self.api('GET', f'{MESSAGING}/test/{row.id}').json()['state'], 'sent')
        self.assertEqual(self.callback(row, 'delivered').status_code, 204)
        self.assertEqual(row.state, 'delivered')
        for status in ('delivered', 'sent', 'queued', 'undelivered', 'mystery'):
            with self.subTest(status=status):
                self.assertEqual(self.callback(row, status).status_code, 204)
                self.assertEqual(row.state, 'delivered')

    def test_a_wrong_signature_changes_nothing(self):
        row = self.send()
        with twilio_http(accepted()):
            self.run_outbox()
        params = {'MessageSid': row.provider_message_id, 'MessageStatus': 'delivered'}
        response = self.url_open(
            urlsplit(row.status_callback_url).path, data=params,
            headers={'X-Twilio-Signature': sign(row.status_callback_url, params, token='another-token-0123456789')}, method='POST',
        )
        self.assertEqual(response.status_code, 403)
        row.invalidate_recordset()
        self.assertEqual(row.state, 'sent')

    def test_whatsapp_free_text_and_template_carry_the_whatsapp_prefix(self):
        text = self.send(channel='whatsapp')
        template = self.send(channel='whatsapp', body=None, content_sid=TEMPLATE, content_variables={'1': 'سارة'})
        with twilio_http(accepted('SM' + '2' * 32), accepted('SM' + '3' * 32)) as call:
            self.run_outbox()
        first, second = sent_data(call, 0), sent_data(call, 1)
        self.assertEqual((first['To'], first['From'], first['Body']), (f'whatsapp:{RECIPIENT}', f'whatsapp:{WHATSAPP_NUMBER}', 'hello'))
        self.assertEqual((second['ContentSid'], json.loads(second['ContentVariables'])), (TEMPLATE, {'1': 'سارة'}))
        self.assertNotIn('Body', second)
        self.assertEqual((text.state, template.state), ('sent', 'sent'))
        self.assertEqual(self.callback(template, 'read').status_code, 204)
        self.assertTrue(template.read_at)
        self.assertEqual(template.state, 'sent')
        self.assertEqual(self.callback(template, 'delivered').status_code, 204)
        self.assertEqual(template.state, 'delivered')
        read_at = template.read_at
        self.callback(template, 'read')
        self.assertEqual(template.read_at, read_at)

    def test_a_failed_or_undelivered_callback_keeps_the_provider_error_code(self):
        row = self.send()
        with twilio_http(accepted()):
            self.run_outbox()
        self.callback(row, 'undelivered', ErrorCode='30003')
        self.assertEqual((row.state, row.error_code), ('undelivered', '30003'))

    def test_a_messaging_service_sender_is_sent_as_messaging_service_sid(self):
        service = self.env['liwan.integration.sender'].create({
            'connection_id': self.connection.id, 'channel': 'sms', 'kind': 'service', 'value': 'MG' + 'c' * 32,
        })
        self.send(sender=service.id)
        with twilio_http(accepted()) as call:
            self.run_outbox()
        self.assertEqual(sent_data(call)['MessagingServiceSid'], 'MG' + 'c' * 32)
        self.assertNotIn('From', sent_data(call))


@tagged('post_install', '-at_install', 'liwan')
class TestMessagingOutcomes(MessagingCase):

    def test_a_refused_connection_or_429_retries_with_backoff_up_to_five_attempts(self):
        row = self.send()
        refused = requests.ConnectionError('refused')
        with twilio_http(answer(429, {'message': 'Too many'}), refused, answer(429, {}), answer(429, {}), answer(429, {})) as call:
            with patch.object(twilio.client, '_never_sent', return_value=True):
                for attempt, minutes in enumerate((1, 2, 4, 8), start=1):
                    before = fields.Datetime.now()
                    self.run_outbox()
                    self.assertEqual((row.state, row.attempts), ('queued', attempt))
                    self.assertGreaterEqual(row.next_attempt_at, before + timedelta(minutes=minutes) - timedelta(seconds=1))
                    self.run_outbox()  # not due yet: nothing is sent
                    self.assertEqual(call.call_count, attempt)
                    self.due_now(row)
                self.run_outbox()
        self.assertEqual((row.state, row.attempts, call.call_count), ('failed', 5, 5))

    def test_a_timeout_or_5xx_is_unconfirmed_and_never_sent_again(self):
        for failure in (requests.ReadTimeout('late'), answer(503, {'message': 'busy'})):
            with self.subTest(failure=failure):
                row = self.send()
                with twilio_http(failure) as call:
                    self.run_outbox()
                    self.due_now(row)
                    self.run_outbox()
                self.assertEqual((row.state, call.call_count), ('unconfirmed', 1))

    def test_a_crash_between_claim_and_result_settles_as_unconfirmed(self):
        row = self.send()
        self.assertTrue(row._liwan_claim())
        row.send_started_at = fields.Datetime.now() - timedelta(minutes=5)
        with twilio_http() as call:
            self.run_outbox()
        call.assert_not_called()
        self.assertEqual((row.state, row.error_code, row.send_token), ('unconfirmed', 'interrupted', False))

    def test_two_runs_send_a_row_once(self):
        row = self.send()
        self.assertTrue(row._liwan_claim())
        self.assertFalse(row._liwan_claim(), 'a claimed row cannot be claimed again')
        with twilio_http() as call:
            self.run_outbox()  # another run holds a fresh claim: it is neither sent nor settled
        call.assert_not_called()
        self.assertEqual(row.state, 'queued')
        row.write({'send_token': False, 'send_started_at': False})
        with twilio_http(accepted()) as call:
            self.run_outbox()
            self.run_outbox()
        self.assertEqual((row.state, call.call_count), ('sent', 1))

    def test_a_final_4xx_fails_and_a_disabled_connection_fails_without_a_call(self):
        row = self.send()
        with twilio_http(answer(400, {'code': 21211, 'message': 'Invalid To'})):
            self.run_outbox()
        self.assertEqual((row.state, row.error_code), ('failed', '21211'))
        other = self.send()
        self.connection.state = 'disabled'
        with twilio_http() as call:
            self.run_outbox()
        call.assert_not_called()
        self.assertEqual((other.state, other.error_code), ('failed', 'connection_disabled'))

    def test_a_suspended_tenant_sends_nothing_from_the_queue_or_the_test_route(self):
        row = self.send()
        self.login(self.admin)
        profile = self.env.ref('liwan_platform.tenant_profile')
        profile.sudo().with_context(**{OPERATOR_CONTEXT: True}).write({'status': 'suspended', 'suspension_reason': 'non_payment'})
        with twilio_http() as call:
            self.run_outbox()
        call.assert_not_called()
        self.assertEqual(row.state, 'queued')
        with self.assertRaises(LiwanAccessRule) as refused:
            self.send()
        self.assertEqual(refused.exception.code, 'tenant_read_only')
        response = self.api('POST', f'{MESSAGING}/test', {'sender_id': self.sms.id, 'to': RECIPIENT})
        self.assertGreaterEqual(response.status_code, 400)
        self.assertEqual(self.Message.search_count([]), 1)

    def test_the_daily_limit_refuses_the_next_message(self):
        self.env['liwan.integration.settings']._liwan_update(self.env.company, {'daily_message_limit': 2})
        self.send()
        self.send(channel='whatsapp')
        with self.assertRaises(LiwanAccessRule) as refused:
            self.send()
        self.assertEqual(refused.exception.code, 'daily_limit_reached')
        self.login(self.admin)
        self.assertError(self.api('POST', f'{MESSAGING}/test', {'sender_id': self.sms.id, 'to': RECIPIENT}), 429, 'daily_limit_reached')

    def test_the_service_refuses_with_its_error_codes(self):
        cases = (
            ({'to': '123'}, 'invalid_phone'),
            ({'body': 'x' * 1601}, 'body_too_long'),
            ({'sender': 999999999}, 'sender_unavailable'),
        )
        for values, code in cases:
            with self.subTest(code=code), self.assertRaises(LiwanAccessRule) as refused:
                self.send(**values)
            self.assertEqual(refused.exception.code, code)
        self.whatsapp.is_default = False
        with self.assertRaises(LiwanAccessRule) as refused:
            self.send(channel='whatsapp')
        self.assertEqual(refused.exception.code, 'no_default_sender')
        self.connection.state = 'disabled'
        with self.assertRaises(LiwanAccessRule) as refused:
            self.send()
        self.assertEqual(refused.exception.code, 'connection_disabled')

    def test_an_arabic_body_is_stored_and_sent_intact_and_estimated_as_ucs2(self):
        row = self.send(body=ARABIC)
        self.assertEqual(row.body, ARABIC)
        with twilio_http(accepted(segments=None)) as call:
            self.run_outbox()
        self.assertEqual(sent_data(call)['Body'], ARABIC)
        self.assertEqual(row.segments, 1)
        self.assertEqual([estimate_segments(text) for text in ('ب' * 70, 'ب' * 71, 'ب' * 135)], [1, 2, 3])
        self.assertEqual([estimate_segments(text) for text in ('a' * 160, 'a' * 161, '{' * 80, '{' * 81)], [1, 2, 1, 2])

    def test_without_a_public_https_base_the_message_is_sent_without_a_callback_and_stays_sent(self):
        self.env['ir.config_parameter'].sudo().set_param('web.base.url', 'http://localhost:8069')
        row = self.send()
        self.assertFalse(row.status_callback_url)
        with twilio_http(accepted()) as call:
            self.run_outbox()
        self.assertNotIn('StatusCallback', sent_data(call))
        self.assertEqual(row.state, 'sent')
        self.assertFalse(self.Messaging._liwan_status(row.id, 'test')['has_receipt'])

    def test_old_rows_are_purged_after_24_months(self):
        old, recent = self.send(), self.send()
        self.env.cr.execute(
            "UPDATE liwan_integration_message SET create_date = now() - interval '25 months' WHERE id = %s", (old.id,),
        )
        self.Message._liwan_purge_old()
        self.assertEqual((old.exists(), recent.exists()), (self.Message, recent))

    def test_no_service_here_calls_the_sign_in_sms_gateway(self):
        root = pathlib.Path(__file__).resolve().parent.parent
        sources = [path for path in root.rglob('*.py') if 'tests' not in path.parts]
        self.assertTrue(sources)
        for path in sources:
            self.assertNotIn('liwan.sms.gateway', path.read_text(encoding='utf-8'), path.name)


@tagged('post_install', '-at_install', 'liwan')
class TestMessagingCompanies(MessagingCase):

    def setUp(self):
        super().setUp()
        self.other = self.env['res.company'].create({'name': 'Messaging company B'})
        self.foreign_connection = self.make_twilio(external_id=OTHER_SID, company=self.other)
        self.foreign_sender = self.env['liwan.integration.sender'].create({
            'company_id': self.other.id, 'connection_id': self.foreign_connection.id, 'channel': 'sms',
            'kind': 'number', 'value': NUMBER, 'is_default': True,
        })
        self.foreign = self.Message.browse(
            self.Messaging.with_company(self.other)._liwan_send(to=RECIPIENT, origin='test', body='from B')['id'],
        )

    def test_the_cron_sends_a_second_company_message_with_its_own_connection_and_sender(self):
        self.assertEqual((self.foreign.company_id, self.foreign.sender_id), (self.other, self.foreign_sender))
        with twilio_http(accepted()) as call:
            self.run_outbox()
        self.assertEqual(call.call_args_list[0].kwargs['auth'], (OTHER_SID, AUTH_TOKEN))
        self.assertIn(OTHER_SID, call.call_args_list[0].args[1])
        self.assertEqual(self.foreign.state, 'sent')

    def test_another_company_sees_none_of_the_connection_senders_settings_or_log(self):
        self.env['liwan.integration.settings']._liwan_update(self.other, {'daily_message_limit': 7})
        self.login(self.log_manager)
        self.assertNotIn(self.foreign_connection.id, [item['id'] for item in self.api('GET', f'{BASE}/connections').json()['items']])
        self.assertNotIn(self.foreign_sender.id, [item['id'] for item in self.api('GET', f'{BASE}/senders').json()['items']])
        self.assertEqual(self.api('GET', f'{BASE}/communication-settings').json()['daily_message_limit'], 1000)
        self.assertEqual(self.api('GET', f'{MESSAGING}/messages').json(), {'items': [], 'total': 0})
        hidden = self.api('GET', f'{MESSAGING}/messages/{self.foreign.id}')
        missing = self.api('GET', f'{MESSAGING}/messages/999999999')
        self.assertEqual((hidden.status_code, hidden.content), (404, missing.content))
        self.assertEqual(self.api('GET', f'{MESSAGING}/test/{self.foreign.id}').status_code, 404)
        self.assertEqual(self.api('POST', f'{MESSAGING}/messages/{self.foreign.id}/retry').status_code, 404)
        self.assertIsNone(self.Messaging._liwan_status(self.foreign.id, 'test'))

    def test_a_user_without_any_integrations_capability_sends_through_the_service_and_reads_only_its_own_row(self):
        nobody = new_test_user(self.env, login='messaging_nobody', groups='liwan_core.group_employee')
        service = self.env(user=nobody)['liwan.integration.messaging']
        state = service._liwan_send(to=RECIPIENT, origin='test', body='from an application')
        self.assertEqual(set(state), set(self.Messaging._liwan_status(state['id'], 'test')))
        self.assertEqual(state['state'], 'queued')
        self.assertEqual(service._liwan_status(state['id'], 'test')['id'], state['id'])
        self.assertIsNone(service._liwan_status(self.foreign.id, 'test'))
        self.assertIsNone(service._liwan_status(state['id'], 'test', requested_by=self.admin))
        for model in ('liwan.integration.message', 'liwan.integration.secret', 'liwan.integration.sender'):
            with self.subTest(model=model), self.assertRaises(AccessError):
                self.env(user=nobody)[model].search([])
        self.assertNotIn(AUTH_TOKEN, repr(state))


@tagged('post_install', '-at_install', 'liwan')
class TestMessagingRoutes(MessagingCase):

    def test_the_log_opens_only_with_integrations_log_read(self):
        row = self.send()
        for user in (self.admin, self.manager):
            with self.subTest(user=user.login):
                self.login(user)
                self.assertError(self.api('GET', f'{MESSAGING}/messages'), 403, 'forbidden')
                self.assertError(self.api('GET', f'{MESSAGING}/messages/{row.id}'), 403, 'forbidden')
        self.login(self.logger)
        listed = self.api('GET', f'{MESSAGING}/messages?channel=sms&state=queued&q=50123')
        self.assertEqual(listed.status_code, 200, listed.text)
        self.assertEqual(listed.json()['total'], 1)
        self.assertEqual(set(listed.json()['items'][0]), MESSAGE_KEYS)
        self.assertEqual(self.api('GET', f'{MESSAGING}/messages?state=sent').json()['total'], 0)
        self.assertError(self.api('GET', f'{MESSAGING}/messages?state=nope'), 422, 'invalid')
        self.assertEqual(self.api('GET', f'{MESSAGING}/messages/{row.id}').json()['body'], 'hello')

    def test_the_list_is_newest_first(self):
        first, second = self.send(), self.send()
        self.login(self.logger)
        self.assertEqual([item['id'] for item in self.api('GET', f'{MESSAGING}/messages').json()['items']], [second.id, first.id])

    def test_an_admin_without_the_log_runs_and_watches_only_its_own_test(self):
        self.login(self.admin)
        created = self.api('POST', f'{MESSAGING}/test', {'sender_id': self.sms.id, 'to': RECIPIENT}).json()
        self.assertEqual(self.api('GET', f'{MESSAGING}/test/{created["id"]}').json()['state'], 'queued')
        self.login(self.manager)
        self.assertEqual(self.api('GET', f'{MESSAGING}/test/{created["id"]}').status_code, 404)
        self.login(self.logger)
        self.assertError(self.api('POST', f'{MESSAGING}/test', {'sender_id': self.sms.id, 'to': RECIPIENT}), 403, 'forbidden')

    def test_retry_needs_manage_and_the_log_and_queues_a_new_row(self):
        row = self.send()
        with twilio_http(requests.ReadTimeout('late')):
            self.run_outbox()
        self.assertEqual(row.state, 'unconfirmed')
        for user in (self.manager, self.logger):
            with self.subTest(user=user.login):
                self.login(user)
                self.assertError(self.api('POST', f'{MESSAGING}/messages/{row.id}/retry'), 403, 'forbidden')
        self.login(self.log_manager)
        retried = self.api('POST', f'{MESSAGING}/messages/{row.id}/retry')
        self.assertEqual(retried.status_code, 201, retried.text)
        self.assertNotEqual(retried.json()['id'], row.id)
        self.assertEqual(retried.json()['state'], 'queued')
        row.invalidate_recordset()
        self.assertEqual(row.state, 'unconfirmed')
        sent = self.send()
        with twilio_http(accepted('SM' + '9' * 32)):
            self.run_outbox()
        self.assertError(self.api('POST', f'{MESSAGING}/messages/{sent.id}/retry'), 422, 'invalid')

    def test_templates_are_listed_from_the_provider_account(self):
        self.login(self.admin)
        page = {'contents': [{'sid': TEMPLATE, 'friendly_name': 'welcome', 'language': 'ar', 'types': {'twilio/text': {}}, 'variables': {'1': 'name'}}], 'meta': {'next_page_url': None}}
        with twilio_http(answer(200, page)) as call:
            result = self.api('GET', f'{MESSAGING}/templates?connection_id={self.connection.id}')
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json(), {'items': [{'sid': TEMPLATE, 'name': 'welcome', 'language': 'ar', 'types': ['twilio/text'], 'variables': ['1']}], 'total': 1})
        self.assertTrue(call.call_args_list[0].args[1].startswith('https://content.twilio.com/v1/Content'))
        with twilio_http(answer(401, {'message': 'Authenticate'})):
            self.assertError(self.api('GET', f'{MESSAGING}/templates?connection_id={self.connection.id}'), 502, 'provider_error')

    def test_a_connection_with_a_pending_message_is_in_use_until_it_is_settled(self):
        row = self.send()
        self.login(self.admin)
        (self.sms | self.whatsapp)._liwan_archive()
        self.assertError(self.api('DELETE', f'{BASE}/connections/{self.connection.id}'), 409, 'in_use')
        with twilio_http(accepted()):
            self.run_outbox()
        self.assertEqual(self.api('DELETE', f'{BASE}/connections/{self.connection.id}').status_code, 204)
        row.invalidate_recordset()
        self.assertEqual((row.connection_id.id, row.provider, row.account_ref, row.sender_value), (False, 'twilio', SID, NUMBER))
