# Part of Odoo. See LICENSE file for full copyright and licensing details.
# The AI bridges of CRM, Tasks and Meetings were folded into their applications, which took over the bridges' ACL xml ids
# in their own pre migrations: forget the removed addons.
from odoo import SUPERUSER_ID, api

from odoo.addons.liwan_api.models.removed_addons import forget_removed_addons


def migrate(cr, version):
    if not version:
        return
    forget_removed_addons(api.Environment(cr, SUPERUSER_ID, {}))
