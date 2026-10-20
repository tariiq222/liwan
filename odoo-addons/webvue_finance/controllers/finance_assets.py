# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, http
from odoo.exceptions import MissingError
from odoo.http import request

from .common import list_page, parse_choice, require_capability
from .finance_partners import company_partners_domain
from .write_support import attempt, company_records, is_period_locked, period_locked
from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    parse_positive_int,
    requires_feature,
)
from odoo.addons.webvue_finance.serializers.asset import (
    dump_asset_detail,
    dump_asset_profiles,
    dump_assets,
    parse_asset_create,
    parse_asset_dispose,
    parse_compute_depreciation,
)
from odoo.addons.webvue_finance.serializers.common import dump_day, dump_ref


def _find_asset(asset_id):
    asset = request.env['account.asset'].search(
        [('id', '=', asset_id), ('company_id', '=', request.env.company.id)], limit=1,
    )
    if not asset:
        raise MissingError(request.env._('account.asset %(id)s does not exist', id=asset_id))
    return asset


def _asset_values(parsed):
    values = {key: parsed[key] for key in ('name', 'code', 'purchase_value', 'salvage_value', 'date_start', 'note') if key in parsed}
    values['profile_id'] = company_records(
        'account.asset.profile', [parsed['profile_id']], 'profile_id', [('company_id', '=', request.env.company.id)],
    ).id
    if 'partner_id' in parsed:
        values['partner_id'] = company_records('res.partner', [parsed['partner_id']], 'partner_id', company_partners_domain()).id
    return values


class FinanceAssetController(http.Controller):
    """Fixed assets over OCA account_asset_management: the asset, its profile and the depreciation board."""

    @http.route('/api/v1/finance/asset-profiles', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('finance.enabled', operation='read')
    def list_asset_profiles(self, **_):
        """The asset profiles of the current company: accounts, journal and depreciation method."""
        require_capability('finance.assets.read')
        return list_page('account.asset.profile', [('company_id', '=', request.env.company.id)], dump_asset_profiles)

    @http.route('/api/v1/finance/assets', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('finance.enabled', operation='read')
    def list_assets(self, **_):
        """Fixed assets, filtered by ``state``, ``profile_id`` and ``q``."""
        require_capability('finance.assets.read')
        args = request.httprequest.args
        domain = [('company_id', '=', request.env.company.id)]
        state = parse_choice(args.get('state'), request.env['account.asset']._fields['state'].get_values(request.env), 'state')
        if state:
            domain.append(('state', '=', state))
        if args.get('profile_id'):
            domain.append(('profile_id', '=', parse_positive_int(args['profile_id'], 'profile_id')))
        query = (args.get('q') or '').strip()
        if query:
            domain += ['|', ('name', 'ilike', query), ('code', 'ilike', query)]
        return list_page('account.asset', domain, dump_assets)

    @http.route('/api/v1/finance/assets/<int:asset_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('finance.enabled', operation='read')
    def get_asset(self, asset_id, **_):
        """An asset with its depreciation board."""
        require_capability('finance.assets.read')
        return dump_asset_detail(_find_asset(asset_id))

    @http.route('/api/v1/finance/assets', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def create_asset(self, **payload):
        """A draft asset on a profile: the depreciation method comes from the profile, the board when it is validated."""
        require_capability('finance.assets.manage')
        values = _asset_values(parse_asset_create(payload))
        asset = attempt(lambda: request.env['account.asset'].create(values), day=values['date_start'])
        return request.make_json_response(dump_asset_detail(asset), status=201)

    @http.route('/api/v1/finance/assets/<int:asset_id>/validate', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def validate_asset(self, asset_id, **_):
        """Runs the asset (draft to running) and computes its depreciation board."""
        require_capability('finance.assets.manage')
        asset = _find_asset(asset_id)
        if asset.state != 'draft':
            raise ApiError(422, 'not_draft', f'only a draft asset can be validated, it is {asset.state}')
        attempt(asset.validate)
        return dump_asset_detail(asset)

    @http.route('/api/v1/finance/assets/compute-depreciation', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def compute_depreciation(self, **payload):
        """Posts the entry of every running asset's due depreciation line up to ``date`` (not in the future).

        This is the OCA wizard's job, done with its ``_compute_entries`` (recompute triggers included) in the
        caller's rights: the wizard itself needs the full Accountant group. A line that cannot be posted
        refuses the whole request (422 ``invalid``): nothing is posted.
        """
        require_capability('finance.assets.manage')
        day = parse_compute_depreciation(payload)['date']
        if day > fields.Date.context_today(request.env['account.asset']):
            raise ApiError(422, 'invalid', 'date must not be in the future', field='date')
        assets = request.env['account.asset'].search([('company_id', '=', request.env.company.id), ('state', '=', 'open')])
        move_ids, error_log = attempt(lambda: assets._compute_entries(day, check_triggers=True), day=day)
        if error_log:
            raise ApiError(422, 'invalid', error_log.strip())
        moves = request.env['account.move'].browse(move_ids)
        return {'date': dump_day(day), 'entries': [dump_ref(move) for move in moves]}

    @http.route('/api/v1/finance/assets/<int:asset_id>/dispose', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def dispose_asset(self, asset_id, **payload):
        """Sells or scraps a running asset: the OCA removal wizard books the last depreciation up to the date, clears the
        asset and its accumulated depreciation, and books the proceeds and the gain or loss. The entry is posted.

        The gain account (``plus_account_id``) and loss account (``min_account_id``) default to the profile's; a missing one
        that the result needs is 422 ``invalid``. ``sale_value`` above zero needs ``sale_account_id`` (where the proceeds
        are debited: a bank, cash or receivable account).
        """
        require_capability('finance.assets.manage')
        asset = _find_asset(asset_id)
        if asset.state not in ('open', 'close'):
            raise ApiError(422, 'invalid_state', f'only a running or fully depreciated asset can be disposed of, it is {asset.state}')
        parsed = parse_asset_dispose(payload)
        if is_period_locked(parsed['date_remove'], asset.profile_id.journal_id):
            raise period_locked(field='date_remove')
        accounts = {}
        for field, profile_field, wizard_field in (
            ('sale_account_id', None, 'account_sale_id'),
            ('plus_account_id', 'account_plus_value_id', 'account_plus_value_id'),
            ('min_account_id', 'account_min_value_id', 'account_min_value_id'),
        ):
            if field in parsed:
                accounts[wizard_field] = company_records(
                    'account.account', [parsed[field]], field, [('company_ids', 'in', [request.env.company.id])],
                ).id
            elif profile_field and asset.profile_id[profile_field]:
                accounts[wizard_field] = asset.profile_id[profile_field].id
        for field, wizard_field in (('min_account_id', 'account_min_value_id'), ('plus_account_id', 'account_plus_value_id')):
            if wizard_field not in accounts and (field == 'min_account_id' or parsed['sale_value']):
                raise ApiError(422, 'invalid', f'{field} is required: the profile names no account for it', field=field)
        early = asset.value_residual != (asset.salvage_value if asset.method in ('linear-limit', 'degr-limit') else 0)
        context = {'active_id': asset.id, 'active_ids': asset.ids, **({'early_removal': True} if early else {})}

        def dispose():
            wizard = request.env['account.asset.remove'].with_context(**context).create({
                'date_remove': parsed['date_remove'], 'sale_value': parsed['sale_value'], 'posting_regime': 'gain_loss_on_sale',
                'note': parsed.get('note') or False, **accounts,
            })
            wizard.remove()
            removal = asset.depreciation_line_ids.filtered(lambda line: line.type == 'remove').move_id
            removal.filtered(lambda move: move.state == 'draft').action_post()

        attempt(dispose, day=parsed['date_remove'])
        request.env['webvue.finance.audit.event']._webvue_log('asset_disposed', asset, outcome=f'sold for {parsed["sale_value"]}')
        return dump_asset_detail(asset)
