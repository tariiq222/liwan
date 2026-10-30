# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'liwan PMO and AI',
    'summary': 'liwan platform: declares the PMO tools of the LiwanOS AI assistant',
    'version': '19.0.1.1.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # The bridge between two applications (spec 2.1, rank 5): installed by
    # Odoo as soon as liwan_pmo and liwan_ai are both installed. liwan_pmo does
    # not know the assistant; this bridge declares PMO's tools in the
    # liwan.ai.tool.registry that liwan_ai owns.
    'depends': ['liwan_pmo', 'liwan_ai'],
    'auto_install': True,
    'installable': True,
    'application': False,
}
