# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import models
from odoo.exceptions import AccessError


class HrHolidaysCancelLeave(models.TransientModel):
    _inherit = 'hr.holidays.cancel.leave'

    def action_cancel_leave(self):
        self.ensure_one()
        self.env['webvue.entitlement.service'].require('hr.enabled')
        leave = self.leave_id
        model = self.env['webvue.hr.leave.cancellation']
        if (leave.company_id != self.env.company or leave.employee_id.user_id != self.env.user
                or not self.env.user.active or not model._webvue_can('hr.leave.request') or self.env.is_superuser()):
            raise AccessError(self.env._('Only the ordinary employee account may execute native cancellation.'))
        leave.check_access('read')
        model._webvue_lock_leave(leave)
        model._webvue_owner_leave(leave)
        row = model.search([('leave_id', '=', leave.id)], limit=1)
        authorized = bool(row and row._webvue_marker_authorizes(leave))
        if not authorized:
            if row and row.state == 'pending':
                raise AccessError(self.env._('This cancellation is waiting for a manager decision.'))
            policy = self.env['webvue.hr.leave.settings']._webvue_effective_policy(leave.company_id)
            if leave.state == 'validate' and policy != 'direct_employee':
                raise AccessError(self.env._('The company requires a manager decision before cancelling approved leave.'))
        return super().action_cancel_leave()
