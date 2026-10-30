# Part of Odoo. See LICENSE file for full copyright and licensing details.
import math
import re
from datetime import date

from odoo.addons.liwan_api.controllers.common import ApiError
from odoo.addons.liwan_api.serializers.common import iso
from odoo.addons.liwan_hr.models.hr_payslip import INPUT_CODES
from odoo.addons.liwan_hr.serializers.assets.common import ref
from odoo.addons.liwan_hr.serializers.payroll.currency import currency_code

MONTH = re.compile(r'(\d{4})-(0[1-9]|1[0-2])')


def run_states(env):
    """The run states the lifecycle field offers, bridges included (a bridge adds its own through ``selection_add``)."""
    return tuple(key for key, _label in env['hr.payslip.run']._fields['liwan_state'].selection)


def parse_month(payload):
    """The first day of the requested ``YYYY-MM`` month."""
    value = payload.get('month')
    match = MONTH.fullmatch(value) if isinstance(value, str) else None
    if not match:
        raise ApiError(422, 'invalid', 'month must be a YYYY-MM month', field='month')
    return date(int(match.group(1)), int(match.group(2)), 1)


def parse_inputs(payload):
    """``{engine input code: amount}`` for a non-empty subset of the five input keys; each is zero or more."""
    if not payload:
        raise ApiError(422, 'invalid', 'no fields to update')
    values = {}
    for key, amount in payload.items():
        if key not in INPUT_CODES:
            raise ApiError(422, 'invalid', f'field {key!r} is not writable', field=key)
        if isinstance(amount, bool) or not isinstance(amount, (int, float)) or not math.isfinite(amount) or amount < 0:
            raise ApiError(422, 'invalid', f'{key} must be a number, zero or more', field=key)
        values[INPUT_CODES[key]] = amount
    return values


def dump_run_summary(run):
    return {
        'id': run.id,
        'month': run.date_start.strftime('%Y-%m'),
        'state': run.liwan_state,
        'employee_count': len(run.slip_ids),
        'totals': run._liwan_totals(),
        'approved_at': iso(run.liwan_approved_at),
        'currency': currency_code(run.company_id),
    }


def dump_run(run):
    finance = run.env['liwan.hr.payroll.finance.link']._liwan_finance_refs(run)
    return {
        **dump_run_summary(run),
        'warnings': [
            {'code': warning['code'], 'employee': ref(warning['employee'])} for warning in run._liwan_warnings()
        ],
        'allowed_actions': run._liwan_allowed_actions(),
        'approved_by': ref(run.liwan_approved_by_id),
        'finance': finance,
    }


def dump_payslip_rows(payslips):
    """The rows of a payslip list, with their figures and IBAN flags computed once for the whole page."""
    amounts = payslips._liwan_amounts()
    iban_missing = payslips._liwan_iban_missing()
    return [
        {
            'id': slip.id,
            'employee': ref(slip.employee_id),
            'department': ref(slip.liwan_department_id),
            'state': slip.state,
            'paid_days': slip.liwan_paid_days,
            'inputs': slip._liwan_inputs(),
            **{key: amounts[slip.id][key] for key in ('gross', 'deductions', 'net')},
            'iban_missing': slip.id in iban_missing,
        }
        for slip in payslips
    ]
