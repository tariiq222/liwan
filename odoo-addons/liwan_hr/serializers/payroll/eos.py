# Part of Odoo. See LICENSE file for full copyright and licensing details.
import math

from odoo.addons.liwan_api.controllers.common import ApiError, parse_positive_int
from odoo.addons.liwan_hr.models.payroll_math import EOS_CASES
from odoo.addons.liwan_hr.serializers.assets.common import ref, reject_unknown
from odoo.addons.liwan_hr.serializers.dates import parse_optional_date
from odoo.addons.liwan_hr.serializers.payroll.currency import currency_code
from odoo.addons.liwan_hr.serializers.payroll.revision import stored_revision

SETTLEMENT_FIELDS = ('case', 'open_deductions')
CASE_MAP_FIELDS = ('departure_reason_id', 'case')
YEARS_PLACES = 4


def _case(value, field='case'):
    if value not in EOS_CASES:
        raise ApiError(422, 'invalid', f"{field} must be one of {', '.join(EOS_CASES)}", field=field)
    return value


def parse_estimate_args(args):
    """``(date or None, case or None)`` from the estimate query string."""
    day = parse_optional_date(args.get('date'), 'date') or None
    case = _case(args['case']) if args.get('case') else None
    return day, case


def parse_settlement(payload):
    """``(case or None, open_deductions or None)``; a missing key keeps the stored or mapped value."""
    reject_unknown(payload, SETTLEMENT_FIELDS)
    case = _case(payload['case']) if payload.get('case') else None
    deductions = payload.get('open_deductions')
    if deductions is not None and (
        isinstance(deductions, bool) or not isinstance(deductions, (int, float))
        or not math.isfinite(deductions) or deductions < 0
    ):
        raise ApiError(422, 'invalid', 'open_deductions must be zero or more', field='open_deductions')
    return case, deductions


def parse_case_map(payload, env):
    """``(departure reason record, case)`` of one mapping edit."""
    reject_unknown(payload, CASE_MAP_FIELDS)
    if 'departure_reason_id' not in payload:
        raise ApiError(422, 'invalid', 'departure_reason_id is required', field='departure_reason_id')
    reason = env['hr.departure.reason'].browse(parse_positive_int(payload['departure_reason_id'], 'departure_reason_id')).exists()
    if not reason:
        raise ApiError(422, 'invalid', 'departure_reason_id does not reference a departure reason', field='departure_reason_id')
    return reason, _case(payload.get('case'))


def _years(value):
    return round(float(value), YEARS_PLACES)


def dump_estimate(employee, estimate):
    return {
        'employee': ref(employee),
        'start_date': estimate['start_date'].isoformat(),
        'end_date': estimate['end_date'].isoformat(),
        'service_years': _years(estimate['service_years']),
        'eos_wage': float(estimate['eos_wage']),
        'case': estimate['case'],
        'award': float(estimate['award']),
        'leave_days': float(estimate['leave_days']),
        'leave_amount': float(estimate['leave_amount']),
        'currency': currency_code(employee.company_id),
    }


def dump_settlement(settlement):
    return {
        'id': settlement.id,
        'employee': ref(settlement.employee_id),
        'state': settlement.state,
        'departure_date': settlement.departure_date.isoformat() if settlement.departure_date else None,
        'departure_mismatch': settlement._liwan_departure_mismatch(),
        'case': settlement.case,
        'service_years': _years(settlement.service_years),
        'eos_wage': settlement.eos_wage,
        'award': settlement.award,
        'leave_days': settlement.leave_days,
        'leave_amount': settlement.leave_amount,
        'open_deductions': settlement.open_deductions,
        'total': settlement.total,
        'currency': currency_code(settlement.employee_id.company_id),
    }


def dump_case_item(reason, case, company_row):
    """``revision`` is the company's own row's, the one a PUT sends: 0 while the reason has none."""
    return {'departure_reason': ref(reason), 'case': case or None, 'revision': stored_revision(company_row)}
