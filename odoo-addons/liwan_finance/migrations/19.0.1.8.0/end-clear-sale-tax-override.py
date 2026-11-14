# Part of Odoo. See LICENSE file for full copyright and licensing details.
import logging

from odoo import SUPERUSER_ID, api
from odoo.exceptions import UserError

_logger = logging.getLogger(__name__)


def _check_open_documents(env, taxes):
    changed = taxes.filtered(lambda tax: tax.price_include_override != tax.company_id.account_price_include)
    if not changed:
        return
    # A document may hold a group tax whose child is the tax being changed.
    affected = changed
    while parents := env['account.tax'].with_context(active_test=False).search([
        ('children_tax_ids', 'in', affected.ids), ('id', 'not in', affected.ids),
    ]):
        affected |= parents
    invoices = env['account.move.line'].search([
        ('tax_ids', 'in', affected.ids), ('move_id.state', '=', 'draft'),
        ('move_id.move_type', 'in', ('out_invoice', 'out_refund', 'out_receipt')),
    ]).move_id
    report = [
        f'account.move #{move.id} ({move.display_name}) — {move.company_id.display_name}'
        for move in invoices.sorted('id')
    ]
    if 'sale.order.line' in env:
        orders = env['sale.order.line'].search([
            ('tax_ids', 'in', affected.ids), '|',
            ('order_id.state', 'in', ('draft', 'sent')),
            '&', ('order_id.state', '=', 'sale'), ('order_id.invoice_status', '!=', 'invoiced'),
        ]).order_id
        report.extend(
            f'sale.order #{order.id} ({order.display_name}) — {order.company_id.display_name}'
            for order in orders.sorted('id')
        )
    if report:
        raise UserError(env._(
            "Clearing the old sale tax override would change the calculation of these open documents:\n"
            "%(documents)s\n"
            "Restore the database and filestore from before the upgrade, then resolve these documents before retrying.",
            documents='\n'.join(report),
        ))


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
    _check_open_documents(env, taxes)
    if taxes:
        taxes.write({'price_include_override': False})
    _logger.info('liwan_finance: %d active sale taxes follow the company price mode again', len(taxes))
