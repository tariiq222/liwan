# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import models


class HrEmployee(models.Model):
    _inherit = 'hr.employee'

    def _webvue_before_archive(self):
        super()._webvue_before_archive()
        service = self.env['webvue.access.service']
        for employee in self.filtered('user_id'):
            service._webvue_disable_employee_account(
                employee.id,
                employee.user_id.id,
                service._webvue_user_version(employee.user_id),
            )
