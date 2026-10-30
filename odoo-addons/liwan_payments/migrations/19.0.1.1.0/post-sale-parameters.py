# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import SUPERUSER_ID, api

from odoo.addons.liwan_payments.models.payments_settings import set_sale_parameters


def migrate(cr, version):
    """An installed addon gains ``sale`` here: give its stock parameters the defaults a fresh install gets."""
    if not version:
        return
    set_sale_parameters(api.Environment(cr, SUPERUSER_ID, {}))
