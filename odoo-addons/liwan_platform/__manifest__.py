# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'liwan Platform',
    'summary': 'liwan platform: tenant profile, entitlements and feature registry',
    'version': '19.0.1.7.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    'depends': ['liwan_core'],
    'data': [
        'security/maintenance_security.xml',
        'security/ir.model.access.csv',
        'security/liwan_branch_rules.xml',
        'data/maintenance_permission.xml',
    ],
    'post_init_hook': 'post_init_hook',
    'installable': True,
    'application': False,
}
