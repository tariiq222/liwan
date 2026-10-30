# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models
from odoo.exceptions import ValidationError

# The employee activity plans of the onboarding and offboarding areas. The stock
# hr module ships one plan per purpose (onboarding_plan/offboarding_plan); this field
# is what tells them apart and what data/hr_plan_purpose_data.xml, the migration and
# the area routes read.
HR_PURPOSES = [
    ('onboarding', 'Onboarding'),
    ('offboarding', 'Offboarding'),
]
EMPLOYEE_PLAN_RES_MODEL = 'hr.employee'


class MailActivityPlan(models.Model):
    _inherit = 'mail.activity.plan'

    hr_purpose = fields.Selection(
        HR_PURPOSES,
        string='HR Purpose',
        help='Which employee lifecycle the plan belongs to; empty on every other plan.',
    )

    @api.constrains('hr_purpose', 'res_model')
    def _check_hr_purpose(self):
        for plan in self:
            if plan.hr_purpose and plan.res_model != EMPLOYEE_PLAN_RES_MODEL:
                msg = 'An HR purpose is only allowed on plans of hr.employee.'
                raise ValidationError(msg)

    @api.constrains('company_id', 'department_id')
    def _check_department_company(self):
        # mail.activity.plan has no _check_company_auto, so check_company on
        # department_id is never enforced; hr.department re-runs this on its side.
        # A company department needs a plan of that same company: a shared (companyless)
        # plan is visible everywhere, so it may only point at a companyless department.
        if any(
            plan.department_id.company_id
            and plan.company_id != plan.department_id.company_id
            for plan in self
        ):
            msg = 'an activity plan and its department must belong to the same company'
            raise ValidationError(msg)
