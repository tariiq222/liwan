# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The tickets raised from a customer conversation: both routes, the one-open-ticket guard and the link it records."""
from odoo import Command
from odoo.tests import new_test_user

from odoo.addons.liwan_api.tests.common import set_probe_feature
from odoo.addons.liwan_inbox.tests.common import PASSWORD, LiwanInboxCase

TICKETS = '/api/v1/inbox/conversations/{}/tickets'
REF_KEYS = {'id', 'number', 'subject', 'stage', 'created_at'}


class ConversationTicketTest(LiwanInboxCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        company = cls.env.company
        cls.settings.visibility_policy = 'all'
        # The bridge needs the desk's write right on the same person who answers conversations.
        for user in (cls.agent, cls.agent2):
            cls.env['liwan.access.service']._liwan_replace_assignments(user, [{
                'role_id': cls.env.ref('liwan_inbox.role_inbox_agent').id, 'company_id': company.id,
            }, {
                'role_id': cls.env.ref('liwan_helpdesk.role_helpdesk_agent').id, 'company_id': company.id,
            }])
        cls.env['liwan.helpdesk.settings']._liwan_for(company).write({'visibility': 'own'})
        cls.read_only = cls._conversation_user('ct_read_only', ['inbox.conversations.read', 'helpdesk.tickets.read'])

    @classmethod
    def _conversation_user(cls, login, keys):
        """An employee whose only grants are the capabilities `keys`, through a custom role."""
        user = new_test_user(cls.env, login=login, password=PASSWORD, name=login, groups='liwan_core.group_employee')
        role = cls.env['liwan.access.role'].create({
            'key': login, 'name_ar': login, 'name_en': login, 'type': 'custom',
            'permission_ids': [Command.set(cls.env['liwan.access.permission'].search([('key', 'in', keys)]).ids)],
        })
        cls.env['liwan.access.service']._liwan_replace_assignments(user, [{'role_id': role.id, 'company_id': cls.env.company.id}])
        return user

    def raise_ticket(self, conversation_id, **payload):
        return self.api('POST', TICKETS.format(conversation_id), json=payload)

    def close(self, ticket):
        ticket.stage_id = self.env['helpdesk.ticket.stage'].search([('closed', '=', True)], limit=1)

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
        self.assertEqual(set(body), REF_KEYS)
        self.assertEqual(body['subject'], 'Broken delivery')
        self.assertEqual(set(body['stage']), {'id', 'name', 'closed'})
        ticket = self.env['helpdesk.ticket'].browse(body['id'])
        self.assertEqual(ticket.liwan_conversation_id, conversation)
        self.assertEqual(body['number'], ticket.number)

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

    def test_a_second_ticket_waits_until_the_open_one_is_closed(self):
        self.login(self.agent)
        conversation = self.make_conversation()
        first = self.raise_ticket(conversation.id, subject='First')
        self.assertEqual(first.status_code, 200, first.text)
        again = self.raise_ticket(conversation.id, subject='Second')
        self.assertEqual((again.status_code, again.json()['code']), (409, 'conflict'))
        self.assertEqual(again.json()['details']['reason'], 'open_ticket_exists')
        self.close(self.env['helpdesk.ticket'].browse(first.json()['id']))
        second = self.raise_ticket(conversation.id, subject='Second')
        self.assertEqual(second.status_code, 200, second.text)
        listed = self.api('GET', TICKETS.format(conversation.id))
        self.assertEqual(listed.status_code, 200, listed.text)
        self.assertEqual(listed.json()['total'], 2)
        self.assertEqual([item['subject'] for item in listed.json()['items']], ['Second', 'First'])
        self.assertEqual([item['stage']['closed'] for item in listed.json()['items']], [False, True])

    def test_an_open_ticket_the_caller_cannot_see_still_blocks_and_stays_unnamed(self):
        conversation = self.make_conversation()
        self.login(self.agent)
        hidden = self.raise_ticket(conversation.id, subject='Secret subject')
        self.assertEqual(hidden.status_code, 200, hidden.text)
        # Under the own mode the second agent sees only tickets assigned to them, so the first agent's ticket is hidden.
        self.login(self.agent2)
        listed = self.api('GET', TICKETS.format(conversation.id))
        self.assertEqual(listed.status_code, 200, listed.text)
        self.assertEqual((listed.json()['items'], listed.json()['total']), ([], 0))
        refused = self.raise_ticket(conversation.id, subject='Another')
        self.assertEqual((refused.status_code, refused.json()['code']), (409, 'conflict'))
        self.assertEqual(refused.json()['details'], {'reason': 'open_ticket_exists'})
        self.assertNotIn('Secret subject', refused.text)
        self.assertNotIn(str(hidden.json()['number']), refused.text)

    def test_the_list_leaves_out_tickets_outside_the_desk_visibility_and_total_matches(self):
        conversation = self.make_conversation()
        self.login(self.agent)
        mine = self.raise_ticket(conversation.id, subject='Mine')
        self.assertEqual(mine.status_code, 200, mine.text)
        self.close(self.env['helpdesk.ticket'].browse(mine.json()['id']))
        self.login(self.agent2)
        theirs = self.raise_ticket(conversation.id, subject='Theirs')
        self.assertEqual(theirs.status_code, 200, theirs.text)
        listed = self.api('GET', TICKETS.format(conversation.id)).json()
        self.assertEqual([item['subject'] for item in listed['items']], ['Theirs'])
        self.assertEqual(listed['total'], 1)
        paged = self.api('GET', TICKETS.format(conversation.id) + '?limit=1&offset=1').json()
        self.assertEqual((paged['items'], paged['total']), ([], 1))

    def test_a_hidden_conversation_and_one_of_another_company_are_not_found(self):
        self.login(self.agent)
        self.assertEqual(self.raise_ticket(999999999).status_code, 404)
        self.assertEqual(self.api('GET', TICKETS.format(999999999)).status_code, 404)
        other = self.env['res.company'].create({'name': 'Other ticket company'})
        foreign = self.make_conversation(
            channel=self.make_channel(
                phone_id='100000000777', business_account_id='200000000777', owner_company_id=other.id,
            ),
        )
        self.assertEqual(self.raise_ticket(foreign.id).status_code, 404)
        self.assertEqual(self.api('GET', TICKETS.format(foreign.id)).status_code, 404)
        self.assertFalse(self.env['helpdesk.ticket'].search([('liwan_conversation_id', '=', foreign.id)]))

    def test_each_route_needs_its_own_desk_capability(self):
        conversation = self.make_conversation()
        self.login(self.read_only)
        self.assertEqual(self.api('GET', TICKETS.format(conversation.id)).status_code, 200)
        refused = self.raise_ticket(conversation.id)
        self.assertEqual((refused.status_code, refused.json()['code']), (403, 'forbidden'))
        # The inbox-only reader holds no desk capability at all.
        self.login(self.reader_only)
        listed = self.api('GET', TICKETS.format(conversation.id))
        self.assertEqual((listed.status_code, listed.json()['code']), (403, 'forbidden'))
        self.assertEqual(self.raise_ticket(conversation.id).status_code, 403)
        self.assertFalse(self.env['helpdesk.ticket'].search([('liwan_conversation_id', '=', conversation.id)]))

    def test_each_closed_feature_refuses_both_routes(self):
        conversation = self.make_conversation()
        for key in ('inbox.enabled', 'helpdesk.enabled'):
            with self.subTest(feature=key):
                set_probe_feature(self, key=key, enabled=False)
                self.login(self.agent)
                for method in ('GET', 'POST'):
                    response = self.api(method, TICKETS.format(conversation.id), None if method == 'GET' else {})
                    self.assertEqual(
                        (response.status_code, response.json()['code']), (403, 'feature_not_included'), (key, method),
                    )
                set_probe_feature(self, key=key, enabled=True)

    def test_an_unknown_body_field_is_refused(self):
        self.login(self.agent)
        conversation = self.make_conversation()
        extra = self.raise_ticket(conversation.id, subject='x', assignee_id=1)
        self.assertEqual((extra.status_code, extra.json()['code']), (422, 'invalid'))
        self.assertFalse(self.env['helpdesk.ticket'].search([('liwan_conversation_id', '=', conversation.id)]))

    def test_deleting_the_conversation_keeps_the_ticket(self):
        self.login(self.agent)
        conversation = self.make_conversation()
        created = self.raise_ticket(conversation.id)
        self.assertEqual(created.status_code, 200, created.text)
        ticket = self.env['helpdesk.ticket'].browse(created.json()['id'])
        conversation.unlink()
        self.assertTrue(ticket.exists())
        self.assertFalse(ticket.liwan_conversation_id)
