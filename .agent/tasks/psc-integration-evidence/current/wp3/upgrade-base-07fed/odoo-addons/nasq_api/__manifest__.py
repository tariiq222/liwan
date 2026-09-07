# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'nasq API',
    'summary': 'nasq platform: shared /api/v1 plumbing — auth, branding, me',
    'version': '19.0.1.0.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # Shared plumbing only: nasq_core for the role groups serializers/user.py reads,
    # auth_totp for controllers/auth.py's MFA step. No pillar addon may be depended on.
    'depends': ['nasq_core', 'auth_totp'],
    'data': [
        'security/ir.model.access.csv',
        'security/branding_rules.xml',
    ],
    'installable': True,
    'application': False,
}
