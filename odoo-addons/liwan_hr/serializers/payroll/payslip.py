# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.addons.liwan_hr.models.hr_payslip import GOSI_EMPLOYER_CODES, NET_CODE
from odoo.addons.liwan_hr.serializers.assets.common import ref
from odoo.addons.liwan_hr.serializers.payroll.currency import currency_code

# Shown through their own fields: the net, and the employer share grouped under ``gosi_employer``.
SEPARATE_CODES = (NET_CODE, *GOSI_EMPLOYER_CODES)


def dump_payslip_line(line):
    return {'code': line.code, 'name': line.name, 'category': line.category_id.code, 'amount': line.total}


def dump_my_payslip_summary(slip):
    return {
        'id': slip.id,
        'number': slip.number or '',
        'month': slip.date_from.strftime('%Y-%m'),
        'net': slip._liwan_amounts()[slip.id]['net'],
        'currency': currency_code(slip.company_id),
    }


def dump_payslip(slip):
    """One payslip: the lines it shows (signed, no zero amounts) and its figures, the employer share apart."""
    amounts = slip._liwan_amounts()[slip.id]
    lines = slip.line_ids.filtered(
        lambda line: line.appears_on_payslip and line.code not in SEPARATE_CODES and line.total,
    )
    return {
        'id': slip.id,
        'number': slip.number or '',
        'month': slip.date_from.strftime('%Y-%m'),
        'state': slip.state,
        'employee': ref(slip.employee_id),
        'department': ref(slip.liwan_department_id),
        'paid_days': slip.liwan_paid_days,
        'lines': [dump_payslip_line(line) for line in lines.sorted('sequence')],
        **{key: amounts[key] for key in ('gross', 'deductions', 'net', 'gosi_employer')},
        'company': {'name': slip.company_id.name, 'vat': slip.company_id.vat or ''},
        'currency': currency_code(slip.company_id),
    }
