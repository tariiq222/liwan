# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The readiness check of the setup agent for liwan_hr: the application is in use once it holds its first main record."""
from odoo import api, models

RECORD_CHECK = {
    'key': 'hr.employees', 'owner': 'liwan_hr', 'feature_key': 'hr.enabled', 'model': 'hr.employee',
    'capability': 'hr.employees.read', 'page': '/hr',
    'label_ar': 'لا موظفين بعد في الموارد البشرية: أضف أول موظف',
    'label_en': 'No employees yet in HR: add the first employee',
}


class LiwanHrAiReadiness(models.AbstractModel):
    _inherit = 'liwan.ai.readiness'

    @api.model
    def _liwan_ai_record_checks(self):
        return (*super()._liwan_ai_record_checks(), RECORD_CHECK)
