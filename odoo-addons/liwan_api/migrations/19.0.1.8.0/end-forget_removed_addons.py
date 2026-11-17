# Part of Odoo. See LICENSE file for full copyright and licensing details.
# The bridge liwan_sales_payments was folded into the Sales application. It owned no data record, so nothing was handed
# over: forget the removed addon.
from odoo import SUPERUSER_ID, api

from odoo.addons.liwan_api.models.removed_addons import forget_removed_addons


def migrate(cr, version):
    if not version:
        return
    forget_removed_addons(api.Environment(cr, SUPERUSER_ID, {}), names=('liwan_sales_payments',))
