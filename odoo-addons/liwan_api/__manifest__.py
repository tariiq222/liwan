# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'liwan API',
    'summary': 'liwan platform: shared /api/v1 plumbing — auth, branding, me',
    'version': '19.0.1.2.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # Shared plumbing only: liwan_core for the LiwanAccessRule exception and the
    # liwan.access.service identity reads, liwan_platform for the tenant profile
    # and entitlement service reads. The second sign-in step is LiwanOS's own (liwan_core's
    # sign-in code and remembered device), so no MFA engine addon is needed.
    'depends': ['liwan_core', 'liwan_platform'],
    'data': [
        'security/ir.model.access.csv',
        'security/branding_rules.xml',
    ],
    'installable': True,
    'application': False,
}
