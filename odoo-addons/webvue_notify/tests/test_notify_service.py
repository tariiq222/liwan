# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import AccessError, MissingError, ValidationError
from odoo.tests import TransactionCase, new_test_user, tagged
from odoo.tools import mute_logger

from odoo.addons.webvue_api.tests.common import PROBE_FEATURE, set_probe_feature
from odoo.addons.webvue_core.models.access_service import WebVueAccessRule
from odoo.addons.webvue_notify.tests.common import PROBE_TYPES, NotifyProbe


@tagged('post_install', '-at_install', 'webvue')
class TestNotifyService(NotifyProbe, TransactionCase):

    def setUp(self):
        super().setUp()
        self.reader = new_test_user(self.env, login='notify_reader', name='Reader', groups='base.group_user')
        self.other = new_test_user(self.env, login='notify_other', name='Other', groups='base.group_user')
        # Users first: with project installed, creating a user assigns an
        # onboarding task, which delivers a PMO kind the probe registry hides.
        self._install_probe()
        self.sources = self.env['res.partner'].create([{'name': f'Notify source {index}'} for index in range(3)])
        self.service = self.env['webvue.notify.service']
        self.registry_model = type(self.env['webvue.notify.registry'])

    def _deliver(self, source, partners, kind='probe_ping', key=None, values=None):
        return self.service._webvue_deliver(
            'res.partner', source.id, kind, partners, f'About {source.name}', key=key, values=values,
        )

    def test_services_are_global(self):
        self.assertEqual(self.env['webvue.notify.service']._webvue_scope, 'global')
        self.assertEqual(self.env['webvue.notify.registry']._webvue_scope, 'global')

    def test_registry_keeps_registration_order(self):
        registry = self.env['webvue.notify.registry']
        self.assertEqual(list(registry._webvue_notification_type_map()), ['probe_ping', 'probe_live'])
        self.assertEqual(registry._webvue_notify_feature_keys(), (PROBE_FEATURE,))
        self.assertEqual(registry._webvue_notify_live_kinds(), ('probe_live',))
        self.patch(self.registry_model, '_webvue_notification_types', lambda model: (
            {**PROBE_TYPES[0], 'feature_key': 'b.enabled'},
            {**PROBE_TYPES[1], 'feature_key': 'a.enabled'},
        ))
        self.assertEqual(registry._webvue_notify_feature_keys(), ('b.enabled', 'a.enabled'))

    def test_registry_refuses_bad_descriptors(self):
        registry = self.env['webvue.notify.registry']
        cases = (
            ((PROBE_TYPES[0], PROBE_TYPES[0]), 'duplicate notification kind probe_ping'),
            (({**PROBE_TYPES[0], 'feature_key': ''},), 'probe_ping is missing feature_key'),
            (({**PROBE_TYPES[0], 'kind': 'probe_unknown'},), 'probe_unknown is not a mail.message selection value'),
            (({**PROBE_TYPES[0], 'kind': None},), 'missing a kind'),
        )
        for types, message in cases:
            with self.subTest(message=message):
                self.patch(self.registry_model, '_webvue_notification_types', lambda model, types=types: types)
                with self.assertRaisesRegex(ValidationError, message):
                    registry._webvue_notification_type_map()

    def test_delivery_creates_one_inbox_row_per_partner_and_no_mail(self):
        source = self.sources[0]
        partners = self.reader.partner_id | self.other.partner_id
        messages = self._deliver(source, partners)
        self.assertEqual(len(messages), 2)
        for message in messages:
            self.assertEqual((message.model, message.res_id), ('res.partner', source.id))
            self.assertTrue(message.webvue_notification)
            self.assertEqual(message.webvue_notification_kind, 'probe_ping')
            self.assertFalse(message.webvue_notification_key)
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
        self.assertEqual(first.webvue_notification_key, key)
        self.assertFalse(second)
        self.assertEqual(self.env['mail.message'].sudo().search_count([('webvue_notification_key', '=', key)]), 1)

    def test_replace_swaps_the_row_of_a_key_for_a_fresh_unread_one(self):
        key = f'probe-replace:{self.reader.partner_id.id}'
        first = self._deliver(self.sources[0], self.reader.partner_id, key=key)
        first.notification_ids.sudo().write({'is_read': True})
        service = self.env['webvue.notify.service']
        again = service._webvue_deliver(
            'res.partner', self.sources[0].id, 'probe_ping', self.reader.partner_id, 'Again', key=key, replace=True)
        self.assertEqual(len(again), 1)
        self.assertNotEqual(again.id, first.id)
        self.assertFalse(first.exists())
        self.assertFalse(again.notification_ids.is_read)
        self.assertEqual(self.env['mail.message'].sudo().search_count([('webvue_notification_key', '=', key)]), 1)

    @mute_logger('odoo.sql_db')
    def test_an_ordinary_actor_delivers_a_keyed_row_once(self):
        """The key precheck and the inbox row run in the actor's own environment: an internal
        user who is not a superuser delivers one row to another recipient, and a repeated key
        creates nothing, whether the precheck sees the earlier row or the unique index refuses it."""
        key = f'probe-actor:{self.sources[0].id}:{self.other.partner_id.id}'
        service = self.service.with_user(self.reader)
        self.assertFalse(service.env.su)
        first = service._webvue_deliver(
            'res.partner', self.sources[0].id, 'probe_ping', self.other.partner_id, 'From reader', key=key,
        )
        self.assertEqual(len(first), 1)
        self.assertEqual(first.notification_ids.res_partner_id, self.other.partner_id)
        self.assertEqual(first.notification_ids.author_id, self.reader.partner_id)
        self.assertFalse(service._webvue_deliver(
            'res.partner', self.sources[0].id, 'probe_ping', self.other.partner_id, 'Again', key=key,
        ))
        self.patch(type(self.service), '_webvue_key_taken', lambda model, key: False)
        self.assertFalse(service._webvue_deliver(
            'res.partner', self.sources[0].id, 'probe_ping', self.other.partner_id, 'Raced', key=key,
        ))
        self.assertEqual(self.env['mail.message'].sudo().search_count([('webvue_notification_key', '=', key)]), 1)

    @mute_logger('odoo.sql_db')
    def test_a_concurrent_duplicate_key_is_skipped(self):
        key = f'probe-race:{self.reader.partner_id.id}'
        self._deliver(self.sources[0], self.reader.partner_id, key=key)
        # A second worker passed the pre-check before the first one committed.
        self.patch(type(self.service), '_webvue_key_taken', lambda model, key: False)
        self.assertFalse(self._deliver(self.sources[0], self.reader.partner_id, key=key))
        self.assertEqual(self.env['mail.message'].sudo().search_count([('webvue_notification_key', '=', key)]), 1)
        self.assertEqual(len(self._deliver(self.sources[1], self.reader.partner_id)), 1, 'the transaction stays usable')

    def test_delivery_refuses_unknown_kinds_shared_keys_and_generic_values(self):
        with self.assertRaisesRegex(ValueError, "kind 'probe_unknown' is not registered"):
            self._deliver(self.sources[0], self.reader.partner_id, kind='probe_unknown')
        with self.assertRaisesRegex(ValueError, 'a delivery key names one recipient'):
            self._deliver(self.sources[0], self.reader.partner_id | self.other.partner_id, key='probe:shared')
        with self.assertRaisesRegex(ValueError, r"values may not set \['model'\]"):
            self._deliver(self.sources[0], self.reader.partner_id, values={'model': 'res.users'})
        self.assertFalse(self.env['mail.message'].sudo().search_count([
            ('webvue_notification', '=', True), ('model', '=', 'res.partner'), ('res_id', 'in', self.sources.ids),
        ]))

    def test_values_carry_the_owner_columns(self):
        message = self._deliver(self.sources[0], self.reader.partner_id, values={'subject': 'Owner column'})
        self.assertEqual(message.subject, 'Owner column')

    def _list(self, user, limit=50, **kwargs):
        return self.service.with_user(user)._webvue_list(limit, **kwargs)

    def test_list_is_recipient_scoped_newest_first_and_paged(self):
        for source in self.sources:
            self._deliver(source, self.reader.partner_id)
        self._deliver(self.sources[0], self.other.partner_id)
        body = self._list(self.reader)
        self.assertEqual([item['source_id'] for item in body['items']], list(reversed(self.sources.ids)))
        self.assertEqual((body['total'], body['unread_count']), (3, 3))
        page = self._list(self.reader, limit=1, offset=1)
        self.assertEqual([item['source_id'] for item in page['items']], [self.sources[1].id])
        self.assertEqual((page['total'], page['unread_count']), (3, 3))
        self.assertEqual(self._list(self.reader, unread=False)['total'], 0)
        self.assertEqual(self._list(self.other)['total'], 1)

    def test_hidden_sources_are_not_listed_counted_or_marked(self):
        hidden, shown = self.sources[0], self.sources[1]
        hidden_row = self._deliver(hidden, self.reader.partner_id).notification_ids
        self._deliver(shown, self.reader.partner_id)
        self.hidden_sources.add(hidden.id)
        service = self.service.with_user(self.reader)
        body = service._webvue_list(50)
        self.assertEqual([item['source_id'] for item in body['items']], [shown.id])
        self.assertEqual((body['total'], body['unread_count']), (1, 1))
        with self.assertRaises(MissingError):
            service._webvue_mark_read(hidden_row.id)
        self.assertEqual(service._webvue_mark_all_read(), 1)
        hidden_row.invalidate_recordset(['is_read'])
        self.assertFalse(hidden_row.is_read)

    def test_visibility_is_refused_under_sudo_and_scans_stay_recipient_scoped(self):
        mine = self._deliver(self.sources[0], self.reader.partner_id).notification_ids
        theirs = self._deliver(self.sources[1], self.other.partner_id).notification_ids
        with self.assertRaises(AccessError):
            self.service.sudo()._webvue_domain()
        service = self.service.with_user(self.reader)
        # A domain handed in without the recipient restriction must not widen the scan.
        domain = [('id', 'in', (mine | theirs).ids)]
        self.assertEqual([row.id for row, _extra in service._webvue_visible_rows(domain)], mine.ids)
        self.assertEqual(service._webvue_visible_count(domain), 1)

    def test_live_rows_are_rechecked_one_by_one(self):
        dead, alive = self.sources[0], self.sources[1]
        dead_row = self._deliver(dead, self.reader.partner_id, kind='probe_live').notification_ids
        self._deliver(alive, self.reader.partner_id, kind='probe_live')
        self._deliver(self.sources[2], self.reader.partner_id)
        self.dead_sources.add(dead.id)
        service = self.service.with_user(self.reader)
        body = service._webvue_list(50)
        self.assertEqual(
            [(item['kind'], item['source_id'], item['extra']) for item in body['items']],
            [('probe_ping', self.sources[2].id, None), ('probe_live', alive.id, 'alive')],
        )
        self.assertEqual((body['total'], body['unread_count']), (2, 2))
        with self.assertRaises(MissingError):
            service._webvue_mark_read(dead_row.id)

    def test_marking_read_runs_in_the_callers_own_acl_and_rule(self):
        mine = self._deliver(self.sources[0], self.reader.partner_id).notification_ids
        theirs = self._deliver(self.sources[1], self.other.partner_id).notification_ids
        service = self.service.with_user(self.reader)
        self.assertEqual(service._webvue_mark_read(mine.id), 1)
        self.assertTrue(mine.is_read)
        self.assertTrue(mine.read_date)
        self.assertEqual(service._webvue_mark_all_read(), 0)
        # The same ORM rule that lets the recipient write its row refuses everyone else.
        with self.assertRaises(AccessError):
            theirs.with_user(self.reader).write({'is_read': True})
        theirs.invalidate_recordset(['is_read'])
        self.assertFalse(theirs.is_read)
        self.assertEqual(self.service.with_user(self.other)._webvue_mark_all_read(), 1)
        self.assertTrue(theirs.is_read)

    def test_marking_read_is_idempotent_scoped_and_needs_the_owner_feature(self):
        row = self._deliver(self.sources[0], self.reader.partner_id).notification_ids
        service = self.service.with_user(self.reader)
        self.assertEqual(service._webvue_mark_read(row.id), 1)
        self.assertEqual(service._webvue_mark_read(row.id), 0)
        with self.assertRaises(MissingError):
            self.service.with_user(self.other)._webvue_mark_read(row.id)
        unread = self._deliver(self.sources[1], self.reader.partner_id).notification_ids
        set_probe_feature(self, enabled=False, retained=True)
        self.assertEqual(service._webvue_list(50)['unread_count'], 1)
        with self.assertRaises(WebVueAccessRule) as caught:
            service._webvue_mark_read(unread.id)
        self.assertEqual(caught.exception.code, 'feature_not_included')
        self.assertEqual(service._webvue_mark_all_read(), 0)
        unread.invalidate_recordset(['is_read'])
        self.assertFalse(unread.is_read)

    def test_an_empty_branch_is_refused_and_no_branch_shows_nothing(self):
        self._deliver(self.sources[0], self.reader.partner_id)
        self.patch(self.registry_model, '_webvue_notify_visible_domain', lambda model: [[]])
        with self.assertRaisesRegex(ValueError, 'must not be empty'):
            self._list(self.reader)
        self.patch(self.registry_model, '_webvue_notify_visible_domain', lambda model: [])
        self.assertEqual(self._list(self.reader), {'items': [], 'total': 0, 'unread_count': 0})

    def test_the_row_feature_comes_from_the_descriptor(self):
        row = self._deliver(self.sources[0], self.reader.partner_id).notification_ids
        self.assertEqual(self.env['webvue.notify.registry']._webvue_notify_feature_key(row), PROBE_FEATURE)
