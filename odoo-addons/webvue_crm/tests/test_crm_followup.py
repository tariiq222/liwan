# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import datetime, timedelta

from odoo.exceptions import AccessError
from odoo.tests import tagged

from .common import WebVueCrmCase
from odoo.addons.webvue_api.controllers.common import ApiError

NOW = datetime(2026, 10, 28, 9, 0, 0)
DAY = timedelta(days=1)


@tagged('post_install', '-at_install', 'webvue')
class TestCrmFollowup(WebVueCrmCase):
    """Spec "Follow-up engine" steps 2-3: what a recorded call does to its opportunity."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.Followup = cls.env['webvue.crm.followup']
        cls.exhausted_reason = cls.env.ref('webvue_crm.lost_reason_attempts_exhausted')

    def record(self, lead, outcome='no_answer', now=NOW, **kwargs):
        return self.Followup._webvue_record_call(lead, self.env.ref(f'webvue_crm.outcome_{outcome}'), now=now, **kwargs)

    def exhaust(self, lead, start=NOW):
        for step in range(3):
            self.record(lead, now=start + step * DAY)
        return start + 2 * DAY

    # Logging

    def test_a_call_is_logged_with_its_outcome_note_and_duration(self):
        lead = self.make_lead(self.agent)
        call = self.record(lead, note='Asked for a callback', duration=2.5)
        self.assertEqual(call.opportunity_id, lead)
        self.assertEqual(call.webvue_outcome_id, self.env.ref('webvue_crm.outcome_no_answer'))
        self.assertEqual(call.name, 'No answer')
        self.assertEqual(call.description, 'Asked for a callback')
        self.assertEqual(call.duration, 2.5)
        self.assertEqual(call.date, NOW)
        self.assertEqual(call.state, 'done')
        self.assertEqual(call.company_id, self.company)
        self.assertEqual(call.user_id, self.env.user)

    def test_followup_off_logs_the_call_and_changes_nothing_else(self):
        self.set_settings(followup_attempts=0)
        lead = self.make_lead(self.agent)
        for step in range(4):
            self.record(lead, now=NOW + step * DAY)
        self.assertEqual(self.env['crm.phonecall'].search_count([('opportunity_id', '=', lead.id)]), 4)
        self.assertEqual(lead.webvue_attempt_count, 0)
        self.assertFalse(lead.webvue_next_call_at)
        self.assertFalse(lead.webvue_recycle_at)
        self.assertFalse(lead.webvue_needs_manager)
        self.assertTrue(lead.active)
        self.assertEqual(lead.user_id, self.agent)

    def test_a_none_outcome_changes_nothing(self):
        outcome = self.env['webvue.crm.call.outcome'].create({'name': 'Information given', 'effect': 'none'})
        lead = self.make_lead(self.agent)
        self.Followup._webvue_record_call(lead, outcome, now=NOW)
        self.assertEqual((lead.webvue_attempt_count, lead.webvue_next_call_at, lead.active), (0, False, True))

    # Scheduling

    def test_a_follow_up_outcome_schedules_the_next_call_for_the_same_agent(self):
        lead = self.make_lead(self.agent)
        self.record(lead)
        self.assertEqual(lead.webvue_attempt_count, 1)
        self.assertEqual(lead.webvue_next_call_at, NOW + DAY)
        self.record(lead, now=NOW + DAY)
        self.assertEqual(lead.webvue_attempt_count, 2)
        self.assertEqual(lead.webvue_next_call_at, NOW + 2 * DAY)
        self.assertEqual(lead.user_id, self.agent)
        self.assertTrue(lead.active)

    def test_the_interval_comes_from_the_company_settings(self):
        self.set_settings(followup_interval_hours=5)
        lead = self.make_lead(self.agent)
        self.record(lead)
        self.assertEqual(lead.webvue_next_call_at, NOW + timedelta(hours=5))

    def test_a_settings_change_does_not_move_a_scheduled_call(self):
        lead = self.make_lead(self.agent)
        self.record(lead)
        self.set_settings(followup_interval_hours=72, followup_attempts=5, recycle_after_days=90)
        self.Followup._webvue_cron_tick(now=NOW + timedelta(hours=1))
        self.assertEqual(lead.webvue_next_call_at, NOW + DAY)
        self.assertEqual(lead.webvue_attempt_count, 1)

    def test_a_settings_change_does_not_move_a_scheduled_recycle(self):
        lead = self.make_lead(self.agent)
        last = self.exhaust(lead)
        self.set_settings(recycle_after_days=90)
        self.Followup._webvue_cron_tick(now=last + timedelta(days=1))
        self.assertEqual(lead.webvue_recycle_at, last + timedelta(days=30))

    # Exhaustion

    def test_exhausting_the_attempts_closes_the_lost_and_schedules_a_recycle(self):
        lead = self.make_lead(self.agent)
        last = self.exhaust(lead)
        self.assertFalse(lead.active)
        self.assertEqual(lead.won_status, 'lost')
        self.assertEqual(lead.lost_reason_id, self.exhausted_reason)
        self.assertEqual(lead.webvue_attempt_count, 3)
        self.assertEqual(lead.webvue_recycle_at, last + timedelta(days=30))
        self.assertFalse(lead.webvue_next_call_at)
        self.assertFalse(lead.webvue_needs_manager)

    def test_no_recycle_when_recycling_is_off(self):
        self.set_settings(recycle_enabled=False)
        lead = self.make_lead(self.agent)
        self.exhaust(lead)
        self.assertFalse(lead.active)
        self.assertFalse(lead.webvue_recycle_at)

    def test_no_recycle_when_no_cycle_is_left(self):
        self.set_settings(recycle_cycles=0)
        lead = self.make_lead(self.agent)
        self.exhaust(lead)
        self.assertFalse(lead.active)
        self.assertFalse(lead.webvue_recycle_at)

    def test_manager_mode_flags_the_opportunity_and_tells_the_managers(self):
        self.set_settings(after_attempts='manager')
        lead = self.make_lead(self.agent)
        self.exhaust(lead)
        self.assertTrue(lead.active)
        self.assertEqual(lead.user_id, self.agent)
        self.assertTrue(lead.webvue_needs_manager)
        self.assertFalse(lead.webvue_recycle_at)
        self.assertFalse(lead.webvue_next_call_at)
        self.assertEqual(len(self.bell_rows(self.manager, lead, 'crm.assigned')), 1)
        self.assertFalse(self.bell_rows(self.agent, lead, 'crm.followup_due'))
        self.assertFalse(self.bell_rows(self.agent2, lead, 'crm.assigned'))

    def test_manager_mode_never_recycles(self):
        self.set_settings(after_attempts='manager')
        lead = self.make_lead(self.agent)
        last = self.exhaust(lead)
        self.Followup._webvue_cron_tick(now=last + timedelta(days=400))
        self.assertTrue(lead.active)
        self.assertTrue(lead.webvue_needs_manager)
        self.assertEqual(lead.webvue_cycle, 0)

    # Won and lost outcomes

    def test_a_won_outcome_without_a_sale_is_refused(self):
        lead = self.make_lead(self.agent)
        with self.assertRaises(ApiError) as caught:
            self.record(lead, 'sold')
        self.assertEqual(caught.exception.status, 422)

    def test_a_won_outcome_with_a_sale_wins_the_opportunity(self):
        package = self.make_package(900)
        lead = self.make_lead(self.agent, webvue_next_call_at=NOW)
        self.record(lead, 'sold', sale={'package': package, 'final_price': 900, 'discount_percent': 0, 'user': self.agent})
        self.assertEqual(lead.won_status, 'won')
        self.assertEqual(lead.webvue_package_id, package.product_variant_id.product_tmpl_id)
        self.assertFalse(lead.webvue_next_call_at)
        self.assertEqual(self.env['crm.phonecall'].search_count([('opportunity_id', '=', lead.id)]), 1)

    def test_a_lost_outcome_closes_with_its_reason(self):
        reason = self.env['crm.lost.reason'].create({'name': 'Too expensive'})
        outcome = self.env['webvue.crm.call.outcome'].create({'name': 'Price', 'effect': 'lost', 'lost_reason_id': reason.id})
        lead = self.make_lead(self.agent, webvue_next_call_at=NOW)
        self.Followup._webvue_record_call(lead, outcome, now=NOW)
        self.assertEqual(lead.won_status, 'lost')
        self.assertEqual(lead.lost_reason_id, reason)
        self.assertFalse(lead.webvue_next_call_at)
        self.assertFalse(lead.webvue_recycle_at)

    # Visibility of the call log

    def test_a_call_is_visible_where_its_opportunity_is(self):
        lead = self.make_lead(self.agent)
        self.record(lead)
        Call = self.env['crm.phonecall']
        domain = [('opportunity_id', '=', lead.id)]
        self.assertEqual(len(Call.with_user(self.agent).search(domain)), 1)
        self.assertEqual(len(Call.with_user(self.manager).search(domain)), 1)
        self.assertFalse(Call.with_user(self.agent2).search(domain))
        self.assertFalse(Call.with_user(self.outsider).search(domain))

    def test_a_call_cannot_be_logged_on_a_hidden_opportunity(self):
        lead = self.make_lead(self.agent)
        with self.assertRaises(AccessError):
            self.env['crm.phonecall'].with_user(self.agent2).create({
                'name': 'Probe', 'opportunity_id': lead.id, 'company_id': self.company.id,
            })
