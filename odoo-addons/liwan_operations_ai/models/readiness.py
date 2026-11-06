# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The readiness check of the setup agent for liwan_operations: the application is in use once it holds its first main record."""
from odoo import api, models

RECORD_CHECK = {
    'key': 'operations.requests', 'owner': 'liwan_operations', 'feature_key': 'operations.enabled', 'model': 'liwan.operation.request',
    'capability': 'operations.requests.read', 'page': '/operations',
    'label_ar': 'لا طلبات بعد في العمليات: ارفع أول طلب',
    'label_en': 'No requests yet in Operations: submit the first request',
}


class LiwanOperationsAiReadiness(models.AbstractModel):
    _inherit = 'liwan.ai.readiness'

    @api.model
    def _liwan_ai_record_checks(self):
        return (*super()._liwan_ai_record_checks(), RECORD_CHECK)
