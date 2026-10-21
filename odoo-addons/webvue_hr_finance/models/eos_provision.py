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
        centers = posting._webvue_cost_centers(run)
        balances = defaultdict(Decimal)
        for employee, slip, delta, _target in rows:
            if not delta:
                continue
            analytic = posting._webvue_slip_analytic(slip, centers, settings.default_analytic_account_id, [])
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
        settings = self.env['webvue.hr.payroll.finance.settings']._webvue_for_company(company)
        journal = settings.journal_id
        if not journal:
            raise ApiError(422, 'settings_incomplete', 'the payroll journal is not set', field='journal_id')
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
