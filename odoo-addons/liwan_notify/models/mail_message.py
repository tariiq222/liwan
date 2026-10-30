# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models


class LiwanNotifyMailMessage(models.Model):
    """A bell row is a ``mail.message`` with these columns plus one inbox ``mail.notification``.

    The kind selection is empty here: each application adds its kinds with
    ``selection_add`` and registers them in ``liwan.notify.registry``. Names,
    labels and the index keep what the first producer created, so upgraded databases
    keep every row.
    """
    _inherit = 'mail.message'

    liwan_notification = fields.Boolean('liwan Notification', index=True, copy=False)
    liwan_notification_kind = fields.Selection([], string='liwan Notification Kind', copy=False, index=True)
    liwan_notification_key = fields.Char('liwan Notification Key', copy=False, index=True)

    _liwan_notification_key_unique = models.UniqueIndex(
        '(liwan_notification_key) WHERE liwan_notification_key IS NOT NULL',
    )
