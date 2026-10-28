# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'webvue Finance',
    'summary': 'webvue platform: the Finance application — /api/v1/finance over account and l10n_sa',
    'version': '19.0.1.4.2',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # webvue_api: shared api_handler/ApiError + WebVueApiCase. The application depends
    # on webvue_api and no other application (spec R3); it owns its capabilities,
    # groups and the finance_manager role (spec R2). Stock account holds the data and
    # its record rules; base_vat validates partner VAT numbers and the company VAT number
    # (the Saudi 15-digit ZATCA TIN rule); l10n_sa supplies the Saudi chart and taxes; l10n_sa_edi is the
    # ZATCA e-invoicing (Fatoora phase 2) engine that the onboarding and submission routes drive;
    # webvue_integrations_sa (rank 3) holds the connection status that onboarding keeps current.
    # The pinned OCA modules (deploy/oca-addons.json, docs/oca-addons.md) are used unmodified through
    # their public models: account_financial_report (trial balance, general ledger, aged partner
    # balance), partner_statement, account_asset_management (fixed assets), account_reconcile_oca
    # (bank reconciliation, which pulls account_statement_base) and mis_builder (profit and loss,
    # balance sheet, Zakat base) and mis_builder_budget (budgets by account).
    'depends': [
        'webvue_api', 'webvue_integrations_sa', 'analytic', 'account', 'account_debit_note', 'base_vat', 'l10n_sa', 'l10n_sa_edi',
        'account_financial_report', 'partner_statement', 'account_asset_management',
        'account_reconcile_oca', 'mis_builder', 'mis_builder_budget',
    ],
    'data': [
        'security/finance_capability_groups.xml',
        'security/ir.model.access.csv',
        'security/finance_audit_rules.xml',
        'data/finance_access_permissions.xml',
        'data/finance_mis_reports.xml',
    ],
    'post_init_hook': 'post_init_hook',
    'installable': True,
    'application': False,
}
