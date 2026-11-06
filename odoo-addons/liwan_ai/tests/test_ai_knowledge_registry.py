# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import ValidationError
from odoo.tests import TransactionCase, tagged

from odoo.addons.liwan_ai.tests.common import PROBE_AGENT, PROBE_SOURCE, AiProbe


@tagged('post_install', '-at_install', 'liwan')
class TestAiKnowledgeRegistry(AiProbe, TransactionCase):

    def setUp(self):
        super().setUp()
        self._install_probe()
        self.registry = self.env['liwan.ai.knowledge.registry']

    def _declare(self, *sources):
        self.patch(type(self.registry), '_liwan_ai_knowledge_sources', lambda model: list(sources))

    def _assert_rejected(self, source, fragment):
        self._declare(source)
        with self.assertRaises(ValidationError) as caught:
            self.registry._liwan_ai_knowledge_map()
        self.assertIn(fragment, str(caught.exception))

    def test_a_valid_source_is_mapped_by_model(self):
        self._declare(PROBE_SOURCE)
        self.assertEqual(list(self.registry._liwan_ai_knowledge_map()), ['res.partner'])

    def test_a_sensitive_field_is_refused(self):
        for name in ('phone', 'email'):
            with self.subTest(name):
                self._assert_rejected({**PROBE_SOURCE, 'fields': ['function', name]}, f'{name} is a sensitive field')

    def test_a_field_the_agent_declares_sensitive_is_refused(self):
        self.assertIn('secret_note', PROBE_AGENT['sensitive_fields'])
        agent = {**PROBE_AGENT, 'sensitive_fields': ['function']}
        self.patch(type(self.env['liwan.ai.agent.registry']), '_liwan_ai_agent_definitions', lambda model: (agent,))
        self._assert_rejected(PROBE_SOURCE, 'function is a sensitive field')

    def test_a_sensitive_title_field_is_refused(self):
        self._assert_rejected({**PROBE_SOURCE, 'title_field': 'phone'}, 'phone is a sensitive field')

    def test_unknown_and_unsupported_fields_are_refused(self):
        self._assert_rejected({**PROBE_SOURCE, 'fields': ['no_such_field']}, 'no_such_field is not a field')
        self._assert_rejected({**PROBE_SOURCE, 'fields': ['active']}, 'active is not a field')
        self._assert_rejected({**PROBE_SOURCE, 'fields': ['child_ids']}, 'child_ids is not a field')
        self._assert_rejected({**PROBE_SOURCE, 'fields': []}, 'fields must be')

    def test_the_indexer_capabilities_must_be_registered_ones(self):
        for value in (None, [], ['Not A Key'], [3]):
            with self.subTest(value=value):
                self._assert_rejected({**PROBE_SOURCE, 'indexer_capabilities': value}, 'indexer_capabilities')

    def test_a_capability_that_is_not_registered_is_declared_but_not_held(self):
        self._declare({**PROBE_SOURCE, 'indexer_capabilities': ['ai.use', 'not_installed.things.read']})
        self.assertEqual(list(self.registry._liwan_ai_knowledge_map()), ['res.partner'])
        self.assertEqual(self.registry._liwan_ai_indexer_capabilities(), {'ai.use'})

    def test_a_missing_declaration_text_is_refused(self):
        for name in ('owner', 'feature_key', 'title_field', 'label_ar', 'label_en'):
            with self.subTest(name):
                self._assert_rejected({**PROBE_SOURCE, name: ''}, f'missing {name}')

    def test_an_unknown_model_or_one_without_a_company_is_refused(self):
        self._assert_rejected({**PROBE_SOURCE, 'model': 'no.such.model'}, 'does not exist')
        self._assert_rejected({**PROBE_SOURCE, 'model': 'res.country', 'title_field': 'name', 'fields': ['code']}, 'company_id')

    def test_a_duplicate_model_is_refused(self):
        self._declare(PROBE_SOURCE, PROBE_SOURCE)
        with self.assertRaises(ValidationError) as caught:
            self.registry._liwan_ai_knowledge_map()
        self.assertIn('duplicate source', str(caught.exception))
