# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models
from odoo.exceptions import AccessError, LockError, ValidationError
from odoo.fields import Domain

from odoo.addons.liwan_api.controllers.common import ApiError

# The context key that opens an enrollment for writing. Only the action methods below set it, with this object;
# a request cannot forge it, so an enrollment is never edited or ended behind the lifecycle (history is kept).
WRITE_TOKEN = object()
WRITE_CONTEXT = 'liwan_hr_insurance_write'
TEXT_LIMIT = 2000
MEMBER_NUMBER_LIMIT = 40


def _text(env, value, label, limit=TEXT_LIMIT):
    if value in (None, False):
        value = ''
    if not isinstance(value, str) or len(value) > limit:
        raise ValidationError(env._('Invalid %(field)s.', field=label))
    return value.strip()


class LiwanHrInsuranceEnrollment(models.Model):
    """One employee's membership of an insurance plan between two dates; ended or cancelled, never edited away.

    The member number, the shares and the notes are insurance data: they never appear in the employee, directory
    or people views, in the payroll audit or in a notification. The shares are informational in this phase and
    feed no payslip.
    """

    _name = 'liwan.hr.insurance.enrollment'
    _description = 'LiwanOS HR insurance enrollment'
    _liwan_scope = 'company'
    _order = 'date_from desc, id desc'

    employee_id = fields.Many2one('hr.employee', required=True, ondelete='restrict', index=True)
    company_id = fields.Many2one(related='employee_id.company_id', store=True, index=True)
    # Stored so a record rule scopes an employee to their own enrollment without reading the employee record.
    employee_user_id = fields.Many2one(related='employee_id.user_id', store=True, index=True)
    currency_id = fields.Many2one(related='company_id.currency_id')
    plan_id = fields.Many2one('liwan.hr.insurance.plan', required=True, ondelete='restrict', index=True)
    member_number = fields.Char()
    date_from = fields.Date(required=True)
    # Empty while the enrollment runs to the end of its plan; set when it is ended.
    date_to = fields.Date()
    date_end_effective = fields.Date(compute='_compute_date_end_effective', store=True, index=True)
    state = fields.Selection(
        [('active', 'Active'), ('ended', 'Ended'), ('cancelled', 'Cancelled')],
        required=True, default='active', index=True,
    )
    employee_share = fields.Monetary(currency_field='currency_id')
    company_share = fields.Monetary(currency_field='currency_id')
    notes = fields.Text()
    # What readers see: an active enrollment whose end date has passed is lapsed, derived from the dates.
    state_effective = fields.Selection(
        [('active', 'Active'), ('lapsed', 'Lapsed'), ('ended', 'Ended'), ('cancelled', 'Cancelled')],
        compute='_compute_state_effective',
    )
    revision = fields.Integer(required=True, default=1)
    dependent_ids = fields.One2many('liwan.hr.insurance.dependent', 'enrollment_id')

    _revision_positive = models.Constraint('CHECK(revision > 0)', 'a saved revision must be positive')
    _shares_positive = models.Constraint(
        'CHECK((employee_share IS NULL OR employee_share >= 0) AND (company_share IS NULL OR company_share >= 0))',
        'a monthly share cannot be negative',
    )

    @api.depends('date_to', 'plan_id.valid_to')
    def _compute_date_end_effective(self):
        for row in self:
            row.date_end_effective = row.date_to or row.plan_id.valid_to

    @api.depends('state', 'date_end_effective')
    @api.depends_context('tz')
    def _compute_state_effective(self):
        today = fields.Date.context_today(self)
        for row in self:
            lapsed = row.state == 'active' and row.date_end_effective and row.date_end_effective < today
            row.state_effective = 'lapsed' if lapsed else row.state

    @api.model
    def _liwan_state_domain(self, state):
        """The domain of one derived state: lapsed is an active enrollment past its end date."""
        today = fields.Date.context_today(self)
        if state == 'active':
            return Domain('state', '=', 'active') & Domain('date_end_effective', '>=', today)
        if state == 'lapsed':
            return Domain('state', '=', 'active') & Domain('date_end_effective', '<', today)
        return Domain('state', '=', state)

    def _liwan_active_dependents(self):
        """The dependents still covered: none once the enrollment lapsed, ended or was cancelled."""
        self.ensure_one()
        if self.state_effective != 'active':
            return self.dependent_ids.browse()
        today = fields.Date.context_today(self)
        return self.dependent_ids.filtered(lambda item: item.state == 'active' and (not item.date_to or item.date_to >= today))

    @api.depends('employee_id', 'plan_id')
    def _compute_display_name(self):
        for row in self:
            row.display_name = f'{row.employee_id.name or ""} / {row.plan_id.name or ""}'

    @api.constrains('employee_id', 'plan_id', 'date_from', 'date_to', 'state')
    def _check_dates_and_overlap(self):
        for row in self.filtered(lambda item: item.state != 'cancelled'):
            plan = row.plan_id
            if plan.company_id != row.company_id:
                raise ValidationError(self.env._('The insurance plan belongs to another company.'))
            if row.date_to and row.date_to < row.date_from:
                raise ValidationError(self.env._('The enrollment cannot end before it starts.'))
            if row.date_from < plan.valid_from or row.date_end_effective > plan.valid_to:
                raise ValidationError(self.env._('The enrollment dates must lie inside the plan validity.'))
            overlap = self.search_count([
                ('employee_id', '=', row.employee_id.id), ('id', '!=', row.id), ('state', '!=', 'cancelled'),
                ('date_from', '<=', row.date_end_effective), ('date_end_effective', '>=', row.date_from),
            ])
            if overlap:
                raise ValidationError(self.env._('The employee already has an insurance enrollment in these dates.'))

    # --- the write gate ----------------------------------------------------------------------------------

    def _liwan_open(self):
        return self.env.is_superuser() or self.env.context.get(WRITE_CONTEXT) is WRITE_TOKEN

    @api.model_create_multi
    def create(self, vals_list):
        if not self._liwan_open():
            raise AccessError(self.env._('Enrollments are created through the insurance actions.'))
        return super().create(vals_list)

    def write(self, vals):
        if not self._liwan_open():
            raise AccessError(self.env._('An enrollment is changed only through the insurance actions.'))
        return super().write(vals)

    def unlink(self):
        if not self.env.is_superuser():
            raise AccessError(self.env._('Enrollments are ended or cancelled, never deleted.'))
        return super().unlink()

    # --- who may do what -----------------------------------------------------------------------------------

    @api.model
    def _liwan_can_manage(self, company):
        return self.env.is_superuser() or self.env['liwan.access.service']._liwan_has_capability(
            self.env.user, 'hr.insurance.manage', company=company,
        )

    def _liwan_audit_authorized(self, action):
        """The audit hook: whether the caller may log ``action`` on this record."""
        self.ensure_one()
        return self._liwan_can_manage(self.company_id)

    # --- the lifecycle -------------------------------------------------------------------------------------

    def _liwan_log(self, action, before=None):
        return self.env['liwan.hr.audit.event']._liwan_log(action, self, before=before)

    def _liwan_load(self, revision):
        """Lock the row and refuse a stale revision (409)."""
        self.ensure_one()
        self.lock_for_update()
        self.invalidate_recordset()
        if isinstance(revision, bool) or not isinstance(revision, int) or revision != self.revision:
            raise ApiError(409, 'conflict', 'the enrollment changed; reload before saving')

    def _liwan_expect_active(self):
        if self.state_effective != 'active':
            raise ApiError(409, 'conflict', f'the enrollment is {self.state_effective}; this step is not available')

    @api.model
    def _liwan_lock_employees(self, employees):
        """Serialize the changes to one employee's coverage, so two requests cannot both pass the overlap check."""
        try:
            employees.lock_for_update(allow_referencing=True)
        except LockError:
            raise ApiError(409, 'conflict', "another change to this employee's insurance is in progress; try again") from None

    def _liwan_step(self, vals):
        """One lifecycle write: the revision moves with it, so a concurrent step answers 409."""
        self.with_context(**{WRITE_CONTEXT: WRITE_TOKEN}).write({**vals, 'revision': self.revision + 1})

    @api.model
    def action_create(self, vals):
        """Enroll an employee of the current company in a plan of the same company."""
        if not self._liwan_can_manage(self.env.company):
            raise AccessError(self.env._('forbidden'))
        employee = self.env['hr.employee'].search([
            ('id', '=', vals['employee_id']), ('company_id', '=', self.env.company.id),
        ], limit=1)
        if not employee:
            raise ApiError(
                422, 'invalid', 'employee_id does not reference an employee of the current company', field='employee_id',
            )
        plan = self.env['liwan.hr.insurance.plan'].search([
            ('id', '=', vals['plan_id']), ('company_id', '=', self.env.company.id),
        ], limit=1)
        if not plan:
            raise ApiError(
                422, 'invalid', 'plan_id does not reference an active plan of the current company', field='plan_id',
            )
        self._liwan_lock_employees(employee)
        row = self.with_context(**{WRITE_CONTEXT: WRITE_TOKEN}).create({
            'employee_id': employee.id,
            'plan_id': plan.id,
            'date_from': vals['date_from'],
            'date_to': vals.get('date_to') or False,
            'member_number': _text(self.env, vals.get('member_number'), 'member_number', MEMBER_NUMBER_LIMIT),
            'employee_share': vals.get('employee_share') or 0.0,
            'company_share': vals.get('company_share') or 0.0,
            'notes': _text(self.env, vals.get('notes'), 'notes'),
        })
        row._liwan_log('enrollment_created')
        return row

    def action_update(self, revision, vals):
        """Change the shares and the notes of an active enrollment; nothing else is editable."""
        self._liwan_load(revision)
        self._liwan_expect_active()
        if not self._liwan_can_manage(self.company_id):
            raise AccessError(self.env._('forbidden'))
        if 'notes' in vals:
            vals = {**vals, 'notes': _text(self.env, vals['notes'], 'notes')}
        before = self.env['liwan.hr.audit.event']._liwan_policy_snapshot(self)
        self._liwan_step(vals)
        self._liwan_log('enrollment_changed', before)
        return self

    def action_end(self, revision, date_end):
        """End the coverage on ``date_end`` (today when omitted); the row and its dependents stay as history."""
        self._liwan_load(revision)
        self._liwan_expect_active()
        if not self._liwan_can_manage(self.company_id):
            raise AccessError(self.env._('forbidden'))
        date_end = date_end or fields.Date.context_today(self)
        if date_end < self.date_from or date_end > self.date_end_effective:
            raise ValidationError(self.env._('The end date must lie between the start date and the end of the plan.'))
        before = self.env['liwan.hr.audit.event']._liwan_policy_snapshot(self)
        self._liwan_step({'state': 'ended', 'date_to': date_end})
        self.dependent_ids._liwan_end_with(date_end)
        self._liwan_log('enrollment_ended', before)
        return self

    def action_cancel(self, revision):
        """Cancel an enrollment entered by mistake: it stops counting and no longer blocks another one."""
        self._liwan_load(revision)
        self._liwan_expect_active()
        if not self._liwan_can_manage(self.company_id):
            raise AccessError(self.env._('forbidden'))
        before = self.env['liwan.hr.audit.event']._liwan_policy_snapshot(self)
        self._liwan_step({'state': 'cancelled'})
        self.dependent_ids._liwan_end_with(self.date_from, cancel_all=True)
        self._liwan_log('enrollment_cancelled', before)
        return self
