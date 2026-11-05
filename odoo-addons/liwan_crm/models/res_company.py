# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models


class ResCompany(models.Model):
    _inherit = 'res.company'

    # Lets the crm.lead record rules read the company's visibility mode inside the query
    # (security/crm_rules.xml), so a settings change applies on the next search without a rule
    # cache to clear. A company has at most one row (unique company_id); none means the default.
    liwan_crm_settings_ids = fields.One2many('liwan.crm.settings', 'company_id')
    # The custom fields every opportunity of the company carries (Odoo's native properties engine).
    liwan_lead_properties_definition = fields.PropertiesDefinition('Lead properties')

    @api.model
    def _liwan_lead_properties_definition(self, company=None):
        """The lead fields definition of ``company`` (the current one by default), or an empty list."""
        return (company or self.env.company).liwan_lead_properties_definition or []

    @api.model
    def _liwan_set_lead_properties_definition(self, definition):
        """Replace the lead properties definition of the current company. Settings route only.

        res.company is writable by group_erp_manager alone, and a CRM settings manager need not
        hold it, so the single definition field is written elevated; the caller checked
        crm.settings.manage and validated the definition (liwan_api.serializers.properties).
        """
        self.env.company.sudo().write({'liwan_lead_properties_definition': definition})
