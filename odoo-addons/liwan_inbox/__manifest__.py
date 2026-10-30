# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'liwan Customer Inbox',
    'summary': 'liwan platform: the Customer Inbox application — WhatsApp conversations, /api/v1/inbox',
    'version': '19.0.1.8.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # liwan_api: shared api_handler/ApiError + LiwanApiCase. An application depends
    # on liwan_api and no other application (spec R3); it owns its capabilities,
    # groups, roles and record rules (spec R2).
    # liwan_notify: the bell kind of a new assignment. mail: the bell row is a mail.message.
    # bus: the realtime nudge of the conversation workspace.
    'depends': ['liwan_core', 'liwan_api', 'liwan_platform', 'liwan_notify', 'mail', 'bus'],
    'data': [
        'security/inbox_capability_groups.xml',
        'security/inbox_rules.xml',
        'security/ir.model.access.csv',
        'data/inbox_access_permissions.xml',
        'data/inbox_hook_user.xml',
        'data/inbox_crons.xml',
    ],
    'installable': True,
    'application': False,
}
