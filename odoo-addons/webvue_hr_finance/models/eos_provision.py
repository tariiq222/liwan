# Part of Odoo. See LICENSE file for full copyright and licensing details.
from collections import defaultdict
from decimal import Decimal

from odoo import Command, api, fields, models

from odoo.addons.webvue_api.controllers.common import ApiError
from odoo.addons.webvue_finance.controllers.write_support import (
    attempt,
    is_period_locked,
    period_locked,
    require_balanced,
)
from odoo.addons.webvue_hr.models.payroll_math import money


class WebVueHrPayrollEosProvision(models.Model):
    """The end-of-service provision entry of one company month."""

    _name = 'webvue.hr.payroll.eos.provision'
    _description = 'WebVue HR end-of-service provision'
    _webvue_scope = 'company'
    _order = 'month desc'

    company_id = fields.Many2one('res.company', required=True, index=True, ondelete='cascade')
    month = fields.Date(required=True)
    move_id = fields.Many2one('account.move', required=True, ondelete='restrict', index=True)

    _month_unique = models.Constraint('UNIQUE(company_id, month)', 'the provision of a month is posted once')

    @api.model
    def _webvue_provision_lines(self, run, settings, rows):
        """The entry lines of ``rows``: expense debit and provision credit for a positive delta, reversed otherwise."""
        posting = self.env['webvue.hr.payroll.posting']
        per_employee = settings.entry_detail == 'per_employee'
        last_slips = self._webvue_last_slips(run, [employee for employee, slip, _delta, _target in rows if not slip])
        departments = run.slip_ids.webvue_department_id | self.env['hr.payslip'].concat(
            *last_slips.values(),
        ).webvue_department_id
        centers = posting._webvue_department_centers(departments)
        balances = defaultdict(Decimal)
        for employee, slip, delta, _target in rows:
            if not delta:
                continue
            source = slip or last_slips.get(employee, self.env['hr.payslip'])
            department = source.webvue_department_id
            analytic = posting._webvue_department_analytic(
                department, employee, centers, settings.default_analytic_account_id, [],
            )
            booked = employee if per_employee else self.env['hr.employee']
            balances['eos_expense', analytic.id, booked] += delta
            balances['eos_provision', False, booked] -= delta
        missing = sorted({role for role, _analytic, _employee in balances if not settings[f'{role}_account_id']})
        if missing:
            raise ApiError(
                422, 'settings_incomplete', 'the payroll accounts are not all set', field='accounts',
                details={'accounts': missing},
            )
        return [posting._webvue_line(run, settings, key, balance) for key, balance in balances.items() if money(balance)]

    @api.model
    def _webvue_last_slips(self, run, employees):
        """``{employee: their latest payslip of an earlier run of the company}``.

        An employee with no payslip this month (a leaver) is booked to the department snapshot of their last
        payslip, which payroll users read; the live department sits on the contract version they may not read.
        """
        slips = self.env['hr.payslip'].search([
            ('employee_id', 'in', [employee.id for employee in employees]),
            ('payslip_run_id.company_id', '=', run.company_id.id),
            ('payslip_run_id.date_start', '<', run.date_start),
        ], order='date_from desc, id desc')
        latest = {}
        for slip in slips:
            latest.setdefault(slip.employee_id, slip)
        return latest

    @api.model
    def _webvue_post_provision(self, company, month_start):
        """Book the end-of-service provision of ``month_start`` and return its posted entry."""
        run = self.env['hr.payslip.run'].search([
            ('company_id', '=', company.id), ('date_start', '=', month_start),
            ('webvue_state', 'in', ('posted', 'paid')),
        ], limit=1)
        if not run:
            raise ApiError(403, 'transition_forbidden', 'the payroll run of the month must be posted first', field='month')
        if self.search_count([('company_id', '=', company.id), ('month', '>=', month_start)]):
            raise ApiError(422, 'duplicate', 'the provision of this month or a later one is already posted', field='month')
        unposted = self.env['hr.payslip.run'].search_count([
            ('company_id', '=', company.id), ('date_start', '<', month_start),
            ('webvue_state', 'in', ('draft', 'computed', 'approved')),
        ])
        if unposted:
            raise ApiError(
                422, 'earlier_run_unposted', 'post every earlier payroll run before this provision', field='month',
            )
        settings = self.env['webvue.hr.payroll.finance.settings']._webvue_for_company(company)
        journal = self.env['webvue.hr.payroll.posting']._webvue_journal(settings)
        if is_period_locked(run.date_end, journal):
            raise period_locked(field='month')
        rows = self.env['webvue.hr.payroll.eos.accrual']._webvue_deltas(run)
        lines = self._webvue_provision_lines(run, settings, rows)
        if not lines:
            raise ApiError(422, 'invalid', 'there is no end-of-service provision to post for this month', field='month')
        require_balanced(lines)
        move = self.env['account.move'].create({
            'move_type': 'entry',
            'date': run.date_end,
            'journal_id': journal.id,
            'ref': f'{run.name} EOS',
            'webvue_payroll_origin': 'eos_provision',
            'line_ids': [
                Command.create({key: value for key, value in line.items() if key != 'employee_id'}) for line in lines
            ],
        })
        attempt(move.action_post, day=run.date_end, journal=journal)
        self.env['webvue.hr.payroll.eos.accrual']._webvue_remember(rows, month_start)
        return self.create({'company_id': company.id, 'month': month_start, 'move_id': move.id})
