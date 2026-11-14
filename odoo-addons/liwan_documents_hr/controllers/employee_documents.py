# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    requires_capability,
    requires_feature,
    serves_own_data,
)
from odoo.addons.liwan_document_service.controllers.common import (
    archived_arg,
    file_download,
    files_page,
    list_filter_domain,
    page_args,
    require,
)
from odoo.addons.liwan_document_service.serializers.document import (
    dump_detail,
    dump_summaries,
)
from odoo.addons.liwan_hr.controllers.common import own_employee


def own_document_domain():
    employee = own_employee(public=True)
    return [
        ('company_id', '=', request.env.company.id),
        ('employee_id', '=', employee.id),
    ] if employee else [('id', '=', 0)]


def own_document(document_id):
    """The caller's own employee document in the request company, readable by them, or the not-found."""
    document = request.env['liwan.document'].with_context(active_test=False).search([
        *own_document_domain(), ('id', '=', document_id),
    ], limit=1)
    if not document:
        raise ApiError(404, 'not_found', 'document not found')
    document._liwan_require('read')
    return document


class EmployeeDocuments(http.Controller):
    @http.route('/api/v1/documents/employee/me', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @serves_own_data()
    @requires_feature('hr.enabled', operation='read')
    @requires_capability('documents.items.read', 'hr.employees.read')
    def list_own_documents(self, **_):
        args = request.httprequest.args
        limit, offset = page_args(args)
        archived = archived_arg(args)
        if archived:
            require('documents.items.archive')
        domain = [*own_document_domain(), ('active', '=', not archived), *list_filter_domain(args)]
        if args.get('q'):
            domain.append(('name', 'ilike', args['q']))
        model = request.env['liwan.document'].with_context(active_test=False)
        documents = model.search(domain, limit=limit, offset=offset, order='write_date desc,id desc')
        counts = {directory.id: count for directory, count in request.env['dms.file']._read_group(
            [('directory_id', 'in', documents.directory_id.ids), ('active', '=', True)],
            ['directory_id'], ['__count'],
        )}
        return {'items': dump_summaries(documents, counts), 'total': model.search_count(domain)}

    @http.route('/api/v1/documents/employee/me/<int:document_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @serves_own_data()
    @requires_feature('hr.enabled', operation='read')
    @requires_capability('documents.items.read', 'hr.employees.read')
    def get_own_document(self, document_id, **_):
        return dump_detail(own_document(document_id))

    @http.route('/api/v1/documents/employee/me/<int:document_id>/files', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @serves_own_data()
    @requires_feature('hr.enabled', operation='read')
    @requires_capability('documents.items.read', 'hr.employees.read')
    def list_own_document_files(self, document_id, **_):
        return files_page(own_document(document_id), f'/api/v1/documents/employee/me/{document_id}/files')

    @http.route(
        '/api/v1/documents/employee/me/<int:document_id>/files/<int:file_id>/download',
        type='http', auth='user', methods=['GET', 'HEAD'], readonly=True,
    )
    @api_handler
    @serves_own_data()
    @requires_feature('hr.enabled', operation='read')
    @requires_capability('documents.items.read', 'hr.employees.read')
    def download_own_document_file(self, document_id, file_id, **_):
        return file_download(own_document(document_id), file_id)
