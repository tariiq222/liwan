# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Test-only notification types for nasq_notify's own tests.

nasq_notify knows no application, so its tests register two probe kinds on
``res.partner`` rows for the length of one test: the kinds are added to the
selection field and the registry is replaced with ``self.patch``, which also
hides every installed application's types. The tests behave the same with
or without an application installed.
"""
from odoo.addons.nasq_api.tests.common import PROBE_FEATURE

PROBE_KINDS = (('probe_ping', 'Probe ping'), ('probe_live', 'Probe live'))
PROBE_TYPES = (
    {'kind': 'probe_ping', 'owner': 'nasq_notify', 'model': 'res.partner', 'feature_key': PROBE_FEATURE},
    {'kind': 'probe_live', 'owner': 'nasq_notify', 'model': 'res.partner', 'feature_key': PROBE_FEATURE, 'live': True},
)


class NotifyProbe:
    """Mixin for TransactionCase and HttpCase classes; call ``_install_probe`` in ``setUp``."""

    def _install_probe(self):
        field = self.env['mail.message']._fields['nasq_notification_kind']
        self.patch(field, 'selection', [*field.selection, *PROBE_KINDS])
        self.patch(field, '_selection', {**(field._selection or {}), **dict(PROBE_KINDS)})
        self.patch(type(self.env['nasq.notify.registry']), '_nasq_notification_types', lambda model: PROBE_TYPES)
