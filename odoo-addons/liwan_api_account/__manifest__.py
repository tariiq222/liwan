# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'liwan Company Tax',
    'summary': "liwan platform: the establishment's one tax choice (stock account_price_include) — /api/v1/admin/company/tax",
    'version': '19.0.1.0.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # The bridge of D22 (rank 5): liwan_api owns the routes, the capabilities and the company profile; stock
    # `account` owns the `res.company.account_price_include` field this addon makes a root-delegated field, and the
    # taxes it defaults. The web client learns the section exists from the derived session key
    # `company_tax.enabled`, and every write still needs `settings.company.vat.manage` in the root company.
    'depends': ['liwan_api', 'account'],
    'auto_install': ['liwan_api', 'account'],
    'post_init_hook': 'post_init_hook',
    'installable': True,
    'application': False,
}
