# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from .common import ApiError, api_handler, parse_page, requires_capability


class StorageController(http.Controller):

    @http.route('/api/v1/settings/storage', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_capability('settings.company.manage')
    def list_storage(self):
        """List readable attachment metadata in the caller's current company."""
        args = request.httprequest.args
        limit, offset = parse_page(args, default=25, maximum=100)
        raw_blocked = args.get('blocked')
        if raw_blocked not in (None, 'true', 'false'):
            raise ApiError(422, 'invalid', 'blocked must be true or false', field='blocked')
        service = request.env['liwan.entitlement.service']
        rows, total = service._liwan_storage_inventory(
            limit, offset, blocked=None if raw_blocked is None else raw_blocked == 'true',
        )
        summary = None
        if request.env.company == service._liwan_profile().root_company_id:
            summary = {
                'limit_mb': service._liwan_limit_value('storage.limit_mb'),
                'used_bytes': service._liwan_profile().storage_used_bytes,
                'blocked_bytes': service._liwan_blocked_storage_bytes(),
            }
        return {
            'items': [{
                'id': row.id,
                'name': row.name,
                'size_bytes': row.file_size,
                'created_at': row.create_date.isoformat() + 'Z' if row.create_date else None,
                'blocked': is_blocked,
                'record': row._liwan_storage_record_ref() or None,
            } for row, is_blocked in rows],
            'total': total,
            'summary': summary,
        }
