# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'webvue HR',
    'summary': 'webvue platform: the HR pillar — /api/v1/hr departments, employees, leave',
    'version': '19.0.1.5.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # webvue_api: shared api_handler/ApiError + WebVueApiCase. Pillars depend on
    # webvue_api, never the other way round, so a customer on the project pillar
    # alone never gets HR installed. webvue_hr owns its capabilities, groups and
    # the hr_manager role (spec R2). hr_holidays is the leave engine;
    # hr_work_entry_holidays gives every leave type the work entry the payroll
    # engine needs.
    'depends': ['webvue_api', 'hr', 'mail', 'hr_holidays', 'hr_work_entry_holidays'],
    'data': [
        'security/hr_leave_officer_group.xml',
        'security/hr_capability_groups.xml',
        'security/ir.model.access.csv',
        'data/hr_access_permissions.xml',
        'data/hr_leave_type_data.xml',
    ],
    'installable': True,
    'application': False,
}
