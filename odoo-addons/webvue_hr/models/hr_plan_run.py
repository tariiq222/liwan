# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models
from odoo.exceptions import ValidationError


class WebVueHrPlanRun(models.Model):
    """One launch of an employee activity plan (onboarding or offboarding).

    The engine stays stock mail: a plan run only records which plan ran on which
    employee, when and by whom, and keeps the activities it created so the checklist
    progress can be read without touching mail.activity's own model. Purpose and
    progress are derived from the plan and the activities, never stored here.

    A run launched by mistake is cancelled, never archived: the manager still sees that
    it was cancelled, by whom and why. ``state`` stores only that decision; whether an
    open run is done stays derived from its activities.
    """

    _name = 'webvue.hr.plan.run'
    _description = 'WebVue HR plan run'
    _webvue_scope = 'company'

    employee_id = fields.Many2one(
        'hr.employee', required=True, ondelete='cascade', index=True,
    )
    plan_id = fields.Many2one(
        'mail.activity.plan', required=True, ondelete='restrict',
    )
    company_id = fields.Many2one(
        related='employee_id.company_id', store=True, index=True,
    )
    plan_date = fields.Date(required=True)
    launched_by_id = fields.Many2one(
        'res.users', required=True, default=lambda self: self.env.user,
    )
    activity_ids = fields.Many2many(
        'mail.activity', relation='webvue_hr_plan_run_activity_rel',
    )
    state = fields.Selection(
        [('open', 'Open'), ('cancelled', 'Cancelled')],
        required=True, default='open', index=True,
    )
    cancelled_by_id = fields.Many2one('res.users', readonly=True)
    cancelled_on = fields.Datetime(readonly=True)
    cancel_reason = fields.Text(readonly=True)

    @api.constrains('state', 'cancel_reason')
    def _check_cancel_reason(self):
        for run in self:
            if run.state == 'cancelled' and not (run.cancel_reason or '').strip():
                raise ValidationError(self.env._('A cancelled plan run needs a reason.'))

    def _webvue_activities(self):
        """The run's checklist activities, archived (done) ones included."""
        return self.with_context(active_test=False).activity_ids

    def _webvue_is_done(self):
        activities = self._webvue_activities()
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
        if self._webvue_is_done():
            raise ValidationError(self.env._('A completed plan run cannot be cancelled.'))
        self._webvue_activities().filtered(lambda activity: activity.state != 'done').unlink()
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
