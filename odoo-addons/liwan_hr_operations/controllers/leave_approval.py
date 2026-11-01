# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    requires_capability,
    requires_feature,
)
from odoo.addons.liwan_hr.controllers.hr_leave import _current_leave
from odoo.addons.liwan_hr_operations.models.common import KIND
from odoo.addons.liwan_hr_operations.serializers.leave_approval import (
    dump_approval,
    dump_approval_process,
)

FEATURES = ('hr.enabled', 'operations.enabled')


def _governing_process():
    return request.env['liwan.operation.process']._hr_leave_governing_process(request.env.company)


class HrLeaveApprovalController(http.Controller):

    @http.route('/api/v1/hr/leave/requests/<int:leave_id>/approval', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature(*FEATURES, operation='read')
    @requires_capability('hr.leave.read')
    def get_approval(self, leave_id, **_):
        record = _current_leave(leave_id).liwan_approval_request_ids[:1]
        if not record:
            raise ApiError(404, 'not_found', 'this leave request has no approval workflow')
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
    @requires_capability('operations.processes.manage')
    def create_default_process(self, **payload):
        if payload:
            field = sorted(payload)[0]
            raise ApiError(422, 'invalid', f'field {field!r} is not writable', field=field)
        processes = request.env['liwan.operation.process']
        if _governing_process():
            raise ApiError(409, 'conflict', 'the company already has a leave approval process')
        values, steps = processes._hr_leave_default_process()
        process = processes.create({'name': values['name']})
        process.action_configure(0, values['name'], values['description'], KIND, steps, purpose=values['purpose'])
        process.action_publish(process.revision)
        return request.make_json_response(dump_approval_process(process, request.env), status=201)
