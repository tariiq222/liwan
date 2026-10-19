# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Fiscal year-end closing: the year's income and expense balances move to the retained-earnings
account in one posted entry, then the fiscal-year lock date is set to the year end.

Stock Odoo needs no closing entry for the reports (the balance sheet adds the unallocated earnings of
open and earlier years itself), so this is the accounting act of allocating the result and locking the year.
Reopening is deliberately not offered: lock dates only move later here (see ``PATCH /setup/fiscal``).
"""
from datetime import date

from odoo import Command, fields, http
from odoo.http import request

from .common import require_capability
from .write_support import attempt, is_period_locked, period_locked
from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    requires_feature,
)
from odoo.addons.webvue_finance.models.closing_service import CLOSING_REF
from odoo.addons.webvue_finance.serializers.closing import (
    dump_closing_preview,
    dump_fiscal_year,
)

PNL_GROUPS = ('income', 'expense')
MIN_YEAR, MAX_YEAR = 1900, 2999


def _parse_year(year):
    if not MIN_YEAR <= year <= MAX_YEAR:
        raise ApiError(422, 'invalid', f'year must be from {MIN_YEAR} to {MAX_YEAR}', field='year')
    return year


def _posted_domain(company):
    return [('company_id', '=', company.id), ('parent_state', '=', 'posted')]


def _pnl_balances(company, extra_domain):
    """``[(account, balance)]`` of the posted income and expense lines, zero balances left out."""
    domain = [*_posted_domain(company), ('account_id.internal_group', 'in', PNL_GROUPS), *extra_domain]
    groups = request.env['account.move.line']._read_group(domain, groupby=['account_id'], aggregates=['balance:sum'])
    currency = company.currency_id
    balances = [(account, currency.round(balance)) for account, balance in groups]
    return sorted(((account, balance) for account, balance in balances if balance), key=lambda item: item[0].code or '')


def _closing_lines(company, balances, retained_earnings):
    """Each account balance reversed, the net result carried by the retained-earnings account."""
    currency = company.currency_id
    lines = [(account, max(-balance, 0.0), max(balance, 0.0)) for account, balance in balances]
    net = currency.round(sum(balance for _account, balance in balances))
    if net:
        lines.append((retained_earnings, max(net, 0.0), max(-net, 0.0)))
    return lines


def _lock_floor(company):
    """The latest lock date that already covers earlier years (None when nothing is locked)."""
    return max(company.fiscalyear_lock_date or date.min, company.hard_lock_date or date.min) or None


def _plan(company, year):
    """Everything a close of ``year`` would do, read in the caller's environment and written nowhere."""
    closing = request.env['webvue.finance.closing']
    dates = closing._webvue_year_dates(company, year)
    closing_entry = closing._webvue_closing_moves(company, year)[:1]
    year_lines = [('date', '>=', dates['date_from']), ('date', '<=', dates['date_to'])]
    if closing_entry:
        year_lines.append(('move_id', '!=', closing_entry.id))
    balances = _pnl_balances(company, year_lines)
    lock = company.fiscalyear_lock_date
    retained_earnings = request.env['account.account'].search([
        ('company_ids', 'in', company.id), ('account_type', '=', 'equity_unaffected'),
    ], limit=1)
    locked = bool(lock) and lock >= dates['date_to']
    return {
        'year': year, **dates, 'currency': company.currency_id, 'balances': balances, 'closing_entry': closing_entry,
        'state': 'closed' if closing_entry else 'locked' if locked else 'open',
        'result': company.currency_id.round(-sum(balance for _account, balance in balances)),
        'retained_earnings': retained_earnings,
        'journal': request.env['account.journal'].search([
            ('company_id', '=', company.id), ('type', '=', 'general'),
        ], limit=1),
        'lines': _closing_lines(company, balances, retained_earnings),
    }


def _year_summary(company, year, closing_moves):
    """The list item of ``year``: one query for its result, the closing entries having been read once."""
    dates = request.env['webvue.finance.closing']._webvue_year_dates(company, year)
    closing_entry = closing_moves.filtered(lambda move: move.webvue_closing_year == year)[:1]
    domain = [
        *_posted_domain(company), ('account_id.internal_group', 'in', PNL_GROUPS),
        ('date', '>=', dates['date_from']), ('date', '<=', dates['date_to']),
    ]
    if closing_entry:
        domain.append(('move_id', '!=', closing_entry.id))
    ((total,),) = request.env['account.move.line']._read_group(domain, aggregates=['balance:sum'])
    lock = company.fiscalyear_lock_date
    locked = bool(lock) and lock >= dates['date_to']
    return {
        'year': year, **dates, 'closing_entry': closing_entry,
        'state': 'closed' if closing_entry else 'locked' if locked else 'open',
        'result': company.currency_id.round(-(total or 0.0)),
    }


def _fiscal_years(company):
    """Every fiscal year from the first posted line to the current one, oldest first."""
    ((first, last),) = request.env['account.move.line']._read_group(
        _posted_domain(company), aggregates=['date:min', 'date:max'],
    )
    today = fields.Date.context_today(request.env.user)
    year = company.compute_fiscalyear_dates(first or today)['date_to'].year
    last_year = company.compute_fiscalyear_dates(max(last or today, today))['date_to'].year
    return list(range(year, last_year + 1))


def _blockers(company, plan):
    """Why the year cannot be closed now, in the order a close reports them: ``[(code, message, details)]``."""
    blockers = []
    if plan['date_to'] >= fields.Date.context_today(request.env.user):
        blockers.append(('year_not_ended', f'fiscal year {plan["year"]} has not ended yet', {}))
    drafts = request.env['account.move'].search_count([
        ('company_id', '=', company.id), ('state', '=', 'draft'),
        ('date', '>=', plan['date_from']), ('date', '<=', plan['date_to']),
    ])
    if drafts:
        blockers.append(('has_drafts', 'post or delete the draft entries of the year first', {'drafts': drafts}))
    # Earlier years covered by a lock date are allowed to keep unallocated results (the balance sheet shows them).
    floor = _lock_floor(company)
    earlier = [('date', '<', plan['date_from']), *([('date', '>', floor)] if floor else [])]
    if _pnl_balances(company, earlier):
        blockers.append(('previous_year_open', 'close the earlier fiscal years first', {}))
    if plan['lines']:
        # Closing lines cannot be posted to an archived account or one that forces a foreign currency.
        accounts = [*(account for account, _balance in plan['balances']), *plan['retained_earnings']]
        bad = [
            account.id for account in accounts
            if not account.active or (account.currency_id and account.currency_id != company.currency_id)
        ]
        if bad:
            blockers.append((
                'account_not_closable', 'archived accounts or accounts in a foreign currency hold a balance',
                {'account_ids': bad},
            ))
        if not plan['retained_earnings']:
            blockers.append(('no_retained_earnings_account', 'the company has no retained-earnings account', {}))
        if not plan['journal']:
            blockers.append(('no_general_journal', 'the company has no miscellaneous journal', {}))
    return blockers


def _require_not_closed(plan):
    if plan['state'] != 'open':
        raise ApiError(422, 'already_closed', f'fiscal year {plan["year"]} is already {plan["state"]}')


def _post_closing_entry(plan):
    name = request.env._('Year-end closing %(year)s', year=plan['year'])
    entry = request.env['account.move'].create({
        'move_type': 'entry',
        'journal_id': plan['journal'].id,
        'date': plan['date_to'],
        'ref': CLOSING_REF.format(year=plan['year']),
        'webvue_closing_year': plan['year'],
        'line_ids': [
            # No analytic distribution: a distribution model must not spread the closing amounts.
            Command.create({
                'account_id': account.id, 'name': name, 'debit': debit, 'credit': credit,
                'analytic_distribution': False,
            })
            for account, debit, credit in plan['lines']
        ],
    })
    entry.action_post()
    return entry


class FinanceClosingController(http.Controller):

    @http.route('/api/v1/finance/fiscal-years', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('finance.enabled', operation='read')
    def list_fiscal_years(self, **_):
        require_capability('finance.closing.read')
        company = request.env.company
        closing_moves = request.env['webvue.finance.closing']._webvue_closing_moves(company)
        items = [dump_fiscal_year(_year_summary(company, year, closing_moves)) for year in _fiscal_years(company)]
        return {'items': items, 'total': len(items)}

    @http.route(
        '/api/v1/finance/fiscal-years/<int:year>/closing-preview', type='json2', auth='user', methods=['GET'],
        readonly=True,
    )
    @api_handler
    @requires_feature('finance.enabled', operation='read')
    def get_closing_preview(self, year, **_):
        require_capability('finance.closing.read')
        company = request.env.company
        plan = _plan(company, _parse_year(year))
        _require_not_closed(plan)
        return dump_closing_preview(plan, _blockers(company, plan))

    @http.route('/api/v1/finance/fiscal-years/<int:year>/close', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def close_fiscal_year(self, year, **_):
        require_capability('finance.closing.manage')
        require_capability('finance.setup.manage')
        company = request.env.company
        plan = _plan(company, _parse_year(year))
        _require_not_closed(plan)
        for code, message, details in _blockers(company, plan):
            raise ApiError(422, code, message, details=details or None)
        if plan['lines']:
            if is_period_locked(plan['date_to'], plan['journal']):
                raise period_locked()
            plan['closing_entry'] = attempt(lambda: _post_closing_entry(plan), day=plan['date_to'], journal=plan['journal'])
        # The lock date is written by the setup elevation, so finance.setup.manage was checked above. Only ever later than the current lock (the plan is not closed): the tighten-only rule of the setup route.
        attempt(
            lambda: request.env['webvue.finance.setup']._webvue_write_company(company, {'fiscalyear_lock_date': plan['date_to']}),
        )
        plan['state'] = 'closed' if plan['closing_entry'] else 'locked'
        return dump_fiscal_year(plan)
