# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from .common import parse_day, require_capability
from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    requires_feature,
)
from odoo.addons.webvue_finance.serializers.setup import dump_setup

# The hard lock date is irreversible in stock Odoo, so this route never writes it.
LOCK_DATE_FIELDS = ('fiscalyear_lock_date', 'tax_lock_date', 'sale_lock_date', 'purchase_lock_date')
FISCAL_DAYS = range(1, 32)
FISCAL_MONTHS = range(1, 13)


def _require_payload(payload, allowed):
    unknown = sorted(set(payload) - set(allowed))
    if unknown:
        raise ApiError(422, 'invalid', f'unknown field: {unknown[0]}', field=unknown[0])
    if not payload:
        raise ApiError(422, 'invalid', 'no fields to update')


def _parse_int_in(value, field, allowed):
    if isinstance(value, bool) or not isinstance(value, int) or value not in allowed:
        raise ApiError(422, 'invalid', f'{field} must be an integer from {allowed[0]} to {allowed[-1]}', field=field)
    return value


def _parse_lock_date(value, field):
    if value is None:
        return False
    if not isinstance(value, str):
        raise ApiError(422, 'invalid', f'{field} must be an ISO date (YYYY-MM-DD) or null', field=field)
    return parse_day(value, field)


def _require_not_loosened(field, new_value, current):
    if current and (not new_value or new_value < current):
        raise ApiError(
            422, 'lock_date_loosening',
            f'{field} can only move later here; an accounting administrator loosens it in Odoo', field=field,
        )


def parse_fiscal_vals(payload, company):
    _require_payload(payload, ('fiscalyear_last_day', 'fiscalyear_last_month', *LOCK_DATE_FIELDS))
    vals = {}
    for field, value in payload.items():
        if field == 'fiscalyear_last_day':
            vals[field] = _parse_int_in(value, field, FISCAL_DAYS)
        elif field == 'fiscalyear_last_month':
            vals[field] = str(_parse_int_in(value, field, FISCAL_MONTHS))
        else:
            vals[field] = _parse_lock_date(value, field)
            _require_not_loosened(field, vals[field], company[field])

    fiscal_fields = ('fiscalyear_last_day', 'fiscalyear_last_month')
    fiscal_year_changes = any(
        field in vals and vals[field] != company[field]
        for field in fiscal_fields
    )
    if fiscal_year_changes and request.env['account.move'].search_count([
        ('company_id', '=', company.id), ('state', '=', 'posted'),
    ]):
        # Corrections after posted entries require an operator maintenance window, not an API path.
        raise ApiError(
            422, 'fiscal_year_has_posted_entries',
            'the fiscal year end cannot be changed after journal entries have been posted',
        )
    return vals


class FinanceSetupController(http.Controller):

    @http.route('/api/v1/finance/setup', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('finance.enabled', operation='read')
    def get_setup(self, **_):
        require_capability('finance.setup.read')
        return dump_setup(request.env.company)

    @http.route('/api/v1/finance/setup/chart', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def load_chart(self, **_):
        require_capability('finance.setup.manage')
        company = request.env.company
        request.env['webvue.finance.setup']._webvue_load_chart(company)
        return dump_setup(company)

    @http.route('/api/v1/finance/setup/fiscal', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def patch_fiscal(self, **payload):
        require_capability('finance.setup.manage')
        request.env['webvue.finance.setup']._webvue_write_company(request.env.company, parse_fiscal_vals(payload, request.env.company))
        return dump_setup(request.env.company)
