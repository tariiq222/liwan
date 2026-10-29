# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date, datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import requests

from odoo import fields
from odoo.tests import tagged

from .common import BUSINESS_ACCOUNT_ID, WebVueInboxCase
from .health_common import DISPLAY_NUMBER, HEALTH_BODY, meta, meta_error
from odoo.addons.webvue_inbox.adapters import whatsapp

TODAY = fields.Datetime.now().date()


def unix(day):
    return int(datetime(day.year, day.month, day.day, tzinfo=timezone.utc).timestamp())


def pricing(*points):
    return {'pricing_analytics': {'data': [{'data_points': list(points)}]}}


def point(day, category='MARKETING', pricing_type='REGULAR', country='SA', volume=1, **extra):
    return {'start': unix(day), 'end': unix(day) + 86400, 'pricing_category': category, 'pricing_type': pricing_type,
            'country': country, 'volume': volume, **extra}


class Meta:
    """Answers Meta's calls by the resource they name and remembers them."""

    def __init__(self, **answers):
        self.answers = answers
        self.calls = []

    def __call__(self, method, url, **kwargs):
        self.calls.append((method, url, kwargs))
        for marker, answer in self.answers.items():
            if marker in url or marker in str(kwargs.get('params', {}).get('fields', '')):
                return answer
        return meta({'success': True})

    def to(self, marker):
        return [call for call in self.calls if marker in call[1] or marker in str(call[2].get('params', {}).get('fields', ''))]


@tagged('post_install', '-at_install', 'webvue')
class TestMetaAnalytics(WebVueInboxCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.channel.display_phone_number = DISPLAY_NUMBER

    def sync(self, fake, channel=None):
        with patch.object(requests, 'request', MagicMock(side_effect=fake)):
            self.env['webvue.inbox.meta.analytics']._webvue_sync(channel or self.channel)

    def costs(self):
        return self.env['webvue.inbox.cost.day'].search([('channel_id', '=', self.channel.id)])

    def test_pricing_points_are_stored_per_day_category_type_and_country(self):
        yesterday = TODAY - timedelta(days=1)
        fake = Meta(pricing_analytics=meta(pricing(
            point(yesterday, volume=3, cost=1.5), point(yesterday, country='AE', volume=2, cost=1.0),
            point(yesterday, category='SERVICE', pricing_type='FREE_CUSTOMER_SERVICE', volume=4),
            point(yesterday, category='SOMETHING_NEW', pricing_type='ODD', country='sa', volume=1, cost=0.25),
        )), currency=meta({'currency': 'SAR'}))
        self.sync(fake)
        rows = {(r.pricing_category, r.pricing_type, r.country): r for r in self.costs()}
        self.assertEqual(set(rows), {
            ('marketing', 'regular', 'SA'), ('marketing', 'regular', 'AE'), ('service', 'free_customer_service', 'SA'),
            ('unknown', 'unknown', 'SA'),
        })
        self.assertEqual((rows['marketing', 'regular', 'SA'].volume, rows['marketing', 'regular', 'SA'].cost), (3, 1.5))
        self.assertFalse(rows['service', 'free_customer_service', 'SA'].has_cost)  # Meta sent no cost: passed through as null
        self.assertEqual((self.channel.currency_code, self.channel.analytics_error), ('SAR', False))
        self.assertTrue(self.channel.analytics_synced_at)
        (call,) = fake.to('pricing_analytics')
        self.assertIn(f'phone_numbers(["{DISPLAY_NUMBER}"])', call[2]['params']['fields'])
        self.assertIn(f'start({unix(TODAY - timedelta(days=89))})', call[2]['params']['fields'])  # the first sync backfills 90 days

    def test_a_resync_replaces_the_window_and_later_syncs_read_three_days(self):
        yesterday = TODAY - timedelta(days=1)
        self.sync(Meta(pricing_analytics=meta(pricing(point(yesterday, volume=3)))))
        fake = Meta(pricing_analytics=meta(pricing(point(yesterday, volume=5))))
        self.sync(fake)
        self.assertEqual(self.costs().mapped('volume'), [5])
        self.assertIn(f'start({unix(TODAY - timedelta(days=2))})', fake.to('pricing_analytics')[0][2]['params']['fields'])

    def test_a_missing_currency_falls_back_to_null(self):
        self.sync(Meta(pricing_analytics=meta(pricing()), currency=meta_error('(#100) nonexisting field (currency)')))
        self.assertEqual((self.channel.currency_code, self.channel.analytics_error), (False, False))

    def test_a_provider_error_is_kept_on_the_channel(self):
        self.sync(Meta(pricing_analytics=meta_error('(#200) EU accounts are not supported')))
        self.assertIn('EU accounts', self.channel.analytics_error)
        self.assertFalse(self.channel.analytics_synced_at)
        self.assertTrue(self.channel.analytics_attempted_at)

    def test_a_channel_without_a_known_number_reads_its_health_first(self):
        self.channel.display_phone_number = False
        fake = Meta(pricing_analytics=meta(pricing()), display_phone_number=meta(HEALTH_BODY))
        self.sync(fake)
        self.assertEqual(self.channel.display_phone_number, DISPLAY_NUMBER)
        self.assertTrue(fake.to('pricing_analytics'))

    def template_answer(self, template, day, **extra):
        return meta({'data': [{'data_points': [{
            'template_id': template.provider_template_id, 'start': unix(day), 'sent': 10, 'delivered': 8, 'read': 5,
            'clicked': [{'type': 'quick_reply_button', 'button_content': 'Yes', 'count': 2},
                        {'type': 'url_button', 'button_content': 'Site', 'count': 1}],
            'cost': [{'type': 'amount_spent', 'value': 2.5}, {'type': 'cost_per_delivered', 'value': 0.3}], **extra,
        }]}]})

    def test_template_analytics_store_days_clicks_and_spend_for_opted_in_channels_only(self):
        template = self.make_template()
        day = TODAY - timedelta(days=2)
        fake = Meta(pricing_analytics=meta(pricing()), template_analytics=self.template_answer(template, day))
        self.sync(fake)
        self.assertFalse(fake.to('template_analytics'))
        self.channel.template_insights_enabled = True
        self.sync(fake)
        (row,) = self.env['webvue.inbox.template.day'].search([('template_id', '=', template.id)])
        self.assertEqual((row.day, row.sent, row.delivered, row.read, row.clicked, row.amount_spent), (day, 10, 8, 5, 3, 2.5))
        self.assertEqual(sorted((c.button_type, c.button_text, c.count) for c in row.click_ids), [('quick_reply', 'Yes', 2), ('url', 'Site', 1)])
        self.sync(fake)
        self.assertEqual(self.env['webvue.inbox.template.day'].search_count([('template_id', '=', template.id)]), 1)

    def test_template_ids_are_sent_ten_at_a_time(self):
        for _index in range(23):
            self.make_template()
        self.channel.template_insights_enabled = True
        fake = Meta(pricing_analytics=meta(pricing()), template_analytics=meta({'data': []}))
        self.sync(fake)
        sizes = [len(call[2]['params']['template_ids'].strip('[]').split(',')) for call in fake.to('template_analytics')]
        self.assertEqual(sorted(sizes), [3, 10, 10])

    def test_the_opt_in_route_is_irreversible_and_checks_the_feature(self):
        self.login(self.manager)
        path = f'/api/v1/inbox/channels/{self.channel.id}/template-insights'
        fake = Meta()
        with patch.object(requests, 'request', MagicMock(side_effect=fake)):
            response = self.api('POST', path, {})
            self.api('POST', path, {})
        self.assertTrue(response.json()['health']['template_insights_enabled'])
        (call,) = fake.calls
        self.assertEqual((call[0], call[2]['params']), ('POST', {'is_enabled_for_insights': 'true'}))
        self.assertTrue(call[1].endswith(f'/{BUSINESS_ACCOUNT_ID}'))
        self.assertError(self.api('POST', path, {'x': 1}), 422, 'invalid')

    def test_the_sync_route_is_rate_limited_per_channel(self):
        self.login(self.manager)
        path = f'/api/v1/inbox/channels/{self.channel.id}/analytics/sync'
        self.assertEqual(self.api('POST', path, {}).status_code, 200)
        self.assertError(self.api('POST', path, {}), 429, 'rate_limited')
        self.channel.analytics_attempted_at = fields.Datetime.now() - timedelta(minutes=11)
        self.assertEqual(self.api('POST', path, {}).status_code, 200)

    def test_a_channels_manager_only_role_requests_a_sync_the_cron_pulls_with_its_own_rights(self):
        template = self.make_template()
        self.channel.template_insights_enabled = True
        user = self._capability_user('inbox_channels_only', 'inbox.channels.manage')
        yesterday = TODAY - timedelta(days=1)
        fake = Meta(
            pricing_analytics=meta(pricing(point(yesterday, volume=3, cost=1.5))),
            template_analytics=self.template_answer(template, yesterday),
        )
        self.login(user)
        path = f'/api/v1/inbox/channels/{self.channel.id}/analytics/sync'
        with patch.object(requests, 'request', MagicMock(side_effect=fake)):
            response = self.api('POST', path, {})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(fake.calls, [])  # the request only records itself
            self.assertTrue(self.channel.analytics_sync_requested)
            self.assertFalse(self.costs())
            self.env['webvue.inbox.channel']._webvue_run_analytics_requested()
        self.assertEqual((self.costs().volume, self.costs().cost), (3, 1.5))
        self.assertEqual(self.env['webvue.inbox.template.day'].search([('template_id', '=', template.id)]).sent, 10)
        self.assertFalse(self.channel.analytics_sync_requested)
        self.assertTrue(self.channel.analytics_synced_at)

    def test_the_cron_syncs_connected_channels(self):
        with patch.object(requests, 'request', MagicMock(side_effect=Meta(pricing_analytics=meta(pricing())))):
            self.env['webvue.inbox.channel']._webvue_run_analytics()
        self.assertTrue(self.channel.analytics_synced_at)

    def test_the_adapter_reads_template_points(self):
        self.assertEqual(whatsapp._click({'type': 'weird', 'button_content': 'x' * 100, 'count': 1}).text, 'x' * 64)
        self.assertEqual(whatsapp._pricing_point({'start': unix(date(2026, 1, 1)), 'volume': -5}).volume, 0)
