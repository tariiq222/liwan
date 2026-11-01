# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import SUPERUSER_ID, api


def migrate(cr, version):
    """Every existing company gets the seeded warning types; the warning tables start empty."""
    if not version:
        return
    env = api.Environment(cr, SUPERUSER_ID, {})
    env['res.company'].with_context(active_test=False).search([])._liwan_ensure_warning_types()
