# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import SUPERUSER_ID, Command, api

SUPPORT_LINKS = (
    'liwan_finance.group_finance_manager',
    'liwan_finance.group_cap_finance_setup_manage',
    'liwan_finance.group_cap_finance_zatca_manage',
)


def migrate(cr, version):
    """Vendor support is closed by default: drop every finance group it was implied to hold.

    Removing a group link from XML never unlinks an existing one, so it is removed here.
    """
    if not version:
        return
    env = api.Environment(cr, SUPERUSER_ID, {})
    groups = [group for xmlid in SUPPORT_LINKS if (group := env.ref(xmlid, raise_if_not_found=False))]
    env.ref('liwan_core.group_vendor_support').write({
        'implied_ids': [Command.unlink(group.id) for group in groups],
    })
