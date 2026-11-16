# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'liwan CRM and Customer Messages',
    'summary': 'liwan platform: link a conversation to a CRM opportunity — /api/v1/inbox/conversations/<id>/opportunity',
    'version': '19.0.1.0.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # The bridge between two applications (rank 5): installed by Odoo as soon as liwan_crm and liwan_inbox are
    # both installed. It owns the lead_id column of conversations and the routes that read, set and clear it;
    # neither application knows the other. Uninstalling it drops the column (spec 2.1).
    'depends': ['liwan_crm', 'liwan_inbox'],
    'auto_install': True,
    'installable': True,
    'application': False,
}
