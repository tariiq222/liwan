# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import datetime, timedelta
from unittest.mock import patch

from odoo import Command
from odoo.tests import tagged

from .common import LiwanCrmCase
from odoo.addons.liwan_crm.models.crm_settings import TERM_MEMO
from odoo.addons.liwan_crm.serializers.settings import dump_terms

NOW = datetime(2026, 10, 28, 9, 0, 0)
DAY = timedelta(days=1)
NOTIFICATIONS = '/api/v1/notifications'
TYPES = 'odoo.addons.liwan_crm.models.notification_types'
FOLLOWUP_LOGGER = 'odoo.addons.liwan_crm.models.followup'


@tagged('post_install', '-at_install', 'liwan')
class TestCrmCron(LiwanCrmCase):
    """Spec "Follow-up engine" steps 4-5: recycle, due follow-ups and the two bell kinds."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.Followup = cls.env['liwan.crm.followup']
        cls.stage_new = cls.env.ref('liwan_crm.stage_new')

    def lost_for_recycle(self, user=None, due=NOW, **vals):
        lead = self.make_lead(user or self.agent, liwan_attempt_count=3, liwan_recycle_at=due, **vals)
        lead.action_set_lost(lost_reason_id=self.env.ref('liwan_crm.lost_reason_attempts_exhausted').id)
        return lead

    def kinds(self, user):
        response = self.as_user(user).api('GET', NOTIFICATIONS)
        self.assertEqual(response.status_code, 200, response.text)
        # The platform's own access-change row is not a CRM bell.
        return sorted(item['kind'] for item in response.json()['items'] if item['kind'] != 'access_changed')

    def make_viewer(self, user):
        """Keep ``user`` as a reader of opportunities who can no longer work them."""
        role = self.env['liwan.access.role'].create({
            'key': 'crm_viewer', 'name_ar': 'مشاهد', 'type': 'custom',
            'permission_ids': [(6, 0, [self.env.ref('liwan_crm.permission_crm_leads_read').id])],
        })
        self.env['liwan.access.service']._liwan_replace_assignments(user, [{
            'role_id': role.id, 'company_id': self.company.id,
        }])

    def revoke(self, user):
        self.env['liwan.access.service']._liwan_replace_assignments(user, [])

    # Cron record

    def test_the_cron_runs_every_fifteen_minutes_as_root(self):
        cron = self.env.ref('liwan_crm.ir_cron_followup')
        self.assertEqual((cron.interval_number, cron.interval_type), (15, 'minutes'))
        self.assertEqual(cron.model_id.model, 'liwan.crm.followup')
        self.assertEqual(cron.user_id, self.env.ref('base.user_root'))
        self.assertIn('_liwan_cron_tick', cron.code)
        self.assertTrue(cron.active)

    # Recycle

    def test_a_due_recycle_reopens_the_same_record_for_the_same_agent(self):
        lead = self.lost_for_recycle()
        lead_id = lead.id
        self.Followup._liwan_cron_tick(now=NOW + timedelta(seconds=1))
        self.assertEqual(lead.id, lead_id)
        self.assertTrue(lead.active)
        self.assertEqual(lead.stage_id, self.stage_new)
        self.assertEqual(lead.liwan_cycle, 1)
        self.assertEqual(lead.liwan_attempt_count, 0)
        self.assertEqual(lead.user_id, self.agent)
        self.assertFalse(lead.lost_reason_id)
        self.assertFalse(lead.liwan_recycle_at)
        self.assertFalse(lead.liwan_next_call_at)
        self.assertEqual(lead.won_status, 'pending')
        self.assertFalse(self.assignment_mails(lead), 'stock assignment mail is not sent')
        self.assertEqual(len(self.bell_rows(self.agent, lead, 'crm.assigned')), 1)

    def test_a_recycle_not_yet_due_stays_closed(self):
        lead = self.lost_for_recycle(due=NOW + DAY)
        self.Followup._liwan_cron_tick(now=NOW)
        self.assertFalse(lead.active)
        self.assertEqual(lead.liwan_recycle_at, NOW + DAY)

    def test_the_last_cycle_ends_in_a_final_loss(self):
        lead = self.lost_for_recycle()
        self.Followup._liwan_cron_tick(now=NOW)
        for step in range(3):
            self.Followup._liwan_record_call(
                lead, self.env.ref('liwan_crm.outcome_no_answer'), now=NOW + step * DAY,
            )
        self.assertFalse(lead.active)
        self.assertEqual(lead.liwan_cycle, 1)
        self.assertFalse(lead.liwan_recycle_at)
        self.Followup._liwan_cron_tick(now=NOW + 400 * DAY)
        self.assertFalse(lead.active)

    def test_a_recycle_goes_to_the_distribution_when_the_agent_is_no_longer_eligible(self):
        lead = self.lost_for_recycle()
        self.revoke(self.agent)
        self.Followup._liwan_cron_tick(now=NOW)
        eligible = self.env['liwan.crm.distribution']._liwan_eligible_agents(self.company)
        self.assertTrue(lead.active)
        self.assertIn(lead.user_id, eligible)
        self.assertNotEqual(lead.user_id, self.agent)

    def test_a_recycle_joins_the_pool_when_distribution_is_manual(self):
        self.set_settings(distribution_mode='manual')
        lead = self.lost_for_recycle()
        self.revoke(self.agent)
        self.Followup._liwan_cron_tick(now=NOW)
        self.assertTrue(lead.active)
        self.assertFalse(lead.user_id)

    def test_the_tick_works_per_company_and_ignores_the_environment_company(self):
        self.set_settings(self.other_company, distribution_mode='manual')
        mine = self.lost_for_recycle()
        theirs = self.make_lead(company=self.other_company, liwan_recycle_at=NOW)
        theirs.action_set_lost()
        orphan = self.env['crm.lead'].create({'name': 'No company', 'type': 'opportunity', 'company_id': False, 'liwan_recycle_at': NOW})
        orphan.action_set_lost()
        self.Followup.with_company(self.other_company)._liwan_cron_tick(now=NOW)
        self.assertTrue(mine.active)
        self.assertTrue(theirs.active)
        self.assertEqual(theirs.liwan_cycle, 1)
        self.assertFalse(orphan.active, 'a record without a company is left alone')

    # Due follow-ups

    def due_lead(self, **vals):
        return self.make_lead(self.agent, liwan_attempt_count=1, liwan_next_call_at=NOW, **vals)

    def test_a_due_follow_up_rings_the_agents_bell_once(self):
        lead = self.due_lead()
        self.Followup._liwan_cron_tick(now=NOW - timedelta(minutes=1))
        self.assertFalse(self.bell_rows(self.agent, lead, 'crm.followup_due'))
        self.Followup._liwan_cron_tick(now=NOW)
        self.Followup._liwan_cron_tick(now=NOW + timedelta(minutes=15))
        self.assertEqual(len(self.bell_rows(self.agent, lead, 'crm.followup_due')), 1)
        self.assertEqual(self.kinds(self.agent), ['crm.followup_due'])
        self.assertEqual(self.kinds(self.agent2), [])

    def test_a_rescheduled_follow_up_rings_again(self):
        lead = self.due_lead()
        self.Followup._liwan_cron_tick(now=NOW)
        lead.liwan_next_call_at = NOW + DAY
        self.Followup._liwan_cron_tick(now=NOW + DAY)
        self.assertEqual(len(self.bell_rows(self.agent, lead, 'crm.followup_due')), 2)

    def test_a_closed_or_unassigned_follow_up_rings_nobody(self):
        won = self.due_lead()
        won.action_set_lost()
        pool = self.make_lead(liwan_next_call_at=NOW)
        self.Followup._liwan_cron_tick(now=NOW)
        self.assertFalse(self.bell_rows(self.agent, won, 'crm.followup_due'))
        self.assertFalse(self.env['mail.message'].search([('res_id', '=', pool.id), ('liwan_notification', '=', True)]))

    def test_a_due_follow_up_of_an_agent_who_lost_work_is_redistributed(self):
        lead = self.due_lead()
        self.make_viewer(self.agent)
        self.Followup._liwan_cron_tick(now=NOW)
        self.assertNotEqual(lead.user_id, self.agent)
        self.assertTrue(lead.user_id)
        self.assertEqual(lead.liwan_next_call_at, NOW)
        self.assertEqual(self.as_user(self.agent).api('GET', f'/api/v1/crm/opportunities/{lead.id}').status_code, 404)
        self.assertFalse(self.assignment_mails(lead))
        self.assertEqual(len(self.bell_rows(lead.user_id, lead, 'crm.followup_due')), 1)

    def test_a_not_due_follow_up_keeps_its_agent_even_without_work(self):
        lead = self.make_lead(self.agent, liwan_next_call_at=NOW + DAY)
        self.revoke(self.agent)
        self.Followup._liwan_cron_tick(now=NOW)
        self.assertEqual(lead.user_id, self.agent)

    # Bell visibility

    def test_a_bell_row_follows_the_opportunity_when_it_changes_hands(self):
        lead = self.due_lead()
        self.Followup._liwan_cron_tick(now=NOW)
        self.assertEqual(self.kinds(self.agent), ['crm.followup_due'])
        lead.write({'user_id': self.agent2.id})
        self.assertEqual(self.kinds(self.agent), [])

    def test_a_bell_row_carries_the_company_term_of_its_opportunity(self):
        self.set_settings(term_opportunity_singular_ar='حالة', term_opportunity_plural_ar='حالات', term_opportunity_gender='m')
        lead = self.due_lead()
        self.Followup._liwan_cron_tick(now=NOW)
        item = self.as_user(self.agent).api('GET', NOTIFICATIONS).json()['items'][0]
        self.assertEqual(item['term']['ar'], {'singular': 'حالة', 'plural': 'حالات'})
        self.assertEqual((item['term']['en'], item['term']['gender']), ({'singular': 'opportunity', 'plural': 'opportunities'}, 'm'))
        self.assertEqual(item['opportunity_id'], lead.id)

    def test_the_company_term_is_read_once_for_many_bell_rows(self):
        (self.due_lead() | self.due_lead())._liwan_notify_assigned()
        self.Followup._liwan_cron_tick(now=NOW)
        self.env.cr.cache.pop(TERM_MEMO, None)
        with patch(f'{TYPES}.dump_terms', side_effect=dump_terms) as dumped:
            items = self.as_user(self.agent).api('GET', NOTIFICATIONS).json()['items']
        self.assertGreaterEqual(len(items), 2)
        self.assertEqual(dumped.call_count, 1)

    def test_a_batch_bell_carries_the_first_name_and_the_count_not_prose(self):
        first, second = self.make_lead(self.agent, contact_name='Mona'), self.make_lead(self.agent, contact_name='Huda')
        (first | second)._liwan_notify_assigned()
        item = self.as_user(self.agent).api('GET', NOTIFICATIONS).json()['items'][0]
        self.assertEqual((item['kind'], item['title'], item['count']), ('crm.assigned', 'Mona', 2))

    def test_a_manager_decision_bell_is_its_own_kind_and_follows_read_access(self):
        lead = self.make_lead(self.agent, contact_name='Mona')
        lead._liwan_notify_managers()
        self.assertEqual(self.kinds(self.manager), ['crm.needs_manager'])
        item = self.as_user(self.manager).api('GET', NOTIFICATIONS).json()['items'][0]
        self.assertEqual((item['opportunity_id'], item['title'], item['count']), (lead.id, 'Mona', 1))
        self.env['liwan.access.service']._liwan_replace_assignments(self.manager, [{
            'role_id': self.env.ref('liwan_core.role_employee').id, 'company_id': self.company.id,
        }])
        self.assertEqual(self.kinds(self.manager), [])

    def test_a_recipient_who_lost_read_sees_nothing(self):
        lead = self.due_lead()
        self.Followup._liwan_cron_tick(now=NOW)
        self.assertEqual(self.kinds(self.agent), ['crm.followup_due'])
        self.env['liwan.access.service']._liwan_replace_assignments(self.agent, [{
            'role_id': self.env.ref('liwan_core.role_employee').id, 'company_id': self.company.id,
        }])
        self.assertEqual(self.kinds(self.agent), [])
        self.assertTrue(self.bell_rows(self.agent, lead, 'crm.followup_due'), 'the row exists, it is just hidden')

    def test_bell_rows_carry_the_opportunity(self):
        lead = self.due_lead(contact_name='Mona')
        self.Followup._liwan_cron_tick(now=NOW)
        item = self.as_user(self.agent).api('GET', NOTIFICATIONS).json()['items'][0]
        self.assertEqual(item['opportunity_id'], lead.id)
        self.assertEqual(item['title'], 'Mona')
        self.assertEqual(item['count'], 1)
        self.assertFalse(item['is_read'])

    def test_a_recipient_sees_the_bells_of_every_company_where_they_read(self):
        user = self._user('crm_bell', 'CRM Bell', 'liwan_crm.role_crm_agent')
        agent_role = self.env.ref('liwan_crm.role_crm_agent')
        user.write({'company_ids': [Command.link(self.other_company.id)]})
        other_assignment = self.env['liwan.access.assignment'].create({
            'user_id': user.id, 'role_id': agent_role.id, 'company_id': self.other_company.id,
        })
        mine = self.make_lead(user)
        theirs = self.make_lead(user, company=self.other_company)
        (mine | theirs)._liwan_notify_assigned()
        self.assertEqual(self.kinds(user), ['crm.assigned', 'crm.assigned'])
        self.set_settings(company=self.other_company, term_opportunity_singular_ar='ملف')
        items = self.as_user(user).api('GET', NOTIFICATIONS).json()['items']
        self.assertEqual({item['opportunity_id']: item['term']['ar']['singular'] for item in items}, {mine.id: 'فرصة', theirs.id: 'ملف'})
        other_assignment._liwan_access_unlink()
        self.assertEqual(self.kinds(user), ['crm.assigned'], 'no read in the other company: its bell is gone')
        self.env['liwan.access.service']._liwan_replace_assignments(user, [])
        self.assertEqual(self.kinds(user), [])

    # Isolation

    def test_a_failing_lead_does_not_stop_the_other_recycles(self):
        self.set_settings(self.other_company, distribution_mode='manual')
        bad = self.lost_for_recycle()
        sibling = self.lost_for_recycle(self.agent2)
        theirs = self.make_lead(company=self.other_company, liwan_recycle_at=NOW)
        theirs.action_set_lost()
        original = type(bad)._liwan_restart

        def flaky(lead, cycles=0):
            if lead == bad:
                msg = 'boom'
                raise ValueError(msg)
            return original(lead, cycles)

        with patch.object(type(bad), '_liwan_restart', flaky), self.assertLogs(FOLLOWUP_LOGGER, 'ERROR') as logs:
            self.Followup._liwan_cron_tick(now=NOW)
        self.assertFalse(bad.active)
        self.assertEqual(bad.liwan_cycle, 0)
        self.assertTrue(sibling.active)
        self.assertTrue(theirs.active)
        self.assertIn('boom', '\n'.join(logs.output))

    def test_a_failing_company_does_not_stop_the_other_companies(self):
        self.set_settings(self.other_company, distribution_mode='manual')
        mine = self.lost_for_recycle()
        theirs = self.make_lead(company=self.other_company, liwan_recycle_at=NOW)
        theirs.action_set_lost()
        original = type(self.Followup)._liwan_reopen_due_recycles

        def flaky(followup, company, now):
            if company == self.company:
                msg = 'boom'
                raise ValueError(msg)
            return original(followup, company, now)

        with patch.object(type(self.Followup), '_liwan_reopen_due_recycles', flaky), \
                self.assertLogs(FOLLOWUP_LOGGER, 'ERROR'):
            self.Followup._liwan_cron_tick(now=NOW)
        self.assertFalse(mine.active)
        self.assertTrue(theirs.active)

    def test_a_failing_bell_does_not_stop_the_others(self):
        first = self.due_lead()
        second = self.make_lead(self.agent2, liwan_attempt_count=1, liwan_next_call_at=NOW)
        original = type(self.Followup)._liwan_ring

        def flaky(followup, lead):
            if lead == first:
                msg = 'boom'
                raise ValueError(msg)
            return original(followup, lead)

        with patch.object(type(self.Followup), '_liwan_ring', flaky), self.assertLogs(FOLLOWUP_LOGGER, 'ERROR'):
            self.Followup._liwan_cron_tick(now=NOW)
        self.assertFalse(self.bell_rows(self.agent, first, 'crm.followup_due'))
        self.assertEqual(len(self.bell_rows(self.agent2, second, 'crm.followup_due')), 1)
