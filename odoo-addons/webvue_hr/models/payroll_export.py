# Part of Odoo. See LICENSE file for full copyright and licensing details.
import csv
import io
from dataclasses import dataclass
from decimal import Decimal

from odoo import api, models

from .hr_payslip import DEDUCTION_CODES, OTHER_ALLOWANCE_CODES
from .payroll_math import money
from odoo.addons.webvue_hr.rules import WebVueHrRule

# The figures of a salary and a WPS line are the payslip line codes ``hr_payslip`` owns.
GOSI_CODES = {
    ('annuities', 'employee'): 'GOSI_EE_ANN',
    ('annuities', 'employer'): 'GOSI_ER_ANN',
    ('saned', 'employee'): 'GOSI_EE_SANED',
    ('saned', 'employer'): 'GOSI_ER_SANED',
    ('hazards', 'employer'): 'GOSI_ER_OH',
}
GOSI_WAGE_CODE = 'GOSI_WAGE'
TOTALS_MISMATCH = 'wps_totals_mismatch'
FORMULA_STARTS = ('=', '+', '-', '@', '\t', '\r')
NUMERIC_SOURCES = ('basic', 'housing', 'other_allowances', 'deductions', 'net')


@dataclass(frozen=True)
class SalaryLine:
    """What one employee is paid for a run, as the salary files show it. Built on demand, never stored."""

    employee_id: int
    employee_ref: str
    identification: str
    name: str
    iban: str
    bank_code: str
    basic: Decimal
    housing: Decimal
    other_allowances: Decimal
    deductions: Decimal
    net: Decimal


def _amount(value):
    return format(money(value), 'f')


def _safe_text(value):
    """A text cell that a spreadsheet cannot read as a formula: a leading apostrophe defuses it."""
    return f"'{value}" if value.startswith(FORMULA_STARTS) else value


class WebVueHrPayrollExport(models.AbstractModel):
    """The salary files and the GOSI statement of an approved run, built from its payslip lines."""

    _name = 'webvue.hr.payroll.export'
    _description = 'WebVue HR payroll export'

    @api.model
    def _webvue_line_totals(self, run):
        """``{payslip_id: {code: total}}`` over the payslips of ``run``."""
        totals = {slip.id: {} for slip in run.slip_ids}
        groups = self.env['hr.payslip.line']._read_group(
            [('slip_id', 'in', run.slip_ids.ids)], ['slip_id', 'code'], ['total:sum'],
        )
        for slip, code, total in groups:
            totals[slip.id][code] = Decimal(str(total))
        return totals

    @api.model
    def _webvue_salary_lines(self, run):
        """One ``SalaryLine`` per payslip of the run, ordered by employee name.

        The IBAN, bank code and identification number are the ones stored on the payslip when the run was approved;
        a later change to the compensation or the employee never reaches a salary file of an approved run.
        """
        totals = self._webvue_line_totals(run)
        lines = []
        for slip in run.slip_ids.sorted(lambda row: (row.employee_id.name or '', row.id)):
            employee = slip.employee_id
            codes = totals[slip.id]

            def total(names, codes=codes):
                return money(sum((codes.get(name, Decimal(0)) for name in names), Decimal(0)))

            lines.append(SalaryLine(
                employee_id=employee.id,
                employee_ref=str(employee.id),
                identification=slip.webvue_identification or '',
                name=employee.name or '',
                iban=slip.webvue_iban or '',
                bank_code=slip.webvue_bank_code or '',
                basic=total(('BASIC',)),
                housing=total(('HOUSING',)),
                other_allowances=total(OTHER_ALLOWANCE_CODES),
                deductions=Decimal(0) - total(DEDUCTION_CODES),
                net=total(('NET',)),
            ))
        return lines

    @api.model
    def _webvue_check_totals(self, lines):
        """The WPS rule: every line's earnings less its deductions equal its net pay, else 422."""
        broken = [
            line.employee_id for line in lines
            if line.basic + line.housing + line.other_allowances - line.deductions != line.net
        ]
        if broken:
            raise WebVueHrRule(
                TOTALS_MISMATCH, self.env._('The salary figures of an employee do not add up to the net pay.'),
                field='employee_id', details={'employee_ids': broken},
            )

    @api.model
    def _webvue_render(self, profile, lines, value_date):
        """The CSV of ``lines`` laid out by ``profile``, encoded as the profile says."""
        columns = profile.column_ids.sorted('sequence')
        buffer = io.StringIO(newline='')
        writer = csv.writer(buffer, delimiter=profile.delimiter, quoting=csv.QUOTE_MINIMAL, lineterminator='\r\n')
        if profile.include_header:
            writer.writerow([_safe_text(column.label) for column in columns])
        for line in lines:
            writer.writerow([self._webvue_cell(column, line, value_date) for column in columns])
        if profile.footer == 'totals':
            writer.writerow([
                _amount(sum((getattr(line, column.source) for line in lines), Decimal(0)))
                if column.source in NUMERIC_SOURCES else ''
                for column in columns
            ])
        return buffer.getvalue().encode(profile.encoding)

    @api.model
    def _webvue_cell(self, column, line, value_date):
        source = column.source
        if source in NUMERIC_SOURCES:
            return _amount(getattr(line, source))
        if source == 'value_date':
            return value_date.isoformat()
        if source == 'constant':
            return _safe_text(column.constant_value or '')
        return _safe_text(getattr(line, source))

    @api.model
    def _webvue_gosi_statement(self, run):
        """The GOSI statement of a run: per employee the contributory wage and the share of each branch."""
        totals = self._webvue_line_totals(run)
        compensations = self.env['webvue.hr.compensation'].search([('employee_id', 'in', run.slip_ids.employee_id.ids)])
        by_employee = {record.employee_id.id: record for record in compensations}
        lines = []
        for slip in run.slip_ids.sorted(lambda row: (row.employee_id.name or '', row.id)):
            codes = totals[slip.id]
            if not any(codes.get(code) for code in (GOSI_WAGE_CODE, *GOSI_CODES.values())):
                continue
            employee = slip.employee_id
            compensation = by_employee.get(employee.id)
            branches = {}
            for branch in ('annuities', 'saned', 'hazards'):
                branches[branch] = {
                    'employee': money(Decimal(0) - codes.get(GOSI_CODES.get((branch, 'employee')), Decimal(0))),
                    'employer': money(codes.get(GOSI_CODES.get((branch, 'employer')), Decimal(0))),
                }
            lines.append({
                'employee': employee,
                'gosi_number': (compensation.gosi_number if compensation else '') or '',
                'nationality_class': slip.webvue_gosi_class,
                'contributory_wage': money(codes.get(GOSI_WAGE_CODE, Decimal(0))),
                'branches': branches,
                'employee_amount': sum((branch['employee'] for branch in branches.values()), Decimal(0)),
                'employer_amount': sum((branch['employer'] for branch in branches.values()), Decimal(0)),
            })
        return {'month': run.date_start.strftime('%Y-%m'), 'lines': lines}
