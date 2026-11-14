# Part of Odoo. See LICENSE file for full copyright and licensing details.
import logging

from odoo import SUPERUSER_ID, api

from odoo.addons.liwan_api.models.tax_upgrade import (
    refuse_open_documents_with_changed_taxes,
)

_logger = logging.getLogger(__name__)


def migrate(cr, version):
    """Make every active sale tax follow the company's ``account_price_include`` again.

    Before this version a sale tax carried a ``price_include_override`` whenever the write route received
    ``price_include``, so it ignored the establishment's one tax mode. The tax copies ``liwan_payments`` made for online
    orders are archived by its own migration, and Odoo runs this ``end-`` script after every module's ``pre-``/``post-``
    script and every install hook, so an archived copy is skipped here by ``active_test=True``. A conflicting
    override on a draft or open sale stops the upgrade before the taxes are changed.
    """
    if not version:
        return
    env = api.Environment(cr, SUPERUSER_ID, {})
    taxes = env['account.tax'].with_context(active_test=True).search([
        ('type_tax_use', '=', 'sale'),
        ('price_include_override', '!=', False),
    ])
    changed = taxes.filtered(lambda tax: tax.price_include_override != tax.company_id.account_price_include)
    refuse_open_documents_with_changed_taxes(env, changed)
    if taxes:
        taxes.write({'price_include_override': False})
    _logger.info('liwan_finance: %d active sale taxes follow the company price mode again', len(taxes))
