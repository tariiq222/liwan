# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.exceptions import MissingError
from odoo.http import request

from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    parse_nonneg_int,
    parse_positive_int,
    requires_feature,
)
from odoo.addons.webvue_hr.serializers.hr_document import (
    dump_document,
    parse_attachment_upload,
    parse_document_create,
    parse_document_patch,
)

MAX_LIMIT = 200


def _can(capability):
    return request.env['webvue.access.service']._webvue_has_capability(request.env.user, capability)


def _require(capability):
    if not _can(capability):
        raise ApiError(403, 'forbidden', f'{capability} capability is required')


def _current_document(document_id):
    document = request.env['webvue.hr.document'].search([
        ('id', '=', int(document_id)),
        ('company_id', '=', request.env.company.id),
    ], limit=1)
    if not document:
        raise MissingError(request.env._(
            'webvue.hr.document %(id)s does not exist', id=document_id,
        ))
    return document


def _current_department(department_id):
    department = request.env['hr.department'].search([
        ('id', '=', int(department_id)),
        ('company_id', '=', request.env.company.id),
    ], limit=1)
    if not department:
        raise MissingError(request.env._(
            'hr.department %(id)s does not exist', id=department_id,
        ))
    return department


class HrDocumentController(http.Controller):

    @http.route('/api/v1/hr/documents', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('hr.enabled', operation='read')
    def list_documents(self, **_):
        _require('hr.documents.read')
        args = request.httprequest.args
        q = args.get('q')
        department_id = args.get('department_id')
        limit = min(parse_nonneg_int(args.get('limit', 50), 'limit'), MAX_LIMIT)
        offset = parse_nonneg_int(args.get('offset', 0), 'offset')
        domain = [('company_id', '=', request.env.company.id)]
        if q:
            domain.append(('name', 'ilike', q))
        # GET department_id is optional: omitted/empty leaves the list unfiltered.
        if department_id not in (None, ''):
            domain.append(('department_id', '=', parse_positive_int(department_id, 'department_id')))
        Document = request.env['webvue.hr.document']
        recs = Document.search(domain, order='name, id', limit=limit, offset=offset)
        return {'items': [dump_document(d) for d in recs], 'total': Document.search_count(domain)}

    @http.route('/api/v1/hr/documents/<int:document_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('hr.enabled', operation='read')
    def get_document(self, document_id):
        _require('hr.documents.read')
        return dump_document(_current_document(document_id))

    @http.route('/api/v1/hr/documents', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('hr.enabled', operation='write')
    def create_document(self, name=None, body=None, department_id=None, expiry_date=None, **extra):
        _require('hr.documents.manage')
        payload = {'name': name, 'body': body, 'department_id': department_id, 'expiry_date': expiry_date}
        payload.update(extra)
        payload = {k: v for k, v in payload.items() if v is not None or k == 'department_id'}
        vals = parse_document_create(payload)
        _current_department(vals['department_id'])
        doc = request.env['webvue.hr.document'].create(vals)
        return request.make_json_response(dump_document(doc), status=201)

    @http.route('/api/v1/hr/documents/<int:document_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('hr.enabled', operation='write')
    def patch_document(self, document_id, **payload):
        _require('hr.documents.manage')
        payload.pop('document_id', None)
        if not payload:
            raise ApiError(422, 'invalid', "no fields to update")
        doc = _current_document(document_id)
        vals = parse_document_patch(payload)
        doc.write(vals)
        return dump_document(doc)

    @http.route(
        '/api/v1/hr/documents/<int:document_id>/attachments',
        type='json2', auth='user', methods=['POST'], readonly=False,
    )
    @api_handler
    @requires_feature('hr.enabled', operation='write')
    def upload_document_attachment(self, document_id, **payload):
        _require('hr.documents.manage')
        payload.pop('document_id', None)
        doc = _current_document(document_id)
        vals = parse_attachment_upload(payload)
        attachment_vals = {
            'name': vals['name'],
            'datas': vals['datas'],
            'res_model': 'webvue.hr.document',
            'res_id': doc.id,
        }
        if vals['mimetype']:
            attachment_vals['mimetype'] = vals['mimetype']
        attachment = request.env['ir.attachment'].create(attachment_vals)
        doc.write({'attachment_ids': [(4, attachment.id)]})
        return dump_document(doc)
