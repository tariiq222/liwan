# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import ValidationError
from odoo.http import request

from odoo.addons.webvue_api.controllers.common import ApiError


def check_vat(country, vat, name):
    """Odoo's own VAT check for ``country`` (base_vat; Saudi: 15 digits starting and ending with 3).

    The check exists only while base_vat is installed, which every release tenant has.
    """
    partner = request.env['res.partner']
    if not (vat and country) or not hasattr(partner, '_run_vat_checks'):
        return
    try:
        partner._run_vat_checks(country, vat, name)
    except ValidationError as error:
        raise ApiError(422, 'invalid_vat', str(error), field='vat') from None
