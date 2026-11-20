# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'liwan Support Desk',
    'summary': 'liwan platform: the Support Desk application — /api/v1/helpdesk tickets, teams and SLA',
    'version': '19.0.1.1.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # liwan_api: shared api_handler/ApiError + LiwanApiCase. liwan_notify: the assignment bell.
    # liwan_customers: the one writer of a customer; a ticket's requester is resolved through it and the
    # privacy hooks extend its service. An application depends on liwan_api, shared services and no other
    # application (spec R3); it owns its capabilities, groups, roles and record rules (spec R2).
    # helpdesk_mgmt, helpdesk_mgmt_sla and helpdesk_type are the OCA 19.0 engine
    # (deploy/oca-addons.json, fetched unmodified and limited to these four modules): the ticket, its team,
    # stage, category, tag and channel, the mail thread, the sequence, the SLA deadlines computed on the
    # team's resource calendar, and the ticket type list. The
    # engine's own views, menus, portal controllers and groups are never used: the platform guard closes
    # every route outside /api/v1 and LiwanOS serves its own screens and capabilities.
    'depends': [
        'liwan_api', 'liwan_notify', 'liwan_customers',
        'helpdesk_mgmt', 'helpdesk_mgmt_sla', 'helpdesk_type',
    ],
    'data': [
        'security/helpdesk_capability_groups.xml',
        'security/ir.model.access.csv',
        'security/helpdesk_rules.xml',
        'data/helpdesk_access_permissions.xml',
        'data/helpdesk_cron.xml',
    ],
    'post_init_hook': 'post_init_hook',
    'installable': True,
    'application': False,
}
