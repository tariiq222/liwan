# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""nasq_pmo's notification kinds in the nasq_notify registry.

Tasks and the overdue digest belong to the project pillar. The meeting kinds
stay here until nasq_meetings exists (phase 2b-2). The bell's feature gate
checks the registered keys sorted, so the order of these classes does not
matter.

Documented notification sudo: the candidate lookups below read only the
current partner's own inbox rows; whether the task or meeting is still
readable is decided by an ordinary search in the caller's environment.
"""
from odoo import api, models

from odoo.addons.nasq_pmo.serializers.notification import dump_notification

TASK_KINDS = ('assignment', 'comment', 'mention', 'deadline')
DIGEST_KIND = 'overdue_digest'
MEETING_KINDS = (
    'meeting_invite', 'meeting_resolution', 'meeting_converted', 'meeting_changed',
    'meeting_cancelled', 'meeting_reminder', 'meeting_resolution_overdue',
)


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
    if not env['nasq.access.service']._nasq_has_capability(env.user, 'pmo.tasks.read') or not env['project.task'].has_access('read'):
        return []
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


def readable_active_meeting_ids(env):
    """Recipient-owned candidate ids, checked under the caller's meeting ACLs.

    Elevated notification reads do not grant access to the linked meeting.
    Explicit company scope also protects superusers with several companies.
    """
    Meeting = env['cyan.meeting.minute']
    if not env['nasq.access.service']._nasq_has_capability(env.user, 'meetings.read') or not Meeting.has_access('read'):
        return []
    rows = env['mail.notification'].sudo().search([
        ('res_partner_id', '=', env.user.partner_id.id),
        ('mail_message_id.nasq_notification', '=', True),
        ('mail_message_id.model', '=', 'cyan.meeting.minute'),
        ('notification_type', '=', 'inbox'),
    ])
    candidate_ids = rows.mapped('mail_message_id.nasq_meeting_id')
    if not candidate_ids:
        return []
    return Meeting.search([
        ('id', 'in', candidate_ids),
        ('company_id', '=', env.company.id),
        ('active', '=', True),
    ]).ids


def digest_live_tasks(env, row):
    """The digest's snapshot tasks the caller can still read, in the caller's environment."""
    Task = env['project.task']
    if not env['nasq.access.service']._nasq_has_capability(env.user, 'pmo.tasks.read') or not Task.has_access('read'):
        return Task.browse()
    snapshot = Task._nasq_digest_snapshot_ids(row.mail_message_id)
    return Task._nasq_live_digest_tasks(snapshot)


class NasqPmoTaskNotificationTypes(models.AbstractModel):
    _inherit = 'nasq.notify.registry'

    @api.model
    def _nasq_notification_types(self):
        return (
            *super()._nasq_notification_types(),
            *(
                {'kind': kind, 'owner': 'nasq_pmo', 'model': 'project.task', 'feature_key': 'pmo.enabled'}
                for kind in TASK_KINDS
            ),
            {'kind': DIGEST_KIND, 'owner': 'nasq_pmo', 'model': 'res.company', 'feature_key': 'pmo.enabled', 'live': True},
        )

    @api.model
    def _nasq_notify_visible_domain(self):
        return [
            *super()._nasq_notify_visible_domain(),
            [
                ('mail_message_id.nasq_notification_kind', '=', DIGEST_KIND),
                ('mail_message_id.model', '=', 'res.company'),
                ('mail_message_id.res_id', '=', self.env.company.id),
            ],
            [
                ('mail_message_id.nasq_notification_kind', 'in', list(TASK_KINDS)),
                ('mail_message_id.model', '=', 'project.task'),
                ('mail_message_id.nasq_task_id', 'in', readable_active_task_ids(self.env)),
            ],
        ]

    @api.model
    def _nasq_notify_row_visible(self, row):
        if row.mail_message_id.nasq_notification_kind != DIGEST_KIND:
            return super()._nasq_notify_row_visible(row)
        live = digest_live_tasks(self.env, row)
        return bool(live), live

    @api.model
    def _nasq_notify_dump(self, row, extra):
        if row.mail_message_id.nasq_notification_kind in (*TASK_KINDS, DIGEST_KIND):
            return dump_notification(row, extra)
        return super()._nasq_notify_dump(row, extra)


class NasqPmoMeetingNotificationTypes(models.AbstractModel):
    _inherit = 'nasq.notify.registry'

    @api.model
    def _nasq_notification_types(self):
        return (
            *super()._nasq_notification_types(),
            *(
                {'kind': kind, 'owner': 'nasq_pmo', 'model': 'cyan.meeting.minute', 'feature_key': 'meetings.enabled'}
                for kind in MEETING_KINDS
            ),
        )

    @api.model
    def _nasq_notify_visible_domain(self):
        meeting_ids = readable_active_meeting_ids(self.env)
        return [
            *super()._nasq_notify_visible_domain(),
            [
                ('mail_message_id.nasq_notification_kind', 'in', list(MEETING_KINDS)),
                ('mail_message_id.model', '=', 'cyan.meeting.minute'),
                ('mail_message_id.res_id', 'in', meeting_ids),
                ('mail_message_id.nasq_meeting_id', 'in', meeting_ids),
            ],
        ]

    @api.model
    def _nasq_notify_dump(self, row, extra):
        if row.mail_message_id.nasq_notification_kind in MEETING_KINDS:
            return dump_notification(row, extra)
        return super()._nasq_notify_dump(row, extra)
