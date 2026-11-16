# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'liwan Sales and CRM',
    'summary': 'liwan platform: a quotation from a CRM opportunity, and the opportunity won when its order is confirmed',
    'version': '19.0.1.0.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # The bridge between two applications (spec 2.1, rank 5): installed by Odoo as soon as liwan_sales and liwan_crm are
    # both installed. It owns the link from a quotation to an opportunity (`liwan_lead_id`), the routes that list and
    # create the quotations of one opportunity, the win of the opportunity when one of its orders is confirmed and the two
    # settings that shape it; neither application knows the other. It adds no model.
    'depends': ['liwan_sales', 'liwan_crm'],
    'auto_install': True,
    'installable': True,
    'application': False,
}
