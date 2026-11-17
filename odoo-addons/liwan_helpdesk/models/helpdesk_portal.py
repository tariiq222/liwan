# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The customer's page: a ticket read and answered under its own access token, never a session.

A ticket gets a token when the desk creates it. The token is the only authorization, compared in constant
time; the routes read the row elevated because the public user holds no ACL on a ticket, and the tenant's
company tree bounds what may be read. A wrong token, a ticket of another tenant, a closed page and a missing
ticket all answer the same 404, so the page never tells one from the other.
"""
import secrets

from odoo import api, models
from odoo.exceptions import MissingError
from odoo.tools import consteq

from odoo.addons.liwan_api.serializers.common import iso
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule

MAX_TOKEN_LENGTH = 64
TOKEN_FIELD = 'liwan_portal_token'
ONE_TICKET = 1
INVALID = 'invalid'
MISSING = 'Record does not exist'
PAGE_FEATURES = ('helpdesk.enabled', 'helpdesk.portal')
MAX_BODY = 5000


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
    def _liwan_ticket(self, ticket_id, token):
        """The ticket of ``ticket_id`` when ``token`` is its own and it is in this tenant, else :class:`MissingError`."""
        supplied = token if isinstance(token, str) and len(token) <= MAX_TOKEN_LENGTH else ''
        # The public user holds no ACL on a ticket: the token is the only authorization, and it can be compared
        # only after the row is read.
        ticket = self.env['helpdesk.ticket'].sudo().search([('id', '=', ticket_id)])
        expected = ticket[TOKEN_FIELD] or ''
        matches = consteq(expected.encode(), supplied.encode())
        if not (ticket and supplied and matches) or not self._liwan_in_tenant(ticket.company_id):
            raise MissingError(self.env._(MISSING))
        return ticket.with_company(ticket.company_id).with_context(active_test=True)

    @api.model
    def _liwan_in_tenant(self, company):
        """Whether ``company`` is the tenant's root company or one of its branches."""
        root = self.env['liwan.entitlement.service']._liwan_profile().root_company_id
        return bool(root) and (company == root or company.parent_path.startswith(root.parent_path))

    @api.model
    def _liwan_open_by_id(self, ticket_id, token):
        """The page of one ticket, for its own token."""
        ticket = self._liwan_ticket(ticket_id, token)
        self._liwan_require_enabled(ticket)
        return self._liwan_dump(ticket)

    @api.model
    def _liwan_link(self, ticket):
        """The customer's absolute link, for an agent who may write the ticket.

        A ticket created before the token column existed gets one here; the route that reads the page never writes.
        """
        self._liwan_require_enabled(ticket)
        base = self.env['ir.config_parameter'].sudo().get_param('web.base.url', '').rstrip('/')
        token = ticket[TOKEN_FIELD] or self._liwan_issue_token(ticket)
        return '%s/support/%s?token=%s' % (base, ticket.id, token)

    @api.model
    def _liwan_require_enabled(self, ticket):
        """The page exists while the tenant carries the application and its page and the company keeps it on.

        The entitlement keys are read with the platform's own reader (not the raw payload), so an unset key counts
        as absent; the company switch is the tenant's own policy, read elevated because the public user holds no ACL
        on the settings table and only that boolean leaves. Either refusal is the same 404 as a wrong token.
        """
        service = self.env['liwan.entitlement.service'].with_company(ticket.company_id)
        for key in PAGE_FEATURES:
            try:
                service.require_read(key)
            except LiwanAccessRule as error:
                raise MissingError(self.env._(MISSING)) from error
        settings = self.env['liwan.helpdesk.settings'].sudo().search(
            [('company_id', '=', ticket.company_id.id)], limit=ONE_TICKET,
        )
        if settings and not settings.portal_enabled:
            raise MissingError(self.env._(MISSING))

    def _liwan_dump(self, ticket):
        """The page as the customer reads it: the request, the public thread and the actions its state allows."""
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
            },
        }

    @api.model
    def _liwan_reply(self, ticket_id, token, body):
        """The customer's answer: a public comment on the ticket, which reopens it when it was waiting on them."""
        ticket = self._liwan_ticket(ticket_id, token)
        self._liwan_require_enabled(ticket)
        text = body.strip() if isinstance(body, str) else ''
        if not text or len(text) > MAX_BODY:
            raise LiwanAccessRule(
                INVALID, self.env._('body is required and at most %(max)s characters', max=MAX_BODY),
                field='body', status=422,
            )
        if ticket.stage_id.closed:
            raise LiwanAccessRule(INVALID, self.env._('the ticket is closed'), field='body', status=422)
        ticket.message_post(
            body=text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('\n', '<br>'),
            message_type='comment', subtype_xmlid='mail.mt_comment',
            author_id=ticket.partner_id.id or ticket.create_uid.partner_id.id,
        )
        if ticket.stage_id.unattended:
            open_stage = ticket.team_id._get_applicable_stages().filtered(lambda stage: not stage.closed)[:1]
            if open_stage:
                ticket.write({'stage_id': open_stage.id})
        return self._liwan_dump(ticket)

    @api.model
    def _liwan_close(self, ticket_id, token):
        """The customer closes the ticket."""
        ticket = self._liwan_ticket(ticket_id, token)
        self._liwan_require_enabled(ticket)
        if ticket.stage_id.closed:
            raise LiwanAccessRule(INVALID, self.env._('the ticket is already closed'), status=422)
        closed = ticket.team_id._get_applicable_stages().filtered(lambda stage: stage.closed)[:1]
        if not closed:
            raise LiwanAccessRule(INVALID, self.env._('the team has no closed stage'), status=422)
        ticket.write({'stage_id': closed.id})
        return self._liwan_dump(ticket)
