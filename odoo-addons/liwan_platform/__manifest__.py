# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'liwan Platform',
    'summary': 'liwan platform: tenant profile, entitlements and feature registry',
    'version': '19.0.1.15.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # http_routing redirects a request by language prefix inside its own ``_match``; ours must run first.
    # fs_attachment_s3 pulls the pinned OCA fs_storage and fs_attachment engines every tenant gets.
    'depends': ['liwan_core', 'http_routing', 'fs_attachment_s3'],
    'data': [
        'security/maintenance_security.xml',
        'security/ir.model.access.csv',
        'security/liwan_branch_rules.xml',
        'data/maintenance_permission.xml',
        'data/trial_expiry_cron.xml',
        'data/storage_recount_cron.xml',
    ],
    # Every request line reaches the werkzeug log: the hook masks secret query values before any application is served.
    'post_load': 'post_load',
    'post_init_hook': 'post_init_hook',
    'installable': True,
    'application': False,
}
