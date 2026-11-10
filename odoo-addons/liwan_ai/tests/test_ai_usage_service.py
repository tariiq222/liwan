# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import datetime, timedelta, timezone

from odoo.exceptions import AccessDenied
from odoo.fields import Command
from odoo.tests import new_test_user, tagged

from odoo.addons.liwan_ai.models.access_service import AI_USAGE_RECORD
from odoo.addons.liwan_ai.models.ai_usage import USAGE_SERVICE_PATH
from odoo.addons.liwan_ai.tests.common import AiProbe
from odoo.addons.liwan_api.tests.common import LiwanApiCase
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule
from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT
from odoo.addons.liwan_platform.models.ir_http import LiwanPlatformIrHttp

ITEM = {
    'conversation_id': 'r_test_01', 'call_id': '0f1e2d3c4b5a6978', 'kind': 'plan', 'billing': 'platform',
    'provider': 'acme-ai', 'model': 'acme-large-1',
    'outcome': 'ok', 'input_tokens': 120, 'output_tokens': 45, 'called_at': datetime.now(timezone.utc).isoformat(),
}


@tagged('post_install', '-at_install', 'liwan')
class TestAiUsageService(AiProbe, LiwanApiCase):
    """Issue #557: a finished run is recorded for its user even when that user's session is gone."""

    def setUp(self):
        super().setUp()
        self._install_probe()
        self.recorder = self.env.ref('liwan_ai.user_ai_usage')
        self.key = self._key(self.recorder)
        self.other_company = self.env['res.company'].create({'name': 'Usage Other Company'})
        self.Usage = self.env['liwan.ai.usage']
        self.opener.cookies.clear()

    def _key(self, user):
        return self.env['res.users.apikeys'].with_user(user)._generate('rpc', 'usage test', datetime.now() + timedelta(days=1))

    def _post(self, body, key=None, path=USAGE_SERVICE_PATH, headers=None):
        auth = {} if key is False else {'Authorization': f'bearer {key or self.key}'}
        return self.url_open(path, json=body, headers={'Content-Type': 'application/json', **auth, **(headers or {})})

    def _batch(self, user=None, company=None, *items):
        user = user or self.employee
        company = company or user.company_id
        return {'user_id': user.id, 'user_company_id': company.id, 'items': list(items) or [ITEM]}

    def _assert_422(self, response, field):
        self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(response.json()['field'], field)
        self.assertFalse(self.Usage.search([]))

    def test_the_recorder_records_a_batch_for_the_user_without_their_session(self):
        response = self._post(self._batch())
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['total'], 1)
        row = self.Usage.browse(response.json()['items'][0]['id'])
        self.assertEqual((row.user_id, row.company_id), (self.employee, self.employee.company_id))
        self.assertEqual(self.env['liwan.ai.usage']._liwan_platform_tokens_used(), 165)

    def test_a_re_sent_batch_is_counted_once(self):
        first = self._post(self._batch()).json()
        again = self._post(self._batch())
        self.assertEqual(again.status_code, 200)
        self.assertEqual([item['id'] for item in again.json()['items']], [item['id'] for item in first['items']])
        self.assertEqual(self.Usage.search_count([]), 1)
        self.assertEqual(self.env['liwan.ai.usage']._liwan_platform_tokens_used(), 165)

    def test_the_same_call_of_another_user_is_its_own_row(self):
        other = new_test_user(self.env, login='usage_other', groups='liwan_core.group_employee')
        self._post(self._batch(self.employee))
        self._post(self._batch(other))
        self.assertEqual(self.Usage.search([]).user_id, self.employee | other)

    def test_a_leaver_still_has_their_calls_recorded(self):
        self.employee.active = False
        self.assertEqual(self._post(self._batch()).status_code, 200)
        self.assertEqual(self.Usage.search_count([('user_id', '=', self.employee.id)]), 1)

    def test_the_user_must_be_an_internal_user_of_the_company(self):
        portal = new_test_user(self.env, login='usage_portal', groups='base.group_portal')
        for body, field in (
            ({**self._batch(), 'user_id': 999999999}, 'user_id'),
            ({**self._batch(), 'user_id': portal.id, 'user_company_id': portal.company_id.id}, 'user_id'),
            ({**self._batch(), 'user_id': True}, 'user_id'),
            ({**self._batch(), 'user_id': str(self.employee.id)}, 'user_id'),
            ({**self._batch(), 'user_company_id': self.other_company.id}, 'user_id'),
            ({**self._batch(), 'user_company_id': 999999999}, 'user_company_id'),
        ):
            with self.subTest(body=body):
                self._assert_422(self._post(body), field)

    def test_a_company_the_user_does_not_belong_to_is_refused_even_when_the_recorder_does(self):
        self.assertIn(self.other_company, self.recorder.company_ids)
        self._assert_422(self._post(self._batch(self.employee, self.other_company)), 'user_id')
        self.employee.write({'company_ids': [Command.link(self.other_company.id)]})
        self.assertEqual(self._post(self._batch(self.employee, self.other_company)).status_code, 200)
        self.assertEqual(self.Usage.search([]).company_id, self.other_company)

    def test_the_body_shape_is_strict(self):
        self._assert_422(self._post({**self._batch(), 'extra': 1}), 'extra')
        self._assert_422(self._post({'user_company_id': self.employee.company_id.id, 'items': [ITEM]}), 'user_id')
        self._assert_422(self._post({'user_id': self.employee.id, 'items': [ITEM]}), 'user_company_id')
        self._assert_422(self._post({**self._batch(), 'items': []}), 'items')
        self._assert_422(self._post({**self._batch(), 'items': [{**ITEM, 'call_id': 'bad'}]}), 'items.0.call_id')
        # A row cannot name its own owner: user_id belongs to the batch.
        self._assert_422(self._post(self._batch(None, None, {**ITEM, 'user_id': self.employee.id})), 'items.0.user_id')

    def test_a_missing_or_wrong_key_is_a_structured_401(self):
        for key in (False, 'a' * 64, 'not-a-key'):
            with self.subTest(key=key):
                response = self._post(self._batch(), key=key)
                self.assertEqual(response.status_code, 401, response.text)
                self.assertEqual(response.json()['code'], 'unauthorized')
        self.assertFalse(self.Usage.search([]))

    def test_a_session_alone_does_not_authenticate_the_service_route(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        response = self._post(self._batch(), key=False)
        self.assertEqual(response.status_code, 401, response.text)
        self.assertFalse(self.Usage.search([]))

    def test_another_users_key_is_forbidden_here(self):
        response = self._post(self._batch(), key=self._key(self.employee))
        self.assertEqual(response.status_code, 403, response.text)
        self.assertEqual(response.json()['code'], 'forbidden')
        self.assertFalse(self.Usage.search([]))

    def test_the_key_reaches_this_one_path_only(self):
        near = (
            USAGE_SERVICE_PATH + '/', USAGE_SERVICE_PATH.upper(), USAGE_SERVICE_PATH + '/x', '/api/v1/ai/usage',
            '/api/v1/ai/usage/../tools', '/api/v1/ai/audit', '/api/v1/ai/tools', '/api/v1/me',
            '/json/2/res.users/search_read', '/json/2/liwan.ai.usage/search_read', '/web/dataset/call_kw', '/doc/index.json',
        )
        for path in near:
            with self.subTest(path=path):
                self.Usage.search([]).unlink()
                response = self._post(self._batch(), path=path)
                self.assertNotIn('"items"', response.text)
                self.assertNotIn('"result"', response.text)
                self.assertFalse(self.Usage.search([]))

    def test_bearer_authentication_is_refused_on_any_route_the_platform_does_not_list(self):
        listed = type(self.env['ir.http'])._liwan_bearer_routes()
        self.assertEqual(listed, frozenset({USAGE_SERVICE_PATH}))
        self.assertEqual(LiwanPlatformIrHttp._liwan_bearer_routes(), frozenset())

    def test_nobody_signs_in_as_the_recorder(self):
        self.assertFalse(self.recorder.password)
        with self.assertRaises(AccessDenied):
            self.recorder._check_credentials({'type': 'password', 'password': ''}, {'interactive': True})
        response = self.url_open('/web/session/authenticate', json={
            'jsonrpc': '2.0', 'method': 'call', 'params': {'db': self.env.cr.dbname, 'login': 'liwan_ai_usage', 'password': self.key},
        }, headers={'Content-Type': 'application/json'})
        self.assertNotIn('"uid": ' + str(self.recorder.id), response.text)

    def test_the_recorder_is_not_a_seat_and_holds_one_capability_only_as_itself(self):
        self.assertTrue(self.recorder.active and self.recorder.share)
        service = self.env['liwan.access.service']
        self.assertEqual(service.with_user(self.recorder)._liwan_capability_keys(self.recorder), {AI_USAGE_RECORD})
        self.assertFalse(service._liwan_capability_keys(self.recorder))
        self.assertFalse(service.with_user(self.employee)._liwan_capability_keys(self.recorder))
        self.assertNotIn(AI_USAGE_RECORD, service.with_user(self.recorder)._liwan_capability_keys(self.employee))
        self.assertNotIn(self.recorder.id, self.env['liwan.entitlement.service']._liwan_excluded_user_ids() or [])
        self.assertFalse(self.recorder.has_group('base.group_user'))

    def test_no_access_administrator_reaches_the_recorder(self):
        with self.assertRaises(LiwanAccessRule) as caught:
            self.env['liwan.access.service']._liwan_assert_user_scope(self.recorder)
        self.assertEqual(caught.exception.status, 404)
        with self.assertRaises(LiwanAccessRule) as caught:
            self.env['liwan.access.service']._liwan_assert_account_reactivation(self.recorder)
        self.assertEqual(caught.exception.status, 403)

    def test_ai_disabled_is_403_and_writes_nothing(self):
        profile = self.env.ref('liwan_platform.tenant_profile')
        profile.sudo().with_context(**{OPERATOR_CONTEXT: True}).write({'features': {**(profile.features or {}), 'ai.enabled': False}})
        response = self._post(self._batch())
        self.assertEqual(response.status_code, 403, response.text)
        self.assertFalse(self.Usage.search([]))
