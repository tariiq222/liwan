# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The Sales agent of the LiwanOS AI and its tools: read tools over existing liwan_sales routes, each with the
capability its route already checks. A field that is sensitive is listed in ``sensitive_fields`` and never appears in a
result summary. The registries belong to liwan_api, so Sales declares its agent without depending on liwan_ai, which offers
and runs the tools when it is installed."""
from odoo import api, models

from odoo.addons.liwan_api.models.ai_tool_registry import PAGE_SCHEMA, read_tool

OWNER = 'liwan_sales'
FEATURE = 'sales.enabled'

SALES_AGENT = {
    'key': 'sales',
    'owner': OWNER,
    'feature_key': FEATURE,
    'name_ar': 'وكيل المبيعات',
    'name_en': 'Sales agent',
    'description_ar': 'عروض الأسعار والطلبات',
    'description_en': 'The quotations and orders',
    'instructions_ar': 'أنت وكيل المبيعات. اقرأ عروض الأسعار والطلبات بالأدوات واعرضها كما أعادها النظام.',
    'instructions_en': 'You are the Sales agent. Read the quotations and orders with your tools and show them as the system returned them.',
    'pages': ['sales'],
    'sensitive_fields': [],
}

SALES_AI_TOOLS = (
    read_tool(
        OWNER, FEATURE, 'sales.list_orders', 'sales.read',
        ('يعرض عروض الأسعار والطلبات', 'List the quotations and orders'),
        '/api/v1/sales/orders',
        {'limit': PAGE_SCHEMA},
        {'limit': '$limit'},
        ['items[].id', 'items[].number', 'items[].state', 'total'],
    ),
)


class LiwanSalesAiAgent(models.AbstractModel):
    _inherit = 'liwan.ai.agent.registry'

    @api.model
    def _liwan_ai_agent_definitions(self):
        return (*super()._liwan_ai_agent_definitions(), SALES_AGENT)


class LiwanSalesAiTools(models.AbstractModel):
    _inherit = 'liwan.ai.tool.registry'

    @api.model
    def _liwan_ai_tool_definitions(self):
        return super()._liwan_ai_tool_definitions() + SALES_AI_TOOLS
