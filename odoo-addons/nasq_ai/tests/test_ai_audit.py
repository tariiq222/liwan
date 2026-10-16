# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import AccessError, ValidationError
from odoo.tests import new_test_user, tagged

from odoo.addons.nasq_ai.tests.common import CREATE_CAP, READ_CAP, WRITE_CAP, AiProbe
from odoo.addons.nasq_api.tests.common import NasqApiCase, set_probe_feature
from odoo.addons.nasq_platform.models.entitlement_service import OPERATOR_CONTEXT

MESSAGE = {
    'conversation_id': 'r_test_01', 'kind': 'message', 'tool_name': None, 'input': None,
    'result': 'ok', 'http_status': None, 'draft': None, 'approved': None, 'attested': False,
}
READ = {
    'conversation_id': 'r_test_01', 'kind': 'read', 'tool_name': 'probe.list_things',
    'input': {'limit': 5, 'token': 'secret'}, 'result': 'ok', 'http_status': 200,
    'draft': None, 'approved': None, 'attested': False,
}
DRAFT = {
    'conversation_id': 'r_test_01', 'kind': 'draft', 'tool_name': 'probe.draft_thing',
    'input': {'name': 'A'}, 'result': 'proposed', 'http_status': None,
    'draft': {'name': 'A'}, 'approved': None, 'attested': False,
}


@tagged('post_install', '-at_install', 'nasq')
class TestAiAudit(AiProbe, NasqApiCase):

    def setUp(self):
        super().setUp()
        self._install_probe()
        self.granted = {READ_CAP}
        self.other = new_test_user(
            self.env, login='ai_other', password='ai_other_pass_123', name='Omar',
            groups='nasq_core.group_employee',
        )
        self.authenticate('api_emp', 'api_emp_pass_123')

    def _set_feature(self, key, value):
        profile = self.env.ref('nasq_platform.tenant_profile')
        profile.sudo().with_context(**{OPERATOR_CONTEXT: True}).write({
            'features': {**(profile.features or {}), key: value},
        })

    def test_message_audit_counts_against_the_monthly_limit(self):
        first = self.api('POST', '/api/v1/ai/audit', MESSAGE)
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.json()['messages_used'], 1)
        self.assertIsNone(first.json()['messages_limit'])
        self._set_feature('ai.messages.monthly', 1)
        blocked = self.api('POST', '/api/v1/ai/audit', MESSAGE)
        self.assertEqual(blocked.status_code, 403)
        self.assertEqual(blocked.json()['details'], {'reason': 'limit', 'limit_key': 'ai.messages.monthly'})
        self.assertEqual(self.env['nasq.ai.audit'].search_count([('kind', '=', 'message')]), 1)
        tools = self.api('GET', '/api/v1/ai/tools').json()
        self.assertEqual(tools['limits']['messages_used'], 1)

    def test_tool_audit_stores_a_scrubbed_input_as_the_user(self):
        body = self.api('POST', '/api/v1/ai/audit', READ).json()
        row = self.env['nasq.ai.audit'].browse(body['id'])
        self.assertEqual(row.user_id, self.employee)
        self.assertEqual(row.company_id, self.employee.company_id)
        self.assertEqual(row.input, {'limit': 5})
        self.assertEqual((row.kind, row.tool_name, row.result, row.http_status), ('read', 'probe.list_things', 'ok', 200))

    def test_unknown_tool_or_kind_or_result_is_422(self):
        for change, field in (
            ({'tool_name': 'probe.nope'}, 'tool_name'),
            ({'kind': 'delete'}, 'kind'),
            ({'result': 'maybe'}, 'result'),
            ({'tool_name': None}, 'tool_name'),
        ):
            response = self.api('POST', '/api/v1/ai/audit', {**READ, **change})
            self.assertEqual(response.status_code, 422, change)
            self.assertEqual(response.json()['field'], field, change)

    def test_message_kind_rejects_a_tool_name(self):
        response = self.api('POST', '/api/v1/ai/audit', {**MESSAGE, 'tool_name': 'probe.list_things'})
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()['field'], 'tool_name')

    def test_draft_lifecycle_requires_attestation_to_approve(self):
        self.granted = {READ_CAP, CREATE_CAP}
        proposed = self.api('POST', '/api/v1/ai/audit', DRAFT)
        self.assertEqual(proposed.status_code, 200)
        unattested = self.api('POST', '/api/v1/ai/audit', {**DRAFT, 'result': 'approved', 'approved': {'name': 'A2'}})
        self.assertEqual(unattested.status_code, 422)
        self.assertEqual(unattested.json()['field'], 'attested')
        approved = self.api('POST', '/api/v1/ai/audit', {**DRAFT, 'result': 'approved', 'approved': {'name': 'A2'}, 'attested': True})
        self.assertEqual(approved.status_code, 200)
        row = self.env['nasq.ai.audit'].browse(approved.json()['id'])
        self.assertTrue(row.attested_at)
        self.assertEqual((row.draft, row.approved), ({'name': 'A'}, {'name': 'A2'}))

    def test_approved_result_is_only_valid_for_drafts(self):
        response = self.api('POST', '/api/v1/ai/audit', {**READ, 'result': 'approved', 'attested': True})
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()['field'], 'result')

    def test_users_see_only_their_own_rows(self):
        self.api('POST', '/api/v1/ai/audit', READ)
        mine = self.env['nasq.ai.audit'].with_user(self.employee).search([])
        theirs = self.env['nasq.ai.audit'].with_user(self.other).search([])
        self.assertEqual(len(mine), 1)
        self.assertFalse(theirs)

    def test_ai_disabled_blocks_writes(self):
        self._set_feature('ai.enabled', False)
        response = self.api('POST', '/api/v1/ai/audit', MESSAGE)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()['details'], {'reason': 'feature', 'feature': 'ai.enabled'})
        self.assertFalse(self.env['nasq.ai.audit'].search([]))


@tagged('post_install', '-at_install', 'nasq')
class TestAiAuditHardening(AiProbe, NasqApiCase):
    """Findings: company-wide message limit, lock order, types, scrubbing, single choke point."""

    def setUp(self):
        super().setUp()
        self._install_probe()
        self.granted = {READ_CAP, WRITE_CAP, CREATE_CAP}
        self.other = new_test_user(
            self.env, login='ai_other2', password='ai_other_pass_123', name='Omar',
            groups='nasq_core.group_employee',
        )
        self.audit_a = self.env['nasq.ai.audit'].with_user(self.employee)
        self.audit_b = self.env['nasq.ai.audit'].with_user(self.other)
        self.authenticate('api_emp', 'api_emp_pass_123')

    def _set_feature(self, key, value):
        profile = self.env.ref('nasq_platform.tenant_profile')
        profile.sudo().with_context(**{OPERATOR_CONTEXT: True}).write({
            'features': {**(profile.features or {}), key: value},
        })

    def _post(self, **change):
        return self.api('POST', '/api/v1/ai/audit', {**READ, **change})

    def _assert_422(self, response, field):
        self.assertEqual(response.status_code, 422, response.content)
        self.assertEqual(response.json()['field'], field)

    # 1. company-wide message count without sudo
    def test_message_count_is_company_wide_for_plain_employees(self):
        for _ in range(3):
            self.audit_a.create(MESSAGE)
        self.assertEqual(self.audit_b._nasq_ai_count_messages(), 3)
        self._set_feature('ai.messages.monthly', 3)
        with self.assertRaises(Exception) as caught:
            self.audit_b.create(MESSAGE)
        self.assertEqual(getattr(caught.exception, 'details', None), {'reason': 'limit', 'limit_key': 'ai.messages.monthly'})

    def test_other_users_cannot_read_tool_or_draft_rows(self):
        self.audit_a.create(MESSAGE)
        self.audit_a.create(READ)
        self.audit_a.create({**DRAFT, 'result': 'approved', 'approved': {'name': 'A'}, 'attested': True})
        visible = self.audit_b.search([])
        self.assertEqual(visible.mapped('kind'), ['message'])
        self.assertFalse(visible.tool_name)
        self.assertFalse(self.audit_b.search([('kind', '!=', 'message')]))

    def test_a_message_row_stores_no_tool_data(self):
        for change, field in (
            ({'tool_name': 'probe.list_things'}, 'tool_name'),
            ({'input': {'a': 1}}, 'input'),
            ({'draft': {'a': 1}}, 'draft'),
            ({'approved': {'a': 1}}, 'approved'),
            ({'http_status': 200}, 'http_status'),
            ({'attested': True}, 'attested'),
        ):
            with self.assertRaises(ValidationError, msg=change) as caught:
                self.audit_a.create({**MESSAGE, **change})
            self.assertEqual(caught.exception.nasq_field, field)
        self.assertFalse(self.env['nasq.ai.audit'].search([]))

    # 2. lock before count
    def test_profile_lock_is_taken_before_the_count(self):
        calls = []
        profile_model = type(self.env['nasq.tenant.profile'])
        audit_model = type(self.env['nasq.ai.audit'])
        lock = profile_model._nasq_lock
        count = audit_model._nasq_ai_count_messages

        def spy_lock(model):
            calls.append('lock')
            return lock(model)

        def spy_count(model, company=None):
            calls.append('count')
            return count(model, company)

        self.patch(profile_model, '_nasq_lock', spy_lock)
        self.patch(audit_model, '_nasq_ai_count_messages', spy_count)
        self.audit_a.create(MESSAGE)
        self.assertIn('lock', calls)
        self.assertLess(calls.index('lock'), calls.index('count'))

    # 3. types
    def test_non_string_values_are_422_never_500(self):
        for change, field in (
            ({'tool_name': ['probe.list_things']}, 'tool_name'),
            ({'tool_name': {'a': 1}}, 'tool_name'),
            ({'tool_name': 5}, 'tool_name'),
            ({'conversation_id': ['x']}, 'conversation_id'),
            ({'conversation_id': 7}, 'conversation_id'),
            ({'kind': ['read']}, 'kind'),
            ({'kind': {'a': 1}}, 'kind'),
            ({'kind': 3}, 'kind'),
            ({'result': ['ok']}, 'result'),
            ({'result': {'a': 1}}, 'result'),
            ({'result': 1}, 'result'),
        ):
            self._assert_422(self._post(**change), field)

    # 4. scrubbing and limits
    def test_secret_looking_keys_are_dropped_at_any_depth(self):
        secrets = {
            'Password': 1, 'access_token': 1, 'refresh_token': 1, 'api-key': 1, 'apiKey': 1,
            'client_secret': 1, 'new_password': 1, 'Authorization': 1, 'db_passwd': 1,
            'user_credentials': 1, 'key': 1,
        }
        row = self.audit_a.create({**READ, 'input': {'limit': 5, **secrets, 'nested': [{'x_token': 1, 'ok': 2}]}})
        self.assertEqual(row.input, {'limit': 5, 'nested': [{'ok': 2}]})

    def test_deep_nesting_is_422_not_500(self):
        deep = current = {}
        for _ in range(1000):
            current['a'] = {}
            current = current['a']
        with self.assertRaises(ValidationError) as caught:
            self.audit_a.create({**READ, 'input': deep})
        self.assertEqual(caught.exception.nasq_field, 'input')
        self._assert_422(self._post(input=deep), 'input')
        self.audit_a.create({**READ, 'input': {'a': {'a': {'a': {'a': {'a': {'a': {'a': 1}}}}}}}})

    def test_a_json_field_over_32_kb_is_422(self):
        big = {'text': 'x' * (40 * 1024)}
        self._assert_422(self._post(input=big), 'input')
        self._assert_422(self.api('POST', '/api/v1/ai/audit', {**DRAFT, 'draft': big}), 'draft')
        self.assertEqual(self._post(input={'text': 'x' * 1024}).status_code, 200)

    # 5. single choke point
    def test_route_without_the_tool_capability_is_403_and_writes_nothing(self):
        self.granted = set()
        response = self.api('POST', '/api/v1/ai/audit', {**READ, 'kind': 'write_light', 'tool_name': 'probe.rename_thing'})
        self.assertEqual(response.status_code, 403)
        self.assertFalse(self.env['nasq.ai.audit'].search([]))

    def test_direct_create_enforces_capability_and_feature(self):
        self.granted = set()
        with self.assertRaises(AccessError):
            self.audit_a.create(READ)
        self.granted = {READ_CAP}
        set_probe_feature(self, enabled=False)
        with self.assertRaises(AccessError):
            self.audit_a.create(READ)
        self.assertFalse(self.env['nasq.ai.audit'].search([]))

    def test_direct_create_rejects_forged_or_undocumented_values(self):
        for change, field in (
            ({'user_id': self.other.id}, 'user_id'),
            ({'company_id': self.env.company.id}, 'company_id'),
            ({'attested_at': '2020-01-01 00:00:00'}, 'attested_at'),
            ({'create_date': '2020-01-01 00:00:00'}, 'create_date'),
            ({'result': 'approved', 'kind': 'draft', 'tool_name': 'probe.draft_thing', 'approved': {'a': 1}}, 'attested'),
        ):
            with self.assertRaises(ValidationError, msg=change) as caught:
                self.audit_a.create({**(DRAFT if 'kind' in change else READ), **change})
            self.assertEqual(caught.exception.nasq_field, field)
        self.assertFalse(self.env['nasq.ai.audit'].search([]))

    def test_direct_create_derives_owner_and_attestation(self):
        row = self.audit_a.create({**DRAFT, 'result': 'approved', 'approved': {'name': 'B'}, 'attested': True})
        self.assertEqual((row.user_id, row.company_id), (self.employee, self.employee.company_id))
        self.assertTrue(row.attested_at)
        plain = self.audit_a.create(DRAFT)
        self.assertFalse(plain.attested_at)

    def test_direct_create_obeys_the_ai_feature_gate(self):
        self._set_feature('ai.enabled', False)
        with self.assertRaises(Exception) as caught:
            self.env['nasq.ai.audit'].with_user(self.employee).create({**MESSAGE})
        self.assertEqual(getattr(caught.exception, 'code', None), 'feature_not_included')
        self.assertFalse(self.env['nasq.ai.audit'].search([]))
