# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import SUPERUSER_ID, api


def migrate(cr, version):
    """Every company gets its settings row at the stated defaults, as a new install does (INB-201)."""
    if not version:
        return
    env = api.Environment(cr, SUPERUSER_ID, {})
    settings = env['liwan.inbox.settings']
    for company in env['res.company'].search([]):
        settings._get_for_company(company)
