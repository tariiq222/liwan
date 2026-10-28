# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models


class CrmStage(models.Model):
    _inherit = 'crm.stage'

    # Stock stages cannot be archived; the settings page archives instead of deleting.
    active = fields.Boolean(default=True)
