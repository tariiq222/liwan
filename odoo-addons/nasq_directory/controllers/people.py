# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.nasq_api.controllers.common import (
    api_handler,
    parse_nonneg_int,
    requires_registered_feature,
)

MAX_LIMIT = 50


class PeopleController(http.Controller):

    @http.route('/api/v1/people', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_registered_feature(
        'nasq.directory', '_nasq_directory_feature_keys',
        keys=('registry:nasq.directory',), operation='read', match='any',
    )
    def list_people(self, **_):
        # json2 routes do not receive query-string params as kwargs; read them
        # from the raw request.
        args = request.httprequest.args
        limit = max(1, min(parse_nonneg_int(args.get('limit', 20), 'limit'), MAX_LIMIT))
        # A res.users lookup in the caller's environment, so a person-picking
        # user never traverses an HR employee access policy.
        users = request.env['nasq.directory']._nasq_search_people(args.get('q'), limit=limit)
        return [{'id': user.id, 'name': user.name, 'user_id': user.id} for user in users]
