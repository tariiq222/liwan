# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The tickets raised from a customer conversation: both routes, the one-open-ticket guard (raise and reopen) and the link it records."""
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

    def linked_customer(self, conversation, phone):
        customer = self.env['liwan.customers.service']._liwan_create({'name': 'Linked customer', 'phone': phone})
        conversation.contact_id.partner_id = customer
        return customer

    def test_the_ticket_carries_the_active_customer_of_the_contact(self):
        self.login(self.agent)
        conversation = self.make_conversation()
        customer = self.linked_customer(conversation, '+966501110031')
        created = self.raise_ticket(conversation.id)
        self.assertEqual(created.status_code, 200, created.text)
        ticket = self.env['helpdesk.ticket'].browse(created.json()['id'])
        self.assertEqual(ticket.partner_id, customer)
        self.assertFalse(ticket.liwan_requester_user_id)

    def test_an_archived_customer_of_the_contact_leaves_the_ticket_without_a_customer(self):
        self.login(self.agent)
        conversation = self.make_conversation()
        customer = self.linked_customer(conversation, '+966501110032')
        customer.active = False
        created = self.raise_ticket(conversation.id)
        self.assertEqual(created.status_code, 200, created.text)
        ticket = self.env['helpdesk.ticket'].browse(created.json()['id'])
        self.assertNotEqual(ticket.partner_id, customer)
        self.assertEqual(ticket.liwan_requester_user_id, self.agent)

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

    def _team_with_stage(self, name):
        team = self.env['helpdesk.ticket.team'].create({'name': name, 'company_id': self.env.company.id})
        self.env['helpdesk.ticket.stage'].create({
            'name': 'New', 'sequence': 1, 'closed': False, 'company_id': self.env.company.id, 'team_ids': [(4, team.id)],
        })
        return team

    def test_an_agent_raises_a_ticket_for_another_team_under_each_visibility_mode(self):
        # The agent takes the ticket they open, so the desk's own and team rules still let the link be written even
        # when the ticket belongs to a team the agent is not in.
        team = self._team_with_stage('Other team')
        self.login(self.agent)
        for mode in ('own', 'team'):
            self.env['liwan.helpdesk.settings']._liwan_for(self.env.company).write({'visibility': mode})
            conversation = self.make_conversation()
            created = self.raise_ticket(conversation.id, subject='For another team', team_id=team.id)
            self.assertEqual(created.status_code, 200, (mode, created.text))
            ticket = self.env['helpdesk.ticket'].browse(created.json()['id'])
            self.assertEqual((ticket.team_id, ticket.liwan_conversation_id), (team, conversation), mode)

    def test_the_conversation_key_links_only_the_ticket_it_was_made_for(self):
        conversation = self.make_conversation()
        team = self._team_with_stage('Key team')
        service = self.env['liwan.helpdesk.service'].with_user(self.agent)
        linked = service.with_context(liwan_conversation_id=conversation.id)._liwan_create(
            {'subject': 'Linked', 'description': 'Linked', 'team_id': team.id})
        plain = service._liwan_create({'subject': 'Plain', 'description': 'Plain', 'team_id': team.id})
        self.assertEqual((linked.liwan_conversation_id, plain.liwan_conversation_id), (conversation, self.env['liwan.inbox.conversation']))

    def test_a_raise_rewrites_the_conversation_row_inside_its_transaction(self):
        # Two real concurrent transactions cannot run here: the test cursor is shared and never commits, so another
        # cursor cannot see the conversation. What makes the late raise fail under REPEATABLE READ is that the first
        # one writes a new version of the conversation row in its own transaction.
        self.login(self.agent)
        conversation = self.make_conversation()
        # The row's physical position (ctid) moves only when a new version of it is written; a lock leaves it in place.
        version = 'SELECT ctid::text FROM liwan_inbox_conversation WHERE id = %s'
        self.env.cr.execute(version, [conversation.id])
        before = self.env.cr.fetchone()[0]
        created = self.raise_ticket(conversation.id, subject='First')
        self.assertEqual(created.status_code, 200, created.text)
        self.env.cr.execute(version, [conversation.id])
        self.assertNotEqual(self.env.cr.fetchone()[0], before)

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

    def _ticket(self, conversation, user, subject, closed=False):
        """A ticket of the conversation assigned to `user`, written through the ORM (the raise route is not under test)."""
        ticket = self.env['liwan.helpdesk.service'].with_user(user)._liwan_create({'subject': subject, 'description': subject})
        ticket.write({'liwan_conversation_id': conversation.id, 'user_id': user.id})
        if closed:
            self.close(ticket)
        return ticket

    def _closer(self, login):
        """A desk user who may close and reopen but not assign, so the `own` visibility hides other people's tickets."""
        return self._conversation_user(login, [
            'inbox.conversations.read', 'helpdesk.tickets.read', 'helpdesk.tickets.write', 'helpdesk.tickets.close',
        ])

    def reopen(self, ticket):
        return self.api('POST', f'/api/v1/helpdesk/tickets/{ticket.id}/reopen', json={})

    def test_reopening_a_ticket_is_refused_while_another_one_of_the_conversation_is_open(self):
        closer = self._closer('ct_closer')
        conversation = self.make_conversation()
        first = self._ticket(conversation, closer, 'First', closed=True)
        second = self._ticket(conversation, closer, 'Second Subject')
        self.login(closer)
        refused = self.reopen(first)
        self.assertEqual((refused.status_code, refused.json()['code']), (422, 'invalid'), refused.text)
        self.assertEqual(refused.json()['message'], 'This conversation has another open ticket.')
        self.assertNotIn('Second Subject', refused.text)
        self.assertNotIn(str(second.number), refused.text)
        self.assertTrue(first.stage_id.closed)

    def test_a_hidden_open_ticket_still_blocks_the_reopen_and_stays_unnamed(self):
        closer, other = self._closer('ct_closer'), self._closer('ct_other')
        conversation = self.make_conversation()
        first = self._ticket(conversation, closer, 'First', closed=True)
        hidden = self._ticket(conversation, other, 'Hidden Subject')
        self.login(closer)
        listed = self.api('GET', TICKETS.format(conversation.id)).json()
        self.assertEqual([item['subject'] for item in listed['items']], ['First'])
        refused = self.reopen(first)
        self.assertEqual((refused.status_code, refused.json()['code']), (422, 'invalid'), refused.text)
        self.assertNotIn('Hidden Subject', refused.text)
        self.assertNotIn(str(hidden.number), refused.text)

    def test_a_stage_move_out_of_a_closed_stage_is_refused_the_same_way(self):
        closer = self._closer('ct_closer')
        conversation = self.make_conversation()
        first = self._ticket(conversation, closer, 'First', closed=True)
        self._ticket(conversation, closer, 'Second')
        stage = self.env['helpdesk.ticket.stage'].search([('closed', '=', False)], limit=1)
        self.login(closer)
        moved = self.api('PATCH', f'/api/v1/helpdesk/tickets/{first.id}', json={'stage_id': stage.id})
        self.assertEqual((moved.status_code, moved.json()['code']), (422, 'invalid'), moved.text)
        self.assertTrue(first.stage_id.closed)

    def test_a_ticket_reopens_once_the_other_one_is_closed(self):
        closer = self._closer('ct_closer')
        conversation = self.make_conversation()
        first = self._ticket(conversation, closer, 'First', closed=True)
        second = self._ticket(conversation, closer, 'Second')
        self.close(second)
        self.login(closer)
        reopened = self.reopen(first)
        self.assertEqual(reopened.status_code, 200, reopened.text)
        self.assertFalse(first.stage_id.closed)

    def test_a_ticket_without_a_conversation_reopens_as_before(self):
        closer = self._closer('ct_closer')
        conversation = self.make_conversation()
        self._ticket(conversation, closer, 'Open of a conversation')
        loose = self.env['liwan.helpdesk.service'].with_user(closer)._liwan_create({'subject': 'Loose', 'description': 'Loose'})
        loose.user_id = closer
        self.close(loose)
        self.login(closer)
        reopened = self.reopen(loose)
        self.assertEqual(reopened.status_code, 200, reopened.text)
        self.assertFalse(loose.stage_id.closed)

    def test_moving_between_two_open_stages_is_unaffected(self):
        closer = self._closer('ct_closer')
        conversation = self.make_conversation()
        ticket = self._ticket(conversation, closer, 'Only open one')
        stages = self.env['helpdesk.ticket.stage'].search([('closed', '=', False)], limit=2)
        for stage in stages:
            ticket.stage_id = stage
        self.assertFalse(ticket.stage_id.closed)
