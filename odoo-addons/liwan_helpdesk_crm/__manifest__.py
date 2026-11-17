# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'liwan Helpdesk and CRM',
    'summary': 'liwan platform: the opportunity of a support ticket — /api/v1/helpdesk/tickets/<id>/opportunity',
    'version': '19.0.1.0.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # The bridge between two applications (spec R3, rank 5): installed by Odoo as soon as liwan_helpdesk and
    # liwan_crm are both installed. It owns the link from a ticket to an opportunity and the route that links,
    # replaces or clears it; neither application knows the other.
    'depends': ['liwan_helpdesk', 'liwan_crm'],
    'auto_install': True,
    'installable': True,
    'application': False,
}
