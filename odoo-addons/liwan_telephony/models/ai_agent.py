# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The Telephony agent of the LiwanOS AI and its tools: read tools over existing liwan_telephony routes, each with the
capability its route already checks. A field that is sensitive is listed in ``sensitive_fields`` and never appears in a
result summary. The registries belong to liwan_api, so the application declares its agent without depending on
liwan_ai, which offers and runs the tools when it is installed."""
from odoo import api, models

from odoo.addons.liwan_api.models.ai_tool_registry import PAGE_SCHEMA, read_tool

OWNER = 'liwan_telephony'
FEATURE = 'telephony.enabled'

TELEPHONY_AGENT = {
    'key': 'telephony',
    'owner': OWNER,
    'feature_key': FEATURE,
    'name_ar': 'وكيل الاتصالات',
    'name_en': 'Telephony agent',
    'description_ar': 'سجلات الاتصالات',
    'description_en': 'The Telephony records',
    'instructions_ar': 'أنت وكيل الاتصالات. اقرأ السجلات بالأدوات واعرضها كما أعادها النظام.',
    'instructions_en': 'You are the Telephony agent. Read the records with your tools and show them as the system returned them.',
    'pages': ['telephony'],
    'sensitive_fields': [],
}

TELEPHONY_AI_TOOLS = (
    read_tool(
        OWNER, FEATURE, 'telephony.list_records', 'telephony.records.read',
        ('يعرض سجلات الاتصالات', 'List the Telephony records'),
        '/api/v1/telephony/records',
        {'limit': PAGE_SCHEMA},
        {'limit': '$limit'},
        ['items[].id', 'items[].name', 'total'],
    ),
)


class LiwanTelephonyAiAgent(models.AbstractModel):
    _inherit = 'liwan.ai.agent.registry'

    @api.model
    def _liwan_ai_agent_definitions(self):
        return (*super()._liwan_ai_agent_definitions(), TELEPHONY_AGENT)


class LiwanTelephonyAiTools(models.AbstractModel):
    _inherit = 'liwan.ai.tool.registry'

    @api.model
    def _liwan_ai_tool_definitions(self):
        return super()._liwan_ai_tool_definitions() + TELEPHONY_AI_TOOLS
