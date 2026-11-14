# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'liwan CRM',
    'summary': 'liwan platform: the CRM application — /api/v1/crm opportunities, calls and follow-up',
    'version': '19.0.1.7.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # liwan_api: shared api_handler/ApiError + LiwanApiCase. liwan_notify: the bell for
    # follow-up reminders. crm and product are stock Odoo; crm_phonecall is the pinned OCA/crm
    # module (deploy/oca-addons.json). An application depends on no other application (spec R3);
    # it owns its capabilities, groups, roles and record rules (spec R2).
    'depends': ['liwan_api', 'liwan_customers', 'liwan_products', 'liwan_notify', 'crm', 'product', 'crm_phonecall'],
    # liwan_customers: the one phone normaliser (E.164 in the tenant's phone country). liwan_products: the one writer
    # and price function of a product; CRM only picks the products it offers as packages.
    'external_dependencies': {'python': ['openpyxl']},
    'data': [
        'security/crm_capability_groups.xml',
        'security/ir.model.access.csv',
        'security/crm_settings_rules.xml',
        'security/crm_rules.xml',
        'data/crm_access_permissions.xml',
        'data/crm_seed.xml',
        'data/crm_cron.xml',
    ],
    'installable': True,
    'application': False,
}
