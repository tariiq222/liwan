# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date, datetime, timedelta

from odoo import fields
from odoo.tests import tagged

from .report_common import ReportCase

DAY = date(2026, 10, 10)


@tagged('post_install', '-at_install', 'liwan')
class TestReportBuild(ReportCase):

    def build(self, date_from=DAY - timedelta(days=1), date_to=DAY + timedelta(days=2)):
        self.env['liwan.inbox.report.build']._liwan_rebuild(self.env.company, date_from, date_to)

    def rows(self, **domain):
        return self.env['liwan.inbox.report.day'].search([('company_id', '=', self.env.company.id)] + [(k, '=', v) for k, v in domain.items()])

    def message(self, conversation, direction, at, **values):
        return self.env['liwan.inbox.message'].create({
            'conversation_id': conversation.id, 'company_id': conversation.company_id.id, 'direction': direction, 'body': 'x',
            'date': at, 'delivery_state': 'received' if direction == 'in' else 'sent', **values,
        })

    def test_a_day_is_the_local_day_of_the_inbox_timezone(self):
        self.settings.hours_timezone = 'Asia/Riyadh'
        conversation = self.make_conversation()
        conversation.message_ids.date = datetime(2026, 10, 10, 23, 30)  # 02:30 on the 11th in Riyadh
        self.build()
        (row,) = self.rows()
        self.assertEqual((row.day, row.messages_in, row.channel_id), (date(2026, 10, 11), 1, self.channel))
        self.settings.hours_timezone = 'UTC'
        self.build()
        self.assertEqual(self.rows().day, DAY)

    def test_outbound_is_attributed_to_the_author_and_automation_to_nobody(self):
        conversation = self.make_conversation(department_id=self.department.id)
        at = datetime(2026, 10, 10, 9)
        self.message(conversation, 'out', at, author_id=self.agent.id)
        self.message(conversation, 'out', at, author_id=self.agent.id, kind='template', template_name='t')
        self.message(conversation, 'out', at, author_id=self.agent.id, kind='template', template_name='t', delivery_state='failed')
        self.message(conversation, 'out', at, author_id=self.agent2.id)
        self.message(conversation, 'out', at, automated=True)
        self.message(conversation, 'note', at, author_id=self.agent.id)
        self.build()
        by_agent = {row.agent_id: row for row in self.rows(day=DAY)}
        self.assertEqual(
            (by_agent[self.agent].messages_out, by_agent[self.agent].templates_sent, by_agent[self.agent].templates_failed,
             by_agent[self.agent].messages_failed, by_agent[self.agent2].messages_out),
            (3, 1, 1, 1, 1),
        )
        automated = by_agent[self.env['res.users']]
        self.assertEqual((automated.messages_automated, automated.department_id), (1, self.department))

    def test_cycle_facts_land_on_their_own_days_with_buckets_and_sums(self):
        conversation = self.make_conversation(department_id=self.department.id)
        opened = datetime(2026, 10, 10, 8)
        cycle = self.env['liwan.inbox.conversation.cycle'].create({
            'company_id': conversation.company_id.id, 'conversation_id': conversation.id, 'channel_id': self.channel.id,
            'department_id': self.department.id, 'opened_at': opened, 'first_response_at': opened + timedelta(minutes=10),
            'responder_id': self.agent.id, 'ended_at': opened + timedelta(days=1, hours=2), 'end_reason': 'resolved',
            'resolver_id': self.agent2.id, 'csat_score': 'bad', 'csat_at': opened + timedelta(days=1, hours=3),
        })
        self.build()
        first = self.rows(day=DAY, agent_id=self.agent.id)
        self.assertEqual((first.first_response_count, first.first_response_seconds_sum, first.frt_under_15m, first.frt_under_5m), (1, 600, 1, 0))
        self.assertEqual(self.rows(day=DAY, agent_id=False).conversations_opened, 1)
        resolved = self.rows(day=DAY + timedelta(days=1), agent_id=self.agent2.id)
        self.assertEqual(
            (resolved.conversations_resolved, resolved.resolution_count, resolved.resolution_seconds_sum, resolved.csat_bad),
            (1, 1, cycle.resolution_seconds, 1),
        )
        cycle.write({'end_reason': 'auto_closed'})
        self.build()
        self.assertEqual(self.rows(day=DAY + timedelta(days=1), agent_id=False).conversations_auto_closed, 1)

    def test_a_rebuild_replaces_the_rows_and_is_idempotent(self):
        conversation = self.make_conversation()
        conversation.message_ids.date = datetime(2026, 10, 10, 9)
        self.build()
        first = {row.id: row.messages_in for row in self.rows()}
        self.build()
        self.assertEqual(sorted(row.messages_in for row in self.rows()), sorted(first.values()))
        self.assertEqual(len(self.rows()), len(first))

    def test_a_late_failure_is_picked_up_by_the_nightly_window(self):
        conversation = self.make_conversation()
        today = self.env['liwan.inbox.report.build']._liwan_today(self.env.company)
        sent = self.message(conversation, 'out', fields.Datetime.now() - timedelta(days=3), author_id=self.agent.id)
        self.env['liwan.inbox.report.day']._liwan_run_nightly()
        self.assertEqual(sum(self.rows().mapped('messages_failed')), 0)
        sent.delivery_state = 'failed'
        self.env['liwan.inbox.report.day']._liwan_run_nightly()
        self.assertEqual(sum(self.rows(agent_id=self.agent.id).mapped('messages_failed')), 1)
        self.assertEqual(self.settings.reports_built_timezone, self.settings.hours_timezone)
        self.assertTrue(today)

    def test_a_changed_timezone_rebuilds_every_retained_day_at_night(self):
        conversation = self.make_conversation()
        self.env['liwan.inbox.report.day']._liwan_run_nightly()
        old = fields.Datetime.now() - timedelta(days=60)
        conversation.message_ids.date = old
        self.env['liwan.inbox.report.day']._liwan_run_nightly()  # a plain nightly run does not reach day 60
        self.assertFalse(self.rows(messages_in=1))
        self.settings.hours_timezone = 'UTC'
        self.env['liwan.inbox.report.day']._liwan_run_nightly()
        self.assertEqual(sum(self.rows().mapped('messages_in')), 1)

    def test_a_full_rebuild_leaves_days_older_than_the_retained_conversations_alone(self):
        self.settings.retention_months = 1
        today = self.env['liwan.inbox.report.build']._liwan_today(self.env.company)
        old_day = today - timedelta(days=90)
        old = self.env['liwan.inbox.report.day'].create({
            'company_id': self.env.company.id, 'day': old_day, 'channel_id': self.channel.id, 'messages_in': 7,
            'computed_at': fields.Datetime.now(),
        })
        nightly = self.env['liwan.inbox.report.day']._liwan_run_nightly
        nightly()  # first build: every backed day
        self.settings.hours_timezone = 'UTC'
        nightly()  # timezone change: every backed day again
        self.assertEqual((old.exists().messages_in, self.rows(day=old_day).messages_in), (7, 7))

    def test_retention_purges_old_rows_of_every_report_table(self):
        self.settings.report_retention_months = 12
        today = fields.Date.today()
        old, recent = today - timedelta(days=400), today - timedelta(days=30)
        Day = self.env['liwan.inbox.report.day']
        for day in (old, recent):
            Day.create({'company_id': self.env.company.id, 'day': day, 'channel_id': self.channel.id, 'computed_at': fields.Datetime.now()})
        cost = self.env['liwan.inbox.cost.day'].create({
            'owner_company_id': self.env.company.id, 'channel_id': self.channel.id, 'day': old, 'pricing_category': 'service',
            'pricing_type': 'regular', 'country': 'SA', 'synced_at': fields.Datetime.now(),
        })
        self.env['liwan.inbox.conversation']._liwan_run_maintenance()
        self.assertEqual(self.rows().mapped('day'), [recent])
        self.assertFalse(cost.exists())

    def test_the_retention_setting_is_bounded(self):
        for value in (11, 121):
            with self.assertRaises(Exception):  # noqa: B017 - any validation error
                self.settings.report_retention_months = value
        self.assertEqual(self.env['liwan.inbox.settings'].default_get(['report_retention_months'])['report_retention_months'], 36)
