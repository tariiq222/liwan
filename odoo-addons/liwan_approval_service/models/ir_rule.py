# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models
from odoo.fields import Domain


class OperationsRule(models.Model):
    _inherit = 'ir.rule'

    @api.model
    def _liwan_fresh_company_domain(self, model_name, mode):
        domain = super()._liwan_fresh_company_domain(model_name, mode)
        if self.env.su:
            return domain
        # Extend LiwanOS's fresh fence, not the cached native domain: revoking
        # management/monitoring must restore privacy even while read remains.
        policies = {
            'liwan.operation.process': (
                'operations.processes.manage', Domain('state', '=', 'published'),
            ),
            'liwan.operation.process.step': (
                'operations.processes.manage', Domain('process_id.state', '=', 'published'),
            ),
            'liwan.operation.request': (
                'operations.monitoring.read',
                Domain('requester_id', '=', self.env.uid) | Domain('participant_ids', 'in', [self.env.uid]),
            ),
            'liwan.operation.event': (
                'operations.monitoring.read',
                Domain('request_id.requester_id', '=', self.env.uid) | Domain('request_id.participant_ids', 'in', [self.env.uid]),
            ),
        }
        if model_name not in policies:
            return domain
        capability, ordinary_visibility = policies[model_name]
        service = self.env['liwan.access.service']
        privileged = [company.id for company in self.env['res.company'].browse(service._liwan_scoped_company_ids())
                      if service._liwan_has_capability(self.env.user, capability, company=company)]
        return domain & (Domain('company_id', 'in', privileged) | ordinary_visibility)
