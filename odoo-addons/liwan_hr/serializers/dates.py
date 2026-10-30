# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date

from odoo.addons.liwan_api.controllers.common import ApiError


def parse_optional_date(value, field):
    """A YYYY-MM-DD date, or False to clear the value."""
    if value is None or value is False or (isinstance(value, str) and not value):
        return False
    if isinstance(value, str) and len(value) == 10:
        try:
            return date.fromisoformat(value)
        except ValueError:
            pass
    raise ApiError(422, 'invalid', f"{field} must be a YYYY-MM-DD date", field=field)
