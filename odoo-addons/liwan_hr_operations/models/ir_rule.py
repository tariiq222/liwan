# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models
from odoo.fields import Domain

from .common import BRIDGE, KIND, REJECTING_CONTEXT

STAFF_CAPABILITIES = ('hr.leave.approve', 'hr.leave.manage')


class HrOperationsIrRule(models.Model):
    _inherit = 'ir.rule'

    @api.model
    def _liwan_leave_extra_read_domain(self):
        """The employee's time-off approver reads the leave while the workflow awaits a decision on it."""
        extra = super()._liwan_leave_extra_read_domain()
        if not self.env['liwan.operation.request'].has_access('read'):
            return extra
        memberships = self.env['liwan.access.service']._liwan_membership_company_ids()
        request_domain = [('state', '=', 'pending'), ('execution_kind', '=', KIND)]
        rejecting = self.env.context.get(REJECTING_CONTEXT)
        if isinstance(rejecting, tuple) and rejecting[0] is BRIDGE:
            request_domain = [('execution_kind', '=', KIND), '|', ('state', '=', 'pending'), '&', ('id', '=', rejecting[1]), ('state', '=', 'rejected')]
        pending = Domain('liwan_approval_request_ids', 'any', request_domain)
        return extra | (Domain('employee_id.leave_manager_id', '=', self.env.uid) & Domain('company_id', 'in', memberships) & pending)

    @api.model
    def _liwan_fresh_company_domain(self, model_name, mode):
        domain = super()._liwan_fresh_company_domain(model_name, mode)
        if model_name != 'liwan.operation.request' or self.env.su:
            return domain
        # Leave staff read the company's leave approval requests, as they read its leaves, so the
        # governed check sees the open request of a leave they are not a reviewer of.
        service = self.env['liwan.access.service']
        staff_ids = set()
        for key in STAFF_CAPABILITIES:
            staff_ids.update(service._liwan_operation_capability_company_ids(key))
        companies = sorted(staff_ids & set(service._liwan_scoped_company_ids()))
        return domain | (Domain('execution_kind', '=', KIND) & Domain('company_id', 'in', companies))
