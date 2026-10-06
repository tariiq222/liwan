# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models


class NasqNotifyMailMessage(models.Model):
    """A bell row is a ``mail.message`` with these columns plus one inbox ``mail.notification``.

    The kind selection is empty here: each application adds its kinds with
    ``selection_add`` and registers them in ``nasq.notify.registry``. Names,
    labels and the index keep what the first producer created, so upgraded databases
    keep every row.
    """
    _inherit = 'mail.message'

    nasq_notification = fields.Boolean('nasq Notification', index=True, copy=False)
    nasq_notification_kind = fields.Selection([], string='nasq Notification Kind', copy=False, index=True)
    nasq_notification_key = fields.Char('nasq Notification Key', copy=False, index=True)

    _nasq_notification_key_unique = models.UniqueIndex(
        '(nasq_notification_key) WHERE nasq_notification_key IS NOT NULL',
    )
