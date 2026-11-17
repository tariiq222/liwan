# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The follow-up tasks of one ticket, and the personal-task rule that keeps them private."""
from odoo.tests import tagged

from odoo.addons.liwan_helpdesk.tests.common import LiwanHelpdeskCase


# After install: liwan_tasks_pmo lets the link field through PMO's create whitelist and loads after this bridge.
@tagged('post_install', '-at_install', 'liwan')
class TicketTasksTest(LiwanHelpdeskCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        # The bridge route needs both applications' capabilities: an agent who also holds the employee role,
        # which carries the personal tasks. That is how a tenant grants it, so the fixture states it too.
        cls.env['liwan.access.service']._liwan_replace_assignments(cls.agent, [{
            'role_id': cls.env.ref('liwan_helpdesk.role_helpdesk_agent').id,
            'company_id': cls.company.id,
        }, {
            'role_id': cls.env.ref('liwan_core.role_employee').id,
            'company_id': cls.company.id,
        }])

    def task(self, ticket_id, **values):
        payload = {'name': 'Call the vendor', 'date_deadline': '2026-12-01', **values}
        return self.api('POST', f'/api/v1/helpdesk/tickets/{ticket_id}/tasks', json=payload)

    def test_an_agent_creates_a_follow_up_task_on_the_ticket(self):
        self.as_user(self.agent)
        ticket = self.ticket_body()
        created = self.task(ticket['id'])
        self.assertEqual(created.status_code, 200, created.text)
        body = created.json()
        self.assertEqual(body['name'], 'Call the vendor')
        listing = self.api('GET', f'/api/v1/helpdesk/tickets/{ticket["id"]}/tasks').json()
        self.assertEqual(listing['total'], 1)
        self.assertEqual(listing['items'][0]['id'], body['id'])
        task = self.env['project.task'].browse(body['id'])
        self.assertEqual(task.liwan_helpdesk_ticket_id.id, ticket['id'])
        # The task's assignee defaults to the ticket's agent, who is the caller here.
        self.assertIn(self.agent, task.user_ids)

    def test_a_closed_ticket_and_a_foreign_ticket_take_no_task(self):
        self.as_user(self.agent)
        ticket = self.ticket_body()
        closed = self.env['helpdesk.ticket'].browse(ticket['id'])
        closed.write({'stage_id': self.team._get_applicable_stages().filtered(lambda stage: stage.closed)[:1].id})
        refused = self.task(ticket['id'])
        self.assertEqual((refused.status_code, refused.json().get('field')), (422, 'ticket_id'))
        foreign = self.env['helpdesk.ticket'].create({
            'name': 'Other tenant', 'description': '<p>Other</p>', 'company_id': self.other_company.id,
            'team_id': self.other_team.id, 'stage_id': self.other_team._get_applicable_stages()[:1].id,
        })
        self.assertEqual(self.task(foreign.id).status_code, 404)

    def test_the_body_is_validated_and_the_due_date_is_required(self):
        self.as_user(self.agent)
        ticket = self.ticket_body()
        missing = self.api('POST', f'/api/v1/helpdesk/tickets/{ticket["id"]}/tasks', json={'name': 'x'})
        self.assertEqual(missing.status_code, 422, missing.text)
        self.assertEqual(missing.json().get('field'), 'date_deadline')
        extra = self.task(ticket['id'], parent_id=1)
        self.assertEqual((extra.status_code, extra.json()['code']), (422, 'invalid'))

    def test_the_feature_and_the_capability_gate_the_routes(self):
        self.as_user(self.requester)
        own = self.ticket_body(subject='Mine', description='Only mine.')
        # A requester reads their own ticket; a follow-up task is the agent's job.
        self.assertEqual(self.task(own['id']).status_code, 403)
