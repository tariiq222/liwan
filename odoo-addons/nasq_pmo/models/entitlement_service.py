# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class NasqPmoEntitlementService(models.AbstractModel):
    _inherit = 'nasq.entitlement.service'

    @api.model
    def _nasq_count_usage(self, limit_key):
        if limit_key == 'projects.max_projects':
            return self._nasq_count_projects()
        return super()._nasq_count_usage(limit_key)

    @api.model
    def _nasq_count_projects(self):
        self.env.cr.execute('SELECT count(*) FROM project_project WHERE active')
        return self.env.cr.fetchone()[0]

    @api.model
    def _nasq_claim_projects(self, delta):
        return self._nasq_claim('projects.max_projects', self._nasq_count_projects(), delta)
