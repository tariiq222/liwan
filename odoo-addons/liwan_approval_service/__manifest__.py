# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'Liwan Approval Service',
    'summary': 'Versioned approval processes, decisions and audit records',
    'version': '19.0.1.0.0',
    'category': 'Hidden',
    'license': 'LGPL-3',
    'depends': ['liwan_api', 'base_tier_validation'],
    'data': [
        'security/operations_capability_groups.xml', 'data/operations_access_permissions.xml',
        'security/ir.model.access.csv', 'security/operations_rules.xml',
    ],
    'pre_init_hook': 'pre_init_hook',
    'installable': True,
    'application': False,
}
