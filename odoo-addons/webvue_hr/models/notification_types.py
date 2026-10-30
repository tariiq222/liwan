# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The HR application's notification kinds in the webvue_notify registry (no sudo)."""
from odoo import api, models

from odoo.addons.webvue_api.serializers.common import iso

LEAVE_MODEL = 'hr.leave'
# hr.leave state after a decision -> bell kind. ``validate1`` (first of two approvals) is no decision yet.
DECISION_KINDS = {'validate': 'hr.leave_approved', 'refuse': 'hr.leave_refused'}
KINDS = tuple(DECISION_KINDS.values())


class WebVueHrNotificationTypes(models.AbstractModel):
    _inherit = 'webvue.notify.registry'

    @api.model
    def _webvue_notification_types(self):
        return (
            *super()._webvue_notification_types(),
            *({'kind': kind, 'owner': 'webvue_hr', 'model': LEAVE_MODEL, 'feature_key': 'hr.enabled'} for kind in KINDS),
        )

    @api.model
    def _webvue_notify_visible_domain(self):
        Leave = self.env[LEAVE_MODEL]
        allowed = (
            self.env['webvue.access.service']._webvue_has_capability(self.env.user, 'hr.leave.read')
            and Leave.has_access('read')
        )
        # A decision row is the employee's own: only their own requests, in the caller's record rules.
        ids = Leave._search([('employee_id.user_id', '=', self.env.uid)]) if allowed else []
        return [
            *super()._webvue_notify_visible_domain(),
            [
                ('mail_message_id.webvue_notification_kind', 'in', KINDS),
                ('mail_message_id.model', '=', LEAVE_MODEL),
                ('mail_message_id.res_id', 'in', ids),
            ],
        ]

    @api.model
    def _webvue_notify_dump(self, row, extra):
        message = row.mail_message_id
        if message.webvue_notification_kind in KINDS:
            return {
                'id': row.id,
                'kind': message.webvue_notification_kind,
                'leave_id': message.res_id,
                'title': message.subject or '',
                'created_at': iso(message.date),
                'is_read': bool(row.is_read),
            }
        return super()._webvue_notify_dump(row, extra)
