# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Test-only notification types for liwan_notify's own tests.

liwan_notify knows no application, so its tests register two probe kinds on
``res.partner`` rows for the length of one test: the kinds are added to the
selection field and the registry is replaced with ``self.patch``, which also
hides every installed application's types. ``hidden_sources`` play the
records the caller can no longer read; ``dead_sources`` play live rows whose
row check fails. The tests behave the same with or without an application.
"""
from odoo.addons.liwan_api.tests.common import (
    PROBE_FEATURE,
    register_probe_feature,
    set_probe_feature,
)

PROBE_KINDS = (('probe_ping', 'Probe ping'), ('probe_live', 'Probe live'))
PROBE_TYPES = (
    {'kind': 'probe_ping', 'owner': 'liwan_notify', 'model': 'res.partner', 'feature_key': PROBE_FEATURE},
    {'kind': 'probe_live', 'owner': 'liwan_notify', 'model': 'res.partner', 'feature_key': PROBE_FEATURE, 'live': True},
)


class NotifyProbe:
    """Mixin for TransactionCase and HttpCase classes; call ``_install_probe`` in ``setUp``."""

    def _install_probe(self):
        self.hidden_sources = set()
        self.dead_sources = set()
        field = self.env['mail.message']._fields['liwan_notification_kind']
        self.patch(field, 'selection', [*field.selection, *PROBE_KINDS])
        self.patch(field, '_selection', {**(field._selection or {}), **dict(PROBE_KINDS)})
        registry = type(self.env['liwan.notify.registry'])
        self.patch(registry, '_liwan_notification_types', lambda model: PROBE_TYPES)
        self.patch(registry, '_liwan_notify_visible_domain', lambda model: [[
            ('mail_message_id.model', '=', 'res.partner'),
            ('mail_message_id.res_id', 'not in', sorted(self.hidden_sources)),
        ]])
        self.patch(registry, '_liwan_notify_row_visible', lambda model, row: self._probe_row_visible(row))
        self.patch(registry, '_liwan_notify_dump', lambda model, row, extra: self._probe_dump(row, extra))
        register_probe_feature(self)
        set_probe_feature(self)

    def _probe_row_visible(self, row):
        message = row.mail_message_id
        if message.liwan_notification_kind != 'probe_live':
            return True, None
        if message.res_id in self.dead_sources:
            return False, None
        return True, 'alive'

    def _probe_dump(self, row, extra):
        message = row.mail_message_id
        return {
            'id': row.id,
            'kind': message.liwan_notification_kind,
            'source_id': message.res_id,
            'is_read': bool(row.is_read),
            'extra': extra,
        }
