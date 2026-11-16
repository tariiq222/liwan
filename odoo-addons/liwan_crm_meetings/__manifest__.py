# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'liwan CRM and Meetings',
    'summary': 'liwan platform: meetings linked to a CRM opportunity — /api/v1/crm/opportunities/<id>/meetings',
    'version': '19.0.1.0.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # The bridge between two applications (rank 5): installed by Odoo as soon as liwan_crm and
    # liwan_meetings are both installed. It owns the lead_id column of meetings and the two routes
    # that list and create the meetings of an opportunity. Uninstalling it drops the column (spec 2.1).
    'depends': ['liwan_crm', 'liwan_meetings'],
    'auto_install': True,
    'installable': True,
    'application': False,
}
