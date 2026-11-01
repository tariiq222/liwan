# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

# Stock lets the employee's time-off approver refuse a pending leave (stage one of the workflow)
# only when the leave type validates in two steps, so every validating type is kept on 'both'.
SINGLE_STEP_VALIDATIONS = ('hr', 'manager')


class HrLeaveType(models.Model):
    _inherit = 'hr.leave.type'

    @api.model_create_multi
    def create(self, vals_list):
        return super().create([
            {**vals, 'leave_validation_type': 'both'} if vals.get('leave_validation_type', 'hr') in SINGLE_STEP_VALIDATIONS else vals
            for vals in vals_list
        ])

    def write(self, vals):
        if vals.get('leave_validation_type') in SINGLE_STEP_VALIDATIONS:
            vals = {**vals, 'leave_validation_type': 'both'}
        return super().write(vals)
