# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import SUPERUSER_ID, Command, api

LINKED_GROUPS = (
    'liwan_core.group_customer_admin',
    'liwan_core.group_access_admin',
    'liwan_platform.group_maintenance_manager',
)


def migrate(cr, version):
    """Vendor support no longer implies the customer administrator groups.

    The group's own implied list is rewritten by the security data file, so only the memberships already stored on
    support users remain: drop the administrator groups, then rebuild their capability groups from the keys support now
    holds. A rerun finds nothing left to drop.
    """
    if not version:
        return
    env = api.Environment(cr, SUPERUSER_ID, {})
    support = env.ref('liwan_core.group_vendor_support')
    groups = env['res.groups']
    for xmlid in LINKED_GROUPS:
        groups |= env.ref(xmlid, raise_if_not_found=False) or groups.browse()
    support.write({'implied_ids': [Command.unlink(group.id) for group in groups]})
    users = env['res.users'].with_context(active_test=False).search([('group_ids', 'in', support.id)])
    users.write({'group_ids': [Command.unlink(group.id) for group in groups]})
    users._liwan_sync_capability_groups()
