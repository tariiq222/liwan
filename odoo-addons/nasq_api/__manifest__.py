# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'nasq API',
    'summary': 'nasq platform: shared /api/v1 plumbing — auth, branding, me',
    'version': '19.0.1.0.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # Shared plumbing: nasq_core for the role groups serializers/user.py reads,
    # auth_totp for controllers/auth.py's MFA step. nasq_hr for the HR /api/v1
    # routes (departments, employees, documents).
    'depends': ['nasq_core', 'auth_totp', 'nasq_hr'],
    'installable': True,
    'application': False,
}
