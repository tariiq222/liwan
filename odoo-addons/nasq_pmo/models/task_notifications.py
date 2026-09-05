# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import timedelta

from psycopg2 import IntegrityError

from odoo import api, fields, models
from odoo.exceptions import AccessError
from odoo.tools import html2plaintext, plaintext2html


class ProjectTaskNotifications(models.Model):
    _inherit = 'project.task'

    @api.model_create_multi
    def create(self, vals_list):
        tasks = super().create(vals_list)
        for task in tasks:
            task._nasq_emit_assignment_notifications(task.user_ids)
        return tasks

    def write(self, vals):
        before = {task.id: set(task.user_ids.ids) for task in self}
        result = super().write(vals)
        if 'user_ids' in vals:
            for task in self:
                added = task.user_ids.filtered(lambda user: user.id not in before.get(task.id, set()))
                task._nasq_emit_assignment_notifications(added)
        return result

    def _nasq_internal_users(self, users=None):
        users = users if users is not None else self.user_ids
        return users.filtered(
            lambda user: (
                user.active and not user.share and user.partner_id
                and user.company_id == self.env.company
            ),
        )

    def _nasq_emit_assignment_notifications(self, users):
        self.ensure_one()
        actor = self.env.user
        recipients = self._nasq_internal_users(users).filtered(lambda user: user != actor)
        for user in recipients:
            self._nasq_create_notification(
                kind='assignment',
                partner=user.partner_id,
                body=f'{actor.display_name} assigned you to {self.display_name}',
            )

    def _nasq_emit_comment_notification(self, message):
        self.ensure_one()
        author = message.author_id
        recipients = self._nasq_internal_users().filtered(lambda user: not author or user.partner_id != author)
        body = html2plaintext(message.body or '', include_references=False).strip()
        if not body:
            return
        for user in recipients:
            self._nasq_create_notification(kind='comment', partner=user.partner_id, body=body)

    def _message_post_after_hook(self, message, msg_values):
        result = super()._message_post_after_hook(message, msg_values)
        if message.message_type == 'comment' and message.model == self._name and message.res_id in self.ids:
            self.browse(message.res_id)._nasq_emit_comment_notification(message)
        return result

    def _nasq_create_notification(self, *, kind, partner, body, key=None):
        self.ensure_one()
        Message = self.env['mail.message'].sudo()
        if key and Message.search_count([('nasq_notification_key', '=', key)]):
            return False
        values = {
            'model': self._name,
            'res_id': self.id,
            'nasq_task_id': self.id,
            'nasq_notification': True,
            'nasq_notification_kind': kind,
            'nasq_notification_key': key,
            'message_type': 'notification',
            'is_internal': True,
            'author_id': self.env.user.partner_id.id,
            'subtype_id': self.env.ref('mail.mt_note').id,
            'body': plaintext2html(body),
            'partner_ids': [(4, partner.id)],
        }
        try:
            # A flushing savepoint executes and clears every precommit callback
            # and policy marker. Keep notification uniqueness isolated without
            # flushing unrelated task/access operations mid-transaction.
            with self.env.cr.savepoint(flush=False):
                message = Message.create(values)
                self.env['mail.notification'].sudo().create({
                    'author_id': message.author_id.id,
                    'mail_message_id': message.id,
                    'notification_status': 'sent',
                    'notification_type': 'inbox',
                    'res_partner_id': partner.id,
                })
        except IntegrityError as error:
            # Concurrent cron workers may race on the deterministic key. The
            # unique index makes the loser a harmless retry; other integrity
            # failures must still reach the caller.
            constraint = getattr(getattr(error, 'diag', None), 'constraint_name', '')
            if key and 'nasq_notification_key' in constraint:
                return False
            raise
        return message

    @api.model
    def _nasq_run_deadline_notifications(self, now=None):
        now = now or fields.Datetime.now()
        company_id = self.env.company.id
        tasks = self.search([
            ('active', '=', True),
            ('company_id', '=', company_id),
            ('project_id.company_id', '=', company_id),
            ('project_id.active', '=', True),
            ('is_closed', '=', False),
            ('date_deadline', '!=', False),
        ])
        for task in tasks:
            for user in task._nasq_internal_users():
                recipient_task = task.with_user(user)
                try:
                    recipient_task.check_access('read')
                    recipient_task.project_id.check_access('read')
                except AccessError:
                    continue
                today = fields.Date.context_today(recipient_task, now)
                deadline_day = fields.Date.context_today(recipient_task, task.date_deadline)
                if deadline_day not in (today, today + timedelta(days=1)):
                    continue
                deadline = fields.Datetime.to_string(task.date_deadline)
                key = f'deadline:{task.id}:{user.partner_id.id}:{deadline}'
                task._nasq_create_notification(
                    kind='deadline',
                    partner=user.partner_id,
                    body=f'{task.display_name} is due on {deadline_day.isoformat()}',
                    key=key,
                )
        return True
