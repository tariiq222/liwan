# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'nasq HR',
    'summary': 'nasq platform: the HR pillar — /api/v1/hr departments, employees, documents',
    'version': '19.0.1.1.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # nasq_api: shared api_handler/ApiError + NasqApiCase. Pillars depend on
    # nasq_api, never the other way round, so a customer on the project pillar
    # alone never gets HR installed. nasq_hr owns its capabilities, groups and
    # the hr_manager role (spec R2).
    'depends': ['nasq_api', 'hr', 'mail'],
    'data': [
        'security/hr_capability_groups.xml',
        'security/hr_document_rules.xml',
        'security/ir.model.access.csv',
        'data/hr_access_permissions.xml',
    ],
    'installable': True,
    'application': False,
}
