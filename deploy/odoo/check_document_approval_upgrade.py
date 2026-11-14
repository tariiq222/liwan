# Part of Odoo. See LICENSE file for full copyright and licensing details.
from pathlib import Path
import base64
import hashlib
import json
import os

env = globals()['env']
fixture = json.loads(Path(os.environ['LIWAN_DOC_FIXTURE']).read_text())
assert env['ir.module.module'].search([('name', '=', 'liwan_document_service')]).state == 'installed'
for key in ('employee_document_id', 'department_document_id'):
    assert env['liwan.document'].browse(fixture[key]).exists()
document = env['liwan.document'].browse(fixture['employee_document_id'])
assert document.revision == fixture['document_revision']
assert document.employee_id.id == fixture['employee_id']
assert sorted(document.grant_ids.ids) == sorted(fixture['grant_ids'])
assert document.with_user(fixture['employee_user_id'])._liwan_can('read')
for expected in fixture['files']:
    file = env['dms.file'].browse(expected['id'])
    assert file.active == expected['active']
    assert file.attachment_id.id == expected['attachment_id']
    assert hashlib.sha256(base64.b64decode(file.attachment_id.datas)).hexdigest() == expected['content_sha256']
for expected in fixture['approvals']:
    request = env['liwan.operation.request'].browse(expected['id'])
    assert (request.state, request.execution_count, request.event_ids.ids) == (
        expected['state'], expected['execution_count'], expected['event_ids'],
    )
assert env.ref('liwan_approval_service.model_liwan_operation_request').model == 'liwan.operation.request'
assert env.ref('liwan_document_service.model_liwan_document').model == 'liwan.document'
assert env.ref('liwan_documents.role_documents_manager').key == 'documents_manager'
assert env['liwan.access.permission'].search([('key', '=', 'documents.items.read')]).group_xmlid == 'liwan_document_service.group_cap_documents_items_read'
profile = env.ref('liwan_platform.tenant_profile')
retired = {'documents.enabled', 'operations.enabled'}
for policy in (profile.features, profile.post_trial_features, profile.retained_read_features):
    assert retired.isdisjoint(policy or ()), 'base features must not remain in tenant policy'
print('DOCUMENT_UPGRADE_FIXTURE_OK')
