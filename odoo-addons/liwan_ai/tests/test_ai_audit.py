# Part of Odoo. See LICENSE file for full copyright and licensing details.
import math
from datetime import timedelta

from odoo import fields
from odoo.exceptions import AccessError, ValidationError
from odoo.fields import Command
from odoo.tests import new_test_user, tagged

from odoo.addons.liwan_ai.tests.common import (
    CREATE_CAP,
    PROBE_TOOLS,
    READ_CAP,
    WRITE_CAP,
    AiProbe,
)
from odoo.addons.liwan_api.tests.common import (
    LiwanApiCase,
    set_probe_feature,
)
from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT

MESSAGE = {
    'conversation_id': 'r_test_01', 'kind': 'message', 'tool_name': None, 'input': None,
    'result': 'ok', 'http_status': None, 'draft': None, 'approved': None,
}
READ = {
    'conversation_id': 'r_test_01', 'kind': 'read', 'agent': 'probe', 'tool_name': 'probe.list_things',
    'input': {'limit': 5, 'token': 'secret'}, 'result': 'ok', 'http_status': 200,
    'draft': None, 'approved': None,
}
DRAFT = {
    'conversation_id': 'r_test_01', 'kind': 'draft', 'agent': 'probe', 'tool_name': 'probe.draft_thing',
    'input': {'name': 'A'}, 'result': 'proposed', 'http_status': None,
    'draft': {'name': 'A'}, 'approved': None,
}


def approved_record(env):
    """A record of the model the probe draft creates (its `draft_model`), so an approval can name a real one."""
    return env['res.partner'].create({'name': 'Approved record'})


def stamp_creator(env, record, user, created_at=None):
    """Make `record` a record that `user` created at `created_at` (naive UTC, default now).

    The ORM refuses to write its access-log columns, so this is plain SQL on the record's own table — the same way the
    other addons' tests rewrite `create_date` — after flushing the pending create, then a cache clear so the model reads
    the new values.
    """
    env.flush_all()
    # Backdating a log-access column is not writable through the ORM (write() discards create_uid/create_date), so plain
    # SQL on the record's own table is the only way, as liwan_crm/tests/test_crm_dashboard.py and
    # liwan_finance/tests/test_finance_audit.py already do for create_date; test-only, never product code.
    env.cr.execute(
        f'UPDATE {record._table} SET create_uid = %s, create_date = %s WHERE id = %s',
        [user.id, created_at or fields.Datetime.now(), record.id],
    )
    env.invalidate_all()
    return record


def caller_record(env, user, created_at=None):
    """A record of the probe draft's model (`res.partner`) that `user` created, by default now."""
    return stamp_creator(env, approved_record(env), user, created_at)


@tagged('post_install', '-at_install', 'liwan')
class TestAiAudit(AiProbe, LiwanApiCase):

    def setUp(self):
        super().setUp()
        self._install_probe()
        self._grant_ai_use(self.employee)
        self.granted = {READ_CAP}
        self.other = new_test_user(
            self.env, login='ai_other', password='ai_other_pass_123', name='Omar',
            groups='liwan_core.group_employee,liwan_ai.group_cap_ai_use',
        )
        self.authenticate('api_emp', 'api_emp_pass_123')
        # The create page makes the record as the user, after the draft was proposed: creator and time must say so.
        self.record = caller_record(self.env, self.employee)

    def _set_feature(self, key, value):
        profile = self.env.ref('liwan_platform.tenant_profile')
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
        self.assertEqual(self.env['liwan.ai.audit'].search_count([('kind', '=', 'message')]), 1)
        tools = self.api('GET', '/api/v1/ai/tools').json()
        self.assertEqual(tools['limits']['messages_used'], 1)

    def test_a_tool_whose_feature_is_off_is_refused_by_the_route_gate(self):
        set_probe_feature(self, enabled=False)
        response = self.api('POST', '/api/v1/ai/audit', READ)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()['code'], 'feature_not_included')
        self.assertFalse(self.env['liwan.ai.audit'].search([('kind', '=', 'read')]))

    def test_tool_audit_stores_a_scrubbed_input_as_the_user(self):
        body = self.api('POST', '/api/v1/ai/audit', READ).json()
        row = self.env['liwan.ai.audit'].browse(body['id'])
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

    def test_the_server_stamps_the_acknowledgement_of_an_approved_draft(self):
        """Issue #556: the acknowledgement is not a field the caller asserts; an approved row carries it by construction."""
        self.granted = {READ_CAP, CREATE_CAP}
        proposed = self.api('POST', '/api/v1/ai/audit', DRAFT)
        self.assertEqual(proposed.status_code, 200)
        proposal = self.env['liwan.ai.audit'].browse(proposed.json()['id'])
        self.assertFalse(proposal.attested_at)
        # The create page makes this record after the draft it belongs to; the fixture predates it, so pin it.
        stamp_creator(self.env, self.record, self.employee, proposal.create_date)
        approved = self.api('POST', '/api/v1/ai/audit', {**DRAFT, 'result': 'approved', 'approved': {'id': self.record.id}})
        self.assertEqual(approved.status_code, 200, approved.text)
        row = self.env['liwan.ai.audit'].browse(approved.json()['id'])
        self.assertTrue(row.attested_at)
        self.assertEqual((row.draft, row.approved), ({'name': 'A'}, {'id': self.record.id}))

    def test_an_approval_must_name_a_record_the_caller_may_read(self):
        """Issue #556: the audit verifies the approved id, so a forged one is refused instead of recorded."""
        self.granted = {READ_CAP, CREATE_CAP}
        foreign = self.env['res.company'].create({'name': 'AI other company'})
        refused = (
            {'id': 999_999_999},
            {'id': 0},
            {'id': -3},
            {'id': True},
            {'id': '1'},
            {'id': 1.5},
            {},
        )
        for approved in refused:
            response = self.api('POST', '/api/v1/ai/audit', {**DRAFT, 'result': 'approved', 'approved': approved})
            self.assertEqual(response.status_code, 422, approved)
            self.assertEqual(response.json()['field'], 'approved', approved)
        self.assertFalse(self.env['liwan.ai.audit'].search([]))
        # A record of another company is named but is not this session's: it is not readable here either.
        theirs = self.env['res.partner'].create({'name': 'Theirs', 'company_id': foreign.id})
        elsewhere = self.api('POST', '/api/v1/ai/audit', {**DRAFT, 'result': 'approved', 'approved': {'id': theirs.id}})
        self.assertEqual(elsewhere.status_code, 422)
        self.assertEqual(elsewhere.json()['field'], 'approved')
        self.assertFalse(self.env['liwan.ai.audit'].search([]))
        # The caller's own readable record is the one an approval covers.
        accepted = self.api('POST', '/api/v1/ai/audit', {**DRAFT, 'result': 'approved', 'approved': {'id': self.record.id}})
        self.assertEqual(accepted.status_code, 200)
        self.assertEqual(self.env['liwan.ai.audit'].browse(accepted.json()['id']).approved, {'id': self.record.id})

    def test_an_approval_refuses_a_record_another_user_created(self):
        """Issue #556: naming a colleague's record proves nothing, even when it is readable and in this company."""
        self.granted = {READ_CAP, CREATE_CAP}
        theirs = stamp_creator(self.env, approved_record(self.env), self.other)
        # The refusal must be about the creator: the caller can read this record, and its company is theirs too.
        self.assertTrue(self.env['res.partner'].with_user(self.employee).search([('id', '=', theirs.id)]))
        refused = self.api('POST', '/api/v1/ai/audit', {**DRAFT, 'result': 'approved', 'approved': {'id': theirs.id}})
        self.assertEqual(refused.status_code, 422)
        self.assertEqual(refused.json()['field'], 'approved')
        self.assertEqual(refused.json()['code'], 'not_found')
        self.assertFalse(self.env['liwan.ai.audit'].search([]))

    def test_an_approval_refuses_a_record_older_than_the_proposal(self):
        """Issue #556: an old record of the caller is not what this draft created, so it cannot be approved."""
        self.granted = {READ_CAP, CREATE_CAP}
        proposed = self.api('POST', '/api/v1/ai/audit', DRAFT)
        self.assertEqual(proposed.status_code, 200)
        proposed_at = self.env['liwan.ai.audit'].browse(proposed.json()['id']).create_date
        stamp_creator(self.env, self.record, self.employee, proposed_at - timedelta(minutes=1))
        refused = self.api('POST', '/api/v1/ai/audit', {**DRAFT, 'result': 'approved', 'approved': {'id': self.record.id}})
        self.assertEqual(refused.status_code, 422)
        self.assertEqual(refused.json()['field'], 'approved')
        self.assertEqual(refused.json()['code'], 'not_found')
        self.assertEqual(self.env['liwan.ai.audit'].search_count([]), 1)

    def test_an_approval_accepts_the_callers_record_created_after_the_proposal(self):
        """Issue #556: the real flow — the proposal row, then the create page's record — is the one an approval covers."""
        self.granted = {READ_CAP, CREATE_CAP}
        proposed = self.api('POST', '/api/v1/ai/audit', DRAFT)
        self.assertEqual(proposed.status_code, 200)
        # The create page makes the record as the user once the draft is proposed; the boundary is inclusive.
        proposed_at = self.env['liwan.ai.audit'].browse(proposed.json()['id']).create_date
        stamp_creator(self.env, self.record, self.employee, proposed_at)
        approved = self.api('POST', '/api/v1/ai/audit', {**DRAFT, 'result': 'approved', 'approved': {'id': self.record.id}})
        self.assertEqual(approved.status_code, 200, approved.text)
        self.assertTrue(self.env['liwan.ai.audit'].browse(approved.json()['id']).attested_at)

    def test_an_approval_without_a_recorded_proposal_uses_a_bounded_window(self):
        """No proposal row (its audit write failed, or a direct ORM create): only the last 24 hours are trusted."""
        self.granted = {READ_CAP, CREATE_CAP}
        stale = caller_record(self.env, self.employee, fields.Datetime.now() - timedelta(hours=25))
        refused = self.api('POST', '/api/v1/ai/audit', {**DRAFT, 'result': 'approved', 'approved': {'id': stale.id}})
        self.assertEqual(refused.status_code, 422)
        self.assertEqual(refused.json()['field'], 'approved')
        self.assertFalse(self.env['liwan.ai.audit'].search([]))
        stamp_creator(self.env, self.record, self.employee, fields.Datetime.now() - timedelta(hours=1))
        accepted = self.api('POST', '/api/v1/ai/audit', {**DRAFT, 'result': 'approved', 'approved': {'id': self.record.id}})
        self.assertEqual(accepted.status_code, 200, accepted.text)

    def test_the_wire_carries_no_attestation_flag(self):
        """Issue #556: a caller cannot assert an acknowledgement the server did not make, by any field name."""
        self.granted = {READ_CAP, CREATE_CAP}
        for change in ({'attested': True}, {'attested': False}, {'attested_at': '2020-01-01 00:00:00'}):
            response = self.api('POST', '/api/v1/ai/audit', {**DRAFT, **change})
            self.assertEqual(response.status_code, 422, change)
            self.assertEqual(response.json()['field'], next(iter(change)))
            self.assertEqual(response.json()['code'], 'unknown_field')
        self.assertFalse(self.env['liwan.ai.audit'].search([]))

    def test_approved_result_is_only_valid_for_drafts(self):
        response = self.api('POST', '/api/v1/ai/audit', {**READ, 'result': 'approved'})
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()['field'], 'result')

    def test_users_see_only_their_own_rows(self):
        self.api('POST', '/api/v1/ai/audit', READ)
        mine = self.env['liwan.ai.audit'].with_user(self.employee).search([])
        theirs = self.env['liwan.ai.audit'].with_user(self.other).search([])
        self.assertEqual(len(mine), 1)
        self.assertFalse(theirs)

    def test_ai_disabled_blocks_writes(self):
        self._set_feature('ai.enabled', False)
        response = self.api('POST', '/api/v1/ai/audit', MESSAGE)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()['details'], {'reason': 'feature', 'feature': 'ai.enabled'})
        self.assertFalse(self.env['liwan.ai.audit'].search([]))


@tagged('post_install', '-at_install', 'liwan')
class TestAiAuditHardening(AiProbe, LiwanApiCase):
    """Findings: company-wide message limit, lock order, types, scrubbing, single choke point."""

    def setUp(self):
        super().setUp()
        self._install_probe()
        self._grant_ai_use(self.employee)
        self.granted = {READ_CAP, WRITE_CAP, CREATE_CAP}
        self.other = new_test_user(
            self.env, login='ai_other2', password='ai_other_pass_123', name='Omar',
            groups='liwan_core.group_employee,liwan_ai.group_cap_ai_use',
        )
        self.audit_a = self.env['liwan.ai.audit'].with_user(self.employee)
        self.audit_b = self.env['liwan.ai.audit'].with_user(self.other)
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.probe_record = caller_record(self.env, self.employee)

    def _set_feature(self, key, value):
        profile = self.env.ref('liwan_platform.tenant_profile')
        profile.sudo().with_context(**{OPERATOR_CONTEXT: True}).write({
            'features': {**(profile.features or {}), key: value},
        })

    def _post(self, **change):
        return self.api('POST', '/api/v1/ai/audit', {**READ, **change})

    def _assert_422(self, response, field):
        self.assertEqual(response.status_code, 422, response.content)
        self.assertEqual(response.json()['field'], field)

    # 1. tenant-wide message count without sudo
    def _other_company_user(self):
        company = self.env['res.company'].create({'name': 'AI other company'})
        user = new_test_user(
            self.env, login='ai_company_b', password='ai_company_b_pass_123', name='Bader',
            groups='liwan_core.group_employee,liwan_ai.group_cap_ai_use',
            company_id=company.id, company_ids=[Command.set(company.ids)],
        )
        return company, user

    def test_message_limit_counts_the_whole_tenant_across_companies(self):
        company, user = self._other_company_user()
        audit_c = self.env['liwan.ai.audit'].with_user(user).with_company(company)
        for _ in range(2):
            self.audit_a.create(MESSAGE)
        audit_c.create(MESSAGE)
        self.assertEqual(self.audit_a._liwan_ai_count_messages(), 3)
        self.assertEqual(audit_c._liwan_ai_count_messages(), 3)
        self.assertEqual(
            self.audit_a.create(MESSAGE).company_id | audit_c.create(MESSAGE).company_id,
            self.employee.company_id | company,
        )
        self._set_feature('ai.messages.monthly', 5)
        with self.assertRaises(Exception) as caught:
            self.audit_a.create(MESSAGE)
        self.assertEqual(getattr(caught.exception, 'details', None), {'reason': 'limit', 'limit_key': 'ai.messages.monthly'})
        self.assertEqual(self.env['liwan.ai.audit'].search_count([('kind', '=', 'message')]), 5)

    def test_message_limit_counts_colleagues_without_reading_their_rows(self):
        for _ in range(3):
            self.audit_a.create(MESSAGE)
        self.assertFalse(self.audit_b.search([]))
        self.assertEqual(self.audit_b._liwan_ai_count_messages(), 3)
        self._set_feature('ai.messages.monthly', 3)
        with self.assertRaises(Exception) as caught:
            self.audit_b.create(MESSAGE)
        self.assertEqual(getattr(caught.exception, 'details', None), {'reason': 'limit', 'limit_key': 'ai.messages.monthly'})

    def test_tools_route_reports_the_tenant_wide_messages_used(self):
        company, user = self._other_company_user()
        self.env['liwan.ai.audit'].with_user(user).with_company(company).create(MESSAGE)
        self.assertEqual(self.api('GET', '/api/v1/ai/tools').json()['limits']['messages_used'], 1)

    def test_other_users_cannot_read_any_row_of_a_colleague(self):
        self.audit_a.create(MESSAGE)
        self.audit_a.create(READ)
        self.audit_a.create({**DRAFT, 'result': 'approved', 'approved': {'id': self.probe_record.id}})
        self.assertEqual(self.audit_a.search_count([('result', '=', 'approved')]), 1)
        self.assertFalse(self.audit_b.search([]))
        self.assertEqual(len(self.audit_a.search([])), 3)

    def test_the_flow_limit_never_feeds_the_stock_usage(self):
        self.audit_a.create(MESSAGE)
        self.assertEqual(self.env['liwan.entitlement.service']._liwan_count_usage('ai.messages.monthly'), 0)

    def test_a_message_row_stores_no_tool_data(self):
        for change, field in (
            ({'tool_name': 'probe.list_things'}, 'tool_name'),
            ({'input': {'a': 1}}, 'input'),
            ({'draft': {'a': 1}}, 'draft'),
            ({'approved': {'a': 1}}, 'approved'),
            ({'http_status': 200}, 'http_status'),
        ):
            with self.assertRaises(ValidationError, msg=change) as caught:
                self.audit_a.create({**MESSAGE, **change})
            self.assertEqual(caught.exception.liwan_field, field)
        self.assertFalse(self.env['liwan.ai.audit'].search([]))

    # 2. quota fence before count
    def _spy_fence_and_count(self):
        calls = []
        profile_model = type(self.env['liwan.tenant.profile'])
        audit_model = type(self.env['liwan.ai.audit'])
        fence = profile_model._liwan_bump_quota_revision
        count = audit_model._liwan_ai_count_messages

        def spy_fence(model):
            calls.append('fence')
            return fence(model)

        def spy_count(model):
            calls.append('count')
            return count(model)

        self.patch(profile_model, '_liwan_bump_quota_revision', spy_fence)
        self.patch(audit_model, '_liwan_ai_count_messages', spy_count)
        return calls

    def test_a_limited_tenant_writes_the_quota_fence_before_the_count(self):
        # Under REPEATABLE READ only a write makes a concurrent sender with an older snapshot fail
        # serialization (and be retried on fresh data); a lock alone let the limit overshoot.
        self._set_feature('ai.messages.monthly', 10)
        profile = self.env.ref('liwan_platform.tenant_profile')
        before = profile.quota_revision
        calls = self._spy_fence_and_count()
        self.audit_a.create(MESSAGE)
        self.assertEqual(calls[:2], ['fence', 'count'])
        profile.invalidate_recordset()
        self.assertEqual(profile.quota_revision, before + 1)

    def test_an_unlimited_tenant_takes_no_quota_fence(self):
        calls = self._spy_fence_and_count()
        self.audit_a.create(MESSAGE)
        self.assertNotIn('fence', calls)

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
        self.assertEqual(caught.exception.liwan_field, 'input')
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
        self.assertFalse(self.env['liwan.ai.audit'].search([]))

    def test_direct_create_enforces_the_tool_capability(self):
        self.granted = set()
        with self.assertRaises(AccessError):
            self.audit_a.create(READ)
        self.assertFalse(self.env['liwan.ai.audit'].search([]))

    def test_a_disabled_tool_feature_is_refused_while_another_tool_feature_is_on(self):
        second = 'test_probe_second.enabled'
        tools = tuple({**tool, 'feature_key': second} if tool['name'] == 'probe.rename_thing' else tool for tool in PROBE_TOOLS)
        self.patch(type(self.env['liwan.ai.tool.registry']), '_liwan_ai_tool_definitions', lambda model: tools)
        registry = type(self.env['liwan.feature.registry'])
        definitions = registry._liwan_feature_definitions
        probe = {'key': second, 'type': 'boolean', 'owner': 'liwan_platform', 'module': 'liwan_platform'}
        self.patch(registry, '_liwan_feature_definitions', lambda model: (*definitions(model), probe))
        set_probe_feature(self, second, enabled=False)
        self.granted = {READ_CAP, WRITE_CAP}
        write = {**READ, 'kind': 'write_light', 'tool_name': 'probe.rename_thing'}
        refused = self.api('POST', '/api/v1/ai/audit', write)
        self.assertEqual(refused.status_code, 403, refused.text)
        self.assertFalse(self.env['liwan.ai.audit'].search([('tool_name', '=', 'probe.rename_thing')]))
        self.assertEqual(self.api('POST', '/api/v1/ai/audit', READ).status_code, 200)

    def test_direct_create_rejects_forged_or_undocumented_values(self):
        for change, field in (
            ({'user_id': self.other.id}, 'user_id'),
            ({'company_id': self.env.company.id}, 'company_id'),
            ({'attested_at': '2020-01-01 00:00:00'}, 'attested_at'),
            ({'create_date': '2020-01-01 00:00:00'}, 'create_date'),
            ({'result': 'approved', 'kind': 'draft', 'tool_name': 'probe.draft_thing'}, 'approved'),
        ):
            with self.assertRaises(ValidationError, msg=change) as caught:
                self.audit_a.create({**(DRAFT if 'kind' in change else READ), **change})
            self.assertEqual(caught.exception.liwan_field, field)
        self.assertFalse(self.env['liwan.ai.audit'].search([]))

    def test_direct_create_derives_owner_and_attestation(self):
        row = self.audit_a.create({**DRAFT, 'result': 'approved', 'approved': {'id': self.probe_record.id}})
        self.assertEqual((row.user_id, row.company_id), (self.employee, self.employee.company_id))
        self.assertTrue(row.attested_at)
        plain = self.audit_a.create(DRAFT)
        self.assertFalse(plain.attested_at)

    def test_direct_create_obeys_the_ai_feature_gate(self):
        self._set_feature('ai.enabled', False)
        with self.assertRaises(Exception) as caught:
            self.env['liwan.ai.audit'].with_user(self.employee).create({**MESSAGE})
        self.assertEqual(getattr(caught.exception, 'code', None), 'feature_not_included')
        self.assertFalse(self.env['liwan.ai.audit'].search([]))

    # 6. NUL characters and non-finite numbers
    def test_nul_characters_are_422_never_500(self):
        for change, field in (
            ({'input': {'name': 'a\x00b'}}, 'input'),
            ({'input': {'a\x00b': 1}}, 'input'),
            ({'input': {'rows': [{'name': 'x\x00'}]}}, 'input'),
            ({'conversation_id': 'r\x00_1'}, 'conversation_id'),
        ):
            self._assert_422(self._post(**change), field)
        self._assert_422(self.api('POST', '/api/v1/ai/audit', {**DRAFT, 'draft': {'name': 'a\x00'}}), 'draft')
        self._assert_422(
            self.api('POST', '/api/v1/ai/audit', {**DRAFT, 'result': 'approved', 'approved': {'n': '\x00'}}),
            'approved',
        )
        with self.assertRaises(ValidationError) as caught:
            self.audit_a.create({**READ, 'input': {'name': 'a\x00b'}})
        self.assertEqual(caught.exception.liwan_field, 'input')
        self.assertFalse(self.env['liwan.ai.audit'].search([]))

    def test_non_finite_numbers_are_422_never_500(self):
        for number in (math.nan, math.inf, -math.inf):
            with self.assertRaises(ValidationError, msg=number) as caught:
                self.audit_a.create({**READ, 'input': {'n': [number]}})
            self.assertEqual(caught.exception.liwan_field, 'input')
        for literal in ('NaN', 'Infinity', '-Infinity'):
            body = (
                '{"conversation_id": "r_test_01", "kind": "read", "agent": "probe", "tool_name": "probe.list_things", '
                f'"result": "ok", "input": {{"n": {literal}}}}}'
            )
            response = self.url_open(
                '/api/v1/ai/audit', data=body, headers={'Content-Type': 'application/json'}, method='POST',
            )
            self._assert_422(response, 'input')
        self.assertFalse(self.env['liwan.ai.audit'].search([]))

    def test_the_route_answers_an_unknown_field_as_unknown_field(self):
        response = self._post(surprise=1)
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()['code'], 'unknown_field')
        self.assertEqual(response.json()['field'], 'surprise')
        self.assertFalse(self.env['liwan.ai.audit'].search([]))
