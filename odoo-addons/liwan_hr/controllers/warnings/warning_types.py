# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""/api/v1/hr/warning-types: the company's value list of warning types (verbal, written, final, ...)."""
from odoo import http
from odoo.exceptions import MissingError
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    api_handler,
    requires_capability,
    requires_feature,
)
from odoo.addons.liwan_hr.controllers.common import unique_conflict
from odoo.addons.liwan_hr.serializers.warnings.warning_type import (
    dump_type,
    parse_type_create,
    parse_type_patch,
)

TYPE = 'liwan.hr.warning.type'
DUPLICATE = 'a warning type with this name already exists'


def _audit(action, row, before=None):
    request.env['liwan.hr.audit.event']._liwan_log(action, row, before=before)


class HrWarningTypeController(http.Controller):

    @http.route('/api/v1/hr/warning-types', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('hr.enabled', 'hr.warnings', operation='read')
    @requires_capability('hr.employees.read')
    def list_types(self, **_):
        # Archived types stay selectable on the settings card, hidden everywhere else.
        archived = request.httprequest.args.get('active') == 'all'
        types = request.env[TYPE].with_context(active_test=not archived).search(
            [('company_id', '=', request.env.company.id)],
        )
        return {'items': [dump_type(row) for row in types], 'total': len(types)}

    @http.route('/api/v1/hr/warning-types', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('hr.enabled', 'hr.warnings', operation='write')
    @requires_capability('hr.warnings.manage')
    def create_type(self, **payload):
        vals = parse_type_create(payload)
        with unique_conflict(DUPLICATE):
            row = request.env[TYPE].create({**vals, 'company_id': request.env.company.id})
        _audit('warning_type_created', row)
        return request.make_json_response(dump_type(row), status=201)

    @http.route('/api/v1/hr/warning-types/<int:type_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('hr.enabled', 'hr.warnings', operation='write')
    @requires_capability('hr.warnings.manage')
    def patch_type(self, type_id, **payload):
        revision, vals = parse_type_patch(payload)
        row = request.env[TYPE].with_context(active_test=False).search([
            ('id', '=', type_id), ('company_id', '=', request.env.company.id),
        ], limit=1)
        if not row:
            raise MissingError(request.env._('liwan.hr.warning.type %(id)s does not exist', id=type_id))
        before = request.env['liwan.hr.audit.event']._liwan_policy_snapshot(row)
        with unique_conflict(DUPLICATE):
            row._liwan_save(revision, vals)
        _audit('warning_type_changed', row, before)
        return dump_type(row)
