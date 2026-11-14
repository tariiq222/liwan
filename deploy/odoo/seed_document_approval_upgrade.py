# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Run in the Odoo shell on a disposable clone of the pre-extraction baseline."""
from datetime import date, timedelta
import base64
import hashlib
import json
import re

from odoo import Command

# The Odoo shell injects the scratch database environment.
env = globals()['env']
from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT

if not re.fullmatch(r'(liwan_scratch_docs_ops_[a-z0-9_]+|liwan_ci_upgrade_scratch)', env.cr.dbname):
    raise RuntimeError('This fixture requires a disposable documents/approvals scratch database')

company = env.company
profile = env.ref('liwan_platform.tenant_profile')
profile._liwan_initialize_legacy_policy(
    env['liwan.feature.registry']._liwan_installed_module_ids()
)
profile.with_context(**{OPERATOR_CONTEXT: True}).write({
    'features': {
        **profile.features, 'hr.enabled': True,
        **{key: True for key in ('documents.enabled', 'operations.enabled') if key in profile.features},
    },
})
branch = env['res.company'].create({'name': 'Upgrade fixture branch', 'parent_id': company.id})
assignment_service = env['liwan.access.service']


def make_user(login, roles=()):
    actor = env['res.users'].with_context(no_reset_password=True).create({
        'name': login,
        'login': login,
        'company_id': company.id,
        'company_ids': [Command.set([company.id])],
        'group_ids': [Command.set([env.ref('liwan_core.group_employee').id])],
    })
    for_role = (env.ref('liwan_core.role_employee'), *(env.ref(key) for key in roles))
    assignment_service._liwan_replace_assignments(
        actor, [{'role_id': role.id, 'company_id': company.id} for role in for_role],
    )
    return actor


employee_user = make_user('fixture_docs_ops_employee')
manager = make_user('fixture_docs_ops_manager')
officer = make_user('fixture_docs_ops_officer', (
    'liwan_hr.role_hr_manager', 'liwan_documents.role_documents_manager',
))
employee_model = env['hr.employee']
employee_model.create({'name': 'Fixture manager', 'user_id': manager.id, 'company_id': company.id})
department = env['hr.department'].create({'name': 'Fixture department', 'company_id': company.id})
employee = employee_model.create({
    'name': 'Fixture employee',
    'user_id': employee_user.id,
    'company_id': company.id,
    'department_id': department.id,
    'leave_manager_id': manager.id,
})
doc_model = env['liwan.document'].with_user(officer)
department_doc = doc_model._liwan_create_document(
    {'name': 'Fixture department document'}, {'kind': 'hr.department', 'id': department.id},
)
employee_doc = doc_model._liwan_create_document(
    {'name': 'Fixture employee document'}, {'kind': 'hr.employee', 'id': employee.id},
)
employee_doc._liwan_set_access('restricted', [
    {'user_id': officer.id, 'access': 'editor'},
    {'user_id': employee_user.id, 'access': 'reader'},
], employee_doc.revision)

files = env['liwan.document.files'].with_user(officer)
raw = b'document service upgrade fixture v1'
payload = {'name': 'fixture.txt', 'data': base64.b64encode(raw).decode()}
archive_file = files._liwan_upload(employee_doc, payload, employee_doc.revision)
raw_new = b'document service upgrade fixture v2'
replaced = {'name': 'fixture.txt', 'data': base64.b64encode(raw_new).decode()}
current_file = files._liwan_upload(employee_doc, replaced, employee_doc.revision, as_version=True)
archive_file = archive_file.with_env(env)
current_file = current_file.with_env(env)
assert not archive_file.active and current_file.active

company._hr_leave_seed_default_process()
leave_type = env['hr.leave.type'].create({
    'name': 'Fixture leave', 'requires_allocation': False, 'leave_validation_type': 'both',
})

def file_leave(weeks):
    start = date.today() + timedelta(days=14 + weeks * 7)
    start += timedelta(days=(0 - start.weekday()) % 7)
    leave = env['hr.leave'].with_user(employee_user).create({
        'employee_id': employee.id, 'holiday_status_id': leave_type.id,
        'request_date_from': start, 'request_date_to': start,
    })
    assert leave.state == 'confirm', leave.state
    leave._liwan_request_approval()
    return leave.with_env(env)


pending_leave = file_leave(0)
completed_leave = file_leave(1)
pending = pending_leave.liwan_approval_request_ids
completed = completed_leave.liwan_approval_request_ids
pending.ensure_one()
completed.ensure_one()
completed.with_user(manager).action_approve(completed.revision)
completed.invalidate_recordset()
completed.with_user(officer).action_approve(completed.revision)
assert (pending.state, completed.state, completed.execution_count) == ('pending', 'done', 1)
assert completed_leave.state == 'validate'


def request_manifest(request):
    return {
        'id': request.id, 'leave_id': request.hr_leave_id.id,
        'process_id': request.process_id.id, 'process_revision': request.process_revision,
        'state': request.state, 'revision': request.revision, 'cycle': request.cycle,
        'reviewers': request.stage_snapshot, 'event_ids': request.event_ids.ids,
        'execution_count': request.execution_count,
    }


env.cr.commit()
print(json.dumps({
    'company_id': company.id, 'branch_id': branch.id,
    'employee_id': employee.id, 'employee_user_id': employee_user.id,
    'employee_document_id': employee_doc.id, 'department_document_id': department_doc.id,
    'document_revision': employee_doc.revision,
    'grant_ids': employee_doc.with_env(env).grant_ids.ids,
    'files': [
        {
            'id': record.id, 'active': record.active, 'attachment_id': record.attachment_id.id,
            'content_sha256': hashlib.sha256(base64.b64decode(record.attachment_id.datas)).hexdigest(),
        }
        for record in (archive_file, current_file)
    ],
    'approvals': [request_manifest(pending), request_manifest(completed)],
}, sort_keys=True))
