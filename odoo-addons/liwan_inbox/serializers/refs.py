# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The reference shapes shared by every serializer of the inbox."""
from odoo.addons.liwan_api.serializers.common import ref
from odoo.addons.liwan_inbox.models.privacy_hooks import is_erased_contact

# The {id, name} reference of a related record; every inbox serializer imports it from here.
dump_ref = ref


def dump_contact_ref(contact):
    """A contact named in another record; ``erased`` lets the screen translate the marker name an erase wrote."""
    return {'id': contact.id, 'name': contact.name, 'erased': is_erased_contact(contact)}
