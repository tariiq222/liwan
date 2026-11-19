# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import SUPERUSER_ID, Command, api

from odoo.addons.liwan_document_service.models.access_service import PERMISSIONS


def migrate(cr, version):
    """Vendor support holds no documents permission (#729): drop the grants its built-in role carried.

    Built-in role grants are only ever added by the seed data, so the grants it held before are removed here.
    """
    if not version:
        return
    env = api.Environment(cr, SUPERUSER_ID, {})
    role = env.ref('liwan_core.role_vendor_support')
    dropped = env['liwan.access.permission'].search([('key', 'in', sorted(PERMISSIONS))])
    role.write({'permission_ids': [Command.unlink(permission.id) for permission in dropped]})
