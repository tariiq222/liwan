# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import TransactionCase, tagged


@tagged('post_install', '-at_install', 'liwan')
class TestRegisteredKindsAreSerialized(TransactionCase):
    """Guard: every kind an installed application registers has an owner that serializes it."""

    def test_every_registered_kind_has_a_serializer(self):
        registry = self.env['liwan.notify.registry']
        unserialized = []
        for kind in registry._liwan_notification_type_map():
            message = self.env['mail.message'].create({
                'model': 'res.partner', 'res_id': self.env.user.partner_id.id, 'message_type': 'notification',
                'liwan_notification': True, 'liwan_notification_kind': kind, 'body': 'x',
            })
            row = self.env['mail.notification'].create({
                'mail_message_id': message.id, 'res_partner_id': self.env.user.partner_id.id,
                'notification_type': 'inbox',
            })
            try:
                registry._liwan_notify_dump(row, None)
            except ValueError as error:
                if 'no owner serializes' in str(error):
                    unserialized.append(kind)
            except Exception:  # noqa: BLE001 - the owner's serializer ran on a bare row; only the missing owner matters here
                continue
        self.assertEqual(unserialized, [], 'registered notification kinds without a serializer')
