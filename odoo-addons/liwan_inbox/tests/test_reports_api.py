# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date, timedelta

from odoo import fields
from odoo.tests import tagged

from .common import LiwanInboxCase
from odoo.addons.liwan_api.tests.common import set_probe_feature

BASE = '/api/v1/inbox/reports'
METRICS_KEYS = {
    'conversations_opened', 'conversations_resolved', 'conversations_auto_closed', 'messages_in', 'messages_out',
    'messages_automated', 'messages_failed', 'templates_sent', 'templates_failed', 'automated_share', 'first_response',
    'resolution', 'csat',
}


@tagged('post_install', '-at_install', 'liwan')
class TestReportsApi(LiwanInboxCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.reports_only = cls._capability_user('inbox_reports_reader', 'inbox.reports.read')
        cls.today = cls.env['liwan.inbox.report.build']._liwan_today(cls.env.company)
        cls.branch = cls.env['res.company'].create({'name': 'Report branch company'})
        cls.branch_channel = cls.make_channel(phone_id='720000000001', owner_company_id=cls.branch.id)

    def row(self, days_ago, agent=None, department=None, channel=None, **counters):
        return self.env['liwan.inbox.report.day'].create({
            'company_id': self.env.company.id, 'day': self.today - timedelta(days=days_ago), 'channel_id': (channel or self.channel).id,
            'agent_id': agent.id if agent else False, 'department_id': department.id if department else False,
            'computed_at': fields.Datetime.now(), **counters,
        })

    def query(self, path, user=None, **params):
        self.login(user or self.supervisor)
        params = {'from': str(self.today - timedelta(days=6)), 'to': str(self.today), **params}
        return self.get(f'{BASE}/{path}?' + '&'.join(f'{k}={v}' for k, v in params.items()))

    def test_the_overview_totals_are_the_sum_of_the_rows_with_the_previous_period(self):
        self.row(0, messages_in=10, messages_out=4, messages_automated=1, conversations_opened=5, conversations_resolved=3,
                 first_response_count=2, first_response_seconds_sum=600, frt_under_15m=2, csat_good=1, csat_bad=1)
        self.row(2, agent=self.agent, messages_out=2, conversations_resolved=1, resolution_count=1, resolution_seconds_sum=300)
        self.row(8, messages_in=7)  # the previous period of a 7 day range
        body = self.query('overview').json()
        totals = body['totals']
        self.assertEqual(set(totals), METRICS_KEYS)
        self.assertEqual(
            (totals['messages_in'], totals['messages_out'], totals['conversations_resolved'], totals['automated_share']),
            (10, 6, 4, 1 / 7),
        )
        self.assertEqual((totals['first_response']['average_seconds'], totals['first_response']['buckets']['under_15m']), (300, 2))
        self.assertEqual((totals['resolution']['average_seconds'], totals['csat']['score']), (300, 0.5))
        self.assertEqual(body['previous']['messages_in'], 7)
        self.assertEqual((body['granularity'], len(body['series']), body['timezone']), ('day', 7, self.settings.hours_timezone))
        self.assertEqual(sum(point['messages_in'] for point in body['series']), 10)
        self.assertIsNotNone(body['computed_at'])

    def test_an_empty_range_has_null_averages(self):
        body = self.query('overview').json()
        self.assertEqual((body['totals']['first_response']['average_seconds'], body['totals']['csat']['score'], body['computed_at']), (None, None, None))

    def test_the_granularity_switches_at_62_and_190_days(self):
        for days, granularity in ((62, 'day'), (63, 'week'), (190, 'week'), (191, 'month')):
            body = self.query('overview', **{'from': str(self.today - timedelta(days=days - 1))}).json()
            self.assertEqual(body['granularity'], granularity, days)
        weekly = self.query('overview', **{'from': str(self.today - timedelta(days=99))}).json()['series']
        self.assertTrue(all(date.fromisoformat(point['start']).weekday() == 0 for point in weekly))

    def test_range_limits(self):
        first = str(self.today - timedelta(days=366))
        self.assertEqual(self.query('overview', **{'from': first}).status_code, 422)  # 367 days
        self.assertEqual(self.query('overview', **{'from': str(self.today - timedelta(days=365))}).status_code, 200)  # 366 days
        for bad in ({'from': str(self.today), 'to': str(self.today - timedelta(days=1))}, {'from': 'x'}, {'to': '2026-1-1'}):
            self.assertError(self.query('overview', **bad), 422, 'invalid')
        self.settings.report_retention_months = 12
        self.assertError(self.query('overview', **{'from': str(self.today - timedelta(days=400)), 'to': str(self.today - timedelta(days=380))}), 422, 'invalid')
        self.assertError(self.query('overview', bogus=1), 422, 'invalid')

    def test_filters_must_belong_to_the_company(self):
        self.row(0, agent=self.agent, department=self.department, messages_out=3)
        self.row(0, agent=self.agent2, messages_out=5)
        filtered = self.query('overview', agent_id=self.agent.id, department_id=self.department.id, channel_id=self.channel.id).json()
        self.assertEqual(filtered['totals']['messages_out'], 3)
        department = self.env['liwan.inbox.department'].create({'name': 'Other co', 'company_id': self.branch.id})
        for param, value in (('channel_id', self.branch_channel.id), ('department_id', department.id), ('agent_id', 99999999)):
            self.assertError(self.query('overview', **{param: value}), 404, 'not_found')

    def test_breakdowns_by_each_dimension_include_the_unattributed_row(self):
        self.row(0, agent=self.agent, department=self.department, conversations_resolved=5, messages_out=2)
        self.row(0, agent=self.agent2, conversations_resolved=1)
        self.row(1, messages_in=9)
        by_agent = self.query('breakdown', by='agent').json()
        self.assertEqual(
            [(item['subject'] and item['subject']['id'], item['metrics']['conversations_resolved']) for item in by_agent['items']],
            [(self.agent.id, 5), (self.agent2.id, 1), (None, 0)],
        )
        self.assertEqual(by_agent['total'], 3)
        by_department = self.query('breakdown', by='department').json()['items']
        self.assertEqual({(i['subject'] or {}).get('id'): i['metrics']['conversations_resolved'] for i in by_department}, {self.department.id: 5, None: 1})
        by_channel = self.query('breakdown', by='channel').json()['items']
        self.assertEqual([i['subject']['id'] for i in by_channel], [self.channel.id])
        self.assertError(self.query('breakdown', by='agent', agent_id=self.agent.id), 422, 'invalid')
        self.assertError(self.query('breakdown', by='tag'), 422, 'invalid')
        self.assertEqual(self.query('breakdown', by='channel', channel_id=self.channel.id).json()['total'], 1)

    def test_the_export_is_a_csv_with_a_bom_and_neutralised_formulas(self):
        self.agent.name = '=cmd'
        self.row(0, agent=self.agent, conversations_resolved=2)
        response = self.query('export', by='agent')
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.headers['Content-Type'].startswith('text/csv'))
        text = response.text
        self.assertTrue(text.startswith('﻿subject,'))
        self.assertIn("'=cmd,", text)

    def test_a_reports_only_custom_role_works_alone_and_others_are_refused(self):
        self.row(0, messages_in=2)
        self.assertEqual(self.query('overview', user=self.reports_only).status_code, 200)
        self.assertEqual(self.query('breakdown', user=self.reports_only, by='channel').status_code, 200)
        self.assertEqual(self.query('export', user=self.reports_only, by='channel').status_code, 200)
        self.assertEqual(self.query('costs', user=self.reports_only).status_code, 200)
        for user in (self.agent, self.templates_only, self.reader_only, self.outsider):
            for path, extra in (('overview', {}), ('breakdown', {'by': 'agent'}), ('export', {'by': 'agent'}), ('costs', {}), ('templates', {'channel_id': self.channel.id})):
                self.assertError(self.query(path, user=user, **extra), 403, 'forbidden')
        for user in (self.supervisor, self.manager):
            self.assertEqual(self.query('overview', user=user).status_code, 200)

    def test_the_reports_sub_feature_gates_every_route(self):
        set_probe_feature(self, key='inbox.reports', enabled=False)
        for path, extra in (('overview', {}), ('breakdown', {'by': 'agent'}), ('costs', {})):
            response = self.query(path, user=self.manager, **extra)
            self.assertEqual((response.status_code, response.json()['code']), (403, 'feature_not_included'))
