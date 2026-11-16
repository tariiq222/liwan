# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""A catalog moved in from liwan_inbox_payments below its 19.0.1.4.0: its products join the shared products service."""
import logging

from odoo import SUPERUSER_ID, api
from odoo.tools import SQL
from odoo.tools.sql import column_exists

_logger = logging.getLogger(__name__)

MARKER = 'liwan_inbox_catalog'


def migrate(cr, version):
    """The products a catalog lists become service products of the shared products service (plan D17).

    Only a database that still has the removed catalog-editor marker column on ``product_template`` (Odoo never drops
    the column of a removed field) is below that change. Every product a catalog item names, archived items included,
    and every product the marker flagged goes through ``liwan.products.service._liwan_adopt``: it is marked and its
    company cleared, and with the tax bridge its taxes become valid establishment sale taxes. Every item keeps its
    ``product_id``. Last, the marker column is dropped.

    An ``end-`` script, so the tax bridge (``liwan_products_account``) is loaded whichever order the modules were updated
    in. Adopting can change a product's taxes: the write override of ``product.template`` then queues the synced items
    of that product for resync, and the push compares hashes.
    """
    if not version or not column_exists(cr, 'product_template', MARKER):
        return
    env = api.Environment(cr, SUPERUSER_ID, {})
    templates = env['liwan.inbox.catalog.item'].with_context(active_test=False).search([]).product_id.product_tmpl_id
    cr.execute(SQL('SELECT id FROM product_template WHERE %s', SQL.identifier(MARKER)))
    templates |= env['product.template'].with_context(active_test=False).browse([row[0] for row in cr.fetchall()])
    adopted = env['liwan.products.service']._liwan_adopt(templates.filtered(lambda product: not product.liwan_product))
    cr.execute(SQL('ALTER TABLE product_template DROP COLUMN %s', SQL.identifier(MARKER)))
    _logger.info('liwan_inbox: %d catalog products adopted by the products service', len(adopted))
