# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command, fields, models
from odoo.exceptions import UserError

from .common import BRIDGE, BRIDGE_CONTEXT, operations_enabled
from odoo.addons.liwan_operations.models.common import EXTERNAL_CLOSE


class HrLeave(models.Model):
    _inherit = 'hr.leave'

    liwan_approval_request_ids = fields.One2many('liwan.operation.request', 'hr_leave_id', readonly=True)

    def _liwan_request_approval(self):
        super()._liwan_request_approval()
        if self.state != 'confirm' or not operations_enabled(self.env):
            return
        process = self.env['liwan.operation.process']._hr_leave_governing_process(self.company_id)
        if not process:
            return
        requests = self.env['liwan.operation.request'].with_company(self.company_id).with_context(**{BRIDGE_CONTEXT: BRIDGE})
        record = requests.create({'name': self._hr_leave_summary(), 'description': self.notes or '', 'process_id': process.id, 'target_id': self.id})
        record.action_submit(record.revision)
        subject = self.employee_id.user_id
        if subject and subject not in record.participant_ids:
            # A leave an HR actor files on someone's behalf stays visible to the person it is for.
            record._ops_write({'participant_ids': [Command.link(subject.id)]})

    def _hr_leave_summary(self):
        self.ensure_one()
        return self.env._(
            '%(type)s: %(employee)s, %(date_from)s - %(date_to)s',
            type=self.holiday_status_id.name, employee=self.employee_id.name,
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
        return super()._liwan_approval_governed() or (operations_enabled(self.env) and bool(self._hr_leave_open_requests()))

    def _liwan_withdraw_approval(self):
        super()._liwan_withdraw_approval()
        operations = operations_enabled(self.env)
        for record in self._hr_leave_open_requests():
            if operations and record.requester_id == self.env.user:
                record.with_context(**{BRIDGE_CONTEXT: BRIDGE}).action_withdraw(record.revision)
            else:
                self._hr_leave_close_externally(record)

    def _hr_leave_close_externally(self, record):
        record.with_context(operations_external_close=EXTERNAL_CLOSE)._operations_close_externally(
            self.env._('The leave request was decided outside the approval workflow.'),
        )

    def _hr_leave_assert_not_governed(self):
        """Stock approve and refuse belong to the workflow while it governs the leave.

        An HR decision taken while operations is off closes the request it leaves open, so nothing
        stays pending for when operations returns.
        """
        if self.env.context.get(BRIDGE_CONTEXT) is BRIDGE:
            return
        operations = operations_enabled(self.env)
        for leave in self:
            for record in leave._hr_leave_open_requests():
                if operations:
                    raise UserError(self.env._('This request is decided by its approval workflow.'))
                leave._hr_leave_close_externally(record)

    def action_approve(self, check_state=True):
        self._hr_leave_assert_not_governed()
        return super().action_approve(check_state)

    def action_refuse(self):
        self._hr_leave_assert_not_governed()
        return super().action_refuse()
