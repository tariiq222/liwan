# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The ticket routes: create, read, list, assign, move, close, reopen, answer, attach."""
from .common import FEATURE, LiwanHelpdeskCase, set_feature
from odoo.addons.liwan_helpdesk.hooks import ENGINE_STAGES


class TicketApiTest(LiwanHelpdeskCase):

    def setUp(self):
        super().setUp()
        self.customer = self.env['res.partner'].create({
            'name': 'Acme customer', 'liwan_party': True, 'email': 'acme@example.test',
        })

    def test_an_agent_opens_a_ticket_for_a_customer(self):
        self.as_user(self.agent)
        body = self.ticket_body(customer_id=self.customer.id, priority='high')
        self.assertEqual(body['subject'], 'Printer is down')
        self.assertEqual(body['priority'], 'high')
        self.assertEqual(body['requester'], {'kind': 'customer', 'id': self.customer.id, 'name': 'Acme customer'})
        self.assertEqual(body['stage']['closed'], False)
        self.assertEqual(body['assignee']['id'], self.agent.id)
        self.assertTrue(body['number'].startswith(self.settings.reference_prefix))

    def test_the_list_shows_the_ticket_and_its_filters(self):
        self.as_user(self.agent)
        created = self.ticket_body(customer_id=self.customer.id)
        response = self.api('GET', '/api/v1/helpdesk/tickets')
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body['total'], 1)
        self.assertEqual(body['items'][0]['id'], created['id'])
        self.assertEqual(self.api('GET', '/api/v1/helpdesk/tickets?state=closed').json()['total'], 0)
        self.assertEqual(self.api('GET', '/api/v1/helpdesk/tickets?assignee=me').json()['total'], 1)
        self.assertEqual(self.api('GET', '/api/v1/helpdesk/tickets?assignee=none').json()['total'], 0)
        self.assertEqual(self.api('GET', '/api/v1/helpdesk/tickets?priority=high').json()['total'], 0)
        self.assertEqual(self.api('GET', '/api/v1/helpdesk/tickets?q=printer').json()['total'], 1)
        self.assertEqual(self.api('GET', '/api/v1/helpdesk/tickets?state=wrong').status_code, 422)

    def test_the_supervisor_assigns_and_releases_the_ticket(self):
        self.as_user(self.agent)
        ticket = self.ticket_body(customer_id=self.customer.id)
        # An agent answers; dispatching needs its own capability.
        denied = self.api('POST', f'/api/v1/helpdesk/tickets/{ticket["id"]}/assign',
                          json={'assignee_id': self.agent2.id})
        self.assertEqual((denied.status_code, denied.json()['code']), (403, 'forbidden'))
        self.as_user(self.supervisor)
        response = self.api('POST', f'/api/v1/helpdesk/tickets/{ticket["id"]}/assign',
                            json={'assignee_id': self.agent2.id})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['assignee']['id'], self.agent2.id)
        released = self.api('POST', f'/api/v1/helpdesk/tickets/{ticket["id"]}/assign', json={'assignee_id': None})
        self.assertEqual(released.status_code, 200, released.text)
        self.assertIsNone(released.json()['assignee'])

    def test_the_stage_moves_and_the_ticket_closes_and_reopens(self):
        self.as_user(self.agent)
        ticket = self.ticket_body(customer_id=self.customer.id)
        stages = self.env['helpdesk.ticket.stage'].search([('team_ids', 'in', self.team.ids)], order='sequence')
        progress = stages.filtered(lambda stage: not stage.closed)[1]
        moved = self.api('POST', f'/api/v1/helpdesk/tickets/{ticket["id"]}/stage', json={'stage_id': progress.id})
        self.assertEqual((moved.status_code, moved.json()['stage']['id']), (200, progress.id))
        # Closing is its own capability.
        denied = self.api('POST', f'/api/v1/helpdesk/tickets/{ticket["id"]}/close', json={})
        self.assertEqual((denied.status_code, denied.json()['code']), (403, 'forbidden'))
        closed = self.as_user(self.supervisor).api('POST', f'/api/v1/helpdesk/tickets/{ticket["id"]}/close', json={})
        self.assertEqual(closed.status_code, 200, closed.text)
        self.assertTrue(closed.json()['stage']['closed'])
        self.assertTrue(closed.json()['closed_at'])
        again = self.api('POST', f'/api/v1/helpdesk/tickets/{ticket["id"]}/close', json={})
        self.assertEqual((again.status_code, again.json()['code']), (409, 'conflict'))
        reopened = self.api('POST', f'/api/v1/helpdesk/tickets/{ticket["id"]}/reopen', json={})
        self.assertEqual(reopened.status_code, 200, reopened.text)
        self.assertFalse(reopened.json()['stage']['closed'])

    def test_the_thread_keeps_replies_and_internal_notes(self):
        self.as_user(self.agent)
        ticket = self.ticket_body(customer_id=self.customer.id)
        reply = self.api('POST', f'/api/v1/helpdesk/tickets/{ticket["id"]}/messages',
                         json={'body': 'We are on it.'})
        self.assertEqual(reply.status_code, 200, reply.text)
        self.assertEqual(reply.json()['items'][-1]['body'], '<p>We are on it.</p>')
        self.assertFalse(reply.json()['items'][-1]['internal'])
        note = self.api('POST', f'/api/v1/helpdesk/tickets/{ticket["id"]}/messages',
                        json={'body': 'Spare part ordered.', 'internal': True})
        self.assertTrue(note.json()['items'][-1]['internal'])
        detail = self.api('GET', f'/api/v1/helpdesk/tickets/{ticket["id"]}').json()
        self.assertTrue(detail['first_response']['at'])
        messages = self.api('GET', f'/api/v1/helpdesk/tickets/{ticket["id"]}/messages').json()
        self.assertEqual(messages['total'], 2)

    def test_an_employee_opens_and_follows_their_own_request(self):
        self.as_user(self.requester)
        body = self.ticket_body(subject='Laptop battery', description='It drains in an hour.')
        self.assertEqual(body['requester'], {'kind': 'employee', 'id': self.requester.id, 'name': 'helpdesk_requester'})
        self.assertIsNone(body['assignee'])
        detail = self.api('GET', f'/api/v1/helpdesk/tickets/{body["id"]}')
        self.assertEqual(detail.status_code, 200, detail.text)
        reply = self.api('POST', f'/api/v1/helpdesk/tickets/{body["id"]}/messages', json={'body': 'Any update?'})
        self.assertEqual(reply.status_code, 200, reply.text)
        # The list is theirs alone, and somebody else's ticket is not found.
        listed = self.api('GET', '/api/v1/helpdesk/tickets').json()
        self.assertEqual([row['id'] for row in listed['items']], [body['id']])
        colleague_ticket = self.env['helpdesk.ticket'].create({
            'name': 'Not yours', 'description': '<p>Not yours</p>', 'company_id': self.company.id,
            'team_id': self.team.id, 'stage_id': self.team._get_applicable_stages()[:1].id,
        })
        other = self.api('GET', f'/api/v1/helpdesk/tickets/{colleague_ticket.id}')
        self.assertEqual((other.status_code, other.json()['code']), (404, 'not_found'))

    def test_the_request_body_is_validated(self):
        self.as_user(self.agent)
        self.assertEqual(self.api('POST', '/api/v1/helpdesk/tickets', json={'description': 'x'}).json()['field'], 'subject')
        self.assertEqual(self.api('POST', '/api/v1/helpdesk/tickets', json={'subject': 'x'}).json()['field'], 'description')
        self.assertEqual(self.create_ticket(priority='urgent').status_code, 200)
        unknown = self.create_ticket(priority='whenever')
        self.assertEqual((unknown.status_code, unknown.json()['code'], unknown.json()['field']), (422, 'invalid', 'priority'))
        extra = self.create_ticket(wat='x')
        self.assertEqual((extra.status_code, extra.json()['code']), (422, 'invalid'))
        missing_customer = self.create_ticket(customer_id=999999999)
        self.assertEqual((missing_customer.status_code, missing_customer.json()['code']), (404, 'not_found'))
        ticket = self.ticket_body()
        self.assertEqual(self.api('PATCH', f'/api/v1/helpdesk/tickets/{ticket["id"]}',
                                  json={'assignee_id': self.agent2.id}).status_code, 403)

    def test_another_company_ticket_is_not_found(self):
        self.as_user(self.agent)
        foreign = self.env['helpdesk.ticket'].create({
            'name': 'Other tenant ticket', 'description': '<p>Other tenant</p>',
            'company_id': self.other_company.id, 'team_id': self.other_team.id,
            'stage_id': self.other_team._get_applicable_stages()[:1].id,
        })
        response = self.api('GET', f'/api/v1/helpdesk/tickets/{foreign.id}')
        self.assertEqual((response.status_code, response.json()['code']), (404, 'not_found'))
        listed = self.api('GET', '/api/v1/helpdesk/tickets').json()
        self.assertEqual(listed['total'], 0)

    def test_a_closed_feature_refuses_every_route(self):
        self.as_user(self.agent)
        set_feature(self, FEATURE, False)
        try:
            response = self.api('GET', '/api/v1/helpdesk/tickets')
            self.assertEqual((response.status_code, response.json()['code']), (403, 'feature_not_included'))
            created = self.create_ticket()
            self.assertEqual(created.status_code, 403)
        finally:
            set_feature(self, FEATURE, True)

    def test_attachments_upload_list_and_download(self):
        self.as_user(self.agent)
        ticket = self.ticket_body(customer_id=self.customer.id)
        uploaded = self.api('POST', f'/api/v1/helpdesk/tickets/{ticket["id"]}/attachments', json={
            'name': 'screen.txt', 'mimetype': 'text/plain', 'data': self.encoded('a screenshot'),
        })
        self.assertEqual(uploaded.status_code, 200, uploaded.text)
        attachment = uploaded.json()['items'][0]
        self.assertEqual(attachment['name'], 'screen.txt')
        listed = self.api('GET', f'/api/v1/helpdesk/tickets/{ticket["id"]}/attachments').json()
        self.assertEqual(listed['total'], 1)
        download = self.url_open(f'/api/v1/helpdesk/tickets/{ticket["id"]}/attachments/{attachment["id"]}/download')
        self.assertEqual(download.status_code, 200)
        self.assertEqual(download.content, b'a screenshot')
        removed = self.api('DELETE', f'/api/v1/helpdesk/tickets/{ticket["id"]}/attachments/{attachment["id"]}', json={})
        self.assertEqual(removed.json()['items'], [])

    def test_the_summary_counts_what_the_caller_reads(self):
        self.as_user(self.agent)
        self.ticket_body(customer_id=self.customer.id)
        self.env['helpdesk.ticket'].create({
            # The engine's own auto-assign company flag is on by default; a ticket LiwanOS creates
            # always carries its own assignee choice, so the fixture states it too.
            'name': 'Unassigned one', 'description': '<p>Unassigned</p>', 'company_id': self.company.id,
            'team_id': self.team.id, 'stage_id': self.team._get_applicable_stages()[:1].id, 'user_id': False,
        })
        body = self.api('GET', '/api/v1/helpdesk/summary').json()
        self.assertEqual(body['open'], 2)
        self.assertEqual(body['mine'], 1)
        self.assertEqual(body['unassigned'], 1)
        self.assertEqual(body['overdue'], 0)

    def test_the_reference_lists_serve_the_company(self):
        self.as_user(self.agent)
        body = self.api('GET', '/api/v1/helpdesk/reference').json()
        self.assertIn(self.team.id, [team['id'] for team in body['teams']])
        self.assertTrue(body['stages'])
        self.assertIn('closed', body['stages'][0])

    def test_a_duplicate_is_merged_into_the_target(self):
        self.as_user(self.supervisor)
        target = self.ticket_body(subject='Printer is down')
        source = self.ticket_body(subject='Printer does not print')
        attachment = self.env['ir.attachment'].create({
            'name': 'log.txt', 'raw': b'log', 'res_model': 'helpdesk.ticket', 'res_id': source['id'],
            'type': 'binary', 'mimetype': 'text/plain',
        })
        merged = self.api('POST', f'/api/v1/helpdesk/tickets/{target["id"]}/merge',
                          json={'source_ids': [source['id']]})
        self.assertEqual(merged.status_code, 200, merged.text)
        source_ticket = self.env['helpdesk.ticket'].browse(source['id'])
        self.assertEqual(source_ticket.duplicate_id.id, target['id'])
        self.assertTrue(source_ticket.stage_id.closed)
        self.assertEqual(attachment.res_id, target['id'])
        notes = self.env['mail.message'].search([
            ('model', '=', 'helpdesk.ticket'), ('res_id', '=', target['id']), ('subtype_id.internal', '=', True),
        ])
        self.assertTrue(any('Merged' in (note.body or '') for note in notes))
        # An agent answers but does not merge.
        self.as_user(self.agent)
        denied = self.api('POST', f'/api/v1/helpdesk/tickets/{target["id"]}/merge',
                          json={'source_ids': [source['id']]})
        self.assertEqual((denied.status_code, denied.json()['code']), (403, 'forbidden'))

    def test_the_customer_link_travels_to_a_writer_only(self):
        self.as_user(self.agent)
        ticket = self.ticket_body(customer_id=self.customer.id)
        detail = self.api('GET', f'/api/v1/helpdesk/tickets/{ticket["id"]}').json()
        self.assertTrue(detail['portal_link'].startswith('http'))
        self.assertIn('/support/%s?token=' % ticket['id'], detail['portal_link'])
        # A requester reads their own ticket without the link.
        self.as_user(self.requester)
        own = self.ticket_body(subject='Mine', description='Only mine.')
        seen = self.api('GET', f'/api/v1/helpdesk/tickets/{own["id"]}').json()
        self.assertIsNone(seen['portal_link'])

    def test_the_engine_english_stages_are_archived_and_never_offered(self):
        """The engine's six stages have no company and no team, so they would apply to every team; the hook archives them."""
        for xmlid in ENGINE_STAGES:
            stage = self.env.ref(xmlid)
            self.assertFalse(stage.active, xmlid)
        applicable = self.team._get_applicable_stages()
        self.assertTrue(applicable, 'the seeded stages must stay applicable')
        self.assertFalse(applicable.filtered(lambda stage: not stage.company_id), 'an engine stage still applies')
        self.as_user(self.agent)
        offered = self.api('GET', '/api/v1/helpdesk/reference').json()['stages']
        self.assertFalse({'New', 'Done', 'Cancelled', 'Rejected'} & {stage['name'] for stage in offered})

    def test_an_agent_without_assign_saves_the_form_with_the_same_team_but_cannot_move_it(self):
        """The edit form always sends the team: naming the current one is no move, naming another one is."""
        self.as_user(self.agent)
        ticket = self.ticket_body()
        same = self.api('PATCH', f'/api/v1/helpdesk/tickets/{ticket["id"]}',
                        json={'subject': 'Renamed', 'team_id': self.team.id})
        self.assertEqual(same.status_code, 200, same.text)
        self.assertEqual(same.json()['subject'], 'Renamed')
        other = self.env['helpdesk.ticket.team'].create({'name': 'Other desk', 'company_id': self.company.id})
        moved = self.api('PATCH', f'/api/v1/helpdesk/tickets/{ticket["id"]}', json={'team_id': other.id})
        self.assertEqual((moved.status_code, moved.json()['code']), (403, 'forbidden'))

    def test_only_an_agent_may_list_the_customers_a_ticket_is_opened_for(self):
        """An employee names no customer on a request, so the customer list is not theirs to read either."""
        self.as_user(self.requester)
        self.assertEqual(self.api('GET', '/api/v1/customers/pick').status_code, 403)
        self.as_user(self.agent)
        self.assertEqual(self.api('GET', '/api/v1/customers/pick').status_code, 200)

    def test_every_write_answers_the_detail_shape_the_screen_parses(self):
        """The client's schema is strict: a write that omitted the attachments would land and then report failure."""
        self.as_user(self.agent)
        ticket = self.ticket_body(customer_id=self.customer.id)
        created_keys = {'attachments', 'portal_link', 'related', 'first_response', 'description'}
        self.assertLessEqual(created_keys, set(ticket))
        updated = self.api('PATCH', f'/api/v1/helpdesk/tickets/{ticket["id"]}',
                           json={'subject': 'Printer is down (again)'})
        self.assertEqual(updated.status_code, 200, updated.text)
        self.assertLessEqual(created_keys, set(updated.json()))
        # Every answering route returns the detail shape: a write that omitted the attachments would land on the
        # server and then fail the client's strict schema, so the screen would report failure for a saved change.
        staged = self.api('POST', f'/api/v1/helpdesk/tickets/{ticket["id"]}/stage',
                          json={'stage_id': self.team._get_applicable_stages()[1].id})
        self.assertEqual(staged.status_code, 200, staged.text)
        self.assertLessEqual(created_keys, set(staged.json()), 'stage')
        # Closing and reopening are the supervisor's right, not the agent's.
        self.as_user(self.supervisor)
        for action in ('close', 'reopen'):
            response = self.api('POST', f'/api/v1/helpdesk/tickets/{ticket["id"]}/{action}', json={})
            self.assertEqual(response.status_code, 200, '%s: %s' % (action, response.text))
            self.assertLessEqual(created_keys, set(response.json()), action)
