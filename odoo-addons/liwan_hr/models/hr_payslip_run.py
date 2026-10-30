# Part of Odoo. See LICENSE file for full copyright and licensing details.
from decimal import Decimal

from dateutil.relativedelta import relativedelta

from odoo import api, fields, models
from odoo.exceptions import ValidationError

from .hr_payslip import AMOUNT_KEYS, INPUT_CODES, RULE_VALUE_KEYS
from .payroll_math import money
from odoo.addons.liwan_hr.rules import LiwanHrRule

EDITABLE_STATES = ('draft', 'computed')
DUPLICATE = 'duplicate'
STRUCTURE_MISSING = 'structure_missing'
TRANSITION_FORBIDDEN = 'transition_forbidden'
NEGATIVE_NET = 'negative_net'
RUN_EMPTY = 'run_empty'
RUN_STALE = 'run_stale'
MISSING_IBAN = 'missing_iban'
INPUT_AMOUNT = {name: 0 for name in INPUT_CODES.values()}


class HrPayslipRun(models.Model):
    """One pay month of a company. The OCA ``state`` stays the engine's own field (``close`` on
    approval); ``liwan_state`` is the lifecycle the payroll section shows."""

    _inherit = 'hr.payslip.run'

    liwan_state = fields.Selection(
        [('draft', 'Draft'), ('computed', 'Computed'), ('approved', 'Approved')],
        string='Payroll status', required=True, default='draft', copy=False, index=True, readonly=True, tracking=True,
    )
    liwan_approved_by_id = fields.Many2one('res.users', string='Approved by', copy=False, readonly=True, tracking=True)
    liwan_approved_at = fields.Datetime(string='Approved on', copy=False, readonly=True, tracking=True)

    _liwan_one_run_per_month = models.Constraint(
        'UNIQUE(company_id, date_start)', 'a payroll run already exists for this month',
    )

    @api.constrains('date_start', 'date_end')
    def _liwan_check_month(self):
        for run in self:
            if run.date_start.day != 1 or run.date_end != run.date_start + relativedelta(day=31):
                raise ValidationError(self.env._('A payroll run covers exactly one calendar month.'))

    @api.model
    def _liwan_create_month(self, month_start):
        """The run of the month starting on ``month_start`` for the current company, with its payslips."""
        company = self.env.company
        if self.search_count([('company_id', '=', company.id), ('date_start', '=', month_start)]):
            raise LiwanHrRule(
                DUPLICATE, self.env._('A run already exists for this month.'), field='month',
            )
        run = self.create({
            'name': month_start.strftime('%Y-%m'),
            'company_id': company.id,
            'date_start': month_start,
            'date_end': month_start + relativedelta(day=31),
            'struct_id': self._liwan_structure(company).id,
        })
        run._liwan_sync_payslips()
        return run

    @api.model
    def _liwan_structure(self, company):
        structure = self.env['liwan.hr.payroll.settings']._liwan_for_company(company).structure_id
        if not structure:
            raise LiwanHrRule(
                STRUCTURE_MISSING, self.env._('Choose the payroll structure in the payroll settings first.'),
                field='structure_id',
            )
        return structure

    def _liwan_is_editable(self):
        """Whether the run can still change: its figures, its payment snapshot and its salary files follow this.

        One definition of "not fixed yet" for the payslips, the salary files and the screens; a state a bridge
        adds through ``selection_add`` is fixed unless it is one of ``EDITABLE_STATES``.
        """
        self.ensure_one()
        return self.liwan_state in EDITABLE_STATES

    def _liwan_require_state(self, states, message, details=None):
        """Refuse a transition from any other lifecycle state (403 ``transition_forbidden``)."""
        if any(run.liwan_state not in states for run in self):
            raise LiwanHrRule(TRANSITION_FORBIDDEN, message, status=403, details=details)

    # --- who is paid -------------------------------------------------------------------------

    def _liwan_period_employees(self):
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

    def _liwan_compensated_employees(self):
        """The employees of the period that have a compensation record: the ones a payslip is made for."""
        self.ensure_one()
        employees = self._liwan_period_employees()
        compensated = self.env['liwan.hr.compensation'].search([('employee_id', 'in', employees.ids)]).employee_id
        return employees & compensated

    def _liwan_uncontracted_employees(self):
        """Employees with a compensation record that the run leaves out because no contract runs in the month.

        Typical cause: a contract without a start date. Leavers before the month and employees whose
        first contract starts after it are not owed this month, so they are not listed.
        """
        self.ensure_one()
        compensated = self.env['liwan.hr.compensation'].search([
            ('employee_id.company_id', '=', self.company_id.id),
        ]).employee_id.filtered('active')
        unpaid = compensated - self._liwan_period_employees()
        versions = self.env['hr.version'].search([('employee_id', 'in', unpaid.ids)])

        def starts_later(employee):
            own = versions.filtered(lambda version: version.employee_id == employee)
            return bool(own) and all(version.contract_date_start and version.contract_date_start > self.date_end for version in own)

        return unpaid.filtered(
            lambda employee: not (employee.departure_date and employee.departure_date < self.date_start)
            and not starts_later(employee),
        ).sorted('name')

    def _liwan_sync_payslips(self):
        """Make the payslips match who is eligible: add the missing ones, drop the ones no longer due."""
        for run in self:
            run._liwan_require_state(EDITABLE_STATES, self.env._('The payslips of an approved run are fixed.'))
            structure = self._liwan_structure(run.company_id)
            eligible = run._liwan_compensated_employees()
            stale = run.slip_ids.filtered(
                lambda slip, eligible=eligible, structure=structure:
                slip.employee_id not in eligible or slip.struct_id != structure,
            )
            stale.action_payslip_cancel()
            stale.unlink()
            for employee in eligible - run.slip_ids.employee_id:
                run._liwan_create_payslip(employee, structure)

    def _liwan_create_payslip(self, employee, structure):
        payslip = self.env['hr.payslip'].create({
            'employee_id': employee.id,
            'date_from': self.date_start,
            'date_to': self.date_end,
            'company_id': self.company_id.id,
            'struct_id': structure.id,
            'payslip_run_id': self.id,
        })
        payslip.contract_id = payslip._liwan_period_version()
        payslip._liwan_snapshot_paid_days()
        payslip.input_line_ids = [
            (0, 0, {**line, 'amount': INPUT_AMOUNT.get(line['code'], 0)})
            for line in payslip.get_inputs(payslip.contract_id, self.date_start, self.date_end)
        ]
        return payslip

    # --- lifecycle ---------------------------------------------------------------------------

    def _liwan_compute(self):
        self.ensure_one()
        self._liwan_require_state(EDITABLE_STATES, self.env._('An approved run cannot be computed again.'))
        self._liwan_sync_payslips()
        self.slip_ids.compute_sheet()
        self.liwan_state = 'computed'

    def _liwan_approval_blockers(self):
        """Reasons the run cannot be approved yet, as ``{code, message, field?, details?}`` dicts."""
        self.ensure_one()
        if not self.slip_ids:
            return [{
                'code': RUN_EMPTY,
                'message': self.env._('The run has no payslip: no employee with a compensation record is due this month.'),
                'field': 'employee_id',
            }]
        return [
            *self._liwan_settlement_blockers(), *self._liwan_custody_blockers(),
            *self._liwan_stale_blockers(), *self._liwan_iban_blockers(),
        ]

    def _liwan_leavers(self):
        return self.slip_ids.employee_id.filtered(
            lambda employee: employee.departure_date and self.date_start <= employee.departure_date <= self.date_end,
        )

    def _liwan_confirmed_settlements(self):
        """Confirmed settlements of the month's leavers whose departure date still matches the employee's."""
        leavers = self._liwan_leavers()
        return self.env['liwan.hr.payroll.eos.settlement'].search([
            ('employee_id', 'in', leavers.ids), ('state', '=', 'confirmed'),
        ]).filtered(lambda settlement: not settlement._liwan_departure_mismatch())

    def _liwan_stale_employees(self):
        """Ids of the employees whose payslip no longer matches what payroll would compute today.

        An employee is stale when they became due or stopped being due since the last compute, or when a line of their
        payslip differs from the figure the engine would be fed now (a changed compensation, settlement or contract).
        """
        stale = set(self._liwan_compensated_employees().ids) ^ set(self.slip_ids.employee_id.ids)
        calculator = self.env['liwan.hr.payroll.calculator']
        for slip in self.slip_ids:
            lines = {line.code: money(Decimal(str(line.total))) for line in slip.line_ids}
            values = calculator._liwan_payslip_values(slip)
            if any(
                lines.get(code, money(0)) != money(Decimal(str(sign * values[key])))
                for code, (key, sign) in RULE_VALUE_KEYS.items()
            ):
                stale.add(slip.employee_id.id)
        return sorted(stale)

    def _liwan_stale_blockers(self):
        """``run_stale`` for employees whose payslip is out of date (compute the run again)."""
        stale = self._liwan_stale_employees()
        if not stale:
            return []
        return [{
            'code': RUN_STALE,
            'message': self.env._('Payroll figures changed after the last compute: compute the run again.'),
            'field': 'employee_id',
            'details': {'employee_ids': stale},
        }]

    def _liwan_settlement_blockers(self):
        """``settlement_missing`` for leavers of the month whose final settlement is not confirmed."""
        leavers = self._liwan_leavers()
        missing = leavers - self._liwan_confirmed_settlements().employee_id
        if not missing:
            return []
        return [{
            'code': 'settlement_missing',
            'message': self.env._('Confirm the final settlement of every employee who leaves in this month.'),
            'field': 'employee_id',
            'details': {'employee_ids': missing.ids},
        }]

    def _liwan_custody_blockers(self):
        """``custody_open`` for leavers of the month who still hold equipment, from the employee's exit check."""
        return [
            {'code': blocker['code'], 'message': blocker['message'], 'field': 'employee_id', 'details': blocker['details']}
            for blocker in self._liwan_leavers()._liwan_exit_blockers() if blocker['code'] == 'custody_open'
        ]

    def _liwan_iban_blockers(self):
        """``missing_iban`` for employees with a net to pay and no IBAN to pay it to (owner decision D-10)."""
        missing = self.slip_ids.browse(sorted(self.slip_ids._liwan_iban_missing()))
        if not missing:
            return []
        return [{
            'code': MISSING_IBAN,
            'message': self.env._('Record the IBAN of every employee with a net to pay before approving the run.'),
            'field': 'iban',
            'details': {'employee_ids': sorted(missing.employee_id.ids)},
        }]

    def _liwan_approve(self):
        self.ensure_one()
        self._liwan_require_state(('computed',), self.env._('Only a computed run can be approved.'))
        own = self.slip_ids.filtered(lambda slip: slip.employee_id.user_id == self.env.user)
        if own:
            raise LiwanHrRule(
                TRANSITION_FORBIDDEN, self.env._('A run that holds your own payslip cannot be approved by you.'),
                field='employee_id', status=403, details={'employee_ids': own.employee_id.ids},
            )
        amounts = self.slip_ids._liwan_amounts()
        negative = [slip.employee_id.id for slip in self.slip_ids if amounts[slip.id]['net'] < 0]
        if negative:
            raise LiwanHrRule(
                NEGATIVE_NET, self.env._('A payslip with a negative net cannot be approved.'),
                field='employee_id', details={'employee_ids': negative},
            )
        for blocker in self._liwan_approval_blockers():
            raise LiwanHrRule(
                blocker['code'], blocker['message'], field=blocker.get('field'), details=blocker.get('details'),
            )
        Audit = self.env['liwan.hr.audit.event']
        before = Audit._liwan_policy_snapshot(self)
        self.env['liwan.hr.payslip.payment']._liwan_snapshot(self.slip_ids)
        self.slip_ids.with_context(without_compute_sheet=True).action_payslip_done()
        self.close_payslip_run()
        self.write({
            'liwan_state': 'approved',
            'liwan_approved_by_id': self.env.user.id,
            'liwan_approved_at': fields.Datetime.now(),
        })
        Audit._liwan_log('run_approved', self, before)

    def _liwan_cancel(self):
        """Drop a run that is not approved, with its payslips, so its month is free again."""
        self.ensure_one()
        self._liwan_require_state(EDITABLE_STATES, self.env._('An approved run cannot be deleted.'))
        self.slip_ids.action_payslip_cancel()
        self.slip_ids.unlink()
        # The event and the unlink share one savepoint: a refused unlink leaves no cancellation behind.
        with self.env.cr.savepoint():
            self.env['liwan.hr.audit.event']._liwan_log('run_cancelled', self)
            self.unlink()

    def _liwan_set_inputs(self, payslip, values):
        """Write input amounts by engine input code. A computed run goes back to draft: its figures are stale."""
        self.ensure_one()
        self._liwan_require_state(
            EDITABLE_STATES,
            self.env._('The inputs of an approved run cannot be edited.'),
            details={'reason': 'not_editable'},
        )
        Audit = self.env['liwan.hr.audit.event']
        before = Audit._liwan_policy_snapshot(self)
        lines = {line.code: line for line in payslip.input_line_ids}
        changed = sorted(code for code, amount in values.items() if lines[code].amount != amount)
        reset = self.liwan_state == 'computed'
        for code, amount in values.items():
            lines[code].amount = amount
        if reset:
            self.slip_ids.line_ids.unlink()
            self.slip_ids.action_payslip_draft()
            self.liwan_state = 'draft'
        if changed or reset:
            # The input codes are named, never valued: an amount is pay data (owner decision D-9). A reset of a
            # computed run is logged even when no amount moved: its stored figures were dropped.
            Audit._liwan_log('run_inputs_changed', self, before, names=changed)

    # --- figures and hints for the screens ---------------------------------------------------

    def _liwan_totals(self):
        self.ensure_one()
        figures = self.slip_ids._liwan_amounts().values()
        return {
            key: float(money(sum((money(figure[key]) for figure in figures), money(0))))
            for key in AMOUNT_KEYS
        }

    def _liwan_warnings(self):
        """``[{code, employee}]``: employees under contract without compensation, compensated employees
        without a running contract, payslips without an IBAN."""
        self.ensure_one()
        employees = self._liwan_period_employees()
        warnings = [
            {'code': 'compensation_missing', 'employee': employee}
            for employee in employees - self._liwan_compensated_employees()
        ]
        warnings.extend(
            {'code': 'contract_missing', 'employee': employee}
            for employee in self._liwan_uncontracted_employees()
        )
        missing = self.slip_ids._liwan_iban_missing()
        warnings.extend(
            {'code': 'missing_iban', 'employee': slip.employee_id}
            for slip in self.slip_ids.sorted(lambda slip: slip.employee_id.name or '') if slip.id in missing
        )
        return warnings

    def _liwan_allowed_actions(self):
        self.ensure_one()
        access = self.env['liwan.access.service']
        can_manage = access._liwan_has_capability(self.env.user, 'hr.payroll.manage')
        can_approve = access._liwan_has_capability(self.env.user, 'hr.payroll.approve')
        editable = self._liwan_is_editable()
        actions = []
        if editable and can_manage:
            actions.append('compute')
        if self.liwan_state == 'computed' and can_approve:
            actions.append('approve')
        if editable and can_manage:
            actions.extend(['cancel', 'edit_inputs'])
        return actions + self.env['liwan.hr.payroll.finance.link']._liwan_finance_actions(self)
