# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from .common import (
    archived_arg,
    current_document,
    list_filter_domain,
    page_args,
    require,
)
from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    parse_positive_int,
    requires_feature,
)
from odoo.addons.webvue_documents.serializers.document import (
    dump_detail,
    dump_summaries,
    parse_revision,
    parse_values,
)


class Documents(http.Controller):
    @http.route(
        '/api/v1/documents', type='json2', auth='user', methods=['GET'], readonly=True,
    )
    @api_handler
    @requires_feature('documents.enabled', operation='read')
    def list_documents(self, **kwargs):
        require('documents.items.read')
        args = request.httprequest.args
        limit, offset = page_args(args)
        archived = archived_arg(args)
        if archived:
            require('documents.items.archive')
        domain = [('active', '=', not archived)]
        if args.get('q'):
            domain.append(('name', 'ilike', args['q']))
        domain += list_filter_domain(args)
        kind, context_id = args.get('context_kind'), args.get('context_id')
        if kind or context_id:
            if not kind or not context_id:
                raise ApiError(
                    422,
                    'invalid',
                    'context_kind and context_id are required together',
                    field='context',
                )
            domain += request.env['webvue.document.links']._webvue_context_domain(
                kind, parse_positive_int(context_id, 'context_id'),
            )
        model = request.env['webvue.document'].with_context(active_test=False)
        records = model.search(
            domain, limit=limit, offset=offset, order='write_date desc,id desc',
        )
        counts = {directory.id: count for directory, count in request.env['dms.file']._read_group(
            [('directory_id', 'in', records.directory_id.ids), ('active', '=', True)],
            ['directory_id'], ['__count'],
        )}
        return {
            'items': dump_summaries(records, counts),
            'total': model.search_count(domain),
        }

    @http.route(
        '/api/v1/documents/<int:document_id>',
        type='json2',
        auth='user',
        methods=['GET'],
        readonly=True,
    )
    @api_handler
    @requires_feature('documents.enabled', operation='read')
    def get_document(self, document_id):
        require('documents.items.read')
        return dump_detail(current_document(document_id))

    @http.route(
        '/api/v1/documents', type='json2', auth='user', methods=['POST'], readonly=False,
    )
    @api_handler
    @requires_feature('documents.enabled', operation='write')
    def create_document(self, **payload):
        require('documents.items.manage')
        values = parse_values(request.env, payload)
        context = values.pop('context', None)
        document = request.env['webvue.document']._webvue_create_document(
            values, context,
        )
        return request.make_json_response(dump_detail(document), status=201)

    @http.route(
        '/api/v1/documents/<int:document_id>',
        type='json2',
        auth='user',
        methods=['PATCH'],
        readonly=False,
    )
    @api_handler
    @requires_feature('documents.enabled', operation='write')
    def patch_document(self, document_id, **payload):
        require('documents.items.manage')
        revision = parse_revision(payload)
        values = parse_values(request.env, payload, patch=True)
        document = current_document(document_id)
        document._webvue_update_document(values, revision)
        return dump_detail(document)

    @http.route(
        [
            '/api/v1/documents/<int:document_id>/archive',
            '/api/v1/documents/<int:document_id>/restore',
        ],
        type='json2',
        auth='user',
        methods=['POST'],
        readonly=False,
    )
    @api_handler
    @requires_feature('documents.enabled', operation='write')
    def set_document_active(self, document_id, **payload):
        require('documents.items.archive')
        revision = parse_revision(payload, only=True)
        document = current_document(document_id)
        document._webvue_set_active(
            request.httprequest.path.endswith('/restore'), revision,
        )
        return dump_detail(document)
