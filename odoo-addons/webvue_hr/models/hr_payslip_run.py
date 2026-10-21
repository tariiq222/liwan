# Part of Odoo. See LICENSE file for full copyright and licensing details.
from decimal import Decimal

from dateutil.relativedelta import relativedelta

from odoo import api, fields, models
from odoo.exceptions import ValidationError

from .hr_payslip import AMOUNT_KEYS, INPUT_CODES
from .payroll_math import money
from odoo.addons.webvue_hr.rules import WebVueHrRule

EDITABLE_STATES = ('draft', 'computed')
DUPLICATE = 'duplicate'
STRUCTURE_MISSING = 'structure_missing'
TRANSITION_FORBIDDEN = 'transition_forbidden'
NEGATIVE_NET = 'negative_net'
INVALID = 'invalid'
INPUT_AMOUNT = {name: 0 for name in INPUT_CODES.values()}


class HrPayslipRun(models.Model):
    """One pay month of a company. The OCA ``state`` stays the engine's own field (``close`` on
    approval); ``webvue_state`` is the lifecycle the payroll section shows."""

    _inherit = 'hr.payslip.run'

    webvue_state = fields.Selection(
        [('draft', 'Draft'), ('computed', 'Computed'), ('approved', 'Approved')],
        string='Payroll status', required=True, default='draft', copy=False, index=True, readonly=True,
    )
    webvue_approved_by_id = fields.Many2one('res.users', string='Approved by', copy=False, readonly=True)
    webvue_approved_at = fields.Datetime(string='Approved on', copy=False, readonly=True)

    _webvue_one_run_per_month = models.Constraint(
        'UNIQUE(company_id, date_start)', 'a payroll run already exists for this month',
    )

    @api.constrains('date_start', 'date_end')
    def _webvue_check_month(self):
        for run in self:
            if run.date_start.day != 1 or run.date_end != run.date_start + relativedelta(day=31):
                raise ValidationError(self.env._('A payroll run covers exactly one calendar month.'))

    @api.model
    def _webvue_create_month(self, month_start):
        """The run of the month starting on ``month_start`` for the current company, with its payslips."""
        company = self.env.company
        if self.search_count([('company_id', '=', company.id), ('date_start', '=', month_start)]):
            raise WebVueHrRule(
                DUPLICATE, self.env._('A run already exists for this month.'), field='month',
            )
        run = self.create({
            'name': month_start.strftime('%Y-%m'),
            'company_id': company.id,
            'date_start': month_start,
            'date_end': month_start + relativedelta(day=31),
            'struct_id': self._webvue_structure(company).id,
        })
        run._webvue_sync_payslips()
        return run

    @api.model
    def _webvue_structure(self, company):
        structure = self.env['webvue.hr.payroll.settings']._webvue_for_company(company).structure_id
        if not structure:
            raise WebVueHrRule(
                STRUCTURE_MISSING, self.env._('Choose the payroll structure in the payroll settings first.'),
                field='structure_id',
            )
        return structure

    def _webvue_require_state(self, states, message):
        """Refuse a transition from any other lifecycle state (403 ``transition_forbidden``)."""
        if any(run.webvue_state not in states for run in self):
            raise WebVueHrRule(TRANSITION_FORBIDDEN, message, status=403)

    # --- who is paid -------------------------------------------------------------------------

    def _webvue_period_employees(self):
        """Employees of the company under contract during the month who have not left before it.

        Archived employees are included: a leaver is still paid for the month they worked.
        """
        self.ensure_one()
        versions = self.env['hr.version'].search([
            ('company_id', '=', self.company_id.id),
            ('contract_date_start', '<=', self.date_end),
            '|', ('contract_date_end', '=', False), ('contract_date_end', '>=', self.date_start),
        ])
        employees = versions.employee_id.with_context(active_test=False)
        return employees.filtered(
            lambda employee: not employee.departure_date or employee.departure_date >= self.date_start,
        ).sorted('name')

    def _webvue_compensated_employees(self):
        """The employees of the period that have a compensation record: the ones a payslip is made for."""
        self.ensure_one()
        employees = self._webvue_period_employees()
        compensated = self.env['webvue.hr.compensation'].search([('employee_id', 'in', employees.ids)]).employee_id
        return employees & compensated

    def _webvue_sync_payslips(self):
        """Make the payslips match who is eligible: add the missing ones, drop the ones no longer due."""
        for run in self:
            run._webvue_require_state(EDITABLE_STATES, self.env._('The payslips of an approved run are fixed.'))
            structure = self._webvue_structure(run.company_id)
            eligible = run._webvue_compensated_employees()
            stale = run.slip_ids.filtered(
                lambda slip, eligible=eligible, structure=structure:
                slip.employee_id not in eligible or slip.struct_id != structure,
            )
            stale.action_payslip_cancel()
            stale.unlink()
            for employee in eligible - run.slip_ids.employee_id:
                run._webvue_create_payslip(employee, structure)

    def _webvue_create_payslip(self, employee, structure):
        payslip = self.env['hr.payslip'].create({
            'employee_id': employee.id,
            'date_from': self.date_start,
            'date_to': self.date_end,
            'company_id': self.company_id.id,
            'struct_id': structure.id,
            'payslip_run_id': self.id,
        })
        payslip.contract_id = payslip._webvue_period_version()
        payslip._webvue_snapshot_paid_days()
        payslip.input_line_ids = [
            (0, 0, {**line, 'amount': INPUT_AMOUNT.get(line['code'], 0)})
            for line in payslip.get_inputs(payslip.contract_id, self.date_start, self.date_end)
        ]
        return payslip

    # --- lifecycle ---------------------------------------------------------------------------

    def _webvue_compute(self):
        self.ensure_one()
        self._webvue_require_state(EDITABLE_STATES, self.env._('An approved run cannot be computed again.'))
        self._webvue_sync_payslips()
        self.slip_ids.compute_sheet()
        self.webvue_state = 'computed'

    def _webvue_approval_blockers(self):
        """Reasons the run cannot be approved yet, as ``{code, message, field?, details?}`` dicts."""
        self.ensure_one()
        return [*self._webvue_settlement_blockers(), *self._webvue_stale_blockers()]

    def _webvue_leavers(self):
        return self.slip_ids.employee_id.filtered(
            lambda employee: employee.departure_date and self.date_start <= employee.departure_date <= self.date_end,
        )

    def _webvue_confirmed_settlements(self):
        """Confirmed settlements of the month's leavers whose departure date still matches the employee's."""
        leavers = self._webvue_leavers()
        return self.env['webvue.hr.payroll.eos.settlement'].search([
            ('employee_id', 'in', leavers.ids), ('state', '=', 'confirmed'),
        ]).filtered(lambda settlement: not settlement._webvue_departure_mismatch())

    def _webvue_stale_blockers(self):
        """``run_stale`` for leavers whose payslip lines differ from their confirmed settlement (compute again)."""
        stale = []
        for settlement in self._webvue_confirmed_settlements():
            slip = self.slip_ids.filtered(lambda line_slip, settlement=settlement: line_slip.employee_id == settlement.employee_id)
            lines = {line.code: money(Decimal(str(line.total))) for line in slip.line_ids}
            expected = {
                'EOS': settlement.award, 'LEAVE_ENC': settlement.leave_amount,
                'SETTLEMENT_DED': -settlement.open_deductions,
            }
            if any(lines.get(code, money(0)) != money(Decimal(str(amount))) for code, amount in expected.items()):
                stale.append(settlement.employee_id.id)
        if not stale:
            return []
        return [{
            'code': 'run_stale',
            'message': self.env._('A settlement was confirmed or changed after the last compute: compute the run again.'),
            'field': 'employee_id',
            'details': {'employee_ids': stale},
        }]

    def _webvue_settlement_blockers(self):
        """``settlement_missing`` for leavers of the month whose final settlement is not confirmed."""
        leavers = self._webvue_leavers()
        missing = leavers - self._webvue_confirmed_settlements().employee_id
        if not missing:
            return []
        return [{
            'code': 'settlement_missing',
            'message': self.env._('Confirm the final settlement of every employee who leaves in this month.'),
            'field': 'employee_id',
            'details': {'employee_ids': missing.ids},
        }]

    def _webvue_approve(self):
        self.ensure_one()
        self._webvue_require_state(('computed',), self.env._('Only a computed run can be approved.'))
        own = self.slip_ids.filtered(lambda slip: slip.employee_id.user_id == self.env.user)
        if own:
            raise WebVueHrRule(
                TRANSITION_FORBIDDEN, self.env._('A run that holds your own payslip cannot be approved by you.'),
                field='employee_id', status=403, details={'employee_ids': own.employee_id.ids},
            )
        amounts = self.slip_ids._webvue_amounts()
        negative = [slip.employee_id.id for slip in self.slip_ids if amounts[slip.id]['net'] < 0]
        if negative:
            raise WebVueHrRule(
                NEGATIVE_NET, self.env._('A payslip with a negative net cannot be approved.'),
                field='employee_id', details={'employee_ids': negative},
            )
        for blocker in self._webvue_approval_blockers():
            raise WebVueHrRule(
                blocker['code'], blocker['message'], field=blocker.get('field'), details=blocker.get('details'),
            )
        self.slip_ids.with_context(without_compute_sheet=True).action_payslip_done()
        self.close_payslip_run()
        self.write({
            'webvue_state': 'approved',
            'webvue_approved_by_id': self.env.user.id,
            'webvue_approved_at': fields.Datetime.now(),
        })

    def _webvue_cancel(self):
        """Drop a run that is not approved, with its payslips, so its month is free again."""
        self.ensure_one()
        self._webvue_require_state(EDITABLE_STATES, self.env._('An approved run cannot be deleted.'))
        self.slip_ids.action_payslip_cancel()
        self.slip_ids.unlink()
        self.unlink()

    def _webvue_set_inputs(self, payslip, values):
        """Write input amounts by engine input code. A computed run goes back to draft: its figures are stale."""
        self.ensure_one()
        if self.webvue_state not in EDITABLE_STATES:
            raise WebVueHrRule(
                INVALID, self.env._('The inputs of an approved run cannot be edited.'),
                field='state', details={'reason': 'not_editable'},
            )
        lines = {line.code: line for line in payslip.input_line_ids}
        for code, amount in values.items():
            lines[code].amount = amount
        if self.webvue_state == 'computed':
            self.slip_ids.line_ids.unlink()
            self.slip_ids.action_payslip_draft()
            self.webvue_state = 'draft'

    # --- figures and hints for the screens ---------------------------------------------------

    def _webvue_totals(self):
        self.ensure_one()
        figures = self.slip_ids._webvue_amounts().values()
        return {
            key: float(money(sum((money(figure[key]) for figure in figures), money(0))))
            for key in AMOUNT_KEYS
        }

    def _webvue_warnings(self):
        """``[{code, employee}]``: employees under contract without compensation, payslips without an IBAN."""
        self.ensure_one()
        employees = self._webvue_period_employees()
        warnings = [
            {'code': 'compensation_missing', 'employee': employee}
            for employee in employees - self._webvue_compensated_employees()
        ]
        missing = self.slip_ids._webvue_iban_missing()
        warnings.extend(
            {'code': 'missing_iban', 'employee': slip.employee_id}
            for slip in self.slip_ids.sorted(lambda slip: slip.employee_id.name or '') if slip.id in missing
        )
        return warnings

    def _webvue_allowed_actions(self):
        self.ensure_one()
        access = self.env['webvue.access.service']
        can_manage = access._webvue_has_capability(self.env.user, 'hr.payroll.manage')
        can_approve = access._webvue_has_capability(self.env.user, 'hr.payroll.approve')
        editable = self.webvue_state in EDITABLE_STATES
        actions = []
        if editable and can_manage:
            actions.append('compute')
        if self.webvue_state == 'computed' and can_approve:
            actions.append('approve')
        if editable and can_manage:
            actions.extend(['cancel', 'edit_inputs'])
        return actions + self.env['webvue.hr.payroll.finance.link']._webvue_finance_actions(self)
