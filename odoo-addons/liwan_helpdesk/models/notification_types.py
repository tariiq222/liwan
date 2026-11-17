# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The Support Desk notification kind: a ticket was assigned to me.

The bell row is owned by ``liwan_notify``; the application declares the kind and limits its rows to
the tickets the caller may read, so a bell never reveals a ticket outside the visibility policy.
"""
from odoo import api, models

from odoo.addons.liwan_api.serializers.common import iso

TICKET_MODEL = 'helpdesk.ticket'
ASSIGNED = 'helpdesk.assigned'
AUTO_CLOSED = 'helpdesk.auto_closed'
KINDS = (ASSIGNED, AUTO_CLOSED)
READ_KEYS = ('helpdesk.tickets.read', 'helpdesk.requests.read')


class LiwanHelpdeskNotificationTypes(models.AbstractModel):
    _inherit = 'liwan.notify.registry'

    @api.model
    def _liwan_notification_types(self):
        return (
            *super()._liwan_notification_types(),
            *({'kind': kind, 'owner': 'liwan_helpdesk', 'model': TICKET_MODEL, 'feature_key': 'helpdesk.enabled'}
              for kind in KINDS),
        )

    @api.model
    def _liwan_notify_visible_domain(self):
        service = self.env['liwan.access.service']
        keys = service._liwan_capability_keys(self.env.user)
        tickets = (
            self.env[TICKET_MODEL].search(self.env['liwan.helpdesk.visibility']._liwan_domain()).ids
            if any(key in keys for key in READ_KEYS) else []
        )
        return [
            *super()._liwan_notify_visible_domain(),
            [
                ('mail_message_id.liwan_notification_kind', 'in', KINDS),
                ('mail_message_id.model', '=', TICKET_MODEL),
                ('mail_message_id.res_id', 'in', tickets),
            ],
        ]

    @api.model
    def _liwan_notify_dump(self, row, extra):
        message = row.mail_message_id
        if message.liwan_notification_kind in KINDS:
            return {
                'id': row.id,
                'kind': message.liwan_notification_kind,
                'ticket_id': message.res_id,
                'title': message.subject or '',
                'created_at': iso(message.date),
                'is_read': bool(row.is_read),
                'href': '/helpdesk/%s' % message.res_id,
            }
        return super()._liwan_notify_dump(row, extra)
