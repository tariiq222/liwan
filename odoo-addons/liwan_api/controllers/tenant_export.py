# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import content_disposition, request

from .common import api_handler, requires_capability
from odoo.addons.liwan_api.models.tenant_export import refuse
from odoo.addons.liwan_api.models.tenant_export_access import TENANT_EXPORT
from odoo.addons.liwan_api.models.tenant_export_stream import iter_zip
from odoo.addons.liwan_api.serializers.tenant_export import (
    dump_export,
    dump_export_list,
)

MODEL = 'liwan.tenant.export'
ZIP_TYPE = 'application/zip'


class TenantExportController(http.Controller):
    """A complete copy of the tenant's data, taken by the system administrator of the root company.

    Reading and exporting stay open while the tenant is read-only (unpaid or expired); a tenant suspended by the vendor is
    locked out before any of these routes runs. The archive is built by a cron, never inside a request.
    """

    @http.route('/api/v1/admin/tenant-export', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_capability(TENANT_EXPORT)
    def list_exports(self):
        return dump_export_list(*request.env[MODEL]._liwan_listing())

    @http.route('/api/v1/admin/tenant-export', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_capability(TENANT_EXPORT)
    def request_export(self, **payload):
        if payload:
            refuse('invalid', 'the request takes no fields', 422)
        return dump_export(request.env[MODEL]._liwan_request())

    @http.route('/api/v1/admin/tenant-export/<int:export_id>/download', type='json2', auth='user', methods=['GET'], readonly=False)
    @api_handler
    @requires_capability(TENANT_EXPORT)
    def download_export(self, export_id):
        path, filename = request.env[MODEL]._liwan_download(export_id)
        return request.make_response(iter_zip(path), headers=[
            ('Content-Type', ZIP_TYPE),
            ('Content-Disposition', content_disposition(filename)),
            ('Cache-Control', 'private, no-store'),
            ('X-Content-Type-Options', 'nosniff'),
        ])
