# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'liwan Helpdesk and Sales',
    'summary': 'liwan platform: bill the work of a ticket — /api/v1/helpdesk/tickets/<id>/quotations',
    'version': '19.0.1.0.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # The bridge between two applications (spec R3, rank 5): installed by Odoo as soon as liwan_helpdesk and
    # liwan_sales are both installed. It owns the ticket column of a quotation and the routes that list and open
    # one from a ticket; neither application knows the other.
    'depends': ['liwan_helpdesk', 'liwan_sales'],
    'auto_install': True,
    'installable': True,
    'application': False,
}
