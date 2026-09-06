# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import datetime

from odoo import http
from odoo.exceptions import MissingError
from odoo.http import request

from odoo.addons.nasq_api.controllers.common import (
    ApiError,
    api_handler,
    parse_nonneg_int,
)
from odoo.addons.nasq_pmo.serializers.notification import dump_notification
from odoo.addons.nasq_pmo.serializers.task import dump_task

MAX_LIMIT = 200
SCAN_BATCH = 200


def recipient_candidate_task_ids(env):
    """Task ids on inbox nasq rows owned by the current partner.

    The recipient restriction is in the domain before the elevated
    ``mail.notification`` read. This does not search ``project.task``.
    """
    rows = env['mail.notification'].sudo().search([
        ('res_partner_id', '=', env.user.partner_id.id),
        ('mail_message_id.nasq_notification', '=', True),
        ('mail_message_id.model', '=', 'project.task'),
        ('notification_type', '=', 'inbox'),
    ])
    return rows.mapped('mail_message_id.nasq_task_id').ids


def readable_active_task_ids(env, candidate_ids=None):
    """Caller-visible active current-company tasks among recipient candidates.

    Task search is never sudo'd. Company-less tasks stay excluded: the
    domain requires ``company_id`` of the current company on both the
    task and its project.
    """
    if candidate_ids is None:
        candidate_ids = recipient_candidate_task_ids(env)
    if not candidate_ids:
        return []
    company_id = env.company.id
    projects = env['project.project'].search([
        ('active', '=', True),
        ('company_id', '=', company_id),
    ])
    if not projects:
        return []
    return env['project.task'].search([
        ('id', 'in', candidate_ids),
        ('active', '=', True),
        ('company_id', '=', company_id),
        ('project_id', 'in', projects.ids),
        ('project_id.company_id', '=', company_id),
        ('project_id.active', '=', True),
    ]).ids


class NotificationController(http.Controller):

    def _readable_active_task_ids(self):
        return readable_active_task_ids(request.env)

    def _domain(self, unread=None, task_ids=None):
        task_ids = task_ids if task_ids is not None else self._readable_active_task_ids()
        domain = [
            ('res_partner_id', '=', request.env.user.partner_id.id),
            ('mail_message_id.nasq_notification', '=', True),
            ('notification_type', '=', 'inbox'),
            '|',
            '&', '&',
            ('mail_message_id.nasq_notification_kind', '=', 'overdue_digest'),
            ('mail_message_id.model', '=', 'res.company'),
            ('mail_message_id.res_id', '=', request.env.company.id),
            '&',
            ('mail_message_id.model', '=', 'project.task'),
            ('mail_message_id.nasq_task_id', 'in', task_ids),
        ]
        if unread is not None:
            domain.append(('is_read', '=', not unread))
        return domain

    def _digest_live_tasks(self, row):
        Task = request.env['project.task']
        snapshot = Task._nasq_digest_snapshot_ids(row.mail_message_id)
        return Task._nasq_live_digest_tasks(snapshot)

    def _row_visible(self, row):
        if row.mail_message_id.nasq_notification_kind != 'overdue_digest':
            return True, None
        live = self._digest_live_tasks(row)
        return bool(live), live

    def _visible_rows(self, domain, limit=None, offset=0):
        Notification = request.env['mail.notification'].sudo()
        last_id = None
        collected = []
        needed = (offset or 0) + (limit if limit is not None else 10 ** 9)
        while len(collected) < needed:
            batch_domain = list(domain)
            if last_id is not None:
                batch_domain.append(('id', '<', last_id))
            batch = Notification.search(batch_domain, order='id desc', limit=SCAN_BATCH)
            if not batch:
                break
            last_id = batch.ids[-1]
            for row in batch:
                visible, live = self._row_visible(row)
                if not visible:
                    continue
                collected.append((row, live))
                if len(collected) >= needed:
                    break
        start = offset or 0
        if limit is None:
            return collected[start:]
        return collected[start:start + limit]

    def _visible_count(self, domain):
        Notification = request.env['mail.notification'].sudo()
        ordinary_domain = list(domain) + [
            ('mail_message_id.nasq_notification_kind', '!=', 'overdue_digest'),
        ]
        digest_domain = list(domain) + [
            ('mail_message_id.nasq_notification_kind', '=', 'overdue_digest'),
        ]
        total = Notification.search_count(ordinary_domain)
        last_id = None
        while True:
            batch_domain = list(digest_domain)
            if last_id is not None:
                batch_domain.append(('id', '<', last_id))
            batch = Notification.search(batch_domain, order='id desc', limit=SCAN_BATCH)
            if not batch:
                break
            last_id = batch.ids[-1]
            for row in batch:
                visible, _live = self._row_visible(row)
                if visible:
                    total += 1
        return total

    def _digest_row(self, notification_id):
        Notification = request.env['mail.notification'].sudo()
        rows = Notification.search(
            self._domain() + [
                ('id', '=', notification_id),
                ('mail_message_id.nasq_notification_kind', '=', 'overdue_digest'),
            ],
            limit=1,
        )
        if not rows:
            raise MissingError(request.env._('Notification does not exist'))
        visible, live = self._row_visible(rows)
        if not visible:
            raise MissingError(request.env._('Notification does not exist'))
        return rows, live

    @http.route('/api/v1/notifications', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
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
        task_ids = self._readable_active_task_ids()
        base_domain = self._domain(task_ids=task_ids)
        domain = self._domain(unread, task_ids=task_ids)
        rows = self._visible_rows(domain, limit=limit, offset=offset)
        return {
            'items': [dump_notification(row, live) for row, live in rows],
            'total': self._visible_count(domain),
            'unread_count': self._visible_count(base_domain + [('is_read', '=', False)]),
        }

    @http.route('/api/v1/notifications/<int:notification_id>/read', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    def mark_read(self, notification_id, **_):
        Notification = request.env['mail.notification'].sudo()
        rows = Notification.search(self._domain() + [('id', '=', notification_id)], limit=1)
        if not rows:
            raise MissingError(request.env._('Notification does not exist'))
        visible, _live = self._row_visible(rows)
        if not visible:
            raise MissingError(request.env._('Notification does not exist'))
        unread = rows.filtered(lambda row: not row.is_read)
        if unread:
            unread.write({'is_read': True})
        return {'updated': len(unread)}

    @http.route('/api/v1/notifications/read-all', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    def mark_all_read(self, **_):
        rows = self._visible_rows(self._domain() + [('is_read', '=', False)])
        count = len(rows)
        if rows:
            request.env['mail.notification'].sudo().browse([row.id for row, _live in rows]).write({'is_read': True})
        return {'updated': count}

    @http.route('/api/v1/notification-digests/<int:notification_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    def get_digest(self, notification_id, **_):
        args = request.httprequest.args
        limit = parse_nonneg_int(args.get('limit', 50), 'limit') or 50
        limit = min(limit, MAX_LIMIT)
        offset = parse_nonneg_int(args.get('offset', 0), 'offset')
        row, live = self._digest_row(notification_id)
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
