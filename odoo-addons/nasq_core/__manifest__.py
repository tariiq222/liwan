# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'nasq Core',
    'summary': 'nasq platform: roles and branding defaults',
    'version': '19.0.1.0.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # project / hr / hr_timesheet: security/nasq_core_security.xml's groups imply
    # project.group_project_user + _manager, hr.group_hr_manager and
    # hr_timesheet.group_hr_timesheet_user; res.company.font / primary_color are base fields.
    'depends': ['base', 'project', 'hr', 'hr_timesheet'],
    'data': [
        'security/nasq_core_security.xml',
        'data/res_company_data.xml',
        'data/res_users_data.xml',
    ],
    'installable': True,
    'application': False,
}
