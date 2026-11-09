# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The HR agent and its self-service job profile tool."""
from odoo import api, models

from odoo.addons.liwan_ai.models.tool_registry import read_tool

OWNER = 'liwan_hr'
FEATURE = 'hr.enabled'

HR_AGENT = {
    'key': 'hr',
    'owner': OWNER,
    'feature_key': FEATURE,
    'name_ar': 'وكيل الموارد البشرية',
    'name_en': 'HR agent',
    'description_ar': 'الملف الوظيفي للمستخدم والإرشاد إلى صفحة الموارد البشرية للإجازات',
    'description_en': "The user's job profile and directions to the HR page for leave",
    'instructions_ar': (
        'أنت وكيل الموارد البشرية. أجب فقط عن الملف الوظيفي للمستخدم نفسه. '
        'وجّه المستخدم إلى صفحة الموارد البشرية لعرض طلبات الإجازة وأرصدتها أو تقديم طلب. '
        'لا تتحدث عن رواتب أحد أو بياناته الخاصة.'
    ),
    'instructions_en': (
        "You are the HR agent. Answer only about the user's own job profile. "
        "Direct the user to the HR page to view leave requests and balances or to submit a request. "
        "Never discuss anyone's pay or private data."
    ),
    'pages': ['hr'],
    'sensitive_fields': ['contract', 'nationality', 'birthday'],
}


HR_AI_TOOLS = (
    # Leave type names may disclose sensitive information, so leave data stays in HR.
    read_tool(
        OWNER, FEATURE, 'hr.get_my_profile', 'hr.employees.read',
        ('يعرض المسمى الوظيفي والقسم والمدير للمستخدم', "Show the user's job title, department and manager"),
        '/api/v1/hr/me',
        {},
        {},
        ['id', 'name', 'job_title', 'department.name', 'manager.name'],
    ),
)


class LiwanHrAiAgent(models.AbstractModel):
    _inherit = 'liwan.ai.agent.registry'

    @api.model
    def _liwan_ai_agent_definitions(self):
        return (*super()._liwan_ai_agent_definitions(), HR_AGENT)


class LiwanHrAiTools(models.AbstractModel):
    _inherit = 'liwan.ai.tool.registry'

    @api.model
    def _liwan_ai_tool_definitions(self):
        return super()._liwan_ai_tool_definitions() + HR_AI_TOOLS
