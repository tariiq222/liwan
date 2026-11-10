# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The setup agent (spec 2026-11-04 §6.5): the platform's own agent, free for every tenant, that helps configure the
enabled applications from their declared settings. It runs only in a setup conversation (``mode=setup``), on the
platform provider and against the vendor's monthly assistance budget ``ai.assist.monthly``, never in an ordinary one."""
from odoo import api, models

from odoo.addons.liwan_ai.models.access_service import AI_SETTINGS_MANAGE, AI_USE
from odoo.addons.liwan_ai.models.ai_settings import EXTERNAL_SEND_MODES
from odoo.addons.liwan_ai.models.tool_registry import SETUP_AGENT_KEY
from odoo.addons.liwan_ai.serializers.settings import (
    MAX_MESSAGES_PER_USER,
    MAX_SPEND_CEILING,
)

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
        'أنت وكيل الإعداد. في بداية المحادثة اعرض على المستخدم فحص الجاهزية: إن وافق فاقرأه بأداة الجاهزية وأخبره بما ينقص '
        'مبتدئًا بالأهم، واذكر لكل بند الصفحة التي تعالجه واعرض مساعدته فيه. وهو يقرأ ولا يغيّر شيئًا. '
        'اسأل عن نشاط الشركة وطريقة عملها باختصار، ثم اقرأ الإعدادات المتاحة واقترح التغييرات المناسبة '
        'واحدًا واحدًا: اذكر لكل اقتراح القيمة الحالية والقيمة الجديدة وأثرها، ولا تطبّقه إلا بأداة التطبيق التي تنتظر '
        'موافقة المستخدم. لا تغيّر الأدوار ولا الصلاحيات: اقترحها بالكلام فقط ووجّه المستخدم إلى صفحة الوصول.'
    ),
    'instructions_en': (
        'You are the setup agent. At the start, offer the user the readiness check: if they agree, read it with the readiness '
        'tool and tell them what is missing, the most important first, naming the page that fixes each item and offering to '
        'help with it. The check only reads and changes nothing. '
        "Briefly ask about the company's line of business and way of working, then read the "
        'available settings and propose fitting changes one at a time: for each, state the current value, the new value '
        'and its impact, and apply it only with the apply tool, which waits for the user\'s approval. Never change roles '
        'or permissions: suggest them in words and point the user to the access page.'
    ),
    'pages': ['settings'],
}

SETUP_TOOLS = (
    {
        'name': 'ai.readiness', 'owner': OWNER, 'kind': 'read', 'capability': AI_USE, 'feature_key': 'ai.enabled',
        'description_ar': 'يفحص ما ينقص الشركة لتكتمل جاهزيتها (مستخدمون بلا دور، إعدادات لم تُحفظ، تطبيقات مفعّلة بلا سجلات) مع صفحة علاج كل بند',
        'description_en': 'Check what the company still lacks to be ready (users without a role, unsaved settings, enabled applications without records), with the page that fixes each item',
        'route': {'method': 'GET', 'path': '/api/v1/ai/setup/readiness'},
        'input_schema': {'type': 'object', 'properties': {}, 'additionalProperties': False},
        'input_map': {},
        'result_summary': ['items[].key', 'items[].severity', 'items[].label', 'items[].page', 'total'],
    },
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
        'description_ar': 'يطبّق قيمة جديدة لإعداد واحد بعد موافقة المستخدم، مع القيمة الحالية التي عرضتها أداة القراءة',
        'description_en': 'Apply a new value to one setting after the user approves, with the current value the list tool showed',
        'route': {'method': 'POST', 'path': '/api/v1/ai/setup/settings/{key}'},
        'input_schema': {
            'type': 'object',
            'properties': {
                'key': SETTING_KEY_SCHEMA,
                'value': {'type': ['string', 'integer', 'boolean']},
                # The value ai.list_settings showed: the change is refused if the setting moved since.
                'expected': {'type': ['string', 'integer', 'boolean']},
            },
            'required': ['key', 'value', 'expected'],
            'additionalProperties': False,
        },
        'input_map': {'path': {'key': '$key'}, 'body': {'value': '$value', 'expected': '$expected'}},
        'result_summary': ['key', 'before', 'after'],
    },
)


def _setting(field, kind, label, impact, feature_key='ai.enabled', **allowed):
    """One tenant-wide AI policy; changed by a holder of ai.settings.manage in the tenant's root company."""
    return {
        'key': f'ai.{field}', 'owner': OWNER, 'feature_key': feature_key, 'model': 'liwan.ai.settings', 'field': field,
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
        'monthly_spend_ceiling', 'integer', ('سقف الإنفاق الشهري على المساعد', 'Monthly spending ceiling for the assistant'),
        ('يوقف المساعد عن بدء محادثات جديدة حين يبلغ ما سُحب من الرصيد هذا الشهر هذا السقف، بوحدة 0.00001 دولار؛ صفر يعني بلا سقف.',
         ("Stops the assistant from starting new runs once this month's deductions from the balance reach the ceiling, in units of "
          '0.00001 USD; zero means no ceiling.')),
        min=0, max=MAX_SPEND_CEILING,
    ),
    _setting(
        'external_send', 'selection', ('التواصل مع جهات خارجية', 'Contact with outside parties'),
        ('«draft_only» يجعل المساعد يجهّز الرسالة والموظف يرسلها، و«approve» يسمح له بالإرسال بعد موافقة الموظف.',
         '"draft_only" has the assistant prepare the message for the employee to send; "approve" lets it send after approval.'),
        options=list(EXTERNAL_SEND_MODES),
    ),
    _setting(
        'knowledge_enabled', 'boolean', ('البحث في سجلات الشركة', "Search the company's records"),
        ('يفهرس المساعد نصوص سجلات التطبيقات المفعّلة (كالمهام والفرص) ليجيب منها؛ لا يرى المستخدم إلا ما يحق له قراءته.',
         ("Lets the assistant index the text of the enabled applications' records (such as tasks and opportunities) to answer "
          'from them; each user still sees only what they may read.')),
        feature_key='ai.knowledge',
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
