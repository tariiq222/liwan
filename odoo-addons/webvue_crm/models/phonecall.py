# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models


class CrmPhonecall(models.Model):
    _inherit = 'crm.phonecall'

    webvue_outcome_id = fields.Many2one(
        'webvue.crm.call.outcome', string='Outcome', index='btree_not_null', ondelete='restrict',
    )
