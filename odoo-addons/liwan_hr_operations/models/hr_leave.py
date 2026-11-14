# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command, fields, models
from odoo.exceptions import UserError, ValidationError

from .common import BRIDGE, BRIDGE_CONTEXT
from odoo.addons.liwan_approval_service.models.common import EXTERNAL_CLOSE


class HrLeave(models.Model):
    _inherit = 'hr.leave'

    liwan_approval_request_ids = fields.One2many('liwan.operation.request', 'hr_leave_id', readonly=True)

    def _liwan_request_approval(self):
        super()._liwan_request_approval()
        if self.state != 'confirm' or not self.env['liwan.entitlement.service']._liwan_feature_write('hr.enabled'):
            return
        processes = self.env['liwan.operation.process']
        process = processes._hr_leave_governing_process(self.company_id)
        if not process:
            if processes._hr_leave_is_being_edited(self.company_id):
                raise ValidationError(self.env._('The leave approval process is being edited. Request leave again once it is published.'))
            return
        requests = self.env['liwan.operation.request'].with_company(self.company_id).with_context(**{BRIDGE_CONTEXT: BRIDGE})
        record = requests.create({'name': self._hr_leave_summary(), 'process_id': process.id, 'target_id': self.id})
        record.action_submit(record.revision)
        subject = self.employee_id.user_id
        if subject and subject not in record.participant_ids:
            # A leave an HR actor files on someone's behalf stays visible to the person it is for.
            record._ops_write({'participant_ids': [Command.link(subject.id)]})

    def _hr_leave_summary(self):
        self.ensure_one()
        return self.env._(
            'Leave request: %(employee)s, %(date_from)s - %(date_to)s',
            employee=self.employee_id.name,
            date_from=self.request_date_from, date_to=self.request_date_to,
        )[:200]

    def _hr_leave_open_requests(self):
        # A user without read access to requests has no workflow role on the leave: the leave staff
        # who decide hold it through the bridge's own access rows, and a requester through their role.
        requests = self.env['liwan.operation.request']
        if not requests.has_access('read'):
            return requests
        return self.liwan_approval_request_ids.filtered(lambda record: record.state == 'pending')

    def _liwan_approval_governed(self):
        return super()._liwan_approval_governed() or bool(self._hr_leave_open_requests())

    def _liwan_withdraw_approval(self):
        super()._liwan_withdraw_approval()
        for record in self._hr_leave_open_requests():
            if record.requester_id == self.env.user:
                record.with_context(**{BRIDGE_CONTEXT: BRIDGE}).action_withdraw(record.revision)
            else:
                self._hr_leave_close_externally(record)

    def _hr_leave_close_externally(self, record):
        record.with_context(operations_external_close=EXTERNAL_CLOSE)._operations_close_externally(
            self.env._('The leave request was decided outside the approval workflow.'),
        )

    def _hr_leave_assert_not_governed(self):
        if self.env.context.get(BRIDGE_CONTEXT) is BRIDGE:
            return
        if any(leave._hr_leave_open_requests() for leave in self):
            raise UserError(self.env._('This request is decided by its approval workflow.'))

    def action_approve(self, check_state=True):
        self._hr_leave_assert_not_governed()
        return super().action_approve(check_state)

    def action_refuse(self):
        self._hr_leave_assert_not_governed()
        return super().action_refuse()
