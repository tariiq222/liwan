# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'liwan Sales and Payments',
    'summary': 'liwan platform: a staff quotation can ask to be paid online and is confirmed by the payment',
    'version': '19.0.1.0.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # The bridge between the Sales application and the shared payments service (rank 5): installed by Odoo as soon as
    # both are. liwan_sales owns the quotation, its send and the customer's answer; liwan_payments owns the pay page,
    # the gateway and the transaction. The bridge owns the choice "pay to confirm" (the tenant's default on
    # liwan.sales.settings and the value of each quotation, kept in stock's `require_payment` and `prepayment_percent`),
    # what the customer's page and the e-mail say about it, and the confirmation of the order once the payment arrives.
    # It adds no model: it only extends the Sales hooks and the stock payment transaction.
    'depends': ['liwan_sales', 'liwan_payments'],
    'auto_install': ['liwan_sales', 'liwan_payments'],
    'installable': True,
    'application': False,
}
