# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The readiness check of the setup agent for liwan_tasks: the application is in use once it holds its first main record."""
from odoo import api, models

RECORD_CHECK = {
    'key': 'tasks.tasks', 'owner': 'liwan_tasks', 'feature_key': 'tasks.enabled', 'model': 'project.task',
    'capability': 'tasks.tasks.read', 'page': '/my-tasks',
    'label_ar': 'لا مهام بعد في مهامي: أضف أول مهمة',
    'label_en': 'No tasks yet in My tasks: add the first task',
}


class LiwanTasksAiReadiness(models.AbstractModel):
    _inherit = 'liwan.ai.readiness'

    @api.model
    def _liwan_ai_record_checks(self):
        return (*super()._liwan_ai_record_checks(), RECORD_CHECK)
