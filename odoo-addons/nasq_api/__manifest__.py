# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'nasq API',
    'summary': 'nasq platform: shared /api/v1 plumbing — auth, branding, me',
    'version': '19.0.1.0.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # Shared plumbing only: nasq_core for the NasqAccessRule exception and the
    # nasq.access.service identity reads, nasq_platform for the tenant profile
    # and entitlement service reads, auth_totp for controllers/auth.py's MFA
    # step. No pillar addon (nasq_pmo/nasq_hr/nasq_chat) may be depended on.
    'depends': ['nasq_core', 'nasq_platform', 'auth_totp'],
    'data': [
        'security/ir.model.access.csv',
        'security/branding_rules.xml',
    ],
    'installable': True,
    'application': False,
}
