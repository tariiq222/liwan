# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import SUPERUSER_ID, Command, api


def migrate(cr, version):
    """Vendor support is closed by default: drop the manager group it was implied to hold.

    Removing a group link from XML never unlinks an existing one, so it is removed here.
    """
    if not version:
        return
    env = api.Environment(cr, SUPERUSER_ID, {})
    env.ref('liwan_core.group_vendor_support').write({
        'implied_ids': [Command.unlink(env.ref('liwan_appointments.group_appointments_manager').id)],
    })
