# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'liwan Orders',
    'summary': "liwan shared service: the one rule of an order line's tax (no tax without a VAT registration)",
    'version': '19.0.1.0.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # A shared service (rank 3) over liwan_api and stock `sale`. It installs itself wherever both are present
    # (plan D1), so no application or bridge has to name it to get the rule. It adds no model, so it has no
    # data and no security file.
    'depends': ['liwan_api', 'sale'],
    'auto_install': ['liwan_api', 'sale'],
    'installable': True,
    'application': False,
}
