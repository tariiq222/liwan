# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'nasq Chat',
    'summary': 'nasq platform: member-private chat over native discuss.channel',
    'version': '19.0.1.0.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # nasq_api: api_handler/ApiError and iso(). mail: discuss.channel, message_post.
    # No durable duplicate messaging model. Channels stay native and unscoped by company.
    'depends': ['nasq_api', 'mail'],
    'installable': True,
    'application': False,
}
