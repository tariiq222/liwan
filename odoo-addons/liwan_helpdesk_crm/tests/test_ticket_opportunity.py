# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The opportunity of one ticket: owner decision D1 (2026-11-20), who may link, replace, unlink and see it."""
from odoo.tests import new_test_user

from odoo.addons.liwan_helpdesk.tests.common import LiwanHelpdeskCase, set_feature

URL = '/api/v1/helpdesk/tickets/{}/opportunity'
READ_ONLY = ['helpdesk.tickets.read', 'crm.leads.read']
WRITE_WITHOUT_CRM_WORK = ['helpdesk.tickets.read', 'helpdesk.tickets.write', 'crm.leads.read']


class TicketOpportunityTest(LiwanHelpdeskCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        # The desk agent also reads CRM; the opportunity belongs to another user, so the agent is not its agent.
        cls.env['liwan.access.service']._liwan_replace_assignments(cls.agent, [{
            'role_id': cls.env.ref('liwan_helpdesk.role_helpdesk_agent').id,
            'company_id': cls.company.id,
        }, {
            'role_id': cls.env.ref('liwan_crm.role_crm_agent').id,
            'company_id': cls.company.id,
        }])
        cls.crm_owner = new_test_user(
            cls.env, login='ticket_opp_owner', password='ticket_opp_owner_pass_123', name='Opportunity owner',
            groups='liwan_core.group_employee',
        )
        cls.set_crm_visibility('all')
        cls.customer = cls.env['res.partner'].create({
            'name': 'Acme customer', 'liwan_party': True, 'email': 'acme@example.test',
        })
        cls.lead = cls.make_lead('Acme deal', contact_name='Acme Contact')

    @classmethod
    def make_lead(cls, name, company=None, **vals):
        company = company or cls.company
        return cls.env['crm.lead'].with_context(mail_auto_subscribe_no_notify=True).create({
            'name': name, 'type': 'opportunity', 'company_id': company.id, 'user_id': cls.crm_owner.id, **vals,
        })

    @classmethod
    def set_crm_visibility(cls, mode):
        Settings = cls.env['liwan.crm.settings']
        row = Settings.search([('company_id', '=', cls.company.id)])
        if row:
            row.visibility = mode
        else:
            Settings.create({'company_id': cls.company.id, 'visibility': mode})

    @classmethod
    def user_with(cls, login, keys):
        user = new_test_user(
            cls.env, login=login, password=f'{login}_pass_123', name=login, groups='liwan_core.group_employee',
        )
        role = cls.env['liwan.access.role'].create({
            'key': login, 'name_ar': login, 'name_en': login, 'type': 'custom', 'assignable': True,
            'permission_ids': [(6, 0, cls.env['liwan.access.permission'].search([('key', 'in', keys)]).ids)],
        })
        cls.env['liwan.access.service']._liwan_replace_assignments(user, [{
            'role_id': role.id, 'company_id': cls.company.id,
        }])
        user.helpdesk_team_ids = [(4, cls.team.id)]
        return user

    def make_ticket(self, **vals):
        return self.env['helpdesk.ticket'].create({
            'name': 'Broken delivery', 'description': '<p>It broke.</p>', 'company_id': self.company.id,
            'team_id': self.team.id, 'stage_id': self.team._get_applicable_stages()[:1].id,
            'user_id': self.agent.id, **vals,
        })

    def put(self, ticket, opportunity_id):
        return self.api('PUT', URL.format(ticket.id), json={'opportunity_id': opportunity_id})

    def test_an_agent_links_replaces_and_unlinks_an_opportunity_that_is_not_theirs(self):
        ticket = self.make_ticket()
        self.as_user(self.agent)
        linked = self.put(ticket, self.lead.id)
        self.assertEqual(linked.status_code, 200, linked.text)
        self.assertEqual(linked.json(), {'opportunity': {
            'id': self.lead.id, 'contact_name': 'Acme Contact',
            'stage': {'id': self.lead.stage_id.id, 'name': self.lead.stage_id.display_name},
            'status': 'pending', 'active': True,
        }, 'hidden': False})
        self.assertEqual(ticket.liwan_lead_id, self.lead)
        other = self.make_lead('Second deal', contact_name='Second Contact')
        replaced = self.put(ticket, other.id)
        self.assertEqual(replaced.json()['opportunity']['id'], other.id)
        self.assertEqual(ticket.liwan_lead_id, other)
        removed = self.api('DELETE', URL.format(ticket.id))
        self.assertEqual((removed.status_code, removed.content), (204, b''))
        self.assertFalse(ticket.liwan_lead_id)

    def test_linking_needs_no_write_right_on_the_opportunity(self):
        ticket = self.make_ticket()
        writer = self.user_with('ticket_opp_writer', WRITE_WITHOUT_CRM_WORK)
        ticket.user_id = writer
        self.as_user(writer)
        self.assertEqual(self.put(ticket, self.lead.id).status_code, 200)
        self.assertEqual(ticket.liwan_lead_id, self.lead)

    def test_unlinking_clears_an_opportunity_the_caller_cannot_see(self):
        ticket = self.make_ticket(liwan_lead_id=self.lead.id)
        self.set_crm_visibility('own')
        self.addCleanup(self.set_crm_visibility, 'all')
        self.as_user(self.agent)
        removed = self.api('DELETE', URL.format(ticket.id))
        self.assertEqual((removed.status_code, removed.content), (204, b''))
        self.assertFalse(ticket.liwan_lead_id)

    def test_get_answers_none_visible_or_hidden_without_a_name(self):
        ticket = self.make_ticket()
        self.as_user(self.agent)
        self.assertEqual(self.api('GET', URL.format(ticket.id)).json(), {'opportunity': None, 'hidden': False})
        ticket.liwan_lead_id = self.lead
        shown = self.api('GET', URL.format(ticket.id)).json()
        self.assertEqual((shown['opportunity']['id'], shown['hidden']), (self.lead.id, False))
        self.lead.active = False
        archived = self.api('GET', URL.format(ticket.id)).json()
        self.assertEqual((archived['opportunity']['id'], archived['opportunity']['active']), (self.lead.id, False))
        self.lead.active = True
        self.set_crm_visibility('own')
        self.addCleanup(self.set_crm_visibility, 'all')
        hidden = self.api('GET', URL.format(ticket.id))
        self.assertEqual((hidden.status_code, hidden.json()), (200, {'opportunity': None, 'hidden': True}))
        self.assertNotIn('Acme', hidden.text)

    def test_a_hidden_or_missing_opportunity_is_not_found_on_put(self):
        ticket = self.make_ticket()
        self.set_crm_visibility('own')
        self.addCleanup(self.set_crm_visibility, 'all')
        self.as_user(self.agent)
        hidden = self.put(ticket, self.lead.id)
        missing = self.put(ticket, 999999999)
        self.assertEqual((hidden.status_code, hidden.content), (404, missing.content))
        self.assertFalse(ticket.liwan_lead_id)

    def test_an_opportunity_of_another_company_is_not_found(self):
        # The request is pinned to the working company, so another company's opportunity is as hidden as a missing one.
        ticket = self.make_ticket()
        other = self.make_lead('Other company deal', company=self.other_company, user_id=False)
        self.as_user(self.agent)
        hidden = self.put(ticket, other.id)
        missing = self.put(ticket, 999999999)
        self.assertEqual((hidden.status_code, hidden.content), (404, missing.content))
        self.assertFalse(ticket.liwan_lead_id)

    def test_a_ticket_outside_the_desks_visibility_is_not_found(self):
        ticket = self.make_ticket(user_id=self.agent2.id)
        self.settings.visibility = 'own'
        self.addCleanup(setattr, self.settings, 'visibility', 'all')
        self.as_user(self.agent)
        for method in ('GET', 'DELETE'):
            self.assertEqual(self.api(method, URL.format(ticket.id)).status_code, 404, method)
        self.assertEqual(self.put(ticket, self.lead.id).status_code, 404)
        foreign = self.env['helpdesk.ticket'].create({
            'name': 'Other tenant', 'description': '<p>Other</p>', 'company_id': self.other_company.id,
            'team_id': self.other_team.id, 'stage_id': self.other_team._get_applicable_stages()[:1].id,
        })
        self.assertEqual(self.put(foreign, self.lead.id).status_code, 404)

    def test_reading_and_linking_need_both_capabilities(self):
        ticket = self.make_ticket(liwan_lead_id=self.lead.id)
        no_crm = self.user_with('ticket_opp_no_crm', ['helpdesk.tickets.read', 'helpdesk.tickets.write'])
        self.as_user(no_crm)
        for method in ('GET', 'PUT'):
            response = self.api(method, URL.format(ticket.id), json={'opportunity_id': self.lead.id} if method == 'PUT' else None)
            self.assertEqual((response.status_code, response.json()['code']), (403, 'forbidden'), method)
        self.assertEqual(ticket.liwan_lead_id, self.lead)
        # Unlinking needs only the ticket's write right (D1).
        self.assertEqual(self.api('DELETE', URL.format(ticket.id)).status_code, 204)
        self.assertFalse(ticket.liwan_lead_id)

    def test_a_reader_may_read_but_not_change_the_link(self):
        ticket = self.make_ticket(liwan_lead_id=self.lead.id)
        reader = self.user_with('ticket_opp_reader', READ_ONLY)
        self.as_user(reader)
        self.assertEqual(self.api('GET', URL.format(ticket.id)).status_code, 200)
        self.assertEqual(self.put(ticket, self.lead.id).status_code, 403)
        self.assertEqual(self.api('DELETE', URL.format(ticket.id)).status_code, 403)
        self.assertEqual(ticket.liwan_lead_id, self.lead)

    def test_a_requester_has_no_access(self):
        self.as_user(self.requester)
        own = self.ticket_body(subject='Mine', description='Only mine.')
        for method in ('GET', 'PUT', 'DELETE'):
            response = self.api(method, URL.format(own['id']), json={'opportunity_id': self.lead.id} if method == 'PUT' else None)
            self.assertEqual(response.status_code, 403, method)

    def test_each_feature_gates_every_route(self):
        ticket = self.make_ticket(liwan_lead_id=self.lead.id)
        self.as_user(self.agent)
        for key in ('helpdesk.enabled', 'crm.enabled'):
            with self.subTest(feature=key):
                set_feature(self, key, False)
                for method in ('GET', 'PUT', 'DELETE'):
                    response = self.api(method, URL.format(ticket.id), json={'opportunity_id': self.lead.id} if method == 'PUT' else None)
                    self.assertEqual(response.status_code, 403, (key, method))
                    self.assertEqual(response.json()['code'], 'feature_not_included', (key, method))
                set_feature(self, key, True)
        self.assertEqual(ticket.liwan_lead_id, self.lead)

    def test_the_body_is_validated(self):
        ticket = self.make_ticket()
        self.as_user(self.agent)
        for body, field in (
            ({}, 'opportunity_id'),
            ({'opportunity_id': None}, 'opportunity_id'),
            ({'opportunity_id': 0}, 'opportunity_id'),
            ({'opportunity_id': 'the-deal'}, 'opportunity_id'),
            ({'opportunity_id': self.lead.id, 'stage': 'won'}, 'stage'),
        ):
            with self.subTest(body=body):
                response = self.api('PUT', URL.format(ticket.id), json=body)
                self.assertEqual((response.status_code, response.json()['code'], response.json()['field']), (422, 'invalid', field))
        self.assertFalse(ticket.liwan_lead_id)

    def test_post_is_no_longer_routed(self):
        ticket = self.make_ticket()
        self.as_user(self.agent)
        response = self.api('POST', URL.format(ticket.id), json={'opportunity_id': self.lead.id})
        self.assertIn(response.status_code, (404, 405))
        self.assertFalse(ticket.liwan_lead_id)
