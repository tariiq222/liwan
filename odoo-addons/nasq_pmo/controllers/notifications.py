# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import datetime

from odoo import http
from odoo.exceptions import MissingError
from odoo.http import request

from odoo.addons.nasq_api.controllers.common import (
    api_handler,
    parse_nonneg_int,
    requires_feature,
)
from odoo.addons.nasq_pmo.models.notification_types import DIGEST_KIND
from odoo.addons.nasq_pmo.serializers.task import dump_task

MAX_LIMIT = 200


class NotificationController(http.Controller):

    @http.route('/api/v1/notification-digests/<int:notification_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('pmo.enabled', operation='read')
    def get_digest(self, notification_id, **_):
        args = request.httprequest.args
        limit = parse_nonneg_int(args.get('limit', 50), 'limit') or 50
        limit = min(limit, MAX_LIMIT)
        offset = parse_nonneg_int(args.get('offset', 0), 'offset')
        # nasq_notify applies recipient ownership, the visibility branches and
        # the digest's live snapshot check before handing back the row.
        row, live = request.env['nasq.notify.service']._nasq_find(notification_id)
        if row.mail_message_id.nasq_notification_kind != DIGEST_KIND:
            raise MissingError(request.env._('Notification does not exist'))
        tasks = live.sorted(lambda task: (task.date_deadline or datetime.min, task.id))
        page = tasks[offset:offset + limit]
        local_date = row.mail_message_id.nasq_digest_date
        return {
            'id': row.id,
            'kind': 'overdue_digest',
            'local_date': local_date.isoformat() if local_date else None,
            'overdue_count': len(tasks),
            'items': [dump_task(task) for task in page],
            'total': len(tasks),
        }
