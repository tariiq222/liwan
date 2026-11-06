# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The readiness check of the setup agent for liwan_finance: the application is in use once it holds its first main record."""
from odoo import api, models

RECORD_CHECK = {
    'key': 'finance.invoices', 'owner': 'liwan_finance', 'feature_key': 'finance.enabled', 'model': 'account.move',
    'capability': 'finance.invoices.read', 'page': '/finance',
    'domain': [('move_type', 'in', ('out_invoice', 'in_invoice'))],
    'label_ar': 'لا فواتير بعد في المالية: أنشئ أول فاتورة',
    'label_en': 'No invoices yet in Finance: create the first invoice',
}


class LiwanFinanceAiReadiness(models.AbstractModel):
    _inherit = 'liwan.ai.readiness'

    @api.model
    def _liwan_ai_record_checks(self):
        return (*super()._liwan_ai_record_checks(), RECORD_CHECK)
