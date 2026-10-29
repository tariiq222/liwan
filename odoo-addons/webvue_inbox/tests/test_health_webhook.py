# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import requests

from odoo.tests import tagged

from . import whatsapp_payloads as wa
from .common import BUSINESS_ACCOUNT_ID, WebVueInboxCase
from .health_common import (
    DISPLAY_NUMBER,
    EVENT_TIME,
    HEALTH_BODY,
    account_event,
    health_bell_partners,
    meta,
    process,
)
from odoo.addons.webvue_inbox.adapters import whatsapp

HOOK = '/api/v1/inbox/hooks/whatsapp'
SIBLING_SECRET = 'sibling-secret-0123456789abcdef'
FIELDS = {
    'phone_number_quality_update': {'display_phone_number': '+966 50 111 2222', 'event': 'THROUGHPUT_UPGRADE'},
    'phone_number_name_update': {'display_phone_number': '966501112222', 'decision': 'PENDING', 'requested_verified_name': 'New'},
    'account_update': {'event': 'ACCOUNT_VIOLATION', 'violation_info': {'violation_type': 'SPAM'}},
    'business_capability_update': {'max_daily_conversations_per_business': 10000},
    'account_alerts': {'alert_type': 'INCREASED_CAPABILITIES_ELIGIBILITY_FAILED'},
}


@tagged('post_install', '-at_install', 'webvue')
class TestHealthWebhook(WebVueInboxCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.channel.display_phone_number = DISPLAY_NUMBER
        cls.sibling = cls.make_channel(
            phone_id='100000000002', display_phone_number='966599999999',
            **cls.env['webvue.inbox.channel']._webvue_secret_values(app_secret=SIBLING_SECRET),
        )

    def post(self, payload, secret=None):
        raw = wa.body_of(payload)
        return self.url_open(HOOK, data=raw, headers={
            'Content-Type': 'application/json', 'X-Hub-Signature-256': wa.sign(raw, secret) if secret else wa.sign(raw),
        }, method='POST')

    def alerts(self, channel=None):
        return self.env['webvue.inbox.channel.alert'].search([('channel_id', '=', (channel or self.channel).id)])

    def test_every_health_field_is_routed_by_the_account_id_and_signed_by_the_channel_secret(self):
        for field, value in FIELDS.items():
            payload = account_event(field, value)
            self.assertEqual(self.post(payload).status_code, 200, field)
            self.assertEqual(self.post(payload, secret=SIBLING_SECRET).status_code, 200, field)
            self.assertEqual(self.post(payload, secret='wrong-secret-0123456789').status_code, 403, field)
            self.assertEqual(self.post(account_event(field, value, account_id='999999999999')).status_code, 403, field)
        events = self.env['webvue.inbox.event'].search([])
        self.assertEqual(sorted(set(events.channel_id.ids)), sorted([self.channel.id, self.sibling.id]))

    def test_phone_scoped_events_reach_only_the_channel_with_that_number(self):
        value = {'display_phone_number': '+966 50 111 2222', 'decision': 'REJECTED', 'requested_verified_name': 'Bad',
                 'rejection_reason': 'NAME_FORMAT_UNACCEPTABLE'}
        payload = account_event('phone_number_name_update', value)
        process(self, self.channel, payload)
        process(self, self.sibling, payload)
        self.assertEqual((self.channel.name_status, self.sibling.name_status), ('declined', 'unknown'))
        self.assertEqual((self.channel.name_rejection_reason, self.channel.requested_name), ('NAME_FORMAT_UNACCEPTABLE', 'Bad'))
        self.assertEqual(self.alerts().kind, 'name_rejected')
        self.assertFalse(self.alerts(self.sibling))

    def test_a_channel_without_a_known_number_ignores_phone_scoped_events(self):
        self.sibling.display_phone_number = False
        value = {'display_phone_number': '966599999999', 'decision': 'APPROVED', 'requested_verified_name': 'Ok'}
        process(self, self.sibling, account_event('phone_number_name_update', value))
        self.assertEqual(self.sibling.name_status, 'unknown')

    def test_account_wide_events_reach_every_channel_of_the_account(self):
        payload = account_event('business_capability_update', {'max_daily_conversations_per_business': 'TIER_10K'})
        process(self, self.channel, payload)
        process(self, self.sibling, payload)
        self.assertEqual((self.channel.messaging_limit, self.sibling.messaging_limit), ('tier_10k', 'tier_10k'))

    def test_limits_parse_from_words_integers_and_minus_one(self):
        for index, (value, expected) in enumerate((('TIER_100K', 'tier_100k'), (250, 'tier_250'), (-1, 'unlimited'))):
            process(self, self.channel, account_event(
                'business_capability_update', {'max_daily_conversation_per_phone': value}, time=EVENT_TIME + index,
            ))
            self.assertEqual(self.channel.messaging_limit, expected)
        self.assertEqual(len(self.alerts()), 3)

    def test_a_lowered_limit_is_a_warning_with_a_bell(self):
        self.channel.messaging_limit = 'tier_10k'
        process(self, self.channel, account_event('business_capability_update', {'max_daily_conversations_per_business': 2000}))
        (alert,) = self.alerts()
        self.assertEqual((alert.severity, alert.previous_messaging_limit, alert.messaging_limit), ('warning', 'tier_10k', 'tier_2k'))
        self.assertIn(self.manager.partner_id, health_bell_partners(self))

    def test_a_restriction_stores_its_expiry(self):
        value = {'event': 'ACCOUNT_RESTRICTION', 'restriction_info': [
            {'restriction_type': 'RESTRICTED_BIZ_INITIATED_MESSAGING', 'expiration': EVENT_TIME + 86400},
            {'restriction_type': 'RESTRICTED_ADD_PHONE_NUMBER_ACTION', 'expiration': EVENT_TIME + 3 * 86400},
        ]}
        process(self, self.channel, account_event('account_update', value))
        self.assertEqual(self.channel.account_state, 'restricted')
        self.assertEqual(self.channel.account_restricted_until, datetime.fromtimestamp(EVENT_TIME + 3 * 86400, timezone.utc).replace(tzinfo=None))
        (alert,) = self.alerts()
        self.assertEqual((alert.kind, alert.reason, alert.severity), ('account_restricted', 'RESTRICTED_BIZ_INITIATED_MESSAGING', 'warning'))

    def test_disabling_scheduling_and_reinstating_the_account(self):
        cases = (
            ({'event': 'DISABLED_UPDATE', 'ban_info': {'waba_ban_state': 'SCHEDULE_FOR_DISABLE', 'waba_ban_date': '2026-12-01'}},
             'scheduled_for_disable'),
            ({'event': 'DISABLED_UPDATE', 'ban_info': {'waba_ban_state': 'DISABLE'}}, 'disabled'),
            ({'event': 'DISABLED_UPDATE', 'ban_info': {'waba_ban_state': 'REINSTATE'}}, 'active'),
            ({'event': 'ACCOUNT_OFFBOARDED'}, 'disabled'),
            ({'event': 'ACCOUNT_RECONNECTED'}, 'active'),
        )
        for index, (value, state) in enumerate(cases):
            process(self, self.channel, account_event('account_update', value, time=EVENT_TIME + index))
            self.assertEqual(self.channel.account_state, state)
        self.assertEqual(self.alerts().mapped('kind').count('account_disabled'), 3)

    def test_events_the_inbox_does_not_act_on_are_ignored(self):
        process(self, self.channel, account_event('account_update', {'event': 'AD_ACCOUNT_LINKED'}))
        process(self, self.channel, account_event('account_alerts', {'alert_type': 'SOMETHING_ELSE'}))
        self.assertFalse(self.alerts())

    def test_a_replay_of_the_same_event_is_harmless(self):
        payload = account_event('account_alerts', {'alert_type': 'INCREASED_CAPABILITIES_ELIGIBILITY_DEFERRED'})
        violation = account_event('account_update', {'event': 'ACCOUNT_VIOLATION', 'violation_info': {'violation_type': 'SPAM'}})
        for body in (payload, payload, violation, violation):
            process(self, self.channel, body)
        self.assertEqual(sorted(self.alerts().mapped('kind')), ['account_violation', 'scaling_denied'])

    def test_throughput_upgrade_and_quality_events(self):
        process(self, self.channel, account_event('phone_number_quality_update', {
            'display_phone_number': '966501112222', 'event': 'THROUGHPUT_UPGRADE', 'current_limit': 'TIER_10K', 'old_limit': 'TIER_2K',
        }))
        self.assertEqual((self.channel.throughput_level, self.channel.messaging_limit), ('high', 'tier_10k'))
        self.assertEqual(sorted(self.alerts().mapped('kind')), ['messaging_limit_changed', 'throughput_upgraded'])
        with patch.object(requests, 'request', MagicMock(return_value=meta({**HEALTH_BODY, 'quality_rating': 'YELLOW'}))):
            process(self, self.channel, account_event('phone_number_quality_update', {
                'display_phone_number': '966501112222', 'event': 'FLAGGED',
            }, time=EVENT_TIME + 5))
        self.assertEqual(self.channel.quality_rating, 'yellow')

    def test_parsing_ignores_malformed_changes(self):
        for field, value in (('account_update', {}), ('business_capability_update', {'max_daily_conversations_per_business': 'x'}),
                             ('phone_number_name_update', {'display_phone_number': DISPLAY_NUMBER}), ('account_alerts', 'x')):
            self.assertEqual(whatsapp.parse_events(account_event(field, value), 'p', BUSINESS_ACCOUNT_ID, DISPLAY_NUMBER), [], field)
