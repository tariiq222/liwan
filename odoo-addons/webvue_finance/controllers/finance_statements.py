# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from .common import parse_choice, parse_period, require_capability
from .finance_partners import company_partners_domain
from .statement_support import parse_kind, parse_only_posted, parse_required_day
from .write_support import company_records
from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    parse_page,
    parse_positive_int,
    requires_feature,
)
from odoo.addons.webvue_finance.serializers.statement import (
    dump_aged_partner_balance,
    dump_general_ledger,
    dump_partner_statement,
    dump_trial_balance,
    statement_line_ids,
)

STATEMENT_TYPES = ('activity', 'outstanding')


def _optional_partner():
    value = request.httprequest.args.get('partner_id')
    if not value:
        return request.env['res.partner']
    return company_records('res.partner', [parse_positive_int(value, 'partner_id')], 'partner_id', company_partners_domain())


def _optional_account():
    value = request.httprequest.args.get('account_id')
    if not value:
        return request.env['account.account']
    return company_records(
        'account.account', [parse_positive_int(value, 'account_id')], 'account_id',
        [('company_ids', 'in', [request.env.company.id])],
    )


class FinanceStatementController(http.Controller):
    """The OCA account_financial_report and partner_statement reports, as JSON, in the company currency."""

    @http.route('/api/v1/finance/reports/trial-balance', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('finance.enabled', operation='read')
    def trial_balance(self, **_):
        """Debit, credit and balances per account for a period, with the totals (OCA account_financial_report)."""
        require_capability('finance.statements.read')
        date_from, date_to = parse_period(request.httprequest.args)
        only_posted = parse_only_posted()
        company = request.env.company
        values = request.env['webvue.finance.statement.report']._webvue_trial_balance(
            company, date_from, date_to, only_posted,
        )
        return dump_trial_balance(company, date_from, date_to, only_posted, values)

    @http.route('/api/v1/finance/reports/general-ledger', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('finance.enabled', operation='read')
    def general_ledger(self, **_):
        """The ledger; ``limit``/``offset`` page the lines of the one ``account_id`` they require (date order)."""
        require_capability('finance.statements.read')
        date_from, date_to = parse_period(request.httprequest.args)
        only_posted = parse_only_posted()
        limit, offset = parse_page(request.httprequest.args)
        args = request.httprequest.args
        if ('limit' in args or 'offset' in args) and not args.get('account_id'):
            raise ApiError(422, 'invalid', 'account_id is required to page the lines', field='account_id')
        account, partner = _optional_account(), _optional_partner()
        company = request.env.company
        values = request.env['webvue.finance.statement.report']._webvue_general_ledger(
            company, date_from, date_to, only_posted, account, partner,
        )
        return dump_general_ledger(company, date_from, date_to, only_posted, values, limit, offset)

    @http.route('/api/v1/finance/reports/aged-partner-balance', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('finance.enabled', operation='read')
    def aged_partner_balance(self, **_):
        """Open balances as of ``date_to``, aged from their due date; ``kind`` is receivable (default) or payable."""
        require_capability('finance.statements.read')
        date_to = parse_required_day('date_to')
        only_posted = parse_only_posted()
        account_type = parse_kind(required=False)
        partner = _optional_partner()
        company = request.env.company
        values = request.env['webvue.finance.statement.report']._webvue_aged_partner_balance(
            company, date_to, only_posted, account_type, partner,
        )
        return dump_aged_partner_balance(company, date_to, only_posted, account_type, values)

    @http.route('/api/v1/finance/reports/partner-statement', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('finance.enabled', operation='read')
    def partner_statement(self, **_):
        """``type=activity`` (default, ``date_from`` and ``date_to``) or ``type=outstanding`` (open items up to ``date_to``)."""
        require_capability('finance.statements.read')
        args = request.httprequest.args
        statement_type = parse_choice(args.get('type'), STATEMENT_TYPES, 'type') or 'activity'
        partner = company_records(
            'res.partner', [parse_positive_int(args.get('partner_id'), 'partner_id')], 'partner_id', company_partners_domain(),
        )
        if partner != partner.commercial_partner_id:
            raise ApiError(422, 'invalid', 'a statement is for a company or a person, not for a contact of one', field='partner_id')
        account_type = parse_kind(required=False)
        if statement_type == 'activity':
            date_from, date_to = parse_period(args)
        else:
            date_from, date_to = None, parse_required_day('date_to')
        company = request.env.company
        values = request.env['webvue.finance.statement.report']._webvue_partner_statement(
            company, partner, account_type, date_to, date_from,
        )
        move_lines = request.env['account.move.line'].browse(statement_line_ids(values))
        return dump_partner_statement(
            company, partner, account_type, date_from, date_to, values,
            {line.id: line for line in move_lines},
        )
