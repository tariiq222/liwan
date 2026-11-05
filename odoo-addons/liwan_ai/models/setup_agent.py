# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The setup agent (spec 2026-11-04 §6.5): the platform's own agent, free for every tenant, that helps configure the
enabled applications from their declared settings. It runs only in a setup conversation (``mode=setup``), on the
platform provider and against the vendor's monthly budget ``ai.setup.monthly``, never in an ordinary one."""
from odoo import api, models

from odoo.addons.liwan_ai.models.access_service import AI_SETTINGS_MANAGE, AI_USE
from odoo.addons.liwan_ai.models.ai_settings import EXTERNAL_SEND_MODES
from odoo.addons.liwan_ai.models.tool_registry import SETUP_AGENT_KEY
from odoo.addons.liwan_ai.serializers.settings import MAX_MESSAGES_PER_USER

OWNER = 'liwan_ai'
SETTING_KEY_SCHEMA = {'type': 'string', 'pattern': r'^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'}

SETUP_AGENT = {
    'key': SETUP_AGENT_KEY,
    'owner': OWNER,
    'feature_key': 'ai.enabled',
    'name_ar': 'وكيل الإعداد',
    'name_en': 'Setup agent',
    'description_ar': 'يساعد في ضبط إعدادات التطبيقات المفعّلة حسب نشاط الشركة',
    'description_en': "Helps configure the enabled applications' settings for the company's line of business",
    'instructions_ar': (
        'أنت وكيل الإعداد. اسأل عن نشاط الشركة وطريقة عملها باختصار، ثم اقرأ الإعدادات المتاحة واقترح التغييرات المناسبة '
        'واحدًا واحدًا: اذكر لكل اقتراح القيمة الحالية والقيمة الجديدة وأثرها، ولا تطبّقه إلا بأداة التطبيق التي تنتظر '
        'موافقة المستخدم. لا تغيّر الأدوار ولا الصلاحيات: اقترحها بالكلام فقط ووجّه المستخدم إلى صفحة الوصول.'
    ),
    'instructions_en': (
        "You are the setup agent. Briefly ask about the company's line of business and way of working, then read the "
        'available settings and propose fitting changes one at a time: for each, state the current value, the new value '
        'and its impact, and apply it only with the apply tool, which waits for the user\'s approval. Never change roles '
        'or permissions: suggest them in words and point the user to the access page.'
    ),
    'pages': ['settings'],
}

SETUP_TOOLS = (
    {
        'name': 'ai.list_settings', 'owner': OWNER, 'kind': 'read', 'capability': AI_USE, 'feature_key': 'ai.enabled',
        'description_ar': 'يعرض إعدادات التطبيقات المفعّلة التي يحق للمستخدم تغييرها مع قيمها الحالية وأثرها',
        'description_en': 'List the settings of the enabled applications the user may change, with their current values and impact',
        'route': {'method': 'GET', 'path': '/api/v1/ai/setup/settings'},
        'input_schema': {'type': 'object', 'properties': {}, 'additionalProperties': False},
        'input_map': {},
        'result_summary': ['items[].key', 'items[].type', 'items[].scope', 'items[].label', 'items[].impact',
                           'items[].value', 'items[].options[]', 'items[].min', 'items[].max', 'total'],
    },
    {
        'name': 'ai.apply_setting', 'owner': OWNER, 'kind': 'write_light', 'capability': AI_USE, 'feature_key': 'ai.enabled',
        'description_ar': 'يطبّق قيمة جديدة لإعداد واحد بعد موافقة المستخدم',
        'description_en': 'Apply a new value to one setting after the user approves',
        'route': {'method': 'POST', 'path': '/api/v1/ai/setup/settings/{key}'},
        'input_schema': {
            'type': 'object',
            'properties': {'key': SETTING_KEY_SCHEMA, 'value': {'type': ['string', 'integer', 'boolean']}},
            'required': ['key', 'value'],
            'additionalProperties': False,
        },
        'input_map': {'path': {'key': '$key'}, 'body': {'value': '$value'}},
        'result_summary': ['key', 'before', 'after'],
    },
)


def _setting(field, kind, label, impact, **allowed):
    """One tenant-wide AI policy; changed by a holder of ai.settings.manage in the tenant's root company."""
    return {
        'key': f'ai.{field}', 'owner': OWNER, 'feature_key': 'ai.enabled', 'model': 'liwan.ai.settings', 'field': field,
        'scope': 'tenant', 'type': kind, 'capability': AI_SETTINGS_MANAGE,
        'label_ar': label[0], 'label_en': label[1], 'impact_ar': impact[0], 'impact_en': impact[1], **allowed,
    }


AI_SETTINGS = (
    _setting(
        'messages_per_user_monthly', 'integer', ('رسائل كل موظف شهريًا', 'Messages per employee each month'),
        ('يحد استخدام كل موظف للمساعد داخل حد الباقة؛ صفر يعني أن حد الباقة وحده يسري.',
         "Caps each employee's use of the assistant within the plan; zero leaves only the plan limit."),
        min=0, max=MAX_MESSAGES_PER_USER,
    ),
    _setting(
        'external_send', 'selection', ('التواصل مع جهات خارجية', 'Contact with outside parties'),
        ('«draft_only» يجعل المساعد يجهّز الرسالة والموظف يرسلها، و«approve» يسمح له بالإرسال بعد موافقة الموظف.',
         '"draft_only" has the assistant prepare the message for the employee to send; "approve" lets it send after approval.'),
        options=list(EXTERNAL_SEND_MODES),
    ),
)


class LiwanAiSetupSettings(models.AbstractModel):
    _inherit = 'liwan.ai.setting.registry'

    @api.model
    def _liwan_ai_setting_definitions(self):
        return super()._liwan_ai_setting_definitions() + AI_SETTINGS


class LiwanAiSetupAgent(models.AbstractModel):
    _inherit = 'liwan.ai.agent.registry'

    @api.model
    def _liwan_ai_agent_definitions(self):
        return (*super()._liwan_ai_agent_definitions(), SETUP_AGENT)


class LiwanAiSetupTools(models.AbstractModel):
    _inherit = 'liwan.ai.tool.registry'

    @api.model
    def _liwan_ai_tool_definitions(self):
        return super()._liwan_ai_tool_definitions() + SETUP_TOOLS
