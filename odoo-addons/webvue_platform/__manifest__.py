# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'webvue Platform',
    'summary': 'webvue platform: tenant profile, entitlements and feature registry',
    'version': '19.0.1.5.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    'depends': ['webvue_core'],
    'data': [
        'security/maintenance_security.xml',
        'security/ir.model.access.csv',
        'security/webvue_branch_rules.xml',
        'data/maintenance_permission.xml',
    ],
    'post_init_hook': 'post_init_hook',
    'installable': True,
    'application': False,
}
