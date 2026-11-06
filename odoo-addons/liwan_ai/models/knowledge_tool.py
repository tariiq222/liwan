# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The platform tool that searches the company's records (spec 2026-11-04 §6.3). The AI service embeds ``query`` and adds
the candidate references (``refs``); the route then returns the text of the candidates the asking user may read."""
from odoo import api, models

from odoo.addons.liwan_ai.models.access_service import AI_USE

KNOWLEDGE_TOOL = {
    'name': 'ai.search_knowledge', 'owner': 'liwan_ai', 'kind': 'read', 'capability': AI_USE, 'feature_key': 'ai.knowledge',
    'platform': True, 'setting': 'knowledge_enabled', 'service_inputs': ['refs'],
    'description_ar': 'يبحث في نصوص سجلات الشركة (كالمهام والفرص) عن ما يخص السؤال ويعيد المقاطع التي يحق للمستخدم قراءتها',
    'description_en': "Search the text of the company's records (such as tasks and opportunities) for what the question asks, "
                      'and return the passages the user may read',
    'route': {'method': 'POST', 'path': '/api/v1/ai/knowledge/resolve'},
    'input_schema': {
        'type': 'object',
        'properties': {'query': {'type': 'string', 'minLength': 1, 'maxLength': 500}},
        'required': ['query'],
        'additionalProperties': False,
    },
    'input_map': {'body': {'refs': '$refs'}},
    'result_summary': ['items[]'],
}


class LiwanAiKnowledgeTool(models.AbstractModel):
    _inherit = 'liwan.ai.tool.registry'

    @api.model
    def _liwan_ai_tool_definitions(self):
        return (*super()._liwan_ai_tool_definitions(), KNOWLEDGE_TOOL)
