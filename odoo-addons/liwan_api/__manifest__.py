# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'liwan API',
    'summary': 'liwan platform: shared /api/v1 plumbing — auth, branding, me',
    'version': '19.0.1.1.1',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # Shared plumbing only: liwan_core for the LiwanAccessRule exception and the
    # liwan.access.service identity reads, liwan_platform for the tenant profile
    # and entitlement service reads, auth_totp for controllers/auth.py's MFA
    # step. No pillar addon (liwan_pmo/liwan_hr/liwan_chat) may be depended on.
    'depends': ['liwan_core', 'liwan_platform', 'auth_totp'],
    'data': [
        'security/ir.model.access.csv',
        'security/branding_rules.xml',
    ],
    'installable': True,
    'application': False,
}
