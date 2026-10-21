# Part of Odoo. See LICENSE file for full copyright and licensing details.
from decimal import Decimal

from odoo import fields, models

from odoo.addons.webvue_hr.models.payroll_math import eos_award, money, service_years

PROVISION_CASE = 'termination'


class WebVueHrPayrollEosAccrual(models.Model):
    """The end-of-service provision booked so far for one employee: the amount of the last posted month."""

    _name = 'webvue.hr.payroll.eos.accrual'
    _description = 'WebVue HR end-of-service accrual'
    _webvue_scope = 'company'

    employee_id = fields.Many2one('hr.employee', required=True, ondelete='cascade', index=True)
    company_id = fields.Many2one(related='employee_id.company_id', store=True, index=True)
    currency_id = fields.Many2one(related='company_id.currency_id')
    amount = fields.Monetary()
    month = fields.Date(help='The first day of the month the amount was posted for.')

    _employee_unique = models.Constraint('UNIQUE(employee_id)', 'an employee has one end-of-service accrual')

    def _webvue_target(self, employee, compensation, month_start, month_end):
        """What the provision of ``employee`` should hold at ``month_end``: the award if they are still employed."""
        if employee.departure_date and employee.departure_date <= month_end:
            return money(0)
        start = self.env['webvue.hr.payroll.eos.settlement']._webvue_service_start(employee)
        if not start or start > month_end:
            return money(0)
        return eos_award(compensation._webvue_fixed_wage(), service_years(start, month_end), PROVISION_CASE)

    def _webvue_deltas(self, run):
        """``[(employee, slip, delta, target)]`` of the month of ``run``, zero deltas left out.

        ``delta = target - (last accrual - paid)``: what the run already paid out of the provision is
        not owed any more, so it does not have to be provisioned again.
        """
        month_start = run.date_start
        compensations = self.env['webvue.hr.compensation'].search([('company_id', '=', run.company_id.id)])
        accruals = {accrual.employee_id: accrual for accrual in self.search([('company_id', '=', run.company_id.id)])}
        slips = {slip.employee_id: slip for slip in run.slip_ids}
        wages = {compensation.employee_id: compensation for compensation in compensations}
        rows = []
        for employee in sorted(wages.keys() | accruals.keys(), key=lambda employee: (employee.name or '', employee.id)):
            compensation = wages.get(employee)
            target = self._webvue_target(employee, compensation, month_start, run.date_end) if compensation else money(0)
            slip = slips.get(employee, self.env['hr.payslip'])
            paid = sum((Decimal(str(line.total)) for line in slip.line_ids if line.code == 'EOS'), Decimal(0))
            last = Decimal(str(accruals[employee].amount)) if employee in accruals else Decimal(0)
            delta = money(target - (last - paid))
            if delta or employee in accruals or target:
                rows.append((employee, slip, delta, target))
        return rows

    def _webvue_remember(self, rows, month_start):
        """Store ``target`` as the last posted accrual of each employee."""
        for employee, _slip, _delta, target in rows:
            accrual = self.search([('employee_id', '=', employee.id)], limit=1)
            values = {'amount': float(target), 'month': month_start}
            if accrual:
                accrual.write(values)
            else:
                self.create({'employee_id': employee.id, **values})
