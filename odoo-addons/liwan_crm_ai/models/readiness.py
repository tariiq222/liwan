# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The readiness check of the setup agent for liwan_crm: the application is in use once it holds its first main record."""
from odoo import api, models

RECORD_CHECK = {
    'key': 'crm.opportunities', 'owner': 'liwan_crm', 'feature_key': 'crm.enabled', 'model': 'crm.lead',
    'capability': 'crm.leads.read', 'page': '/crm',
    'label_ar': 'لا فرص بعد في إدارة العملاء: أضف أول فرصة',
    'label_en': 'No opportunities yet in CRM: add the first one',
}


class LiwanCrmAiReadiness(models.AbstractModel):
    _inherit = 'liwan.ai.readiness'

    @api.model
    def _liwan_ai_record_checks(self):
        return (*super()._liwan_ai_record_checks(), RECORD_CHECK)
