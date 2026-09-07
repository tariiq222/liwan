# Part of Odoo. See LICENSE file for full copyright and licensing details.
import functools

from odoo.addons.nasq_api.controllers.common import ApiError
from odoo.addons.nasq_hr.rules import NasqHrRule


def hr_rule_handler(func):
    """Translate structured HR model refusals before ``api_handler`` runs."""
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        try:
            return func(*args, **kwargs)
        except NasqHrRule as error:
            raise ApiError(
                error.status, error.code, error.message, error.field, error.details,
            ) from None
    return wrapper
