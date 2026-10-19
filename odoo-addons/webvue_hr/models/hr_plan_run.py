# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models


class WebVueHrPlanRun(models.Model):
    """One launch of an employee activity plan (onboarding or offboarding).

    The engine stays stock mail: a plan run only records which plan ran on which
    employee, when and by whom, and keeps the activities it created so the checklist
    progress can be read without touching mail.activity's own model. Purpose and
    progress are derived from the plan and the activities, never stored here.
    """

    _name = 'webvue.hr.plan.run'
    _description = 'WebVue HR plan run'

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
