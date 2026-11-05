# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The HR agent of the LiwanOS AI and its tools: read tools over existing liwan_hr routes, each with the
capability its route already checks. Fields that are sensitive never appear in a result summary."""
from odoo import api, models

from odoo.addons.liwan_ai.models.tool_registry import PAGE_SCHEMA, read_tool

OWNER = 'liwan_hr'
FEATURE = 'hr.enabled'

HR_AGENT = {
    'key': 'hr',
    'owner': OWNER,
    'feature_key': FEATURE,
    'name_ar': 'وكيل الموارد البشرية',
    'name_en': 'HR agent',
    'description_ar': 'إجازات الموظف وأرصدته وملفه الوظيفي',
    'description_en': "The employee's leave requests, balances and job profile",
    'instructions_ar': 'أنت وكيل الموارد البشرية. تجيب عن إجازات المستخدم نفسه وأرصدته وملفه الوظيفي فقط. لا تتحدث عن رواتب أحد ولا بياناته الخاصة، ووجّه المستخدم إلى صفحة الموارد البشرية لتقديم طلب.',
    'instructions_en': "You are the HR agent. You answer only about the user's own leave requests, balances and job profile. Never discuss anyone's pay or private data; point the user to the HR page to submit a request.",
    'pages': ['hr'],
    'sensitive_fields': ['contract', 'nationality', 'birthday'],
}


HR_AI_TOOLS = (
    read_tool(
        OWNER, FEATURE, 'hr.list_my_leave_requests', 'hr.leave.read',
        ('يعرض طلبات إجازة المستخدم وحالتها', "List the user's leave requests and their state"),
        '/api/v1/hr/leave/requests',
        {'state': {'type': 'string', 'enum': ['confirm', 'validate1', 'validate', 'refuse', 'cancel']}, 'limit': PAGE_SCHEMA},
        {'mine': '1', 'state': '$state', 'limit': '$limit'},
        ['items[].id', 'items[].leave_type.name', 'items[].date_from', 'items[].date_to', 'items[].number_of_days', 'items[].state', 'total'],
    ),
    read_tool(
        OWNER, FEATURE, 'hr.get_my_leave_balances', 'hr.leave.read',
        ('يعرض أرصدة إجازات المستخدم', "Show the user's leave balances"),
        '/api/v1/hr/leave/balances',
        {},
        {},
        ['items[].leave_type.name', 'items[].allocated', 'items[].taken', 'items[].pending', 'items[].remaining', 'total'],
    ),
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
