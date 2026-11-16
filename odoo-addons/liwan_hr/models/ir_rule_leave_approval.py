# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models
from odoo.fields import Domain

from .leave_approval_constants import (
    KIND,
    LEAVE_REQUEST,
)

STAFF_CAPABILITIES = ('hr.leave.approve', 'hr.leave.manage')


class LiwanHrLeaveApprovalIrRule(models.Model):
    _inherit = 'ir.rule'

    @api.model
    def _liwan_fresh_company_domain(self, model_name, mode):
        domain = super()._liwan_fresh_company_domain(model_name, mode)
        if self.env.su:
            return domain
        if model_name in ('liwan.operation.process', 'liwan.operation.process.step'):
            service = self.env['liwan.access.service']
            companies = sorted(set(service._liwan_operation_capability_company_ids('hr.leave.config')) & set(service._liwan_scoped_company_ids()))
            prefix = 'process_id.' if model_name.endswith('.step') else ''
            domain |= Domain(prefix + 'execution_kind', '=', KIND) & Domain('company_id', 'in', companies)
        if mode != 'read':
            return domain
        if model_name == 'liwan.operation.process':
            # Whoever may request leave sees the company's leave process in any state, so a leave filed while it
            # is being edited is refused instead of silently skipping the workflow. Read only.
            service = self.env['liwan.access.service']
            requesters = sorted(set(service._liwan_operation_capability_company_ids(LEAVE_REQUEST)) & set(service._liwan_scoped_company_ids()))
            return domain | (Domain('execution_kind', '=', KIND) & Domain('company_id', 'in', requesters))
        if model_name != 'liwan.operation.request':
            return domain
        # Leave staff read the company's leave approval requests, as they read its leaves, so the
        # governed check sees the open request of a leave they are not a reviewer of. Read only: the
        # widening grants no write on a request, whose decisions the engine's own guard authorizes.
        service = self.env['liwan.access.service']
        staff_ids = set()
        for key in STAFF_CAPABILITIES:
            staff_ids.update(service._liwan_operation_capability_company_ids(key))
        companies = sorted(staff_ids & set(service._liwan_scoped_company_ids()))
        return domain | (Domain('execution_kind', '=', KIND) & Domain('company_id', 'in', companies))
