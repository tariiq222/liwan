# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'liwan Customers',
    'summary': 'liwan platform: the one writer of a commercial party (customer) on res.partner — /api/v1/customers',
    'version': '19.0.1.0.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # Shared service (spec R4, layer 3): it names no application. Applications register the feature keys that open
    # its routes and the capabilities that pick a customer by extending liwan.customers.service. liwan_api:
    # api_handler, the feature gate and LiwanApiCase; phone_validation: phone_sanitized on res.partner, which the
    # candidate search reads.
    'depends': ['liwan_api', 'phone_validation'],
    # The phone normaliser of the service parses numbers with it, through phone_validation.
    'external_dependencies': {'python': ['phonenumbers']},
    'data': [
        'security/customers_capability_groups.xml',
        'security/ir.model.access.csv',
        'data/customers_access_permissions.xml',
        'data/customers_settings.xml',
    ],
    'installable': True,
    'application': False,
}
