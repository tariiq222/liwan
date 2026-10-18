# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'webvue HR',
    'summary': 'webvue platform: the HR pillar — /api/v1/hr departments, employees, documents',
    'version': '19.0.1.3.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # webvue_api: shared api_handler/ApiError + WebVueApiCase. Pillars depend on
    # webvue_api, never the other way round, so a customer on the project pillar
    # alone never gets HR installed. webvue_hr owns its capabilities, groups and
    # the hr_manager role (spec R2).
    'depends': ['webvue_api', 'hr', 'mail'],
    'data': [
        'security/hr_capability_groups.xml',
        'security/hr_document_rules.xml',
        'security/ir.model.access.csv',
        'data/hr_access_permissions.xml',
    ],
    'installable': True,
    'application': False,
}
