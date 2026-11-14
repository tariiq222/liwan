# Part of Odoo. See LICENSE file for full copyright and licensing details.
import logging

from odoo import SUPERUSER_ID, api
from odoo.tools.sql import column_exists

_logger = logging.getLogger(__name__)


def migrate(cr, version):
    """The products a catalog lists become service products of the shared products service (plan D17).

    Every product a catalog item names, archived items included, and every product the removed catalog-editor marker
    flagged, goes through ``liwan.products.service._liwan_adopt``: it is marked and its company cleared (shared, the
    sharing default), and with the tax bridge its taxes become valid establishment sale taxes. Every item keeps its
    ``product_id``. Last, the marker column Odoo leaves behind when a field goes is dropped.

    An ``end-`` script, so the tax bridge (``liwan_products_account``, auto-installed with the service and ``account``)
    is loaded whichever order the modules were updated in. Adopting can change a product's taxes: the write override of
    ``product.template`` then queues the synced items of that product for resync, and the push compares hashes.
    """
    if not version:
        return
    env = api.Environment(cr, SUPERUSER_ID, {})
    templates = env['liwan.inbox.catalog.item'].with_context(active_test=False).search([]).product_id.product_tmpl_id
    marked = column_exists(cr, 'product_template', 'liwan_inbox_catalog')
    if marked:
        cr.execute('SELECT id FROM product_template WHERE liwan_inbox_catalog')
        templates |= env['product.template'].with_context(active_test=False).browse([row[0] for row in cr.fetchall()])
    adopted = env['liwan.products.service']._liwan_adopt(templates.filtered(lambda product: not product.liwan_product))
    if marked:
        cr.execute('ALTER TABLE product_template DROP COLUMN liwan_inbox_catalog')
    _logger.info('liwan_inbox_payments: %d catalog products adopted by the products service', len(adopted))
