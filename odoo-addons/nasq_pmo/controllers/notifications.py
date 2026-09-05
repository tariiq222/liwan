# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.exceptions import MissingError
from odoo.http import request

from odoo.addons.nasq_api.controllers.common import (
    ApiError,
    api_handler,
    parse_nonneg_int,
)
from odoo.addons.nasq_pmo.serializers.notification import dump_notification

MAX_LIMIT = 200


class NotificationController(http.Controller):

    def _readable_active_task_ids(self):
        Project = request.env['project.project']
        company_id = request.env.company.id
        projects = Project.search([('active', '=', True), ('company_id', '=', company_id)])
        if not projects:
            return []
        return request.env['project.task'].search([
            ('active', '=', True),
            ('company_id', '=', company_id),
            ('project_id', 'in', projects.ids),
            ('project_id.company_id', '=', company_id),
            ('project_id.active', '=', True),
        ]).ids

    def _domain(self, unread=None, task_ids=None):
        domain = [
            ('res_partner_id', '=', request.env.user.partner_id.id),
            ('mail_message_id.nasq_notification', '=', True),
            ('mail_message_id.model', '=', 'project.task'),
            ('mail_message_id.nasq_task_id', 'in', task_ids if task_ids is not None else self._readable_active_task_ids()),
            ('notification_type', '=', 'inbox'),
        ]
        if unread is not None:
            # The wire filter is named for the desired state; Odoo stores the
            # inverse boolean (`is_read`).
            domain.append(('is_read', '=', not unread))
        return domain

    @http.route('/api/v1/notifications', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    def list_notifications(self, **_):
        args = request.httprequest.args
        supported = {'limit', 'offset', 'unread'}
        unknown = next((key for key in args if key not in supported), None)
        if unknown:
            raise ApiError(422, 'invalid', f"unsupported query parameter {unknown!r}", field=unknown)
        limit = min(parse_nonneg_int(args.get('limit', 50), 'limit'), MAX_LIMIT)
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
        Notification = request.env['mail.notification'].sudo()
        task_ids = self._readable_active_task_ids()
        base_domain = self._domain(task_ids=task_ids)
        domain = self._domain(unread, task_ids=task_ids)
        rows = Notification.search(domain, order='id desc', limit=limit, offset=offset)
        return {
            'items': [dump_notification(row) for row in rows],
            'total': Notification.search_count(domain),
            'unread_count': Notification.search_count(base_domain + [('is_read', '=', False)]),
        }

    @http.route('/api/v1/notifications/<int:notification_id>/read', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    def mark_read(self, notification_id, **_):
        Notification = request.env['mail.notification'].sudo()
        rows = Notification.search(self._domain() + [('id', '=', notification_id)], limit=1)
        if not rows:
            raise MissingError(request.env._('Notification does not exist'))
        unread = rows.filtered(lambda row: not row.is_read)
        if unread:
            unread.write({'is_read': True})
        return {'updated': len(unread)}

    @http.route('/api/v1/notifications/read-all', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    def mark_all_read(self, **_):
        rows = request.env['mail.notification'].sudo().search(self._domain() + [('is_read', '=', False)])
        count = len(rows)
        if rows:
            rows.write({'is_read': True})
        return {'updated': count}
