# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.nasq_api.controllers.common import (
    api_handler,
    parse_nonneg_int,
    requires_feature,
)

MAX_LIMIT = 50


class PeopleController(http.Controller):

    @http.route('/api/v1/people', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('pmo.enabled', 'meetings.enabled', operation='read', match='any')
    def list_people(self, **_):
        # json2 routes do not receive query-string params as kwargs — read them from the
        # raw request (see the same note in controllers/tasks.py::list_tasks).
        args = request.httprequest.args
        q = args.get('q')
        limit = max(1, min(parse_nonneg_int(args.get('limit', 20), 'limit'), MAX_LIMIT))
        # This picker is a PMO user-id lookup. Query res.users directly so
        # ordinary meetings-only users do not traverse the HR employee
        # access policy just to choose a participant.
        domain = [
            ('active', '=', True),
            ('share', '=', False),
            ('company_ids', 'in', [request.env.company.id]),
        ]
        if q:
            domain.append(('name', 'ilike', q))
        users = request.env['res.users'].search(domain, order='name, id', limit=limit)
        return [{'id': user.id, 'name': user.name, 'user_id': user.id} for user in users]
