# Part of Odoo. See LICENSE file for full copyright and licensing details.
# The AI registries moved into liwan_api and liwan_sales_ai was folded into liwan_sales: forget the removed addon.
from odoo import SUPERUSER_ID, api

from odoo.addons.liwan_api.models.removed_addons import forget_removed_addons


def migrate(cr, version):
    if not version:
        return
    forget_removed_addons(api.Environment(cr, SUPERUSER_ID, {}))
