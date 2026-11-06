# Part of Odoo. See LICENSE file for full copyright and licensing details.
import re
from pathlib import Path

from odoo.exceptions import AccessError, ValidationError
from odoo.tests import TransactionCase, new_test_user, tagged
from odoo.tools import file_path

from odoo.addons.liwan_ai.models.help_guide import (
    GUIDE_DIR,
    GUIDE_LANGS,
    MAX_ITEMS,
    MAX_SECTION_CHARS,
    MAX_TEXT_CHARS,
    PAGE_PATH,
    parse_guide,
    search_sections,
    stem,
    stems,
)
from odoo.addons.liwan_ai.serializers.agent_settings import (
    dump_agent_settings,
    parse_agent_patch,
)
from odoo.addons.liwan_ai.tests.common import AiProbe
from odoo.addons.liwan_api.controllers.common import ApiError
from odoo.addons.liwan_api.tests.common import LiwanApiCase
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule
from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT

GUIDE = """# الموارد البشرية
pages: hr

## إضافة موظف جديد
page: /hr/employees/new
1. افتح «الموارد البشرية».
2. اضغط «موظف جديد» واكتب الاسم.

## طلب إجازة
page: /hr/leave
1. افتح صفحة الإجازات.
2. اضغط «طلب إجازة».
"""
ENGLISH_GUIDE = """# Projects
pages: projects project

## Create a project
page: /projects/new
1. Open Projects.
2. Press New project.
"""
MESSAGE = {
    'conversation_id': 'r_help_01', 'kind': 'help', 'tool_name': None, 'input': None,
    'result': 'ok', 'http_status': None, 'draft': None, 'approved': None, 'attested': False,
}


@tagged('post_install', '-at_install', 'liwan')
class TestHelpGuideSearch(TransactionCase):

    def test_arabic_variants_and_plurals_reduce_to_one_stem(self):
        self.assertEqual(stem('اجازات'), 'اجاز')
        self.assertEqual(stems('الإجازات'), stems('إجازة'))
        self.assertEqual(stems('المُوَظَّفين'), stems('موظف'))
        self.assertEqual(stems('Employees'), stems('employee'))
        self.assertEqual(stems('١٢٣'), ['123'])

    def test_a_guide_file_parses_into_sections_with_their_page(self):
        sections = parse_guide(GUIDE)
        self.assertEqual([section['title'] for section in sections], ['إضافة موظف جديد', 'طلب إجازة'])
        self.assertEqual({section['app'] for section in sections}, {'الموارد البشرية'})
        self.assertEqual(sections[0]['page'], '/hr/employees/new')
        self.assertEqual(sections[0]['pages'], ('hr',))
        self.assertNotIn('page:', sections[0]['text'])
        self.assertTrue(sections[0]['text'].startswith('1.'))
        bad = parse_guide('# T\n\n## S\npage: https://evil.example/x\n1. a')[0]
        self.assertIsNone(bad['page'])

    def test_a_question_finds_its_section_and_question_words_do_not_count(self):
        sections = [*parse_guide(GUIDE), *parse_guide(ENGLISH_GUIDE)]
        found = search_sections(sections, 'كيف أضيف موظف؟')
        self.assertEqual([item['title'] for item in found][:1], ['إضافة موظف جديد'])
        self.assertEqual(search_sections(sections, 'كيف أطلب الإجازة')[0]['page'], '/hr/leave')
        self.assertEqual(search_sections(sections, 'How do I create a project?')[0]['page'], '/projects/new')
        self.assertEqual(search_sections(sections, 'كيف هل ما'), [])
        self.assertEqual(search_sections(sections, 'بطاقة ائتمان'), [])

    def test_the_page_context_ranks_its_sections_and_answers_an_empty_question(self):
        sections = parse_guide(GUIDE)
        self.assertEqual(search_sections(sections, '', page='hr')[0]['title'], 'إضافة موظف جديد')
        self.assertEqual(search_sections(sections, '', page='unknown'), [])
        tie = [*parse_guide('# A\npages: a\n\n## نفس الكلمة\npage: /a\n1. x'), *parse_guide('# B\npages: b\n\n## نفس الكلمة\npage: /b\n1. x')]
        self.assertEqual(search_sections(tie, 'الكلمة', page='b')[0]['page'], '/b')

    def test_the_answer_is_bounded(self):
        many = '\n'.join(f'## موضوع {index}\npage: /p\n' + 'خطوة موضوع ' * 200 for index in range(10))
        found = search_sections(parse_guide(f'# دليل\n\n{many}'), 'موضوع')
        self.assertLessEqual(len(found), MAX_ITEMS)
        self.assertLessEqual(sum(len(item['text']) for item in found), MAX_TEXT_CHARS)
        self.assertTrue(found)
        self.assertLessEqual(max(len(item['text']) for item in found), MAX_SECTION_CHARS)
        self.assertTrue(all(len(item['text']) == MAX_SECTION_CHARS for item in found), 'a section over the bound is cut at it')


@tagged('post_install', '-at_install', 'liwan')
class TestShippedGuide(TransactionCase):
    """The guide that ships with the addon keeps its shape: every file has a title and page names, every section has a
    real route, numbered steps and nothing else a reader could take for a feature."""

    def _files(self, lang):
        return sorted(Path(file_path(f'{GUIDE_DIR}/{lang}')).glob('*.md'))

    def test_every_section_has_a_route_and_numbered_steps(self):
        self.assertTrue(self._files('ar'))
        for lang in GUIDE_LANGS:
            for path in self._files(lang):
                sections = parse_guide(path.read_text(encoding='utf-8'))
                self.assertTrue(sections, path.name)
                for section in sections:
                    where = f'{lang}/{path.name}: {section["title"]}'
                    self.assertTrue(section['app'] and section['pages'], where)
                    self.assertTrue(section['page'] and PAGE_PATH.match(section['page']), where)
                    self.assertTrue(re.match(r'^1\. ', section['text']), where)
                    self.assertLessEqual(len(section['text']), MAX_SECTION_CHARS, where)

    def test_every_english_file_has_its_arabic_original(self):
        arabic = {path.name for path in self._files('ar')}
        self.assertLessEqual({path.name for path in self._files('en')}, arabic)

    def test_the_guide_is_marked_a_draft_for_review(self):
        self.assertIn('draft', Path(file_path(f'{GUIDE_DIR}/README.md')).read_text(encoding='utf-8').lower())


@tagged('post_install', '-at_install', 'liwan')
class TestHelpAgent(AiProbe, LiwanApiCase):

    def setUp(self):
        super().setUp()
        self._grant_ai_use(self.employee)
        self.authenticate('api_emp', 'api_emp_pass_123')

    def _limit(self, key, value):
        profile = self.env.ref('liwan_platform.tenant_profile')
        profile.sudo().with_context(**{OPERATOR_CONTEXT: True}).write({'features': {**(profile.features or {}), key: value}})

    def test_the_route_returns_the_guide_sections_with_their_page(self):
        body = self.url_open('/api/v1/ai/help?q=' + 'كيف أنشئ مشروع').json()
        self.assertGreaterEqual(body['total'], 1)
        item = body['items'][0]
        self.assertEqual(set(item), {'app', 'title', 'text', 'page'})
        self.assertTrue(item['page'].startswith('/'))
        by_page = self.url_open('/api/v1/ai/help?page=hr').json()
        self.assertTrue(by_page['items'])
        nothing = self.url_open('/api/v1/ai/help?q=zxqvbn').json()
        self.assertEqual(nothing, {'items': [], 'total': 0})

    def test_the_route_needs_a_question_or_a_page(self):
        self.assertEqual(self.url_open('/api/v1/ai/help').status_code, 422)

    def test_the_route_bounds_the_question(self):
        self.assertEqual(self.url_open('/api/v1/ai/help?q=' + 'ا' * 201).status_code, 422)

    def test_the_route_takes_a_page_name_only(self):
        self.assertEqual(self.url_open('/api/v1/ai/help?q=x&page=Bad_Page').status_code, 422)

    def test_the_route_refuses_a_caller_without_the_assistant(self):
        role = self.env['liwan.access.role'].create({
            'name_ar': 'قارئ الأدوار',
            'company_id': self.env.company.id,
            'permission_ids': [(6, 0, self.env['liwan.access.permission'].search([('key', '=', 'access.roles.read')]).ids)],
        })
        outsider = new_test_user(self.env, login='ai_help_outsider', password='ai_help_outsider_pass_123', name='Noor', groups='base.group_user')
        self.env['liwan.access.assignment'].create({'user_id': outsider.id, 'role_id': role.id, 'company_id': self.env.company.id})
        self.authenticate(outsider.login, 'ai_help_outsider_pass_123')
        self.assertEqual(self.url_open('/api/v1/ai/help?q=x').status_code, 403)

    def test_the_help_catalog_holds_the_help_agent_only(self):
        help_catalog = self.url_open('/api/v1/ai/tools?mode=help').json()
        self.assertEqual([item['name'] for item in help_catalog['items']], ['ai_help.search_guide'])
        self.assertEqual([agent['key'] for agent in help_catalog['agents']], ['ai_help'])
        tool = help_catalog['items'][0]
        self.assertEqual(tool['route'], {'method': 'GET', 'path': '/api/v1/ai/help'})
        self.assertEqual(tool['input_map'], {'query': {'q': '$query', 'page': '$page'}})
        self.assertFalse(tool['requires_approval'])
        for catalog in (self.url_open('/api/v1/ai/tools').json(), self.url_open('/api/v1/ai/tools?mode=setup').json()):
            self.assertFalse([item for item in catalog['items'] if item['name'].startswith('ai_help.')])
        self.assertEqual(self.url_open('/api/v1/ai/tools?mode=shout').status_code, 422)

    def test_help_and_setup_messages_share_one_assistance_budget_and_never_the_package(self):
        self._limit('ai.assist.monthly', 2)
        self._limit('ai.messages.monthly', 0)
        Audit = self.env['liwan.ai.audit'].with_user(self.employee)
        Audit.create(MESSAGE)  # a help message needs no setting to change, and a package with no message left still serves it
        Audit.create({**MESSAGE, 'conversation_id': 'r_help_02'})
        with self.assertRaises(LiwanAccessRule) as caught:
            Audit.create({**MESSAGE, 'conversation_id': 'r_help_03'})
        self.assertEqual(caught.exception.details['limit_key'], 'ai.assist.monthly')
        self.assertEqual(Audit._liwan_ai_count_messages(), 0)
        self.assertEqual(Audit._liwan_ai_count_messages(kinds=('setup', 'help')), 2)
        self.assertEqual(self.env['liwan.ai.tool.registry']._liwan_ai_limits()['assist_used'], 2)

    def test_a_help_conversation_keeps_its_mode(self):
        Audit = self.env['liwan.ai.audit'].with_user(self.employee)
        Audit.create(MESSAGE)
        for kind in ('message', 'setup'):
            with self.assertRaises(ValidationError) as caught:
                Audit.create({**MESSAGE, 'kind': kind})
            self.assertEqual(caught.exception.liwan_code, 'mode_mismatch')
        Audit.create({**MESSAGE, 'conversation_id': 'r_plain', 'kind': 'message'})
        with self.assertRaises(ValidationError):
            Audit.create({**MESSAGE, 'conversation_id': 'r_plain'})
        self.assertEqual(Audit._liwan_ai_conversation_mode('r_help_01'), 'help')
        self.assertEqual(Audit._liwan_ai_conversation_mode('r_plain'), 'assistant')
        self.assertEqual(self.url_open('/api/v1/ai/conversations/r_help_01/mode').json(), {'mode': 'help'})

    def test_a_tool_row_of_the_help_agent_is_audited_under_its_agent(self):
        Audit = self.env['liwan.ai.audit'].with_user(self.employee)
        row = Audit.create({
            'conversation_id': 'r_help_01', 'kind': 'read', 'agent': 'ai_help', 'tool_name': 'ai_help.search_guide',
            'input': {'query': 'x'}, 'result': 'ok', 'http_status': 200, 'draft': None, 'approved': None, 'attested': False,
        })
        self.assertEqual(row.agent_key, 'ai_help')

    def test_a_help_message_needs_the_assistant_capability(self):
        outsider = new_test_user(self.env, login='ai_help_outsider2', password='ai_help_outsider2_pass_123', groups='liwan_core.group_employee')
        with self.assertRaises(AccessError):
            self.env['liwan.ai.audit'].with_user(outsider).create(MESSAGE)

    def test_the_help_agent_never_remembers_whatever_is_stored(self):
        self.env['liwan.ai.agent.setting'].create({'agent_key': 'ai_help', 'memory': True})
        self.assertFalse(self.env['liwan.ai.agent.setting']._liwan_ai_effective(self.employee)['ai_help']['memory'])
        catalog = self.url_open('/api/v1/ai/tools?mode=help').json()
        self.assertEqual([(agent['key'], agent['memory']) for agent in catalog['agents']], [('ai_help', False)])
        shown = next(item for item in dump_agent_settings(self.env)['items'] if item['key'] == 'ai_help')
        self.assertEqual((shown['memory'], shown['memory_fixed']), (False, True))
        setup = next(item for item in dump_agent_settings(self.env)['items'] if item['key'] == 'ai')
        self.assertEqual((setup['memory'], setup['memory_fixed']), (True, False))
        with self.assertRaises(ApiError) as caught:
            parse_agent_patch({'revision': 0, 'memory': True}, [], memory_fixed=True)
        self.assertEqual((caught.exception.status, caught.exception.field), (422, 'memory'))
        self.assertEqual(parse_agent_patch({'revision': 0, 'enabled': False}, [], memory_fixed=True)[0], {'enabled': False})
