# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'liwan Telephony',
    'summary': 'liwan platform: the Telephony application — calls, extensions, lines and the machine event route',
    'version': '19.0.1.0.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # liwan_api: shared api_handler/ApiError + LiwanApiCase. An application depends on liwan_api and no other
    # application (spec R3); it owns its capabilities, groups, role and record rules (spec R2).
    'depends': ['liwan_api'],
    'data': [
        'security/telephony_capability_groups.xml',
        'security/ir.model.access.csv',
        'security/telephony_rules.xml',
        'data/telephony_access_permissions.xml',
        'data/telephony_roles.xml',
        'data/telephony_events_user.xml',
    ],
    'installable': True,
    'application': False,
}
