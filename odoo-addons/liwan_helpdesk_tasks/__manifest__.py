# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'liwan Helpdesk and Tasks',
    'summary': 'liwan platform: follow-up tasks on a support ticket — /api/v1/helpdesk/tickets/<id>/tasks',
    'version': '19.0.1.0.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # The bridge between two applications (spec R3, rank 5): installed by Odoo as soon as liwan_helpdesk and
    # liwan_tasks are both installed. It owns the link from a personal task to a ticket and the routes that list
    # and create the tasks of one ticket; neither application knows the other.
    'depends': ['liwan_helpdesk', 'liwan_tasks'],
    'auto_install': True,
    'installable': True,
    'application': False,
}
