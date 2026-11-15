# Part of Odoo. See LICENSE file for full copyright and licensing details.
# The AI registries moved into liwan_api and the AI bridges of Sales, HR, Finance, Operations and PMO were folded into
# their applications: forget the removed addons.
from odoo import SUPERUSER_ID, api

from odoo.addons.liwan_api.models.removed_addons import forget_removed_addons


def migrate(cr, version):
    if not version:
        return
    forget_removed_addons(api.Environment(cr, SUPERUSER_ID, {}))
