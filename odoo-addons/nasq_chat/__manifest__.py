# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'nasq Chat',
    'summary': 'nasq platform: member-private chat over native discuss.channel',
    'version': '19.0.1.1.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # nasq_api: api_handler/ApiError and iso(). mail: discuss.channel, message_post.
    # Channels are company-scoped; isolation is a global ir.rule plus stored company_id.
    'depends': ['nasq_api', 'mail'],
    'data': [
        'security/chat_rules.xml',
    ],
    'post_init_hook': 'post_init_hook',
    'installable': True,
    'application': False,
}
