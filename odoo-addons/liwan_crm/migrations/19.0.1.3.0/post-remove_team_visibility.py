# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import SUPERUSER_ID, api


def migrate(cr, version):
    """The `team` visibility mode is gone: a company that chose it reads as `own`."""
    if not version:
        return
    env = api.Environment(cr, SUPERUSER_ID, {})
    env['liwan.crm.settings'].search([('visibility', '=', 'team')]).write({'visibility': 'own'})
