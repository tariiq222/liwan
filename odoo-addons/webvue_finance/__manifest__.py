# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'webvue Finance',
    'summary': 'webvue platform: the Finance application — /api/v1/finance over account and l10n_sa',
    'version': '19.0.1.0.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # webvue_api: shared api_handler/ApiError + WebVueApiCase. The application depends
    # on webvue_api and no other application (spec R3); it owns its capabilities,
    # groups and the finance_manager role (spec R2). Stock account holds the data and
    # its record rules; base_vat validates partner VAT numbers and the company VAT number
    # (the Saudi 15-digit ZATCA TIN rule); l10n_sa supplies the Saudi chart and taxes.
    'depends': ['webvue_api', 'account', 'base_vat', 'l10n_sa'],
    'data': [
        'security/finance_capability_groups.xml',
        'data/finance_access_permissions.xml',
    ],
    'installable': True,
    'application': False,
}
