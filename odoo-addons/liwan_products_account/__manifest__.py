# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'liwan Product Taxes',
    'summary': "liwan platform: a product's sale taxes and the tax part of the products price function",
    'version': '19.0.1.0.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # The bridge of plan D12/D21 (rank 5, the D19 kind): liwan_products owns the product definition, its extension
    # hook and the price function; stock `account` owns `product.template.taxes_id`, the taxes, the fiscal positions
    # and the tax computation. The establishment's tax choice (price includes tax or tax added) is stock
    # `res.company.account_price_include`, which liwan_api_account manages: this addon reads it through stock only.
    'depends': ['liwan_products', 'account'],
    'auto_install': ['liwan_products', 'account'],
    'installable': True,
    'application': False,
}
