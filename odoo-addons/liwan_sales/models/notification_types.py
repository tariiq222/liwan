# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The Sales application's notification kind in the liwan_notify registry.

No sudo here: a bell row shows only while its order is still readable by the caller, in the working company, under the
visibility setting. A recipient who lost ``sales.read`` or whose order changed hands sees nothing.
"""
from odoo import api, models

from .access_service import READ
from odoo.addons.liwan_api.serializers.common import iso

KIND = 'sales.answered'
# What the customer did: accepted, accepted with a signature, or declined.
ANSWERS = [('accepted', 'Accepted'), ('signed', 'Signed'), ('declined', 'Declined')]


class LiwanSalesNotificationTypes(models.AbstractModel):
    _inherit = 'liwan.notify.registry'

    @api.model
    def _liwan_notification_types(self):
        return (
            *super()._liwan_notification_types(),
            {'kind': KIND, 'owner': 'liwan_sales', 'model': 'sale.order', 'feature_key': 'sales.enabled'},
        )

    @api.model
    def _liwan_notify_visible_domain(self):
        Order = self.env['sale.order']
        allowed = self.env['liwan.access.service']._liwan_has_capability(self.env.user, READ) and Order.has_access('read')
        ids = Order._search(self.env['liwan.sales.visibility']._liwan_domain(self.env.user)) if allowed else []
        return [
            *super()._liwan_notify_visible_domain(),
            [
                ('mail_message_id.liwan_notification_kind', '=', KIND),
                ('mail_message_id.model', '=', 'sale.order'),
                ('mail_message_id.res_id', 'in', ids),
            ],
        ]

    @api.model
    def _liwan_notify_dump(self, row, extra):
        message = row.mail_message_id
        if message.liwan_notification_kind == KIND:
            return {
                'id': row.id,
                'kind': KIND,
                'order_id': message.res_id,
                'answer': message.liwan_sales_answer,
                'title': message.liwan_sales_order_name or '',
                'created_at': iso(message.date),
                'is_read': bool(row.is_read),
            }
        return super()._liwan_notify_dump(row, extra)
