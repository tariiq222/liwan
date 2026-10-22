# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.webvue_api.controllers.attachment_download import (
    download_linked_attachment,
)
from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    error_response,
    parse_page,
    parse_positive_int,
    requires_feature,
)
from odoo.addons.webvue_api.serializers.attachment import parse_attachment_upload
from odoo.addons.webvue_operations.models.common import require
from odoo.addons.webvue_operations.models.operation_request import (
    OperationExecutionError,
)
from odoo.addons.webvue_operations.serializers.operations import (
    dump_process,
    dump_request,
    dump_summary,
)


def body(allowed):
    payload = request.get_json_data()
    if not isinstance(payload, dict) or set(payload) - allowed:
        raise ApiError(422, 'invalid', 'Invalid request fields.')
    return payload


def find(model, record_id, capability, *, domain=()):
    require(request.env, capability, write=False)
    # The pinned company subtree (current company + its own branches); a
    # foreign-company record is not-found like a missing one.
    record = request.env[model].search([('id', '=', record_id), ('company_id', 'in', request.env.companies.ids), *domain], limit=1)
    if not record:
        raise ApiError(404, 'not_found', 'Record not found.')
    return record


def purpose_value(value):
    if value not in ('work', 'employee'):
        raise ApiError(422, 'invalid', 'Invalid process purpose.', field='purpose')
    return value


class OperationsController(http.Controller):
    @http.route('/api/v1/operations/execution-kinds', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('operations.enabled', operation='read')
    def execution_kinds(self, **_):
        require(request.env, 'operations.processes.manage', write=False)
        items = list(request.env['webvue.operation.process']._operations_execution_kinds())
        return {'items': items, 'total': len(items)}

    @http.route('/api/v1/operations/processes/<int:process_id>/targets', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('operations.enabled', operation='read')
    def process_targets(self, process_id, **_):
        process = find('webvue.operation.process', process_id, 'operations.requests.create')
        items = process._operations_targets(request.httprequest.args.get('q', '')[:200])
        return {'items': items, 'total': len(items)}

    @http.route('/api/v1/operations/processes', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('operations.enabled', operation='read')
    def list_processes(self, **_):
        require(request.env, 'operations.requests.read', write=False)
        args = request.httprequest.args
        limit, offset = parse_page(args)
        domain = [('company_id', 'in', request.env.companies.ids)]
        if 'purpose' in args:
            domain.append(('purpose', '=', purpose_value(args['purpose'])))
        if args.get('published') == '1':
            domain.append(('state', '=', 'published'))
        if args.get('q'):
            domain.append(('name', 'ilike', args['q'][:200]))
        model = request.env['webvue.operation.process']
        return {'items': [dump_process(p) for p in model.search(domain, limit=limit, offset=offset)], 'total': model.search_count(domain)}

    @http.route('/api/v1/operations/processes/<int:process_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('operations.enabled', operation='read')
    def get_process(self, process_id, **_):
        return dump_process(find('webvue.operation.process', process_id, 'operations.requests.read'))

    @http.route('/api/v1/operations/processes', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('operations.enabled')
    def create_process(self, **_):
        payload = body({'name', 'description', 'execution_kind', 'purpose', 'steps'})
        purpose = purpose_value(payload.get('purpose', 'work'))
        record = request.env['webvue.operation.process'].create({'name': payload.get('name'), 'description': payload.get('description', ''), 'execution_kind': payload.get('execution_kind', 'approval'), 'purpose': purpose})
        record.action_configure(0, payload.get('name'), payload.get('description', ''), payload.get('execution_kind', 'approval'), payload.get('steps'), purpose=purpose)
        return dump_process(record)

    @http.route('/api/v1/operations/processes/<int:process_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('operations.enabled')
    def update_process(self, process_id, **_):
        record = find('webvue.operation.process', process_id, 'operations.processes.manage')
        payload = body({'name', 'description', 'execution_kind', 'purpose', 'steps', 'revision'})
        record.action_configure(payload.get('revision'), payload.get('name'), payload.get('description', ''), payload.get('execution_kind', 'approval'), payload.get('steps'), purpose=purpose_value(payload.get('purpose', record.purpose)))
        return dump_process(record)

    @http.route('/api/v1/operations/processes/<int:process_id>/<string:action>', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('operations.enabled')
    def transition_process(self, process_id, action, **_):
        record = find('webvue.operation.process', process_id, 'operations.processes.manage')
        payload = body({'revision'})
        if action == 'publish':
            record.action_publish(payload.get('revision'))
        elif action == 'archive':
            record.action_archive(payload.get('revision'))
        else:
            raise ApiError(404, 'not_found', 'Unknown process action.')
        return dump_process(record)

    @http.route('/api/v1/operations/requests', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('operations.enabled', operation='read')
    def list_requests(self, **_):
        args = request.httprequest.args
        scope = args.get('scope', 'mine')
        if scope not in ('mine', 'pending', 'monitoring'):
            raise ApiError(422, 'invalid', 'Invalid request scope.', field='scope')
        require(request.env, 'operations.monitoring.read' if scope == 'monitoring' else 'operations.requests.read', write=False)
        limit, offset = parse_page(args)
        domain = [('company_id', 'in', request.env.companies.ids)]
        if 'purpose' in args:
            domain.append(('purpose', '=', purpose_value(args['purpose'])))
        if scope == 'mine':
            domain.append(('requester_id', '=', request.env.uid))
        elif scope == 'pending':
            require(request.env, 'operations.requests.review', write=False)
            domain += [('state', '=', 'pending'), ('can_review', '=', True)]
        if args.get('q'):
            domain.append(('name', 'ilike', args['q'][:200]))
        if args.get('state'):
            if args['state'] not in ('draft', 'pending', 'returned', 'rejected', 'withdrawn', 'done'):
                raise ApiError(422, 'invalid', 'Invalid request state.', field='state')
            domain.append(('state', '=', args['state']))
        model = request.env['webvue.operation.request']
        return {'items': [dump_summary(p) for p in model.search(domain, limit=limit, offset=offset)], 'total': model.search_count(domain)}

    @http.route('/api/v1/operations/requests/<int:request_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('operations.enabled', operation='read')
    def get_request(self, request_id, **_):
        return dump_request(find('webvue.operation.request', request_id, 'operations.requests.read'))

    @http.route('/api/v1/operations/requests/employee/me/<int:request_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('operations.enabled', operation='read')
    def get_own_employee_request(self, request_id, **_):
        return dump_request(find(
            'webvue.operation.request', request_id, 'operations.requests.read',
            domain=[('requester_id', '=', request.env.uid), ('purpose', '=', 'employee')],
        ))

    @http.route('/api/v1/operations/requests', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('operations.enabled')
    def create_request(self, **_):
        payload = body({'name', 'description', 'process_id', 'target_id'})
        payload['process_id'] = parse_positive_int(payload.get('process_id'), 'process_id')
        if 'target_id' in payload:
            payload['target_id'] = parse_positive_int(payload['target_id'], 'target_id')
        return dump_request(request.env['webvue.operation.request'].create(payload))

    @http.route('/api/v1/operations/requests/<int:request_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('operations.enabled')
    def update_request(self, request_id, **_):
        record = find('webvue.operation.request', request_id, 'operations.requests.create')
        payload = body({'name', 'description', 'revision'})
        record.action_update(payload.get('revision'), payload.get('name'), payload.get('description', ''))
        return dump_request(record)

    @http.route('/api/v1/operations/requests/<int:request_id>/<string:action>', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('operations.enabled')
    def transition_request(self, request_id, action, **_):
        record = find('webvue.operation.request', request_id, 'operations.requests.read')
        payload = body({'revision', 'comment'})
        actions = {'submit': record.action_submit, 'approve': record.action_approve, 'reject': record.action_reject, 'return': record.action_return, 'withdraw': record.action_withdraw}
        if action not in actions:
            raise ApiError(404, 'not_found', 'Unknown request action.')
        kwargs = {'revision': payload.get('revision')}
        if action != 'submit':
            kwargs['comment'] = payload.get('comment', '')
        try:
            actions[action](**kwargs)
        except OperationExecutionError as exc:
            # The transition rolled back its own decision+effect savepoint. Commit
            # only its failure audit, rather than pretending an approval succeeded.
            return error_response(422, 'execution_failed', str(exc))
        return dump_request(record)

    @http.route('/api/v1/operations/requests/<int:request_id>/attachments/<int:attachment_id>/download', type='http', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('operations.enabled', operation='read')
    def download_attachment(self, request_id, attachment_id, **_):
        record = find('webvue.operation.request', request_id, 'operations.requests.read')
        attachments = request.env['ir.attachment'].search([('res_model', '=', record._name), ('res_id', '=', record.id), ('type', '=', 'binary')])
        return download_linked_attachment(attachments, attachment_id)

    @http.route('/api/v1/operations/requests/<int:request_id>/attachments', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('operations.enabled')
    def upload_attachment(self, request_id, **_):
        record = find('webvue.operation.request', request_id, 'operations.requests.create')
        record._editable()
        values = parse_attachment_upload(body({'name', 'mimetype', 'data'}))
        request.env['ir.attachment'].create({'name': values['name'], 'raw': values['raw'], 'mimetype': values['mimetype'], 'public': False, 'res_model': record._name, 'res_id': record.id, 'type': 'binary'})
        return dump_request(record)

    @http.route('/api/v1/operations/requests/<int:request_id>/attachments/<int:attachment_id>', type='json2', auth='user', methods=['DELETE'], readonly=False)
    @api_handler
    @requires_feature('operations.enabled')
    def delete_attachment(self, request_id, attachment_id, **_):
        record = find('webvue.operation.request', request_id, 'operations.requests.create')
        record._editable()
        attachment = request.env['ir.attachment'].search([('id', '=', attachment_id), ('res_model', '=', record._name), ('res_id', '=', record.id)], limit=1)
        if not attachment:
            raise ApiError(404, 'not_found', 'Attachment not found.')
        attachment.unlink()
        return dump_request(record)
