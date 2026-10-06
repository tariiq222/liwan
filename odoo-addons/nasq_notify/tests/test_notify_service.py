# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import ValidationError
from odoo.tests import TransactionCase, new_test_user, tagged
from odoo.tools import mute_logger

from odoo.addons.nasq_api.tests.common import PROBE_FEATURE
from odoo.addons.nasq_notify.tests.common import PROBE_TYPES, NotifyProbe


@tagged('post_install', '-at_install', 'nasq')
class TestNotifyService(NotifyProbe, TransactionCase):

    def setUp(self):
        super().setUp()
        self.reader = new_test_user(self.env, login='notify_reader', name='Reader', groups='base.group_user')
        self.other = new_test_user(self.env, login='notify_other', name='Other', groups='base.group_user')
        # Users first: with project installed, creating a user assigns an
        # onboarding task, which delivers a PMO kind the probe registry hides.
        self._install_probe()
        self.sources = self.env['res.partner'].create([{'name': f'Notify source {index}'} for index in range(3)])
        self.service = self.env['nasq.notify.service']
        self.registry_model = type(self.env['nasq.notify.registry'])

    def _deliver(self, source, partners, kind='probe_ping', key=None, values=None):
        return self.service._nasq_deliver(
            'res.partner', source.id, kind, partners, f'About {source.name}', key=key, values=values,
        )

    def test_services_are_global(self):
        self.assertEqual(self.env['nasq.notify.service']._nasq_scope, 'global')
        self.assertEqual(self.env['nasq.notify.registry']._nasq_scope, 'global')

    def test_registry_keeps_registration_order(self):
        registry = self.env['nasq.notify.registry']
        self.assertEqual(list(registry._nasq_notification_type_map()), ['probe_ping', 'probe_live'])
        self.assertEqual(registry._nasq_notify_feature_keys(), (PROBE_FEATURE,))
        self.assertEqual(registry._nasq_notify_live_kinds(), ('probe_live',))
        self.patch(self.registry_model, '_nasq_notification_types', lambda model: (
            {**PROBE_TYPES[0], 'feature_key': 'b.enabled'},
            {**PROBE_TYPES[1], 'feature_key': 'a.enabled'},
        ))
        self.assertEqual(registry._nasq_notify_feature_keys(), ('b.enabled', 'a.enabled'))

    def test_registry_refuses_bad_descriptors(self):
        registry = self.env['nasq.notify.registry']
        cases = (
            ((PROBE_TYPES[0], PROBE_TYPES[0]), 'duplicate notification kind probe_ping'),
            (({**PROBE_TYPES[0], 'feature_key': ''},), 'probe_ping is missing feature_key'),
            (({**PROBE_TYPES[0], 'kind': 'probe_unknown'},), 'probe_unknown is not a mail.message selection value'),
            (({**PROBE_TYPES[0], 'kind': None},), 'missing a kind'),
        )
        for types, message in cases:
            with self.subTest(message=message):
                self.patch(self.registry_model, '_nasq_notification_types', lambda model, types=types: types)
                with self.assertRaisesRegex(ValidationError, message):
                    registry._nasq_notification_type_map()

    def test_delivery_creates_one_inbox_row_per_partner_and_no_mail(self):
        source = self.sources[0]
        partners = self.reader.partner_id | self.other.partner_id
        messages = self._deliver(source, partners)
        self.assertEqual(len(messages), 2)
        for message in messages:
            self.assertEqual((message.model, message.res_id), ('res.partner', source.id))
            self.assertTrue(message.nasq_notification)
            self.assertEqual(message.nasq_notification_kind, 'probe_ping')
            self.assertFalse(message.nasq_notification_key)
            self.assertEqual((message.message_type, message.is_internal), ('notification', True))
            self.assertEqual(message.subtype_id, self.env.ref('mail.mt_note'))
            self.assertIn(f'About {source.name}', message.body)
        rows = messages.notification_ids
        self.assertEqual(len(rows), 2)
        self.assertEqual(sorted(rows.res_partner_id.ids), sorted(partners.ids))
        self.assertTrue(all(
            row.notification_type == 'inbox' and row.notification_status == 'sent' and not row.mail_mail_id
            for row in rows
        ))

    def test_a_key_delivers_once_and_is_stored_verbatim(self):
        key = f'probe:{self.sources[0].id}:{self.reader.partner_id.id}'
        first = self._deliver(self.sources[0], self.reader.partner_id, key=key)
        second = self._deliver(self.sources[0], self.reader.partner_id, key=key)
        self.assertEqual(first.nasq_notification_key, key)
        self.assertFalse(second)
        self.assertEqual(self.env['mail.message'].sudo().search_count([('nasq_notification_key', '=', key)]), 1)

    @mute_logger('odoo.sql_db')
    def test_a_concurrent_duplicate_key_is_skipped(self):
        key = f'probe-race:{self.reader.partner_id.id}'
        self._deliver(self.sources[0], self.reader.partner_id, key=key)
        # A second worker passed the pre-check before the first one committed.
        self.patch(type(self.service), '_nasq_key_taken', lambda model, key: False)
        self.assertFalse(self._deliver(self.sources[0], self.reader.partner_id, key=key))
        self.assertEqual(self.env['mail.message'].sudo().search_count([('nasq_notification_key', '=', key)]), 1)
        self.assertEqual(len(self._deliver(self.sources[1], self.reader.partner_id)), 1, 'the transaction stays usable')

    def test_delivery_refuses_unknown_kinds_shared_keys_and_generic_values(self):
        with self.assertRaisesRegex(ValueError, "kind 'probe_unknown' is not registered"):
            self._deliver(self.sources[0], self.reader.partner_id, kind='probe_unknown')
        with self.assertRaisesRegex(ValueError, 'a delivery key names one recipient'):
            self._deliver(self.sources[0], self.reader.partner_id | self.other.partner_id, key='probe:shared')
        with self.assertRaisesRegex(ValueError, r"values may not set \['model'\]"):
            self._deliver(self.sources[0], self.reader.partner_id, values={'model': 'res.users'})
        self.assertFalse(self.env['mail.message'].sudo().search_count([
            ('nasq_notification', '=', True), ('model', '=', 'res.partner'), ('res_id', 'in', self.sources.ids),
        ]))

    def test_values_carry_the_owner_columns(self):
        message = self._deliver(self.sources[0], self.reader.partner_id, values={'subject': 'Owner column'})
        self.assertEqual(message.subject, 'Owner column')
