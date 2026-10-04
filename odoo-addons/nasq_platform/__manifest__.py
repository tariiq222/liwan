# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'nasq Platform',
    'summary': 'nasq platform: tenant profile, entitlements and feature registry',
    'version': '19.0.1.3.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    'depends': ['nasq_core'],
    'data': [
        'security/ir.model.access.csv',
        'security/nasq_branch_rules.xml',
    ],
    'post_init_hook': 'post_init_hook',
    'installable': True,
    'application': False,
}
