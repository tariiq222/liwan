# Part of Odoo. See LICENSE file for full copyright and licensing details.
import functools

from odoo.http import request

from odoo.addons.webvue_api.controllers.common import ApiError
from odoo.addons.webvue_hr.rules import WebVueHrRule


def own_public_employee():
    """Resolve an active own employee without reading private employment fields."""
    return request.env['hr.employee.public'].search([
        ('user_id', '=', request.env.uid),
        ('company_id', '=', request.env.company.id),
    ], limit=1)


def hr_rule_handler(func):
    """Translate structured HR model refusals before ``api_handler`` runs."""
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        try:
            return func(*args, **kwargs)
        except WebVueHrRule as error:
            raise ApiError(
                error.status, error.code, error.message, error.field, error.details,
            ) from None
    return wrapper
