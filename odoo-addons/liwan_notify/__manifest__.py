# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'liwan Notify',
    'summary': 'liwan platform: the shared notification bell — delivery, type registry, /api/v1/notifications',
    'version': '19.0.1.1.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # Shared service (spec 2.1, layer 2): it knows no application. Each
    # application registers its notification kinds in liwan.notify.registry.
    # liwan_api: api_handler, the registry-driven feature gate and LiwanApiCase.
    # mail: a bell row is a mail.message plus an inbox mail.notification.
    'depends': ['liwan_api', 'mail'],
    'installable': True,
    'application': False,
}
