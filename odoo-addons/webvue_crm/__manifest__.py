# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'webvue CRM',
    'summary': 'webvue platform: the CRM application — /api/v1/crm opportunities, calls and follow-up',
    'version': '19.0.1.1.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # webvue_api: shared api_handler/ApiError + WebVueApiCase. webvue_notify: the bell for
    # follow-up reminders. crm and product are stock Odoo; crm_phonecall is the pinned OCA/crm
    # module (deploy/oca-addons.json). An application depends on no other application (spec R3);
    # it owns its capabilities, groups, roles and record rules (spec R2).
    'depends': ['webvue_api', 'webvue_notify', 'crm', 'product', 'crm_phonecall'],
    # Stock phone_validation normalises phones only with this library (pinned in deploy/odoo).
    'external_dependencies': {'python': ['openpyxl', 'phonenumbers']},
    'data': [
        'security/crm_capability_groups.xml',
        'security/ir.model.access.csv',
        'security/crm_settings_rules.xml',
        'security/crm_rules.xml',
        'data/crm_access_permissions.xml',
        'data/crm_seed.xml',
        'data/crm_cron.xml',
    ],
    'installable': True,
    'application': False,
}
