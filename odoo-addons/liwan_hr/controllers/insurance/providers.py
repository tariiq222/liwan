# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""/api/v1/hr/insurance/providers: the company's value list of insurers."""
from odoo import http
from odoo.exceptions import MissingError
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    api_handler,
    requires_capability,
    requires_feature,
)
from odoo.addons.liwan_hr.controllers.common import unique_conflict
from odoo.addons.liwan_hr.serializers.insurance.provider import (
    dump_provider,
    parse_provider_create,
    parse_provider_patch,
)

PROVIDER = 'liwan.hr.insurance.provider'
DUPLICATE = 'an insurance provider with this name already exists'


def _audit(action, row, before=None):
    request.env['liwan.hr.audit.event']._liwan_log(action, row, before=before)


class HrInsuranceProviderController(http.Controller):

    @http.route('/api/v1/hr/insurance/providers', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('hr.enabled', 'hr.insurance', operation='read')
    @requires_capability('hr.insurance.read')
    def list_providers(self, **_):
        # Archived providers stay selectable on the settings card, hidden everywhere else.
        archived = request.httprequest.args.get('active') == 'all'
        rows = request.env[PROVIDER].with_context(active_test=not archived).search(
            [('company_id', '=', request.env.company.id)],
        )
        return {'items': [dump_provider(row) for row in rows], 'total': len(rows)}

    @http.route('/api/v1/hr/insurance/providers', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('hr.enabled', 'hr.insurance', operation='write')
    @requires_capability('hr.insurance.manage')
    def create_provider(self, **payload):
        vals = parse_provider_create(payload)
        with unique_conflict(DUPLICATE):
            row = request.env[PROVIDER].create({**vals, 'company_id': request.env.company.id})
        _audit('provider_created', row)
        return request.make_json_response(dump_provider(row), status=201)

    @http.route('/api/v1/hr/insurance/providers/<int:provider_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('hr.enabled', 'hr.insurance', operation='write')
    @requires_capability('hr.insurance.manage')
    def patch_provider(self, provider_id, **payload):
        revision, vals = parse_provider_patch(payload)
        row = request.env[PROVIDER].with_context(active_test=False).search([
            ('id', '=', provider_id), ('company_id', '=', request.env.company.id),
        ], limit=1)
        if not row:
            raise MissingError(request.env._('liwan.hr.insurance.provider %(id)s does not exist', id=provider_id))
        before = request.env['liwan.hr.audit.event']._liwan_policy_snapshot(row)
        with unique_conflict(DUPLICATE):
            row._liwan_save(revision, vals)
        _audit('provider_changed', row, before)
        return dump_provider(row)
