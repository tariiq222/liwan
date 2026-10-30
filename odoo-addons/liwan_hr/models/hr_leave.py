# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import models
from odoo.exceptions import AccessError

from .notification_types import DECISION_KINDS


class HrLeave(models.Model):
    _inherit = 'hr.leave'

    def write(self, vals):
        if vals.get('state') == 'cancel' and not self.env.is_superuser():
            raise AccessError(self.env._('Use the policy checked cancellation wizard.'))
        return super().write(vals)

    def _liwan_notify_decision(self):
        """Bell row for the employee once the request is approved or refused, never for the decider."""
        self.ensure_one()
        kind = DECISION_KINDS.get(self.state)
        user = self.employee_id.user_id
        if not kind or not user or user == self.env.user:
            return
        self.env['liwan.notify.service']._liwan_deliver(
            self._name, self.id, kind, user.partner_id,
            self.env._('%(actor)s decided your leave request', actor=self.env.user.name),
            key=f'{kind}:{self.id}:{user.partner_id.id}',
            values={'subject': f'{self.request_date_from} - {self.request_date_to}'},
            replace=True,
        )
