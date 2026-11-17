# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The numbers of the desk: first response, resolution, service-level compliance and each agent's load."""
from datetime import timedelta

from odoo import fields

from .common import LiwanHelpdeskCase


class ReportsApiTest(LiwanHelpdeskCase):

    def report(self, period=None):
        url = '/api/v1/helpdesk/reports' + ('?period=%s' % period if period else '')
        response = self.api('GET', url)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_the_manager_reads_the_numbers_of_the_period(self):
        self.as_user(self.agent)
        first = self.ticket_body(subject='First')
        second = self.ticket_body(subject='Second')
        self.as_user(self.agent2)
        third = self.ticket_body(subject='Third')
        self.as_user(self.supervisor)
        # One answered, one closed, one still waiting for a first reply.
        self.api('POST', f'/api/v1/helpdesk/tickets/{first["id"]}/messages', json={'body': 'On it.'})
        self.api('POST', f'/api/v1/helpdesk/tickets/{second["id"]}/close', json={})
        self.assertTrue(third)
        body = self.report('30')
        self.assertEqual(body['total'], 3)
        self.assertEqual(body['open'], 2)
        self.assertEqual(body['closed'], 1)
        self.assertEqual(body['kpis']['first_response_answered'], 1)
        self.assertIsNotNone(body['kpis']['first_response_hours'])
        self.assertIsNotNone(body['kpis']['resolution_hours'])
        self.assertEqual(body['kpis']['sla_compliance_percent'], None)
        names = [row['name'] for row in body['agents']]
        self.assertIn(self.agent2.name, names)
        self.assertEqual(sum(row['count'] for row in body['stages']), 3)
        self.assertEqual([row['value'] for row in body['periods']], ['7', '30', '90', '365'])

    def test_a_period_leaves_old_tickets_out(self):
        self.as_user(self.agent)
        ticket = self.ticket_body()
        self.env['helpdesk.ticket'].browse(ticket['id']).write({
            'create_date': fields.Datetime.now() - timedelta(days=200),
        })
        self.env.invalidate_all()
        self.as_user(self.supervisor)
        self.assertEqual(self.report('7')['total'], 0)
        self.assertEqual(self.report('365')['total'], 1)
        # An unknown period falls back to the default instead of failing.
        self.assertEqual(self.report('999')['period'], 30)

    def test_service_levels_count_as_met_or_late(self):
        stages = self.env['helpdesk.ticket.stage'].search([('team_ids', 'in', self.team.ids)], order='sequence')
        self.team.use_sla = True
        target = stages.filtered(lambda stage: stage.sequence > stages[0].sequence)[:1]
        policy = self.env['helpdesk.sla'].create({
            'name': 'Answer in 4h', 'company_id': self.company.id, 'days': 0, 'hours': 4,
            'stage_id': target.id, 'team_ids': [(6, 0, self.team.ids)],
        })
        self.as_user(self.agent)
        met = self.ticket_body(subject='Met')
        late = self.ticket_body(subject='Late')
        self.as_user(self.agent)
        self.api('POST', f'/api/v1/helpdesk/tickets/{met["id"]}/stage', json={'stage_id': target.id})
        rows = self.env['helpdesk.ticket.sla'].search([('ticket_id', '=', late['id'])])
        rows.write({'deadline': fields.Datetime.now() - timedelta(hours=1), 'state': 'expired'})
        self.as_user(self.supervisor)
        body = self.report('30')
        self.assertEqual(body['kpis']['sla_met'], 1)
        self.assertEqual(body['kpis']['sla_late'], 1)
        self.assertEqual(body['kpis']['sla_compliance_percent'], 50.0)
        self.assertTrue(policy.active)
        overdue = [row for row in body['agents'] if row['overdue']]
        self.assertTrue(overdue)

    def test_only_the_report_readers_open_the_page(self):
        self.as_user(self.agent)
        response = self.api('GET', '/api/v1/helpdesk/reports')
        self.assertEqual((response.status_code, response.json()['code']), (403, 'forbidden'))
        self.as_user(self.supervisor)
        self.assertEqual(self.api('GET', '/api/v1/helpdesk/reports').status_code, 200)

    def test_the_numbers_of_another_company_stay_out(self):
        foreign = self.env['helpdesk.ticket'].create({
            'name': 'Other tenant', 'description': '<p>Other</p>', 'company_id': self.other_company.id,
            'team_id': self.other_team.id, 'stage_id': self.other_team._get_applicable_stages()[:1].id,
        })
        self.assertTrue(foreign)
        self.as_user(self.agent)
        self.ticket_body(subject='Mine')
        self.as_user(self.supervisor)
        body = self.report('30')
        self.assertEqual(body['total'], 1)
        self.assertEqual([row['count'] for row in body['stages']], [1])
