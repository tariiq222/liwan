# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The CRM agent of the LiwanOS AI and its tools: read tools over existing liwan_crm routes, each with the
capability its route already checks. Fields that are sensitive never appear in a result summary."""
from odoo import api, models

from odoo.addons.liwan_ai.models.tool_registry import (
    PAGE_SCHEMA,
    QUERY_SCHEMA,
    read_tool,
)

OWNER = 'liwan_crm'
FEATURE = 'crm.enabled'

CRM_AGENT = {
    'key': 'crm',
    'owner': OWNER,
    'feature_key': FEATURE,
    'name_ar': 'وكيل المبيعات',
    'name_en': 'Sales agent',
    'description_ar': 'الفرص البيعية ومراحلها والمتابعات المستحقة ولوحة المبيعات',
    'description_en': 'Sales opportunities, their stages, due follow-ups and the sales dashboard',
    'instructions_ar': 'أنت وكيل المبيعات. تقرأ الفرص ولوحة المبيعات كما يعيدها النظام. لا تعرض أرقام هواتف العملاء أو بريدهم، وأي تواصل مع العميل يتم من صفحته.',
    'instructions_en': "You are the sales agent. You read opportunities and the sales dashboard as the system returns them. Never show a customer's phone or email; any contact with the customer happens from its page.",
    'pages': ['crm'],
    'sensitive_fields': ['properties'],
}


CRM_AI_TOOLS = (
    read_tool(
        OWNER, FEATURE, 'crm.list_opportunities', 'crm.leads.read',
        ('يعرض الفرص البيعية مع مرحلتها ومسؤولها وقيمتها المتوقعة', 'List sales opportunities with stage, owner and expected revenue'),
        '/api/v1/crm/opportunities',
        {'status': {'type': 'string', 'enum': ['open', 'won', 'lost', 'all']}, 'due': {'type': 'string', 'enum': ['true', 'false']}, 'q': QUERY_SCHEMA, 'limit': PAGE_SCHEMA},
        {'status': '$status', 'due': '$due', 'q': '$q', 'limit': '$limit'},
        ['items[].id', 'items[].contact_name', 'items[].stage.name', 'items[].user.name', 'items[].status', 'items[].expected_revenue', 'items[].probability', 'items[].next_call_at', 'total'],
    ),
    read_tool(
        OWNER, FEATURE, 'crm.get_dashboard', 'crm.leads.read',
        ('يعرض أرقام لوحة المبيعات للمستخدم ولمديره', 'Show the sales dashboard figures for the user and, for a manager, the team'),
        '/api/v1/crm/dashboard',
        {},
        {},
        ['agent.due_now', 'agent.new_today', 'agent.won_this_month', 'manager.unassigned', 'manager.needs_manager', 'manager.due_follow_ups', 'manager.won_this_month'],
    ),
)


class LiwanCrmAiAgent(models.AbstractModel):
    _inherit = 'liwan.ai.agent.registry'

    @api.model
    def _liwan_ai_agent_definitions(self):
        return (*super()._liwan_ai_agent_definitions(), CRM_AGENT)


class LiwanCrmAiTools(models.AbstractModel):
    _inherit = 'liwan.ai.tool.registry'

    @api.model
    def _liwan_ai_tool_definitions(self):
        return super()._liwan_ai_tool_definitions() + CRM_AI_TOOLS
