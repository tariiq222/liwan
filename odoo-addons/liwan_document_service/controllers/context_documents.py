# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    requires_capability,
    requires_registered_feature,
)
from odoo.addons.liwan_document_service.controllers.common import (
    apply_document_file_action,
    document_page,
    file_download,
    files_page,
    page_args,
    update_document_access,
    upload_document_file,
)
from odoo.addons.liwan_document_service.serializers.document import (
    dump_detail,
    parse_revision,
    parse_values,
    strict,
)
from odoo.addons.liwan_document_service.serializers.document_access import dump_access


def context(kind, subject_id, *, write=False):
    return request.env['liwan.document.links']._liwan_managed_context(kind, subject_id, write=write)


def document_for(kind, subject_id, document_id, *, write=False):
    _, domain = context(kind, subject_id, write=write)
    document = request.env['liwan.document'].with_context(active_test=False).search([
        *domain, ('id', '=', document_id),
    ], limit=1)
    if not document:
        raise ApiError(404, 'not_found', 'Document not found.')
    return document


class ContextDocuments(http.Controller):
    @http.route('/api/v1/document-contexts/<string:kind>/<int:subject_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_registered_feature('liwan.document.links', '_liwan_managed_context_features', keys=('registry:liwan.document.links',), operation='read')
    @requires_capability('documents.items.read')
    def context_documents(self, kind, subject_id, **_):
        _, domain = context(kind, subject_id)
        limit, offset = page_args(request.httprequest.args)
        archived = request.httprequest.args.get('archived') == '1'
        if archived:
            request.env['liwan.access.service']._liwan_require_capability('documents.items.archive')
        domain.append(('active', '=', not archived))
        model = request.env['liwan.document'].with_context(active_test=False)
        return document_page(model, domain, limit, offset)

    @http.route('/api/v1/document-contexts/<string:kind>/<int:subject_id>', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_registered_feature('liwan.document.links', '_liwan_managed_context_features', keys=('registry:liwan.document.links',))
    @requires_capability('documents.items.manage')
    def create_context_document(self, kind, subject_id, **payload):
        model, _ = context(kind, subject_id, write=True)
        strict(payload, {'name', 'body', 'expiry_date', 'tag_ids'})
        values = parse_values(request.env, payload)
        document = request.env['liwan.document']._liwan_create_document(values, {'kind': model, 'id': subject_id})
        return request.make_json_response(dump_detail(document), status=201)

    @http.route('/api/v1/document-contexts/<string:kind>/<int:subject_id>/<int:document_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_registered_feature('liwan.document.links', '_liwan_managed_context_features', keys=('registry:liwan.document.links',), operation='read')
    @requires_capability('documents.items.read')
    def context_document(self, kind, subject_id, document_id, **_):
        return dump_detail(document_for(kind, subject_id, document_id))

    @http.route('/api/v1/document-contexts/<string:kind>/<int:subject_id>/<int:document_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_registered_feature('liwan.document.links', '_liwan_managed_context_features', keys=('registry:liwan.document.links',))
    @requires_capability('documents.items.manage')
    def update_context_document(self, kind, subject_id, document_id, **payload):
        strict(payload, {'name', 'body', 'expiry_date', 'tag_ids', 'expected_revision'})
        revision = parse_revision(payload)
        document = document_for(kind, subject_id, document_id, write=True)
        document._liwan_update_document(parse_values(request.env, payload, patch=True), revision)
        return dump_detail(document)

    @http.route('/api/v1/document-contexts/<string:kind>/<int:subject_id>/<int:document_id>/files', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_registered_feature('liwan.document.links', '_liwan_managed_context_features', keys=('registry:liwan.document.links',), operation='read')
    @requires_capability('documents.items.read')
    def context_document_files(self, kind, subject_id, document_id, **_):
        document = document_for(kind, subject_id, document_id)
        return files_page(document, f'/api/v1/document-contexts/{kind}/{subject_id}/{document.id}/files')

    @http.route('/api/v1/document-contexts/<string:kind>/<int:subject_id>/<int:document_id>/files/<int:file_id>/download', type='http', auth='user', methods=['GET', 'HEAD'], readonly=True)
    @api_handler
    @requires_registered_feature('liwan.document.links', '_liwan_managed_context_features', keys=('registry:liwan.document.links',), operation='read')
    @requires_capability('documents.items.read')
    def context_document_download(self, kind, subject_id, document_id, file_id, **_):
        return file_download(document_for(kind, subject_id, document_id), file_id)

    @http.route('/api/v1/document-contexts/<string:kind>/<int:subject_id>/<int:document_id>/files', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_registered_feature('liwan.document.links', '_liwan_managed_context_features', keys=('registry:liwan.document.links',))
    @requires_capability('documents.items.manage')
    def upload_context_file(self, kind, subject_id, document_id, **payload):
        document = document_for(kind, subject_id, document_id, write=True)
        return upload_document_file(document, payload)

    @http.route('/api/v1/document-contexts/<string:kind>/<int:subject_id>/<int:document_id>/access', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_registered_feature('liwan.document.links', '_liwan_managed_context_features', keys=('registry:liwan.document.links',), operation='read')
    @requires_capability('documents.access.manage')
    def context_access(self, kind, subject_id, document_id, **_):
        return dump_access(document_for(kind, subject_id, document_id))

    @http.route('/api/v1/document-contexts/<string:kind>/<int:subject_id>/<int:document_id>/access', type='json2', auth='user', methods=['PUT'], readonly=False)
    @api_handler
    @requires_registered_feature('liwan.document.links', '_liwan_managed_context_features', keys=('registry:liwan.document.links',))
    @requires_capability('documents.access.manage')
    def set_context_access(self, kind, subject_id, document_id, **payload):
        return update_document_access(document_for(kind, subject_id, document_id, write=True), payload)

    @http.route('/api/v1/document-contexts/<string:kind>/<int:subject_id>/<int:document_id>/access/people', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_registered_feature('liwan.document.links', '_liwan_managed_context_features', keys=('registry:liwan.document.links',), operation='read')
    @requires_capability('documents.access.manage')
    def context_access_people(self, kind, subject_id, document_id, **_):
        document = document_for(kind, subject_id, document_id)
        document._liwan_require('access')
        args = request.httprequest.args
        limit, offset = page_args(args)
        domain = document._liwan_grant_user_domain()
        if args.get('q'):
            domain.append(('name', 'ilike', args['q'][:200]))
        users = request.env['res.users'].search(domain, limit=min(limit, 50), offset=offset, order='name,id')
        return [{'id': user.id, 'name': user.name, 'user_id': user.id} for user in users]

    @http.route('/api/v1/document-contexts/<string:kind>/<int:subject_id>/<int:document_id>/<string:action>', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_registered_feature('liwan.document.links', '_liwan_managed_context_features', keys=('registry:liwan.document.links',))
    @requires_capability('documents.items.archive')
    def change_document_state(self, kind, subject_id, document_id, action, **payload):
        if action not in ('archive', 'restore'):
            raise ApiError(404, 'not_found', 'Unknown document action.')
        document = document_for(kind, subject_id, document_id, write=True)
        document._liwan_set_active(action == 'restore', parse_revision(payload, only=True))
        return dump_detail(document)

    @http.route('/api/v1/document-contexts/<string:kind>/<int:subject_id>/<int:document_id>/files/<int:file_id>/<string:action>', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_registered_feature('liwan.document.links', '_liwan_managed_context_features', keys=('registry:liwan.document.links',))
    @requires_capability('documents.items.manage')
    def context_file_action(self, kind, subject_id, document_id, file_id, action, **payload):
        if action not in ('archive', 'restore', 'lock', 'unlock'):
            raise ApiError(404, 'not_found', 'Unknown file action.')
        document = document_for(kind, subject_id, document_id, write=True)
        return apply_document_file_action(document, file_id, action, payload)
