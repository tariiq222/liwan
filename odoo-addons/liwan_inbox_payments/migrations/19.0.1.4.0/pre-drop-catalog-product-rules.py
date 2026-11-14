# Part of Odoo. See LICENSE file for full copyright and licensing details.
import logging

from odoo import SUPERUSER_ID, api

_logger = logging.getLogger(__name__)

REMOVED_RULES = (
    'liwan_inbox_payments.product_template_catalog_manage_rule',
    'liwan_inbox_payments.product_product_catalog_manage_rule',
)


def migrate(cr, version):
    """Delete the two record rules whose domain names the removed catalog marker, before the module loads.

    The security data no longer holds them, but Odoo deletes such records only at the very end of the upgrade
    (``ir.model.data._process_end``), after every ``post-`` script and after the at-install tests of the modules loaded
    in between. Until then a user of the catalog manager group who writes or creates on ``product.template`` or
    ``product.product`` (the rules have no read permission) evaluates a domain on a field that is no longer in the registry and fails with a ``ValueError``. Deleting them by
    external id here leaves no such window; the marker column is dropped by ``end-adopt-catalog-products.py``.
    """
    if not version:
        return
    env = api.Environment(cr, SUPERUSER_ID, {})
    rules = env['ir.rule']
    for xmlid in REMOVED_RULES:
        rules |= env.ref(xmlid, raise_if_not_found=False) or rules.browse()
    rules.unlink()
    _logger.info('liwan_inbox_payments: %d catalog product rules deleted', len(rules))
