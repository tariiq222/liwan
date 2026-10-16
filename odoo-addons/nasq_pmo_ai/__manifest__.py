# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'nasq PMO and AI',
    'summary': 'nasq platform: declares the PMO tools of the Nasq AI assistant',
    'version': '19.0.1.0.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # The bridge between two applications (spec 2.1, rank 5): installed by
    # Odoo as soon as nasq_pmo and nasq_ai are both installed. nasq_pmo does
    # not know the assistant; this bridge declares PMO's tools in the
    # nasq.ai.tool.registry that nasq_ai owns.
    'depends': ['nasq_pmo', 'nasq_ai'],
    'auto_install': True,
    'installable': True,
    'application': False,
}
