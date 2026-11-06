# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The readiness check of the setup agent for liwan_pmo: the application is in use once it holds its first main record."""
from odoo import api, models

RECORD_CHECK = {
    'key': 'pmo.projects', 'owner': 'liwan_pmo', 'feature_key': 'pmo.enabled', 'model': 'project.project',
    'capability': 'pmo.projects.read', 'page': '/projects',
    'label_ar': 'لا مشاريع بعد في المشاريع: أنشئ أول مشروع',
    'label_en': 'No projects yet: create the first project',
}


class LiwanPmoAiReadiness(models.AbstractModel):
    _inherit = 'liwan.ai.readiness'

    @api.model
    def _liwan_ai_record_checks(self):
        return (*super()._liwan_ai_record_checks(), RECORD_CHECK)
