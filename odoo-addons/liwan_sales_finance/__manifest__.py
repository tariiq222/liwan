# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'liwan Sales and Finance',
    'summary': 'liwan platform: invoices and down payments made from a confirmed sales order, and the links between the two',
    'version': '19.0.1.0.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # The bridge between two applications (spec 2.1, rank 5): installed by Odoo as soon as liwan_sales and liwan_finance
    # are both installed. liwan_sales owns the order and liwan_finance the invoice; the bridge owns the route that makes a
    # draft customer invoice (or a down payment) from a confirmed order through stock `sale.advance.payment.inv`, the
    # invoicing facts of the order, the source order of an invoice and the one setting that shapes it. It adds no model.
    'depends': ['liwan_sales', 'liwan_finance'],
    'auto_install': True,
    'installable': True,
    'application': False,
}
