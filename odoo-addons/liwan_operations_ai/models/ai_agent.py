# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The operations agent of the LiwanOS AI and its tools: read tools over existing liwan_operations routes, each with the
capability its route already checks. Fields that are sensitive never appear in a result summary."""
from odoo import api, models

from odoo.addons.liwan_ai.models.tool_registry import (
    PAGE_SCHEMA,
    QUERY_SCHEMA,
    read_tool,
)

OWNER = 'liwan_operations'
FEATURE = 'operations.enabled'

OPERATIONS_AGENT = {
    'key': 'operations',
    'owner': OWNER,
    'feature_key': FEATURE,
    'name_ar': 'وكيل العمليات',
    'name_en': 'Operations agent',
    'description_ar': 'طلبات المستخدم في العمليات وحالتها، والعمليات التي يمكنه تقديم طلب بها',
    'description_en': "The user's operation requests and their state, and the processes they can request",
    'instructions_ar': 'أنت وكيل العمليات. تقرأ طلبات المستخدم وحالتها والعمليات المتاحة له. تقديم طلب جديد يتم من صفحة العمليات.',
    'instructions_en': "You are the operations agent. You read the user's requests, their state and the processes available to them. A new request is submitted from the operations page.",
    'pages': ['operations'],
}


OPERATIONS_AI_TOOLS = (
    read_tool(
        OWNER, FEATURE, 'operations.list_my_requests', 'operations.requests.read',
        ('يعرض طلبات المستخدم في العمليات وحالتها', "List the user's operation requests and their state"),
        '/api/v1/operations/requests',
        {'state': {'type': 'string', 'enum': ['draft', 'pending', 'returned', 'rejected', 'withdrawn', 'done']}, 'q': QUERY_SCHEMA, 'limit': PAGE_SCHEMA},
        {'scope': 'mine', 'state': '$state', 'q': '$q', 'limit': '$limit'},
        ['items[].id', 'items[].name', 'items[].process.name', 'items[].purpose', 'items[].state', 'items[].created_at', 'total'],
    ),
    read_tool(
        OWNER, FEATURE, 'operations.list_requestable_processes', 'operations.requests.read',
        ('يعرض العمليات التي يستطيع المستخدم تقديم طلب بها', 'List the processes the user can submit a request for'),
        '/api/v1/operations/processes',
        {'q': QUERY_SCHEMA, 'limit': PAGE_SCHEMA},
        {'published': '1', 'requestable': '1', 'q': '$q', 'limit': '$limit'},
        ['items[].id', 'items[].name', 'items[].purpose', 'items[].description', 'total'],
    ),
)


class LiwanOperationsAiAgent(models.AbstractModel):
    _inherit = 'liwan.ai.agent.registry'

    @api.model
    def _liwan_ai_agent_definitions(self):
        return (*super()._liwan_ai_agent_definitions(), OPERATIONS_AGENT)


class LiwanOperationsAiTools(models.AbstractModel):
    _inherit = 'liwan.ai.tool.registry'

    @api.model
    def _liwan_ai_tool_definitions(self):
        return super()._liwan_ai_tool_definitions() + OPERATIONS_AI_TOOLS
