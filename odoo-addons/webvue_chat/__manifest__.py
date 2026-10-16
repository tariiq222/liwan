# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'webvue Chat',
    'summary': 'webvue platform: member-private chat over native discuss.channel',
    'version': '19.0.1.2.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # webvue_api: api_handler/ApiError and iso(). webvue_platform: the post-migration
    # and post-install backfills read webvue.tenant.profile, so `-u webvue_chat` must
    # install it directly. mail: discuss.channel, message_post.
    # Channels are company-scoped; isolation is a global ir.rule plus stored company_id.
    'depends': ['webvue_api', 'webvue_platform', 'mail'],
    'data': [
        'security/chat_rules.xml',
    ],
    'post_init_hook': 'post_init_hook',
    'installable': True,
    'application': False,
}
