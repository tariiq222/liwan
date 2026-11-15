# Part of Odoo. See LICENSE file for full copyright and licensing details.
from functools import partial

from odoo.addons.liwan_api.serializers.common import ref

UNSET = object()  # "not asked yet", for a value whose answer may itself be None

# The {id, name} reference of a related record, named by its display name, or None when it is empty.
dump_ref = partial(ref, label='display_name')


def dump_number(name):
    """The assigned document number, or None while Odoo has not numbered it yet (empty or the draft '/')."""
    return None if not name or name == '/' else name


def dump_day(value):
    """ISO-8601 date string of a date field value, or None."""
    return value.isoformat() if value else None
