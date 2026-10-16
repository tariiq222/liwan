# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields

from odoo.addons.webvue_api.controllers.common import ApiError


def parse_date(value, key):
    """YYYY-MM-DD or null → date/False. Calendar dates, not instants."""
    if value in (None, False, ''):
        return False
    if not isinstance(value, str):
        raise ApiError(422, 'invalid', f"{key} must be a YYYY-MM-DD date", field=key)
    try:
        return fields.Date.to_date(value)
    except ValueError as e:
        raise ApiError(422, 'invalid', f"{key} must be a YYYY-MM-DD date", field=key) from e
