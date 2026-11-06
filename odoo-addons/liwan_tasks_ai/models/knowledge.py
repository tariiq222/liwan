# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The knowledge source of the tasks application (spec 2026-11-04 §6.3): the text of a task. Personal tasks stay private
to their participants (the record rule hides them from the technical indexer and from every other reader)."""
from odoo import api, models

TASKS_SOURCE = {
    'model': 'project.task',
    'owner': 'liwan_tasks',
    'feature_key': 'tasks.enabled',
    'title_field': 'name',
    # What the task rules and routes ask of a reader; the indexer user holds it in every company.
    'indexer_capabilities': ['pmo.tasks.read'],
    'fields': ['description', 'project_id', 'stage_id'],
    'label_ar': 'المهام',
    'label_en': 'Tasks',
}


class LiwanTasksAiKnowledge(models.AbstractModel):
    _inherit = 'liwan.ai.knowledge.registry'

    @api.model
    def _liwan_ai_knowledge_sources(self):
        return [*super()._liwan_ai_knowledge_sources(), TASKS_SOURCE]


class ProjectTask(models.Model):
    _inherit = 'project.task'

    def unlink(self):
        self.env['liwan.ai.knowledge.registry']._liwan_ai_knowledge_forget(self)
        return super().unlink()
