# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import UserError

DEFAULT_LANG = 'ar_001'

ROLE_GROUPS = (
    ('vendor', 'nasq_core.group_vendor_support'),
    ('admin', 'nasq_core.group_access_admin'),
    ('admin', 'nasq_core.group_customer_admin'),
    ('employee', 'nasq_core.group_employee'),
)


def role_of(user):
    """Highest nasq role of ``user``; ``'employee'`` when in none of the groups."""
    for role, xmlid in ROLE_GROUPS:
        if user.has_group(xmlid):
            return role
    return 'employee'


def dump_me(user):
    identity = user.env['nasq.access.service']._nasq_identity(user)
    platform = dump_platform(user)
    return {
        'id': user.id,
        'name': user.name,
        'login': user.login,
        'email': user.email or '',
        # res.users.lang is False for a user whose partner has no language set;
        # the contract requires a string, and a null here 502s the whole app.
        'lang': user.lang or DEFAULT_LANG,
        'tz': user.tz or '',
        'role': ('vendor' if user.has_group('nasq_core.group_vendor_support')
                 else 'admin' if 'access.users.assign_roles' in identity['capabilities']
                 else 'employee'),
        'roles': identity['roles'],
        'capabilities': identity['capabilities'],
        'access_policy_version': identity['version'],
        'company': {'id': user.env.company.id, 'name': user.env.company.name},
        'appearance': dump_appearance(user),
        'modules': platform['modules'],
        'entitlements': platform['entitlements'],
        'platform': platform['platform'],
        'terminology': platform['terminology'],
    }


def dump_platform(user):
    service = user.env['nasq.entitlement.service'].sudo()
    empty = {
        'modules': [],
        'entitlements': {},
        'platform': {
            'schema_version': 1,
            'policy_revision': 0,
            'state': 'active',
            'valid_until': None,
            'read_only': False,
            'readable_features': [],
            'writable_features': [],
        },
        'terminology': {'ar': {}, 'en': {}},
    }
    try:
        profile = service._nasq_profile()
    except UserError:
        return empty
    state = service._nasq_effective_state(profile)
    terminology = profile.terminology or {}
    if not isinstance(terminology, dict):
        terminology = {}
    return {
        'modules': list(service._nasq_installed_modules()),
        'entitlements': service._nasq_dump_entitlements(profile),
        'platform': {
            'schema_version': 1,
            'policy_revision': profile.policy_revision or 0,
            'state': state,
            'valid_until': profile.valid_until.isoformat() if profile.valid_until else None,
            'read_only': state != 'active',
            'readable_features': list(service._nasq_readable_features(profile)),
            'writable_features': list(service._nasq_writable_features(profile)),
        },
        'terminology': {
            'ar': dict(terminology.get('ar') or {}),
            'en': dict(terminology.get('en') or {}),
        },
    }


def dump_appearance(user):
    return {
        'mode': user.nasq_appearance_mode or 'light',
        'font_size': user.nasq_font_size or 'small',
    }
