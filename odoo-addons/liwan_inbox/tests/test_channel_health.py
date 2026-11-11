# Part of Odoo. See LICENSE file for full copyright and licensing details.
from unittest.mock import MagicMock, patch

import requests

from odoo import Command
from odoo.tests import new_test_user, tagged

from .common import PASSWORD, LiwanInboxCase
from .health_common import HEALTH_BODY, health_bell_partners, meta, meta_error
from odoo.addons.liwan_inbox.adapters import whatsapp

HEALTH_KEYS = {
    'display_phone_number', 'verified_name', 'name_status', 'requested_name', 'name_rejection_reason', 'quality_rating',
    'messaging_limit', 'throughput_level', 'code_verified', 'account_state', 'account_restricted_until', 'checked_at',
    'template_insights_enabled', 'currency', 'analytics_synced_at', 'analytics_error',
}


@tagged('post_install', '-at_install', 'liwan')
class TestChannelHealth(LiwanInboxCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.branch = cls.env['res.company'].create({'name': 'Health branch company', 'parent_id': cls.env.company.id})
        cls.branch_channel = cls.make_channel(phone_id='710000000001', owner_company_id=cls.branch.id)
        cls.branch_manager = new_test_user(
            cls.env, login='inbox_branch_manager', password=PASSWORD, name='Branch manager', groups='base.group_user',
            company_id=cls.env.company.id, company_ids=[Command.set((cls.env.company | cls.branch).ids)],
        )
        cls.env['liwan.access.assignment'].create({
            'user_id': cls.branch_manager.id, 'company_id': cls.branch.id,
            'role_id': cls.env.ref('liwan_inbox.role_inbox_manager').id,
        })
        cls.branch_manager.group_ids = [Command.link(cls.env.ref('liwan_inbox.group_cap_inbox_channels_manage').id)]

    def refresh(self, body, channel=None):
        with patch.object(requests, 'request', MagicMock(return_value=meta(body))) as mocked:
            (channel or self.channel)._liwan_refresh_health()
        return mocked

    def alerts(self, channel=None):
        return self.env['liwan.inbox.channel.alert'].search([('channel_id', '=', (channel or self.channel).id)])

    def test_the_test_route_stores_every_field_of_the_reading(self):
        self.login(self.manager)
        with patch.object(requests, 'request', MagicMock(return_value=meta(HEALTH_BODY))) as mocked:
            body = self.api('POST', f'/api/v1/inbox/channels/{self.channel.id}/test').json()
        self.assertEqual(set(body['health']), HEALTH_KEYS)
        self.assertEqual(
            {key: body['health'][key] for key in ('display_phone_number', 'verified_name', 'name_status', 'quality_rating',
                                                  'messaging_limit', 'throughput_level', 'code_verified', 'account_state')},
            {'display_phone_number': '966501112222', 'verified_name': 'Acme', 'name_status': 'approved',
             'quality_rating': 'green', 'messaging_limit': 'tier_2k', 'throughput_level': 'standard',
             'code_verified': True, 'account_state': 'active'},
        )
        self.assertIsNotNone(body['health']['checked_at'])
        self.assertIn('whatsapp_business_manager_messaging_limit', mocked.call_args.kwargs['params']['fields'])
        self.assertTrue(mocked.call_args.args[1].startswith('https://graph.facebook.com/v26.0/'))

    def test_missing_or_unknown_values_are_unknown_and_never_an_error(self):
        self.refresh({'quality_rating': 'NA', 'name_status': 'SURPRISE', 'throughput': 'x'})
        channel = self.channel
        self.assertEqual(
            (channel.quality_rating, channel.name_status, channel.messaging_limit, channel.throughput_level, channel.code_verified),
            ('unknown', 'unknown', 'unknown', 'unknown', False),
        )
        self.assertEqual((channel.state, self.alerts()), ('connected', self.alerts().browse()))

    def test_a_change_writes_an_alert_and_rings_only_the_managers_of_the_company(self):
        self.refresh({**HEALTH_BODY, 'quality_rating': 'GREEN'})
        self.assertFalse(self.alerts())  # the first reading is not a change
        self.refresh({**HEALTH_BODY, 'quality_rating': 'RED', 'whatsapp_business_manager_messaging_limit': 'TIER_250'})
        kinds = {alert.kind: alert for alert in self.alerts()}
        self.assertEqual(set(kinds), {'quality_changed', 'messaging_limit_changed'})
        self.assertEqual((kinds['quality_changed'].severity, kinds['quality_changed'].quality_rating), ('danger', 'red'))
        self.assertEqual(
            (kinds['messaging_limit_changed'].severity, kinds['messaging_limit_changed'].previous_messaging_limit),
            ('warning', 'tier_2k'),
        )
        partners = health_bell_partners(self)
        self.assertIn(self.manager.partner_id, partners)
        for other in (self.agent, self.supervisor, self.branch_manager):
            self.assertNotIn(other.partner_id, partners)

    def test_an_improvement_is_an_info_row_without_a_bell(self):
        self.refresh({**HEALTH_BODY, 'quality_rating': 'YELLOW'})
        self.assertEqual(self.alerts().severity, 'warning')
        self.env['mail.message'].search([('liwan_notification_kind', '=', 'inbox.channel_health')]).unlink()
        self.refresh({**HEALTH_BODY, 'quality_rating': 'GREEN'})
        self.assertEqual(self.alerts()[0].severity, 'info')
        self.assertFalse(health_bell_partners(self))

    def test_the_branch_manager_is_rung_for_the_branch_channel_only(self):
        self.refresh({**HEALTH_BODY, 'quality_rating': 'RED'}, channel=self.branch_channel)
        partners = health_bell_partners(self)
        self.assertIn(self.branch_manager.partner_id, partners)
        self.assertNotIn(self.manager.partner_id, partners)

    def test_an_identical_refresh_writes_nothing(self):
        self.refresh({**HEALTH_BODY, 'quality_rating': 'YELLOW'})
        before = self.alerts()
        self.refresh({**HEALTH_BODY, 'quality_rating': 'YELLOW'})
        self.assertEqual(self.alerts(), before)

    def test_a_provider_failure_sets_error_with_one_alert(self):
        for _attempt in range(2):
            with patch.object(requests, 'request', MagicMock(return_value=meta_error('Invalid OAuth access token', 401))):
                self.channel._liwan_refresh_health()
        self.assertEqual((self.channel.state, self.channel.last_error), ('error', 'Invalid OAuth access token'))
        self.assertEqual(self.alerts().mapped('kind'), ['connection_failed'])
        self.refresh(HEALTH_BODY)
        self.assertEqual((self.channel.state, self.channel.last_error), ('connected', False))

    def test_the_cron_refreshes_connected_channels_only(self):
        draft = self.make_channel(phone_id='710000000009', state='draft')
        with patch.object(requests, 'request', MagicMock(return_value=meta(HEALTH_BODY))) as mocked:
            self.env['liwan.inbox.channel']._liwan_run_health()
        self.assertTrue(self.channel.health_checked_at)
        self.assertFalse(draft.health_checked_at)
        self.assertEqual(mocked.call_count, 2)  # the main channel and the branch channel

    def test_a_lapsed_restriction_ends_on_the_next_reading(self):
        self.channel.write({'account_state': 'restricted', 'account_restricted_until': '2020-01-01 00:00:00'})
        self.refresh(HEALTH_BODY)
        self.assertEqual((self.channel.account_state, self.alerts().kind), ('active', 'account_reinstated'))

    def test_the_adapter_maps_meta_words(self):
        for value, expected in (('TIER_2K', 'tier_2k'), (2000, 'tier_2k'), ('2000', 'tier_2k'), (-1, 'unlimited'),
                                ('TIER_UNLIMITED', 'unlimited'), ('TIER_1K', 'unknown'), (None, None), (True, None)):
            self.assertEqual(whatsapp.parse_limit(value), expected, value)
