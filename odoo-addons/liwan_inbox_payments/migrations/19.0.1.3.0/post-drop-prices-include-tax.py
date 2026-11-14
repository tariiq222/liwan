# Part of Odoo. See LICENSE file for full copyright and licensing details.


def migrate(cr, version):
    """The catalog's own tax option is gone: one tax mode for the establishment lives on the company (stock's
    ``account_price_include``). Odoo does not drop the column of a removed field, so it is dropped here."""
    if not version:
        return
    cr.execute('ALTER TABLE liwan_inbox_catalog DROP COLUMN IF EXISTS prices_include_tax')
