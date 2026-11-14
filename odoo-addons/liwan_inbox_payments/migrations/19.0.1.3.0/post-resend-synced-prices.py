# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import SUPERUSER_ID, api


def migrate(cr, version):
    """Resend every item Meta already holds: its price may now be computed differently.

    Before this version a catalog price depended on the catalog's own ``prices_include_tax`` option and a branch row
    stored a VAT registration of its own (default false), so a branch catalog of a registered establishment was priced
    untaxed. Now the price is the total the customer pays under the establishment's one registration (stored on the
    root company) and stock's price mode. Nothing marked the items already synced, and the hash of a payload that is
    unchanged is never resent, so the items Meta holds would keep the old price until someone edited them.

    Every listed, active, synced item of every establishment becomes pending and its catalog is asked to sync, through
    the model's own method (plain SQL on LiwanOS's own item table, keyed by the establishment the migration just
    filled). The next push compares each payload's hash with what Meta holds, so an item whose price did not change
    settles without a request. A rerun marks only what was synced meanwhile. A fresh install has no items.
    """
    if not version:
        return
    env = api.Environment(cr, SUPERUSER_ID, {})
    roots = env['res.company'].with_context(active_test=False).search([('parent_id', '=', False)])
    env['liwan.inbox.catalog.item']._liwan_establishment_price_changed(roots.ids)
