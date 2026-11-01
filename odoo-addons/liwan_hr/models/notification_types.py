# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The HR application's notification kinds in the liwan_notify registry (no sudo)."""
from odoo import api, models

from odoo.addons.liwan_api.serializers.common import iso

LEAVE_MODEL = 'hr.leave'
# hr.leave state after a decision -> bell kind. ``validate1`` (first of two approvals) is no decision yet.
DECISION_KINDS = {'validate': 'hr.leave_approved', 'refuse': 'hr.leave_refused'}
KINDS = tuple(DECISION_KINDS.values())
RUN_MODEL = 'liwan.hr.plan.run'
STEP_KIND = 'hr.onboarding_step'
WARNING_MODEL = 'liwan.hr.warning'
WARNING_KIND = 'hr.warning_issued'


class LiwanHrNotificationTypes(models.AbstractModel):
    _inherit = 'liwan.notify.registry'

    @api.model
    def _liwan_notification_types(self):
        return (
            *super()._liwan_notification_types(),
            *({'kind': kind, 'owner': 'liwan_hr', 'model': LEAVE_MODEL, 'feature_key': 'hr.enabled'} for kind in KINDS),
            {'kind': STEP_KIND, 'owner': 'liwan_hr', 'model': RUN_MODEL, 'feature_key': 'hr.enabled'},
            {'kind': WARNING_KIND, 'owner': 'liwan_hr', 'model': WARNING_MODEL, 'feature_key': 'hr.warnings'},
        )

    @api.model
    def _liwan_notify_visible_domain(self):
        Leave = self.env[LEAVE_MODEL]
        allowed = (
            self.env['liwan.access.service']._liwan_has_capability(self.env.user, 'hr.leave.read')
            and Leave.has_access('read')
        )
        # A decision row is the employee's own: only their own requests, in the caller's record rules.
        ids = Leave._search([('employee_id.user_id', '=', self.env.uid)]) if allowed else []
        # A step row is anchored on the onboarding run: the caller's own record rules decide which runs they read.
        Run = self.env[RUN_MODEL]
        run_ids = Run._search([('hr_purpose', '=', 'onboarding')]) if Run.has_access('read') else []
        # A warning row is the employee's own: only warnings issued to their own record, in the caller's record rules.
        Warning = self.env[WARNING_MODEL]
        warning_ids = Warning._search([('employee_user_id', '=', self.env.uid)]) if Warning.has_access('read') else []
        return [
            *super()._liwan_notify_visible_domain(),
            [
                ('mail_message_id.liwan_notification_kind', 'in', KINDS),
                ('mail_message_id.model', '=', LEAVE_MODEL),
                ('mail_message_id.res_id', 'in', ids),
            ],
            [
                ('mail_message_id.liwan_notification_kind', '=', STEP_KIND),
                ('mail_message_id.model', '=', RUN_MODEL),
                ('mail_message_id.res_id', 'in', run_ids),
            ],
            [
                ('mail_message_id.liwan_notification_kind', '=', WARNING_KIND),
                ('mail_message_id.model', '=', WARNING_MODEL),
                ('mail_message_id.res_id', 'in', warning_ids),
            ],
        ]

    @api.model
    def _liwan_notify_dump(self, row, extra):
        message = row.mail_message_id
        if message.liwan_notification_kind in KINDS:
            return {
                'id': row.id,
                'kind': message.liwan_notification_kind,
                'leave_id': message.res_id,
                'title': message.subject or '',
                'created_at': iso(message.date),
                'is_read': bool(row.is_read),
            }
        if message.liwan_notification_kind == STEP_KIND:
            return {
                'id': row.id,
                'kind': STEP_KIND,
                'run_id': message.res_id,
                'title': message.subject or '',
                'created_at': iso(message.date),
                'is_read': bool(row.is_read),
            }
        if message.liwan_notification_kind == WARNING_KIND:
            return {
                'id': row.id,
                'kind': WARNING_KIND,
                'warning_id': message.res_id,
                'title': message.subject or '',
                'created_at': iso(message.date),
                'is_read': bool(row.is_read),
            }
        return super()._liwan_notify_dump(row, extra)
