# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'nasq Core',
    'summary': 'nasq platform: roles and branding defaults',
    'version': '19.0.1.0.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # project / hr: security/nasq_core_security.xml's groups imply
    # project.group_project_user + _manager and hr.group_hr_manager; res.company.font /
    # primary_color are base fields. No hr_timesheet: nasq has no time logging.
    'depends': ['base', 'project', 'hr'],
    'data': [
        'security/nasq_core_security.xml',
        'data/res_company_data.xml',
        'data/res_users_data.xml',
    ],
    'installable': True,
    'application': False,
}
