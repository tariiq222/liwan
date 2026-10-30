# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import timedelta

from odoo import fields
from odoo.tests import tagged

from .common import LiwanCrmCase
from odoo.addons.liwan_api.tests.common import set_probe_feature

URL = '/api/v1/crm/dashboard'
AGENT_KEYS = {'due_now', 'new_today', 'won_this_month'}
MANAGER_KEYS = {
    'unassigned', 'needs_manager', 'due_follow_ups', 'won_this_month', 'conversion_by_source', 'agents',
}


@tagged('post_install', '-at_install', 'liwan')
class TestCrmDashboard(LiwanCrmCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.now = fields.Datetime.now()
        cls.won_stage = cls.env.ref('liwan_crm.stage_won')
        cls.web = cls.env['utm.source'].create({'name': 'Web'})
        cls.fair = cls.env['utm.source'].create({'name': 'Fair'})
        past = cls.now - timedelta(hours=1)
        cls.due_mine = cls.make_lead(cls.agent, contact_name='Due mine', source_id=cls.web.id, liwan_next_call_at=past)
        cls.later_mine = cls.make_lead(
            cls.agent, contact_name='Later mine', source_id=cls.web.id, liwan_next_call_at=cls.now + timedelta(days=2),
        )
        cls.due_mate = cls.make_lead(cls.agent2, contact_name='Due mate', source_id=cls.fair.id, liwan_next_call_at=past)
        cls.flagged = cls.make_lead(cls.agent2, contact_name='Flagged', source_id=cls.fair.id, liwan_needs_manager=True)
        cls.pool = cls.make_lead(None, contact_name='Pool', source_id=cls.web.id)
        cls.won_mine = cls.make_lead(cls.agent, contact_name='Won mine', source_id=cls.web.id, liwan_final_price=300.0)
        cls.won_mine.write({'stage_id': cls.won_stage.id})
        cls.won_mate = cls.make_lead(cls.agent2, contact_name='Won mate', source_id=cls.fair.id, liwan_final_price=200.0)
        cls.won_mate.write({'stage_id': cls.won_stage.id})
        cls.lost = cls.make_lead(cls.agent, contact_name='Lost', source_id=cls.web.id)
        cls.lost.action_set_lost()
        cls.old_won = cls.make_lead(cls.agent, contact_name='Old won', source_id=cls.web.id, liwan_final_price=999.0)
        cls.old_won.write({'stage_id': cls.won_stage.id})
        cls.age(cls.old_won)
        cls.foreign = cls.make_lead(None, company=cls.other_company, contact_name='Foreign')

    @classmethod
    def age(cls, lead):
        """Move a lead's creation and closing into a past month."""
        long_ago = cls.now - timedelta(days=70)
        cls.env.cr.execute('UPDATE crm_lead SET create_date = %s, date_closed = %s WHERE id = %s', (long_ago, long_ago, lead.id))
        lead.invalidate_recordset()

    def dashboard(self, user):
        response = self.as_user(user).api('GET', URL)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_agent_counts_only_own_and_has_no_manager_block(self):
        body = self.dashboard(self.agent)
        self.assertEqual(set(body), {'agent', 'manager'})
        self.assertIsNone(body['manager'])
        self.assertEqual(set(body['agent']), AGENT_KEYS)
        self.assertEqual(body['agent']['due_now'], 1)
        self.assertEqual(body['agent']['new_today'], 3)
        self.assertEqual(body['agent']['won_this_month'], {'count': 1, 'value': 300.0})

    def test_other_agent_sees_other_numbers(self):
        agent = self.dashboard(self.agent2)['agent']
        self.assertEqual((agent['due_now'], agent['new_today']), (1, 3))
        self.assertEqual(agent['won_this_month'], {'count': 1, 'value': 200.0})

    def test_manager_block_numbers(self):
        manager = self.dashboard(self.manager)['manager']
        self.assertEqual(set(manager), MANAGER_KEYS)
        self.assertEqual(manager['unassigned'], 1)
        self.assertEqual(manager['needs_manager'], 1)
        self.assertEqual(manager['due_follow_ups'], 2)
        self.assertEqual(manager['won_this_month'], {'count': 2, 'value': 500.0})

    def test_manager_own_block_counts_the_manager_not_the_team(self):
        body = self.dashboard(self.manager)
        self.assertEqual(body['agent'], {'due_now': 0, 'new_today': 0, 'won_this_month': {'count': 0, 'value': 0.0}})

    def test_conversion_by_source_counts_this_month_created_and_won_among_them(self):
        by_source = {row['name']: row for row in self.dashboard(self.manager)['manager']['conversion_by_source']}
        self.assertEqual(by_source['Web'], {'source_id': self.web.id, 'name': 'Web', 'total': 5, 'won': 1})
        self.assertEqual(by_source['Fair'], {'source_id': self.fair.id, 'name': 'Fair', 'total': 3, 'won': 1})

    def test_agents_table(self):
        rows = {row['user_id']: row for row in self.dashboard(self.manager)['manager']['agents']}
        self.assertEqual(rows[self.agent.id], {
            'user_id': self.agent.id, 'name': 'CRM Agent', 'open': 2, 'won': 1, 'due': 1,
        })
        self.assertEqual(rows[self.agent2.id], {
            'user_id': self.agent2.id, 'name': 'CRM Agent Two', 'open': 2, 'won': 1, 'due': 1,
        })

    def test_eligible_agent_without_work_is_listed_with_zeros(self):
        rows = {row['user_id']: row for row in self.dashboard(self.manager)['manager']['agents']}
        self.assertEqual(rows[self.manager.id]['open'], 0)

    def test_other_company_is_not_counted(self):
        manager = self.dashboard(self.manager)['manager']
        self.assertEqual(manager['unassigned'], 1)
        self.assertNotIn('Foreign', str(manager))

    def test_team_visibility_does_not_widen_the_agent_block(self):
        self.set_visibility('all')
        self.assertEqual(self.dashboard(self.agent)['agent']['due_now'], 1)

    def test_outsider_is_forbidden(self):
        self.assertEqual(self.as_user(self.outsider).api('GET', URL).status_code, 403)

    def test_closed_crm_feature_refuses(self):
        set_probe_feature(self, key='crm.enabled', enabled=False)
        self.assertEqual(self.as_agent().api('GET', URL).status_code, 403)

    def test_day_and_month_start_follow_the_company_timezone(self):
        """Midnight in UTC+14 is 10:00 UTC the evening before."""
        self.company.resource_calendar_id.tz = 'Pacific/Kiritimati'
        today, month = self.env['liwan.crm.dashboard']._liwan_day_starts(self.company, self.agent)
        self.assertEqual((today.hour, today.minute, month.hour, month.minute, month.day <= 31), (10, 0, 10, 0, True))
        self.assertLessEqual(today, fields.Datetime.now())
        self.assertGreater(today + timedelta(days=1), fields.Datetime.now())
        self.assertLessEqual(month, today)

    def test_user_timezone_is_used_without_a_company_calendar_timezone(self):
        self.company.resource_calendar_id.tz = False
        self.agent.tz = 'Pacific/Kiritimati'
        today, _month = self.env['liwan.crm.dashboard']._liwan_day_starts(self.company, self.agent)
        self.assertEqual((today.hour, today.minute), (10, 0))
