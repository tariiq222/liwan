# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from odoo.addons.nasq_ai.tests.common import CREATE_CAP, READ_CAP, WRITE_CAP, AiProbe
from odoo.addons.nasq_api.tests.common import NasqApiCase, set_probe_feature
from odoo.addons.nasq_platform.models.entitlement_service import OPERATOR_CONTEXT


@tagged('post_install', '-at_install', 'nasq')
class TestAiToolsRoute(AiProbe, NasqApiCase):

    def setUp(self):
        super().setUp()
        self._install_probe()
        self.authenticate('api_emp', 'api_emp_pass_123')

    def _set_limit(self, key, value):
        profile = self.env.ref('nasq_platform.tenant_profile')
        profile.sudo().with_context(**{OPERATOR_CONTEXT: True}).write({
            'features': {**(profile.features or {}), key: value},
        })

    def test_lists_only_the_tools_the_user_has_capabilities_for(self):
        self.granted = {READ_CAP}
        body = self.api('GET', '/api/v1/ai/tools').json()
        self.assertEqual([item['name'] for item in body['items']], ['probe.list_things'])
        self.assertEqual(body['total'], 1)
        tool = body['items'][0]
        self.assertEqual(tool['kind'], 'read')
        self.assertEqual(tool['route'], {'method': 'GET', 'path': '/api/v1/probe/things'})
        self.assertEqual(tool['input_map'], {'query': {'limit': '$limit', 'filter': 'mine'}})
        self.assertEqual(tool['description'], {'ar': 'يعرض الأشياء', 'en': 'List things'})
        self.assertIsNone(tool['draft_target'])
        self.assertNotIn('capability', tool)
        self.assertNotIn('owner', tool)

    def test_draft_tool_carries_its_target_and_no_route(self):
        self.granted = {CREATE_CAP}
        body = self.api('GET', '/api/v1/ai/tools').json()
        self.assertEqual([item['name'] for item in body['items']], ['probe.draft_thing'])
        self.assertIsNone(body['items'][0]['route'])
        self.assertEqual(body['items'][0]['draft_target'], '/things/new')

    def test_no_capability_means_an_empty_catalog_not_an_error(self):
        body = self.api('GET', '/api/v1/ai/tools').json()
        self.assertEqual(body, {'items': [], 'total': 0, 'limits': body['limits']})

    def test_limits_block_reports_configured_values(self):
        self.granted = {READ_CAP, WRITE_CAP}
        self._set_limit('ai.tool_calls.per_run', 5)
        body = self.api('GET', '/api/v1/ai/tools').json()
        self.assertEqual(body['limits'], {'tool_calls_per_run': 5, 'messages_monthly': None, 'messages_used': 0})

    def test_tools_whose_feature_is_off_are_hidden(self):
        self.granted = {READ_CAP}
        set_probe_feature(self, enabled=False)
        response = self.api('GET', '/api/v1/ai/tools')
        # The only registered feature is off, so the registry gate answers 403.
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()['code'], 'feature_not_included')

    def test_ai_disabled_answers_feature_not_included(self):
        self.granted = {READ_CAP}
        self._set_limit('ai.enabled', False)
        profile = self.env.ref('nasq_platform.tenant_profile')
        profile.sudo().with_context(**{OPERATOR_CONTEXT: True}).write({
            'retained_read_features': [k for k in (profile.retained_read_features or []) if k != 'ai.enabled'],
        })
        response = self.api('GET', '/api/v1/ai/tools')
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()['details'], {'reason': 'feature', 'feature': 'ai.enabled'})

    def test_anonymous_is_rejected(self):
        self.logout()
        response = self.api('GET', '/api/v1/ai/tools')
        self.assertIn(response.status_code, (401, 403, 404))
        # auth='user' routes never answer a catalog to a visitor.
        self.assertNotIn(b'probe.list_things', response.content)
