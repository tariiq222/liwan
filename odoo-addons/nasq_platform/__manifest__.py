# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'nasq Platform',
    'summary': 'nasq platform: tenant profile and root company',
    'version': '19.0.1.0.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    'depends': ['nasq_core'],
    'data': [
        'security/ir.model.access.csv',
    ],
    'post_init_hook': 'post_init_hook',
    'installable': True,
    'application': False,
}
