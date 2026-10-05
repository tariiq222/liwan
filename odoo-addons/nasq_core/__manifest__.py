# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'nasq Core',
    'summary': 'nasq platform: roles and branding defaults',
    'version': '19.0.1.1.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # base only (spec R1): each application adds its own capabilities, groups,
    # roles and record rules from its addon through nasq.access.service hooks.
    # res.company.font / primary_color are base fields. No hr_timesheet: nasq
    # has no time logging.
    'depends': ['base'],
    'data': [
        'security/nasq_core_security.xml',
        'data/access_migration_pre.xml',
        'security/nasq_access_groups.xml',
        'security/ir.model.access.csv',
        'security/nasq_access_rules.xml',
        'data/access_permissions.xml',
        'data/access_permission_dependencies.xml',
        'data/access_roles.xml',
        'data/access_migration_post.xml',
        'data/res_company_data.xml',
        'data/res_users_data.xml',
    ],
    'installable': True,
    'application': False,
}
