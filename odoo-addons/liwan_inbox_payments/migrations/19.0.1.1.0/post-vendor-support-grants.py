# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import SUPERUSER_ID, Command, api

from odoo.addons.liwan_inbox_payments.models.access_service import PERMISSIONS


def migrate(cr, version):
    """Vendor support no longer holds the orders and catalog capabilities (INB-18); built-in grants are only ever added by seed data."""
    if not version:
        return
    env = api.Environment(cr, SUPERUSER_ID, {})
    role = env.ref('liwan_core.role_vendor_support')
    dropped = env['liwan.access.permission'].search([('key', 'in', sorted(PERMISSIONS))])
    role.write({'permission_ids': [Command.unlink(permission.id) for permission in dropped]})
