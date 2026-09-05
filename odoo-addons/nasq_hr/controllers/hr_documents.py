# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.nasq_api.controllers.common import (
    ApiError,
    api_handler,
    get_record,
    parse_nonneg_int,
)
from odoo.addons.nasq_hr.serializers.hr_document import (
    dump_document,
    parse_attachment_upload,
    parse_document_create,
    parse_document_patch,
)

MAX_LIMIT = 200


def _require_customer_admin():
    if not request.env.user.has_group('nasq_core.group_customer_admin'):
        raise ApiError(403, 'forbidden', "only a customer administrator can write this resource")


class HrDocumentController(http.Controller):

    @http.route('/api/v1/hr/documents', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    def list_documents(self, **_):
        args = request.httprequest.args
        q = args.get('q')
        department_id = args.get('department_id')
        limit = min(parse_nonneg_int(args.get('limit', 50), 'limit'), MAX_LIMIT)
        offset = parse_nonneg_int(args.get('offset', 0), 'offset')
        domain = []
        if q:
            domain.append(('name', 'ilike', q))
        if department_id not in (None, ''):
            try:
                domain.append(('department_id', '=', int(department_id)))
            except (TypeError, ValueError):
                raise ApiError(422, 'invalid', "department_id must be an integer", field='department_id') from None
        Document = request.env['nasq.hr.document']
        recs = Document.search(domain, order='name, id', limit=limit, offset=offset)
        return {'items': [dump_document(d) for d in recs], 'total': Document.search_count(domain)}

    @http.route('/api/v1/hr/documents/<int:document_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    def get_document(self, document_id):
        return dump_document(get_record('nasq.hr.document', document_id))

    @http.route('/api/v1/hr/documents', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    def create_document(self, name=None, body=None, department_id=None, **extra):
        _require_customer_admin()
        payload = {'name': name, 'body': body, 'department_id': department_id}
        payload.update(extra)
        payload = {k: v for k, v in payload.items() if v is not None or k == 'department_id'}
        vals = parse_document_create(payload)
        get_record('hr.department', vals['department_id'])
        doc = request.env['nasq.hr.document'].create(vals)
        return request.make_json_response(dump_document(doc), status=201)

    @http.route('/api/v1/hr/documents/<int:document_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    def patch_document(self, document_id, **payload):
        _require_customer_admin()
        payload.pop('document_id', None)
        if not payload:
            raise ApiError(422, 'invalid', "no fields to update")
        doc = get_record('nasq.hr.document', document_id)
        vals = parse_document_patch(payload)
        doc.write(vals)
        return dump_document(doc)

    @http.route(
        '/api/v1/hr/documents/<int:document_id>/attachments',
        type='json2', auth='user', methods=['POST'], readonly=False,
    )
    @api_handler
    def upload_document_attachment(self, document_id, **payload):
        _require_customer_admin()
        payload.pop('document_id', None)
        doc = get_record('nasq.hr.document', document_id)
        vals = parse_attachment_upload(payload)
        attachment_vals = {
            'name': vals['name'],
            'datas': vals['datas'],
            'res_model': 'nasq.hr.document',
            'res_id': doc.id,
        }
        if vals['mimetype']:
            attachment_vals['mimetype'] = vals['mimetype']
        attachment = request.env['ir.attachment'].create(attachment_vals)
        doc.write({'attachment_ids': [(4, attachment.id)]})
        return dump_document(doc)
