# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Addons removed from the source tree whose rows a database installed earlier still holds.

The AI bridges ``liwan_<app>_ai`` are folded into their applications once the AI registries live in liwan_api. A database
installed before keeps the removed addon's module row (left ``to upgrade`` by ``-u``, which Odoo reports as an inconsistent
state) and its ``ir.model.data`` rows. A later removal adds its name here and calls ``forget_removed_addons`` from the end
migration of its version.
"""

REMOVED_ADDONS = ('liwan_sales_ai',)


def forget_removed_addons(env, names=REMOVED_ADDONS):
    """Drop the module rows and the ``ir.model.data`` rows of ``names``; the records those rows name stay with their
    other owners. Idempotent: an addon this database never installed is skipped."""
    env['ir.model.data'].search([('module', 'in', list(names))]).unlink()
    modules = env['ir.module.module'].search([('name', 'in', list(names))])
    modules.write({'state': 'uninstalled'})
    modules.unlink()
