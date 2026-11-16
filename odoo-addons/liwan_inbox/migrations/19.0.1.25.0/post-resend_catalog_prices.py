# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""A catalog moved in from liwan_inbox_payments below its 19.0.1.3.0: drop the removed tax option and resend the prices."""
from odoo import SUPERUSER_ID, api
from odoo.tools import SQL
from odoo.tools.sql import column_exists

REMOVED_OPTION = 'prices_include_tax'


def migrate(cr, version):
    """The catalog's own tax option is gone and a price follows the establishment's one registration and stock's price
    mode; a database whose catalog still has the option's column (Odoo never drops the column of a removed field) has
    never resent its prices under that rule.

    The column is dropped, and every listed, active, synced item of every establishment becomes pending and its catalog
    is asked to sync. The push compares each payload's hash with what Meta holds, so an item whose price did not change
    settles without a request. Without the column (a fresh catalog, or one already past that change) nothing happens.
    """
    if not version or not column_exists(cr, 'liwan_inbox_catalog', REMOVED_OPTION):
        return
    cr.execute(SQL('ALTER TABLE liwan_inbox_catalog DROP COLUMN %s', SQL.identifier(REMOVED_OPTION)))
    env = api.Environment(cr, SUPERUSER_ID, {})
    roots = env['res.company'].with_context(active_test=False).search([('parent_id', '=', False)])
    env['liwan.inbox.catalog.item']._liwan_establishment_price_changed(roots.ids)
