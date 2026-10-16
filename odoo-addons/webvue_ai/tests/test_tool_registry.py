# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import ValidationError
from odoo.tests import TransactionCase, tagged

from odoo.addons.webvue_ai.tests.common import PROBE_TOOLS, AiProbe


@tagged('post_install', '-at_install', 'webvue')
class TestAiToolRegistry(AiProbe, TransactionCase):

    def setUp(self):
        super().setUp()
        self._install_probe()

    def _with(self, **changes):
        base = dict(PROBE_TOOLS[0])
        base.update(changes)
        return (base,)

    def _assert_rejected(self, tools, fragment):
        self.patch(type(self.env['webvue.ai.tool.registry']), '_webvue_ai_tool_definitions', lambda model: tools)
        with self.assertRaises(ValidationError) as caught:
            self.env['webvue.ai.tool.registry']._webvue_ai_tool_map()
        self.assertIn(fragment, str(caught.exception))

    def test_probe_tools_validate_and_keep_registration_order(self):
        tools = self.env['webvue.ai.tool.registry']._webvue_ai_tool_map()
        self.assertEqual(list(tools), ['probe.list_things', 'probe.rename_thing', 'probe.draft_thing'])
        self.assertEqual(self.env['webvue.ai.tool.registry']._webvue_ai_feature_keys(), ('test_probe.enabled',))

    def test_duplicate_name_is_rejected(self):
        self._assert_rejected((PROBE_TOOLS[0], PROBE_TOOLS[0]), 'duplicate tool probe.list_things')

    def test_name_must_start_with_owner_prefix(self):
        # The message names the offending tool by its declared name and the owner it must match.
        self._assert_rejected(self._with(name='other.list_things'), 'tool other.list_things: name prefix must match owner webvue_probe')

    def test_unknown_kind_is_rejected(self):
        self._assert_rejected(self._with(kind='delete'), 'kind')

    def test_read_tool_must_use_get(self):
        self._assert_rejected(self._with(route={'method': 'POST', 'path': '/api/v1/probe/things'}), 'GET')

    def test_route_must_be_under_api_v1(self):
        self._assert_rejected(self._with(route={'method': 'GET', 'path': '/web/things'}), '/api/v1/')

    def test_draft_tool_has_target_and_no_route(self):
        draft = dict(PROBE_TOOLS[2])
        draft['route'] = {'method': 'POST', 'path': '/api/v1/probe/things'}
        self._assert_rejected((draft,), 'route')
        draft = dict(PROBE_TOOLS[2])
        draft.pop('draft_target')
        self._assert_rejected((draft,), 'draft_target')

    def test_input_map_may_only_reference_schema_properties(self):
        self._assert_rejected(
            self._with(input_map={'query': {'limit': '$page_size'}}), 'page_size',
        )

    def test_path_placeholders_must_be_mapped(self):
        self._assert_rejected(
            self._with(route={'method': 'GET', 'path': '/api/v1/probe/things/{thing_id}'}), 'thing_id',
        )

    def test_missing_capability_or_descriptions_are_rejected(self):
        self._assert_rejected(self._with(capability=''), 'capability')
        self._assert_rejected(self._with(description_ar=''), 'description_ar')

    def test_result_summary_must_be_a_list_of_paths(self):
        self._assert_rejected(self._with(result_summary='items'), 'result_summary')
        self._assert_rejected(self._with(result_summary=['items[]', 'bad path!']), 'bad path!')
