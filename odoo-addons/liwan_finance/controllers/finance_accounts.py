# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command, http
from odoo.exceptions import MissingError
from odoo.http import request

from .common import list_page, parse_choice, require_capability
from .write_support import attempt, currency_id_of
from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    requires_feature,
)
from odoo.addons.liwan_finance.serializers.account import (
    dump_account,
    dump_accounts,
    parse_account_create,
    parse_account_patch,
)


def _company_accounts_domain():
    return [('company_ids', 'parent_of', request.env.companies.ids)]


def _account_types():
    return request.env['account.account']._fields['account_type'].get_values(request.env)


def _find_account(account_id):
    account = request.env['account.account'].with_context(active_test=False).search(
        [('id', '=', account_id), *_company_accounts_domain()], limit=1,
    )
    if not account:
        raise MissingError(request.env._('account.account %(id)s does not exist', id=account_id))
    return account


def _values(parsed):
    values = {key: parsed[key] for key in ('code', 'name', 'account_type', 'reconcile') if key in parsed}
    if 'currency' in parsed:
        values['currency_id'] = currency_id_of(parsed['currency'])
    return values


def _has_items(account):
    return bool(request.env['account.move.line'].search_count([('account_id', '=', account.id)], limit=1))


def _require_unused_for(account, values):
    """A used account keeps its type: the posted history was reported under it."""
    if 'account_type' in values and values['account_type'] != account.account_type and _has_items(account):
        raise ApiError(422, 'account_in_use', 'the account has journal items: its type cannot change', field='account_type')


def _archive_blocker(account):
    """The reason ``account`` cannot be archived, or ``None``."""
    env = request.env
    balance = env['account.move.line']._read_group(
        [('account_id', '=', account.id), ('parent_state', '=', 'posted')], aggregates=['balance:sum'],
    )[0][0]
    if account.company_currency_id.compare_amounts(balance or 0.0, 0.0):
        return 'the account has a balance'
    if env['account.journal'].search_count([('default_account_id', '=', account.id)], limit=1):
        return 'the account is the default account of a journal'
    if env['account.tax.repartition.line'].search_count([('account_id', '=', account.id)], limit=1):
        return 'the account is used by a tax'
    return None


class FinanceAccountController(http.Controller):

    @http.route('/api/v1/finance/accounts', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('finance.enabled', operation='read')
    def list_accounts(self, **_):
        require_capability('finance.accounts.read')
        args = request.httprequest.args
        domain = _company_accounts_domain()
        archived = parse_choice(args.get('archived'), {'true', 'false'}, 'archived') == 'true'
        domain.append(('active', '=', not archived))
        account_type = parse_choice(args.get('account_type'), _account_types(), 'account_type')
        if account_type:
            domain.append(('account_type', '=', account_type))
        query = (args.get('q') or '').strip()
        if query:
            domain += ['|', ('code', 'ilike', query), ('name', 'ilike', query)]
        return list_page('account.account', domain, dump_accounts)

    @http.route('/api/v1/finance/accounts/<int:account_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('finance.enabled', operation='read')
    def get_account(self, account_id):
        require_capability('finance.accounts.read')
        return dump_account(_find_account(account_id))

    @http.route('/api/v1/finance/accounts', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def create_account(self, **payload):
        require_capability('finance.accounts.manage')
        values = _values(parse_account_create(payload, _account_types()))
        account = attempt(lambda: request.env['account.account'].create({**values, 'company_ids': [Command.set(request.env.company.ids)]}))
        request.env['liwan.finance.audit.event']._liwan_log('account_created', account, fields_written=values)
        return request.make_json_response(dump_account(account), status=201)

    @http.route('/api/v1/finance/accounts/<int:account_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def patch_account(self, account_id, **payload):
        require_capability('finance.accounts.manage')
        account = _find_account(account_id)
        values = _values(parse_account_patch(payload, _account_types()))
        _require_unused_for(account, values)
        attempt(lambda: account.write(values))
        request.env['liwan.finance.audit.event']._liwan_log('account_changed', account, fields_written=values)
        return dump_account(account)

    @http.route('/api/v1/finance/accounts/<int:account_id>/archive', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def archive_account(self, account_id, **_):
        require_capability('finance.accounts.manage')
        account = _find_account(account_id)
        blocker = _archive_blocker(account)
        if blocker:
            raise ApiError(422, 'account_in_use', blocker)
        attempt(account.action_archive)
        request.env['liwan.finance.audit.event']._liwan_log('account_archived', account)
        return dump_account(account)

    @http.route('/api/v1/finance/accounts/<int:account_id>/unarchive', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def unarchive_account(self, account_id, **_):
        require_capability('finance.accounts.manage')
        account = _find_account(account_id)
        attempt(account.action_unarchive)
        request.env['liwan.finance.audit.event']._liwan_log('account_unarchived', account)
        return dump_account(account)
