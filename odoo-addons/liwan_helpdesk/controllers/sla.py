# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""``/api/v1/helpdesk/sla``: the service levels a tenant shapes without code."""
from odoo import http
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    requires_capability,
    requires_feature,
)

SLA_FIELDS = frozenset({
    'id', 'name', 'days', 'hours', 'stage_id', 'team_ids', 'category_ids', 'tag_ids', 'ignore_stage_ids', 'active',
})


def body():
    payload = request.get_json_data()
    if not isinstance(payload, dict) or set(payload) - SLA_FIELDS:
        raise ApiError(422, 'invalid', 'Invalid request fields.')
    if 'id' in payload and (type(payload['id']) is not int or payload['id'] <= 0):
        raise ApiError(422, 'invalid', 'must be a record id', field='id')
    return payload


def service():
    return request.env['liwan.helpdesk.sla']


class HelpdeskSlaController(http.Controller):

    @http.route('/api/v1/helpdesk/sla', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('helpdesk.enabled', operation='read')
    @requires_capability('helpdesk.settings.read')
    def list_sla(self, **_):
        return service()._liwan_dump()

    @http.route('/api/v1/helpdesk/sla', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('helpdesk.enabled')
    @requires_capability('helpdesk.settings.manage')
    def save_sla(self, **_):
        return service()._liwan_dump_one(service()._liwan_save(body()))

    @http.route('/api/v1/helpdesk/sla/<int:policy_id>/active', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('helpdesk.enabled')
    @requires_capability('helpdesk.settings.manage')
    def set_sla_active(self, policy_id, **_):
        payload = request.get_json_data()
        if not isinstance(payload, dict) or set(payload) != {'active'}:
            raise ApiError(422, 'invalid', 'Invalid request fields.')
        return service()._liwan_dump_one(service()._liwan_archive(policy_id, payload['active']))
