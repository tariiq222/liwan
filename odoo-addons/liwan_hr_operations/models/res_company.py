# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

from .common import KIND


class ResCompany(models.Model):
    _inherit = 'res.company'

    @api.model_create_multi
    def create(self, vals_list):
        companies = super().create(vals_list)
        # Only provisioning (the superuser environment) seeds; a company made interactively
        # gets its process from the explicit default-process route.
        if self.env.su:
            companies._hr_leave_seed_default_process()
        return companies

    def _hr_leave_seed_default_process(self):
        """Publish the default leave approval process for companies that have none."""
        service = self.env['liwan.entitlement.service']
        if not (service._liwan_feature_write('hr.enabled') and service._liwan_feature_write('operations.enabled')):
            return
        processes = self.env['liwan.operation.process']
        values, steps = processes._hr_leave_default_process()
        for company in self.filtered(lambda c: not processes.search_count([('company_id', '=', c.id), ('execution_kind', '=', KIND)])):
            processes._operations_seed(company, values, steps)
