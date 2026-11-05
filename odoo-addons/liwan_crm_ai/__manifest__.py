# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'liwan CRM and AI',
    'summary': 'liwan platform: the CRM agent of the LiwanOS AI and its tools',
    'version': '19.0.1.0.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # The bridge between two applications (rank 5): installed as soon as liwan_crm and liwan_ai are both
    # installed. It declares the CRM agent and its tools in the registries liwan_ai owns (spec 2026-11-04 §6.6).
    'depends': ['liwan_crm', 'liwan_ai'],
    'auto_install': True,
    'installable': True,
    'application': False,
}
