# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Fill the stored storage total of the tenant profile from the attachment table."""
from odoo import SUPERUSER_ID, api


def migrate(cr, version):
    if not version:
        return
    env = api.Environment(cr, SUPERUSER_ID, {})
    env['liwan.entitlement.service']._liwan_recount_storage()
