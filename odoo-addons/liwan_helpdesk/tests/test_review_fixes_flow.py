# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Review fixes: the detail without a portal, the closing stage move, the customer reply's activity stamp."""
from datetime import timedelta

from odoo import fields

from .common import LiwanHelpdeskCase, set_feature
from odoo.addons.liwan_helpdesk.models.helpdesk_portal import TOKEN_FIELD


class ReviewFixesTest(LiwanHelpdeskCase):

    def setUp(self):
        super().setUp()
        self.customer = self.env['res.partner'].create({
            'name': 'Acme customer', 'liwan_party': True, 'email': 'acme@example.test',
        })

    def test_the_detail_opens_without_the_portal_and_carries_no_link(self):
        self.as_user(self.agent)
        ticket = self.ticket_body(customer_id=self.customer.id)
        set_feature(self, 'helpdesk.portal', False)
        response = self.api('GET', f'/api/v1/helpdesk/tickets/{ticket["id"]}')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertIsNone(response.json()['portal_link'])
        set_feature(self, 'helpdesk.portal', True)
        self.assertTrue(self.api('GET', f'/api/v1/helpdesk/tickets/{ticket["id"]}').json()['portal_link'])

    def test_moving_to_a_closed_stage_needs_the_close_capability(self):
        self.as_user(self.agent)
        ticket = self.ticket_body(customer_id=self.customer.id)
        closed_stage = self.env['helpdesk.ticket.stage'].search(
            [('team_ids', 'in', self.team.ids), ('closed', '=', True)], limit=1)
        denied = self.api('POST', f'/api/v1/helpdesk/tickets/{ticket["id"]}/stage', json={'stage_id': closed_stage.id})
        self.assertEqual((denied.status_code, denied.json()['code']), (403, 'forbidden'))
        self.assertFalse(self.env['helpdesk.ticket'].browse(ticket['id']).stage_id.closed)
        allowed = self.as_user(self.supervisor).api(
            'POST', f'/api/v1/helpdesk/tickets/{ticket["id"]}/stage', json={'stage_id': closed_stage.id})
        self.assertEqual(allowed.status_code, 200, allowed.text)
        self.assertTrue(allowed.json()['stage']['closed'])

    def test_the_customer_reply_refreshes_the_last_activity(self):
        self.as_user(self.agent)
        ticket = self.env['helpdesk.ticket'].browse(self.ticket_body(customer_id=self.customer.id)['id'])
        portal = self.env['liwan.helpdesk.portal']
        portal._liwan_issue_token(ticket)
        stale = fields.Datetime.now() - timedelta(days=30)
        ticket.write({'liwan_last_activity_at': stale})
        portal._liwan_reply(ticket.id, ticket[TOKEN_FIELD], 'Any update?')
        self.assertGreater(ticket.liwan_last_activity_at, stale + timedelta(days=29))

    def _closed_ticket(self):
        self.as_user(self.supervisor)
        ticket = self.ticket_body(customer_id=self.customer.id)
        closed = self.api('POST', f'/api/v1/helpdesk/tickets/{ticket["id"]}/close', json={})
        self.assertEqual(closed.status_code, 200, closed.text)
        open_stage = self.env['helpdesk.ticket.stage'].search(
            [('team_ids', 'in', self.team.ids), ('closed', '=', False)], limit=1)
        return self.env['helpdesk.ticket'].browse(ticket['id']), open_stage

    def test_a_stage_move_out_of_a_closed_stage_needs_the_reopen_capability(self):
        ticket, open_stage = self._closed_ticket()
        self.as_user(self.agent)
        denied = self.api('POST', f'/api/v1/helpdesk/tickets/{ticket.id}/stage', json={'stage_id': open_stage.id})
        self.assertEqual((denied.status_code, denied.json()['code']), (403, 'forbidden'))
        self.assertTrue(ticket.stage_id.closed)
        allowed = self.as_user(self.supervisor).api(
            'POST', f'/api/v1/helpdesk/tickets/{ticket.id}/stage', json={'stage_id': open_stage.id})
        self.assertEqual(allowed.status_code, 200, allowed.text)
        self.assertFalse(allowed.json()['stage']['closed'])

    def test_a_stage_move_out_of_a_closed_stage_respects_reopen_days(self):
        ticket, open_stage = self._closed_ticket()
        self.settings.write({'reopen_days': 1})
        ticket.write({'closed_date': fields.Datetime.now() - timedelta(days=5)})
        response = self.api('POST', f'/api/v1/helpdesk/tickets/{ticket.id}/stage', json={'stage_id': open_stage.id})
        self.assertEqual((response.status_code, response.json()['code']), (422, 'invalid'))
        self.assertTrue(ticket.stage_id.closed)
