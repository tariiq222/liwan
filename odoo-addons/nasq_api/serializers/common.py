# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields


def iso(dt):
    """ISO-8601 UTC string (e.g. '2030-01-15T00:00:00Z') for a naive UTC
    odoo datetime/date field value, or None. Shared by task.py and
    timeline.py — anything both serializers need lives here rather than one
    importing a private helper from the other."""
    return fields.Datetime.to_string(dt).replace(' ', 'T') + 'Z' if dt else None
