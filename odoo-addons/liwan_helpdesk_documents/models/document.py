# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""A support ticket as a context of the document library.

The document service owns the library and its access policy; it offers "contexts" (a project, a department, an
employee) that a document is filed against, and each context decides which documents it may reach. This bridge
adds the ticket as one more context, scoped by the desk's own visibility: a document filed against a ticket is
readable by whoever reads that ticket, and no wider.
"""
from odoo import api, fields, models
from odoo.tools import SQL

from odoo.addons.liwan_api.controllers.common import ApiError

TICKET_FEATURE = 'helpdesk.enabled'
TICKET_READ = 'helpdesk.tickets.read'


class Document(models.Model):
    _inherit = 'liwan.document'

    helpdesk_ticket_id = fields.Many2one(
        'helpdesk.ticket', string='Support ticket', index=True, ondelete='restrict', copy=False, check_company=True,
    )

    @api.model
    def _liwan_context_fields(self):
        return (*super()._liwan_context_fields(), 'helpdesk_ticket_id')

    @api.model
    def _liwan_ticket_documents(self, *, write):
        """The tickets a document may be filed against, and the domain of that choice.

        Reading the library needs the desk feature and its read capability; filing a document against a ticket is
        the desk's own write right, so a viewer of the library only gets the tickets they may read back.
        """
        entitlement = self.env['liwan.entitlement.service']
        feature = entitlement._liwan_feature_write if write else entitlement._liwan_feature_read
        tickets = self.env['helpdesk.ticket'].with_context(active_test=False)
        domain = [('company_id', '=', self.env.company.id)]
        access = self.env['liwan.access.service']
        capabilities = {TICKET_READ}
        if write:
            capabilities = {'helpdesk.tickets.write'}
        if not feature(TICKET_FEATURE) or not any(
                access._liwan_has_capability(self.env.user, key) for key in capabilities):
            domain.append(('id', '=', False))
        return tickets, domain

    @api.model
    def _liwan_ticket_document_ids(self, operation='read'):
        """The tickets whose documents this user may reach, as the desk's own visibility sees them.

        Empty for a user who cannot read tickets at all: the library may still open a document to them by its own
        policy (a company-wide one or a grant), and this bridge adds no ticket of its own on top of nothing.
        """
        tickets = self.env['helpdesk.ticket'].with_context(active_test=False)
        access = self.env['liwan.access.service']
        if not access._liwan_has_capability(self.env.user, TICKET_READ):
            return tickets.browse()
        feature = self.env['liwan.entitlement.service']
        reader = feature._liwan_feature_write if operation != 'read' else feature._liwan_feature_read
        if not reader(TICKET_FEATURE):
            return tickets.browse()
        return tickets.search([*self.env['liwan.helpdesk.visibility']._liwan_domain()])

    @api.model
    def _liwan_ticket_document_scope(self, operation):
        tickets, domain = self._liwan_ticket_documents(write=operation != 'read')
        if not tickets.has_access('read'):
            return None
        allowed = self._liwan_ticket_document_ids(operation)
        return SQL('d.helpdesk_ticket_id IN (%s)', allowed._search([*domain]).select())

    @api.model
    def _liwan_scope_predicate(self, operation):
        scope = super()._liwan_scope_predicate(operation)
        ticket_scope = self._liwan_ticket_document_scope(operation)
        if scope is None:
            return ticket_scope
        if ticket_scope is None:
            return scope
        return SQL('(%s) OR (%s)', scope, ticket_scope)

    @api.model_create_multi
    def create(self, vals_list):
        if not self.env.user._is_superuser():
            links = self.env['liwan.document.links']
            for vals in vals_list:
                if vals.get('helpdesk_ticket_id'):
                    links._liwan_managed_context('helpdesk', vals['helpdesk_ticket_id'], write=True)
        return super().create(vals_list)


class DocumentLinks(models.AbstractModel):
    _inherit = 'liwan.document.links'

    @api.model
    def _liwan_context_definitions(self):
        entitlement = self.env['liwan.entitlement.service']
        access = self.env['liwan.access.service']
        return (*super()._liwan_context_definitions(), {
            'kind': 'helpdesk.ticket', 'field': 'helpdesk_ticket_id',
            'name_ar': 'تذكرة الدعم', 'name_en': 'Support ticket',
            'available': entitlement._liwan_feature_read(TICKET_FEATURE)
            and access._liwan_has_capability(self.env.user, TICKET_READ),
        })

    @api.model
    def _liwan_context_options(self, kind, q=None, limit=20, offset=0, *, record_id=None):
        if kind != 'helpdesk.ticket':
            return super()._liwan_context_options(kind, q, limit, offset, record_id=record_id)
        tickets, domain = self.env['liwan.document']._liwan_ticket_documents(write=True)
        if not tickets.has_access('read'):
            return {'items': [], 'total': 0}
        domain = [*domain, *self.env['liwan.helpdesk.visibility']._liwan_domain()]
        if q:
            domain += ['|', ('number', 'ilike', q[:200]), ('name', 'ilike', q[:200])]
        if record_id is not None:
            domain.append(('id', '=', record_id))
        found = tickets.search(domain, limit=limit, offset=offset, order='id desc')
        return {
            'items': [{'id': ticket.id, 'name': '%s · %s' % (ticket.number, ticket.name)} for ticket in found],
            'total': tickets.search_count(domain),
        }

    @api.model
    def _liwan_managed_context_features(self):
        return (*super()._liwan_managed_context_features(), TICKET_FEATURE)

    @api.model
    def _liwan_managed_context(self, kind, subject_id, *, write=False):
        if kind != 'helpdesk':
            return super()._liwan_managed_context(kind, subject_id, write=write)
        self._liwan_require_context_feature(TICKET_FEATURE, write=write)
        self.env['liwan.access.service']._liwan_require_capability('helpdesk.tickets.write')
        tickets, domain = self.env['liwan.document']._liwan_ticket_documents(write=write)
        ticket = tickets.search([
            *domain, *self.env['liwan.helpdesk.visibility']._liwan_domain(), ('id', '=', subject_id),
        ], limit=1)
        if not ticket:
            raise ApiError(404, 'not_found', 'Document context not found.')
        return 'helpdesk.ticket', [('helpdesk_ticket_id', '=', ticket.id)]

    @api.model
    def _liwan_prepare_context(self, context):
        if context and context.get('kind') == 'helpdesk.ticket':
            _, domain = self._liwan_managed_context('helpdesk', context['id'], write=True)
            return {'helpdesk_ticket_id': domain[0][2]}
        return super()._liwan_prepare_context(context)

    @api.model
    def _liwan_dump_contexts(self, documents):
        contexts = super()._liwan_dump_contexts(documents)
        for document in documents:
            ticket = document.helpdesk_ticket_id
            if ticket:
                contexts[document.id] = {
                    'kind': 'helpdesk.ticket', 'id': ticket.id,
                    'label': '%s · %s' % (ticket.number, ticket.name),
                    'href': f'/helpdesk/{ticket.id}',
                }
        return contexts
