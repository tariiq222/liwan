# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.nasq_api.controllers.common import api_handler, parse_nonneg_int

MAX_LIMIT = 50


class PeopleController(http.Controller):

    @http.route('/api/v1/people', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    def list_people(self, **_):
        # json2 routes do not receive query-string params as kwargs — read them from the
        # raw request (see the same note in controllers/tasks.py::list_tasks).
        args = request.httprequest.args
        q = args.get('q')
        limit = min(parse_nonneg_int(args.get('limit', 20), 'limit'), MAX_LIMIT)
        domain = [('user_id', '!=', False), ('user_id.active', '=', True)]
        if q:
            domain.append(('name', 'ilike', q))
        # hr.employee.public is the model regular (non-HR) users have read access to
        # (addons/hr/security/ir.model.access.csv: access_hr_employee_public_user grants
        # base.group_user); querying it directly avoids relying on hr.employee's own
        # _search()/search_fetch() overrides that transparently fall back to it when the
        # caller lacks read access to hr.employee itself (addons/hr/models/hr_employee.py).
        employees = request.env['hr.employee.public'].search(domain, order='name', limit=limit)
        return [{'id': e.user_id.id, 'name': e.user_id.name, 'user_id': e.user_id.id} for e in employees]
