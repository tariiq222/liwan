# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'liwan AI notifications',
    'summary': 'liwan platform: tells the AI settings managers in the bell when usage reaches 80% of a limit or the AI balance runs low',
    'version': '19.0.1.1.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # A bridge (rank 5) between two shared services: liwan_ai and liwan_notify share rank 3 and may not
    # depend on each other, so the limit warning lives here and installs with both (spec 2026-11-04 §6.9).
    'depends': ['liwan_ai', 'liwan_notify'],
    'auto_install': True,
    'data': ['data/balance_cron.xml'],
    'installable': True,
    'application': False,
}
