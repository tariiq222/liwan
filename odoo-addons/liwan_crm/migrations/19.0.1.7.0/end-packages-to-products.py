# Part of Odoo. See LICENSE file for full copyright and licensing details.
import logging

from odoo import SUPERUSER_ID, Command, api
from odoo.tools.sql import column_exists

_logger = logging.getLogger(__name__)


def marked_packages(cr):
    """``{product id: company id or None}`` of the products the removed marker flagged as CRM packages."""
    cr.execute('SELECT id, company_id FROM product_template WHERE liwan_crm_package')
    return dict(cr.fetchall())


def named_by_leads(cr):
    """The ids of every product an opportunity names as its package, whoever made the product."""
    cr.execute('SELECT DISTINCT liwan_package_id FROM crm_lead WHERE liwan_package_id IS NOT NULL')
    return {row[0] for row in cr.fetchall()}


def migrate(cr, version):
    """Move CRM's packages onto the shared products service (plan D13 and D17).

    Every marked package and every product an opportunity names becomes a service product through
    ``liwan.products.service._liwan_adopt``, which shares it (its company is cleared). Each company's packages
    are then recorded in the new relation of its CRM settings: a package that belonged to a company goes to that
    company, and a package with no company, which the old list offered to every company, goes to every company.
    A company with packages and no settings row gets one with the defaults. Last, the marker column goes.

    An ``end-`` script, so the tax bridge (``liwan_products_account``, auto-installed with the service and
    ``account``), whose ``_liwan_adopt`` normalises the taxes, is loaded whichever order the modules were updated in.
    The marker is read and dropped with SQL, so it needs no field in the registry, and the script runs only while the
    column exists: a rerun after a failure repeats the adoption and the links (both idempotent), and the column is
    dropped exactly once, last.
    """
    if not version or not column_exists(cr, 'product_template', 'liwan_crm_package'):
        return
    env = api.Environment(cr, SUPERUSER_ID, {})
    packages = marked_packages(cr)
    named = named_by_leads(cr)
    products = env['product.template'].with_context(active_test=False).browse(sorted({*packages, *named}))
    env['liwan.products.service']._liwan_adopt(products)
    companies = env['res.company'].with_context(active_test=False).search([])
    offered = {company.id: set() for company in companies}
    for product_id, company_id in packages.items():
        for target in [company_id] if company_id else offered:
            offered.get(target, set()).add(product_id)
    Settings = env['liwan.crm.settings']
    for company in companies:
        if not offered[company.id]:
            continue
        row = Settings.search([('company_id', '=', company.id)])
        links = [Command.link(product_id) for product_id in sorted(offered[company.id])]
        if row:
            row.write({'package_ids': links})
        else:
            Settings.create({'company_id': company.id, 'package_ids': links})
    cr.execute('ALTER TABLE product_template DROP COLUMN liwan_crm_package')
    _logger.info('liwan_crm: %d packages and %d opportunity products moved to the products service',
                 len(packages), len(named))
