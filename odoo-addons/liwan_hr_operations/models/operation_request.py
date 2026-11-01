# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models
from odoo.exceptions import AccessError, ValidationError

from .common import (
    APPROVER,
    BRIDGE,
    BRIDGE_CONTEXT,
    KIND,
    LEAVE_REQUEST,
    OFFICERS,
    REJECTING_CONTEXT,
)


class HrOperationsRequest(models.Model):
    _inherit = 'liwan.operation.request'

    # The leave this request decides; the indexed relation the governed check and the visibility rules use.
    hr_leave_id = fields.Many2one('hr.leave', ondelete='set null', index='btree_not_null', readonly=True)

    @api.model
    def _operations_leave(self, leave_id):
        if isinstance(leave_id, bool) or not isinstance(leave_id, int) or leave_id <= 0:
            raise ValidationError(self.env._('Choose a valid leave request.'))
        leave = self.env['hr.leave'].search([('id', '=', leave_id), ('company_id', '=', self.env.company.id)], limit=1)
        if not leave:
            raise AccessError(self.env._('The leave request is not available.'))
        return leave

    @api.model
    def _operations_target_values(self, process, target_id):
        if process.execution_kind != KIND:
            return super()._operations_target_values(process, target_id)
        if self.env.context.get(BRIDGE_CONTEXT) is not BRIDGE:
            raise AccessError(self.env._('Leave requests are submitted from the leave form.'))
        leave = self._operations_leave(target_id)
        return {'hr_leave_id': leave.id, 'target_ref': {'write_date': fields.Datetime.to_string(leave.write_date)}}

    @api.model
    def _operations_creation_capability(self, execution_kind):
        # Whoever may request leave files its approval request; the operations create permission is not needed.
        return LEAVE_REQUEST if execution_kind == KIND else super()._operations_creation_capability(execution_kind)

    def _operations_prepare_submission(self, process):
        if process.execution_kind != KIND:
            return super()._operations_prepare_submission(process)
        self.env['liwan.entitlement.service'].require('hr.enabled')
        leave = self._operations_leave(self.hr_leave_id.id)
        if leave.state != 'confirm':
            raise ValidationError(self.env._('Only a pending leave request can be submitted for approval.'))
        return super()._operations_prepare_submission(process)

    def _operations_resolve_reviewers(self, key):
        if self.process_id.execution_kind != KIND or key not in (APPROVER, OFFICERS):
            return super()._operations_resolve_reviewers(key)
        employee = self._operations_leave(self.hr_leave_id.id).employee_id
        if key == APPROVER:
            users = employee.leave_manager_id
        else:
            users = self.env.ref('liwan_hr.group_cap_hr_leave_approve').user_ids
        return users - employee.user_id

    def _hr_leave_for_decision(self, *, rejecting=False):
        """The leave, still waiting and unchanged since it was requested, in the decider's identity."""
        self.env['liwan.entitlement.service'].require('hr.enabled')
        target = self.target_ref or {}
        env_self = self.with_context(**{REJECTING_CONTEXT: (BRIDGE, self.id)}) if rejecting else self
        leave = env_self._operations_leave(self.hr_leave_id.id)
        if leave.state != 'confirm' or fields.Datetime.to_string(leave.write_date) != target.get('write_date'):
            raise ValidationError(self.env._('The leave request changed after it was submitted. Withdraw it and submit a new one.'))
        if leave.employee_id.user_id == self.env.user:
            raise AccessError(self.env._('A leave request cannot be decided by its own employee.'))
        return leave.with_context(**{BRIDGE_CONTEXT: BRIDGE})

    def _execute_approved(self):
        if self.execution_kind != KIND:
            return super()._execute_approved()
        leave = self._hr_leave_for_decision()
        leave.action_approve()
        leave._liwan_notify_decision()
        return True

    def _execute_rejected(self):
        if self.execution_kind != KIND:
            return super()._execute_rejected()
        leave = self._hr_leave_for_decision(rejecting=True)
        leave.action_refuse()
        comment = self.event_ids.filtered(lambda event: event.kind == 'rejected')[-1:].comment
        if comment:
            leave.message_post(body=comment)
        leave._liwan_notify_decision()
        return True

    def _operations_target(self):
        if not self.hr_leave_id:
            return super()._operations_target()
        leave = self.env['hr.leave'].search([('id', '=', self.hr_leave_id.id)], limit=1)
        return {'id': leave.id, 'name': self.name, 'href': f'/hr/leave/{leave.id}'} if leave else None

    def _operations_allowed_actions(self):
        actions = super()._operations_allowed_actions()
        if self.execution_kind == KIND:
            actions.update({'edit': False, 'submit': False, 'return': False, 'withdraw': False})
        return actions

    def action_update(self, revision, name, description):
        if self.execution_kind == KIND:
            raise AccessError(self.env._('A leave request cannot be edited.'))
        return super().action_update(revision, name, description)

    def action_return(self, revision, comment):
        if self.execution_kind == KIND:
            raise AccessError(self.env._('A leave request cannot be returned for editing.'))
        return super().action_return(revision, comment)

    def action_withdraw(self, revision, comment=''):
        if self.execution_kind == KIND and self.env.context.get(BRIDGE_CONTEXT) is not BRIDGE:
            raise AccessError(self.env._('Withdraw a leave request from the leave form.'))
        return super().action_withdraw(revision, comment)
