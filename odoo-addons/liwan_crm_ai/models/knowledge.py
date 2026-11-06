# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The knowledge source of the CRM application (spec 2026-11-04 §6.3): the text of an opportunity. Contact data (phone,
email) is not declared, and the visibility policy of the opportunity decides who reads which one."""
from odoo import api, models

CRM_SOURCE = {
    'model': 'crm.lead',
    'owner': 'liwan_crm',
    'feature_key': 'crm.enabled',
    'title_field': 'name',
    # Read, and assign: without the assign capability the visibility rule shows only the indexer's own (no) opportunities.
    'indexer_capabilities': ['crm.leads.read', 'crm.leads.assign'],
    'fields': ['description', 'stage_id', 'partner_name'],
    'label_ar': 'الفرص البيعية',
    'label_en': 'Sales opportunities',
}


class LiwanCrmAiKnowledge(models.AbstractModel):
    _inherit = 'liwan.ai.knowledge.registry'

    @api.model
    def _liwan_ai_knowledge_sources(self):
        return [*super()._liwan_ai_knowledge_sources(), CRM_SOURCE]


class CrmLead(models.Model):
    _inherit = 'crm.lead'

    @api.model_create_multi
    def create(self, vals_list):
        records = super().create(vals_list)
        self.env['liwan.ai.knowledge.registry']._liwan_ai_knowledge_changed(records)
        return records

    def write(self, vals):
        result = super().write(vals)
        self.env['liwan.ai.knowledge.registry']._liwan_ai_knowledge_changed(self, vals)
        return result

    def unlink(self):
        self.env['liwan.ai.knowledge.registry']._liwan_ai_knowledge_forget(self)
        return super().unlink()
