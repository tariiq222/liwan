# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'liwan Integrations',
    'summary': 'liwan platform: provider connections, their encrypted secrets, uses, senders and signed callbacks — /api/v1/integrations',
    'version': '19.0.1.2.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # Shared service (spec R4, layer 3): it knows no application. An application registers its uses of a
    # provider (and an external provider's derived status) by extending liwan.integration.registry, and asks
    # for credentials through the connection model, never by import. liwan_api: api_handler/ApiError, the
    # feature gate and LiwanApiCase; liwan_core (through it): secret_box for the encrypted secrets.
    'depends': ['liwan_api'],
    'data': [
        'security/integrations_capability_groups.xml',
        'security/integrations_rules.xml',
        'security/ir.model.access.csv',
        'data/integrations_access_permissions.xml',
        'data/integrations_cron.xml',
    ],
    'external_dependencies': {'python': ['phonenumbers']},
    'installable': True,
    'application': False,
}
