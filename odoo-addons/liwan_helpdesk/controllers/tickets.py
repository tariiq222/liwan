# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""``/api/v1/helpdesk/tickets``: the ticket list, one ticket, its transitions and its thread."""
from odoo import http
from odoo.fields import Domain
from odoo.http import request

from odoo.addons.liwan_api.controllers.attachment_download import (
    download_linked_attachment,
)
from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    parse_page,
    parse_positive_int,
    require_capabilities,
    requires_capability,
    requires_feature,
)
from odoo.addons.liwan_api.serializers.attachment import parse_attachment_upload
from odoo.addons.liwan_api.serializers.common import iso
from odoo.addons.liwan_helpdesk.models.access_service import (
    ASSIGN,
    CLOSE,
    MERGE,
    READ,
    REQUESTS_CREATE,
    REQUESTS_READ,
    WRITE,
)
from odoo.addons.liwan_helpdesk.serializers.ticket import (
    PRIORITIES,
    dump_row,
    dump_ticket,
    parse_comment,
    parse_create,
    parse_update,
)

MAX_QUERY = 200
ATTACHMENT_MODEL = 'helpdesk.ticket'


def service():
    return request.env['liwan.helpdesk.service']


def body(allowed=None):
    payload = request.get_json_data()
    if not isinstance(payload, dict) or (allowed is not None and set(payload) - allowed):
        raise ApiError(422, 'invalid', 'Invalid request fields.')
    return payload


def settings():
    return request.env['liwan.helpdesk.settings']._liwan_for(request.env.company)


def can_read_type():
    return READ in request.env['liwan.access.service']._liwan_capability_keys(request.env.user)


def find(ticket_id, *capabilities):
    """The ticket the caller may read, or the capability the action needs."""
    return service()._liwan_visible(ticket_id, *capabilities)


def list_domain(args):
    """The domain of the list filters; every choice is validated, an unknown value is a 422."""
    domain = []
    state = args.get('state', 'open')
    if state not in ('open', 'closed', 'all'):
        raise ApiError(422, 'invalid', 'Invalid ticket state.', field='state')
    if state != 'all':
        domain.append(('stage_id.closed', '=', state == 'closed'))
    if args.get('team'):
        domain.append(('team_id', '=', parse_positive_int(args['team'], 'team')))
    if args.get('stage'):
        domain.append(('stage_id', '=', parse_positive_int(args['stage'], 'stage')))
    if args.get('category'):
        domain.append(('category_id', '=', parse_positive_int(args['category'], 'category')))
    if args.get('type'):
        domain.append(('type_id', '=', parse_positive_int(args['type'], 'type')))
    if args.get('channel'):
        domain.append(('channel_id', '=', parse_positive_int(args['channel'], 'channel')))
    if args.get('tag'):
        domain.append(('tag_ids', 'in', [parse_positive_int(args['tag'], 'tag')]))
    if args.get('priority'):
        if args['priority'] not in PRIORITIES.values():
            raise ApiError(422, 'invalid', 'Invalid priority.', field='priority')
        domain.append(('priority', '=', {name: key for key, name in PRIORITIES.items()}[args['priority']]))
    assignee = args.get('assignee')
    if assignee == 'me':
        domain.append(('user_id', '=', request.env.user.id))
    elif assignee == 'none':
        domain.append(('user_id', '=', False))
    elif assignee:
        domain.append(('user_id', '=', parse_positive_int(assignee, 'assignee')))
    if args.get('sla') == 'overdue':
        domain.append(('sla_expired', '=', True))
    elif args.get('sla'):
        raise ApiError(422, 'invalid', 'Invalid SLA filter.', field='sla')
    if args.get('q'):
        text = args['q'][:MAX_QUERY]
        domain += ['|', '|', ('number', 'ilike', text), ('name', 'ilike', text),
                   ('partner_id.display_name', 'ilike', text)]
    return domain


class HelpdeskTicketsController(http.Controller):

    @http.route('/api/v1/helpdesk/tickets', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('helpdesk.enabled', operation='read')
    @requires_capability(READ, REQUESTS_READ, match='any')
    def list_tickets(self, **_):
        require_capabilities(READ, REQUESTS_READ, match='any')
        args = request.httprequest.args
        limit, offset = parse_page(args)
        domain = Domain.AND([
            request.env['liwan.helpdesk.visibility']._liwan_domain(), Domain(list_domain(args)),
        ])
        model = request.env['helpdesk.ticket']
        tickets = model.search(domain, limit=limit, offset=offset, order='priority desc, create_date desc, id desc')
        rows = [dump_row(ticket, settings(), can_read_type()) for ticket in tickets]
        return {'items': rows, 'total': model.search_count(domain)}

    @http.route('/api/v1/helpdesk/tickets/<int:ticket_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('helpdesk.enabled', operation='read')
    @requires_capability(READ, REQUESTS_READ, match='any')
    def get_ticket(self, ticket_id, **_):
        ticket = find(ticket_id)
        return {**dump_ticket(ticket, settings(), can_read_type()), 'attachments': attachments(ticket)}

    @http.route('/api/v1/helpdesk/tickets', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('helpdesk.enabled')
    def create_ticket(self, **_):
        require_capabilities(WRITE, REQUESTS_CREATE, match='any')
        values = parse_create(body())
        ticket = service()._liwan_create(values)
        return dump_ticket(ticket, settings(), can_read_type())

    @http.route('/api/v1/helpdesk/tickets/<int:ticket_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('helpdesk.enabled')
    @requires_capability(READ, REQUESTS_READ, match='any')
    def update_ticket(self, ticket_id, **_):
        ticket = find(ticket_id, READ)
        values = parse_update(body())
        service()._liwan_update(ticket, values)
        return dump_ticket(ticket, settings(), can_read_type())

    @http.route('/api/v1/helpdesk/tickets/<int:ticket_id>/<string:action>', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('helpdesk.enabled')
    @requires_capability(READ, REQUESTS_READ, match='any')
    def ticket_action(self, ticket_id, action, **_):
        if action == 'assign':
            payload = body({'assignee_id'})
            ticket = find(ticket_id, ASSIGN)
            assignee = payload.get('assignee_id')
            if assignee is not None:
                assignee = parse_positive_int(assignee, 'assignee_id')
            return dump_ticket(service()._liwan_assign(ticket, assignee), settings(), can_read_type())
        if action == 'stage':
            payload = body({'stage_id'})
            ticket = find(ticket_id, WRITE)
            stage_id = parse_positive_int(payload.get('stage_id'), 'stage_id')
            return dump_ticket(service()._liwan_move_stage(ticket, stage_id), settings(), can_read_type())
        if action == 'close':
            body(set())
            return dump_ticket(service()._liwan_close(find(ticket_id, CLOSE)), settings(), can_read_type())
        if action == 'reopen':
            body(set())
            return dump_ticket(service()._liwan_reopen(find(ticket_id, CLOSE)), settings(), can_read_type())
        raise ApiError(404, 'not_found', 'Unknown ticket action.')

    @http.route('/api/v1/helpdesk/tickets/<int:ticket_id>/merge', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('helpdesk.enabled', 'helpdesk.merge')
    @requires_capability(MERGE)
    def merge_tickets(self, ticket_id, **_):
        payload = body({'source_ids'})
        source_ids = payload.get('source_ids')
        if not isinstance(source_ids, list):
            raise ApiError(422, 'invalid', 'must be a list of ticket ids', field='source_ids')
        target = find(ticket_id, MERGE)
        service()._liwan_merge(target, source_ids)
        return dump_ticket(target, settings(), can_read_type())

    @http.route('/api/v1/helpdesk/tickets/<int:ticket_id>/messages', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('helpdesk.enabled', operation='read')
    @requires_capability(READ, REQUESTS_READ, match='any')
    def list_messages(self, ticket_id, **_):
        ticket = find(ticket_id, READ, REQUESTS_READ)
        messages = request.env['mail.message'].search([
            ('model', '=', ATTACHMENT_MODEL), ('res_id', '=', ticket.id), ('message_type', '=', 'comment'),
        ], order='date asc, id asc')
        return {'items': [dump_message(message) for message in messages], 'total': len(messages)}

    @http.route('/api/v1/helpdesk/tickets/<int:ticket_id>/messages', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('helpdesk.enabled')
    @requires_capability(READ, REQUESTS_READ, match='any')
    def post_message(self, ticket_id, **_):
        ticket = find(ticket_id, READ, REQUESTS_READ)
        payload = parse_comment(body())
        service()._liwan_comment(ticket, payload['body'], internal=payload['internal'])
        return {'items': [dump_message(message) for message in request.env['mail.message'].search([
            ('model', '=', ATTACHMENT_MODEL), ('res_id', '=', ticket.id), ('message_type', '=', 'comment'),
        ], order='date asc, id asc')]}

    # ---------------------------------------------------------------- attachments

    @http.route('/api/v1/helpdesk/tickets/<int:ticket_id>/attachments', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('helpdesk.enabled', operation='read')
    @requires_capability(READ, REQUESTS_READ, match='any')
    def list_attachments(self, ticket_id, **_):
        items = attachments(find(ticket_id, READ))
        return {'items': items, 'total': len(items)}

    @http.route('/api/v1/helpdesk/tickets/<int:ticket_id>/attachments', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('helpdesk.enabled')
    @requires_capability(READ, REQUESTS_READ, match='any')
    def upload_attachment(self, ticket_id, **_):
        ticket = find(ticket_id, READ, REQUESTS_READ)
        service()._liwan_require(WRITE, REQUESTS_CREATE)
        values = parse_attachment_upload(body({'name', 'mimetype', 'data'}))
        request.env['ir.attachment'].create({
            'name': values['name'], 'raw': values['raw'], 'mimetype': values['mimetype'],
            'public': False, 'res_model': ATTACHMENT_MODEL, 'res_id': ticket.id, 'type': 'binary',
        })
        return {'items': attachments(ticket)}

    @http.route('/api/v1/helpdesk/tickets/<int:ticket_id>/attachments/<int:attachment_id>', type='json2', auth='user', methods=['DELETE'], readonly=False)
    @api_handler
    @requires_feature('helpdesk.enabled')
    @requires_capability(READ, REQUESTS_READ, match='any')
    def delete_attachment(self, ticket_id, attachment_id, **_):
        ticket = find(ticket_id, READ, REQUESTS_READ)
        service()._liwan_require(WRITE)
        attachment = ticket_attachments(ticket).filtered(lambda item: item.id == attachment_id)
        if not attachment:
            raise ApiError(404, 'not_found', 'Attachment not found.')
        attachment.unlink()
        return {'items': attachments(ticket)}

    @http.route('/api/v1/helpdesk/tickets/<int:ticket_id>/attachments/<int:attachment_id>/download', type='http', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('helpdesk.enabled', operation='read')
    @requires_capability(READ, REQUESTS_READ, match='any')
    def download_attachment(self, ticket_id, attachment_id, **_):
        ticket = find(ticket_id, READ, REQUESTS_READ)
        return download_linked_attachment(ticket_attachments(ticket), attachment_id)


def ticket_attachments(ticket):
    return request.env['ir.attachment'].search([
        ('res_model', '=', ATTACHMENT_MODEL), ('res_id', '=', ticket.id), ('type', '=', 'binary'),
    ], order='id')


def attachments(ticket):
    return [
        {'id': item.id, 'name': item.name, 'mimetype': item.mimetype, 'size': item.file_size,
         'created_at': iso(item.create_date)}
        for item in ticket_attachments(ticket)
    ]


def dump_message(message):
    return {
        'id': message.id,
        'body': message.body or '',
        'author': message.author_id.display_name or '',
        'author_id': message.author_id.id or None,
        'internal': bool(message.subtype_id and message.subtype_id.internal),
        'created_at': iso(message.date),
    }
