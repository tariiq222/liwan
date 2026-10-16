# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'webvue PMO and AI',
    'summary': 'webvue platform: declares the PMO tools of the WebVue AI assistant',
    'version': '19.0.1.1.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # The bridge between two applications (spec 2.1, rank 5): installed by
    # Odoo as soon as webvue_pmo and webvue_ai are both installed. webvue_pmo does
    # not know the assistant; this bridge declares PMO's tools in the
    # webvue.ai.tool.registry that webvue_ai owns.
    'depends': ['webvue_pmo', 'webvue_ai'],
    'auto_install': True,
    'installable': True,
    'application': False,
}
