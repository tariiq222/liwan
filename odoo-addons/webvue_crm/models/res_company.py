# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models


class ResCompany(models.Model):
    _inherit = 'res.company'

    # Lets the crm.lead record rules read the company's visibility mode inside the query
    # (security/crm_rules.xml), so a settings change applies on the next search without a rule
    # cache to clear. A company has at most one row (unique company_id); none means the default.
    webvue_crm_settings_ids = fields.One2many('webvue.crm.settings', 'company_id')
