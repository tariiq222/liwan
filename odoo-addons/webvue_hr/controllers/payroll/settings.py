# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.exceptions import MissingError
from odoo.http import request

from .common import current_company, scoped_profile
from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    requires_capability,
    requires_feature,
)
from odoo.addons.webvue_hr.controllers.common import hr_rule_handler, unique_conflict
from odoo.addons.webvue_hr.serializers.payroll.files import dump_profile, parse_profile
from odoo.addons.webvue_hr.serializers.payroll.revision import (
    parse_delete_revision,
    require_revision,
    split_revision,
)
from odoo.addons.webvue_hr.serializers.payroll.settings import (
    dump_rate,
    dump_settings,
    parse_rate,
    parse_settings,
)


def _writable_rate(rate_id):
    """A rate of the current company; a shared seed rate is read-only → 403, any other company's → 404."""
    rate = request.env['webvue.hr.gosi.rate'].search([
        ('id', '=', rate_id), ('company_id', 'in', [False, current_company().id]),
    ], limit=1)
    if not rate:
        raise MissingError(request.env._('webvue.hr.gosi.rate %(id)s does not exist', id=rate_id))
    if not rate.company_id:
        raise ApiError(403, 'forbidden', 'a shared rate is read-only, add a rate of your own')
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


SETTINGS_CONFLICT = 'payroll settings changed; reload before saving'
RATE_CONFLICT = 'the GOSI rate changed; reload before saving'
PROFILE_CONFLICT = 'the salary file profile changed; reload before saving'


def _audit():
    return request.env['webvue.hr.audit.event']


def _writable_profile(profile_id):
    """A profile of the caller's company; the shared seed profiles are read-only → 403."""
    profile = scoped_profile(profile_id)
    if not profile.company_id:
        raise ApiError(403, 'forbidden', 'a shared profile is read-only, add a profile of your own')
    return profile


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
        revision, payload = split_revision(payload, minimum=0)
        vals = parse_settings(payload, request.env)
        if not vals:
            raise ApiError(422, 'invalid', 'no fields to update')
        Settings = request.env['webvue.hr.payroll.settings']
        current = Settings._webvue_for_company(current_company())
        require_revision(current, revision, SETTINGS_CONFLICT)
        before = _audit()._webvue_policy_snapshot(current)
        with unique_conflict(SETTINGS_CONFLICT):
            settings = Settings._webvue_save(current_company(), vals)
            _audit()._webvue_log('payroll_settings_changed', settings, before)
        return dump_settings(settings)

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
        with unique_conflict('a GOSI rate was created for this branch, class and date at the same time'):
            rate = request.env['webvue.hr.gosi.rate'].create({**vals, 'company_id': current_company().id})
            _audit()._webvue_log('gosi_rate_created', rate)
        return request.make_json_response(dump_rate(rate), status=201)

    @http.route('/api/v1/hr/payroll/gosi-rates/<int:rate_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('hr.enabled', 'hr.payroll', operation='write')
    @requires_capability('hr.payroll.config')
    def patch_gosi_rate(self, rate_id, **payload):
        rate = _writable_rate(rate_id)
        revision, payload = split_revision(payload)
        vals = parse_rate(payload, request.env['webvue.hr.gosi.rate'], partial=True)
        if not vals:
            raise ApiError(422, 'invalid', 'no fields to update')
        require_revision(rate, revision, RATE_CONFLICT)
        _reject_inverted_wages(rate, vals)
        _reject_duplicate(rate, vals)
        before = _audit()._webvue_policy_snapshot(rate)
        rate.write({**vals, 'revision': revision + 1})
        _audit()._webvue_log('gosi_rate_changed', rate, before)
        return dump_rate(rate)

    @http.route('/api/v1/hr/payroll/gosi-rates/<int:rate_id>', type='json2', auth='user', methods=['DELETE'], readonly=False)
    @api_handler
    @requires_feature('hr.enabled', 'hr.payroll', operation='write')
    @requires_capability('hr.payroll.config')
    def delete_gosi_rate(self, rate_id, **payload):
        rate = _writable_rate(rate_id)
        revision = parse_delete_revision(payload)
        require_revision(rate, revision, RATE_CONFLICT)
        with request.env.cr.savepoint():
            _audit()._webvue_log('gosi_rate_deleted', rate)
            rate.unlink()
        return request.make_json_response('', status=204)

    @http.route('/api/v1/hr/payroll/bank-profiles', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('hr.enabled', 'hr.payroll', operation='read')
    @requires_capability('hr.payroll.read')
    def list_bank_profiles(self, **_):
        profiles = request.env['webvue.hr.payroll.bank.profile'].search([])
        return {'items': [dump_profile(profile) for profile in profiles], 'total': len(profiles)}

    @http.route('/api/v1/hr/payroll/bank-profiles', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('hr.enabled', 'hr.payroll', operation='write')
    @requires_capability('hr.payroll.config')
    def create_bank_profile(self, **payload):
        model = request.env['webvue.hr.payroll.bank.profile']
        profile = model.create({**parse_profile(payload, model, partial=False), 'company_id': current_company().id})
        _audit()._webvue_log('bank_profile_created', profile)
        return request.make_json_response(dump_profile(profile), status=201)

    @http.route('/api/v1/hr/payroll/bank-profiles/<int:profile_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('hr.enabled', 'hr.payroll', operation='write')
    @requires_capability('hr.payroll.config')
    def patch_bank_profile(self, profile_id, **payload):
        profile = _writable_profile(profile_id)
        revision, payload = split_revision(payload)
        vals = parse_profile(payload, request.env['webvue.hr.payroll.bank.profile'], partial=True)
        if not vals:
            raise ApiError(422, 'invalid', 'no fields to update')
        require_revision(profile, revision, PROFILE_CONFLICT)
        before = _audit()._webvue_policy_snapshot(profile)
        profile.write({**vals, 'revision': revision + 1})
        _audit()._webvue_log('bank_profile_changed', profile, before)
        return dump_profile(profile)

    @http.route('/api/v1/hr/payroll/bank-profiles/<int:profile_id>', type='json2', auth='user', methods=['DELETE'], readonly=False)
    @api_handler
    @hr_rule_handler
    @requires_feature('hr.enabled', 'hr.payroll', operation='write')
    @requires_capability('hr.payroll.config')
    def delete_bank_profile(self, profile_id, **payload):
        profile = _writable_profile(profile_id)
        revision = parse_delete_revision(payload)
        require_revision(profile, revision, PROFILE_CONFLICT)
        with request.env.cr.savepoint():
            _audit()._webvue_log('bank_profile_deleted', profile)
            profile._webvue_delete()
        return request.make_json_response('', status=204)
