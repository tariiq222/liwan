# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'liwan Payments and Customers',
    'summary': 'liwan platform: what online payments hold about a customer, in its privacy export and erase',
    'version': '19.0.1.0.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # The bridge between the shared payments service and the shared customers service (rank 5): both are rank 3 and
    # neither may depend on the other (spec R4), so the hooks that declare what payments hold about a customer live
    # here. Installed by Odoo as soon as both are. It owns the privacy hook of the online orders (sale.order and its
    # lines), the payment transactions and the saved payment tokens, and the ACL rows that let the privacy
    # capabilities of liwan_customers read and clear them in the caller's own environment.
    'depends': ['liwan_payments', 'liwan_customers'],
    'auto_install': ['liwan_payments', 'liwan_customers'],
    'data': [
        'security/ir.model.access.csv',
        'security/payments_customers_rules.xml',
    ],
    'installable': True,
    'application': False,
}
