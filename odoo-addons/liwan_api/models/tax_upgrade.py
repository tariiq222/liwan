# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import UserError

PAYMENTS_PRICE_MODE_CARRIED = '_liwan_payments_price_mode_carried'


def refuse_open_documents_with_changed_company_modes(env, companies, new_mode):
    """Check sale taxes that inherit the price mode from their company."""
    changing = companies.filtered(lambda company: company.account_price_include != new_mode)
    if not changing:
        return

    taxes = env['account.tax'].with_context(active_test=False).search([
        ('company_id', 'in', changing.ids),
        ('type_tax_use', 'in', ('sale', 'none')),
        ('price_include_override', '=', False),
    ])
    refuse_open_documents_with_changed_taxes(env, taxes)


def _can_contribute_tax(tax):
    return tax.amount != 0 or tax.amount_type not in ('percent', 'fixed', 'division')


def _line_tax_calculation_can_change(line):
    taxes, _ = line.tax_ids._flatten_taxes_and_sort_them()
    return any(_can_contribute_tax(tax) for tax in taxes)


def refuse_open_documents_with_changed_taxes(env, changed_taxes):
    """Stop an upgrade when an open document uses a tax whose inclusion mode changes."""
    # Stock computes groups from their leaves.
    changed_taxes = changed_taxes.filtered(lambda tax: tax.amount_type != 'group')
    if not changed_taxes:
        return

    # Document lines can reference a group tax whose child is changing.
    affected = changed_taxes
    while parents := env['account.tax'].with_context(active_test=False).search([
        ('children_tax_ids', 'in', affected.ids), ('id', 'not in', affected.ids),
    ]):
        affected |= parents

    invoices = env['account.move.line'].search([
        ('tax_ids', 'in', affected.ids), ('move_id.state', '=', 'draft'),
        ('move_id.move_type', 'in', ('out_invoice', 'out_refund', 'out_receipt')),
    ]).filtered(_line_tax_calculation_can_change).move_id
    report = [
        f'account.move #{move.id} ({move.display_name}) — {move.company_id.display_name}'
        for move in invoices.sorted('id')
    ]
    if 'sale.order.line' in env:
        orders = env['sale.order.line'].search([
            ('tax_ids', 'in', affected.ids), '|',
            ('order_id.state', 'in', ('draft', 'sent')),
            '&', ('order_id.state', '=', 'sale'), ('order_id.invoice_status', '!=', 'invoiced'),
        ]).filtered(_line_tax_calculation_can_change).order_id
        report.extend(
            f'sale.order #{order.id} ({order.display_name}) — {order.company_id.display_name}'
            for order in orders.sorted('id')
        )

    if report:
        raise UserError(env._(
            "The tax inclusion change would affect the calculation of these open documents:\n"
            "%(documents)s\n"
            "Restore the database and filestore from before the upgrade, then resolve these documents before retrying.",
            documents='\n'.join(report),
        ))
