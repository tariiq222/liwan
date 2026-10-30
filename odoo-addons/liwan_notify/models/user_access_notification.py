# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The platform's own bell kind: a user is told when an administrator changes their roles or role permissions.

It belongs to no application, so it has no feature key and is never switched off with one.
"""
from odoo import api, fields, models
from odoo.tools import html2plaintext

from odoo.addons.liwan_api.serializers.common import iso

KIND = 'access_changed'
USER_MODEL = 'res.users'
BODY = 'تم تغيير أدوارك أو صلاحياتك. قد تتغير الصفحات المتاحة لك.'


class LiwanNotifyAccessMessage(models.Model):
    _inherit = 'mail.message'

    liwan_notification_kind = fields.Selection(
        selection_add=[(KIND, 'Access changed')], ondelete={KIND: 'cascade'},
    )


class LiwanNotifyAccessTypes(models.AbstractModel):
    _inherit = 'liwan.notify.registry'

    @api.model
    def _liwan_notification_types(self):
        return (
            *super()._liwan_notification_types(),
            {'kind': KIND, 'owner': 'liwan_notify', 'model': USER_MODEL},
        )

    @api.model
    def _liwan_notify_visible_domain(self):
        return [
            *super()._liwan_notify_visible_domain(),
            [
                ('mail_message_id.liwan_notification_kind', '=', KIND),
                ('mail_message_id.model', '=', USER_MODEL),
                ('mail_message_id.res_id', '=', self.env.user.id),
            ],
        ]

    @api.model
    def _liwan_notify_dump(self, row, extra):
        message = row.mail_message_id
        if message.liwan_notification_kind == KIND:
            return {
                'id': row.id,
                'kind': KIND,
                'title': html2plaintext(message.body).strip(),
                'created_at': iso(message.date),
                'is_read': bool(row.is_read),
            }
        return super()._liwan_notify_dump(row, extra)


class LiwanNotifyAccessService(models.AbstractModel):
    _inherit = 'liwan.access.service'

    @api.model
    def _liwan_access_changed(self, users):
        super()._liwan_access_changed(users)
        for user in users:
            if user != self.env.user and user.active:
                self.env['liwan.notify.service']._liwan_deliver(
                    USER_MODEL, user.id, KIND, user.partner_id, BODY,
                )
