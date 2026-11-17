# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The service levels: the policy a tenant shapes, the deadlines it puts on a ticket, and its guard rails."""

from datetime import timedelta
from types import SimpleNamespace

from odoo import fields

from odoo.addons.liwan_helpdesk.serializers.ticket import sla as dump_sla
from .common import LiwanHelpdeskCase


class SlaApiTest(LiwanHelpdeskCase):

    def setUp(self):
        super().setUp()
        self.stages = self.env['helpdesk.ticket.stage'].search(
            [('team_ids', 'in', self.team.ids)], order='sequence')
        self.opening = self.stages[0]
        # The engine meets a service level once the ticket reaches the target stage: it must come after the opening one.
        self.target = self.stages.filtered(lambda stage: stage.sequence > self.opening.sequence)[:1]
        self.closed_stage = self.stages.filtered(lambda stage: stage.closed)[:1]
        self.team.use_sla = True

    def save(self, **payload):
        return self.api('POST', '/api/v1/helpdesk/sla', json=payload)

    def policies(self):
        response = self.api('GET', '/api/v1/helpdesk/sla')
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_a_manager_creates_a_policy_and_the_tickets_take_its_deadline(self):
        self.as_user(self.manager)
        created = self.save(name='First response in 4h', days=0, hours=4, stage_id=self.target.id,
                            team_ids=[self.team.id])
        self.assertEqual(created.status_code, 200, created.text)
        policy = created.json()
        self.assertEqual((policy['days'], policy['hours'], policy['stage_id']), (0, 4, self.target.id))
        self.assertEqual(policy['team_ids'], [self.team.id])
        self.as_user(self.agent)
        ticket = self.ticket_body()
        self.assertEqual(ticket['sla']['state'], 'on_track')
        self.assertTrue(ticket['sla']['deadline'])
        self.assertEqual(len(ticket['sla']['rows']), 1)
        # Reach the target stage and the service level is met.
        self.as_user(self.agent)
        moved = self.api('POST', f'/api/v1/helpdesk/tickets/{ticket["id"]}/stage',
                         json={'stage_id': self.target.id})
        self.assertEqual(moved.json()['sla']['state'], 'none')
        self.assertEqual(moved.json()['sla']['rows'][0]['state'], 'accomplished')

    def test_a_policy_is_archived_and_its_deadlines_go(self):
        self.as_user(self.manager)
        policy = self.save(name='Resolve in 2 days', days=2, hours=0, stage_id=self.closed_stage.id,
                           team_ids=[self.team.id]).json()
        self.as_user(self.agent)
        ticket = self.ticket_body()
        self.assertTrue(ticket['sla']['rows'])
        self.as_user(self.manager)
        archived = self.api('POST', f'/api/v1/helpdesk/sla/{policy["id"]}/active', json={'active': False})
        self.assertEqual(archived.status_code, 200, archived.text)
        self.assertFalse(archived.json()['active'])
        # The rows the policy gave the ticket stay as history; a ticket no longer shows a deadline from it.
        detail = self.api('GET', f'/api/v1/helpdesk/tickets/{ticket["id"]}').json()
        self.assertEqual(detail['sla']['rows'], [])
        self.assertEqual(detail['sla']['state'], 'none')

    def test_the_target_and_the_values_are_validated(self):
        self.as_user(self.manager)
        for payload, field in (
            ({'name': 'x', 'days': 0, 'hours': 0, 'stage_id': self.target.id}, 'hours'),
            ({'name': 'x', 'days': 0, 'hours': 24, 'stage_id': self.target.id}, 'hours'),
            ({'name': 'x', 'days': 400, 'hours': 1, 'stage_id': self.target.id}, 'days'),
            ({'name': 'x', 'days': 1, 'hours': 1}, 'stage_id'),
            ({'name': 'x', 'days': 1, 'hours': 1, 'stage_id': 999999999}, 'stage_id'),
            ({'name': '', 'days': 1, 'hours': 1, 'stage_id': self.target.id}, 'name'),
            ({'name': 'x', 'days': 1, 'hours': 1, 'stage_id': self.target.id, 'team_ids': [999999999]}, 'team_ids'),
            ({'name': 'x', 'days': 1, 'hours': 1, 'stage_id': self.target.id, 'category_ids': [999999999]}, 'category_ids'),
            ({'name': 'x', 'days': 1, 'hours': 1, 'stage_id': self.target.id, 'tag_ids': 'x'}, 'tag_ids'),
        ):
            response = self.save(**payload)
            self.assertEqual((response.status_code, response.json()['field']), (422, field), payload)

    def test_only_the_settings_readers_see_the_policies_and_the_managers_change_them(self):
        self.as_user(self.agent)
        self.assertEqual(self.api('GET', '/api/v1/helpdesk/sla').status_code, 403)
        self.assertEqual(self.save(name='x', days=1, hours=1, stage_id=self.target.id).status_code, 403)
        self.as_user(self.supervisor)
        self.assertEqual(self.api('GET', '/api/v1/helpdesk/sla').status_code, 200)
        self.assertEqual(self.save(name='x', days=1, hours=1, stage_id=self.target.id).status_code, 403)

    def test_another_company_policy_is_not_found(self):
        other = self.env['helpdesk.sla'].create({
            'name': 'Other tenant policy', 'company_id': self.other_company.id,
            'days': 1, 'hours': 0, 'stage_id': self.stages[1].id,
        })
        self.as_user(self.manager)
        response = self.save(id=other.id, name='Hijacked', days=1, hours=0, stage_id=self.target.id)
        self.assertEqual((response.status_code, response.json()['code']), (404, 'not_found'))
        self.assertNotIn(other.id, [policy['id'] for policy in self.policies()['items']])

    def test_a_ticket_shows_an_overdue_policy(self):
        self.as_user(self.manager)
        self.save(name='Fast', days=0, hours=1, stage_id=self.target.id, team_ids=[self.team.id])
        self.as_user(self.agent)
        ticket = self.ticket_body()
        rows = self.env['helpdesk.ticket.sla'].search([('ticket_id', '=', ticket['id'])])
        rows.write({'deadline': '2020-01-01 00:00:00'})
        detail = self.api('GET', f'/api/v1/helpdesk/tickets/{ticket["id"]}').json()
        self.assertEqual(detail['sla']['state'], 'overdue')
        listed = self.api('GET', '/api/v1/helpdesk/tickets?sla=overdue').json()
        self.assertEqual(listed['total'], 1)

    def test_a_policy_is_saved_over_rows_of_a_retired_policy(self):
        """The engine drops the rows of a retired policy while it refreshes; the manager's save must not need ticket deletion."""
        self.as_user(self.manager)
        first = self.save(name='Old target', days=0, hours=4, stage_id=self.target.id, team_ids=[self.team.id])
        self.assertEqual(first.status_code, 200, first.text)
        self.as_user(self.requester)
        ticket = self.env['helpdesk.ticket'].browse(self.ticket_body()['id'])
        self.assertTrue(ticket.ticket_sla_ids, 'the new ticket takes the policy\'s row')
        self.as_user(self.manager)
        retired = self.api('POST', f'/api/v1/helpdesk/sla/{first.json()["id"]}/active', json={'active': False})
        self.assertEqual(retired.status_code, 200, retired.text)
        second = self.save(name='New target', days=0, hours=6, stage_id=self.target.id, team_ids=[self.team.id])
        self.assertEqual(second.status_code, 200, second.text)
        self.assertEqual(ticket.ticket_sla_ids.sla_id.mapped('name'), ['New target'])

    def test_an_archived_policy_stays_listed_and_can_be_brought_back(self):
        self.as_user(self.manager)
        policy = self.save(name='Parked', days=0, hours=4, stage_id=self.target.id, team_ids=[self.team.id]).json()
        off = self.api('POST', f'/api/v1/helpdesk/sla/{policy["id"]}/active', json={'active': False})
        self.assertEqual((off.status_code, off.json()['active']), (200, False))
        listed = {row['id']: row['active'] for row in self.policies()['items']}
        self.assertEqual(listed[policy['id']], False)
        on = self.api('POST', f'/api/v1/helpdesk/sla/{policy["id"]}/active', json={'active': True})
        self.assertEqual((on.status_code, on.json()['active']), (200, True))

    def test_several_deadlines_keep_the_most_urgent_state(self):
        now = fields.Datetime.now()

        def row(state, hours):
            return SimpleNamespace(id=1, name='r', state=state, hours=hours, deadline=now + timedelta(hours=hours),
                                   sla_id=SimpleNamespace(active=True))

        class Rows(list):
            def filtered(self, func):
                return Rows(item for item in self if func(item))

        soon, later = row('in_progress', 1), row('in_progress', 48)
        for rows in ([soon, later], [later, soon]):
            result = dump_sla(SimpleNamespace(ticket_sla_ids=Rows(rows)), now)
            self.assertEqual(result['state'], 'due_soon')
            self.assertEqual(result['deadline'], dump_sla(SimpleNamespace(ticket_sla_ids=Rows([soon])), now)['deadline'])
        late = row('in_progress', -1)
        self.assertEqual(dump_sla(SimpleNamespace(ticket_sla_ids=Rows([late, later])), now)['state'], 'overdue')
        self.assertEqual(dump_sla(SimpleNamespace(ticket_sla_ids=Rows([later, late])), now)['state'], 'overdue')
