# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'webvue Documents',
    'summary': 'webvue platform: the Documents application — /api/v1/documents records',
    'version': '19.0.1.0.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # webvue_api: shared api_handler/ApiError + WebVueApiCase. An application depends
    # on webvue_api and no other application (spec R3); it owns its capabilities,
    # groups, role and record rule (spec R2).
    'depends': ['webvue_api', 'webvue_directory', 'dms'],
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
