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
from odoo.addons.webvue_hr_finance.models.payroll_finance_settings import account_field

# Codes of the shipped Saudi structure, not a bank layout. A line posts as its signed total: a positive total
# is a debit, a negative one a credit. NET is the exception, the pay owed to the employee, which is a credit.
RULE_ACCOUNT_ROLES = {
    'BASIC': 'basic_expense', 'ABSENCE': 'basic_expense', 'UNPAID': 'basic_expense',
    'HOUSING': 'allowance_expense', 'TRANSPORT': 'allowance_expense', 'OTHER': 'allowance_expense',
    'OVERTIME': 'variable_expense', 'BONUS': 'variable_expense', 'LEAVE_ENC': 'variable_expense',
    'EOS': 'eos_provision',
    'DEDUCTION': 'deduction', 'SETTLEMENT_DED': 'deduction', 'ADVANCE': 'advance',
    'GOSI_EE_ANN': 'gosi_payable', 'GOSI_EE_SANED': 'gosi_payable',
    'NET': 'salaries_payable',
}
# The employer share is an expense and a liability at once.
EMPLOYER_GOSI_CODES = ('GOSI_ER_ANN', 'GOSI_ER_SANED', 'GOSI_ER_OH')
CREDIT_CODES = ('NET',)
# The advance is a receivable from one employee, so it always names the employee.
EMPLOYEE_ROLES = ('advance',)
UNMAPPED_DEPARTMENT = 'unmapped_department'
PAYMENT_JOURNAL_TYPES = ('bank', 'cash')


class WebVueHrPayrollPosting(models.AbstractModel):
    """Turns an approved payroll run into one balanced journal entry in the caller's environment."""

    _name = 'webvue.hr.payroll.posting'
    _description = 'WebVue HR payroll posting'
    _webvue_scope = 'global'

    @api.model
    def _webvue_slip_amounts(self, slip):
        """``[(role, signed amount)]`` of one payslip, the amount being debit minus credit."""
        totals = defaultdict(Decimal)
        for line in slip.line_ids:
            totals[line.code] += Decimal(str(line.total))
        amounts = []
        for code, role in RULE_ACCOUNT_ROLES.items():
            if code in totals:
                amounts.append((role, -totals[code] if code in CREDIT_CODES else totals[code]))
        employer = sum((totals[code] for code in EMPLOYER_GOSI_CODES), Decimal(0))
        amounts += [('gosi_expense', employer), ('gosi_payable', -employer)]
        return [(role, amount) for role, amount in amounts if amount]

    @api.model
    def _webvue_slip_analytic(self, slip, centers, default, warnings):
        """The cost center of the payslip's department snapshot, else the default with a warning."""
        mapped = centers.get(slip.webvue_department_id.id)
        if mapped:
            return mapped
        if not default:
            raise ApiError(
                422, 'missing_cost_center', 'a department has no cost center and no default cost center is set',
                field='default_analytic_account_id', details={'employee_id': slip.employee_id.id},
            )
        warnings.append({'code': UNMAPPED_DEPARTMENT, 'employee': slip.employee_id})
        return default

    @api.model
    def _webvue_cost_centers(self, run):
        """``{department id: analytic account}`` of the departments on the payslips of ``run``."""
        return {
            center.department_id.id: center.analytic_account_id
            for center in self.env['webvue.hr.payroll.cost.center'].search([
                ('department_id', 'in', run.slip_ids.webvue_department_id.ids),
            ]) if center.analytic_account_id
        }

    @api.model
    def _webvue_posting_lines(self, run, settings):
        """``(lines, warnings)`` of the entry of ``run`` under ``settings``.

        A line is ``{account_id, name, debit, credit, employee_id, partner_id?, analytic_distribution?}``;
        ``employee_id`` is for the preview and is not a field of the entry line.
        """
        run.ensure_one()
        per_employee = settings.entry_detail == 'per_employee'
        centers = self._webvue_cost_centers(run)
        balances = defaultdict(Decimal)
        warnings = []
        for slip in run.slip_ids.sorted(lambda slip: (slip.employee_id.name or '', slip.id)):
            analytic = None  # resolved once per payslip, and only when it books an expense
            for role, amount in self._webvue_slip_amounts(slip):
                cost_center = self.env['account.analytic.account']
                if role.endswith('_expense'):
                    analytic = analytic or self._webvue_slip_analytic(
                        slip, centers, settings.default_analytic_account_id, warnings,
                    )
                    cost_center = analytic
                employee = slip.employee_id if per_employee or role in EMPLOYEE_ROLES else self.env['hr.employee']
                balances[role, cost_center.id, employee] += amount
        missing = sorted({role for role, _analytic, _employee in balances if not settings[account_field(role)]})
        if missing:
            raise ApiError(
                422, 'settings_incomplete', 'the payroll accounts are not all set', field='accounts',
                details={'accounts': missing},
            )
        return [self._webvue_line(run, settings, key, balance) for key, balance in balances.items() if money(balance)], warnings

    @api.model
    def _webvue_line(self, run, settings, key, balance):
        role, analytic_id, employee = key
        amount = money(balance)
        line = {
            'account_id': settings[account_field(role)].id,
            'name': employee.name if employee else f"{run.name} {role.replace('_', ' ')}",
            'debit': float(amount) if amount > 0 else 0.0,
            'credit': float(-amount) if amount < 0 else 0.0,
            'employee_id': employee.id if employee else None,
        }
        if employee.work_contact_id:
            line['partner_id'] = employee.work_contact_id.id
        if analytic_id:
            line['analytic_distribution'] = {str(analytic_id): 100}
        return line

    @api.model
    def _webvue_journal(self, settings):
        """The settings journal when it can book the entry, else the refusal the post route answers."""
        journal = settings.journal_id
        if not journal:
            raise ApiError(422, 'settings_incomplete', 'the payroll journal is not set', field='journal_id')
        if journal.currency_id and journal.currency_id != journal.company_id.currency_id:
            raise ApiError(422, 'invalid', 'the journal must be in the company currency', field='journal_id')
        return journal

    @api.model
    def _webvue_preview(self, run):
        """``(settings, lines, warnings)`` of the preview, refusing what posting refuses."""
        run.ensure_one()
        settings = self.env['webvue.hr.payroll.finance.settings']._webvue_for_company(run.company_id)
        self._webvue_journal(settings)
        lines, warnings = self._webvue_posting_lines(run, settings)
        return settings, lines, warnings

    @api.model
    def _webvue_post(self, run):
        """Book the approved ``run`` and post its entry; the run becomes ``posted``."""
        run.ensure_one()
        run._webvue_require_state(('approved',), self.env._('Only an approved run can be posted.'))
        settings = self.env['webvue.hr.payroll.finance.settings']._webvue_for_company(run.company_id)
        journal = self._webvue_journal(settings)
        lines, _warnings = self._webvue_posting_lines(run, settings)
        require_balanced(lines)
        if is_period_locked(run.date_end, journal):
            raise period_locked(field='date')
        move = self.env['account.move'].create({
            'move_type': 'entry',
            'date': run.date_end,
            'journal_id': journal.id,
            'ref': run.name,
            'webvue_payroll_origin': 'run',
            'line_ids': [
                Command.create({key: value for key, value in line.items() if key != 'employee_id'}) for line in lines
            ],
        })
        attempt(move.action_post, day=run.date_end, journal=journal)
        run.write({'webvue_move_id': move.id, 'webvue_state': 'posted'})
        return move

    @api.model
    def _webvue_record_payment(self, run, journal, day):
        """Pay the salaries payable of the posted ``run`` from ``journal`` on ``day``; the run becomes ``paid``."""
        run.ensure_one()
        run._webvue_require_state(('posted',), self.env._('Only a posted run can be paid.'))
        if journal.company_id != run.company_id or journal.type not in PAYMENT_JOURNAL_TYPES:
            raise ApiError(422, 'invalid', 'the journal must be a bank or cash journal', field='journal_id')
        if journal.currency_id and journal.currency_id != run.company_id.currency_id:
            raise ApiError(422, 'invalid', 'the journal must be in the company currency', field='journal_id')
        if fields.Date.to_date(day) < run.webvue_move_id.date:
            raise ApiError(422, 'invalid', 'the payment date is before the payroll entry', field='date')
        if is_period_locked(day, journal):
            raise period_locked(field='date')
        settings = self.env['webvue.hr.payroll.finance.settings']._webvue_for_company(run.company_id)
        payable = settings.salaries_payable_account_id
        owed = run.webvue_move_id.line_ids.filtered(lambda line: line.account_id == payable)
        amount = money(sum((Decimal(str(line.credit - line.debit)) for line in owed), Decimal(0)))
        if amount <= 0:
            raise ApiError(422, 'invalid', 'the run owes no salaries payable', field='state')
        payment = self.env['account.payment'].create({
            'payment_type': 'outbound',
            'partner_type': 'supplier',
            'amount': float(amount),
            'date': day,
            'journal_id': journal.id,
            'memo': run.name,
            'destination_account_id': payable.id,
        })
        attempt(payment.action_post, day=day, journal=journal)
        payment.move_id.webvue_payroll_origin = 'payment'
        (owed | payment.move_id.line_ids.filtered(lambda line: line.account_id == payable)).reconcile()
        if not all(owed.mapped('reconciled')):
            raise ApiError(422, 'invalid', 'the salaries payable of the run were not fully paid', field='state')
        run.write({'webvue_payment_id': payment.id, 'webvue_state': 'paid'})
        return payment
