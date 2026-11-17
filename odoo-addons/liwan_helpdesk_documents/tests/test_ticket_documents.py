# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""A ticket as a document context: the options it offers, the scope it grants and the link it records."""
from odoo.tests import new_test_user

from odoo.addons.liwan_api.controllers.common import ApiError
from odoo.addons.liwan_helpdesk.tests.common import LiwanHelpdeskCase


class TicketDocumentContextTest(LiwanHelpdeskCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        # The bridge needs the desk's rights and the library's read right on the same user: the library's own
        # policy answers first, and only then the ticket decides which documents that person reaches.
        # A custom role holding exactly the desk's agent keys and the library's read key: the fixture states the
        # two capabilities the bridge joins instead of relying on whichever built-in role carries them today.
        role = cls.env['liwan.access.role'].create({
            'key': 'helpdesk_documents_probe', 'name_ar': 'probe', 'name_en': 'probe', 'type': 'custom',
            'assignable': True,
            'permission_ids': [(6, 0, cls.env['liwan.access.permission'].search([
                ('key', 'in', ['helpdesk.tickets.read', 'helpdesk.tickets.write', 'helpdesk.tickets.request',
                               'helpdesk.requests.read', 'helpdesk.requests.create', 'documents.items.read']),
            ]).ids)],
        })
        cls.env['liwan.access.service']._liwan_replace_assignments(cls.agent, [{
            'role_id': role.id, 'company_id': cls.company.id,
        }])

    def ticket_with_document(self, name='Printer is down'):
        ticket = self.env['helpdesk.ticket'].create({
            'name': name, 'description': '<p>d</p>', 'company_id': self.company.id,
            'team_id': self.team.id, 'stage_id': self.team._get_applicable_stages()[:1].id,
            'user_id': self.agent.id,
        })
        document = self.env['liwan.document'].create({
            'name': 'Invoice copy', 'company_id': self.company.id, 'helpdesk_ticket_id': ticket.id,
        })
        return ticket, document

    def test_the_ticket_is_offered_as_a_context(self):
        self.as_user(self.agent)
        ticket, document = self.ticket_with_document()
        links = self.env['liwan.document.links']
        kinds = [definition['kind'] for definition in links._liwan_context_definitions()]
        self.assertIn('helpdesk.ticket', kinds)
        options = links._liwan_context_options('helpdesk.ticket', q=ticket.number)
        self.assertEqual([row['id'] for row in options['items']], [ticket.id])
        self.assertIn(ticket.name, options['items'][0]['name'])
        contexts = links._liwan_dump_contexts(document)
        self.assertEqual(contexts[document.id]['kind'], 'helpdesk.ticket')
        self.assertEqual(contexts[document.id]['href'], f'/helpdesk/{ticket.id}')

    def test_the_ticket_scope_answers_the_desks_own_visibility(self):
        """A ticket's documents follow the desk's visibility, not the library's own policy."""
        ticket, _document = self.ticket_with_document()
        reader = self._member_with_library('helpdesk_documents_reader')
        # The desk's team visibility reaches a ticket through team membership, so the reader joins the team.
        self.team.write({'user_ids': [(4, reader.id)]})
        # A team member reaches the ticket of their team, and the document filed against it.
        self.assertEqual(
            self.env['liwan.document'].with_user(reader)._liwan_ticket_document_ids('read').ids, [ticket.id],
        )
        stranger = self._member_with_library('helpdesk_documents_stranger')
        # The same library right, but no desk membership: the ticket scope gives them no ticket at all.
        self.assertIn('documents.items.read', self.env['liwan.access.service']._liwan_capability_keys(stranger))
        self.assertEqual(self.env['liwan.document'].with_user(stranger)._liwan_ticket_document_ids('read').ids, [])
        # And it never widens what the library's own policy already allows.
        self.assertEqual(
            self.env['liwan.document'].with_user(stranger)._liwan_scope_predicate('read') is None, False,
        )

    @classmethod
    def _member_with_library(cls, login):
        """A user with the library's read right and the desk's read right; team membership decides the tickets."""
        user = new_test_user(
            cls.env, login=login, password=f'{login}_pass_123', name=login, groups='liwan_core.group_employee',
        )
        role = cls.env['liwan.access.role'].create({
            'key': login, 'name_ar': login, 'name_en': login, 'type': 'custom', 'assignable': True,
            'permission_ids': [(6, 0, cls.env['liwan.access.permission'].search([
                ('key', 'in', ['documents.items.read', 'helpdesk.tickets.read']),
            ]).ids)],
        })
        cls.env['liwan.access.service']._liwan_replace_assignments(user, [{
            'role_id': role.id, 'company_id': cls.company.id,
        }])
        return user

    def test_a_context_is_prepared_and_refused_the_same_way_as_a_project(self):
        self.as_user(self.agent)
        ticket, _document = self.ticket_with_document()
        links = self.env['liwan.document.links']
        prepared = links._liwan_prepare_context({'kind': 'helpdesk.ticket', 'id': ticket.id})
        self.assertEqual(prepared, {'helpdesk_ticket_id': ticket.id})
        with self.assertRaises(ApiError) as caught:
            links._liwan_managed_context('helpdesk', 999999999)
        self.assertEqual((caught.exception.status, caught.exception.code), (404, 'not_found'))
