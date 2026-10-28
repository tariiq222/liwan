# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import datetime

from odoo.tests import tagged

from .common import WebVueCrmCase
from odoo.addons.webvue_api.tests.common import set_probe_feature

URL = '/api/v1/crm/opportunities'
NOW = datetime(2026, 10, 28, 9, 0, 0)
CALL_KEYS = {'id', 'outcome', 'note', 'duration_minutes', 'user', 'created_at'}


@tagged('post_install', '-at_install', 'webvue')
class TestCrmSale(WebVueCrmCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.package = cls.make_package(1000)
        cls.reason = cls.env['crm.lost.reason'].create({'name': 'Too expensive'})

    def post(self, user, lead, action, **body):
        return self.as_user(user).api('POST', f'{URL}/{lead.id}/{action}', json=body)

    def won(self, user, lead, **body):
        return self.post(user, lead, 'won', **{'package_id': self.package.id, 'final_price': 1000, **body})

    # Won

    def test_won_moves_to_the_won_stage_with_prices_and_clears_the_follow_up(self):
        lead = self.make_lead(self.agent, webvue_next_call_at=NOW, webvue_needs_manager=True, webvue_attempt_count=2)
        response = self.won(self.agent, lead)
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body['status'], 'won')
        self.assertEqual(body['stage']['id'], self.env.ref('webvue_crm.stage_won').id)
        self.assertEqual(body['package'], {'id': self.package.id, 'name': 'Package'})
        self.assertEqual((body['list_price'], body['final_price'], body['expected_revenue']), (1000, 1000, 1000))
        self.assertEqual(body['discount_percent'], 0)
        self.assertIsNone(body['next_call_at'])
        self.assertFalse(body['needs_manager'])

    def test_won_validates_the_body(self):
        lead = self.make_lead(self.agent)
        other = self.env['product.template'].create({'name': 'Not a package', 'list_price': 5})
        bad = (
            {'package_id': None}, {'package_id': 'x'}, {'package_id': other.id}, {'package_id': 999999},
            {'final_price': -1}, {'final_price': 'x'}, {'final_price': None}, {'discount_percent': 101},
            {'discount_percent': -1}, {'discount_percent': 'x'}, {'extra': 1},
        )
        for patch in bad:
            self.assertEqual(self.won(self.agent, lead, **patch).status_code, 422, patch)
        self.assertEqual(self.post(self.agent, lead, 'won', final_price=1).status_code, 422)
        self.assertEqual(lead.won_status, 'pending')

    def test_a_discount_is_refused_when_discounts_are_off(self):
        lead = self.make_lead(self.agent)
        self.assertEqual(self.won(self.agent, lead, discount_percent=10, final_price=900).status_code, 422)
        self.assertEqual(self.won(self.agent, lead, final_price=900).status_code, 422, 'a lower price is a discount')
        self.assertEqual(lead.won_status, 'pending')

    def test_a_discount_above_the_maximum_needs_the_approval_capability(self):
        self.set_settings(discount_allowed=True, discount_max_percent=10)
        lead = self.make_lead(self.agent)
        refused = self.won(self.agent, lead, discount_percent=15, final_price=850)
        self.assertEqual(refused.status_code, 403, refused.text)
        self.assertEqual(refused.json()['code'], 'forbidden')
        hidden = self.won(self.agent, lead, final_price=850)
        self.assertEqual(hidden.status_code, 403, 'the price implies the discount')
        ok = self.won(self.agent, lead, discount_percent=10, final_price=900)
        self.assertEqual(ok.status_code, 200, ok.text)
        self.assertEqual(ok.json()['discount_percent'], 10)

    def test_a_declared_discount_must_match_the_prices(self):
        self.set_settings(discount_allowed=True, discount_max_percent=50)
        lead = self.make_lead(self.agent)
        for body in ({'discount_percent': 5, 'final_price': 900}, {'discount_percent': 10, 'final_price': 1000},
                     {'discount_percent': 1, 'final_price': 1200}):
            response = self.won(self.agent, lead, **body)
            self.assertEqual(response.status_code, 422, body)
            self.assertEqual(response.json()['field'], 'discount_percent')
        ok = self.won(self.agent, lead, final_price=900)
        self.assertEqual(ok.json()['discount_percent'], 10, 'the stored discount comes from the prices')

    def test_an_approver_may_exceed_the_maximum(self):
        self.set_settings(discount_allowed=True, discount_max_percent=10)
        lead = self.make_lead(self.manager)
        response = self.won(self.manager, lead, discount_percent=20, final_price=800)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['discount_percent'], 20)
        self.assertEqual(lead.expected_revenue, 800)

    def test_won_access_and_state(self):
        lead = self.make_lead(self.agent)
        self.assertEqual(self.won(self.agent2, lead).status_code, 404)
        self.assertEqual(self.won(self.outsider, lead).status_code, 403)
        self.assertEqual(self.won(self.agent, lead).status_code, 200)
        self.assertEqual(self.won(self.agent, lead).status_code, 409)

    # Lost

    def test_lost_closes_with_the_reason_and_clears_the_follow_up(self):
        lead = self.make_lead(self.agent, webvue_next_call_at=NOW)
        response = self.post(self.agent, lead, 'lost', lost_reason_id=self.reason.id)
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual((body['status'], body['active']), ('lost', False))
        self.assertEqual(body['lost_reason'], {'id': self.reason.id, 'name': 'Too expensive'})
        self.assertIsNone(body['next_call_at'])
        self.assertEqual(self.post(self.agent, lead, 'lost', lost_reason_id=self.reason.id).status_code, 409)

    def test_lost_validates_the_reason(self):
        lead = self.make_lead(self.agent)
        archived = self.env['crm.lost.reason'].create({'name': 'Old', 'active': False})
        for body in ({}, {'lost_reason_id': None}, {'lost_reason_id': 'x'}, {'lost_reason_id': 999999},
                     {'lost_reason_id': archived.id}):
            self.assertEqual(self.post(self.agent, lead, 'lost', **body).status_code, 422, body)
        self.assertEqual(self.post(self.agent2, lead, 'lost', lost_reason_id=self.reason.id).status_code, 404)

    # Reopen

    def test_reopen_restores_a_lost_opportunity_to_the_first_stage(self):
        lead = self.make_lead(self.agent, webvue_attempt_count=3, webvue_recycle_at=NOW)
        lead.action_set_lost(lost_reason_id=self.reason.id)
        response = self.post(self.manager, lead, 'reopen')
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual((body['status'], body['active'], body['attempt_count']), ('pending', True, 0))
        self.assertEqual(body['stage']['id'], self.env.ref('webvue_crm.stage_new').id)
        self.assertIsNone(body['lost_reason'])
        self.assertIsNone(body['recycle_at'])
        self.assertEqual(body['user']['id'], self.agent.id)
        self.assertFalse(self.assignment_mails(lead))
        self.assertEqual(len(self.bell_rows(self.agent, lead, 'crm.assigned')), 1)

    def test_reopen_belongs_to_the_assigners(self):
        lead = self.make_lead(self.agent)
        lead.action_set_lost(lost_reason_id=self.reason.id)
        self.assertEqual(self.post(self.agent, lead, 'reopen').status_code, 403)
        self.assertFalse(lead.active)
        self.assertEqual(self.post(self.manager, lead, 'reopen').status_code, 200)

    def test_reopen_of_a_pending_opportunity_conflicts(self):
        lead = self.make_lead(self.agent)
        self.assertEqual(self.post(self.manager, lead, 'reopen').status_code, 409)

    def test_reopen_of_a_flagged_opportunity_starts_a_new_cycle(self):
        lead = self.make_lead(self.agent, webvue_needs_manager=True, webvue_attempt_count=3)
        response = self.post(self.manager, lead, 'reopen')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertFalse(response.json()['needs_manager'])
        self.assertEqual(response.json()['attempt_count'], 0)

    def test_reopen_gives_a_lost_opportunity_of_a_departed_agent_to_the_distribution(self):
        lead = self.make_lead(self.agent)
        lead.action_set_lost(lost_reason_id=self.reason.id)
        self.env['webvue.access.service']._webvue_replace_assignments(self.agent, [])
        response = self.post(self.manager, lead, 'reopen')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertNotEqual(lead.user_id, self.agent)
        self.assertTrue(lead.user_id)

    def test_reopen_picks_the_first_open_stage_when_the_new_stage_is_archived(self):
        won = self.env.ref('webvue_crm.stage_won')
        won.sequence = 1
        self.env.ref('webvue_crm.stage_new').active = False
        lead = self.make_lead(self.agent, stage_id=self.env.ref('webvue_crm.stage_interested').id)
        lead.action_set_lost(lost_reason_id=self.reason.id)
        response = self.post(self.manager, lead, 'reopen')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['stage']['id'], self.env.ref('webvue_crm.stage_contacted').id)

    # Assign

    def test_assign_moves_the_opportunity_clears_the_follow_up_and_tells_the_agent(self):
        lead = self.make_lead(self.agent, webvue_next_call_at=NOW, webvue_needs_manager=True, webvue_attempt_count=3)
        response = self.post(self.manager, lead, 'assign', user_id=self.agent2.id)
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body['user']['id'], self.agent2.id)
        self.assertIsNone(body['next_call_at'])
        self.assertFalse(body['needs_manager'])
        self.assertEqual(body['attempt_count'], 0)
        self.assertEqual(len(self.bell_rows(self.agent2, lead, 'crm.assigned')), 1)
        self.assertFalse(self.assignment_mails(lead), 'stock assignment mail is not sent')

    def test_assign_validates_and_gates(self):
        lead = self.make_lead(self.agent)
        self.assertEqual(self.post(self.agent, lead, 'assign', user_id=self.agent2.id).status_code, 403)
        self.assertEqual(self.post(self.manager, lead, 'assign', user_id=self.outsider.id).status_code, 422)
        for body in ({}, {'user_id': None}, {'user_id': 'x'}):
            self.assertEqual(self.post(self.manager, lead, 'assign', **body).status_code, 422, body)
        self.assertEqual(self.post(self.manager, self.make_lead(company=self.other_company), 'assign',
                                   user_id=self.agent.id).status_code, 404)

    def test_assign_and_patch_of_a_closed_opportunity_conflict(self):
        won = self.make_lead(self.agent)
        self.assertEqual(self.won(self.agent, won).status_code, 200)
        lost = self.make_lead(self.agent)
        lost.action_set_lost(lost_reason_id=self.reason.id)
        for lead in (won, lost):
            assigned = self.post(self.manager, lead, 'assign', user_id=self.agent2.id)
            self.assertEqual(assigned.status_code, 409, assigned.text)
            self.assertEqual(assigned.json()['code'], 'conflict')
            patched = self.as_user(self.manager).api('PATCH', f'{URL}/{lead.id}', json={'contact_name': 'New'})
            self.assertEqual(patched.status_code, 409, patched.text)
            self.assertEqual(lead.user_id, self.agent)
            self.assertFalse(self.bell_rows(self.agent2, lead, 'crm.assigned'))

    # Calls

    def test_recording_a_call_returns_the_call_and_the_opportunity(self):
        lead = self.make_lead(self.agent)
        outcome = self.env.ref('webvue_crm.outcome_no_answer')
        response = self.post(self.agent, lead, 'calls', outcome_id=outcome.id, note='Busy', duration_minutes=1.5)
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(set(body), {'call', 'opportunity'})
        self.assertEqual(set(body['call']), CALL_KEYS)
        self.assertEqual(body['call']['outcome'], {'id': outcome.id, 'name': 'No answer'})
        self.assertEqual((body['call']['note'], body['call']['duration_minutes']), ('Busy', 1.5))
        self.assertEqual(body['call']['user']['id'], self.agent.id)
        self.assertEqual(body['opportunity']['attempt_count'], 1)
        self.assertIsNotNone(body['opportunity']['next_call_at'])

    def test_a_sold_outcome_needs_a_package(self):
        lead = self.make_lead(self.agent)
        sold = self.env.ref('webvue_crm.outcome_sold')
        self.assertEqual(self.post(self.agent, lead, 'calls', outcome_id=sold.id).status_code, 422)
        self.assertEqual(self.env['crm.phonecall'].search_count([('opportunity_id', '=', lead.id)]), 0)
        response = self.post(self.agent, lead, 'calls', outcome_id=sold.id, package_id=self.package.id, final_price=1000)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['opportunity']['status'], 'won')

    def test_a_lost_outcome_closes_the_opportunity(self):
        lead = self.make_lead(self.agent)
        outcome = self.env.ref('webvue_crm.outcome_not_interested')
        outcome.lost_reason_id = self.reason
        response = self.post(self.agent, lead, 'calls', outcome_id=outcome.id)
        self.assertEqual(response.json()['opportunity']['status'], 'lost')
        self.assertEqual(response.json()['opportunity']['lost_reason']['id'], self.reason.id)

    def lost_outcome_without_reason(self):
        return self.env['webvue.crm.call.outcome'].create({'name': 'Wrong number', 'effect': 'lost'})

    def test_a_lost_outcome_without_a_reason_takes_the_reason_with_the_call(self):
        lead = self.make_lead(self.agent)
        outcome = self.lost_outcome_without_reason()
        response = self.post(self.agent, lead, 'calls', outcome_id=outcome.id, note='Wrong person', lost_reason_id=self.reason.id)
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body['opportunity']['status'], 'lost')
        self.assertEqual(body['opportunity']['lost_reason'], {'id': self.reason.id, 'name': 'Too expensive'})
        self.assertEqual(body['call']['outcome']['id'], outcome.id)
        self.assertEqual(self.env['crm.phonecall'].search_count([('opportunity_id', '=', lead.id)]), 1)

    def test_a_lost_outcome_without_a_reason_refuses_a_call_without_one(self):
        lead = self.make_lead(self.agent)
        outcome = self.lost_outcome_without_reason()
        response = self.post(self.agent, lead, 'calls', outcome_id=outcome.id)
        self.assertEqual((response.status_code, response.json()['field']), (422, 'lost_reason_id'))
        self.assertEqual(self.env['crm.phonecall'].search_count([('opportunity_id', '=', lead.id)]), 0)
        self.assertEqual(lead.won_status, 'pending')

    def test_a_reason_sent_with_a_lost_outcome_that_has_its_own_overrides_it(self):
        lead = self.make_lead(self.agent)
        own = self.env['crm.lost.reason'].create({'name': 'Outcome own reason'})
        outcome = self.env['webvue.crm.call.outcome'].create({'name': 'Declined', 'effect': 'lost', 'lost_reason_id': own.id})
        response = self.post(self.agent, lead, 'calls', outcome_id=outcome.id, lost_reason_id=self.reason.id)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['opportunity']['lost_reason']['id'], self.reason.id)
        self.assertEqual(lead.lost_reason_id, self.reason)

    def test_the_reason_of_a_call_is_checked(self):
        lead = self.make_lead(self.agent)
        lost = self.lost_outcome_without_reason()
        archived = self.env['crm.lost.reason'].create({'name': 'Old', 'active': False})
        for body in ({'outcome_id': lost.id, 'lost_reason_id': 999999}, {'outcome_id': lost.id, 'lost_reason_id': archived.id},
                     {'outcome_id': lost.id, 'lost_reason_id': None}, {'outcome_id': lost.id, 'lost_reason_id': 'x'}):
            response = self.post(self.agent, lead, 'calls', **body)
            self.assertEqual((response.status_code, response.json()['field']), (422, 'lost_reason_id'), body)
        follow_up = self.env.ref('webvue_crm.outcome_no_answer')
        response = self.post(self.agent, lead, 'calls', outcome_id=follow_up.id, lost_reason_id=self.reason.id)
        self.assertEqual((response.status_code, response.json()['field']), (422, 'lost_reason_id'))
        self.assertEqual(self.env['crm.phonecall'].search_count([('opportunity_id', '=', lead.id)]), 0)
        self.assertEqual(lead.won_status, 'pending')

    def test_call_validation_and_state(self):
        lead = self.make_lead(self.agent)
        outcome = self.env.ref('webvue_crm.outcome_no_answer')
        archived = self.env['webvue.crm.call.outcome'].create({'name': 'Old', 'effect': 'none', 'active': False})
        for body in ({}, {'outcome_id': 'x'}, {'outcome_id': 999999}, {'outcome_id': archived.id},
                     {'outcome_id': outcome.id, 'note': 5}, {'outcome_id': outcome.id, 'duration_minutes': -1},
                     {'outcome_id': outcome.id, 'extra': 1}):
            self.assertEqual(self.post(self.agent, lead, 'calls', **body).status_code, 422, body)
        lead.action_set_lost()
        self.assertEqual(self.post(self.agent, lead, 'calls', outcome_id=outcome.id).status_code, 409)

    def test_calls_list_and_access(self):
        lead = self.make_lead(self.agent)
        outcome = self.env.ref('webvue_crm.outcome_no_answer')
        for _ in range(2):
            self.post(self.agent, lead, 'calls', outcome_id=outcome.id)
        response = self.as_user(self.agent).api('GET', f'{URL}/{lead.id}/calls')
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body['total'], 2)
        self.assertEqual([item['id'] for item in body['items']], sorted((c['id'] for c in body['items']), reverse=True))
        self.assertEqual(self.as_user(self.agent2).api('GET', f'{URL}/{lead.id}/calls').status_code, 404)
        self.assertEqual(self.post(self.agent2, lead, 'calls', outcome_id=outcome.id).status_code, 404)
        self.assertEqual(self.as_user(self.outsider).api('GET', f'{URL}/{lead.id}/calls').status_code, 403)

    def test_closed_feature_refuses_every_action(self):
        lead = self.make_lead(self.agent)
        set_probe_feature(self, key='crm.enabled', enabled=False)
        for method, action in (('GET', 'calls'), ('POST', 'calls'), ('POST', 'won'), ('POST', 'lost'),
                               ('POST', 'reopen'), ('POST', 'assign')):
            response = self.as_user(self.manager).api(method, f'{URL}/{lead.id}/{action}', json={} if method == 'POST' else None)
            self.assertEqual(response.status_code, 403, action)

    def test_an_agent_opens_a_lost_opportunity(self):
        lead = self.make_lead(self.agent)
        lead.action_set_lost()
        response = self.as_user(self.agent).api('GET', f'{URL}/{lead.id}')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['status'], 'lost')
