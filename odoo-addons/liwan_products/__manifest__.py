# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'liwan Products',
    'summary': "liwan platform: the one writer of a product's definition on product.template — /api/v1/products",
    'version': '19.0.1.0.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # Shared service (spec R4, layer 3): it names no application. Applications register the feature keys that open
    # its routes and the capabilities that pick a product by extending liwan.products.service. liwan_api:
    # api_handler, the feature gate and LiwanApiCase; product: product.template, product.product and the pricelist
    # engine the price function reads.
    'depends': ['liwan_api', 'product'],
    'data': [
        'security/products_capability_groups.xml',
        'security/ir.model.access.csv',
        'security/products_rules.xml',
        'data/products_access_permissions.xml',
        'data/products_settings.xml',
    ],
    'installable': True,
    'application': False,
}
