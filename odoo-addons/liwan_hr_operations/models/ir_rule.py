# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models
from odoo.fields import Domain

from .common import BRIDGE, KIND, LEAVE_REQUEST, REJECTING_CONTEXT

STAFF_CAPABILITIES = ('hr.leave.approve', 'hr.leave.manage')


class HrOperationsIrRule(models.Model):
    _inherit = 'ir.rule'

    @api.model
    def _liwan_leave_extra_read_domain(self):
        """The time-off approver reads the leave while it is pending and they hold its snapshotted review right."""
        extra = super()._liwan_leave_extra_read_domain()
        requests = self.env['liwan.operation.request']
        if not requests.has_access('read'):
            return extra
        memberships = self.env['liwan.access.service']._liwan_membership_company_ids()
        candidates = requests.search([
            ('state', '=', 'pending'), ('execution_kind', '=', KIND),
            ('company_id', 'in', memberships), ('participant_ids', 'in', [self.env.uid]),
        ])
        eligible = candidates.filtered(lambda approval: approval._is_stage_reviewer())
        rejecting = self.env.context.get(REJECTING_CONTEXT)
        if isinstance(rejecting, tuple) and rejecting[0] is BRIDGE:
            eligible |= requests.search([('execution_kind', '=', KIND), ('id', '=', rejecting[1]), ('state', '=', 'rejected')])
        return extra | (
            Domain('employee_id.leave_manager_id', '=', self.env.uid)
            & Domain('company_id', 'in', memberships)
            & Domain('liwan_approval_request_ids', 'in', eligible.ids)
        )

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
