# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'webvue Payments',
    'summary': 'webvue platform: online payments through the tenant\'s own gateway account — /api/v1/payments',
    'version': '19.0.1.0.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # Shared service (spec R4, layer 3): it knows no application. Selling applications
    # depend on it and react through its hooks; it never reads their data.
    # webvue_api: api_handler/ApiError, the feature gate and WebVueApiCase.
    # payment_paymob: the first supported gateway, used unmodified (it brings payment and
    # portal). The tenant is its own merchant: its gateway keys live in the stock provider
    # fields of its own database and are never returned by the API.
    'depends': ['webvue_api', 'payment_paymob'],
    'data': [
        'security/payments_capability_groups.xml',
        'security/ir.model.access.csv',
        'data/payments_access_permissions.xml',
    ],
    'installable': True,
    'application': False,
}
