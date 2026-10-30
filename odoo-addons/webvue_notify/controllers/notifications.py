# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    parse_nonneg_int,
    requires_registered_feature,
)

MAX_LIMIT = 200


class NotificationController(http.Controller):

    @http.route('/api/v1/notifications', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_registered_feature(
        'webvue.notify.registry', '_webvue_notify_feature_keys',
        keys=('registry:webvue.notify.registry',), operation='read', match='any',
        open_method='_webvue_notify_has_platform_kind',
    )
    def list_notifications(self, **_):
        args = request.httprequest.args
        supported = {'limit', 'offset', 'unread'}
        unknown = next((key for key in args if key not in supported), None)
        if unknown:
            raise ApiError(422, 'invalid', f"unsupported query parameter {unknown!r}", field=unknown)
        # Odoo search(limit=0) is unlimited; treat explicit 0 as the default page.
        limit = parse_nonneg_int(args.get('limit', 50), 'limit') or 50
        limit = min(limit, MAX_LIMIT)
        offset = parse_nonneg_int(args.get('offset', 0), 'offset')
        unread_arg = args.get('unread')
        unread = None
        if unread_arg is not None:
            if unread_arg in ('1', 'true'):
                unread = True
            elif unread_arg in ('0', 'false'):
                unread = False
            else:
                raise ApiError(422, 'invalid', "unread must be a boolean", field='unread')
        return request.env['webvue.notify.service']._webvue_list(limit, offset=offset, unread=unread)

    # The two writes have no route-level feature: each row's owner feature is
    # checked by the service (NOTIFICATION_WRITE_ENDPOINTS in webvue_api tests).
    @http.route('/api/v1/notifications/<int:notification_id>/read', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    def mark_read(self, notification_id, **_):
        return {'updated': request.env['webvue.notify.service']._webvue_mark_read(notification_id)}

    @http.route('/api/v1/notifications/read-all', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    def mark_all_read(self, **_):
        return {'updated': request.env['webvue.notify.service']._webvue_mark_all_read()}
