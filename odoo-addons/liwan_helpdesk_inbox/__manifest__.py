# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'liwan Helpdesk and Customer Messages',
    'summary': 'liwan platform: tickets raised from a conversation — /api/v1/inbox/conversations/<id>/tickets',
    'version': '19.0.1.1.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # The bridge between two applications (spec R3, rank 5): installed by Odoo as soon as liwan_inbox and
    # liwan_helpdesk are both installed. It owns the conversation column of a ticket and the routes that list and
    # open the tickets of a conversation; neither application knows the other.
    'depends': ['liwan_helpdesk', 'liwan_inbox'],
    'auto_install': True,
    'installable': True,
    'application': False,
}
