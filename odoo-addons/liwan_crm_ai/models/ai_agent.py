# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The CRM agent of the LiwanOS AI and its tools: read tools over existing liwan_crm routes, each with the
capability its route already checks. Fields that are sensitive never appear in a result summary."""
from odoo import api, models

from odoo.addons.liwan_ai.models.tool_registry import (
    PAGE_SCHEMA,
    QUERY_SCHEMA,
    read_tool,
)
from odoo.addons.liwan_crm.models.crm_settings import (
    AFTER_ATTEMPTS,
    RANGES,
    VISIBILITIES,
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


def _setting(field, kind, label, impact, **allowed):
    """One CRM policy the setup agent may propose; changed by a holder of crm.settings.manage in the current company."""
    return {
        'key': f'crm.{field}', 'owner': OWNER, 'feature_key': FEATURE, 'model': 'liwan.crm.settings', 'field': field,
        'scope': 'company', 'type': kind, 'capability': 'crm.settings.manage',
        'label_ar': label[0], 'label_en': label[1], 'impact_ar': impact[0], 'impact_en': impact[1], **allowed,
    }


CRM_SETTINGS = (
    _setting(
        'visibility', 'selection', ('من يرى الفرص', 'Who sees the opportunities'),
        ('«own» يجعل كل موظف مبيعات يرى فرصه فقط، و«all» يجعل الجميع يرون كل الفرص.',
         '"own" shows each salesperson only their own opportunities; "all" shows everyone every opportunity.'),
        options=list(VISIBILITIES),
    ),
    _setting(
        'followup_attempts', 'integer', ('محاولات المتابعة', 'Follow-up attempts'),
        ('عدد مرات محاولة التواصل مع العميل قبل اتخاذ إجراء ما بعد المحاولات.',
         'How many times the customer is contacted before the after-attempts action applies.'),
        min=RANGES['followup_attempts'][0], max=RANGES['followup_attempts'][1],
    ),
    _setting(
        'after_attempts', 'selection', ('بعد استنفاد المحاولات', 'After the attempts run out'),
        ('«lost» يغلق الفرصة كخاسرة، و«manager» يحيلها إلى المدير ليقرر.',
         '"lost" closes the opportunity as lost; "manager" hands it to the manager to decide.'),
        options=list(AFTER_ATTEMPTS),
    ),
    _setting(
        'discount_allowed', 'boolean', ('السماح بالخصم', 'Allow discounts'),
        ('يسمح لموظفي المبيعات بإعطاء خصم على سعر الباقة ضمن الحد الأعلى للخصم.',
         "Lets salespeople discount a package's price within the maximum discount."),
    ),
)


class LiwanCrmAiSettings(models.AbstractModel):
    _inherit = 'liwan.ai.setting.registry'

    @api.model
    def _liwan_ai_setting_definitions(self):
        return super()._liwan_ai_setting_definitions() + CRM_SETTINGS
