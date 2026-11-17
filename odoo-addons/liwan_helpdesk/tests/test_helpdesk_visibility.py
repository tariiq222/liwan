# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The three visibility modes, enforced by the record rules and mirrored by the routes."""
from odoo.tests import new_test_user

from .common import LiwanHelpdeskCase


class VisibilityTest(LiwanHelpdeskCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.other_team = cls._team(cls.company, 'Second line')
        cls.second_agent = cls._member('helpdesk_second_agent', 'liwan_helpdesk.role_helpdesk_agent')
        cls.other_team.write({'user_ids': [(6, 0, [cls.second_agent.id])]})

    def setUp(self):
        super().setUp()
        self.open_stage = self.team._get_applicable_stages().filtered(lambda stage: not stage.closed)[:1]
        self.other_stage = self.other_team._get_applicable_stages().filtered(
            lambda stage: not stage.closed)[:1]

    def ticket(self, team, stage, assignee=None, name='Ticket'):
        return self.env['helpdesk.ticket'].create({
            'name': name, 'description': '<p>%s</p>' % name, 'company_id': self.company.id,
            'team_id': team.id, 'stage_id': stage.id,
            'user_id': assignee.id if assignee else False,
        })

    def visible_ids(self, user):
        self.as_user(user)
        response = self.api('GET', '/api/v1/helpdesk/tickets?state=all')
        self.assertEqual(response.status_code, 200, response.text)
        return {row['id'] for row in response.json()['items']}

    def set_mode(self, mode):
        self.env['liwan.helpdesk.settings']._liwan_for(self.company).write({'visibility': mode})
        self.env['res.users'].invalidate_model([
            'liwan_helpdesk_own_company_ids', 'liwan_helpdesk_team_company_ids', 'liwan_helpdesk_all_company_ids',
        ])

    def test_team_mode_shows_the_teams_tickets_and_hides_another_teams(self):
        self.set_mode('team')
        mine = self.ticket(self.team, self.open_stage, self.agent, 'Mine')
        team_unassigned = self.ticket(self.team, self.open_stage, None, 'Team unassigned')
        foreign = self.ticket(self.other_team, self.other_stage, self.second_agent, 'Other team')
        seen = self.visible_ids(self.agent)
        self.assertEqual(seen, {mine.id, team_unassigned.id})
        self.assertNotIn(foreign.id, seen)

    def test_own_mode_shows_only_what_is_assigned_to_me_and_my_teams_unassigned(self):
        self.set_mode('own')
        mine = self.ticket(self.team, self.open_stage, self.agent, 'Mine')
        colleague = self.ticket(self.team, self.open_stage, self.agent2, 'Colleague')
        unassigned = self.ticket(self.team, self.open_stage, None, 'Unassigned')
        seen = self.visible_ids(self.agent)
        self.assertEqual(seen, {mine.id, unassigned.id})
        self.assertNotIn(colleague.id, seen)

    def test_all_mode_shows_every_ticket_of_the_company(self):
        self.set_mode('all')
        mine = self.ticket(self.team, self.open_stage, self.agent, 'Mine')
        other = self.ticket(self.other_team, self.other_stage, self.second_agent, 'Other team')
        self.assertEqual(self.visible_ids(self.agent), {mine.id, other.id})

    def test_an_assign_holder_reads_the_whole_company_whatever_the_setting(self):
        self.set_mode('own')
        mine = self.ticket(self.team, self.open_stage, self.agent, 'Mine')
        other = self.ticket(self.other_team, self.other_stage, self.second_agent, 'Other team')
        self.assertEqual(self.visible_ids(self.supervisor), {mine.id, other.id})

    def test_an_employee_reads_the_request_they_made_in_any_mode(self):
        for mode in ('own', 'team', 'all'):
            with self.subTest(mode=mode):
                self.set_mode(mode)
                self.as_user(self.requester)
                created = self.ticket_body(subject='My request %s' % mode)
                self.as_user(self.requester)
                response = self.api('GET', f'/api/v1/helpdesk/tickets/{created["id"]}')
                self.assertEqual(response.status_code, 200, response.text)

    def test_a_user_without_the_capability_reads_and_opens_nothing(self):
        self.set_mode('all')
        self.ticket(self.team, self.open_stage, self.agent, 'Some ticket')
        plain = new_test_user(
            self.env, login='helpdesk_plain', password='helpdesk_plain_pass_123',
            name='Plain employee', groups='liwan_core.group_employee',
        )
        self.as_user(plain)
        self.assertEqual(self.api('GET', '/api/v1/helpdesk/tickets').status_code, 403)
        opened = self.create_ticket(subject='Own request', description='Only mine.')
        self.assertEqual((opened.status_code, opened.json()['code']), (403, 'forbidden'))
