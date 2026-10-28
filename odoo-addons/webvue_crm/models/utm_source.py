# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models


class UtmSource(models.Model):
    _inherit = 'utm.source'

    # Stock sources cannot be archived; opportunities keep a source the settings page retired.
    active = fields.Boolean(default=True)
