# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'liwan HR',
    'summary': 'liwan platform: the HR pillar — /api/v1/hr departments, employees, leave, recruitment, shifts, onboarding, offboarding, assets',
    'version': '19.0.1.17.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # liwan_api: shared api_handler/ApiError + LiwanApiCase. Pillars depend on
    # liwan_api, never the other way round, so a customer on the project pillar
    # alone never gets HR installed. liwan_hr owns its capabilities, groups and
    # the hr_manager role (spec R2). hr_holidays is the leave engine;
    # hr_work_entry_holidays gives every leave type the work entry the payroll
    # engine needs. hr_recruitment, hr_employee_calendar_planning (OCA, pinned in
    # deploy/oca-addons.json) and hr_maintenance are the internal engines of the
    # recruitment, shifts and assets capabilities: the customer never opens Odoo
    # and never sees them. payroll (OCA/payroll, pinned) is the payslip engine of
    # the payroll section: its models only, never its groups, menus or views.
    'depends': ['liwan_api', 'liwan_notify', 'hr', 'mail', 'hr_holidays', 'hr_work_entry_holidays', 'hr_recruitment', 'hr_employee_calendar_planning', 'maintenance', 'hr_maintenance', 'payroll'],
    'data': [
        'security/hr_leave_officer_group.xml',
        'security/hr_capability_groups.xml',
        'security/ir.model.access.csv',
        'security/hr_engine_rules.xml',
        'security/hr_shift_rules.xml',
        'security/hr_leave_rules.xml',
        'security/hr_payroll_rules.xml',
        'data/hr_access_permissions.xml',
        'data/hr_gosi_rate_data.xml',
        'data/res_bank_data.xml',
        'data/hr_payroll_file_profile_data.xml',
        'data/hr_eos_case_data.xml',
        'data/hr_payroll_structure_data.xml',
        'data/hr_leave_type_data.xml',
        'data/hr_plan_purpose_data.xml',
    ],
    'post_init_hook': 'post_init_hook',
    'installable': True,
    'application': False,
}
