# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import new_test_user, tagged

from odoo.addons.liwan_ai.controllers.knowledge import MAX_REFS
from odoo.addons.liwan_ai.models import knowledge_indexer
from odoo.addons.liwan_ai.models.knowledge_chunker import record_chunks
from odoo.addons.liwan_ai.models.knowledge_indexer import KNOWLEDGE_FEATURE
from odoo.addons.liwan_ai.models.knowledge_tool import KNOWLEDGE_TOOL
from odoo.addons.liwan_ai.tests.common import PROBE_SOURCE, PROBE_TOOLS, AiProbe
from odoo.addons.liwan_api.tests.common import LiwanApiCase, set_probe_feature

RESOLVE = '/api/v1/ai/knowledge/resolve'
REBUILD = '/api/v1/ai/knowledge/rebuild'
MODEL = 'res.partner'


@tagged('post_install', '-at_install', 'liwan')
class TestAiKnowledgeResolve(AiProbe, LiwanApiCase):

    def setUp(self):
        super().setUp()
        self._install_probe(tools=(*PROBE_TOOLS, KNOWLEDGE_TOOL))
        self._install_knowledge()
        self._grant_ai_use(self.employee)
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.partner = self._partner(name='Visible', function='Engineer')

    def _partner(self, **values):
        return self.env['res.partner'].create({'company_id': self.env.company.id, **values})

    def _ref(self, partner, chunk_no=0, model=MODEL):
        return {'model': model, 'res_id': partner.id, 'chunk_no': chunk_no}

    def _resolve(self, refs):
        return self.api('POST', RESOLVE, {'refs': refs})

    def test_a_readable_record_resolves_to_its_chunk_with_title_and_source(self):
        response = self._resolve([self._ref(self.partner)])
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body['total'], 1)
        self.assertEqual(body['items'][0], {
            'model': MODEL, 'res_id': self.partner.id, 'chunk_no': 0, 'title': 'Visible',
            'source': 'Contacts', 'text': record_chunks(self.partner, PROBE_SOURCE)[0],
        })

    def test_chunks_are_numbered_from_zero_as_the_indexer_queues_them(self):
        partner = self._partner(name='Long', comment='<p>' + ' '.join(['detail'] * 1200) + '</p>')
        chunks = record_chunks(partner, PROBE_SOURCE)
        self.assertGreater(len(chunks), 1)
        items = self._resolve([self._ref(partner, 1), self._ref(partner, 0)]).json()['items']
        self.assertEqual([(item['chunk_no'], item['text']) for item in items], [(1, chunks[1]), (0, chunks[0])])

    def test_the_candidates_order_is_kept_and_at_most_eight_come_back(self):
        partners = [self._partner(name=f'P{index}') for index in range(12)]
        items = self._resolve([self._ref(partner) for partner in reversed(partners)]).json()['items']
        self.assertEqual([item['res_id'] for item in items], [partner.id for partner in reversed(partners)][:8])

    def test_a_chunk_past_the_end_is_dropped(self):
        self.assertEqual(self._resolve([self._ref(self.partner, 5)]).json(), {'items': [], 'total': 0})

    def test_a_record_the_rules_hide_is_dropped_silently(self):
        self.env['ir.rule'].create({
            'name': 'probe: hide a function', 'model_id': self.env.ref('base.model_res_partner').id,
            'domain_force': "[('function', '!=', 'hidden')]",
        })
        hidden = self._partner(name='Hidden', function='hidden')
        items = self._resolve([self._ref(hidden), self._ref(self.partner)]).json()['items']
        self.assertEqual([item['res_id'] for item in items], [self.partner.id])

    def test_a_record_of_another_company_is_dropped(self):
        other = self.env['res.company'].create({'name': 'Other company'})
        foreign = self.env['res.partner'].create({'name': 'Foreign', 'company_id': other.id})
        self.assertEqual(self._resolve([self._ref(foreign)]).json(), {'items': [], 'total': 0})

    def test_the_record_of_a_company_the_caller_may_not_use_is_dropped_even_when_the_user_belongs_to_both(self):
        other = self.env['res.company'].create({'name': 'Second company'})
        self.employee.write({'company_ids': [(4, other.id)]})
        foreign = self.env['res.partner'].create({'name': 'Second', 'company_id': other.id})
        self.assertEqual(self._resolve([self._ref(foreign)]).json(), {'items': [], 'total': 0})

    def test_an_archived_or_missing_record_and_an_unknown_model_are_dropped(self):
        archived = self._partner(name='Archived', active=False)
        refs = [self._ref(archived), {'model': MODEL, 'res_id': 999999999, 'chunk_no': 0}, self._ref(self.partner, model='res.users'),
                self._ref(self.partner, model='no.such.model'), self._ref(self.partner)]
        self.assertEqual([item['res_id'] for item in self._resolve(refs).json()['items']], [self.partner.id])

    def test_a_source_whose_application_is_off_is_dropped(self):
        self.patch(
            type(self.env['liwan.ai.knowledge.registry']), '_liwan_ai_knowledge_sources',
            lambda model: [{**PROBE_SOURCE, 'feature_key': 'ai.messages.monthly'}],
        )
        self.assertEqual(self._resolve([self._ref(self.partner)]).json()['total'], 0)

    def test_a_malformed_body_is_a_422(self):
        too_many = [self._ref(self.partner)] * (MAX_REFS + 1)
        for body in ({}, {'refs': []}, {'refs': 'x'}, {'refs': too_many}, {'refs': [{'model': MODEL}]},
                     {'refs': [{'model': MODEL, 'res_id': True, 'chunk_no': 0}]},
                     {'refs': [{'model': MODEL, 'res_id': 1, 'chunk_no': -1}]},
                     {'refs': [{'model': MODEL, 'res_id': 1, 'chunk_no': 20}]},
                     {'refs': [self._ref(self.partner)], 'extra': 1}):
            with self.subTest(body=str(body)[:60]):
                response = self.api('POST', RESOLVE, body)
                self.assertEqual(response.status_code, 422, response.text)

    def test_forty_references_are_accepted(self):
        self.assertEqual(self._resolve([self._ref(self.partner)] * 40).status_code, 200)

    def test_a_caller_without_the_capability_is_refused(self):
        other = new_test_user(self.env, login='ai_no_use', password='ai_no_use_pass_123', name='Nour', groups='liwan_core.group_employee')
        self.patch(type(self.env['liwan.access.service']), '_liwan_has_capability', lambda model, user, key, record=None, company=None: False)
        self.authenticate(other.login, 'ai_no_use_pass_123')
        self.assertEqual(self._resolve([self._ref(self.partner)]).status_code, 403)

    def test_the_route_is_closed_while_the_feature_or_the_setting_is_off(self):
        self.env['liwan.ai.settings']._liwan_current().knowledge_enabled = False
        self.assertEqual(self._resolve([self._ref(self.partner)]).status_code, 403)
        self.env['liwan.ai.settings']._liwan_current().knowledge_enabled = True
        set_probe_feature(self, KNOWLEDGE_FEATURE, enabled=False)
        self.assertEqual(self._resolve([self._ref(self.partner)]).status_code, 403)

    def test_the_search_tool_is_offered_only_while_knowledge_is_on(self):
        tools = self.env['liwan.ai.tool.registry']
        names = lambda: [item['name'] for item in tools._liwan_ai_tools_for_user(self.employee)]  # noqa: E731
        self.assertIn('ai.search_knowledge', names())
        self.assertNotIn('ai.search_knowledge', [item['name'] for item in tools._liwan_ai_tools_for_user(self.employee, setup=True)])
        self.env['liwan.ai.settings']._liwan_current().knowledge_enabled = False
        self.assertNotIn('ai.search_knowledge', names())

    def test_the_search_tool_reaches_the_catalog_without_an_agent(self):
        catalog = self.api('GET', '/api/v1/ai/tools').json()
        tool = next(item for item in catalog['items'] if item['name'] == 'ai.search_knowledge')
        self.assertEqual(tool['route'], {'method': 'POST', 'path': RESOLVE})
        self.assertEqual(tool['input_map'], {'body': {'refs': '$refs'}})
        self.assertEqual(tool['result_summary'], ['items[]'])
        self.assertEqual(tool['input_schema']['properties'], {'query': {'type': 'string', 'minLength': 1, 'maxLength': 500}})
        self.assertFalse(tool['requires_approval'])
        self.assertNotIn('ai', [agent['key'] for agent in catalog['agents']])


@tagged('post_install', '-at_install', 'liwan')
class TestAiKnowledgeRebuild(AiProbe, LiwanApiCase):

    def setUp(self):
        super().setUp()
        self._install_probe()
        self._install_knowledge()
        self.patch(knowledge_indexer, 'SETTLE_SECONDS', 0)
        self.manager = new_test_user(
            self.env, login='ai_kb_admin', password='ai_kb_admin_pass_123', name='Mona',
            groups='liwan_core.group_employee,liwan_ai.group_cap_ai_use',
        )
        self._grant_ai_settings(self.manager)
        self._grant_ai_use(self.employee)

    def test_a_settings_manager_clears_the_cursors_and_queues_one_reset(self):
        self.env['liwan.ai.knowledge.indexer']._liwan_cron_tick()
        self.assertTrue(self.env['liwan.ai.knowledge.cursor'].search([]))
        self.env.cr.execute('DELETE FROM liwan_ai.ai_knowledge_queue')
        self.authenticate('ai_kb_admin', 'ai_kb_admin_pass_123')
        response = self.api('POST', REBUILD)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), {'queued': True})
        self.assertFalse(self.env['liwan.ai.knowledge.cursor'].search([]))
        self.assertEqual(self._queue(), [('reset', None, None, None, None)])

    def test_an_ordinary_employee_is_refused(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.assertEqual(self.api('POST', REBUILD).status_code, 403)
        self.assertEqual(self._queue(), [])

    def test_a_deployment_without_the_queue_answers_409(self):
        self.env.cr.execute('DROP SCHEMA liwan_ai CASCADE')
        self.authenticate('ai_kb_admin', 'ai_kb_admin_pass_123')
        response = self.api('POST', REBUILD)
        self.assertEqual((response.status_code, response.json()['code']), (409, 'knowledge_unavailable'))

    def test_the_setting_is_read_and_written_through_the_settings_route(self):
        self.authenticate('ai_kb_admin', 'ai_kb_admin_pass_123')
        settings = self.api('GET', '/api/v1/ai/settings').json()
        self.assertIs(settings['knowledge_enabled'], True)
        saved = self.api('PATCH', '/api/v1/ai/settings', {'revision': settings['revision'], 'knowledge_enabled': False})
        self.assertEqual(saved.status_code, 200, saved.text)
        self.assertIs(saved.json()['knowledge_enabled'], False)
        bad = self.api('PATCH', '/api/v1/ai/settings', {'revision': saved.json()['revision'], 'knowledge_enabled': 'yes'})
        self.assertEqual(bad.status_code, 422)
