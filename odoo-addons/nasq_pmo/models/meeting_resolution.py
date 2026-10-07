# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import models
from odoo.exceptions import UserError


class CyanMeetingResolution(models.Model):
    _inherit = 'cyan.meeting.resolution'

    def write(self, vals):
        if not self.env.su and (self._DECISION_FIELDS | {'state', 'result'}) & set(vals):
            # A recommendation followed on a linked record (a converted task) is frozen here.
            if self.env['nasq.meeting.links']._nasq_linked_resolution_ids(self):
                raise UserError(self.env._("Follow this recommendation on its task."))
        return super().write(vals)
