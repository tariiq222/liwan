# Part of Odoo. See LICENSE file for full copyright and licensing details.
import json
from datetime import timedelta

from odoo import fields
from odoo.tests import tagged

from . import whatsapp_payloads as wa
from .common import BUSINESS_ACCOUNT_ID, WebVueInboxCase
from odoo.addons.webvue_inbox.adapters import whatsapp

HOOK = '/api/v1/inbox/hooks/whatsapp'
STATUS = 'message_template_status_update'
CATEGORY = 'template_category_update'
QUALITY = 'message_template_quality_update'


def status_value(template, event, reason='NONE', **extra):
    return {
        'event': event, 'message_template_id': int(template.provider_template_id),
        'message_template_name': template.name, 'message_template_language': template.language, 'reason': reason, **extra,
    }


@tagged('post_install', '-at_install', 'webvue')
class TestTemplateWebhookRouting(WebVueInboxCase):

    def post(self, data, signature=None):
        raw = wa.body_of(data)
        return self.url_open(HOOK, data=raw, headers={
            'Content-Type': 'application/json', 'X-Hub-Signature-256': signature or wa.sign(raw),
        }, method='POST')

    def events(self, channel):
        return self.env['webvue.inbox.event'].search([('channel_id', '=', channel.id)])

    def test_an_account_level_change_reaches_the_channel_of_that_account(self):
        template = self.make_template()
        response = self.post(wa.template_event(STATUS, status_value(template, 'APPROVED')))
        self.assertEqual((response.status_code, response.text), (200, 'ok'))
        self.assertEqual(len(self.events(self.channel)), 1)

    def test_every_channel_of_the_account_gets_the_change_and_nobody_else(self):
        sibling = self.make_channel(phone_id='100000000002')
        other_account = self.make_channel(phone_id='100000000003', business_account_id='299999999999')
        template = self.make_template()
        self.assertEqual(self.post(wa.template_event(QUALITY, {
            'message_template_id': int(template.provider_template_id), 'message_template_name': template.name,
            'message_template_language': 'ar', 'previous_quality_score': 'GREEN', 'new_quality_score': 'RED',
        })).status_code, 200)
        self.assertEqual((len(self.events(self.channel)), len(self.events(sibling)), len(self.events(other_account))), (1, 1, 0))

    def test_a_message_payload_does_not_fan_out_by_account(self):
        sibling = self.make_channel(phone_id='100000000002')
        self.assertEqual(self.post(wa.inbound_text()).status_code, 200)
        self.assertEqual((len(self.events(self.channel)), len(self.events(sibling))), (1, 0))

    def test_an_unknown_account_and_a_bad_signature_answer_403(self):
        template = self.make_template()
        value = status_value(template, 'APPROVED')
        self.assertError(self.post(wa.template_event(STATUS, value, account_id='999999999999')), 403, 'forbidden')
        self.assertError(self.post(wa.template_event(STATUS, value), signature='sha256=' + '0' * 64), 403, 'forbidden')
        self.assertFalse(self.events(self.channel))

    def test_a_disabled_channel_ignores_the_change(self):
        template = self.make_template()
        self.channel.state = 'disabled'
        self.assertError(self.post(wa.template_event(STATUS, status_value(template, 'APPROVED'))), 403, 'forbidden')


@tagged('post_install', '-at_install', 'webvue')
class TestTemplateEvents(WebVueInboxCase):

    def process(self, field, value, account_id=BUSINESS_ACCOUNT_ID, channel=None):
        event = self.env['webvue.inbox.event'].create({
            'channel_id': (channel or self.channel).id, 'owner_company_id': self.channel.owner_company_id.id,
            'payload': json.dumps(wa.template_event(field, value, account_id)),
        })
        self.env['webvue.inbox.event']._webvue_run_events()
        self.assertEqual(event.state, 'done', event.error)

    def test_parsing_yields_typed_changes_only_for_the_channels_account(self):
        template = self.make_template()
        payload = wa.template_event(STATUS, status_value(template, 'REJECTED', reason='INCORRECT_CATEGORY'))
        (update,) = whatsapp.parse_events(payload, self.channel.phone_number_id, BUSINESS_ACCOUNT_ID)
        self.assertEqual(update, whatsapp.TemplateStatusUpdate(
            template.provider_template_id, template.name, 'ar', 'REJECTED', 'INCORRECT_CATEGORY'))
        self.assertEqual(whatsapp.parse_events(payload, self.channel.phone_number_id, '1'), [])
        self.assertEqual(whatsapp.template_business_account_ids(payload), {BUSINESS_ACCOUNT_ID})
        self.assertEqual(whatsapp.template_business_account_ids(wa.inbound_text()), set())

    def test_parsing_ignores_malformed_changes(self):
        for field, value in ((STATUS, {}), (STATUS, {'event': 5}), (CATEGORY, {'message_template_id': 1}), (QUALITY, 'x'),
                             (STATUS, {'event': 'APPROVED', 'message_template_id': 1, 'message_template_name': 'a'})):
            self.assertEqual(whatsapp.parse_events(wa.template_event(field, value), 'p', BUSINESS_ACCOUNT_ID), [])
        self.assertEqual(whatsapp.parse_events({'entry': [{'id': BUSINESS_ACCOUNT_ID, 'changes': [{'field': STATUS}]}]}, 'p', BUSINESS_ACCOUNT_ID), [])

    def test_status_changes_update_status_and_reason(self):
        template = self.make_template(status='pending')
        cases = (
            ('APPROVED', 'NONE', 'approved', False), ('REJECTED', 'INVALID_FORMAT', 'rejected', 'INVALID_FORMAT'),
            ('PAUSED', 'NONE', 'paused', False), ('DISABLED', 'NONE', 'disabled', False), ('FLAGGED', 'NONE', 'flagged', False),
            ('IN_APPEAL', 'NONE', 'in_appeal', False), ('PENDING', 'NONE', 'pending', False),
            ('PENDING_DELETION', 'NONE', 'pending_deletion', False), ('REINSTATED', 'NONE', 'approved', False),
        )
        for event, reason, status, expected_reason in cases:
            self.process(STATUS, status_value(template, event, reason))
            self.assertEqual((template.status, template.status_reason), (status, expected_reason), event)

    def test_the_reason_falls_back_to_the_description_of_other_info(self):
        template = self.make_template()
        self.process(STATUS, status_value(template, 'DISABLED', other_info={'title': 'T', 'description': 'Low quality for 7 days'}))
        self.assertEqual((template.status, template.status_reason), ('disabled', 'Low quality for 7 days'))

    def test_an_unknown_status_word_disables_the_template_and_keeps_the_word(self):
        template = self.make_template()
        self.process(STATUS, status_value(template, 'ARCHIVED_FOR_REVIEW'))
        self.assertEqual((template.status, template.status_reason), ('disabled', 'ARCHIVED_FOR_REVIEW'))

    def test_a_deleted_template_is_removed_and_its_queued_replies_fail(self):
        template = self.make_template()
        conversation = self.make_conversation()
        queued = self.env['webvue.inbox.message'].create({
            'conversation_id': conversation.id, 'direction': 'out', 'kind': 'template', 'body': 'x', 'delivery_state': 'queued',
            'template_name': template.name, 'template_language': 'ar', 'template_params': [], 'template_id': template.id,
            'next_attempt_at': fields.Datetime.now() - timedelta(seconds=1),
        })
        self.process(STATUS, status_value(template, 'DELETED'))
        self.assertFalse(template.exists())
        self.run_outbox_offline()
        self.assertEqual((queued.delivery_state, queued.error), ('failed', 'The template was removed by the provider.'))

    def test_category_and_quality_changes(self):
        template = self.make_template(category='utility')
        base = {'message_template_id': int(template.provider_template_id), 'message_template_name': template.name, 'message_template_language': 'ar'}
        self.process(CATEGORY, {**base, 'previous_category': 'UTILITY', 'new_category': 'MARKETING'})
        self.assertEqual(template.category, 'marketing')
        self.process(CATEGORY, {**base, 'previous_category': 'MARKETING', 'new_category': 'SOMETHING_NEW'})
        self.assertEqual(template.category, 'marketing')
        for score, expected in (('RED', 'red'), ('YELLOW', 'yellow'), ('GREEN', 'green'), ('UNKNOWN', 'unknown'), ('WEIRD', 'unknown')):
            self.process(QUALITY, {**base, 'previous_quality_score': 'GREEN', 'new_quality_score': score})
            self.assertEqual(template.quality, expected, score)

    def test_a_template_is_found_by_name_and_language_when_its_id_is_not_stored_yet(self):
        template = self.make_template(provider_template_id=False)
        self.process(STATUS, {**status_value(template, 'APPROVED'), 'message_template_id': 424242})
        self.assertEqual((template.status, template.provider_template_id), ('approved', '424242'))

    def test_an_unknown_template_and_other_channels_templates_are_untouched(self):
        sibling = self.make_channel(phone_id='100000000002')
        mine = self.make_template(status='pending')
        theirs = self.make_template(channel=sibling, status='pending', provider_template_id=mine.provider_template_id, name=mine.name)
        self.process(STATUS, status_value(mine, 'APPROVED'))
        self.assertEqual((mine.status, theirs.status), ('approved', 'pending'))
        self.process(STATUS, {**status_value(mine, 'REJECTED'), 'message_template_id': 1, 'message_template_name': 'nothing'})
        self.assertEqual(mine.status, 'approved')

    def bus_notices(self):
        """(partner id, bus type, payload) of every bus notification stored so far in this transaction (the event run flushes them)."""
        notices = []
        for row in self.env['bus.bus'].sudo().search([], order='id'):
            channel, message = json.loads(row.channel), json.loads(row.message)
            if message['type'] == 'webvue/inbox':
                notices.append((channel[2], message['type'], message['payload']))
        return notices

    def test_a_change_reaches_the_users_who_read_or_manage_templates_over_the_bus(self):
        template = self.make_template(status='pending')
        before = len(self.bus_notices())
        self.process(STATUS, status_value(template, 'APPROVED'))
        self.process(STATUS, status_value(template, 'DELETED'))
        notices = self.bus_notices()[before:]
        audience = {partner for partner, _type, _payload in notices}
        self.assertTrue({self.agent.partner_id.id, self.templates_only.partner_id.id, self.manager.partner_id.id} <= audience)
        self.assertFalse({self.outsider.partner_id.id} & audience)
        self.assertEqual({(kind, payload['event'], payload['id']) for _partner, kind, payload in notices},
                         {('webvue/inbox', 'template', template.id)})
        self.assertEqual(len(notices), 2 * len(audience))

    def test_an_unknown_template_sends_nothing(self):
        template = self.make_template()
        before = len(self.bus_notices())
        self.process(STATUS, {**status_value(template, 'APPROVED'), 'message_template_id': 1, 'message_template_name': 'nothing'})
        self.assertEqual(self.bus_notices()[before:], [])
