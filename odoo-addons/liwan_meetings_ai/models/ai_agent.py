# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The meetings agent of the LiwanOS AI and its tools: read tools over existing liwan_meetings routes, each with the
capability its route already checks. Fields that are sensitive never appear in a result summary."""
from odoo import api, models

from odoo.addons.liwan_ai.models.tool_registry import (
    DATE_SCHEMA,
    PAGE_SCHEMA,
    read_tool,
)

OWNER = 'liwan_meetings'
FEATURE = 'meetings.enabled'

MEETINGS_AGENT = {
    'key': 'meetings',
    'owner': OWNER,
    'feature_key': FEATURE,
    'name_ar': 'وكيل الاجتماعات',
    'name_en': 'Meetings agent',
    'description_ar': 'اجتماعات المستخدم ومواعيدها وحالتها وقراراتها المفتوحة',
    'description_en': "The user's meetings, their times, state and open resolutions",
    'instructions_ar': 'أنت وكيل الاجتماعات. تقرأ اجتماعات المستخدم ومواعيدها. اعرض الأوقات كما أعادها النظام، ولا تخترع محاضر أو قرارات.',
    'instructions_en': "You are the meetings agent. You read the user's meetings and their times. Show times as the system returned them and never invent minutes or resolutions.",
    'pages': ['meetings'],
    'sensitive_fields': ['minutes', 'meeting_url', 'agenda'],
}


MEETINGS_AI_TOOLS = (
    read_tool(
        OWNER, FEATURE, 'meetings.list_my_meetings', 'meetings.read',
        ('يعرض اجتماعات المستخدم في فترة مع حالتها ومنظمها', "List the user's meetings in a period with state and organizer"),
        '/api/v1/meetings',
        {'date_from': DATE_SCHEMA, 'date_to': DATE_SCHEMA, 'state': {'type': 'string', 'enum': ['draft', 'confirmed', 'done', 'cancelled']}, 'limit': PAGE_SCHEMA},
        {'mine': '1', 'date_from': '$date_from', 'date_to': '$date_to', 'state': '$state', 'limit': '$limit'},
        ['items[].id', 'items[].name', 'items[].reference', 'items[].start_datetime', 'items[].end_datetime', 'items[].state', 'items[].organizer.name', 'items[].open_resolution_count', 'total'],
    ),
)


class LiwanMeetingsAiAgent(models.AbstractModel):
    _inherit = 'liwan.ai.agent.registry'

    @api.model
    def _liwan_ai_agent_definitions(self):
        return (*super()._liwan_ai_agent_definitions(), MEETINGS_AGENT)


class LiwanMeetingsAiTools(models.AbstractModel):
    _inherit = 'liwan.ai.tool.registry'

    @api.model
    def _liwan_ai_tool_definitions(self):
        return super()._liwan_ai_tool_definitions() + MEETINGS_AI_TOOLS
