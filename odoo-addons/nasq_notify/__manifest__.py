# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'nasq Notify',
    'summary': 'nasq platform: the shared notification bell — delivery, type registry, /api/v1/notifications',
    'version': '19.0.1.0.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # Shared service (spec 2.1, layer 2): it knows no application. Each
    # application registers its notification kinds in nasq.notify.registry.
    # nasq_api: api_handler, the registry-driven feature gate and NasqApiCase.
    # mail: a bell row is a mail.message plus an inbox mail.notification.
    'depends': ['nasq_api', 'mail'],
    'installable': True,
    'application': False,
}
