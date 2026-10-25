# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'webvue API',
    'summary': 'webvue platform: shared /api/v1 plumbing — auth, branding, me',
    'version': '19.0.1.1.1',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # Shared plumbing only: webvue_core for the WebVueAccessRule exception and the
    # webvue.access.service identity reads, webvue_platform for the tenant profile
    # and entitlement service reads, auth_totp for controllers/auth.py's MFA
    # step. No pillar addon (webvue_pmo/webvue_hr/webvue_chat) may be depended on.
    'depends': ['webvue_core', 'webvue_platform', 'auth_totp'],
    'data': [
        'security/ir.model.access.csv',
        'security/branding_rules.xml',
    ],
    'installable': True,
    'application': False,
}
