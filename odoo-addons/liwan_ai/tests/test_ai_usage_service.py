# Part of Odoo. See LICENSE file for full copyright and licensing details.
import http.client
import json
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from odoo import SUPERUSER_ID, api
from odoo.exceptions import AccessDenied
from odoo.fields import Command
from odoo.sql_db import db_connect
from odoo.tests import new_test_user, tagged
from odoo.tests.common import HOST, TEST_CURSOR_COOKIE_NAME
from odoo.tools import config

from odoo.addons.liwan_ai.models import ai_usage
from odoo.addons.liwan_ai.models.access_service import AI_USAGE_RECORD
from odoo.addons.liwan_ai.models.ai_usage import (
    SERVICE_MAX_BATCH_TOKENS,
    SERVICE_MAX_INPUT_TOKENS,
    SERVICE_MAX_OUTPUT_TOKENS,
    USAGE_SERVICE_PATH,
)
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

    def _post_raw(self, path, key, method='POST'):
        return self.url_open(path, json=self._batch(), headers={'Content-Type': 'application/json', 'Authorization': f'bearer {key}'}, method=method)

    def _post_unnormalized(self, path, key):
        """The request target exactly as written: an HTTP client library would resolve the dot segments first."""
        body = json.dumps(self._batch())
        self.cr.flush()
        self.cr.clear()
        with self.allow_requests():
            connection = http.client.HTTPConnection(HOST, config['http_port'], timeout=30)
            try:
                connection.putrequest('POST', path)
                for name, value in (('Content-Type', 'application/json'), ('Authorization', f'bearer {key}'), ('Content-Length', str(len(body))),
                                    ('Cookie', f'{TEST_CURSOR_COOKIE_NAME}={self.http_request_key}')):
                    connection.putheader(name, value)
                connection.endheaders(body.encode())
                response = connection.getresponse()
                return response.status, response.read().decode()
            finally:
                connection.close()

    def test_the_same_call_held_under_another_company_is_a_409_that_names_nothing(self):
        self.employee.write({'company_ids': [Command.link(self.other_company.id)]})
        self.assertEqual(self._post(self._batch(self.employee, self.other_company)).status_code, 200)
        response = self._post(self._batch(self.employee, self.employee.company_id))
        self.assertEqual(response.status_code, 409, response.text)
        body = response.json()
        self.assertEqual((body['code'], body['field']), ('duplicate', 'items.0.call_id'))
        self.assertNotIn(self.other_company.name, response.text)
        self.assertNotIn(str(self.other_company.id), response.text)
        # Nothing was added under the second company, and the first row is untouched.
        self.assertEqual(self.Usage.search([]).company_id, self.other_company)
        self.assertEqual(self.Usage.search_count([]), 1)

    def _attempt(self, index, **change):
        return {**ITEM, 'call_id': f'{index:016x}', **change}

    def test_a_row_cannot_report_more_than_one_call_can_consume(self):
        self._assert_422(self._post(self._batch(None, None, self._attempt(1, input_tokens=SERVICE_MAX_INPUT_TOKENS + 1))), 'items.0.input_tokens')
        self._assert_422(self._post(self._batch(None, None, self._attempt(2, output_tokens=SERVICE_MAX_OUTPUT_TOKENS + 1))), 'items.0.output_tokens')
        self._assert_422(self._post(self._batch(None, None, self._attempt(3), self._attempt(4, input_tokens=100_000_000))), 'items.1.input_tokens')
        edge = self._attempt(5, input_tokens=SERVICE_MAX_INPUT_TOKENS, output_tokens=SERVICE_MAX_OUTPUT_TOKENS)
        self.assertEqual(self._post(self._batch(None, None, edge)).status_code, 200)

    def test_a_request_cannot_report_more_than_four_full_runs(self):
        full = {'input_tokens': SERVICE_MAX_INPUT_TOKENS, 'output_tokens': SERVICE_MAX_OUTPUT_TOKENS}
        self.assertEqual(SERVICE_MAX_BATCH_TOKENS, 4 * (SERVICE_MAX_INPUT_TOKENS + SERVICE_MAX_OUTPUT_TOKENS))
        over = [self._attempt(index, **full) for index in range(5)]
        self._assert_422(self._post(self._batch(None, None, *over)), 'items')
        self.assertEqual(self._post(self._batch(None, None, *over[:4])).status_code, 200)

    def test_called_at_must_be_recent_so_a_row_cannot_be_moved_into_another_month(self):
        now = datetime.now(timezone.utc)
        for index, (moment, field) in enumerate(((now - timedelta(days=2), 'called_at'), (now - timedelta(days=40), 'called_at'), (now + timedelta(minutes=10), 'called_at'))):
            with self.subTest(moment=moment):
                self._assert_422(self._post(self._batch(None, None, self._attempt(index + 10, called_at=moment.isoformat()))), f'items.0.{field}')
        recent = (now - timedelta(hours=23)).isoformat()
        self.assertEqual(self._post(self._batch(None, None, self._attempt(20, called_at=recent))).status_code, 200)

    def test_the_recorder_is_limited_to_a_row_ceiling_per_minute(self):
        with patch.object(ai_usage, 'SERVICE_MAX_ROWS_PER_MINUTE', 3):
            self.assertEqual(self._post(self._batch(None, None, self._attempt(30), self._attempt(31))).status_code, 200)
            refused = self._post(self._batch(None, None, self._attempt(32), self._attempt(33)))
            self.assertEqual(refused.status_code, 429, refused.text)
            self.assertEqual(refused.json()['code'], 'rate_limited')
            self.assertEqual(refused.json()['details'], {'retry_after_seconds': 60})
            self.assertEqual(self.Usage.search_count([]), 2)
            self.assertEqual(self._post(self._batch(None, None, self._attempt(34))).status_code, 200)
            # A minute later the window has moved on.
            self.env.cr.execute("UPDATE liwan_ai_usage SET create_date = create_date - interval '2 minutes'")
            self.Usage.invalidate_model()
            self.assertEqual(self._post(self._batch(None, None, self._attempt(35), self._attempt(36))).status_code, 200)

    def test_the_row_ceiling_counts_every_company_the_recorder_writes_to(self):
        """Two top-level companies share one budget: rows written into one count against the other (issue #557)."""
        second = self.env['res.company'].create({'name': 'Usage Second Top-Level Company'})
        self.assertFalse(second.parent_id or self.other_company.parent_id)
        self.employee.write({'company_ids': [Command.link(self.other_company.id), Command.link(second.id)]})
        home, other = self.employee.company_id, self.other_company
        # The per-row, per-request and age ceilings are values of the request, so they hold in a company that is not the recorder's own.
        for change, field in (({'input_tokens': SERVICE_MAX_INPUT_TOKENS + 1}, 'input_tokens'), ({'called_at': (datetime.now(timezone.utc) - timedelta(days=3)).isoformat()}, 'called_at')):
            self.assertEqual(self._post(self._batch(self.employee, second, self._attempt(39, **change))).json()['field'], f'items.0.{field}')
        full = {'input_tokens': SERVICE_MAX_INPUT_TOKENS, 'output_tokens': SERVICE_MAX_OUTPUT_TOKENS}
        self.assertEqual(self._post(self._batch(self.employee, second, *[self._attempt(index + 100, **full) for index in range(5)])).json()['field'], 'items')
        self.assertFalse(self.Usage.search([]))
        with patch.object(ai_usage, 'SERVICE_MAX_ROWS_PER_MINUTE', 4):
            self.assertEqual(self._post(self._batch(self.employee, home, self._attempt(40), self._attempt(41))).status_code, 200)
            self.assertEqual(self._post(self._batch(self.employee, other, self._attempt(42), self._attempt(43))).status_code, 200)
            for company in (home, other, second):
                with self.subTest(company=company.name):
                    refused = self._post(self._batch(self.employee, company, self._attempt(44 + company.id)))
                    self.assertEqual(refused.status_code, 429, refused.text)
                    self.assertEqual(refused.json()['code'], 'rate_limited')
            self.assertEqual(self.Usage.search_count([]), 4)

    def test_a_user_holding_every_capability_is_still_refused(self):
        """liwan_core gives vendor support (and the superuser) every capability; only the recorder itself may report."""
        support = new_test_user(self.env, login='usage_support', groups='liwan_core.group_vendor_support')
        admin = new_test_user(self.env, login='usage_admin', groups='base.group_system')
        service = self.env['liwan.access.service']
        self.assertIn(AI_USAGE_RECORD, service.with_user(support)._liwan_capability_keys(support))
        # Worst case: these users also hold the recorder's ACL group, so only the identity check stands between their key and the ledger.
        (support | admin).write({'group_ids': [Command.link(self.env.ref('liwan_ai.group_cap_ai_usage_record').id)]})
        for user in (support, admin):
            with self.subTest(user=user.login):
                response = self._post(self._batch(), key=self._key(user))
                self.assertEqual(response.status_code, 403, response.text)
                self.assertEqual(response.json()['code'], 'forbidden')
                self.assertFalse(self.Usage.search([]))
        # The superuser is inactive, and Odoo accepts an API key of an active user only.
        root = self.env.ref('base.user_root')
        self.assertFalse(root.active)
        self.assertEqual(self._post(self._batch(), key=self._key(root)).status_code, 401)

    def test_a_key_is_refused_with_404_on_every_bearer_route_the_platform_does_not_list(self):
        """The platform guard answers before it reads the key: a wrong key and the real one get the same 404.

        A wrong key is the discriminating input: without the guard Odoo's own bearer check answers it with a 401.
        """
        for path in ('/json/2/res.users/search_read', '/json/2/liwan.ai.usage/create', '/json/2/ir.config_parameter/get_param'):
            for key in (self.key, 'a' * 40):
                with self.subTest(path=path, wrong=key != self.key):
                    response = self._post_raw(path, key)
                    self.assertEqual(response.status_code, 404, response.text)
                    self.assertFalse(self.Usage.search([]))

    def test_the_service_path_matches_exactly_and_its_variants_are_404(self):
        # An encoded slash is decoded before routing and a doubled slash is redirected (308) to the exact path, so both ARE the
        # exact path by the time Odoo matches it; the Nuxt proxy and the shared guard compare the raw target and refuse them.
        for path in (USAGE_SERVICE_PATH + '/', USAGE_SERVICE_PATH.upper(), USAGE_SERVICE_PATH.replace('service', 'Service'),
                     USAGE_SERVICE_PATH + '/x', USAGE_SERVICE_PATH + '/../service', '/api/v1/ai/usage/./service',
                     '/api/v1/ai/x/../usage/service'):
            for key in (self.key, 'a' * 40):
                with self.subTest(path=path, wrong=key != self.key):
                    status, text = self._post_unnormalized(path, key)
                    self.assertEqual(status, 404, (path, text))
                    self.assertFalse(self.Usage.search([]))

    def test_the_key_means_nothing_on_the_session_routes(self):
        """These routes never read a bearer key: the key is not a password, a token or a session."""
        for path, status in (('/api/v1/ai/usage', 401), ('/api/v1/ai/audit', 401), ('/api/v1/ai/tools', 401), ('/api/v1/me', 401)):
            with self.subTest(path=path):
                response = self._post_raw(path, self.key, method='GET' if path.endswith(('tools', '/me')) else 'POST')
                self.assertEqual(response.status_code, status, (path, response.text))
                self.assertEqual(response.json()['code'], 'session_required')
        for path in ('/xmlrpc/2/object', '/xmlrpc/2/common'):
            with self.subTest(path=path):
                self.assertEqual(self._post_raw(path, self.key).status_code, 404)
        # Odoo answers a closed JSON-RPC route with HTTP 200 and an error body carrying the 404.
        closed = self._post_raw('/jsonrpc', self.key)
        self.assertEqual((closed.status_code, closed.json()['error']['code']), (200, 404))
        self.assertNotIn('result', closed.json())
        self.assertFalse(self.Usage.search([]))

    def test_bearer_authentication_is_refused_on_any_route_the_platform_does_not_list(self):
        listed = type(self.env['ir.http'])._liwan_bearer_routes()
        self.assertEqual(listed, frozenset({USAGE_SERVICE_PATH}))
        self.assertEqual(LiwanPlatformIrHttp._liwan_bearer_routes(), frozenset())

    def test_nobody_signs_in_as_the_recorder_even_with_a_password(self):
        """Base Odoo would accept this password; the override is what refuses it."""
        password = 'recorder-pass-123456'
        self.recorder.write({'password': password})
        self.employee.write({'password': password})
        as_recorder = self.env['res.users'].with_user(self.recorder)
        for credential, env in (
            ({'type': 'password', 'password': password}, {'interactive': True}),
            ({'type': 'password', 'password': password}, {'interactive': False}),
        ):
            with self.subTest(interactive=env['interactive']):
                with self.assertRaises(AccessDenied):
                    as_recorder.browse(self.recorder.id)._check_credentials(credential, env)
        # The key is not a password either, and the refusal is the recorder's alone: the same call works for an employee.
        with self.assertRaises(AccessDenied):
            as_recorder.browse(self.recorder.id)._check_credentials({'type': 'password', 'password': self.key}, {'interactive': False})
        as_employee = self.env['res.users'].with_user(self.employee)
        info = as_employee.browse(self.employee.id)._check_credentials({'type': 'password', 'password': password}, {'interactive': False})
        self.assertEqual(info['uid'], self.employee.id)
        with self.assertRaises(AccessDenied):
            self.authenticate('liwan_ai_usage', password)

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


@tagged('post_install', '-at_install', 'liwan')
class TestAiUsageServiceLock(AiProbe, LiwanApiCase):
    """The recorder's budget is spent under a row lock (issue #557). Its own class: the lock must be free when the test starts,
    and the shared fixtures above write the recorder's row (company sync), which a second connection could not then lock."""

    def setUp(self):
        super().setUp()
        self._install_probe()
        self.recorder = self.env.ref('liwan_ai.user_ai_usage')
        self.key = self.env['res.users.apikeys'].with_user(self.recorder)._generate('rpc', 'lock test', datetime.now() + timedelta(days=1))
        self.Usage = self.env['liwan.ai.usage']
        self.opener.cookies.clear()

    def _post(self, body):
        return self.url_open(USAGE_SERVICE_PATH, json=body, headers={'Content-Type': 'application/json', 'Authorization': f'bearer {self.key}'})

    def test_a_parallel_report_is_refused_while_another_holds_the_recorder_lock(self):
        """Admission and insertion are serialized per recorder, so parallel requests cannot each spend the same budget."""
        cursor = db_connect(self.env.cr.dbname).cursor()
        try:
            other = api.Environment(cursor, SUPERUSER_ID, {})
            # A second real connection plays the request that is mid-flight: it holds the recorder's row until it ends.
            other['res.users'].browse(self.recorder.id).lock_for_update(allow_referencing=True)
            refused = self._post({'user_id': self.employee.id, 'user_company_id': self.employee.company_id.id, 'items': [dict(ITEM, call_id=f'{60:016x}')]})
            self.assertEqual(refused.status_code, 429, refused.text)
            self.assertEqual((refused.json()['code'], refused.json()['details']), ('rate_limited', {'retry_after_seconds': 1}))
            self.assertFalse(self.Usage.search([]))
            # Ordinary users are not held up by it: the recorder's lock is on the recorder's row alone.
            self.env['res.users'].browse(self.employee.id).lock_for_update()
        finally:
            cursor.rollback()
            cursor.close()
        self.assertEqual(self._post({'user_id': self.employee.id, 'user_company_id': self.employee.company_id.id, 'items': [dict(ITEM, call_id=f'{60:016x}')]}).status_code, 200)
