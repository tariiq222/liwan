# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The Operations application's notification kinds in the liwan_notify registry (no sudo)."""
from odoo import api, models

from odoo.addons.liwan_api.serializers.common import iso

REQUEST_MODEL = 'liwan.operation.request'
REVIEW_REQUESTED = 'operations.review_requested'
DECISION_KINDS = {'done': 'operations.approved', 'rejected': 'operations.rejected', 'returned': 'operations.returned'}
KINDS = (REVIEW_REQUESTED, *DECISION_KINDS.values())


class LiwanOperationsNotificationTypes(models.AbstractModel):
    _inherit = 'liwan.notify.registry'

    @api.model
    def _liwan_notification_types(self):
        return (
            *super()._liwan_notification_types(),
            *({'kind': kind, 'owner': 'liwan_operations', 'model': REQUEST_MODEL, 'feature_key': 'operations.enabled'}
              for kind in KINDS),
        )

    @api.model
    def _liwan_notify_visible_domain(self):
        Request = self.env[REQUEST_MODEL]
        allowed = (
            self.env['liwan.access.service']._liwan_has_capability(self.env.user, 'operations.requests.read')
            and Request.has_access('read')
        )
        ids = Request._search([]) if allowed else []
        return [
            *super()._liwan_notify_visible_domain(),
            [
                ('mail_message_id.liwan_notification_kind', 'in', KINDS),
                ('mail_message_id.model', '=', REQUEST_MODEL),
                ('mail_message_id.res_id', 'in', ids),
            ],
        ]

    @api.model
    def _liwan_notify_dump(self, row, extra):
        message = row.mail_message_id
        if message.liwan_notification_kind in KINDS:
            return {
                'id': row.id,
                'kind': message.liwan_notification_kind,
                'request_id': message.res_id,
                'title': message.subject or '',
                'created_at': iso(message.date),
                'is_read': bool(row.is_read),
            }
        return super()._liwan_notify_dump(row, extra)
