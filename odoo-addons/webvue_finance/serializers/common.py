# Part of Odoo. See LICENSE file for full copyright and licensing details.


def dump_ref(record):
    """The {id, name} reference of a related record, or None when it is empty."""
    return {'id': record.id, 'name': record.display_name} if record else None


def dump_day(value):
    """ISO-8601 date string of a date field value, or None."""
    return value.isoformat() if value else None
