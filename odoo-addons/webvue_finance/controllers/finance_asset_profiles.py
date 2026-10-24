# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.exceptions import MissingError
from odoo.http import request

from .common import list_page, parse_choice, require_capability
from .write_support import attempt, company_records
from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    requires_feature,
)
from odoo.addons.webvue_finance.serializers.asset import (
    PROFILE_ACCOUNT_FIELDS,
    PROFILE_LOCKED_WHEN_USED,
    dump_asset_profile,
    dump_asset_profiles,
    parse_profile_create,
    parse_profile_patch,
)

# Fixed assets sit on non-current asset accounts, accumulated depreciation beside them, the expense on an expense account.
ASSET_ACCOUNT_TYPES = ('asset_fixed', 'asset_non_current')
EXPENSE_ACCOUNT_TYPES = ('expense', 'expense_depreciation', 'expense_direct_cost')
ACCOUNT_TYPES = {
    'asset_account_id': ASSET_ACCOUNT_TYPES,
    'depreciation_account_id': ASSET_ACCOUNT_TYPES,
    'expense_account_id': EXPENSE_ACCOUNT_TYPES,
}


def _find_profile(profile_id):
    profile = request.env['account.asset.profile'].with_context(active_test=False).search(
        [('id', '=', profile_id), ('company_id', 'in', request.env.companies.ids)], limit=1,
    )
    if not profile:
        raise MissingError(request.env._('account.asset.profile %(id)s does not exist', id=profile_id))
    return profile


def _values(parsed, company):
    values = {key: parsed[key] for key in ('name', 'method', 'method_time', 'method_number', 'method_period', 'prorata') if key in parsed}
    for field, model_field in PROFILE_ACCOUNT_FIELDS.items():
        if field not in parsed:
            continue
        if parsed[field] is None:
            values[model_field] = False
            continue
        domain = request.env['account.account']._check_company_domain(company)
        if field in ACCOUNT_TYPES:
            domain.append(('account_type', 'in', ACCOUNT_TYPES[field]))
        values[model_field] = company_records('account.account', [parsed[field]], field, domain).id
    if 'journal_id' in parsed:
        values['journal_id'] = company_records(
            'account.journal', [parsed['journal_id']], 'journal_id', [*request.env['account.journal']._check_company_domain(company), ('type', '=', 'general')],
        ).id
    return values


def _require_unused_for(profile, parsed):
    """Once an asset uses the profile, what its depreciation is computed and booked with is fixed."""
    current = dump_asset_profile(profile)
    current.update({
        'asset_account_id': profile.account_asset_id.id, 'depreciation_account_id': profile.account_depreciation_id.id,
        'expense_account_id': profile.account_expense_depreciation_id.id, 'journal_id': profile.journal_id.id,
    })
    changed = [field for field in PROFILE_LOCKED_WHEN_USED if field in parsed and parsed[field] != current[field]]
    if changed and request.env['account.asset'].with_context(active_test=False).search_count([('profile_id', '=', profile.id)], limit=1):
        raise ApiError(422, 'profile_in_use', 'assets use this profile: its accounts, journal and method are fixed', field=changed[0])


class FinanceAssetProfileController(http.Controller):
    """The depreciation profiles of fixed assets: method, accounts and journal, over OCA ``account.asset.profile``."""

    @http.route('/api/v1/finance/asset-profiles', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('finance.enabled', operation='read')
    def list_asset_profiles(self, **_):
        """The asset profiles of the current company (``archived=true`` for the archived ones)."""
        require_capability('finance.assets.read')
        archived = parse_choice(request.httprequest.args.get('archived'), {'true', 'false'}, 'archived') == 'true'
        domain = [('company_id', 'in', request.env.companies.ids), ('active', '=', not archived)]
        return list_page('account.asset.profile', domain, dump_asset_profiles)

    @http.route('/api/v1/finance/asset-profiles/<int:profile_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('finance.enabled', operation='read')
    def get_asset_profile(self, profile_id):
        require_capability('finance.assets.read')
        return dump_asset_profile(_find_profile(profile_id))

    @http.route('/api/v1/finance/asset-profiles', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def create_asset_profile(self, **payload):
        require_capability('finance.assets.manage')
        values = _values(parse_profile_create(payload), request.env.company)
        profile = attempt(lambda: request.env['account.asset.profile'].create({**values, 'company_id': request.env.company.id}))
        request.env['webvue.finance.audit.event']._webvue_log('asset_profile_created', profile, fields_written=values)
        return request.make_json_response(dump_asset_profile(profile), status=201)

    @http.route('/api/v1/finance/asset-profiles/<int:profile_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def patch_asset_profile(self, profile_id, **payload):
        require_capability('finance.assets.manage')
        profile = _find_profile(profile_id)
        parsed = parse_profile_patch(payload)
        _require_unused_for(profile, parsed)
        values = _values(parsed, profile.company_id)
        attempt(lambda: profile.write(values))
        request.env['webvue.finance.audit.event']._webvue_log('asset_profile_changed', profile, fields_written=values)
        return dump_asset_profile(profile)

    @http.route('/api/v1/finance/asset-profiles/<int:profile_id>/archive', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def archive_asset_profile(self, profile_id, **_):
        """An archived profile cannot be chosen for a new asset; the assets that use it keep running."""
        require_capability('finance.assets.manage')
        profile = _find_profile(profile_id)
        profile.active = False
        request.env['webvue.finance.audit.event']._webvue_log('asset_profile_archived', profile)
        return dump_asset_profile(profile)

    @http.route('/api/v1/finance/asset-profiles/<int:profile_id>/unarchive', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def unarchive_asset_profile(self, profile_id, **_):
        require_capability('finance.assets.manage')
        profile = _find_profile(profile_id)
        profile.active = True
        request.env['webvue.finance.audit.event']._webvue_log('asset_profile_unarchived', profile)
        return dump_asset_profile(profile)
