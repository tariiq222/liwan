# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The Support Desk operations behind every route.

One service decides who may create, change, assign, close, reopen and answer a ticket, so the API and
the tests share the same rules. Every operation checks its capability, the working company, the record
visibility and the tenant settings before it writes; a refusal is a ``LiwanAccessRule`` with the HTTP
status the client reads (403 forbidden, 404 not found, 409 conflict, 422 invalid).

Nothing here duplicates the OCA engine: the ticket, its stages, the team's working calendar, the SLA
deadlines and the mail thread stay the engine's. The service adds the application's own facts (the
internal requester, the first response, related tickets) and the transitions that need a policy.
"""
from datetime import timedelta

from odoo import api, fields, models
from odoo.fields import Domain
from odoo.tools import html2plaintext, plaintext2html

from .access_service import ASSIGN, CLOSE, READ, REQUESTS_CREATE, REQUESTS_READ, WRITE
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule

MAX_SUBJECT = 200
MAX_DESCRIPTION = 20000
MAX_COMMENT = 5000
PRIORITIES = ('0', '1', '2', '3')
ASSIGNED_KIND = 'helpdesk.assigned'
NOT_FOUND = 'not_found'
FORBIDDEN = 'forbidden'
INVALID = 'invalid'
CONFLICT = 'conflict'


def forbidden(message='forbidden'):
    return LiwanAccessRule(FORBIDDEN, message, status=403)


def invalid(message, field=None):
    return LiwanAccessRule(INVALID, message, field=field, status=422)


class LiwanHelpdeskService(models.AbstractModel):
    _name = 'liwan.helpdesk.service'
    _description = 'LiwanOS Support Desk operations'
    _liwan_scope = 'global'

    # ------------------------------------------------------------------ helpers

    @api.model
    def _liwan_settings(self, company=None):
        return self.env['liwan.helpdesk.settings']._liwan_for(company or self.env.company)

    @api.model
    def _liwan_keys(self, company=None):
        return self.env['liwan.access.service']._liwan_capability_keys(
            self.env.user, company=company or self.env.company,
        )

    @api.model
    def _liwan_require(self, *capabilities, match='any', company=None):
        keys = self._liwan_keys(company)
        allowed = any(key in keys for key in capabilities) if match == 'any' else all(
            key in keys for key in capabilities)
        if not allowed:
            raise forbidden()

    @api.model
    def _liwan_visible(self, ticket_id, *capabilities):
        """The ticket, when the caller may read it; 404 for a hidden or missing one alike."""
        self._liwan_require(*capabilities or (READ, REQUESTS_READ))
        domain = Domain('id', '=', ticket_id) & self.env['liwan.helpdesk.visibility']._liwan_domain()
        ticket = self.env['helpdesk.ticket'].search(domain, limit=1)
        if not ticket:
            raise LiwanAccessRule(NOT_FOUND, 'Ticket does not exist', status=404)
        return ticket

    @api.model
    def _liwan_reference(self, model, record_id, label):
        """A tenant reference row (team, category, type, channel, tag), visible in the working company."""
        record = self.env[model].search([
            ('id', '=', record_id),
            '|', ('company_id', '=', False), ('company_id', '=', self.env.company.id),
        ], limit=1)
        if not record:
            raise invalid(self.env._('%s does not exist') % label, field='%s_id' % label)
        return record

    @api.model
    def _liwan_assignee(self, user_id):
        user = self.env['res.users'].search([('id', '=', user_id), ('share', '=', False)], limit=1)
        if not user or self.env.company not in user.company_ids:
            raise invalid(self.env._('the assignee is not an internal user of the company'), field='assignee_id')
        return user

    @api.model
    def _liwan_stage_for(self, ticket, stage_id):
        stage = self.env['helpdesk.ticket.stage'].search([
            ('id', '=', stage_id),
            '|', ('company_id', '=', False), ('company_id', '=', ticket.company_id.id),
        ], limit=1)
        if not stage:
            raise invalid(self.env._('the stage does not exist'), field='stage_id')
        if ticket.team_id and stage.team_ids and ticket.team_id not in stage.team_ids:
            raise invalid(self.env._('the stage does not belong to the ticket team'), field='stage_id')
        return stage

    @api.model
    def _liwan_default_stage(self, team, *, closed=False):
        stages = team._get_applicable_stages() if team else self.env['helpdesk.ticket.stage'].search(
            [('company_id', 'in', [False, self.env.company.id])], order='sequence, id')
        stage = stages.filtered(lambda item: item.closed == closed)[:1]
        if not stage:
            raise invalid(
                'the team has no %s stage' % ('closed' if closed else 'open'),
                field='stage_id',
            )
        return stage

    @api.model
    def _liwan_notify(self, ticket, user, body, key):
        if not user or user == self.env.user or not user.partner_id:
            return
        self.env['liwan.notify.service']._liwan_deliver(
            ticket._name, ticket.id, ASSIGNED_KIND, user.partner_id, body, key=key,
            values={'subject': ticket.display_name},
        )

    # ------------------------------------------------------------------ create

    @api.model
    def _liwan_create(self, values):
        """Create a ticket from an agent (on behalf of somebody) or an employee (their own request)."""
        company = self.env.company
        keys = self._liwan_keys(company)
        agent = WRITE in keys
        requester = REQUESTS_CREATE in keys
        if not agent and not requester:
            raise forbidden()
        settings = self._liwan_settings(company)
        subject = values.get('subject')
        if not isinstance(subject, str) or not subject.strip() or len(subject.strip()) > MAX_SUBJECT:
            raise invalid(self.env._('subject is required and at most %d characters' % MAX_SUBJECT), field='subject')
        description = values.get('description')
        if not isinstance(description, str) or not description.strip() or len(description) > MAX_DESCRIPTION:
            raise invalid(self.env._('description is required and at most %d characters' % MAX_DESCRIPTION),
                          field='description')
        if values.get('customer_id') and not agent:
            raise forbidden(self.env._('only an agent opens a ticket for a customer'))
        if values.get('assignee_id') and not ASSIGN in keys:
            raise forbidden(self.env._('assigning the ticket to somebody needs the assign capability'))
        team = self._liwan_reference('helpdesk.ticket.team', values['team_id'], 'team') \
            if values.get('team_id') else settings.default_team_id
        if not team:
            raise invalid(self.env._('a ticket needs a team'), field='team_id')
        ticket_values = {
            'name': subject.strip(),
            'description': plaintext2html(description.strip()),
            'company_id': company.id,
            'team_id': team.id,
            'stage_id': self._liwan_default_stage(team).id,
            'priority': values.get('priority') or settings.default_priority,
            'channel_id': self._liwan_reference('helpdesk.ticket.channel', values['channel_id'],
                                                'channel').id if values.get('channel_id') else False,
        }
        if values.get('category_id'):
            ticket_values['category_id'] = self._liwan_reference(
                'helpdesk.ticket.category', values['category_id'], 'category').id
        if values.get('type_id'):
            ticket_values['type_id'] = self._liwan_reference('helpdesk.ticket.type', values['type_id'],
                                                             'type').id
        if values.get('tag_ids'):
            tags = self.env['helpdesk.ticket.tag'].browse(values['tag_ids']).exists()
            if len(tags) != len(values['tag_ids']):
                raise invalid(self.env._('a tag does not exist'), field='tag_ids')
            ticket_values['tag_ids'] = [(6, 0, tags.ids)]
        if values.get('customer_id'):
            partner = self.env['liwan.customers.service']._liwan_resolve(customer_id=values['customer_id'])
            ticket_values['partner_id'] = partner.id
        else:
            ticket_values['partner_id'] = self.env.user.partner_id.id
            ticket_values['liwan_requester_user_id'] = self.env.user.id
        # An agent takes the ticket they open; a request waits for whoever dispatches it.
        assignee = None
        if agent:
            assignee = self._liwan_assignee(values['assignee_id']) if values.get('assignee_id') else self.env.user
        ticket_values['user_id'] = assignee.id if assignee else False
        ticket = self.env['helpdesk.ticket'].create(ticket_values)
        if ticket.user_id:
            self._liwan_notify(ticket, ticket.user_id, self.env._(
                '%(actor)s assigned you the ticket %(ticket)s',
                actor=self.env.user.name, ticket=ticket.display_name), key='%s:%s:%s' % (
                    ASSIGNED_KIND, ticket.id, ticket.user_id.partner_id.id))
        return ticket

    # ------------------------------------------------------------------ change

    @api.model
    def _liwan_update(self, ticket, values):
        self._liwan_require(WRITE)
        keys = self._liwan_keys()
        changes = {}
        if 'subject' in values:
            subject = values['subject']
            if not isinstance(subject, str) or not subject.strip() or len(subject.strip()) > MAX_SUBJECT:
                raise invalid(self.env._('subject is required and at most %d characters' % MAX_SUBJECT), field='subject')
            changes['name'] = subject.strip()
        if 'description' in values:
            description = values['description']
            if not isinstance(description, str) or not description.strip() or len(description) > MAX_DESCRIPTION:
                raise invalid(self.env._('description is required and at most %d characters' % MAX_DESCRIPTION),
                              field='description')
            changes['description'] = plaintext2html(description.strip())
        if 'priority' in values:
            if values['priority'] not in PRIORITIES:
                raise invalid(self.env._('unknown priority'), field='priority')
            changes['priority'] = values['priority']
        for name, model, field in (
            ('category_id', 'helpdesk.ticket.category', 'category'),
            ('type_id', 'helpdesk.ticket.type', 'type'),
            ('channel_id', 'helpdesk.ticket.channel', 'channel'),
            ('team_id', 'helpdesk.ticket.team', 'team'),
        ):
            if name not in values:
                continue
            if name == 'team_id' and ASSIGN not in keys:
                raise forbidden(self.env._('moving the ticket to another team needs the assign capability'))
            changes[name] = self._liwan_reference(model, values[name], field).id if values[name] else False
        if 'tag_ids' in values:
            tags = self.env['helpdesk.ticket.tag'].browse(values['tag_ids']).exists()
            if len(tags) != len(values['tag_ids']):
                raise invalid(self.env._('a tag does not exist'), field='tag_ids')
            changes['tag_ids'] = [(6, 0, tags.ids)]
        if 'assignee_id' in values:
            if ASSIGN not in keys:
                raise forbidden(self.env._('assigning the ticket needs the assign capability'))
            changes['user_id'] = self._liwan_assignee(values['assignee_id']).id if values['assignee_id'] else False
        if 'related_ids' in values:
            related = self.env['helpdesk.ticket'].search([
                ('id', 'in', values['related_ids']), ('id', '!=', ticket.id),
                ('company_id', '=', ticket.company_id.id),
            ])
            if len(related) != len(set(values['related_ids'])):
                raise invalid(self.env._('a related ticket does not exist'), field='related_ids')
            changes['liwan_related_ticket_ids'] = [(6, 0, related.ids)]
        if not changes:
            return ticket
        previous_assignee = ticket.user_id
        ticket.write(changes)
        if 'user_id' in changes and ticket.user_id and ticket.user_id != previous_assignee:
            self._liwan_notify(ticket, ticket.user_id, self.env._(
                '%(actor)s assigned you the ticket %(ticket)s',
                actor=self.env.user.name, ticket=ticket.display_name), key='%s:%s:%s' % (
                    ASSIGNED_KIND, ticket.id, ticket.user_id.partner_id.id))
        return ticket

    @api.model
    def _liwan_assign(self, ticket, user_id):
        """Assign to somebody (``user_id``) or release the ticket (``None``)."""
        self._liwan_require(ASSIGN)
        if user_id is None:
            ticket.write({'user_id': False})
            return ticket
        user = self._liwan_assignee(user_id)
        if ticket.user_id != user:
            ticket.write({'user_id': user.id})
            self._liwan_notify(ticket, user, self.env._(
                '%(actor)s assigned you the ticket %(ticket)s',
                actor=self.env.user.name, ticket=ticket.display_name), key='%s:%s:%s' % (
                    ASSIGNED_KIND, ticket.id, user.partner_id.id))
        return ticket

    @api.model
    def _liwan_move_stage(self, ticket, stage_id):
        self._liwan_require(WRITE)
        stage = self._liwan_stage_for(ticket, stage_id)
        ticket.write({'stage_id': stage.id})
        return ticket

    @api.model
    def _liwan_close(self, ticket):
        self._liwan_require(CLOSE)
        if ticket.stage_id.closed:
            raise LiwanAccessRule(CONFLICT, 'the ticket is already closed', status=409)
        ticket.write({'stage_id': self._liwan_default_stage(ticket.team_id, closed=True).id})
        return ticket

    @api.model
    def _liwan_reopen(self, ticket):
        self._liwan_require(CLOSE)
        if not ticket.stage_id.closed:
            raise LiwanAccessRule(CONFLICT, 'the ticket is not closed', status=409)
        days = self._liwan_settings(ticket.company_id).reopen_days
        closed_at = ticket.closed_date or ticket.write_date
        if days and closed_at and fields.Datetime.now() - closed_at > timedelta(days=days):
            raise invalid(self.env._('the ticket can no longer be reopened'))
        ticket.write({'stage_id': self._liwan_default_stage(ticket.team_id).id})
        return ticket

    @api.model
    def _liwan_comment(self, ticket, body, internal=False):
        """Post a public reply or an internal note; the requester may answer their own ticket."""
        keys = self._liwan_keys(ticket.company_id)
        agent = WRITE in keys
        own_request = (
            REQUESTS_READ in keys and ticket.liwan_requester_user_id == self.env.user
        )
        if not agent and not own_request:
            raise forbidden()
        if internal and not agent:
            raise forbidden(self.env._('only an agent writes an internal note'))
        text = body.strip() if isinstance(body, str) else ''
        if not text or len(text) > MAX_COMMENT:
            raise invalid(self.env._('body is required and at most %d characters' % MAX_COMMENT), field='body')
        subtype = 'mail.mt_note' if internal else 'mail.mt_comment'
        ticket.message_post(
            body=plaintext2html(text), message_type='comment', subtype_xmlid=subtype,
            author_id=self.env.user.partner_id.id,
        )
        if agent and not internal and not ticket.liwan_first_response_at:
            ticket.write({'liwan_first_response_at': fields.Datetime.now()})
        return ticket

    # ------------------------------------------------------------------ read helpers

    @api.model
    def _liwan_description(self, ticket):
        return html2plaintext(ticket.description or '')
