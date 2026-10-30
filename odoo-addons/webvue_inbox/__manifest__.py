# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'webvue Customer Inbox',
    'summary': 'webvue platform: the Customer Inbox application — WhatsApp conversations, /api/v1/inbox',
    'version': '19.0.1.8.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # webvue_api: shared api_handler/ApiError + WebVueApiCase. An application depends
    # on webvue_api and no other application (spec R3); it owns its capabilities,
    # groups, roles and record rules (spec R2).
    # webvue_notify: the bell kind of a new assignment. mail: the bell row is a mail.message.
    # bus: the realtime nudge of the conversation workspace.
    'depends': ['webvue_core', 'webvue_api', 'webvue_platform', 'webvue_notify', 'mail', 'bus'],
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
