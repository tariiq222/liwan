# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models
from odoo.exceptions import ValidationError

ONBOARDING_STEP_KIND = 'hr.onboarding_step'


class LiwanHrPlanRun(models.Model):
    """One launch of an employee activity plan (onboarding or offboarding).

    The engine stays stock mail: a plan run only records which plan ran on which
    employee, when and by whom, and keeps the activities it created so the checklist
    progress can be read without touching mail.activity's own model. Purpose and
    progress are derived from the plan and the activities, never stored here.

    A run launched by mistake is cancelled, never archived: the manager still sees that
    it was cancelled, by whom and why. ``state`` stores only that decision; whether an
    open run is done stays derived from its activities.
    """

    _name = 'liwan.hr.plan.run'
    _description = 'LiwanOS HR plan run'
    _liwan_scope = 'company'

    employee_id = fields.Many2one(
        'hr.employee', required=True, ondelete='cascade', index=True,
    )
    plan_id = fields.Many2one(
        'mail.activity.plan', required=True, ondelete='restrict',
    )
    company_id = fields.Many2one(
        related='employee_id.company_id', store=True, index=True,
    )
    # Stored so a record rule can scope an employee to their own onboarding runs without reading the plan or
    # the employee record, which an employee has no access to.
    hr_purpose = fields.Selection(related='plan_id.hr_purpose', store=True, index=True)
    employee_user_id = fields.Many2one(related='employee_id.user_id', store=True, index=True)
    # Everyone a step of the run was ever assigned to (done steps included), so the person a step is handed to
    # reads the run and finishes their own step without any onboarding capability.
    assignee_ids = fields.Many2many(
        'res.users', relation='liwan_hr_plan_run_assignee_rel', compute='_compute_assignee_ids', store=True,
    )
    plan_date = fields.Date(required=True)
    launched_by_id = fields.Many2one(
        'res.users', required=True, default=lambda self: self.env.user,
    )
    activity_ids = fields.Many2many(
        'mail.activity', relation='liwan_hr_plan_run_activity_rel',
    )
    state = fields.Selection(
        [('open', 'Open'), ('cancelled', 'Cancelled')],
        required=True, default='open', index=True,
    )
    cancelled_by_id = fields.Many2one('res.users', readonly=True)
    cancelled_on = fields.Datetime(readonly=True)
    cancel_reason = fields.Text(readonly=True)

    @api.depends('activity_ids.user_id')
    def _compute_assignee_ids(self):
        for run in self:
            run.assignee_ids = run.with_context(active_test=False).activity_ids.user_id

    @api.constrains('state', 'cancel_reason')
    def _check_cancel_reason(self):
        for run in self:
            if run.state == 'cancelled' and not (run.cancel_reason or '').strip():
                raise ValidationError(self.env._('A cancelled plan run needs a reason.'))

    def _liwan_activities(self):
        """The run's checklist activities, archived (done) ones included."""
        return self.with_context(active_test=False).activity_ids

    def _liwan_notify_step_assignees(self):
        """A bell row for each person a step of this run is assigned to, never for the launcher."""
        self.ensure_one()
        for activity in self.activity_ids:
            user = activity.user_id
            if not user or user == self.env.user:
                continue
            self.env['liwan.notify.service']._liwan_deliver(
                self._name, self.id, ONBOARDING_STEP_KIND, user.partner_id,
                self.env._('%(actor)s assigned you an onboarding step', actor=self.env.user.name),
                key=f'{ONBOARDING_STEP_KIND}:{activity.id}:{user.partner_id.id}',
                values={'subject': activity.summary or ''},
            )

    def _liwan_is_done(self):
        activities = self._liwan_activities()
        return bool(activities) and all(activity.state == 'done' for activity in activities)

    def action_cancel(self, reason):
        """Close a run launched by mistake: its open steps go, its done steps stay as history.

        A done run is complete and a cancelled one is already closed, so neither is cancelled.
        One note on the employee records the decision and its reason.
        """
        self.ensure_one()
        reason = (reason or '').strip()
        if not reason:
            raise ValidationError(self.env._('A cancelled plan run needs a reason.'))
        if self.state == 'cancelled':
            raise ValidationError(self.env._('This plan run is already cancelled.'))
        if self._liwan_is_done():
            raise ValidationError(self.env._('A completed plan run cannot be cancelled.'))
        self._liwan_activities().filtered(lambda activity: activity.state != 'done').unlink()
        self.write({
            'state': 'cancelled',
            'cancelled_by_id': self.env.user.id,
            'cancelled_on': fields.Datetime.now(),
            'cancel_reason': reason,
        })
        self.employee_id.message_post(body=self.env._(
            'The plan "%(plan)s" was cancelled: %(reason)s', plan=self.plan_id.name, reason=reason,
        ))
        return True
