# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.exceptions import MissingError
from odoo.http import request

from .common import list_page, parse_choice, parse_day, require_capability
from .write_support import attempt, company_records
from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    parse_positive_int,
    requires_feature,
)
from odoo.addons.webvue_finance.serializers.budget import (
    check_period,
    dump_budget_detail,
    dump_budget_line,
    dump_budget_vs_actual,
    dump_budgets,
    parse_budget_create,
    parse_budget_patch,
    parse_distribution,
    parse_line_create,
    parse_line_patch,
)
from odoo.addons.webvue_finance.serializers.parsing import require_nonempty

BUDGET_MODEL = 'mis.budget.by.account'
ITEM_MODEL = 'mis.budget.by.account.item'
FULL_SHARE = 100


def _find_budget(budget_id):
    budget = request.env[BUDGET_MODEL].search(
        [('id', '=', budget_id), ('company_id', '=', request.env.company.id)], limit=1,
    )
    if not budget:
        raise MissingError(request.env._('%(model)s %(id)s does not exist', model=BUDGET_MODEL, id=budget_id))
    return budget


def _find_line(budget, line_id):
    line = budget.item_ids.filtered(lambda item: item.id == line_id)
    if not line:
        raise MissingError(request.env._('%(model)s %(id)s does not exist', model=ITEM_MODEL, id=line_id))
    return line


def _require_draft(budget):
    if budget.state != 'draft':
        raise ApiError(422, 'not_draft', f'only a draft budget can be changed, it is {budget.state}')


def _service():
    return request.env['webvue.finance.budget']


def _dump_lines(lines):
    analytics = _service()._webvue_analytic_accounts(lines)
    return [
        dump_budget_line(line, _service()._webvue_line_amount(line), analytics[line.id], _service()._webvue_nature(line.account_id))
        for line in lines
    ]


def _dump_detail(budget):
    return dump_budget_detail(budget, _dump_lines(budget.item_ids))


def _reject_path_keys(*names):
    """A body key named like a path key is refused: the path owns it (json2 would silently let the path win)."""
    body = request.get_json_data()
    for name in names:
        if isinstance(body, dict) and name in body:
            raise ApiError(422, 'invalid', f'{name} is set by the path, not the body', field=name)


def _require_lines_within(budget, date_from, date_to):
    if any(line.date_from < date_from or line.date_to > date_to for line in budget.item_ids):
        raise ApiError(422, 'invalid', 'a budget line lies outside the new period', field='date_from')


def _line_values(parsed, budget, line=None):
    """The item values of a line request; a patch (``line`` given) keeps what it does not name."""
    values = {'budget_id': budget.id, 'company_id': budget.company_id.id} if line is None else {}
    if 'label' in parsed:
        values['name'] = parsed['label']
    for field in ('date_from', 'date_to'):
        if field in parsed:
            values[field] = parsed[field]
        elif line is None:
            values[field] = budget[field]
    account = line.account_id if line else request.env['account.account']
    if 'account_id' in parsed:
        account = company_records(
            'account.account', [parsed['account_id']], 'account_id', [('company_ids', 'in', [budget.company_id.id])],
        )
        values['account_id'] = account.id
    if line is None or 'account_id' in parsed or 'amount' in parsed:
        amount = parsed['amount'] if 'amount' in parsed else _service()._webvue_line_amount(line)
        values.update(_service()._webvue_amount_values(account, amount))
    if parsed.get('analytic_account_id'):
        analytic = company_records(
            'account.analytic.account', [parsed['analytic_account_id']], 'analytic_account_id',
            [('company_id', 'in', [False, budget.company_id.id])],
        )
        values['analytic_distribution'] = {str(analytic.id): FULL_SHARE}
    elif 'analytic_account_id' in parsed:
        values['analytic_distribution'] = False
    return values


def _analytic_id_of(values, line=None):
    """The cost center a line is limited to (0 for none), from the new values or the existing line."""
    distribution = values.get('analytic_distribution', line.analytic_distribution if line else None)
    return int(next(iter(distribution), 0)) if distribution else 0


def _require_distinct_cost_centers(budget, values, line=None):
    """With the cost-center split on, lines of one account may overlap in time only when each names a different cost center.

    OCA lifts its overlap rule for the whole budget; this keeps the budget from counting an account twice: two lines of
    the same account, period and cost center (or one with and one without a cost center) would both be compared with
    the same actual.
    """
    if not budget.allow_items_overlap:
        return
    account_id = values.get('account_id', line.account_id.id if line else None)
    date_from = values.get('date_from', line.date_from if line else budget.date_from)
    date_to = values.get('date_to', line.date_to if line else budget.date_to)
    analytic = _analytic_id_of(values, line)
    for other in budget.item_ids - (line or budget.item_ids.browse()):
        if other.account_id.id != account_id or other.date_from > date_to or other.date_to < date_from:
            continue
        other_analytic = _analytic_id_of({}, other)
        if not analytic or not other_analytic or analytic == other_analytic:
            raise ApiError(
                422, 'cost_center_overlap',
                'lines of one account in the same period must each name a different cost center', field='analytic_account_id',
            )


class FinanceBudgetController(http.Controller):
    """Budgets by account over OCA mis_builder_budget, and budget versus actual."""

    @http.route('/api/v1/finance/budgets', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('finance.enabled', operation='read')
    def list_budgets(self, **_):
        """Budgets of the current company, filtered by ``state`` and ``q`` (the name)."""
        require_capability('finance.budgets.read')
        args = request.httprequest.args
        domain = [('company_id', '=', request.env.company.id)]
        state = parse_choice(args.get('state'), request.env[BUDGET_MODEL]._fields['state'].get_values(request.env), 'state')
        if state:
            domain.append(('state', '=', state))
        query = (args.get('q') or '').strip()
        if query:
            domain.append(('name', 'ilike', query))
        return list_page(BUDGET_MODEL, domain, dump_budgets)

    @http.route('/api/v1/finance/budgets/<int:budget_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('finance.enabled', operation='read')
    def get_budget(self, budget_id, **_):
        """A budget with its lines."""
        require_capability('finance.budgets.read')
        return _dump_detail(_find_budget(budget_id))

    @http.route('/api/v1/finance/budgets', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def create_budget(self, **payload):
        """A draft budget for a period of the current company."""
        require_capability('finance.budgets.manage')
        values = {**parse_budget_create(payload), 'company_id': request.env.company.id}
        budget = attempt(lambda: request.env[BUDGET_MODEL].create(values))
        return request.make_json_response(_dump_detail(budget), status=201)

    @http.route('/api/v1/finance/budgets/<int:budget_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def patch_budget(self, budget_id, **payload):
        """The name, description or period of a draft budget; its lines must stay inside the period."""
        require_capability('finance.budgets.manage')
        _reject_path_keys('budget_id')
        budget = _find_budget(budget_id)
        parsed = parse_budget_patch(payload)
        require_nonempty(parsed)
        _require_draft(budget)
        date_from = parsed.get('date_from', budget.date_from)
        date_to = parsed.get('date_to', budget.date_to)
        check_period(date_from, date_to)
        _require_lines_within(budget, date_from, date_to)
        attempt(lambda: budget.write(parsed))
        return _dump_detail(budget)

    def _transition(self, budget_id, allowed, action, code):
        require_capability('finance.budgets.manage')
        budget = _find_budget(budget_id)
        if budget.state not in allowed:
            raise ApiError(422, code, f'a {budget.state} budget cannot be changed this way')
        getattr(budget, action)()
        return _dump_detail(budget)

    @http.route('/api/v1/finance/budgets/<int:budget_id>/confirm', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def confirm_budget(self, budget_id, **_):
        """Draft to confirmed: the budget and its lines are frozen."""
        return self._transition(budget_id, ('draft',), 'action_confirm', 'not_draft')

    @http.route('/api/v1/finance/budgets/<int:budget_id>/cancel', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def cancel_budget(self, budget_id, **_):
        """Draft or confirmed to cancelled (closed)."""
        return self._transition(budget_id, ('draft', 'confirmed'), 'action_cancel', 'invalid_state')

    @http.route('/api/v1/finance/budgets/<int:budget_id>/reset-to-draft', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def reset_budget(self, budget_id, **_):
        """Confirmed or cancelled back to draft, to change the lines."""
        return self._transition(budget_id, ('confirmed', 'cancelled'), 'action_draft', 'invalid_state')

    @http.route('/api/v1/finance/budgets/<int:budget_id>/lines', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def create_line(self, budget_id, **payload):
        """A line on a draft budget: an account (and optionally one analytic account) and its amount for a period."""
        require_capability('finance.budgets.manage')
        _reject_path_keys('budget_id')
        budget = _find_budget(budget_id)
        parsed = parse_line_create(payload)
        _require_draft(budget)
        values = _line_values(parsed, budget)
        _require_distinct_cost_centers(budget, values)
        line = attempt(lambda: request.env[ITEM_MODEL].create(values))
        return request.make_json_response(_dump_lines(line)[0], status=201)

    @http.route(
        '/api/v1/finance/budgets/<int:budget_id>/lines/<int:line_id>', type='json2', auth='user', methods=['PATCH'], readonly=False,
    )
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def patch_line(self, budget_id, line_id, **payload):
        require_capability('finance.budgets.manage')
        _reject_path_keys('budget_id', 'line_id')
        budget = _find_budget(budget_id)
        line = _find_line(budget, line_id)
        parsed = parse_line_patch(payload)
        require_nonempty(parsed)
        _require_draft(budget)
        values = _line_values(parsed, budget, line)
        _require_distinct_cost_centers(budget, values, line)
        attempt(lambda: line.write(values))
        return _dump_lines(line)[0]

    @http.route('/api/v1/finance/budgets/<int:budget_id>/lines/distribute', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def distribute_line(self, budget_id, **payload):
        """Splits the budget of one account for a period between cost centers: one line per cost center, ``amount`` times its percent.

        The budget's cost-center split is switched on (OCA's overlap switch), so the lines can sit side by side. The
        rounding difference goes to the largest share, so the lines add up to ``amount`` to the cent.
        """
        require_capability('finance.budgets.manage')
        _reject_path_keys('budget_id')
        budget = _find_budget(budget_id)
        parsed = parse_distribution(payload)
        _require_draft(budget)
        currency = budget.company_id.currency_id
        shares = sorted(parsed['shares'], key=lambda share: -share['percent'])
        amounts = [currency.round(parsed['amount'] * share['percent'] / 100) for share in shares]
        amounts[0] = currency.round(amounts[0] + parsed['amount'] - sum(amounts))
        base = {key: value for key, value in parsed.items() if key not in ('shares', 'amount', 'analytic_account_id')}

        def distribute():
            budget.allow_items_overlap = True
            lines = request.env[ITEM_MODEL]
            for share, amount in zip(shares, amounts, strict=True):
                values = _line_values({**base, 'amount': amount, 'analytic_account_id': share['analytic_account_id']}, budget)
                _require_distinct_cost_centers(budget, values)
                lines |= request.env[ITEM_MODEL].create(values)
            return lines

        lines = attempt(distribute)
        return request.make_json_response({'items': _dump_lines(lines), 'total': len(lines)}, status=201)

    @http.route(
        '/api/v1/finance/budgets/<int:budget_id>/lines/<int:line_id>', type='json2', auth='user', methods=['DELETE'], readonly=False,
    )
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def delete_line(self, budget_id, line_id, **_):
        require_capability('finance.budgets.manage')
        budget = _find_budget(budget_id)
        line = _find_line(budget, line_id)
        _require_draft(budget)
        line.unlink()
        return request.make_json_response('', status=204)

    @http.route('/api/v1/finance/reports/budget-vs-actual', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('finance.enabled', operation='read')
    def budget_vs_actual(self, **_):
        """Per line the budget, the posted actual, the variance (budget minus actual) and that in percent of the budget.

        Up to ``date_to`` (default: the end of the budget); a budget line is prorated over the days up to it.
        """
        require_capability('finance.budgets.read')
        args = request.httprequest.args
        if not args.get('budget_id'):
            raise ApiError(422, 'invalid', 'budget_id is required', field='budget_id')
        budget = _find_budget(parse_positive_int(args['budget_id'], 'budget_id'))
        date_to = parse_day(args['date_to'], 'date_to') if args.get('date_to') else budget.date_to
        figures = _service()._webvue_line_figures(budget.item_ids, date_to)
        analytics = _service()._webvue_analytic_accounts(budget.item_ids)
        rows = [
            (line, analytics[line.id], _service()._webvue_nature(line.account_id), *figures[line])
            for line in budget.item_ids
        ]
        return dump_budget_vs_actual(budget, date_to, rows)
