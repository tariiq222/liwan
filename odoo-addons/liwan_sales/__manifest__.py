# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'liwan Sales',
    'summary': 'liwan platform: the Sales application — /api/v1/sales quotations and orders',
    'version': '19.0.1.1.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # liwan_api: shared api_handler/ApiError + LiwanApiCase. liwan_orders: the tax rule of an order line.
    # liwan_customers and liwan_products: the one customer directory and the one product and price function; Sales
    # only picks from them. liwan_notify: the bell the salesperson is told in. sale_management is stock Odoo. An
    # application depends on no other application (spec R3); it owns its capabilities, groups, roles and record rules
    # (spec R2).
    'depends': ['liwan_api', 'liwan_notify', 'liwan_orders', 'liwan_customers', 'liwan_products', 'sale_management'],
    'data': [
        'security/sales_capability_groups.xml',
        'security/ir.model.access.csv',
        'data/sales_settings.xml',
        'security/sales_rules.xml',
        'data/sales_access_permissions.xml',
    ],
    'installable': True,
    'application': False,
}
