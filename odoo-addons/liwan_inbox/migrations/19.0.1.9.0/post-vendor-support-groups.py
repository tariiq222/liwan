# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import SUPERUSER_ID, Command, api

from odoo.addons.liwan_inbox.models.access_service import (
    PERMISSIONS,
    VENDOR_SUPPORT_PERMISSIONS,
)


def migrate(cr, version):
    """Vendor support keeps only the channels and settings of the inbox (INB-18): drop its other grants and the manager group link.

    Built-in role grants are only ever added by the seed data, so the grants it held before are removed here.
    """
    if not version:
        return
    env = api.Environment(cr, SUPERUSER_ID, {})
    role = env.ref('liwan_core.role_vendor_support')
    dropped = env['liwan.access.permission'].search([('key', 'in', sorted(PERMISSIONS - VENDOR_SUPPORT_PERMISSIONS))])
    role.write({'permission_ids': [Command.unlink(permission.id) for permission in dropped]})
    env.ref('liwan_core.group_vendor_support').write({
        'implied_ids': [Command.unlink(env.ref('liwan_inbox.group_inbox_manager').id)],
    })
