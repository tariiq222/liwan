# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class ProjectTask(models.Model):
    _inherit = 'project.task'

    def _nasq_notify(self, event, extra_partners=None):
        bus = self.env['bus.bus']
        for task in self:
            partners = task.user_ids.partner_id | self.env.user.partner_id
            if extra_partners:
                partners |= extra_partners.get(task.id, partners.browse())
            for partner in partners:
                bus._sendone(partner, 'nasq/task', {'id': task.id, 'event': event})

    @api.model_create_multi
    def create(self, vals_list):
        tasks = super().create(vals_list)
        tasks._nasq_notify('created')
        return tasks

    def write(self, vals):
        before = {task.id: task.user_ids.partner_id for task in self}
        res = super().write(vals)
        self._nasq_notify('updated', extra_partners=before)
        return res
