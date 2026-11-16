# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The opportunity of one ticket: linking it, replacing it and clearing it."""
from odoo.addons.liwan_helpdesk.tests.common import LiwanHelpdeskCase


class TicketOpportunityTest(LiwanHelpdeskCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        # The bridge needs the desk's write capability and CRM's read capability on the same user.
        cls.env['liwan.access.service']._liwan_replace_assignments(cls.agent, [{
            'role_id': cls.env.ref('liwan_helpdesk.role_helpdesk_agent').id,
            'company_id': cls.company.id,
        }, {
            'role_id': cls.env.ref('liwan_crm.role_crm_agent').id,
            'company_id': cls.company.id,
        }])
        cls.customer = cls.env['res.partner'].create({
            'name': 'Acme customer', 'liwan_party': True, 'email': 'acme@example.test',
        })
        cls.lead = cls.env['crm.lead'].create({
            'name': 'Acme deal', 'type': 'opportunity', 'company_id': cls.company.id, 'user_id': cls.agent.id,
        })

    def link(self, ticket_id, opportunity_id):
        return self.api('POST', f'/api/v1/helpdesk/tickets/{ticket_id}/opportunity',
                        json={'opportunity_id': opportunity_id})

    def test_an_agent_links_replaces_and_clears_the_opportunity(self):
        self.as_user(self.agent)
        ticket = self.ticket_body(customer_id=self.customer.id)
        linked = self.link(ticket['id'], self.lead.id)
        self.assertEqual(linked.status_code, 200, linked.text)
        self.assertEqual(linked.json()['opportunity']['id'], self.lead.id)
        self.assertEqual(self.env['helpdesk.ticket'].browse(ticket['id']).liwan_lead_id, self.lead)
        other = self.env['crm.lead'].create({
            'name': 'Second deal', 'type': 'opportunity', 'company_id': self.company.id, 'user_id': self.agent.id,
        })
        replaced = self.link(ticket['id'], other.id)
        self.assertEqual(replaced.json()['opportunity']['id'], other.id)
        cleared = self.link(ticket['id'], None)
        self.assertEqual(cleared.status_code, 200, cleared.text)
        self.assertIsNone(cleared.json()['opportunity'])
        self.assertFalse(self.env['helpdesk.ticket'].browse(ticket['id']).liwan_lead_id)

    def test_a_hidden_opportunity_and_a_foreign_ticket_are_not_found(self):
        self.as_user(self.agent)
        ticket = self.ticket_body(customer_id=self.customer.id)
        self.assertEqual(self.link(ticket['id'], 999999999).status_code, 404)
        other = self.env['crm.lead'].create({'name': 'Other tenant deal', 'type': 'opportunity',
                                             'company_id': self.other_company.id})
        self.assertEqual(self.link(ticket['id'], other.id).status_code, 404)
        foreign = self.env['helpdesk.ticket'].create({
            'name': 'Other tenant', 'description': '<p>Other</p>', 'company_id': self.other_company.id,
            'team_id': self.other_team.id, 'stage_id': self.other_team._get_applicable_stages()[:1].id,
        })
        self.assertEqual(self.link(foreign.id, self.lead.id).status_code, 404)

    def test_the_body_and_the_capabilities_are_checked(self):
        self.as_user(self.agent)
        ticket = self.ticket_body(customer_id=self.customer.id)
        extra = self.api('POST', f'/api/v1/helpdesk/tickets/{ticket["id"]}/opportunity',
                         json={'opportunity_id': self.lead.id, 'stage': 'won'})
        self.assertEqual((extra.status_code, extra.json()['code']), (422, 'invalid'))
        wrong = self.api('POST', f'/api/v1/helpdesk/tickets/{ticket["id"]}/opportunity',
                         json={'opportunity_id': 'the-deal'})
        self.assertEqual((wrong.status_code, wrong.json()['field']), (422, 'opportunity_id'))
        # A requester of their own ticket may not link an opportunity.
        self.as_user(self.requester)
        own = self.ticket_body(subject='Mine', description='Only mine.')
        self.assertEqual(self.link(own['id'], self.lead.id).status_code, 403)
