# Part of Odoo. See LICENSE file for full copyright and licensing details.
from dateutil.relativedelta import relativedelta

from odoo import api, fields, models
from odoo.exceptions import AccessError, ValidationError

from .notification_types import WARNING_KIND
from odoo.addons.liwan_api.controllers.common import ApiError

# The context key that opens a warning for writing. Only the action methods below set it, with this object;
# a request cannot forge it, so an issued warning is never edited behind the lifecycle (no silent edits).
WRITE_TOKEN = object()
WRITE_CONTEXT = 'liwan_hr_warning_write'
CREATE_FIELDS = frozenset({'employee_id', 'type_id', 'date_issued', 'reason', 'corrective_action'})
# A warning counts toward escalation from the moment it is issued until HR withdraws it. A contested warning
# keeps counting until HR resolves it by withdrawing it (decision of this phase: a contest is the employee's
# answer, not a verdict).
COUNTED_STATES = ('issued', 'acknowledged', 'contested')
TEXT_LIMIT = 5000


def _text(env, value, label, required=False):
    if value in (None, False):
        value = ''
    if not isinstance(value, str) or len(value) > TEXT_LIMIT or (required and not value.strip()):
        raise ValidationError(env._('Invalid %(field)s.', field=label))
    return value.strip()


class LiwanHrWarning(models.Model):
    """One administrative warning to an employee: draft, issued, answered by the employee, or withdrawn.

    Disciplinary data. It never appears in the employee, directory or people views, and only the warnings
    capabilities, the issuing manager (when the company allows it) and the employee it concerns read it. An
    issued warning is never edited: it is answered by its employee or withdrawn by HR, and every step is audited.
    """

    _name = 'liwan.hr.warning'
    _description = 'LiwanOS HR administrative warning'
    _liwan_scope = 'company'
    _order = 'date_issued desc, id desc'

    employee_id = fields.Many2one('hr.employee', required=True, ondelete='restrict', index=True)
    company_id = fields.Many2one(related='employee_id.company_id', store=True, index=True)
    # Stored so a record rule scopes an employee to their own warnings without reading the employee record.
    employee_user_id = fields.Many2one(related='employee_id.user_id', store=True, index=True)
    type_id = fields.Many2one('liwan.hr.warning.type', required=True, ondelete='restrict', index=True)
    date_issued = fields.Date(required=True, default=fields.Date.context_today)
    reason = fields.Text(required=True)
    corrective_action = fields.Text()
    state = fields.Selection(
        [('draft', 'Draft'), ('issued', 'Issued'), ('acknowledged', 'Acknowledged'),
         ('contested', 'Contested'), ('withdrawn', 'Withdrawn')],
        required=True, default='draft', index=True,
    )
    # The company's acknowledgement policy at the moment of issue: a later settings change never rewrites it.
    acknowledgement = fields.Selection(
        [('required', 'Required'), ('optional', 'Optional'), ('off', 'Off')], required=True, default='optional',
    )
    revision = fields.Integer(required=True, default=1)
    issued_by_id = fields.Many2one('res.users', readonly=True)
    issued_at = fields.Datetime(readonly=True)
    acknowledged_at = fields.Datetime(readonly=True)
    contested_at = fields.Datetime(readonly=True)
    contest_note = fields.Text(readonly=True)
    withdrawn_by_id = fields.Many2one('res.users', readonly=True)
    withdrawn_at = fields.Datetime(readonly=True)
    withdraw_reason = fields.Text(readonly=True)

    _revision_positive = models.Constraint('CHECK(revision > 0)', 'a saved revision must be positive')

    @api.constrains('type_id', 'employee_id')
    def _check_type_company(self):
        for row in self:
            if row.type_id.company_id != row.company_id:
                raise ValidationError(self.env._('The warning type belongs to another company.'))

    @api.constrains('state', 'contest_note', 'withdraw_reason')
    def _check_answers(self):
        for row in self:
            if row.state == 'contested' and not (row.contest_note or '').strip():
                raise ValidationError(self.env._('A contested warning needs the employee note.'))
            if row.state == 'withdrawn' and not (row.withdraw_reason or '').strip():
                raise ValidationError(self.env._('A withdrawn warning needs a reason.'))

    # --- the write gate ----------------------------------------------------------------------------------

    def _liwan_open(self):
        return self.env.is_superuser() or self.env.context.get(WRITE_CONTEXT) is WRITE_TOKEN

    @api.model_create_multi
    def create(self, vals_list):
        if not self._liwan_open():
            raise AccessError(self.env._('Warnings are drafted through the warning actions.'))
        return super().create(vals_list)

    def write(self, vals):
        if not self._liwan_open():
            raise AccessError(self.env._('An issued warning is never edited; withdraw it instead.'))
        return super().write(vals)

    def unlink(self):
        if not self.env.is_superuser():
            raise AccessError(self.env._('Warnings are withdrawn, never deleted.'))
        return super().unlink()

    # --- who may do what -----------------------------------------------------------------------------------

    @api.model
    def _liwan_is_hr(self, company):
        """The caller holds the warnings manage capability in ``company``."""
        return self.env['liwan.access.service']._liwan_has_capability(
            self.env.user, 'hr.warnings.manage', company=company,
        )

    @api.model
    def _liwan_can_issue(self, employee):
        """Whether the caller may issue a warning to ``employee``.

        HR (manage capability) may; the direct manager may when the company's `warnings_issued_by` is
        `manager_and_hr`. Nobody warns their own employee record, whatever they hold.
        """
        if self.env.is_superuser():
            return True
        if not employee or employee.user_id == self.env.user:
            return False
        if self._liwan_is_hr(employee.company_id):
            return True
        policy = self.env['liwan.hr.warning.settings']._liwan_effective(employee.company_id)
        return policy['warnings_issued_by'] == 'manager_and_hr' and employee.parent_id.user_id == self.env.user

    def _liwan_can_manage(self):
        """The caller may issue or discard this draft: HR, or the manager who drafted it."""
        self.ensure_one()
        if self.env.is_superuser():
            return True
        if not self._liwan_can_issue(self.employee_id):
            return False
        return self._liwan_is_hr(self.company_id) or self.create_uid == self.env.user

    def _liwan_can_withdraw(self):
        """A draft is discarded like it is issued; an issued warning is withdrawn by HR alone."""
        self.ensure_one()
        if self.state == 'draft':
            return self._liwan_can_manage()
        return self.env.is_superuser() or (
            self._liwan_is_hr(self.company_id) and self._liwan_can_issue(self.employee_id)
        )

    @api.model
    def _liwan_can_read_standing(self, employee):
        """The escalation figure is shown to whoever may warn the employee and to the warnings readers."""
        return self._liwan_can_issue(employee) or self.env['liwan.access.service']._liwan_has_capability(
            self.env.user, 'hr.warnings.read', company=employee.company_id,
        )

    def _liwan_is_own(self):
        self.ensure_one()
        return bool(self.employee_user_id) and self.employee_user_id == self.env.user

    def _liwan_audit_authorized(self, action):
        """The audit hook: whether the caller may log ``action`` on this warning (see `SELF_AUTHORIZED`)."""
        self.ensure_one()
        if self.env.is_superuser():
            return True
        if action in ('warning_acknowledged', 'warning_contested'):
            return self._liwan_is_own()
        # State-independent on purpose: the log runs after the step, and the step itself is state-checked.
        return self._liwan_can_manage()

    # --- the lifecycle -------------------------------------------------------------------------------------

    def _liwan_log(self, action, before=None):
        return self.env['liwan.hr.audit.event']._liwan_log(action, self, before=before)

    def _liwan_load(self, revision):
        """Lock the row and refuse a stale revision (409)."""
        self.ensure_one()
        self.lock_for_update()
        self.invalidate_recordset()
        if isinstance(revision, bool) or not isinstance(revision, int) or revision != self.revision:
            raise ApiError(409, 'conflict', 'the warning changed; reload before saving')

    def _liwan_expect(self, *states):
        if self.state not in states:
            raise ApiError(409, 'conflict', f'the warning is {self.state}; this step is not available')

    def _liwan_step(self, vals):
        """One lifecycle write: the revision moves with the state, so a concurrent step answers 409."""
        self.with_context(**{WRITE_CONTEXT: WRITE_TOKEN}).write({**vals, 'revision': self.revision + 1})

    @api.model
    def action_create(self, vals):
        """Draft a warning for an employee the caller may warn."""
        employee = self.env['hr.employee'].browse(vals['employee_id']).exists()
        if not employee or not self._liwan_can_issue(employee):
            raise AccessError(self.env._('You may not issue a warning to this employee.'))
        # A search, not a browse: a type of another company is hidden by its record rule and answers like a missing one.
        warning_type = self.env['liwan.hr.warning.type'].search([
            ('id', '=', vals['type_id']), ('company_id', '=', employee.company_id.id),
        ], limit=1)
        if not warning_type:
            raise ValidationError(self.env._('Choose an active warning type of the employee company.'))
        date_issued = vals.get('date_issued') or fields.Date.context_today(self)
        if date_issued > fields.Date.context_today(self):
            raise ValidationError(self.env._('The warning date cannot be in the future.'))
        row = self.with_context(**{WRITE_CONTEXT: WRITE_TOKEN}).create({
            'employee_id': employee.id,
            'type_id': warning_type.id,
            'date_issued': date_issued,
            'reason': _text(self.env, vals.get('reason'), 'reason', required=True),
            'corrective_action': _text(self.env, vals.get('corrective_action'), 'corrective_action'),
        })
        row._liwan_log('warning_created')
        return row

    def action_issue(self, revision):
        """Issue a draft: it is now final, counts toward escalation and reaches the employee's bell."""
        self._liwan_load(revision)
        self._liwan_expect('draft')
        if not self._liwan_can_manage():
            raise AccessError(self.env._('You may not issue this warning.'))
        if not self.type_id.active:
            raise ValidationError(self.env._('The warning type is archived; choose another.'))
        before = self.env['liwan.hr.audit.event']._liwan_policy_snapshot(self)
        policy = self.env['liwan.hr.warning.settings']._liwan_effective(self.company_id)
        self._liwan_step({
            'state': 'issued', 'issued_by_id': self.env.user.id, 'issued_at': fields.Datetime.now(),
            'acknowledgement': policy['warnings_employee_acknowledgement'],
        })
        self._liwan_log('warning_issued', before)
        self._liwan_notify_employee()
        return self

    def action_acknowledge(self, revision):
        """The employee confirms they received the warning."""
        self._liwan_load(revision)
        self._liwan_expect('issued')
        self._liwan_require_answer()
        before = self.env['liwan.hr.audit.event']._liwan_policy_snapshot(self)
        self._liwan_step({'state': 'acknowledged', 'acknowledged_at': fields.Datetime.now()})
        self._liwan_log('warning_acknowledged', before)
        return self

    def action_contest(self, revision, note):
        """The employee disputes the warning with a note; the warning keeps counting until HR withdraws it."""
        self._liwan_load(revision)
        self._liwan_expect('issued')
        self._liwan_require_answer()
        note = _text(self.env, note, 'note', required=True)
        before = self.env['liwan.hr.audit.event']._liwan_policy_snapshot(self)
        self._liwan_step({'state': 'contested', 'contested_at': fields.Datetime.now(), 'contest_note': note})
        self._liwan_log('warning_contested', before)
        return self

    def _liwan_require_answer(self):
        if not self.env.is_superuser() and not self._liwan_is_own():
            raise AccessError(self.env._('Only the employee answers their own warning.'))
        if self.acknowledgement == 'off':
            raise AccessError(self.env._('Answering warnings is turned off for this warning.'))

    def action_withdraw(self, revision, reason):
        """Withdraw a warning with a reason: HR any open one, the drafting manager their own draft."""
        self._liwan_load(revision)
        self._liwan_expect('draft', 'issued', 'acknowledged', 'contested')
        if not self._liwan_can_withdraw():
            raise AccessError(self.env._('You may not withdraw this warning.'))
        reason = _text(self.env, reason, 'reason', required=True)
        before = self.env['liwan.hr.audit.event']._liwan_policy_snapshot(self)
        self._liwan_step({
            'state': 'withdrawn', 'withdrawn_by_id': self.env.user.id, 'withdrawn_at': fields.Datetime.now(),
            'withdraw_reason': reason,
        })
        self._liwan_log('warning_withdrawn', before)
        return self

    def _liwan_notify_employee(self):
        """A bell row for the employee, carrying only the type name; the reason is read on the warning itself."""
        self.ensure_one()
        user = self.employee_user_id
        if not user or user == self.env.user:
            return
        self.env['liwan.notify.service']._liwan_deliver(
            self._name, self.id, WARNING_KIND, user.partner_id,
            self.env._('A warning was issued to you'),
            key=f'{WARNING_KIND}:{self.id}:{user.partner_id.id}',
            values={'subject': self.type_id.name},
        )

    # --- escalation ----------------------------------------------------------------------------------------

    @api.model
    def _liwan_standing(self, employee):
        """The employee's escalation standing: counted warnings inside the company's window.

        A COUNT with no row content (the caller is authorized by the route; an issuing manager reads no
        warning that is not their own, but needs the number to judge the next step), so it reads the table
        directly rather than through the caller's record rules.
        """
        window = self.env['liwan.hr.warning.settings']._liwan_effective(employee.company_id)[
            'warnings_escalation_window_months'
        ]
        since = fields.Date.context_today(self) - relativedelta(months=window)
        self.flush_model()
        self.env.cr.execute(
            """
            SELECT COUNT(*), MAX(t.severity)
              FROM liwan_hr_warning w
              JOIN liwan_hr_warning_type t ON t.id = w.type_id
             WHERE w.employee_id = %s AND w.company_id = %s AND w.state IN %s AND w.date_issued >= %s
            """,
            (employee.id, employee.company_id.id, COUNTED_STATES, since),
        )
        count, highest = self.env.cr.fetchone()
        return {
            'employee_id': employee.id,
            'window_months': window,
            'active_count': count,
            'highest_severity': highest,
        }
