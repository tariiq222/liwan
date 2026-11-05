# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import datetime, timedelta

from odoo.tests import new_test_user, tagged

from odoo.addons.liwan_ai.models import consent_text
from odoo.addons.liwan_ai.tests.common import AiProbe
from odoo.addons.liwan_api.tests.common import LiwanApiCase
from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT

MESSAGE = {
    'conversation_id': 'r_settings_01', 'kind': 'message', 'tool_name': None, 'input': None,
    'result': 'ok', 'http_status': None, 'draft': None, 'approved': None, 'attested': False,
}
SIGNATURE = {'text_version': consent_text.CONSENT_VERSION, 'text_hash': consent_text.CONSENT_TEXT_HASH}


@tagged('post_install', '-at_install', 'liwan')
class TestAiSettings(AiProbe, LiwanApiCase):

    def setUp(self):
        super().setUp()
        self._install_probe()
        self._grant_ai_use(self.employee)
        self.manager = new_test_user(
            self.env, login='ai_settings_admin', password='ai_settings_admin_pass_123', name='Huda',
            groups='liwan_core.group_employee,liwan_ai.group_cap_ai_use',
        )
        self._grant_ai_settings(self.manager)

    def _as_manager(self):
        self.authenticate('ai_settings_admin', 'ai_settings_admin_pass_123')

    def _set_feature(self, key, value):
        profile = self.env.ref('liwan_platform.tenant_profile')
        profile.sudo().with_context(**{OPERATOR_CONTEXT: True}).write({
            'features': {**(profile.features or {}), key: value},
        })

    def _raw_usage(self, billing, tokens, called_at):
        # create() validates the wire shape of the Nuxt executor; a fixture row is written directly.
        self.env.cr.execute(
            "INSERT INTO liwan_ai_usage (company_id, user_id, conversation_id, kind, billing, provider, model, outcome,"
            " input_tokens, output_tokens, tokens_reported, called_at)"
            " VALUES (%s, %s, 'r_usage', 'plan', %s, 'acme-ai', 'acme-1', 'ok', %s, 0, true, %s) RETURNING id",
            [self.env.company.id, self.employee.id, billing, tokens, called_at or datetime.now()],
        )
        return self.env.cr.fetchone()[0]

    def test_an_ordinary_user_can_neither_read_nor_change_the_settings(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        for method, path, body in (
            ('GET', '/api/v1/ai/settings', None),
            ('PATCH', '/api/v1/ai/settings', {'provider_mode': 'tenant_key', 'revision': 1}),
            ('POST', '/api/v1/ai/consent', SIGNATURE),
            ('GET', '/api/v1/ai/monitoring', None),
            ('POST', '/api/v1/ai/config/authorize', None),
        ):
            with self.subTest(path=path, method=method):
                response = self.api(method, path, body)
                self.assertEqual(response.status_code, 403, response.text)
                self.assertEqual(response.json()['code'], 'forbidden')

    def test_a_branch_manager_cannot_change_the_tenant_wide_settings(self):
        self.settings_managers -= self.manager
        self.branch_settings_managers |= self.manager
        self._as_manager()
        for method, path, body in (
            ('GET', '/api/v1/ai/settings', None),
            ('PATCH', '/api/v1/ai/settings', {'provider_mode': 'tenant_key', 'revision': 1}),
            ('POST', '/api/v1/ai/consent', SIGNATURE),
            ('POST', '/api/v1/ai/consent/revoke', None),
            ('POST', '/api/v1/ai/config/authorize', None),
        ):
            with self.subTest(path=path, method=method):
                response = self.api(method, path, body)
                self.assertEqual(response.status_code, 403, response.text)
        self.assertFalse(self.env['liwan.ai.consent'].search([]))

    def test_a_config_change_needs_the_write_level_of_the_feature(self):
        self._as_manager()
        self.assertEqual(self.api('POST', '/api/v1/ai/config/authorize').json(), {'ok': True})
        profile = self.env.ref('liwan_platform.tenant_profile')
        profile.sudo().with_context(**{OPERATOR_CONTEXT: True}).write({
            'features': {**(profile.features or {}), 'ai.enabled': False},
            'retained_read_features': [*(profile.retained_read_features or []), 'ai.enabled'],
        })
        self.assertEqual(self.api('GET', '/api/v1/ai/settings').status_code, 200)
        self.assertEqual(self.api('POST', '/api/v1/ai/config/authorize').status_code, 403)

    def test_a_revocation_revokes_every_live_row(self):
        Consent = self.env['liwan.ai.consent']
        Consent.create({'user_id': self.manager.id, 'signed_at': datetime.now(), 'text_version': 'older', 'text_hash': 'x'})
        Consent.create({
            'user_id': self.manager.id, 'signed_at': datetime.now(),
            'text_version': consent_text.CONSENT_VERSION, 'text_hash': consent_text.CONSENT_TEXT_HASH,
        })
        with self.assertRaises(Exception), self.env.cr.savepoint():
            Consent.create({
                'user_id': self.manager.id, 'signed_at': datetime.now(),
                'text_version': consent_text.CONSENT_VERSION, 'text_hash': consent_text.CONSENT_TEXT_HASH,
            })
        self._as_manager()
        self.assertIsNone(self.api('POST', '/api/v1/ai/consent/revoke').json()['consent']['signed'])
        self.assertFalse(Consent._liwan_valid_all())

    def test_defaults_and_the_revision_guard(self):
        self._as_manager()
        body = self.api('GET', '/api/v1/ai/settings').json()
        self.assertEqual(body['provider_mode'], 'platform')
        self.assertIsNone(body['consent']['signed'])
        self.assertEqual(body['consent']['required_version'], consent_text.CONSENT_VERSION)
        revision = body['revision']
        stale = self.api('PATCH', '/api/v1/ai/settings', {'provider_mode': 'tenant_key', 'revision': revision + 5})
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(stale.json()['code'], 'conflict')
        changed = self.api('PATCH', '/api/v1/ai/settings', {'provider_mode': 'tenant_key', 'revision': revision}).json()
        self.assertEqual((changed['provider_mode'], changed['revision']), ('tenant_key', revision + 1))
        invalid = self.api('PATCH', '/api/v1/ai/settings', {'provider_mode': 'free', 'revision': revision + 1})
        self.assertEqual((invalid.status_code, invalid.json()['field']), (422, 'provider_mode'))
        extra = self.api('PATCH', '/api/v1/ai/settings', {'provider_mode': 'platform', 'revision': 2, 'x': 1})
        self.assertEqual((extra.status_code, extra.json()['field']), (422, 'x'))

    def test_consent_needs_the_current_text_and_a_new_version_voids_it(self):
        self._as_manager()
        wrong = self.api('POST', '/api/v1/ai/consent', {**SIGNATURE, 'text_hash': '0' * 64})
        self.assertEqual((wrong.status_code, wrong.json()['field']), (422, 'text_hash'))
        signed = self.api('POST', '/api/v1/ai/consent', SIGNATURE).json()['consent']['signed']
        self.assertEqual(signed['user'], {'id': self.manager.id, 'name': 'Huda'})
        self.assertEqual(self.api('POST', '/api/v1/ai/consent', SIGNATURE).json()['consent']['signed'], signed)
        self.assertEqual(self.env['liwan.ai.consent'].search_count([]), 1)
        self.assertTrue(self.env['liwan.ai.tool.registry']._liwan_ai_policy()['outside_allowed'])
        self.patch(consent_text, 'CONSENT_VERSION', '2099-01-01')
        self.assertFalse(self.env['liwan.ai.consent']._liwan_valid())
        self.assertFalse(self.env['liwan.ai.tool.registry']._liwan_ai_policy()['outside_allowed'])

    def test_revoke(self):
        self._as_manager()
        self.api('POST', '/api/v1/ai/consent', SIGNATURE)
        self.assertIsNone(self.api('POST', '/api/v1/ai/consent/revoke').json()['consent']['signed'])
        again = self.api('POST', '/api/v1/ai/consent/revoke')
        self.assertEqual((again.status_code, again.json()['code']), (404, 'not_found'))
        consent = self.env['liwan.ai.consent'].search([])
        self.assertEqual(consent.revoked_by_id, self.manager)
        with self.assertRaises(Exception):
            consent.write({'text_version': 'other'})

    def test_platform_tokens_count_this_month_only_and_never_the_tenant_key(self):
        Usage = self.env['liwan.ai.usage']
        last_month = self.env['liwan.ai.audit']._liwan_ai_month_start() - timedelta(seconds=1)
        self._raw_usage('platform', 100, None)
        self._raw_usage('tenant_key', 40, None)
        self._raw_usage('platform', 7, last_month)
        self.assertEqual(Usage._liwan_platform_tokens_used(), 100)

    def test_the_token_limit_stops_a_platform_run_at_the_limit_only(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        self._raw_usage('platform', 100, None)
        self._set_feature('ai.tokens.monthly', 101)
        self.assertEqual(self.api('POST', '/api/v1/ai/audit', MESSAGE).status_code, 200)
        self._set_feature('ai.tokens.monthly', 100)
        refused = self.api('POST', '/api/v1/ai/audit', MESSAGE)
        self.assertEqual(refused.status_code, 403, refused.text)
        self.assertEqual(refused.json()['details']['limit_key'], 'ai.tokens.monthly')
        self.env['liwan.ai.settings']._liwan_current().provider_mode = 'tenant_key'
        self.assertEqual(self.api('POST', '/api/v1/ai/audit', MESSAGE).status_code, 200)

    def test_monitoring_counts_actions_per_user_without_text(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.api('POST', '/api/v1/ai/audit', MESSAGE)
        self.api('POST', '/api/v1/ai/audit', {**MESSAGE, 'conversation_id': 'r_settings_02'})
        self._raw_usage('platform', 30, None)
        self._as_manager()
        body = self.api('GET', '/api/v1/ai/monitoring').json()
        self.assertEqual(body['totals']['messages'], 2)
        self.assertEqual(body['totals']['input_tokens'], 30)
        self.assertEqual(body['users']['items'][0], {
            'user': {'id': self.employee.id, 'name': self.employee.name}, 'messages': 2, 'tokens': 30, 'tool_calls': 0,
        })
        self.assertEqual(set(body), {'month', 'totals', 'users', 'tools', 'agents'})
