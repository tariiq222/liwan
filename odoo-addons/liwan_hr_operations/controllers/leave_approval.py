# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    error_response,
    parse_positive_int,
    requires_capability,
    requires_feature,
    serves_own_data,
)
from odoo.addons.liwan_approval_service.models.operation_request import (
    OperationExecutionError,
)
from odoo.addons.liwan_approval_service.serializers.operations import dump_process
from odoo.addons.liwan_hr.controllers.common import asks_for_own_data
from odoo.addons.liwan_hr.controllers.hr_leave import _current_leave
from odoo.addons.liwan_hr_operations.models.common import KIND
from odoo.addons.liwan_hr_operations.serializers.leave_approval import (
    dump_approval,
    dump_approval_process,
)

FEATURES = ('hr.enabled',)


def _governing_process():
    return request.env['liwan.operation.process']._hr_leave_governing_process(request.env.company)


class HrLeaveApprovalController(http.Controller):

    @http.route('/api/v1/hr/leave/requests/<int:leave_id>/approval', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @serves_own_data(asks_for_own_data)
    @requires_feature(*FEATURES, operation='read')
    @requires_capability('hr.leave.read')
    def get_approval(self, leave_id, **_):
        record = _current_leave(leave_id).liwan_approval_request_ids[:1]
        if not record:
            raise ApiError(404, 'not_found', 'this leave request has no approval workflow')
        return dump_approval(record)

    @http.route('/api/v1/hr/leave/requests/<int:leave_id>/approval', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature(*FEATURES)
    @requires_capability("operations.requests.read", "operations.requests.review", "hr.leave.approve", match="any")
    def decide_approval(self, leave_id, action=None, revision=None, comment='', **payload):
        if payload or action not in ('approve', 'reject'):
            raise ApiError(422, 'invalid', 'Choose approve or reject.', field='action')
        record = _current_leave(leave_id).liwan_approval_request_ids.filtered(
            lambda approval: approval.state == 'pending',
        )[:1]
        if not record:
            raise ApiError(404, 'not_found', 'this leave request has no pending approval')
        transition = record.action_approve if action == 'approve' else record.action_reject
        try:
            transition(revision, comment)
        except OperationExecutionError:
            return error_response(422, 'execution_failed', request.env._('The request could not be completed; the last approval was not saved.'))
        return dump_approval(record)

    @http.route('/api/v1/hr/leave/approval-process', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature(*FEATURES, operation='read')
    @requires_capability('hr.leave.config')
    def get_approval_process(self, **_):
        return dump_approval_process(_governing_process(), request.env)

    @http.route('/api/v1/hr/leave/approval-process/default', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature(*FEATURES)
    @requires_capability('hr.leave.config')
    def create_default_process(self, **payload):
        if payload:
            field = sorted(payload)[0]
            raise ApiError(422, 'invalid', f'field {field!r} is not writable', field=field)
        processes = request.env['liwan.operation.process']
        if _governing_process():
            raise ApiError(409, 'conflict', 'the company already has a leave approval process')
        values, steps = processes._hr_leave_default_process()
        process = processes.create({'name': values['name'], 'execution_kind': KIND})
        process.action_configure(0, values['name'], values['description'], KIND, steps, purpose=values['purpose'])
        process.action_publish(process.revision)
        return request.make_json_response(dump_approval_process(process, request.env), status=201)

    @http.route('/api/v1/hr/leave/approval-process', type='json2', auth='user', methods=['DELETE'], readonly=False)
    @api_handler
    @requires_feature(*FEATURES)
    @requires_capability('hr.leave.config')
    def archive_process(self, revision=None, **payload):
        if payload:
            raise ApiError(422, 'invalid', 'Only the revision is accepted.', field='revision')
        process = _governing_process()
        if not process:
            raise ApiError(404, 'not_found', 'the company has no active leave approval process')
        process.action_archive(revision)
        return dump_approval_process(process.browse(), request.env)

    @http.route('/api/v1/hr/leave/approval-process/editor', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature(*FEATURES, operation='read')
    @requires_capability('hr.leave.config')
    def approval_editor(self, **_):
        process = _governing_process()
        if not process:
            raise ApiError(404, 'not_found', 'the company has no active leave approval process')
        return dump_process(process)

    @http.route('/api/v1/hr/leave/approval-process/editor/resolvers', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature(*FEATURES, operation='read')
    @requires_capability('hr.leave.config')
    def approval_edit_resolvers(self, **_):
        processes = request.env['liwan.operation.process']
        items = [{'key': entry['key'], 'label': entry['label']} for entry in processes._operations_reviewer_resolvers(KIND)]
        return {'items': items, 'total': len(items)}

    @http.route('/api/v1/hr/leave/approval-process/editor', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature(*FEATURES)
    @requires_capability('hr.leave.config')
    def save_approval_editor(self, process_id=None, revision=None, name=None, description='', steps=None, stage_approval_mode=None, **extra):
        if extra:
            raise ApiError(422, 'invalid', 'Unexpected approval configuration fields.')
        process = _governing_process()
        if not process or process.id != parse_positive_int(process_id, 'process_id'):
            raise ApiError(409, 'conflict', 'The active approval process changed. Reload before saving.')
        process.action_configure(
            revision, name, description, KIND, steps, purpose='employee',
            stage_approval_mode=stage_approval_mode,
        )
        process.action_publish(process.revision)
        return dump_process(process)
