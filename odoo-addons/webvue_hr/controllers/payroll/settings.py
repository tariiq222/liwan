# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.exceptions import MissingError
from odoo.http import request

from .common import current_company
from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    requires_capability,
    requires_feature,
)
from odoo.addons.webvue_hr.serializers.payroll.settings import (
    dump_rate,
    dump_settings,
    parse_rate,
    parse_settings,
)


def _scoped_rate(rate_id):
    """A rate the caller's companies can see (shared rows included) → 404 otherwise."""
    rate = request.env['webvue.hr.gosi.rate'].search([('id', '=', rate_id)], limit=1)
    if not rate:
        raise MissingError(request.env._('webvue.hr.gosi.rate %(id)s does not exist', id=rate_id))
    return rate


def _reject_duplicate(rate, vals):
    """A second row for the same company, branch, class and start date → 422 instead of a SQL error."""
    keys = {
        name: vals.get(name, rate[name] if rate else None)
        for name in ('branch', 'nationality_class', 'date_from')
    }
    company = rate.company_id if rate else current_company()
    domain = [(name, '=', value) for name, value in keys.items()]
    domain.append(('company_id', '=', company.id or False))
    if rate:
        domain.append(('id', '!=', rate.id))
    if request.env['webvue.hr.gosi.rate'].search_count(domain):
        raise ApiError(422, 'invalid', 'a rate already starts on that date for this branch and class', field='date_from')


def _reject_inverted_wages(rate, vals):
    wage_min = vals.get('wage_min', rate.wage_min if rate else 0)
    wage_max = vals.get('wage_max', rate.wage_max if rate else 0)
    if wage_max < wage_min:
        raise ApiError(422, 'invalid', 'wage_max must not be below wage_min', field='wage_max')


class HrPayrollSettingsController(http.Controller):

    @http.route('/api/v1/hr/payroll/settings', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('hr.enabled', 'hr.payroll', operation='read')
    @requires_capability('hr.payroll.read')
    def get_settings(self, **_):
        return dump_settings(request.env['webvue.hr.payroll.settings']._webvue_for_company(current_company()))

    @http.route('/api/v1/hr/payroll/settings', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('hr.enabled', 'hr.payroll', operation='write')
    @requires_capability('hr.payroll.config')
    def patch_settings(self, **payload):
        vals = parse_settings(payload, request.env)
        if not vals:
            raise ApiError(422, 'invalid', 'no fields to update')
        return dump_settings(request.env['webvue.hr.payroll.settings']._webvue_save(current_company(), vals))

    @http.route('/api/v1/hr/payroll/gosi-rates', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('hr.enabled', 'hr.payroll', operation='read')
    @requires_capability('hr.payroll.read')
    def list_gosi_rates(self, **_):
        rates = request.env['webvue.hr.gosi.rate'].search([])
        return {'items': [dump_rate(rate) for rate in rates], 'total': len(rates)}

    @http.route('/api/v1/hr/payroll/gosi-rates', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('hr.enabled', 'hr.payroll', operation='write')
    @requires_capability('hr.payroll.config')
    def create_gosi_rate(self, **payload):
        vals = parse_rate(payload, request.env['webvue.hr.gosi.rate'], partial=False)
        _reject_inverted_wages(None, vals)
        _reject_duplicate(None, vals)
        rate = request.env['webvue.hr.gosi.rate'].create({**vals, 'company_id': current_company().id})
        return request.make_json_response(dump_rate(rate), status=201)

    @http.route('/api/v1/hr/payroll/gosi-rates/<int:rate_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('hr.enabled', 'hr.payroll', operation='write')
    @requires_capability('hr.payroll.config')
    def patch_gosi_rate(self, rate_id, **payload):
        rate = _scoped_rate(rate_id)
        vals = parse_rate(payload, request.env['webvue.hr.gosi.rate'], partial=True)
        if not vals:
            raise ApiError(422, 'invalid', 'no fields to update')
        _reject_inverted_wages(rate, vals)
        _reject_duplicate(rate, vals)
        rate.write(vals)
        return dump_rate(rate)

    @http.route('/api/v1/hr/payroll/gosi-rates/<int:rate_id>', type='json2', auth='user', methods=['DELETE'], readonly=False)
    @api_handler
    @requires_feature('hr.enabled', 'hr.payroll', operation='write')
    @requires_capability('hr.payroll.config')
    def delete_gosi_rate(self, rate_id, **_):
        _scoped_rate(rate_id).unlink()
        return request.make_json_response('', status=204)
