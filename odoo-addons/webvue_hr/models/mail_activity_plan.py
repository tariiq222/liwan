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
