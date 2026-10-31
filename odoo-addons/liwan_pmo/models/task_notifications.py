# Part of Odoo. See LICENSE file for full copyright and licensing details.
import json
from datetime import datetime, time, timedelta

from pytz import UTC
from pytz import timezone as pytz_timezone
from pytz.exceptions import UnknownTimeZoneError

from odoo import api, fields, models
from odoo.exceptions import AccessError

from odoo.addons.liwan_pmo.serializers.notification import notification_text

SCAN_BATCH = 200


def _liwan_iter_records(model, domain):
    last_id = 0
    while True:
        batch = model.search(domain + [('id', '>', last_id)], order='id', limit=SCAN_BATCH)
        if not batch:
            break
        yield batch
        last_id = batch.ids[-1]


def local_date_start_utc(user, local_date):
    if not local_date:
        return fields.Datetime.now()
    try:
        tzinfo = pytz_timezone(user.tz or 'UTC')
    except UnknownTimeZoneError:
        tzinfo = UTC
    return tzinfo.localize(datetime.combine(local_date, time.min)).astimezone(UTC).replace(tzinfo=None)


class ProjectTaskNotifications(models.Model):
    _inherit = 'project.task'

    @api.model_create_multi
    def create(self, vals_list):
        tasks = super().create(vals_list)
        for task in tasks:
            task._liwan_emit_assignment_notifications(task.user_ids)
        return tasks

    def write(self, vals):
        before = {task.id: set(task.user_ids.ids) for task in self}
        result = super().write(vals)
        if 'user_ids' in vals:
            for task in self:
                added = task.user_ids.filtered(lambda user: user.id not in before.get(task.id, set()))
                task._liwan_emit_assignment_notifications(added)
        return result

    def _liwan_internal_users(self, users=None):
        users = users if users is not None else self.user_ids
        return users.filtered(
            lambda user: (
                user.active and not user.share and user.partner_id
                and user.company_id == self.env.company
            ),
        )

    def _liwan_emit_assignment_notifications(self, users):
        self.ensure_one()
        actor = self.env.user
        recipients = self._liwan_internal_users(users).filtered(lambda user: user != actor)
        for user in recipients:
            self._liwan_create_notification(
                kind='assignment',
                partner=user.partner_id,
                body=f'{actor.display_name} assigned you to {self.display_name}',
            )

    def _liwan_emit_comment_notification(self, message):
        self.ensure_one()
        author = message.author_id
        # A mentioned person gets one `mention` row, never a second `comment` row. A mention
        # only reaches someone who can read this task, checked as that person.
        mentioned = self._liwan_internal_users(
            self.env['res.users'].browse(self.env.context.get('liwan_mention_user_ids') or []),
        ).filtered(lambda user: (not author or user.partner_id != author) and self.with_user(user).has_access('read'))
        recipients = self._liwan_internal_users().filtered(
            lambda user: (not author or user.partner_id != author) and user not in mentioned,
        )
        body = notification_text(message.body)
        if not body:
            return
        for user in mentioned:
            self._liwan_create_notification(kind='mention', partner=user.partner_id, body=body)
        for user in recipients:
            self._liwan_create_notification(kind='comment', partner=user.partner_id, body=body)

    def _liwan_request_completion(self):
        result = super()._liwan_request_completion()
        self._liwan_emit_completion_notice(
            'completion_requested', self._liwan_completion_reviewer(),
            f'{self.env.user.display_name} asked for completion of {self.display_name}',
        )
        return result

    def _liwan_accept_completion(self, revision):
        requester = self.liwan_completion_requested_by
        result = super()._liwan_accept_completion(revision)
        self._liwan_emit_completion_notice(
            'completion_accepted', requester,
            f'{self.env.user.display_name} accepted completion of {self.display_name}',
        )
        return result

    def _liwan_emit_completion_notice(self, kind, user, body):
        """One bell row for the other side of a completion request.

        The operations bridge sets ``liwan_skip_completion_notice``: its own bell already
        tells the stage reviewers and the requester, so a second PMO row would duplicate it.
        """
        self.ensure_one()
        if self.env.context.get('liwan_skip_completion_notice'):
            return
        recipients = self._liwan_internal_users(user).filtered(lambda recipient: recipient != self.env.user)
        for recipient in recipients:
            self._liwan_create_notification(
                kind=kind,
                partner=recipient.partner_id,
                body=body,
                key=f'{kind}:{self.id}:{recipient.partner_id.id}:{self.liwan_completion_revision}',
            )

    def _message_post_after_hook(self, message, msg_values):
        result = super()._message_post_after_hook(message, msg_values)
        if message.message_type == 'comment' and message.model == self._name and message.res_id in self.ids:
            self.browse(message.res_id)._liwan_emit_comment_notification(message)
        return result

    def _liwan_create_notification(self, *, kind, partner, body, key=None):
        self.ensure_one()
        messages = self.env['liwan.notify.service']._liwan_deliver(
            self._name, self.id, kind, partner, body, key=key, values={'liwan_task_id': self.id},
        )
        return messages or False

    @api.model
    def _liwan_user_local_now(self, user, now):
        tz_name = user.tz or 'UTC'
        try:
            tzinfo = pytz_timezone(tz_name)
        except UnknownTimeZoneError:
            tzinfo = UTC
        utc_now = UTC.localize(now) if now.tzinfo is None else now.astimezone(UTC)
        return utc_now.astimezone(tzinfo)

    @api.model
    def _liwan_create_digest_notification(self, *, company, partner, body, key, overdue_count, local_date, task_ids=()):
        messages = self.env['liwan.notify.service']._liwan_deliver(
            'res.company', company.id, 'overdue_digest', partner, body, key=key,
            values={
                'liwan_task_id': False,
                'liwan_digest_count': overdue_count,
                'liwan_digest_date': local_date,
                'liwan_digest_task_ids': json.dumps([int(task_id) for task_id in task_ids]),
            },
        )
        return messages or False

    @api.model
    def _liwan_digest_snapshot_ids(self, message):
        raw = message.liwan_digest_task_ids
        if not raw:
            return []
        try:
            parsed = json.loads(raw)
        except ValueError:
            return []
        return [int(item) for item in parsed if isinstance(item, int) and not isinstance(item, bool) and item > 0]

    @api.model
    def _liwan_live_digest_tasks(self, snapshot_ids):
        """Visible members of a historical snapshot.

        Membership stays the original snapshot: later deadline edits do not
        admit new tasks. Callers must search in the user env; there is no
        sudo fallback.
        """
        if not snapshot_ids:
            return self.browse()
        # The digest follows the request's pinned company subtree: a parent
        # session sees its branches' digests, a branch session only its own.
        return self.search([
            ('id', 'in', snapshot_ids),
            ('active', '=', True),
            ('is_closed', '=', False),
            ('company_id', 'in', self.env.companies.ids),
            ('project_id.company_id', 'in', self.env.companies.ids),
            ('project_id.active', '=', True),
        ])

    @api.model
    def _liwan_run_deadline_notifications(self, now=None):
        now = now or fields.Datetime.now()
        companies = self.env['res.company'].search([], order='id')
        for company in companies:
            self.with_company(company)._liwan_run_deadline_notifications_for_company(now)
        return True

    @api.model
    def _liwan_run_deadline_notifications_for_company(self, now):
        company = self.env.company
        settings = self.env['liwan.pmo.settings'].get()
        company_id = company.id
        if settings['deadline_reminders_enabled']:
            days_before = settings['deadline_reminders_days_before']
            window_start = now - timedelta(hours=25)
            window_end = now + timedelta(days=days_before) + timedelta(hours=25)
            domain = [
                ('active', '=', True),
                ('company_id', '=', company_id),
                ('project_id.company_id', '=', company_id),
                ('project_id.active', '=', True),
                ('is_closed', '=', False),
                ('date_deadline', '>=', window_start),
                ('date_deadline', '<=', window_end),
            ]
            for batch in _liwan_iter_records(self, domain):
                for task in batch:
                    for user in task._liwan_internal_users():
                        tz_name = user.tz or 'UTC'
                        try:
                            pytz_timezone(tz_name)
                        except UnknownTimeZoneError:
                            tz_name = 'UTC'
                        recipient_task = task.with_user(user).with_context(tz=tz_name)
                        try:
                            recipient_task.check_access('read')
                            recipient_task.project_id.check_access('read')
                        except AccessError:
                            continue
                        today = fields.Date.context_today(recipient_task, now)
                        deadline_day = fields.Date.context_today(recipient_task, task.date_deadline)
                        remaining = (deadline_day - today).days
                        if remaining < 0 or remaining > days_before:
                            continue
                        deadline = fields.Datetime.to_string(task.date_deadline)
                        key = f'deadline:{task.id}:{user.partner_id.id}:{deadline}'
                        task._liwan_create_notification(
                            kind='deadline',
                            partner=user.partner_id,
                            body=f'{task.display_name} is due on {deadline_day.isoformat()}',
                            key=key,
                        )
        if settings['overdue_digest_enabled']:
            self._liwan_run_overdue_digest(now)

    @api.model
    def _liwan_run_overdue_digest(self, now):
        company = self.env.company
        # The cron runs as base.user_root (superuser), so it scans every
        # current-company row; live visibility is re-checked as each manager
        # before delivery.
        project_domain = [
            ('active', '=', True),
            ('company_id', '=', company.id),
            ('user_id', '!=', False),
        ]
        by_manager = {}
        for batch in _liwan_iter_records(self.env['project.project'], project_domain):
            for project in batch:
                manager = project.user_id
                if not manager or not manager.active or manager.share:
                    continue
                if company.id not in manager.company_ids.ids:
                    continue
                grouped = by_manager.get(manager.id)
                by_manager[manager.id] = project if grouped is None else grouped | project
        Task = self.env['project.task']
        for manager_id, manager_projects in by_manager.items():
            manager = self.env['res.users'].browse(manager_id)
            local_now = self._liwan_user_local_now(manager, now)
            if local_now.hour < 9:
                continue
            local_date = local_now.date()
            start_utc = local_date_start_utc(manager, local_date)
            overdue_domain = [
                ('active', '=', True),
                ('company_id', '=', company.id),
                ('project_id', 'in', manager_projects.ids),
                ('project_id.company_id', '=', company.id),
                ('project_id.active', '=', True),
                ('is_closed', '=', False),
                ('date_deadline', '!=', False),
                ('date_deadline', '<', start_utc),
            ]
            visible = Task.browse()
            for batch in _liwan_iter_records(Task, overdue_domain):
                for task in batch:
                    recipient_task = task.with_user(manager).with_company(company)
                    try:
                        recipient_task.check_access('read')
                        recipient_task.project_id.check_access('read')
                    except AccessError:
                        continue
                    visible |= task
            if not visible:
                continue
            key = f'overdue_digest:{company.id}:{manager.partner_id.id}:{local_date.isoformat()}'
            self._liwan_create_digest_notification(
                company=company,
                partner=manager.partner_id,
                body=f'{len(visible)} overdue tasks',
                key=key,
                overdue_count=len(visible),
                local_date=local_date,
                task_ids=visible.ids,
            )
