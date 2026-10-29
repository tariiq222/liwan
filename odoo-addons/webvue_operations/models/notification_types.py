# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The Operations application's notification kinds in the webvue_notify registry (no sudo)."""
from odoo import api, models

from odoo.addons.webvue_api.serializers.common import iso

REQUEST_MODEL = 'webvue.operation.request'
REVIEW_REQUESTED = 'operations.review_requested'
DECISION_KINDS = {'done': 'operations.approved', 'rejected': 'operations.rejected', 'returned': 'operations.returned'}
KINDS = (REVIEW_REQUESTED, *DECISION_KINDS.values())


class WebVueOperationsNotificationTypes(models.AbstractModel):
    _inherit = 'webvue.notify.registry'

    @api.model
    def _webvue_notification_types(self):
        return (
            *super()._webvue_notification_types(),
            *({'kind': kind, 'owner': 'webvue_operations', 'model': REQUEST_MODEL, 'feature_key': 'operations.enabled'}
              for kind in KINDS),
        )

    @api.model
    def _webvue_notify_visible_domain(self):
        Request = self.env[REQUEST_MODEL]
        allowed = (
            self.env['webvue.access.service']._webvue_has_capability(self.env.user, 'operations.requests.read')
            and Request.has_access('read')
        )
        ids = Request._search([]) if allowed else []
        return [
            *super()._webvue_notify_visible_domain(),
            [
                ('mail_message_id.webvue_notification_kind', 'in', KINDS),
                ('mail_message_id.model', '=', REQUEST_MODEL),
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
                'request_id': message.res_id,
                'title': message.subject or '',
                'created_at': iso(message.date),
                'is_read': bool(row.is_read),
            }
        return super()._webvue_notify_dump(row, extra)
