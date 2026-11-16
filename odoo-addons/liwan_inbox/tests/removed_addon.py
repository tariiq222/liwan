# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The module row of liwan_inbox_payments, folded into liwan_inbox, as a database that installed it still holds it."""

REMOVED_ADDON = 'liwan_inbox_payments'


def installed_removed_addon(env):
    """The removed addon's ``ir.module.module`` row, created inside the test transaction when this database has none."""
    modules = env['ir.module.module']
    return modules.search([('name', '=', REMOVED_ADDON)]) or modules.create({'name': REMOVED_ADDON, 'state': 'installed'})
