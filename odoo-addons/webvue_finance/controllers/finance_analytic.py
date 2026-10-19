# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.exceptions import MissingError, RedirectWarning
from odoo.http import request

from .analytic_support import company_analytic_domain
from .common import list_page, parse_choice, require_capability
from .write_support import company_records
from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    parse_positive_int,
    requires_feature,
)
from odoo.addons.webvue_finance.serializers.analytic import (
    dump_analytic_account,
    dump_analytic_accounts,
    dump_analytic_plan,
    dump_analytic_plans,
    parse_account_create,
    parse_account_patch,
    parse_plan_create,
    parse_plan_patch,
)
from odoo.addons.webvue_finance.serializers.parsing import require_nonempty


def _find_plan(plan_id):
    plan = request.env['account.analytic.plan'].search([('id', '=', plan_id)], limit=1)
    if not plan:
        raise MissingError(request.env._('account.analytic.plan %(id)s does not exist', id=plan_id))
    return plan


def find_analytic_account(account_id):
    account = request.env['account.analytic.account'].with_context(active_test=False).search(
        [('id', '=', account_id), *company_analytic_domain()], limit=1,
    )
    if not account:
        raise MissingError(request.env._('account.analytic.account %(id)s does not exist', id=account_id))
    return account


def _plan_of(plan_id, field):
    return company_records('account.analytic.plan', [plan_id], field)


def _move_to_plan(account, plan):
    """Write the new plan of ``account``; a move to another root plan moves its analytic items between plan columns.

    Only an unused account changes root plan (422 ``analytic_account_in_use``): Odoo would otherwise refuse with a
    ``RedirectWarning``, and a journal item that names the account in its distribution would change plan with it.
    A move between sub-plans of the same root keeps the column, so it is always allowed.
    """
    if plan._column_name() != account.plan_id._column_name():
        used = request.env['account.analytic.line'].search_count([('auto_account_id', '=', account.id)], limit=1)
        used = used or request.env['account.move.line'].search_count([('analytic_distribution', 'in', [account.id])], limit=1)
        if used:
            raise ApiError(422, 'analytic_account_in_use', 'the account is used by journal items: it cannot change root plan', field='plan_id')


def _account_values(parsed):
    values = {key: parsed[key] for key in ('name', 'active') if key in parsed}
    if 'code' in parsed:
        values['code'] = parsed['code'] or False
    if 'plan_id' in parsed:
        values['plan_id'] = _plan_of(parsed['plan_id'], 'plan_id').id
    return values


class FinanceAnalyticController(http.Controller):

    @http.route('/api/v1/finance/analytic-plans', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('finance.enabled', operation='read')
    def list_analytic_plans(self, **_):
        require_capability('finance.analytic.read')
        query = (request.httprequest.args.get('q') or '').strip()
        return list_page('account.analytic.plan', [('name', 'ilike', query)] if query else [], dump_analytic_plans)

    @http.route('/api/v1/finance/analytic-plans/<int:plan_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('finance.enabled', operation='read')
    def get_analytic_plan(self, plan_id):
        require_capability('finance.analytic.read')
        return dump_analytic_plan(_find_plan(plan_id))

    @http.route('/api/v1/finance/analytic-plans', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def create_analytic_plan(self, **payload):
        """Plans are shared by every company of the database: stock ``account.analytic.plan`` has no company.

        A root plan adds a column and an index to the analytic tables and reloads the registry, so it also needs
        ``finance.setup.manage``; a sub-plan only adds a grouping field.
        """
        require_capability('finance.analytic.manage')
        parsed = parse_plan_create(payload)
        if 'parent_id' not in parsed:
            require_capability('finance.setup.manage')
        values = {'name': parsed['name']}
        if 'parent_id' in parsed:
            values['parent_id'] = _plan_of(parsed['parent_id'], 'parent_id').id
        return request.make_json_response(dump_analytic_plan(request.env['account.analytic.plan'].create(values)), status=201)

    @http.route('/api/v1/finance/analytic-plans/<int:plan_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def patch_analytic_plan(self, plan_id, **payload):
        """Only the name changes: moving a plan under another one rebuilds the plan columns of the analytic items."""
        require_capability('finance.analytic.manage')
        plan = _find_plan(plan_id)
        if not plan.parent_id:
            require_capability('finance.setup.manage')
        require_nonempty(payload)
        plan.write(parse_plan_patch(payload))
        return dump_analytic_plan(plan)

    @http.route('/api/v1/finance/analytic-accounts', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('finance.enabled', operation='read')
    def list_analytic_accounts(self, **_):
        require_capability('finance.analytic.read')
        args = request.httprequest.args
        archived = parse_choice(args.get('archived'), {'true', 'false'}, 'archived') == 'true'
        domain = [*company_analytic_domain(), ('active', '=', not archived)]
        if args.get('plan_id'):
            domain.append(('plan_id', 'child_of', parse_positive_int(args['plan_id'], 'plan_id')))
        query = (args.get('q') or '').strip()
        if query:
            domain += ['|', ('name', 'ilike', query), ('code', 'ilike', query)]
        return list_page('account.analytic.account', domain, dump_analytic_accounts)

    @http.route('/api/v1/finance/analytic-accounts/<int:account_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('finance.enabled', operation='read')
    def get_analytic_account(self, account_id):
        require_capability('finance.analytic.read')
        return dump_analytic_account(find_analytic_account(account_id))

    @http.route('/api/v1/finance/analytic-accounts', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def create_analytic_account(self, **payload):
        require_capability('finance.analytic.manage')
        values = _account_values(parse_account_create(payload))
        values['company_id'] = request.env.company.id
        return request.make_json_response(dump_analytic_account(request.env['account.analytic.account'].create(values)), status=201)

    @http.route('/api/v1/finance/analytic-accounts/<int:account_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def patch_analytic_account(self, account_id, **payload):
        """Archive or unarchive with ``active``; there is no delete."""
        require_capability('finance.analytic.manage')
        account = find_analytic_account(account_id)
        require_nonempty(payload)
        values = _account_values(parse_account_patch(payload))
        if values.get('plan_id', account.plan_id.id) != account.plan_id.id:
            _move_to_plan(account, request.env['account.analytic.plan'].browse(values['plan_id']))
        try:
            account.write(values)
        except RedirectWarning:
            raise ApiError(422, 'analytic_account_in_use', 'the account has analytic items in another plan column', field='plan_id') from None
        return dump_analytic_account(account)
