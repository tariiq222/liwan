# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'liwan Payments',
    'summary': 'liwan platform: online payments through the tenant\'s own gateway account — /api/v1/payments',
    'version': '19.0.1.3.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # Shared service (spec R4, layer 3): it knows no application. Selling applications
    # depend on it and react through its hooks; it never reads their data.
    # liwan_api: api_handler/ApiError, the feature gate and LiwanApiCase.
    # payment_paymob: the first supported gateway, used unmodified (it brings payment and
    # portal). account_payment: a transaction pays a posted invoice and stock post-processing
    # records and reconciles the payment. The tenant is its own merchant: its gateway keys live
    # in the stock provider fields of its own database and are never returned by the API.
    # sale: an online order is a stock quotation that stock confirms once it is paid; selling
    # applications create it through liwan.payments.service.
    'depends': ['liwan_api', 'payment_paymob', 'account_payment', 'sale'],
    'data': [
        'security/payments_capability_groups.xml',
        'security/ir.model.access.csv',
        'security/payments_rules.xml',
        'data/payments_access_permissions.xml',
        'data/payments_cron.xml',
    ],
    'post_init_hook': 'post_init_hook',
    'installable': True,
    'application': False,
}
