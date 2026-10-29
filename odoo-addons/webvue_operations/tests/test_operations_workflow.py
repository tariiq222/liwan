# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import AccessError, ValidationError
from odoo.tests import new_test_user, tagged

from odoo.addons.webvue_api.tests.common import WebVueApiCase, set_probe_feature
from odoo.addons.webvue_core.models.access_service import WebVueAccessRule
from odoo.addons.webvue_operations.models.operation_request import (
    OperationExecutionError,
)
from odoo.addons.webvue_operations.serializers.operations import dump_request


@tagged('post_install', '-at_install', 'webvue')
class TestOperationsWorkflow(WebVueApiCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.manager = new_test_user(cls.env, login='ops_manager', password='ops_manager_test_123', groups='webvue_core.group_employee')
        cls.reviewers = [new_test_user(cls.env, login=f'ops_reviewer_{i}', password=f'ops_reviewer_{i}_test_123', groups='webvue_core.group_employee') for i in (1, 2)]
        cls.outsider = new_test_user(cls.env, login='ops_outsider', password='ops_outsider_test_123', groups='base.group_user')
        cls.service = cls.env['webvue.access.service']
        cls.service._webvue_replace_assignments(cls.employee, [{'role_id': cls.env.ref('webvue_core.role_employee').id, 'company_id': cls.env.company.id}])
        for user, role in [(cls.manager, 'manager'), *[(u, 'reviewer') for u in cls.reviewers]]:
            cls.service._webvue_replace_assignments(user, [{'role_id': cls.env.ref(f'webvue_operations.role_operations_{role}').id, 'company_id': cls.env.company.id}])
        cls.process = cls.env['webvue.operation.process'].with_user(cls.manager).create({'name': 'Expense approval'})
        cls.process.with_user(cls.manager).action_configure(0, 'Expense approval', 'Two stages', 'approval', [{'name': 'Review', 'reviewer_ids': [cls.reviewers[0].id]}, {'name': 'Approve', 'reviewer_ids': [cls.reviewers[1].id]}])
        cls.process.with_user(cls.manager).action_publish(1)

    def _request(self):
        return self.env['webvue.operation.request'].with_user(self.employee).create({'name': 'Laptop request', 'description': 'Original description', 'process_id': self.process.id})

    def _pending(self):
        record = self._request()
        record.action_submit(0)
        return record

    def test_operation_resources_are_installed(self):
        self.assertIn('webvue.operation.request', self.env.registry)
        self.assertIn('webvue.operation.process', self.env.registry)

    def test_self_service_purpose_is_server_owned_snapshot_through_reconfiguration(self):
        self.assertIn('purpose', self.process._fields)
        record = self._pending()
        self.assertEqual((self.process.purpose, record.purpose), ('work', 'work'))
        self.process.with_user(self.manager).action_configure(1, 'Employee service', '', 'approval', [
            {'name': 'Review', 'reviewer_ids': [self.reviewers[0].id]},
        ], purpose='employee')
        self.process.with_user(self.manager).action_publish(2)
        self.assertEqual((self.process.purpose, record.purpose), ('employee', 'work'))
        record.with_user(self.reviewers[0]).action_return(1, 'More details')
        record.action_submit(2)
        self.assertEqual(record.purpose, 'work')
        personal = self._request()
        self.assertEqual(personal.purpose, 'employee')
        self.assertEqual(dump_request(personal)['purpose'], 'employee')
        for purpose in ('work', 'employee'):
            with self.assertRaises(AccessError):
                self.env['webvue.operation.request'].with_user(self.employee).create({
                    'name': 'Forged purpose', 'process_id': self.process.id, 'purpose': purpose,
                })
        forged = self.env['webvue.operation.request'].with_user(self.employee).with_context(
            default_purpose='work',
        ).create({'name': 'Context cannot select purpose', 'process_id': self.process.id})
        self.assertEqual(forged.purpose, 'employee')
        with self.assertRaises(AccessError):
            personal.write({'purpose': 'work'})

    def test_self_service_purpose_filters_do_not_change_own_and_pending_scope(self):
        self.assertIn('purpose', self.process._fields)
        work = self._pending()
        self.process.with_user(self.manager).action_configure(1, 'Personal service', '', 'approval', [
            {'name': 'Review', 'reviewer_ids': [self.reviewers[0].id]},
        ], purpose='employee')
        self.process.with_user(self.manager).action_publish(2)
        personal = self._pending()
        self.authenticate('api_emp', 'api_emp_pass_123')
        result = self.api('GET', '/api/v1/operations/requests?scope=mine&purpose=employee')
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual([item['id'] for item in result.json()['items']], [personal.id])
        result = self.api('GET', '/api/v1/operations/requests?scope=mine&purpose=work')
        self.assertEqual([item['id'] for item in result.json()['items']], [work.id])
        catalog = self.api('GET', '/api/v1/operations/processes?published=1&purpose=work')
        self.assertEqual(catalog.status_code, 200, catalog.text)
        self.assertEqual(catalog.json()['total'], 0)
        catalog = self.api('GET', '/api/v1/operations/processes?published=1&purpose=employee')
        self.assertEqual([item['id'] for item in catalog.json()['items']], [self.process.id])
        for endpoint in ('requests', 'processes'):
            self.assertEqual(self.api('GET', f'/api/v1/operations/{endpoint}?purpose=personal').status_code, 422)
        self.assertEqual(self.api('POST', '/api/v1/operations/requests', {
            'name': 'Forged', 'process_id': self.process.id, 'purpose': 'employee',
        }).status_code, 422)
        self.authenticate('ops_reviewer_1', 'ops_reviewer_1_test_123')
        pending = self.api('GET', '/api/v1/operations/requests?scope=pending')
        self.assertEqual({item['id'] for item in pending.json()['items']}, {work.id, personal.id})

    def test_self_service_process_api_configures_and_validates_purpose(self):
        self.assertIn('purpose', self.process._fields)
        self.authenticate('ops_manager', 'ops_manager_test_123')
        payload = {'name': 'Employee process', 'purpose': 'employee', 'steps': [
            {'name': 'Review', 'reviewer_ids': [self.reviewers[0].id]},
        ]}
        result = self.api('POST', '/api/v1/operations/processes', payload)
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json()['purpose'], 'employee')
        kinds = self.api('GET', '/api/v1/operations/execution-kinds')
        self.assertEqual(kinds.status_code, 200, kinds.text)
        self.assertEqual(kinds.json()['total'], len(kinds.json()['items']))
        self.assertEqual(self.api('POST', '/api/v1/operations/processes', {
            **payload, 'purpose': 'personal',
        }).status_code, 422)

    def test_self_service_request_detail_requires_own_employee_purpose(self):
        work = self._pending()
        self.process.with_user(self.manager).action_configure(1, 'Employee service', '', 'approval', [
            {'name': 'Review', 'reviewer_ids': [self.reviewers[0].id]},
        ], purpose='employee')
        self.process.with_user(self.manager).action_publish(2)
        personal = self._pending()
        self.authenticate('api_emp', 'api_emp_pass_123')
        path = '/api/v1/operations/requests/employee/me'
        result = self.api('GET', f'{path}/{personal.id}')
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual((result.json()['id'], result.json()['purpose']), (personal.id, 'employee'))
        result = self.api('GET', f'{path}/{work.id}')
        self.assertEqual((result.status_code, result.json()['code']), (404, 'not_found'))
        self.authenticate('ops_reviewer_1', 'ops_reviewer_1_test_123')
        self.assertEqual(self.api('GET', f'/api/v1/operations/requests/{personal.id}').status_code, 200)
        result = self.api('GET', f'{path}/{personal.id}')
        self.assertEqual((result.status_code, result.json()['code']), (404, 'not_found'))

    def test_system_admin_and_vendor_support_gain_no_implicit_operation_capabilities(self):
        admin = new_test_user(self.env, login='ops_system_admin', groups='webvue_core.group_employee')
        self.service._webvue_replace_assignments(admin, [{'role_id': self.env.ref('webvue_core.role_system_admin').id, 'company_id': self.env.company.id}])
        support = new_test_user(self.env, login='ops_vendor_support', groups='webvue_core.group_vendor_support')
        for user in [admin, support]:
            keys = self.service._webvue_capability_keys(user)
            self.assertNotIn('operations.requests.review', keys)
            self.assertNotIn('operations.processes.manage', keys)

    def test_two_stages_execute_once_after_final_approval(self):
        record = self._pending()
        self.assertEqual((record.state, record.execution_count), ('pending', 0))
        record.with_user(self.reviewers[0]).action_approve(1)
        self.assertEqual((record.state, record.execution_count), ('pending', 0))
        record.with_user(self.reviewers[1]).action_approve(2)
        self.assertEqual((record.state, record.execution_count, record.revision), ('done', 1, 3))
        with self.assertRaises(WebVueAccessRule):
            record.with_user(self.reviewers[1]).action_approve(2)
        self.assertEqual(record.execution_count, 1)
        self.assertEqual(record.event_ids.mapped('kind'), ['submitted', 'approved', 'approved', 'executed'])

    def test_requester_manager_and_later_stage_cannot_approve(self):
        record = self._pending()
        for user in [self.employee, self.manager, self.reviewers[1]]:
            with self.assertRaises(AccessError), self.env.cr.savepoint():
                record.with_user(user).action_approve(1)
        self.assertEqual(record.execution_count, 0)

    def test_raw_writes_tokens_and_generic_engine_buttons_are_denied(self):
        record = self._pending()
        with self.assertRaises(AccessError):
            record.with_context(_operations_write=True, skip_validation_check=True).write({'state': 'done'})
        for name in ['validate_tier', 'reject_tier', 'restart_validation', 'request_validation', '_validate_tier', '_rejected_tier']:
            with self.assertRaises(AccessError):
                getattr(record.with_user(self.reviewers[0]), name)()
        with self.assertRaises(AccessError):
            record.review_ids.with_user(self.reviewers[0]).write({'status': 'approved'})
        with self.assertRaises(AccessError):
            record.event_ids.with_user(self.manager).write({'comment': 'Rewritten evidence'})

    def test_return_restarts_cycle_and_preserves_audit(self):
        record = self._pending()
        record.with_user(self.reviewers[0]).action_return(1, 'Please add details')
        self.assertEqual(record.state, 'returned')
        self.assertEqual(record.review_ids.sorted('sequence').mapped('status'), ['rejected', 'cancel'])
        prior_evidence = record.event_ids[-1].evidence
        record.with_user(self.employee).action_update(2, 'Laptop request', 'More details')
        record.with_user(self.employee).action_submit(3)
        self.assertEqual((record.state, record.cycle), ('pending', 2))
        self.assertEqual(record.event_ids[1].evidence, prior_evidence)
        self.assertEqual(prior_evidence['review_statuses'], [{'sequence': 1, 'status': 'rejected'}, {'sequence': 2, 'status': 'cancel'}])
        self.assertEqual(record.event_ids.mapped('kind'), ['submitted', 'returned', 'submitted'])
        with self.assertRaises(WebVueAccessRule):
            record.with_user(self.reviewers[0]).action_approve(1)

    def test_approval_failure_rolls_back_decision_effect_and_execution_claim(self):
        record = self._pending()
        record.with_user(self.reviewers[0]).action_approve(1)

        def fail(request):
            request._ops_write({'description': 'Partial effect'})
            message = 'Deliberate test failure'
            raise ValidationError(message)
        self.patch(type(record), '_execute_approved', fail)
        with self.assertRaises(OperationExecutionError):
            record.with_user(self.reviewers[1]).action_approve(2)
        record.invalidate_recordset()
        self.assertEqual((record.state, record.revision, record.execution_count, record.description), ('pending', 2, 0, 'Original description'))
        self.assertEqual(record.review_ids.sorted('sequence').mapped('status'), ['approved', 'pending'])

    def test_process_reconfiguration_does_not_change_submitted_reviewers(self):
        record = self._pending()
        snapshot = record.stage_snapshot
        self.process.with_user(self.manager).action_configure(1, 'New process title', '', 'approval', [{'name': 'Different', 'reviewer_ids': [self.reviewers[1].id]}])
        self.process.with_user(self.manager).action_publish(2)
        self.assertEqual(record.stage_snapshot, snapshot)
        record.with_user(self.reviewers[0]).action_approve(1)
        record.with_user(self.reviewers[1]).action_approve(2)
        self.assertEqual(record.execution_count, 1)

    def test_current_capability_is_required_after_submission(self):
        record = self._pending()
        self.service._webvue_replace_assignments(self.reviewers[0], [{'role_id': self.env.ref('webvue_core.role_employee').id, 'company_id': self.env.company.id}])
        with self.assertRaises(AccessError):
            record.with_user(self.reviewers[0]).action_approve(1)

    def test_request_is_hidden_from_nonparticipants_and_wrong_company(self):
        record = self._pending()
        other = new_test_user(self.env, login='ops_other', groups='webvue_core.group_employee')
        self.assertFalse(record.with_user(other).has_access('read'))
        with self.assertRaises(AccessError):
            record.with_user(self.outsider).read(['name'])
        company = self.env['res.company'].create({'name': 'Other operation company'})
        self.manager.write({'company_ids': [(4, company.id)]})
        self.assertFalse(self.env['webvue.operation.request'].with_user(self.manager).with_context(allowed_company_ids=[company.id]).search([('id', '=', record.id)]))

    def test_manager_cannot_create_or_mutate_raw_approval_definitions(self):
        record = self._pending()
        definitions = record.review_ids.mapped('definition_id')
        with self.assertRaises(AccessError):
            definitions.with_user(self.manager).write({'reviewer_id': self.manager.id})
        with self.assertRaises(AccessError):
            self.env['tier.definition'].with_user(self.manager).create({'name': 'Bypass', 'model_id': self.env['ir.model']._get(record._name).id})

    def test_json_default_context_cannot_forge_control_fields(self):
        record = self.env['webvue.operation.request'].with_user(self.employee).with_context(default_state='done', default_execution_count=99, default_requester_id=self.manager.id).create({'name': 'Normal request', 'process_id': self.process.id})
        self.assertEqual((record.state, record.execution_count, record.requester_id), ('draft', 0, self.employee))

    def test_pending_request_attachments_cannot_be_changed_via_orm(self):
        record = self._request()
        attachment = self.env['ir.attachment'].with_user(self.employee).create({'name': 'proof.txt', 'raw': b'proof', 'res_model': record._name, 'res_id': record.id})
        record.action_submit(0)
        with self.assertRaises(AccessError):
            attachment.with_user(self.employee).write({'public': True})
        with self.assertRaises(AccessError):
            attachment.with_user(self.reviewers[0]).unlink()

    def test_http_permissions_and_revision_status(self):
        record = self._pending()
        self.authenticate('ops_manager', 'ops_manager_test_123')
        response = self.api('POST', f'/api/v1/operations/requests/{record.id}/approve', {'revision': 1})
        self.assertEqual((response.status_code, response.json()['code']), (403, 'forbidden'))
        self.authenticate('ops_reviewer_1', 'ops_reviewer_1_test_123')
        response = self.api('POST', f'/api/v1/operations/requests/{record.id}/approve', {'revision': 0})
        self.assertEqual((response.status_code, response.json()['code']), (409, 'conflict'))
        response = self.api('POST', f'/api/v1/operations/requests/{record.id}/approve', {'revision': 1})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['state'], 'pending')

    def test_serializer_has_only_contract_keys_and_server_actions(self):
        record = self._pending()
        payload = dump_request(record.with_user(self.reviewers[0]))
        self.assertEqual(set(payload), {'id', 'name', 'process', 'process_revision', 'purpose', 'state', 'revision', 'cycle', 'requester', 'created_at', 'execution_count', 'description', 'target', 'steps', 'events', 'attachments', 'allowed_actions'})
        self.assertTrue(payload['allowed_actions']['approve'])
        self.assertFalse(payload['allowed_actions']['edit'])

    def test_pending_queue_follows_current_stage_and_monitoring_needs_its_capability(self):
        record = self._pending()
        self.authenticate('ops_reviewer_2', 'ops_reviewer_2_test_123')
        response = self.api('GET', '/api/v1/operations/requests?scope=pending')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['total'], 0)
        record.with_user(self.reviewers[0]).action_approve(1)
        response = self.api('GET', '/api/v1/operations/requests?scope=pending')
        self.assertEqual(response.json()['items'][0]['id'], record.id)
        response = self.api('GET', '/api/v1/operations/requests?scope=monitoring')
        self.assertEqual(response.status_code, 403)

    def test_feature_closure_blocks_orm_and_http_decisions(self):
        record = self._pending()
        set_probe_feature(self, key='operations.enabled', enabled=False)
        with self.assertRaises(WebVueAccessRule):
            record.with_user(self.reviewers[0]).action_approve(1)
        self.authenticate('ops_reviewer_1', 'ops_reviewer_1_test_123')
        response = self.api('POST', f'/api/v1/operations/requests/{record.id}/approve', {'revision': 1})
        self.assertEqual(response.status_code, 403)
        self.assertEqual(record.execution_count, 0)

    def test_http_rejects_unknown_fields_and_invalid_pagination(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        response = self.api('POST', '/api/v1/operations/requests', {'name': 'Forged', 'process_id': self.process.id, 'state': 'done'})
        self.assertEqual((response.status_code, response.json()['code']), (422, 'invalid'))
        response = self.api('GET', '/api/v1/operations/requests?limit=-1')
        self.assertEqual(response.status_code, 422)

    def test_disabled_reviewer_and_empty_return_reason_are_denied(self):
        record = self._pending()
        with self.assertRaises(ValidationError):
            record.with_user(self.reviewers[0]).action_return(1, '   ')
        self.reviewers[0].write({'active': False})
        with self.assertRaises(AccessError):
            record.with_user(self.reviewers[0]).action_approve(1)

    def test_attachment_defaults_cannot_bypass_pending_or_public_guards(self):
        pending = self._pending()
        attachments = self.env['ir.attachment'].with_user(self.reviewers[0])
        with self.assertRaises(AccessError), self.env.cr.savepoint():
            attachments.with_context(default_res_model=pending._name, default_res_id=pending.id, default_public=True).create({'name': 'injected.txt', 'raw': b'evidence'})
        draft = self._request()
        with self.assertRaises(AccessError), self.env.cr.savepoint():
            self.env['ir.attachment'].with_user(self.employee).with_context(default_public=True).create({'name': 'public.txt', 'raw': b'evidence', 'res_model': draft._name, 'res_id': draft.id})

    def test_raw_process_write_cannot_mutate_published_configuration(self):
        revision = self.process.revision
        with self.assertRaises(AccessError):
            self.process.with_user(self.manager).write({'execution_kind': 'unpublished_hook'})
        self.assertEqual((self.process.execution_kind, self.process.revision), ('approval', revision))

    def test_monitoring_and_configuration_rules_use_selected_company(self):
        company = self.env['res.company'].create({'name': 'Other scoped operations'})
        self.manager.write({'company_ids': [(4, company.id)]})
        self.env['webvue.access.assignment'].create({'user_id': self.env.user.id, 'role_id': self.env.ref('webvue_operations.role_operations_manager').id, 'company_id': company.id})
        process = self.env['webvue.operation.process'].with_company(company).create({'name': 'Other company process'})
        process.write({'state': 'published'})
        record = self.env['webvue.operation.request'].with_company(company).create({'name': 'Other request', 'process_id': process.id})
        process.write({'state': 'draft'})
        context = {'allowed_company_ids': [company.id]}
        self.assertFalse(record.with_user(self.manager).with_context(**context).has_access('read'))
        self.assertFalse(process.with_user(self.manager).with_context(**context).has_access('read'))
        event = self.env['webvue.operation.event'].create({'request_id': record.id, 'company_id': company.id, 'kind': 'fixture', 'comment': '', 'actor_id': self.env.user.id, 'cycle': 0})
        self.assertFalse(event.with_user(self.manager).with_context(**context).has_access('read'))
        self.env['webvue.access.assignment'].create({'user_id': self.manager.id, 'role_id': self.env.ref('webvue_operations.role_operations_manager').id, 'company_id': company.id})
        self.assertTrue(record.with_user(self.manager).with_context(**context).has_access('read'))
        self.assertTrue(process.with_user(self.manager).with_context(**context).has_access('read'))

    def test_operations_manager_does_not_gain_other_origin_configuration_rights(self):
        other = self.env['tier.definition'].create({'name': 'Other origin', 'model_id': self.env['ir.model']._get('res.partner').id})
        with self.assertRaises(AccessError):
            other.with_user(self.manager).write({'name': 'Changed'})
        with self.assertRaises(AccessError):
            self.env['tier.definition'].with_user(self.manager).create({'name': 'Other origin', 'model_id': other.model_id.id})
        with self.assertRaises(AccessError):
            self.env['tier.definition'].with_user(self.manager).with_context(default_model_id=self.env['ir.model']._get('webvue.operation.request').id).create({'name': 'Default bypass'})

    def test_erp_configuration_cannot_inject_derived_operation_model(self):
        admin = new_test_user(self.env, login='ops_erp_config', groups='base.group_erp_manager')
        other = self.env['tier.definition'].create({'name': 'Other origin', 'model_id': self.env['ir.model']._get('res.partner').id})
        other.with_user(admin).write({'name': 'Legitimate configuration'})
        with self.assertRaises(AccessError):
            other.with_user(admin).write({'model': 'webvue.operation.request'})
        with self.assertRaises(AccessError):
            self.env['tier.definition'].with_user(admin).with_context(default_model='webvue.operation.request').create({'name': 'Default model injection', 'model_id': other.model_id.id})
        with self.assertRaises(AccessError):
            self.env['tier.definition'].with_user(admin).with_context(default_operations_reviewer_ids=[self.manager.id]).create({'name': 'Default injection', 'model_id': other.model_id.id})

    def test_withdrawal_preserves_review_evidence(self):
        record = self._pending()
        record.with_user(self.reviewers[0]).action_approve(1)
        ids = record.review_ids.ids
        record.with_user(self.employee).action_withdraw(2, 'Withdraw test')
        self.assertEqual(record.review_ids.ids, ids)
        self.assertEqual(record.review_ids.sorted('sequence').mapped('status'), ['approved', 'pending'])

    def test_publication_context_cannot_inject_tier_defaults(self):
        process = self.env['webvue.operation.process'].with_user(self.manager).create({'name': 'Clean publication'})
        process.action_configure(0, 'Clean publication', '', 'approval', [{'name': 'Review', 'reviewer_ids': [self.reviewers[0].id]}])
        process.with_context(default_model='res.partner', default_allow_write_for_reviewer=True).action_publish(1)
        definition = self.env['tier.definition'].search([('operations_process_id', '=', process.id)])
        self.assertEqual(definition.model, 'webvue.operation.request')
        self.assertFalse(definition.allow_write_for_reviewer)

    def _file(self, record, name='quote.txt', raw=b'operation bytes', user=None):
        return self.env['ir.attachment'].with_user(user or self.employee).create({
            'name': name, 'raw': raw, 'mimetype': 'text/plain', 'public': False,
            'res_model': record._name, 'res_id': record.id, 'type': 'binary',
        })

    def _path(self, record, attachment):
        return f'/api/v1/operations/requests/{record.id}/attachments/{attachment.id}/download'

    def test_requester_downloads_and_the_wire_url_is_the_download_route(self):
        record = self._request()
        attachment = self._file(record)
        self.authenticate('api_emp', 'api_emp_pass_123')
        listed = self.api('GET', f'/api/v1/operations/requests/{record.id}').json()['attachments']
        self.assertEqual(listed[0]['url'], self._path(record, attachment))
        response = self.api('GET', listed[0]['url'])
        self.assertEqual((response.status_code, response.content), (200, b'operation bytes'))
        self.assertEqual(response.headers['X-Content-Type-Options'], 'nosniff')

    def test_attachment_of_another_request_is_not_served(self):
        record, other = self._request(), self._request()
        foreign = self._file(other, 'other.txt', b'other bytes')
        self.authenticate('api_emp', 'api_emp_pass_123')
        response = self.api('GET', self._path(record, foreign))
        self.assertEqual((response.status_code, response.json()['code']), (404, 'not_found'))

    def test_read_capability_is_required(self):
        record = self._request()
        attachment = self._file(record)
        nocap = new_test_user(self.env, login='ops_nocap', password='ops_nocap_test_123', groups='webvue_core.group_employee')
        nocap.write({'webvue_access_managed': True})
        self.authenticate('ops_nocap', 'ops_nocap_test_123')
        response = self.api('GET', self._path(record, attachment))
        self.assertEqual((response.status_code, response.json()['code']), (403, 'forbidden'))

    def test_hidden_request_and_other_company_request_are_404(self):
        record = self._request()
        attachment = self._file(record)
        other = new_test_user(self.env, login='ops_other_dl', password='ops_other_dl_test_123', groups='webvue_core.group_employee')
        self.service._webvue_replace_assignments(other, [{'role_id': self.env.ref('webvue_core.role_employee').id, 'company_id': self.env.company.id}])
        self.authenticate('ops_other_dl', 'ops_other_dl_test_123')
        self.assertEqual(self.api('GET', self._path(record, attachment)).status_code, 404)
        company = self.env['res.company'].create({'name': 'Other download company'})
        foreign = self._request()
        foreign_file = self._file(foreign)
        # Move the stored request to the other company the way an out-of-scope row would exist.
        self.env.cr.execute('UPDATE webvue_operation_request SET company_id = %s WHERE id = %s', [company.id, foreign.id])
        foreign.invalidate_recordset()
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.assertEqual(self.api('GET', self._path(foreign, foreign_file)).status_code, 404)

    # Owner decisions 2026-10-29 (#163): stage approval mode, purpose filter on shared lists, archived processes.
    def _repeated_reviewer_process(self, mode=None):
        process = self.env['webvue.operation.process'].with_user(self.manager).create({'name': 'Repeated reviewer'})
        kwargs = {} if mode is None else {'stage_approval_mode': mode}
        process.action_configure(0, 'Repeated reviewer', '', 'approval', [
            {'name': 'First', 'reviewer_ids': [self.reviewers[0].id]},
            {'name': 'Second', 'reviewer_ids': [self.reviewers[0].id]},
            {'name': 'Final', 'reviewer_ids': [self.reviewers[1].id]},
        ], **kwargs)
        process.action_publish(1)
        record = self.env['webvue.operation.request'].with_user(self.employee).create({'name': 'Repeated', 'process_id': process.id})
        record.action_submit(0)
        return process, record

    def test_per_stage_mode_is_the_default_and_needs_one_decision_per_stage(self):
        process, record = self._repeated_reviewer_process()
        self.assertEqual((process.stage_approval_mode, record.stage_approval_mode), ('per_stage', 'per_stage'))
        record.with_user(self.reviewers[0]).action_approve(1)
        self.assertEqual(record.review_ids.sorted('sequence').mapped('status'), ['approved', 'pending', 'waiting'])
        self.assertEqual(record.state, 'pending')
        record.with_user(self.reviewers[0]).action_approve(2)
        self.assertEqual(record.review_ids.sorted('sequence').mapped('status'), ['approved', 'approved', 'pending'])
        with self.assertRaises(AccessError), self.env.cr.savepoint():
            record.with_user(self.reviewers[0]).action_approve(3)
        record.with_user(self.reviewers[1]).action_approve(3)
        self.assertEqual((record.state, record.execution_count), ('done', 1))
        self.assertEqual(record.event_ids.mapped('kind'), ['submitted', 'approved', 'approved', 'approved', 'executed'])

    def test_single_mode_covers_the_reviewers_consecutive_stages(self):
        process, record = self._repeated_reviewer_process('single')
        self.assertEqual((process.stage_approval_mode, record.stage_approval_mode), ('single', 'single'))
        record.with_user(self.reviewers[0]).action_approve(1)
        self.assertEqual(record.review_ids.sorted('sequence').mapped('status'), ['approved', 'approved', 'pending'])
        record.with_user(self.reviewers[1]).action_approve(2)
        self.assertEqual((record.state, record.execution_count), ('done', 1))

    def test_pending_request_keeps_the_mode_it_was_submitted_under(self):
        process, record = self._repeated_reviewer_process('single')
        process.with_user(self.manager).action_configure(1, process.name, '', 'approval', [
            {'name': 'First', 'reviewer_ids': [self.reviewers[0].id]},
            {'name': 'Second', 'reviewer_ids': [self.reviewers[0].id]},
        ], stage_approval_mode='per_stage')
        process.with_user(self.manager).action_publish(2)
        self.assertEqual((process.stage_approval_mode, record.stage_approval_mode), ('per_stage', 'single'))
        record.with_user(self.reviewers[0]).action_approve(1)
        self.assertEqual(record.review_ids.sorted('sequence').mapped('status'), ['approved', 'approved', 'pending'])
        record.with_user(self.reviewers[1]).action_return(2, 'Resubmit under the new mode')
        record.with_user(self.employee).action_submit(3)
        self.assertEqual(record.stage_approval_mode, 'per_stage')
        record.with_user(self.reviewers[0]).action_approve(4)
        self.assertEqual(record.review_ids.sorted('sequence').mapped('status'), ['approved', 'pending'])

    def test_stage_approval_mode_is_configured_and_validated_through_the_api(self):
        self.authenticate('ops_manager', 'ops_manager_test_123')
        steps = [{'name': 'Review', 'reviewer_ids': [self.reviewers[0].id]}]
        created = self.api('POST', '/api/v1/operations/processes', {'name': 'Default mode', 'steps': steps})
        self.assertEqual(created.status_code, 200, created.text)
        self.assertEqual(created.json()['stage_approval_mode'], 'per_stage')
        process_id = created.json()['id']
        updated = self.api('PATCH', f'/api/v1/operations/processes/{process_id}', {'name': 'Single mode', 'steps': steps, 'stage_approval_mode': 'single', 'revision': 1})
        self.assertEqual(updated.status_code, 200, updated.text)
        self.assertEqual(updated.json()['stage_approval_mode'], 'single')
        kept = self.api('PATCH', f'/api/v1/operations/processes/{process_id}', {'name': 'Mode kept', 'steps': steps, 'revision': 2})
        self.assertEqual(kept.json()['stage_approval_mode'], 'single')
        for path, method, payload in [
            ('/api/v1/operations/processes', 'POST', {'name': 'Bad', 'steps': steps, 'stage_approval_mode': 'any'}),
            (f'/api/v1/operations/processes/{process_id}', 'PATCH', {'name': 'Bad', 'steps': steps, 'stage_approval_mode': 'any', 'revision': 3}),
            ('/api/v1/operations/processes', 'POST', {'name': 'Bad', 'steps': steps, 'stage_approval_mode': []}),
            ('/api/v1/operations/processes', 'POST', {'name': 'Bad', 'steps': steps, 'stage_approval_mode': {}}),
        ]:
            response = self.api(method, path, payload)
            self.assertEqual((response.status_code, response.json()['code'], response.json().get('field')), (422, 'invalid', 'stage_approval_mode'))
        with self.assertRaises(AccessError):
            self.env['webvue.operation.process'].with_user(self.manager).create({'name': 'Forged', 'stage_approval_mode': 'single'})
        forged = self.env['webvue.operation.request'].with_user(self.employee).with_context(default_stage_approval_mode='single').create({'name': 'Forged mode', 'process_id': self.process.id})
        self.assertEqual(forged.stage_approval_mode, 'per_stage')

    def test_shared_lists_filter_by_purpose(self):
        work = self._pending()
        self.process.with_user(self.manager).action_configure(1, 'Personal service', '', 'approval', [
            {'name': 'Review', 'reviewer_ids': [self.reviewers[0].id]},
        ], purpose='employee')
        self.process.with_user(self.manager).action_publish(2)
        personal = self._pending()
        for login, scope in [('ops_reviewer_1', 'pending'), ('ops_manager', 'monitoring')]:
            self.authenticate(login, f'{login}_test_123')
            listed = {}
            for purpose in ('work', 'employee'):
                response = self.api('GET', f'/api/v1/operations/requests?scope={scope}&purpose={purpose}')
                self.assertEqual(response.status_code, 200, response.text)
                listed[purpose] = [item['id'] for item in response.json()['items']]
                self.assertEqual(response.json()['total'], len(listed[purpose]))
            self.assertEqual(listed, {'work': [work.id], 'employee': [personal.id]})
            everything = self.api('GET', f'/api/v1/operations/requests?scope={scope}').json()
            self.assertEqual({item['id'] for item in everything['items']}, {work.id, personal.id})
            invalid = self.api('GET', f'/api/v1/operations/requests?scope={scope}&purpose=personal')
            self.assertEqual((invalid.status_code, invalid.json()['field']), (422, 'purpose'))

    def test_archived_process_cannot_be_reconfigured(self):
        process = self.process.with_user(self.manager)
        process.action_archive(1)
        self.assertEqual((process.state, process.revision), ('archived', 2))
        with self.assertRaises(ValidationError):
            process.action_configure(2, 'Revived', '', 'approval', [{'name': 'Review', 'reviewer_ids': [self.reviewers[0].id]}])
        self.assertEqual((process.state, process.revision, process.name), ('archived', 2, 'Expense approval'))
        self.authenticate('ops_manager', 'ops_manager_test_123')
        response = self.api('PATCH', f'/api/v1/operations/processes/{process.id}', {'name': 'Revived', 'steps': [{'name': 'Review', 'reviewer_ids': [self.reviewers[0].id]}], 'revision': 2})
        self.assertEqual((response.status_code, response.json()['code']), (422, 'invalid'))
        self.assertEqual(self.api('GET', f'/api/v1/operations/processes/{process.id}').json()['state'], 'archived')

    def test_archiving_an_archived_process_is_refused_without_a_revision_bump(self):
        process = self.process.with_user(self.manager)
        process.action_archive(1)
        with self.assertRaises(ValidationError):
            process.action_archive(2)
        self.assertEqual((process.state, process.revision), ('archived', 2))
        self.authenticate('ops_manager', 'ops_manager_test_123')
        response = self.api('POST', f'/api/v1/operations/processes/{process.id}/archive', {'revision': 2})
        self.assertEqual((response.status_code, response.json()['code']), (422, 'invalid'))
        self.assertEqual(self.api('GET', f'/api/v1/operations/processes/{process.id}').json()['revision'], 2)
