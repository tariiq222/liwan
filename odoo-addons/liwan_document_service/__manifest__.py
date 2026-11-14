# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'Liwan Document Service',
    'summary': 'Managed documents, permissions and binary storage',
    'version': '19.0.1.0.0',
    'category': 'Hidden',
    'license': 'LGPL-3',
    'depends': ['liwan_api', 'dms'],
    'data': [
        'security/documents_capability_groups.xml',
        'security/documents_rules.xml',
        'security/ir.model.access.csv',
        'data/documents_access_permissions.xml',
    ],
    'pre_init_hook': 'pre_init_hook',
    'post_init_hook': 'post_init_hook',
    'installable': True,
    'application': False,
}
