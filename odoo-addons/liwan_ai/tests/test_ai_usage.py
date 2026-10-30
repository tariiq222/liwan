# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import datetime, timedelta, timezone

from odoo.exceptions import AccessError
from odoo.fields import Command
from odoo.tests import new_test_user, tagged

from odoo.addons.liwan_ai.tests.common import AiProbe
from odoo.addons.liwan_api.tests.common import LiwanApiCase
from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT

ITEM = {
    'conversation_id': 'r_test_01', 'kind': 'plan', 'provider': 'acme-ai', 'model': 'acme-large-1',
    'outcome': 'ok', 'input_tokens': 120, 'output_tokens': 45, 'called_at': '2026-10-27T09:30:00+03:00',
}
MESSAGE = {
    'conversation_id': 'r_test_01', 'kind': 'message', 'tool_name': None, 'input': None,
    'result': 'ok', 'http_status': None, 'draft': None, 'approved': None, 'attested': False,
}


@tagged('post_install', '-at_install', 'liwan')
class TestAiUsage(AiProbe, LiwanApiCase):

    def setUp(self):
        super().setUp()
        self._install_probe()
        self._grant_ai_use(self.employee)
        self.other = new_test_user(
            self.env, login='ai_usage_other', password='ai_usage_other_pass_123', name='Omar',
            groups='liwan_core.group_employee,liwan_ai.group_cap_ai_use',
        )
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.Usage = self.env['liwan.ai.usage']

    def _set_feature(self, key, value):
        profile = self.env.ref('liwan_platform.tenant_profile')
        profile.sudo().with_context(**{OPERATOR_CONTEXT: True}).write({
            'features': {**(profile.features or {}), key: value},
        })

    def _post(self, *items):
        return self.api('POST', '/api/v1/ai/usage', {'items': list(items)})

    def _assert_422(self, response, field, code=None):
        self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(response.json()['field'], field)
        if code:
            self.assertEqual(response.json()['code'], code)
        self.assertFalse(self.Usage.search([]))

    def test_batch_is_recorded_as_the_caller_with_the_exact_response_shape(self):
        second = {**ITEM, 'kind': 'title', 'outcome': 'retried', 'called_at': '2026-10-27T06:31:00Z'}
        response = self._post(ITEM, second)
        self.assertEqual(response.status_code, 200)
        body = response.json()
        first_id, second_id = (item['id'] for item in body['items'])
        self.assertEqual(body, {
            'items': [
                {**ITEM, 'id': first_id, 'called_at': '2026-10-27T06:30:00Z'},
                {**second, 'id': second_id, 'called_at': '2026-10-27T06:31:00Z'},
            ],
            'total': 2,
        })
        rows = self.Usage.browse([first_id, second_id])
        self.assertEqual(rows.user_id, self.employee)
        self.assertEqual(rows.company_id, self.employee.company_id)
        self.assertEqual(rows[0].tokens_reported, True)
        self.assertEqual(rows[0].called_at, datetime(2026, 10, 27, 6, 30))

    def test_null_tokens_are_not_reported(self):
        body = self._post({**ITEM, 'input_tokens': None, 'output_tokens': None}).json()
        self.assertEqual((body['items'][0]['input_tokens'], body['items'][0]['output_tokens']), (None, None))
        row = self.Usage.browse(body['items'][0]['id'])
        self.assertEqual((row.tokens_reported, row.input_tokens, row.output_tokens), (False, 0, 0))

    def test_zero_tokens_are_reported(self):
        body = self._post({**ITEM, 'input_tokens': 0, 'output_tokens': 0}).json()
        self.assertEqual((body['items'][0]['input_tokens'], body['items'][0]['output_tokens']), (0, 0))
        self.assertTrue(self.Usage.browse(body['items'][0]['id']).tokens_reported)

    def test_invalid_items_are_422_and_write_nothing(self):
        future = (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat()
        cases = (
            ({'extra': 1}, 'extra', 'unknown_field'),
            ({'kind': 'message'}, 'kind', None),
            ({'kind': ['plan']}, 'kind', None),
            ({'outcome': 'maybe'}, 'outcome', None),
            ({'provider': 'Acme'}, 'provider', None),
            ({'provider': ''}, 'provider', None),
            ({'provider': 'a' * 33}, 'provider', None),
            ({'provider': 'acme\n'}, 'provider', None),
            ({'model': ''}, 'model', None),
            ({'model': 'x' * 129}, 'model', None),
            ({'model': 'bad\x07model'}, 'model', None),
            ({'model': 'bad\x00model'}, 'model', None),
            ({'input_tokens': None}, 'input_tokens', None),
            ({'output_tokens': None}, 'output_tokens', None),
            ({'input_tokens': True}, 'input_tokens', None),
            ({'input_tokens': 1.5}, 'input_tokens', None),
            ({'output_tokens': 2.0}, 'output_tokens', None),
            ({'input_tokens': -1}, 'input_tokens', None),
            ({'output_tokens': 100_000_001}, 'output_tokens', None),
            ({'input_tokens': '5'}, 'input_tokens', None),
            ({'conversation_id': 'a' * 65}, 'conversation_id', None),
            ({'conversation_id': ''}, 'conversation_id', None),
            ({'conversation_id': 'a\x00b'}, 'conversation_id', None),
            ({'conversation_id': 7}, 'conversation_id', None),
            ({'called_at': future}, 'called_at', None),
            ({'called_at': '2026-10-27T09:30:00'}, 'called_at', None),
            ({'called_at': 'yesterday'}, 'called_at', None),
            ({'called_at': 1_790_000_000}, 'called_at', None),
            ({'called_at': '20261027T093000+0300'}, 'called_at', None),
            ({'called_at': '2026-W44-2T09:30+03'}, 'called_at', None),
            ({'called_at': '2026-10-27T09:30:00,5+03:00'}, 'called_at', None),
            ({'called_at': '2026-10-27T09:30:00+03:00:30'}, 'called_at', None),
            ({'called_at': '2026-10-27 09:30:00+03:00'}, 'called_at', None),
            ({'called_at': '0001-01-01T00:00:00+14:00'}, 'called_at', None),
            ({'called_at': '9999-12-31T23:59:59-01:00'}, 'called_at', None),
            ({'called_at': '2026-02-30T00:00:00Z'}, 'called_at', None),
        )
        for change, field, code in cases:
            with self.subTest(change=change):
                self._assert_422(self._post({**ITEM, **change}), f'items.0.{field}', code)

    def test_a_missing_key_is_422(self):
        item = {key: value for key, value in ITEM.items() if key != 'model'}
        self._assert_422(self._post(item), 'items.0.model')

    def test_item_count_and_shape(self):
        self._assert_422(self._post(), 'items')
        self._assert_422(self._post(*[ITEM] * 65), 'items')
        self._assert_422(self.api('POST', '/api/v1/ai/usage', {}), 'items')
        self._assert_422(self.api('POST', '/api/v1/ai/usage', {'items': ITEM}), 'items')
        self._assert_422(self._post(ITEM, 'x'), 'items.1')
        self._assert_422(self.api('POST', '/api/v1/ai/usage', {'items': [ITEM], 'extra': 1}), 'extra', 'unknown_field')
        self.assertEqual(len(self._post(*[ITEM] * 64).json()['items']), 64)

    def test_one_bad_item_rejects_the_whole_batch(self):
        self._assert_422(self._post(ITEM, ITEM, {**ITEM, 'outcome': 'nope'}), 'items.2.outcome')

    def test_usage_is_recorded_when_the_message_limit_is_reached(self):
        self.assertEqual(self.api('POST', '/api/v1/ai/audit', MESSAGE).json()['messages_used'], 1)
        self._set_feature('ai.messages.monthly', 1)
        self.assertEqual(self.api('POST', '/api/v1/ai/audit', MESSAGE).status_code, 403)
        self.assertEqual(self._post(ITEM).status_code, 200)
        self.assertEqual(self.api('GET', '/api/v1/ai/tools').json()['limits']['messages_used'], 1)
        self.assertEqual(self.env['liwan.ai.audit']._liwan_ai_count_messages(), 1)
        self.assertEqual(self.Usage.search_count([]), 1)

    def test_ai_disabled_is_403_and_writes_nothing(self):
        self._set_feature('ai.enabled', False)
        response = self._post(ITEM)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()['details'], {'reason': 'feature', 'feature': 'ai.enabled'})
        self.assertFalse(self.Usage.search([]))

    def test_route_without_the_ai_use_capability_is_403(self):
        self.employee.write({'group_ids': [Command.unlink(self.env.ref('liwan_ai.group_cap_ai_use').id)]})
        self.assertEqual(self._post(ITEM).status_code, 403)
        self.assertFalse(self.Usage.search([]))

    def test_direct_create_obeys_the_same_gates(self):
        self._set_feature('ai.enabled', False)
        with self.assertRaises(Exception) as caught:
            self.Usage.with_user(self.employee).create(ITEM)
        self.assertEqual(getattr(caught.exception, 'code', None), 'feature_not_included')
        self._set_feature('ai.enabled', True)
        self.employee.write({'group_ids': [Command.unlink(self.env.ref('liwan_ai.group_cap_ai_use').id)]})
        with self.assertRaises(AccessError):
            self.Usage.with_user(self.employee).create(ITEM)
        self.assertFalse(self.Usage.search([]))

    def test_direct_create_rejects_forged_owner_and_derives_it(self):
        usage = self.Usage.with_user(self.employee)
        for change, field in (
            ({'user_id': self.other.id}, 'user_id'),
            ({'company_id': self.env.company.id}, 'company_id'),
            ({'tokens_reported': True}, 'tokens_reported'),
        ):
            with self.assertRaises(Exception, msg=change) as caught:
                usage.create({**ITEM, **change})
            self.assertEqual(caught.exception.liwan_field, field)
        row = usage.create(ITEM)
        self.assertEqual((row.user_id, row.company_id), (self.employee, self.employee.company_id))

    def test_users_see_only_their_own_rows(self):
        self._post(ITEM)
        self.assertEqual(len(self.Usage.with_user(self.employee).search([])), 1)
        self.assertFalse(self.Usage.with_user(self.other).search([]))

    def test_an_audit_reader_sees_the_company_rows(self):
        self._post(ITEM)
        reader = new_test_user(
            self.env, login='ai_usage_reader', password='ai_usage_reader_pass_123', name='Rana',
            groups='liwan_core.group_employee,liwan_core.group_cap_access_audit_read',
        )
        rows = self.Usage.with_user(reader).search([])
        self.assertEqual(rows.user_id, self.employee)

    def test_another_company_is_hidden(self):
        company = self.env['res.company'].create({'name': 'AI usage other company'})
        outsider = new_test_user(
            self.env, login='ai_usage_company_b', password='ai_usage_company_b_pass_123', name='Bader',
            groups='liwan_core.group_employee,liwan_ai.group_cap_ai_use,liwan_core.group_cap_access_audit_read',
            company_id=company.id, company_ids=[Command.set(company.ids)],
        )
        self._post(ITEM)
        self.assertFalse(self.Usage.with_user(outsider).with_company(company).search([]))
        mine = self.Usage.with_user(outsider).with_company(company).create(ITEM)
        self.assertEqual(self.Usage.with_user(outsider).with_company(company).search([]), mine)
        self.assertNotIn(mine, self.Usage.with_user(self.employee).search([]))

    def test_rows_cannot_be_written_or_deleted(self):
        row = self.Usage.browse(self._post(ITEM).json()['items'][0]['id'])
        with self.assertRaises(AccessError):
            row.with_user(self.employee).write({'model': 'other'})
        with self.assertRaises(AccessError):
            row.with_user(self.employee).unlink()
        self.assertEqual(row.model, 'acme-large-1')
