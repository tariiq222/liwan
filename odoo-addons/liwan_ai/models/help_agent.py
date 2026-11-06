# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The help agent (spec 2026-11-04 §6.13): free for every tenant, it answers how-to questions about using LiwanOS from the
shipped user guide only and reads no tenant record. It runs only in a help conversation (``mode=help``), on the platform
provider and against the vendor's monthly assistance budget ``ai.assist.monthly``, never in an ordinary one."""
from odoo import api, models

from odoo.addons.liwan_ai.models.access_service import AI_USE
from odoo.addons.liwan_ai.models.tool_registry import HELP_AGENT_KEY

OWNER = 'liwan_ai'

HELP_AGENT = {
    'key': HELP_AGENT_KEY,
    'owner': OWNER,
    'feature_key': 'ai.enabled',
    'name_ar': 'وكيل المساعدة',
    'name_en': 'Help agent',
    'description_ar': 'يجيب عن أسئلة «كيف أفعل كذا؟» في ليوان من دليل الاستخدام',
    'description_en': 'Answers "how do I do this?" questions about LiwanOS from the user guide',
    'instructions_ar': (
        'أنت وكيل المساعدة. تجيب عن أسئلة طريقة استخدام ليوان من دليل الاستخدام وحده، ولا تقرأ بيانات الشركة. '
        'ابحث دائمًا في الدليل بأداة البحث قبل الجواب، واكتب الخطوات كما وردت فيه، واذكر عنوان القسم ورابط صفحته. '
        'إن جاءك سياق صفحة فابحث بها لتعرف أي صفحة يقصد المستخدم. لا تخترع ميزة ولا زرًّا ولا خطوة. '
        'إن لم يغطِّ الدليل السؤال فقل ذلك بوضوح، ويمكنك محاولة ثانية بكلمات أخرى قبل أن تقوله. '
        'لا تغيّر شيئًا ولا تجهّز مسودة: أرشد المستخدم إلى الصفحة التي تنفّذ المهمة.'
    ),
    'instructions_en': (
        'You are the help agent. You answer how-to questions about using LiwanOS from the user guide only, and never read '
        "the company's data. Always search the guide with the search tool before answering, give the steps as the guide "
        'states them, and name the section title and its page link. When a page context arrives, search with it to learn '
        'which page the user means. Never invent a feature, a button or a step. If the guide does not cover the question, '
        'say so plainly; you may try once more with other words before saying it. Change nothing and prepare no draft: '
        'point the user to the page that does the task.'
    ),
    'pages': [],
}

HELP_TOOLS = (
    {
        'name': f'{HELP_AGENT_KEY}.search_guide', 'owner': OWNER, 'kind': 'read', 'capability': AI_USE, 'feature_key': 'ai.enabled',
        'description_ar': 'يبحث في دليل استخدام ليوان عن الأقسام المطابقة للسؤال ويعيد عنوان كل قسم وخطواته ورابط صفحته',
        'description_en': 'Search the LiwanOS user guide for the sections that match the question, with each title, its steps and its page link',
        'route': {'method': 'GET', 'path': '/api/v1/ai/help'},
        'input_schema': {
            'type': 'object',
            'properties': {
                'query': {'type': 'string', 'minLength': 1, 'maxLength': 200},
                # The page context the conversation started from (a rail module or a record kind): it ranks that page's sections first.
                'page': {'type': 'string', 'pattern': r'^[a-z][a-z_-]{0,39}$'},
            },
            'required': ['query'],
            'additionalProperties': False,
        },
        'input_map': {'query': {'q': '$query', 'page': '$page'}},
        'result_summary': ['items[].app', 'items[].title', 'items[].text', 'items[].page', 'total'],
    },
)


class LiwanAiHelpAgent(models.AbstractModel):
    _inherit = 'liwan.ai.agent.registry'

    @api.model
    def _liwan_ai_agent_definitions(self):
        return (*super()._liwan_ai_agent_definitions(), HELP_AGENT)


class LiwanAiHelpTools(models.AbstractModel):
    _inherit = 'liwan.ai.tool.registry'

    @api.model
    def _liwan_ai_tool_definitions(self):
        return super()._liwan_ai_tool_definitions() + HELP_TOOLS
