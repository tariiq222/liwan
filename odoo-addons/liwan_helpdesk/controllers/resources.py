# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""``/api/v1/helpdesk/settings/<kind>``: the reference records a tenant shapes from the settings.

One POST per kind saves a new record (no ``id``) or an existing one (``id``); the settings surface reads
them all with one GET. The service decides the guards (a team or stage still used by tickets is
archived, the last closed stage stays, another company's record is not found).
"""
from odoo import http
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    requires_capability,
    requires_feature,
)

KIND_FIELDS = {
    'teams': frozenset({'id', 'name', 'member_ids', 'leader_id', 'calendar_id', 'sequence', 'active'}),
    'stages': frozenset({'id', 'name', 'sequence', 'closed', 'unattended', 'fold', 'team_ids', 'active'}),
    'categories': frozenset({'id', 'name', 'parent_id', 'sequence', 'active'}),
    'tags': frozenset({'id', 'name', 'sequence', 'active'}),
    'channels': frozenset({'id', 'name', 'sequence', 'active'}),
    'types': frozenset({'id', 'name', 'sequence', 'active'}),
}
SAVE_METHODS = {
    'teams': 'teams', 'stages': 'stage', 'categories': 'category',
    'tags': 'named', 'channels': 'named', 'types': 'named',
}
NAMED_MODELS = {
    'tags': 'helpdesk.ticket.tag',
    'channels': 'helpdesk.ticket.channel',
    'types': 'helpdesk.ticket.type',
}


def body(kind):
    payload = request.get_json_data()
    if not isinstance(payload, dict) or set(payload) - KIND_FIELDS[kind]:
        raise ApiError(422, 'invalid', 'Invalid request fields.')
    if 'id' in payload and (type(payload['id']) is not int or payload['id'] <= 0):
        raise ApiError(422, 'invalid', 'must be a record id', field='id')
    return payload


def save(kind, payload):
    service = request.env['liwan.helpdesk.resources']
    method = SAVE_METHODS[kind]
    if method == 'teams':
        return service._liwan_save_team(payload)
    if method == 'stage':
        return service._liwan_save_stage(payload)
    if method == 'category':
        return service._liwan_save_category(payload)
    return service._liwan_save_named(NAMED_MODELS[kind], payload)


class HelpdeskResourcesController(http.Controller):

    @http.route('/api/v1/helpdesk/settings/resources', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('helpdesk.enabled', operation='read')
    @requires_capability('helpdesk.settings.read')
    def list_resources(self, **_):
        service = request.env['liwan.helpdesk.resources']
        return service._liwan_dump()

    @http.route('/api/v1/helpdesk/settings/teams', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('helpdesk.enabled')
    @requires_capability('helpdesk.settings.manage')
    def save_team(self, **_):
        record = save('teams', body('teams'))
        return request.env['liwan.helpdesk.resources']._liwan_dump_team(record)

    @http.route('/api/v1/helpdesk/settings/stages', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('helpdesk.enabled')
    @requires_capability('helpdesk.settings.manage')
    def save_stage(self, **_):
        record = save('stages', body('stages'))
        return request.env['liwan.helpdesk.resources']._liwan_dump_stage(record)

    @http.route('/api/v1/helpdesk/settings/categories', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('helpdesk.enabled')
    @requires_capability('helpdesk.settings.manage')
    def save_category(self, **_):
        record = save('categories', body('categories'))
        return request.env['liwan.helpdesk.resources']._liwan_dump_named(record, complete=True)

    @http.route('/api/v1/helpdesk/settings/tags', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('helpdesk.enabled')
    @requires_capability('helpdesk.settings.manage')
    def save_tag(self, **_):
        record = save('tags', body('tags'))
        return request.env['liwan.helpdesk.resources']._liwan_dump_named(record)

    @http.route('/api/v1/helpdesk/settings/channels', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('helpdesk.enabled')
    @requires_capability('helpdesk.settings.manage')
    def save_channel(self, **_):
        record = save('channels', body('channels'))
        return request.env['liwan.helpdesk.resources']._liwan_dump_named(record)

    @http.route('/api/v1/helpdesk/settings/types', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('helpdesk.enabled')
    @requires_capability('helpdesk.settings.manage')
    def save_type(self, **_):
        record = save('types', body('types'))
        return request.env['liwan.helpdesk.resources']._liwan_dump_named(record)
