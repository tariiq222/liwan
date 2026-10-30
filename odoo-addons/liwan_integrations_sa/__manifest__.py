# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'liwan Saudi Integrations',
    'summary': 'liwan platform: status of the Saudi live links (ZATCA, banks) — /api/v1/integrations',
    'version': '19.0.1.0.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # Shared service (spec R4, layer 3): it knows no application. Applications read
    # connection status through the feature registry, never by import. liwan_api:
    # api_handler/ApiError, the feature gate and LiwanApiCase. This version holds
    # status only: no credentials, no network calls.
    'depends': ['liwan_api'],
    'data': [
        'security/integrations_capability_groups.xml',
        'security/integrations_rules.xml',
        'security/ir.model.access.csv',
        'data/integrations_access_permissions.xml',
        'data/integrations_connections.xml',
    ],
    'installable': True,
    'application': False,
}
