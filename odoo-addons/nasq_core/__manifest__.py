# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'nasq Core',
    'summary': 'nasq platform: roles and branding defaults',
    'version': '19.0.1.0.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    'depends': ['base', 'web', 'project', 'hr', 'hr_timesheet', 'mail'],
    'data': [
        'security/nasq_core_security.xml',
        'data/res_company_data.xml',
        'data/res_users_data.xml',
    ],
    'installable': True,
    'application': False,
}
