# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The personal tasks agent of the LiwanOS AI and its tools: read tools over existing liwan_tasks routes, each with the
capability its route already checks. Fields that are sensitive never appear in a result summary."""
from odoo import api, models

from odoo.addons.liwan_ai.models.tool_registry import QUERY_SCHEMA, read_tool

OWNER = 'liwan_tasks'
FEATURE = 'tasks.enabled'

TASKS_AGENT = {
    'key': 'tasks',
    'owner': OWNER,
    'feature_key': FEATURE,
    'name_ar': 'وكيل مهامي',
    'name_en': 'My tasks agent',
    'description_ar': 'مهام المستخدم الشخصية والمسندة إليه وما تأخر منها',
    'description_en': "The user's personal and assigned tasks and what is overdue",
    'instructions_ar': 'أنت وكيل مهامي. تقرأ مهام المستخدم وملخصها. رتّب ما تعرضه حسب الموعد، واذكر المتأخر أولًا.',
    'instructions_en': "You are the my-tasks agent. You read the user's tasks and their summary. Order what you show by deadline and mention overdue tasks first.",
    'pages': ['tasks'],
}


TASKS_AI_TOOLS = (
    read_tool(
        OWNER, FEATURE, 'tasks.list_my_tasks', 'tasks.tasks.read',
        ('يعرض مهام المستخدم مع موعدها وأولويتها ومصدرها', "List the user's tasks with deadline, priority and source"),
        '/api/v1/my-tasks',
        {'closed': {'type': 'string', 'enum': ['0', '1']}, 'sort': {'type': 'string', 'enum': ['deadline', 'created', 'name']}, 'q': QUERY_SCHEMA, 'limit': {'type': 'integer', 'minimum': 1, 'maximum': 50}},
        {'closed': '$closed', 'sort': '$sort', 'q': '$q', 'limit': '$limit'},
        ['items[].id', 'items[].name', 'items[].state', 'items[].priority', 'items[].date_deadline', 'items[].source', 'items[].project.name', 'total'],
    ),
    read_tool(
        OWNER, FEATURE, 'tasks.get_my_summary', 'tasks.tasks.read',
        ('يعرض عدد مهام المستخدم المفتوحة والمتأخرة والمنجزة', "Count the user's open, overdue and done tasks"),
        '/api/v1/my-tasks/summary',
        {},
        {},
        ['total', 'open', 'overdue', 'done'],
    ),
)


class LiwanTasksAiAgent(models.AbstractModel):
    _inherit = 'liwan.ai.agent.registry'

    @api.model
    def _liwan_ai_agent_definitions(self):
        return (*super()._liwan_ai_agent_definitions(), TASKS_AGENT)


class LiwanTasksAiTools(models.AbstractModel):
    _inherit = 'liwan.ai.tool.registry'

    @api.model
    def _liwan_ai_tool_definitions(self):
        return super()._liwan_ai_tool_definitions() + TASKS_AI_TOOLS
