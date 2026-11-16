# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'liwan CRM and Tasks',
    'summary': 'liwan platform: follow-up tasks on a CRM opportunity — /api/v1/crm/opportunities/<id>/tasks',
    'version': '19.0.1.0.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # The bridge between two applications (spec 2.1, rank 5): installed by Odoo as soon as liwan_crm and
    # liwan_tasks are both installed. It owns the link from a task to an opportunity and the routes that
    # list and create the tasks of one opportunity; neither application knows the other.
    'depends': ['liwan_crm', 'liwan_tasks'],
    'auto_install': True,
    'installable': True,
    'application': False,
}
