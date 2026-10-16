# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models


class WebVueNotifyMailMessage(models.Model):
    """A bell row is a ``mail.message`` with these columns plus one inbox ``mail.notification``.

    The kind selection is empty here: each application adds its kinds with
    ``selection_add`` and registers them in ``webvue.notify.registry``. Names,
    labels and the index keep what the first producer created, so upgraded databases
    keep every row.
    """
    _inherit = 'mail.message'

    webvue_notification = fields.Boolean('webvue Notification', index=True, copy=False)
    webvue_notification_kind = fields.Selection([], string='webvue Notification Kind', copy=False, index=True)
    webvue_notification_key = fields.Char('webvue Notification Key', copy=False, index=True)

    _webvue_notification_key_unique = models.UniqueIndex(
        '(webvue_notification_key) WHERE webvue_notification_key IS NOT NULL',
    )
