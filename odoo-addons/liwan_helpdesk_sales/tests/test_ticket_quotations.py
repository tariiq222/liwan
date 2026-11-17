# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""A quotation opened from a ticket: the routes, the ticket reference and the customer it bills."""
from odoo.addons.liwan_sales.tests.common import SalesWriteCase


class TicketQuotationTest(SalesWriteCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        # The bridge needs the desk's write right and the sales quotation right on the same person.
        company = cls.env.company
        cls.env['liwan.access.service']._liwan_replace_assignments(cls.agent, [{
            'role_id': cls.env.ref('liwan_sales.role_sales_agent').id, 'company_id': company.id,
        }, {
            'role_id': cls.env.ref('liwan_helpdesk.role_helpdesk_agent').id, 'company_id': company.id,
        }])
        cls.helpdesk_team = cls.env['helpdesk.ticket.team'].search([('company_id', '=', company.id)], limit=1)
        # The desk's team visibility reaches a ticket through team membership, so both sellers join the team.
        cls.helpdesk_team.write({'user_ids': [(6, 0, [cls.agent.id, cls.agent2.id])]})

    def ticket(self, partner=None):
        return self.env['helpdesk.ticket'].create({
            'name': 'Printer is down', 'description': '<p>d</p>', 'company_id': self.env.company.id,
            'team_id': self.helpdesk_team.id,
            'stage_id': self.helpdesk_team._get_applicable_stages()[:1].id,
            'partner_id': (partner or self.customer).id,
        })

    def quotations(self, ticket_id):
        response = self.api('GET', f'/api/v1/helpdesk/tickets/{ticket_id}/quotations')
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_a_quotation_is_opened_on_the_tickets_customer(self):
        self.as_user(self.agent)
        ticket = self.ticket()
        created = self.api('POST', f'/api/v1/helpdesk/tickets/{ticket.id}/quotations', json={
            'lines': [{'kind': 'product', 'product_id': self.plain.id, 'quantity': 2}],
        })
        self.assertEqual(created.status_code, 200, created.text)
        order = self.env['sale.order'].browse(created.json()['id'])
        self.assertEqual(order.helpdesk_ticket_id, ticket)
        self.assertEqual(order.partner_id, self.customer)
        listing = self.quotations(ticket.id)
        self.assertEqual(listing['total'], 1)
        self.assertEqual(listing['items'][0]['name'], order.name)

    def test_a_ticket_without_a_customer_and_a_closed_one_take_no_quotation(self):
        self.as_user(self.agent)
        bare = self.ticket()
        bare.write({'partner_id': False})
        refused = self.api('POST', f'/api/v1/helpdesk/tickets/{bare.id}/quotations', json={
            'lines': [{'kind': 'product', 'product_id': self.plain.id, 'quantity': 1}],
        })
        self.assertEqual((refused.status_code, refused.json()['field']), (422, 'customer_id'))
        closed = self.ticket()
        closed.write({'stage_id': self.helpdesk_team._get_applicable_stages().filtered(
            lambda stage: stage.closed)[:1].id})
        self.assertEqual(self.api('POST', f'/api/v1/helpdesk/tickets/{closed.id}/quotations', json={
            'lines': [{'kind': 'product', 'product_id': self.plain.id, 'quantity': 1}],
        }).status_code, 422)

    def test_the_body_is_validated_and_a_foreign_ticket_is_not_found(self):
        self.as_user(self.agent)
        ticket = self.ticket()
        self.assertEqual(self.api('POST', f'/api/v1/helpdesk/tickets/{ticket.id}/quotations', json={
            'lines': [{'kind': 'product', 'product_id': self.plain.id, 'quantity': 1}], 'price_unit': 1,
        }).status_code, 422)
        self.assertEqual(self.api('GET', '/api/v1/helpdesk/tickets/999999999/quotations').status_code, 404)
        # The quotations of a ticket belong to the ticket: a seller who holds sales.read but cannot read the desk's
        # tickets sees no ticket here, and the answer is the same 404 as a missing one.
        outsider = self.custom_user('helpdesk_sales_outsider', ['sales.read', 'sales.quotations.manage'])
        self.as_user(outsider)
        self.assertEqual(self.api('GET', f'/api/v1/helpdesk/tickets/{ticket.id}/quotations').status_code, 404)
