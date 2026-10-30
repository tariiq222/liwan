# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import models


class HrEmployee(models.Model):
    _inherit = 'hr.employee'

    def _liwan_before_archive(self):
        super()._liwan_before_archive()
        service = self.env['liwan.access.service']
        for employee in self.filtered('user_id'):
            service._liwan_disable_employee_account(
                employee.id,
                employee.user_id.id,
                service._liwan_user_version(employee.user_id),
            )
