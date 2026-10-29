# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import timedelta

from odoo import fields
from odoo.tests import tagged

from .common import WebVueInboxCase

BASE = '/api/v1/inbox/reports'


@tagged('post_install', '-at_install', 'webvue')
class TestMetaReportsApi(WebVueInboxCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.today = fields.Date.today()

    def cost(self, days_ago, category='marketing', pricing_type='regular', country='SA', volume=1, cost=0.0, has_cost=True, channel=None):
        return self.env['webvue.inbox.cost.day'].create({
            'owner_company_id': self.env.company.id, 'channel_id': (channel or self.channel).id, 'day': self.today - timedelta(days=days_ago),
            'pricing_category': category, 'pricing_type': pricing_type, 'country': country, 'volume': volume, 'cost': cost,
            'has_cost': has_cost, 'synced_at': fields.Datetime.now(),
        })

    def query(self, path, **params):
        self.login(self.supervisor)
        params = {'from': str(self.today - timedelta(days=6)), 'to': str(self.today), **params}
        return self.get(f'{BASE}/{path}?' + '&'.join(f'{k}={v}' for k, v in params.items()))

    def test_the_cost_report_totals_categories_countries_and_days(self):
        self.channel.currency_code = 'SAR'
        self.cost(0, volume=3, cost=1.5)
        self.cost(0, country='AE', volume=2, cost=1.0)
        self.cost(1, category='service', pricing_type='free_customer_service', volume=4, has_cost=False)
        body = self.query('costs').json()
        self.assertEqual((body['currency'], body['totals']), ('SAR', {'volume': 9, 'paid_volume': 5, 'free_volume': 4, 'cost': 2.5}))
        self.assertEqual({(r['category'], r['type']): (r['volume'], r['cost']) for r in body['by_category']}, {
            ('marketing', 'regular'): (5, 2.5), ('service', 'free_customer_service'): (4, None),
        })
        self.assertEqual([(r['country'], r['volume']) for r in body['by_country']], [('SA', 7), ('AE', 2)])
        self.assertEqual(len(body['series']), 7)
        self.assertEqual(body['series'][-1], {'start': str(self.today), 'volume': 5, 'paid_volume': 5, 'cost': 2.5})
        self.assertIsNone(body['series'][0]['cost'])
        self.assertEqual([c['channel']['id'] for c in body['channels']], [self.channel.id])

    def test_a_cost_free_report_has_a_null_cost(self):
        self.cost(0, volume=2, has_cost=False)
        self.assertIsNone(self.query('costs').json()['totals']['cost'])

    def test_channels_in_different_currencies_are_refused(self):
        other = self.make_channel(phone_id='730000000001')
        self.channel.currency_code, other.currency_code = 'SAR', 'USD'
        self.assertError(self.query('costs'), 422, 'invalid')
        self.assertEqual(self.query('costs', channel_id=other.id).json()['currency'], 'USD')

    def test_template_rows_join_meta_figures_with_our_own_sends(self):
        template = self.make_template(category='marketing')
        silent = self.make_template()
        self.env['webvue.inbox.template.day'].create({
            'owner_company_id': self.env.company.id, 'template_id': template.id, 'day': self.today, 'sent': 10, 'delivered': 8,
            'read': 5, 'amount_spent': 2.5, 'has_amount': True, 'synced_at': fields.Datetime.now(),
            'click_ids': [(0, 0, {'owner_company_id': self.env.company.id, 'button_type': 'url', 'button_text': 'Site', 'count': 3})],
        })
        conversation = self.make_conversation()
        for state in ('sent', 'read', 'failed'):
            self.env['webvue.inbox.message'].create({
                'conversation_id': conversation.id, 'company_id': conversation.company_id.id, 'direction': 'out', 'body': 'x',
                'author_id': self.agent.id, 'kind': 'template', 'template_id': silent.id, 'delivery_state': state,
            })
        body = self.query('templates', channel_id=self.channel.id).json()
        rows = {r['template']['id']: r for r in body['items']}
        self.assertEqual(body['total'], 2)
        self.assertEqual(
            {key: rows[template.id][key] for key in ('sent', 'delivered', 'read', 'clicked', 'amount_spent', 'webvue_sent')},
            {'sent': 10, 'delivered': 8, 'read': 5, 'clicked': 3, 'amount_spent': 2.5, 'webvue_sent': 0},
        )
        self.assertEqual((rows[silent.id]['webvue_sent'], rows[silent.id]['webvue_failed'], rows[silent.id]['amount_spent']), (2, 1, None))
        detail = self.query('templates/%d' % template.id).json()
        self.assertEqual(detail['totals']['clicked'], 3)
        self.assertEqual(detail['buttons'], [{'type': 'url', 'text': 'Site', 'clicked': 3}])
        self.assertEqual(detail['series'], [{'start': str(self.today), 'sent': 10, 'delivered': 8, 'read': 5, 'clicked': 3}])
        self.assertEqual(self.query('templates/%d' % silent.id).json()['totals']['webvue_sent'], 2)

    def test_template_ranges_are_limited_to_90_days_and_need_a_channel(self):
        first = str(self.today - timedelta(days=90))
        self.assertError(self.query('templates', channel_id=self.channel.id, **{'from': first}), 422, 'invalid')
        self.assertEqual(self.query('templates', channel_id=self.channel.id, **{'from': str(self.today - timedelta(days=89))}).status_code, 200)
        self.assertError(self.query('templates'), 422, 'invalid')
        self.assertError(self.query('templates', channel_id=999999999), 404, 'not_found')
