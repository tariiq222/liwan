# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date

from odoo import fields

from odoo.addons.liwan_api.controllers.common import ApiError


def iso(dt, *, timespec='seconds'):
    """ISO-8601 UTC string (e.g. '2030-01-15T00:00:00Z') for a naive UTC
    odoo datetime/date field value, or None. Shared by task.py and
    timeline.py — anything both serializers need lives here rather than one
    importing a private helper from the other."""
    return fields.Datetime.to_datetime(dt).isoformat(timespec=timespec) + 'Z' if dt else None


def ref(record, *, label='name'):
    """The ``{id, name}`` reference of a related record, or None when it is
    empty. ``label`` names the field shown as ``name`` (``display_name`` for
    records whose label is computed)."""
    return {'id': record.id, 'name': record[label]} if record else None


def parse_iso_date(value, field):
    """A ``YYYY-MM-DD`` calendar day as a date; None stays None, anything else is a 422 ``invalid`` on ``field``."""
    if value is None:
        return None
    if isinstance(value, str) and len(value) == len('YYYY-MM-DD'):
        try:
            return date.fromisoformat(value)
        except ValueError:
            pass
    raise ApiError(422, 'invalid', f'{field} must be YYYY-MM-DD or null', field=field)
