# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Field conversions shared by the lifecycle serializers."""
from odoo import fields
from odoo.tools.mail import html2plaintext


def ref(record):
    """An ``{id, name}`` reference, or None on an empty relation."""
    return {'id': record.id, 'name': record.name} if record else None


def date_str(value):
    """A YYYY-MM-DD string, or None: the contract never exposes a datetime."""
    return fields.Date.to_string(value) if value else None


def plain_text(value):
    """The text of an Html field; markup is never exposed."""
    return html2plaintext(value or '').strip()
