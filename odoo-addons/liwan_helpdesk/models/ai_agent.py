# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The Support Desk agent of the LiwanOS assistant and its read tools.

Tools answer only over routes that already check their own capability, and the agent reads nothing a
person cannot read. The registries belong to ``liwan_api``, so the application declares its agent
without depending on ``liwan_ai``.
"""
from odoo import api, models

from odoo.addons.liwan_api.models.ai_agent_registry import AI_SERVICE_FEATURE
from odoo.addons.liwan_api.models.ai_tool_registry import (
    PAGE_SCHEMA,
    QUERY_SCHEMA,
    read_tool,
)

OWNER = 'liwan_helpdesk'
FEATURE = AI_SERVICE_FEATURE

HELPDESK_AGENT = {
    'key': 'helpdesk',
    'owner': OWNER,
    'feature_key': FEATURE,
    'name_ar': 'وكيل الدعم الفني',
    'name_en': 'Support agent',
    'description_ar': 'تذاكر الدعم التي تخص المستخدم وحالتها ومواعيدها',
    'description_en': "The user's support tickets, their state and their deadlines",
    'instructions_ar': 'أنت وكيل الدعم الفني. تقرأ تذاكر المستخدم وحالتها. فتح تذكرة أو الرد عليها يتم من صفحة الدعم الفني.',
    'instructions_en': "You are the support agent. You read the user's tickets and their state. "
                       'Opening a ticket or answering one happens on the Support Desk page.',
    'pages': ['helpdesk'],
}

HELPDESK_AI_TOOLS = (
    read_tool(
        OWNER, FEATURE, 'helpdesk.list_tickets', 'helpdesk.tickets.read',
        ('يعرض التذاكر التي يراها المستخدم في الدعم الفني', 'List the support tickets the user may read'),
        '/api/v1/helpdesk/tickets',
        {'assignee': {'type': 'string', 'enum': ['me', 'none', 'any']}, 'q': QUERY_SCHEMA,
         'limit': PAGE_SCHEMA},
        {'assignee': '$assignee', 'q': '$q', 'limit': '$limit'},
        ['items[].id', 'items[].number', 'items[].subject', 'items[].stage.name', 'items[].team.name',
         'items[].assignee.name', 'items[].priority', 'items[].created_at', 'items[].sla.state', 'total'],
    ),
    read_tool(
        OWNER, FEATURE, 'helpdesk.list_open_tickets', 'helpdesk.tickets.read',
        ('يعرض التذاكر المفتوحة في الدعم الفني', 'List the open support tickets'),
        '/api/v1/helpdesk/tickets',
        {'q': QUERY_SCHEMA, 'limit': PAGE_SCHEMA},
        {'state': 'open', 'q': '$q', 'limit': '$limit'},
        ['items[].id', 'items[].number', 'items[].subject', 'items[].stage.name', 'items[].team.name',
         'items[].assignee.name', 'items[].sla.state', 'total'],
    ),
)


class LiwanHelpdeskAiAgent(models.AbstractModel):
    _inherit = 'liwan.ai.agent.registry'

    @api.model
    def _liwan_ai_agent_definitions(self):
        return (*super()._liwan_ai_agent_definitions(), HELPDESK_AGENT)


class LiwanHelpdeskAiTools(models.AbstractModel):
    _inherit = 'liwan.ai.tool.registry'

    @api.model
    def _liwan_ai_tool_definitions(self):
        return super()._liwan_ai_tool_definitions() + HELPDESK_AI_TOOLS
