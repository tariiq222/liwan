# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The reference shapes shared by every serializer of the inbox."""
from odoo.addons.liwan_inbox.models.privacy_hooks import is_erased_contact


def dump_ref(record):
    return {'id': record.id, 'name': record.name} if record else None


def dump_contact_ref(contact):
    """A contact named in another record; ``erased`` lets the screen translate the marker name an erase wrote."""
    return {'id': contact.id, 'name': contact.name, 'erased': is_erased_contact(contact)}
