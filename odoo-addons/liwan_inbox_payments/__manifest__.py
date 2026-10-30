# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'liwan Customer Inbox and Payments',
    'summary': 'liwan platform: a Meta product catalog for WhatsApp, carts that become paid online orders',
    'version': '19.0.1.0.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # The bridge between the Customer Inbox application and the shared payments service (rank 5):
    # installed by Odoo as soon as both are. liwan_inbox owns the conversation, the WhatsApp wire
    # (commerce messages, carts) and the neutral commerce hooks; liwan_payments owns the online
    # order, its expiry, payment and invoice. The bridge owns the link to the tenant's Meta commerce
    # catalog, the catalog items and their push to Meta, the public product image route, the minimal
    # editor of catalog products, the implementations of the inbox commerce hooks, and the carts that
    # become online orders. sale (through payments) brings product and sale.order.
    'depends': ['liwan_inbox', 'liwan_payments', 'sale'],
    'auto_install': ['liwan_inbox', 'liwan_payments'],
    'data': [
        'security/inbox_payments_capability_groups.xml',
        'security/ir.model.access.csv',
        'security/inbox_payments_rules.xml',
        'data/inbox_payments_access_permissions.xml',
        'data/inbox_payments_crons.xml',
    ],
    'installable': True,
    'application': False,
}
