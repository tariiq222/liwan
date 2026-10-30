# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""liwan_pmo's notification kinds in the liwan_notify registry: tasks, the overdue digest and the charter approval.

Documented notification sudo: the candidate lookup below reads only the
current partner's own inbox rows; whether the task or project is still
readable is decided by an ordinary search in the caller's environment.
"""
from odoo import api, models

from odoo.addons.liwan_pmo.serializers.notification import (
    CHARTER_DECISION_KINDS,
    CHARTER_KINDS,
    CHARTER_REVIEW_KIND,
    dump_notification,
)

TASK_KINDS = ('assignment', 'comment', 'mention', 'deadline')
DIGEST_KIND = 'overdue_digest'


def recipient_candidate_ids(env, model, source_field):
    """Source record ids on inbox liwan rows of ``model`` owned by the current partner.

    The recipient restriction is in the domain before the elevated
    ``mail.notification`` read. This does not search the source model.
    """
    rows = env['mail.notification'].sudo().search([
        ('res_partner_id', '=', env.user.partner_id.id),
        ('mail_message_id.liwan_notification', '=', True),
        ('mail_message_id.model', '=', model),
        ('notification_type', '=', 'inbox'),
    ])
    return rows.mapped(f'mail_message_id.{source_field}').ids


def readable_active_task_ids(env, candidate_ids=None):
    """Caller-visible active current-company tasks among recipient candidates.

    Task search is never sudo'd. Company-less tasks stay excluded: the
    domain requires ``company_id`` of the current company on both the
    task and its project.
    """
    if not env['liwan.access.service']._liwan_has_capability(env.user, 'pmo.tasks.read') or not env['project.task'].has_access('read'):
        return []
    if candidate_ids is None:
        candidate_ids = recipient_candidate_ids(env, 'project.task', 'liwan_task_id')
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


def readable_active_project_ids(env):
    """Caller-visible active current-company projects among recipient candidates.

    Project search is never sudo'd, so the caller's record rules decide.
    """
    if not env['liwan.access.service']._liwan_has_capability(env.user, 'pmo.projects.read') or not env['project.project'].has_access('read'):
        return []
    candidate_ids = recipient_candidate_ids(env, 'project.project', 'liwan_project_id')
    if not candidate_ids:
        return []
    return env['project.project'].search([
        ('id', 'in', candidate_ids),
        ('active', '=', True),
        ('company_id', '=', env.company.id),
    ]).ids


def digest_live_tasks(env, row):
    """The digest's snapshot tasks the caller can still read, in the caller's environment."""
    Task = env['project.task']
    if not env['liwan.access.service']._liwan_has_capability(env.user, 'pmo.tasks.read') or not Task.has_access('read'):
        return Task.browse()
    snapshot = Task._liwan_digest_snapshot_ids(row.mail_message_id)
    return Task._liwan_live_digest_tasks(snapshot)


class LiwanPmoNotificationTypes(models.AbstractModel):
    _inherit = 'liwan.notify.registry'

    @api.model
    def _liwan_notification_types(self):
        return (
            *super()._liwan_notification_types(),
            *(
                {'kind': kind, 'owner': 'liwan_pmo', 'model': 'project.task', 'feature_key': 'pmo.enabled'}
                for kind in TASK_KINDS
            ),
            {'kind': DIGEST_KIND, 'owner': 'liwan_pmo', 'model': 'res.company', 'feature_key': 'pmo.enabled', 'live': True},
            *(
                {'kind': kind, 'owner': 'liwan_pmo', 'model': 'project.project', 'feature_key': 'pmo.enabled'}
                for kind in CHARTER_KINDS
            ),
        )

    @api.model
    def _liwan_notify_visible_domain(self):
        project_ids = readable_active_project_ids(self.env)
        # The review row only lives while that project's charter still waits for its sponsor.
        # Without readable projects there is nothing to search, and a caller without
        # pmo.projects.read must not reach the guarded project search at all.
        review_ids = self.env['project.project'].search([
            ('id', 'in', project_ids),
            ('liwan_charter_state', '=', 'submitted'),
            ('liwan_sponsor_id', '=', self.env.user.id),
        ]).ids if project_ids else []
        return [
            *super()._liwan_notify_visible_domain(),
            [
                ('mail_message_id.liwan_notification_kind', '=', DIGEST_KIND),
                ('mail_message_id.model', '=', 'res.company'),
                ('mail_message_id.res_id', 'in', self.env.companies.ids),
            ],
            [
                ('mail_message_id.liwan_notification_kind', 'in', list(TASK_KINDS)),
                ('mail_message_id.model', '=', 'project.task'),
                ('mail_message_id.liwan_task_id', 'in', readable_active_task_ids(self.env)),
            ],
            [
                ('mail_message_id.liwan_notification_kind', '=', CHARTER_REVIEW_KIND),
                ('mail_message_id.model', '=', 'project.project'),
                ('mail_message_id.liwan_project_id', 'in', review_ids),
            ],
            [
                ('mail_message_id.liwan_notification_kind', 'in', list(CHARTER_DECISION_KINDS)),
                ('mail_message_id.model', '=', 'project.project'),
                ('mail_message_id.liwan_project_id', 'in', project_ids),
            ],
        ]

    @api.model
    def _liwan_notify_row_visible(self, row):
        if row.mail_message_id.liwan_notification_kind != DIGEST_KIND:
            return super()._liwan_notify_row_visible(row)
        live = digest_live_tasks(self.env, row)
        return bool(live), live

    @api.model
    def _liwan_notify_dump(self, row, extra):
        if row.mail_message_id.liwan_notification_kind in (*TASK_KINDS, DIGEST_KIND, *CHARTER_KINDS):
            return dump_notification(row, extra)
        return super()._liwan_notify_dump(row, extra)
