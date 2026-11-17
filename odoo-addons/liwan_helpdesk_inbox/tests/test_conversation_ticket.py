# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""A ticket raised from a customer conversation: the route, the guard and the link it records."""
from odoo.tests import new_test_user

from odoo.addons.liwan_inbox.tests.common import LiwanInboxCase


class ConversationTicketTest(LiwanInboxCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        # The bridge needs the desk's write right on the same person who answers conversations.
        company = cls.env.company
        cls.env['liwan.access.service']._liwan_replace_assignments(cls.agent, [{
            'role_id': cls.env.ref('liwan_inbox.role_inbox_agent').id, 'company_id': company.id,
        }, {
            'role_id': cls.env.ref('liwan_helpdesk.role_helpdesk_agent').id, 'company_id': company.id,
        }])

    def raise_ticket(self, conversation_id, **payload):
        return self.api('POST', f'/api/v1/inbox/conversations/{conversation_id}/ticket', json=payload)

    def test_an_agent_raises_a_ticket_from_the_conversation(self):
        self.login(self.agent)
        conversation = self.make_conversation()
        self.env['liwan.inbox.message'].create({
            'conversation_id': conversation.id, 'company_id': conversation.company_id.id, 'direction': 'in',
            'body': 'The order arrived broken.', 'delivery_state': 'received',
        })
        created = self.raise_ticket(conversation.id, subject='Broken delivery')
        self.assertEqual(created.status_code, 200, created.text)
        body = created.json()
        self.assertEqual(body['subject'], 'Broken delivery')
        # The link this bridge adds is the ticket on the conversation; which partner the ticket carries is the desk's
        # own rule (a contact without a linked customer leaves the ticket on the agent's own partner).
        ticket = self.env['helpdesk.ticket'].browse(body['id'])
        # The description copies what the customer wrote when the agent gives none; this one was given.
        self.assertEqual(ticket.name, 'Broken delivery')
        self.assertEqual(conversation.helpdesk_ticket_id, ticket)
        # The link shows on the conversation's own record.
        self.assertEqual(body['ticket']['number'], ticket.number)
        # A second attempt is refused: one conversation raises one ticket.
        again = self.raise_ticket(conversation.id)
        self.assertEqual((again.status_code, again.json()['code']), (409, 'conflict'))

    def test_the_description_copies_what_the_customer_wrote_when_none_is_given(self):
        self.login(self.agent)
        conversation = self.make_conversation()
        self.env['liwan.inbox.message'].create([
            {'conversation_id': conversation.id, 'company_id': conversation.company_id.id, 'direction': 'in',
             'body': 'First line.', 'delivery_state': 'received'},
            {'conversation_id': conversation.id, 'company_id': conversation.company_id.id, 'direction': 'out',
             'body': 'Agent answer.', 'delivery_state': 'sent'},
        ])
        created = self.raise_ticket(conversation.id)
        self.assertEqual(created.status_code, 200, created.text)
        description = self.env['helpdesk.ticket'].browse(created.json()['id']).description
        self.assertIn('First line.', description)
        self.assertNotIn('Agent answer.', description)

    def test_a_hidden_conversation_and_a_foreign_body_are_refused(self):
        self.login(self.agent)
        self.assertEqual(self.raise_ticket(999999999).status_code, 404)
        conversation = self.make_conversation()
        extra = self.api('POST', f'/api/v1/inbox/conversations/{conversation.id}/ticket',
                         json={'subject': 'x', 'assignee_id': 1})
        self.assertEqual((extra.status_code, extra.json()['code']), (422, 'invalid'))

    def test_a_user_without_the_desk_capability_cannot_raise_a_ticket(self):
        self.login(self.agent)
        conversation = self.make_conversation()
        outsider = new_test_user(
            self.env, login='inbox_only', name='Inbox only', groups='liwan_core.group_employee',
        )
        self.env['liwan.access.service']._liwan_replace_assignments(outsider, [{
            'role_id': self.env.ref('liwan_inbox.role_inbox_agent').id,
            'company_id': self.env.company.id,
        }])
        self.login(outsider)
        refused = self.raise_ticket(conversation.id)
        self.assertEqual((refused.status_code, refused.json()['code']), (403, 'forbidden'))
