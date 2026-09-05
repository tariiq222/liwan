# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'nasq HR',
    'summary': 'nasq platform: department documents and HR directory rules',
    'version': '19.0.1.0.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    'depends': ['nasq_core', 'hr', 'mail'],
    'data': [
        'security/hr_document_rules.xml',
        'security/ir.model.access.csv',
    ],
    'installable': True,
    'application': False,
}
