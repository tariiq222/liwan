# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'liwan Chat',
    'summary': 'liwan platform: member-private chat over native discuss.channel',
    'version': '19.0.1.3.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # liwan_api: api_handler/ApiError and iso(). liwan_platform: the post-migration
    # and post-install backfills read liwan.tenant.profile, so `-u liwan_chat` must
    # install it directly. mail: discuss.channel, message_post.
    # Channels are company-scoped; isolation is a global ir.rule plus stored company_id.
    'depends': ['liwan_api', 'liwan_platform', 'mail'],
    'data': [
        'security/chat_rules.xml',
        'security/chat_capability_groups.xml',
        'data/chat_access_permissions.xml',
        'security/ir.model.access.csv',
        'security/chat_settings_rules.xml',
    ],
    'post_init_hook': 'post_init_hook',
    'installable': True,
    'application': False,
}
