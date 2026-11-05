# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import models
from odoo.exceptions import ValidationError


class LiwanAiAccessRole(models.Model):
    _inherit = 'liwan.access.role'

    def unlink(self):
        """A role an agent is limited to cannot be deleted: dropping it from the list would open the agent to everyone.

        The relation is read in SQL: whoever manages roles need not hold the AI settings ACLs.
        """
        if self.ids:
            self.env.cr.execute(
                'SELECT 1 FROM liwan_ai_agent_setting_role_rel WHERE role_id = ANY(%s) LIMIT 1', [list(self.ids)],
            )
            if self.env.cr.fetchone():
                raise ValidationError(self.env._('This role limits an AI agent; remove it from the agent first.'))
        return super().unlink()
