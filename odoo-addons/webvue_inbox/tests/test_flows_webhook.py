# Part of Odoo. See LICENSE file for full copyright and licensing details.
import json
from datetime import timedelta

from odoo.tests import tagged

from . import whatsapp_payloads as wa
from .common import BUSINESS_ACCOUNT_ID, PHONE_ID
from .flows_common import BASE, SUBMISSION_KEYS, FlowCase, choice, text_input
from odoo.addons.webvue_inbox.adapters import whatsapp
from odoo.addons.webvue_inbox.models import automation as engine
from odoo.addons.webvue_inbox.models import flow_submission

HOOK = '/api/v1/inbox/hooks/whatsapp'
ANSWERS = {
    'full_name': 'Sara Ali', 'service': 'o2', 'day': '2026-11-20', 'extras': ['o3', 'o1'], 'notes': 'Please call first', 'consent': True,
}


@tagged('post_install', '-at_install', 'webvue')
class TestFlowParsing(FlowCase):

    def one(self, data):
        (event,) = whatsapp.parse_events(data, PHONE_ID, BUSINESS_ACCOUNT_ID)
        return event

    def test_an_nfm_reply_is_a_flow_response_with_its_token_and_answers(self):
        event = self.one(wa.flow_reply({'flow_token': 'tok', 'full_name': 'Sara'}, context_id='wamid.OUT1'))
        self.assertEqual((event.kind, event.context_id), ('flow_response', 'wamid.OUT1'))
        self.assertEqual(event.flow_response, whatsapp.FlowResponse('tok', {'full_name': 'Sara'}))
        self.assertEqual(event.body, '[flow_response]')

    def test_a_body_that_cannot_be_read_has_no_answers(self):
        for raw in ('not json', '[1, 2]', '"text"', '{' * 100, json.dumps({'flow_token': 'x', 'big': 'y' * 70000})):
            event = self.one(wa.flow_reply(raw))
            self.assertEqual((event.kind, event.flow_response.values), ('flow_response', {}), raw[:20])
        self.assertIsNone(self.one(wa.flow_reply('not json')).flow_response.flow_token)
        self.assertIsNone(self.one(wa.flow_reply({'flow_token': 7})).flow_response.flow_token)

    def test_other_interactive_replies_are_unchanged(self):
        event = self.one(wa.inbound_message('interactive', {'type': 'button_reply', 'button_reply': {'id': 'a', 'title': 'A'}}))
        self.assertEqual((event.kind, event.flow_response), ('interactive', None))

    def test_flows_webhook_changes_are_typed(self):
        status = wa.flows_event({'event': 'FLOW_STATUS_CHANGE', 'flow_id': '123', 'old_status': 'DRAFT', 'new_status': 'PUBLISHED', 'message': 'ok'})
        self.assertEqual(self.one(status), whatsapp.FlowStatusUpdate('123', 'DRAFT', 'PUBLISHED'))
        warning = wa.flows_event({'event': 'FLOW_VERSION_EXPIRY_WARNING', 'flow_id': 123, 'warning': 'Version 5.0 freezes'})
        self.assertEqual(self.one(warning), whatsapp.FlowVersionWarning('123', 'Version 5.0 freezes'))
        for value in ({'event': 'ENDPOINT_AVAILABILITY', 'flow_id': '1', 'alert_state': 'ACTIVATED'}, {'event': 'FLOW_STATUS_CHANGE'}, {}):
            self.assertEqual(whatsapp.parse_events(wa.flows_event(value), PHONE_ID, BUSINESS_ACCOUNT_ID), [])
        self.assertEqual(whatsapp.parse_events(status, PHONE_ID, '999'), [])
        self.assertEqual(whatsapp.account_business_ids(status), {BUSINESS_ACCOUNT_ID})


@tagged('post_install', '-at_install', 'webvue')
class TestFlowWebhookRouting(FlowCase):

    def post(self, data, signature=None):
        raw = wa.body_of(data)
        return self.url_open(HOOK, data=raw, headers={
            'Content-Type': 'application/json', 'X-Hub-Signature-256': signature or wa.sign(raw),
        }, method='POST')

    def test_a_flows_change_reaches_the_channels_of_the_account_only(self):
        sibling = self.make_channel(phone_id='100000000002')
        other = self.make_channel(phone_id='100000000003', business_account_id='299999999999')
        value = {'event': 'FLOW_STATUS_CHANGE', 'flow_id': '1', 'new_status': 'BLOCKED'}
        self.assertEqual(self.post(wa.flows_event(value)).status_code, 200)

        def events(channel):
            return self.env['webvue.inbox.event'].search_count([('channel_id', '=', channel.id)])

        self.assertEqual((events(self.channel), events(sibling), events(other)), (1, 1, 0))

    def test_an_unknown_account_and_a_bad_signature_answer_403(self):
        value = {'event': 'FLOW_STATUS_CHANGE', 'flow_id': '1', 'new_status': 'BLOCKED'}
        self.assertError(self.post(wa.flows_event(value, account_id='999999999999')), 403, 'forbidden')
        self.assertError(self.post(wa.flows_event(value), signature='sha256=' + '0' * 64), 403, 'forbidden')

    def test_a_completed_form_is_routed_by_phone_number_like_any_message(self):
        self.assertEqual(self.post(wa.flow_reply({'flow_token': 'x'})).status_code, 200)


@tagged('post_install', '-at_install', 'webvue')
class TestFlowSubmissions(FlowCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.flow = cls.make_flow(name='Visit form', completion_message='Thank you!')
        cls.conversation = cls.make_conversation()
        cls.wa_id = cls.conversation.identity_id.address

    def setUp(self):
        super().setUp()
        self.login(self.agent)

    def sent_request(self, flow=None):
        return self.send_form(flow or self.flow, self.conversation)

    def answer(self, response, **kwargs):
        return self.deliver_form(response, wa_id=self.wa_id, **kwargs)

    def submission(self, message):
        return message.flow_submission_ids

    def values(self, submission):
        return {
            answer.key: (answer.kind, answer.value_text, answer.value_date.isoformat() if answer.value_date else None, answer.value_boolean,
                         [(choice.key, choice.title) for choice in answer.choice_ids])
            for answer in submission.answer_ids
        }

    def test_the_answer_is_matched_by_token_and_stored_typed(self):
        request = self.sent_request()
        message = self.answer({'flow_token': request.flow_token, **ANSWERS})
        submission = self.submission(message)
        self.assertEqual(
            (message.kind, message.direction, message.body, message.conversation_id, submission.flow_id, submission.request_message_id),
            ('flow_response', 'in', 'Visit form', self.conversation, self.flow, request),
        )
        self.assertEqual(self.values(submission), {
            'full_name': ('text_input', 'Sara Ali', None, False, []),
            'service': ('dropdown', False, None, False, [('o2', 'Dental')]),
            'day': ('date', False, '2026-11-20', False, []),
            'extras': ('checkbox', False, None, False, [('o1', 'Xray'), ('o3', 'Whitening')]),
            'notes': ('text_area', 'Please call first', None, False, []),
            'consent': ('opt_in', False, None, True, []),
        })
        labels = {answer.key: answer.label for answer in submission.answer_ids}
        self.assertEqual((labels['full_name'], labels['service']), ('Name', 'service'))

    def test_the_context_id_is_the_fallback_and_the_token_wins(self):
        request = self.sent_request()
        by_context = self.answer({'flow_token': 'something-else', 'full_name': 'A'}, context_id=request.provider_message_id)
        self.assertEqual(self.submission(by_context).request_message_id, request)
        by_none = self.answer({'full_name': 'B'})
        self.assertEqual((self.submission(by_none).flow_id, self.submission(by_none).request_message_id), (self.env['webvue.inbox.flow'], self.env['webvue.inbox.message']))
        other_request = self.sent_request()
        both = self.answer({'flow_token': other_request.flow_token, 'full_name': 'C'}, context_id=request.provider_message_id)
        self.assertEqual(self.submission(both).request_message_id, other_request)

    def test_a_token_of_another_customer_does_not_match(self):
        request = self.sent_request()
        stranger = self.deliver_form({'flow_token': request.flow_token, 'full_name': 'X'}, wa_id='966599998888')
        self.assertFalse(self.submission(stranger).flow_id)
        self.assertNotEqual(stranger.conversation_id, self.conversation)

    def test_unknown_keys_are_dropped_and_bad_values_are_noted(self):
        request = self.sent_request()
        message = self.answer({
            'flow_token': request.flow_token, 'full_name': 'x' * 5000, 'service': 'o9', 'day': '2026-13-45', 'extras': ['o1', 'o1'],
            'notes': {'nested': 1}, 'consent': 'yes', 'surprise': 'dropped',
        })
        submission = self.submission(message)
        self.assertFalse(submission.answer_ids)
        notes = self.notes(self.conversation)
        self.assertIn(
            flow_submission.NOTE_IGNORED % ('Visit form', 'full_name، service، day، extras، notes، consent'), notes,
        )

    def test_a_number_input_accepts_a_number_and_stores_text(self):
        flow = self.make_flow(screens=[{'title': 'T', 'footer_label': 'Go', 'fields': [
            text_input('age', input_type='number'), text_input('code'), choice('radio', 'pick', ['A', 'B']),
        ]}])
        request = self.sent_request(flow)
        message = self.answer({'flow_token': request.flow_token, 'age': 42, 'code': 7, 'pick': ['o1']})
        values = self.values(self.submission(message))
        self.assertEqual(values['age'][1], '42')
        self.assertNotIn('code', values)
        self.assertNotIn('pick', values)

    def test_an_external_form_keeps_every_scalar_as_an_unknown_answer(self):
        external = self.make_flow(supported=False, screens=[])
        request = self.sent_request(external)
        answers = {'flow_token': request.flow_token, 'a': 'text', 'b': 5, 'c': True, 'd': ['x', 'y'], 'e': {'no': 1}, 'f' * 65: 'long key'}
        message = self.answer(answers)
        values = self.values(self.submission(message))
        self.assertEqual({key: value[:2] for key, value in values.items()}, {
            'a': ('unknown', 'text'), 'b': ('unknown', '5'), 'c': ('unknown', 'true'), 'd': ('unknown', 'x، y'),
        })
        self.assertEqual(self.submission(message).flow_id, external)

    def test_an_unreadable_body_is_still_stored_as_a_submission_without_answers(self):
        request = self.sent_request()
        message = self.answer('not json', context_id=request.provider_message_id)
        submission = self.submission(message)
        self.assertEqual((message.kind, bool(submission), submission.answer_ids.ids, submission.flow_id), ('flow_response', True, [], self.flow))

    def test_a_redelivered_answer_is_stored_once_and_a_second_completion_is_its_own_submission(self):
        request = self.sent_request()
        first = self.answer({'flow_token': request.flow_token, 'full_name': 'A'}, provider_id='wamid.SAME')
        again = self.answer({'flow_token': request.flow_token, 'full_name': 'A'}, provider_id='wamid.SAME')
        self.assertEqual(first, again)
        self.assertEqual(len(self.submission(first)), 1)
        second = self.answer({'flow_token': request.flow_token, 'full_name': 'B'})
        self.assertEqual(self.env['webvue.inbox.flow.submission'].search_count([('request_message_id', '=', request.id)]), 2)
        self.assertNotEqual(self.submission(second), self.submission(first))

    def test_the_completion_message_is_queued_first(self):
        request = self.sent_request()
        message = self.answer({'flow_token': request.flow_token, 'full_name': 'A'})
        sent = self.automated(message.conversation_id)
        self.assertEqual([(m.body, m.kind, m.delivery_state) for m in sent], [('Thank you!', 'text', 'queued')])
        self.assertIn(flow_submission.NOTE_COMPLETION % 'Visit form', self.notes(message.conversation_id))

    def test_a_late_answer_gets_a_note_instead_of_a_completion_message(self):
        request = self.sent_request()
        message = self.answer({'flow_token': request.flow_token, 'full_name': 'A'}, age=timedelta(hours=25))
        self.assertTrue(self.submission(message))
        self.assertFalse(self.automated(message.conversation_id))
        self.assertIn(flow_submission.NOTE_COMPLETION_STALE % 'Visit form', self.notes(message.conversation_id))

    def test_empty_optional_answers_are_skipped_silently(self):
        request = self.sent_request()
        message = self.answer({
            'flow_token': request.flow_token, 'full_name': 'A', 'service': 'o1', 'day': '2026-11-20', 'consent': True,
            'extras': [], 'notes': '',
        })
        self.assertEqual(set(self.submission(message).answer_ids.mapped('key')), {'full_name', 'service', 'day', 'consent'})
        self.assertFalse([note for note in self.notes(self.conversation) if 'تُجوهلت' in note])

    def test_no_completion_message_when_the_form_has_none(self):
        silent = self.make_flow(completion_message=False)
        request = self.sent_request(silent)
        message = self.answer({'flow_token': request.flow_token, 'full_name': 'A'})
        self.assertFalse(self.automated(message.conversation_id))

    def automated_request(self, flow):
        """The form sent by the automation (no agent is handling the conversation, so a rule may reply)."""
        return self.env['webvue.inbox.message'].create({
            'conversation_id': self.conversation.id, 'company_id': self.conversation.company_id.id, 'direction': 'out',
            'kind': 'interactive', 'interactive_type': 'flow', 'flow_id': flow.id, 'flow_cta': 'Open', 'body': 'Fill this',
            'flow_token': 'automated-token', 'delivery_state': 'sent', 'provider_message_id': 'wamid.AUTOREQ', 'automated': True,
        })

    def test_a_form_rule_runs_its_actions_and_other_rules_stay_quiet(self):
        rule = self.make_rule(name='on form', match_kind='flow', flow_id=self.flow.id, priority='urgent', reply={'body': 'We got your form'})
        other_flow = self.make_flow(name='Other form')
        self.make_rule(name='other form', match_kind='flow', flow_id=other_flow.id, priority='low', reply={'body': 'wrong'}, stop=False)
        self.make_rule(name='text rule', keywords=['Visit form'], reply={'body': 'text wrong'})
        request = self.automated_request(self.flow)
        message = self.answer({'flow_token': request.flow_token, 'full_name': 'A'})
        conversation = message.conversation_id
        self.assertEqual(conversation.priority, 'urgent')
        bodies = self.automated(conversation).filtered(lambda m: m.id != request.id).mapped('body')
        self.assertEqual(bodies, ['Thank you!', 'We got your form'])
        self.assertIn(engine.NOTE_RULE_REPLY % rule.name, self.notes(conversation))

    def test_welcome_and_away_do_not_fire_on_a_form_answer(self):
        self.set_text('welcome', 'Welcome!')
        self.set_text('away', 'We are away', away_repeat_hours=1)
        self.set_company_hours(self.closed_hours_now())
        request = self.sent_request()
        message = self.answer({'flow_token': request.flow_token, 'full_name': 'A'})
        bodies = self.automated(message.conversation_id).mapped('body')
        self.assertNotIn('Welcome!', bodies)
        self.assertNotIn('We are away', bodies)

    def test_a_form_answer_does_not_count_as_a_survey_answer(self):
        self.conversation.write({'state': 'resolved'})
        request = self.sent_request()
        message = self.answer({'flow_token': request.flow_token, 'full_name': 'A'})
        self.assertFalse(message.conversation_id.csat_score)
        self.assertEqual(message.conversation_id.state, 'open')

    def test_the_submission_has_the_contract_shape_in_the_thread_and_the_lists(self):
        request = self.sent_request()
        message = self.answer({'flow_token': request.flow_token, **ANSWERS})
        thread = self.get(f'{BASE}/conversations/{self.conversation.id}/messages?limit=200').json()['items']
        shown = next(row for row in thread if row['id'] == message.id)
        card = shown['flow_response']
        self.assertEqual(set(card), SUBMISSION_KEYS)
        self.assertEqual(
            (shown['kind'], shown['body'], card['flow'], card['request_message_id'], card['message_id']),
            ('flow_response', 'Visit form', {'id': self.flow.id, 'name': 'Visit form'}, request.id, message.id),
        )
        self.assertEqual(card['answers'][0], {'key': 'full_name', 'label': 'Name', 'kind': 'text_input', 'value': 'Sara Ali'})
        self.assertEqual(card['answers'][1]['choices'], [{'key': 'o2', 'title': 'Dental'}])
        self.assertEqual(card['answers'][2], {'key': 'day', 'label': 'Day', 'kind': 'date', 'value': '2026-11-20'})
        self.assertEqual(card['answers'][5], {'key': 'consent', 'label': 'I agree', 'kind': 'opt_in', 'value': True})
        listed = self.get(f'{BASE}/conversations/{self.conversation.id}/flow-submissions').json()
        self.assertEqual((listed['total'], listed['items'][0]), (1, card))
        by_flow = self.get(f'{BASE}/flows/{self.flow.id}/submissions').json()
        self.assertEqual((by_flow['total'], by_flow['items'][0]['id']), (1, card['id']))
        self.assertEqual(self.get(f'{BASE}/flows/{self.flow.id}').json()['submission_count'], 1)

    def test_the_form_list_filters_by_date(self):
        request = self.sent_request()
        self.answer({'flow_token': request.flow_token, 'full_name': 'A'})
        path = f'{BASE}/flows/{self.flow.id}/submissions'
        self.assertEqual(self.get(f'{path}?date_from=2000-01-01&date_to=2999-01-01').json()['total'], 1)
        self.assertEqual(self.get(f'{path}?date_to=2000-01-01').json()['total'], 0)
        self.assertEqual(self.get(f'{path}?date_from=2999-01-01').json()['total'], 0)
        self.assertError(self.get(f'{path}?date_from=yesterday'), 422, 'invalid')

    def test_a_flows_manager_without_the_read_capability_cannot_read_answers(self):
        self.login(self.flows_user)
        self.assertError(self.get(f'{BASE}/flows/{self.flow.id}/submissions'), 403, 'forbidden')
        self.assertEqual(self.get(f'{BASE}/flows/{self.flow.id}').json()['submission_count'], 0)


@tagged('post_install', '-at_install', 'webvue')
class TestFlowStatusEvents(FlowCase):

    def process(self, value, account_id=BUSINESS_ACCOUNT_ID):
        return self.run_event(wa.flows_event(value, account_id))

    def test_a_status_change_updates_the_form(self):
        flow = self.make_flow(status='draft')
        self.process({'event': 'FLOW_STATUS_CHANGE', 'flow_id': flow.provider_flow_id, 'old_status': 'DRAFT', 'new_status': 'PUBLISHED'})
        self.assertEqual(flow.status, 'published')
        self.process({'event': 'FLOW_STATUS_CHANGE', 'flow_id': flow.provider_flow_id, 'new_status': 'DEPRECATED'})
        self.assertEqual(flow.status, 'deprecated')
        self.process({'event': 'FLOW_STATUS_CHANGE', 'flow_id': flow.provider_flow_id, 'new_status': 'SOMETHING_NEW'})
        self.assertEqual(flow.status, 'deprecated')

    def test_a_version_warning_is_stored(self):
        flow = self.make_flow()
        self.process({'event': 'FLOW_VERSION_EXPIRY_WARNING', 'flow_id': flow.provider_flow_id, 'warning': 'Version 5.0 expires'})
        self.assertEqual(flow.version_warning, 'Version 5.0 expires')
        self.login(self.manager)
        self.assertEqual(self.get(f'{BASE}/flows/{flow.id}').json()['version_warning'], 'Version 5.0 expires')

    def test_an_unknown_form_and_endpoint_alerts_change_nothing(self):
        flow = self.make_flow()
        self.process({'event': 'FLOW_STATUS_CHANGE', 'flow_id': '404', 'new_status': 'BLOCKED'})
        self.process({'event': 'ENDPOINT_AVAILABILITY', 'flow_id': flow.provider_flow_id, 'alert_state': 'ACTIVATED'})
        self.assertEqual(flow.status, 'published')
