# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The customer's page: a ticket read and answered under its own access token, never a session.

A ticket that a customer contact owns gets a token when the company asks for the customer page. The
token is the only authorization, compared in constant time; the route reads the row elevated because
the public user holds no ACL on a ticket, and the tenant's company tree bounds what it may read. A
wrong token and a missing ticket answer the same 404, so the page never tells one from the other.
"""
import secrets

from odoo import api, models
from odoo.exceptions import MissingError
from odoo.tools import consteq

from odoo.addons.liwan_api.serializers.common import iso
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule

MAX_TOKEN_LENGTH = 64
INVALID = 'invalid'
MISSING = 'Record does not exist'
TOKEN_FIELD = 'liwan_portal_token'
CLOSED_STAGES = 'closed'


class LiwanHelpdeskPortal(models.AbstractModel):
    _name = 'liwan.helpdesk.portal'
    _description = 'LiwanOS Support Desk customer page'
    _liwan_scope = 'global'

    @api.model
    def _liwan_issue_token(self, ticket):
        """Give the ticket its customer token (created once, stable afterwards)."""
        if not ticket[TOKEN_FIELD]:
            ticket.write({TOKEN_FIELD: secrets.token_urlsafe(32)})
        return ticket[TOKEN_FIELD]

    @api.model
    def _liwan_open_by_id(self, ticket_id, token):
        ticket = self._liwan_ticket(ticket_id, token)
        self._liwan_require_enabled(ticket)
        return self._liwan_dump(ticket)

    @api.model
    def _liwan_ticket(self, ticket_id, token):
        """The ticket of ``ticket_id`` when ``token`` is its own, in this tenant, else :class:`MissingError`."""
        supplied = token if isinstance(token, str) and len(token) <= MAX_TOKEN_LENGTH else ''
        # The public user holds no ACL on a ticket: the token is the only authorization and can be compared
        # only after the row is read.
        ticket = self.env['helpdesk.ticket'].sudo().search([('id', '=', ticket_id)])
        expected = ticket[TOKEN_FIELD] or ''
        matches = consteq(expected.encode(), supplied.encode())
        if not (ticket and supplied and matches):
            raise MissingError(self.env._(MISSING))
        if not self._liwan_in_tenant(ticket.company_id):
            raise MissingError(self.env._(MISSING))
        return ticket.with_company(ticket.company_id).with_context(active_test=True)

    @api.model
    def _liwan_in_tenant(self, company):
        profile = self.env['liwan.entitlement.service']._liwan_profile()
        root = profile.root_company_id
        return bool(root) and (company == root or company.parent_path.startswith(root.parent_path))

    @api.model
    def _liwan_open(self, ticket, token):
        """The customer's answer: the ticket with its public thread, and the actions its state allows."""
        ticket = self._liwan_ticket(ticket.id, token)
        self._liwan_require_enabled(ticket)
        return self._liwan_dump(ticket)

    @api.model
    def _liwan_link(self, ticket):
        """The customer's absolute link, for an agent who may write the ticket; None while the page is off."""
        self._liwan_require_enabled(ticket)
        base = self.env['ir.config_parameter'].sudo().get_param('web.base.url', '').rstrip('/')
        return '%s/support/%s?token=%s' % (base, ticket.id, self._liwan_issue_token(ticket))

    @api.model
    def _liwan_require_enabled(self, ticket):
        """The page exists only while the tenant carries both the application and the customer page.

        Read with the platform's own reader (not the raw payload), so an unset key counts as absent, and a
        closed one answers the same 404 as a wrong token.
        """
        service = self.env['liwan.entitlement.service'].with_company(ticket.company_id)
        for key in ('helpdesk.enabled', 'helpdesk.portal'):
            try:
                service.require_read(key)
            except LiwanAccessRule as error:
                raise MissingError(self.env._(MISSING)) from error

    def _liwan_dump(self, ticket):
        messages = self.env['mail.message'].sudo().search([
            ('model', '=', 'helpdesk.ticket'), ('res_id', '=', ticket.id), ('message_type', '=', 'comment'),
            ('subtype_id.internal', '=', False),
        ], order='date asc, id asc')
        return {
            'number': ticket.number,
            'subject': ticket.name,
            'description': ticket.description or '',
            'stage': {'name': ticket.stage_id.name, 'closed': bool(ticket.stage_id.closed)},
            'priority': ticket.priority,
            'created_at': iso(ticket.create_date),
            'closed_at': iso(ticket.closed_date),
            'company': {'name': ticket.company_id.name, 'logo': bool(ticket.company_id.logo)},
            'messages': [
                {'id': message.id, 'body': message.body or '', 'author': message.author_id.display_name or '',
                 'created_at': iso(message.date)}
                for message in messages
            ],
            'actions': {
                'reply': not ticket.stage_id.closed,
                'close': not ticket.stage_id.closed,
                'reopen': bool(ticket.stage_id.closed),
            },
        }

    @api.model
    def _liwan_reply(self, ticket_id, token, body):
        ticket = self._liwan_ticket(ticket_id, token)
        self._liwan_require_enabled(ticket)
        text = body.strip() if isinstance(body, str) else ''
        if not text or len(text) > 5000:
            raise LiwanAccessRule(INVALID, self.env._('body is required and at most 5000 characters'), field='body', status=422)
        if ticket.stage_id.closed:
            raise LiwanAccessRule(INVALID, self.env._('the ticket is closed'), field='body', status=422)
        ticket.message_post(
            body=text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('\n', '<br>'),
            message_type='comment', subtype_xmlid='mail.mt_comment',
            author_id=ticket.partner_id.id or ticket.create_uid.partner_id.id,
        )
        # A customer's answer reopens a ticket that was waiting on them.
        if ticket.stage_id.unattended:
            open_stage = ticket.team_id._get_applicable_stages().filtered(lambda stage: not stage.closed)[:1]
            if open_stage:
                ticket.write({'stage_id': open_stage.id})
        return self._liwan_dump(ticket)

    @api.model
    def _liwan_close(self, ticket_id, token):
        ticket = self._liwan_ticket(ticket_id, token)
        self._liwan_require_enabled(ticket)
        if ticket.stage_id.closed:
            raise LiwanAccessRule(INVALID, self.env._('the ticket is already closed'), status=422)
        closed = ticket.team_id._get_applicable_stages().filtered(lambda stage: stage.closed)[:1]
        if not closed:
            raise LiwanAccessRule(INVALID, self.env._('the team has no closed stage'), status=422)
        ticket.write({'stage_id': closed.id})
        return self._liwan_dump(ticket)
