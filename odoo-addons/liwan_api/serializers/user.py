# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields
from odoo.exceptions import UserError

DEFAULT_LANG = 'ar_001'

ROLE_GROUPS = (
    ('vendor', 'liwan_core.group_vendor_support'),
    ('admin', 'liwan_core.group_access_admin'),
    ('admin', 'liwan_core.group_customer_admin'),
    ('employee', 'liwan_core.group_employee'),
)


def role_of(user):
    """Highest liwan role of ``user``; ``'employee'`` when in none of the groups."""
    for role, xmlid in ROLE_GROUPS:
        if user.has_group(xmlid):
            return role
    return 'employee'


def dump_switchable_companies(user):
    """The active companies ``user`` may switch to, the current one included.

    Read with the memberships allowed: the request context is pinned to one company, and a record rule would
    hide the others.
    """
    memberships = user.env['liwan.access.service']._liwan_membership_company_ids(user)
    companies = user.env['res.company'].with_context(allowed_company_ids=memberships).browse(memberships)
    return [{'id': company.id, 'name': company.name} for company in companies.sorted(lambda c: (c.name, c.id))]


def dump_me(user):
    service = user.env['liwan.access.service']
    identity = service._liwan_identity(user)
    platform = dump_platform(user)
    try:
        read_only = user.env['liwan.entitlement.service']._liwan_actor_read_only(user)
    except UserError:
        # If the profile cannot be read, the commercial proxy must not authorize writes.
        read_only = True
    return {
        'id': user.id,
        'name': user.name,
        'login': user.login,
        'email': user.email or '',
        'mobile': user.liwan_mobile or None,
        'mobile_required': service._liwan_mobile_required(user),
        # res.users.lang is False for a user whose partner has no language set;
        # the contract requires a string, and a null here 502s the whole app.
        'lang': user.lang or DEFAULT_LANG,
        'tz': user.tz or '',
        'role': ('vendor' if user.has_group('liwan_core.group_vendor_support')
                 else 'admin' if 'access.users.assign_roles' in identity['capabilities']
                 else 'employee'),
        'roles': identity['roles'],
        'capabilities': identity['capabilities'],
        'access_policy_version': identity['version'],
        'company': {'id': user.env.company.id, 'name': user.env.company.name},
        'companies': dump_switchable_companies(user),
        'home_company_id': user.company_id.id,
        'home_capabilities': service._liwan_home_capabilities(user),
        # The account is above the purchased seats: it reads and exports everything but takes no writes.
        'read_only': read_only,
        'appearance': dump_appearance(user),
        'modules': platform['modules'],
        'entitlements': platform['entitlements'],
        'platform': platform['platform'],
        'terminology': platform['terminology'],
        **({'commercial': platform['commercial']} if 'commercial' in platform else {}),
    }


def dump_platform(user):
    service = user.env['liwan.entitlement.service'].sudo()
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
        profile = service._liwan_profile()
    except UserError:
        return empty
    state = service._liwan_effective_state(profile)
    terminology = profile.terminology or {}
    if not isinstance(terminology, dict):
        terminology = {}
    return {
        # Local metadata only: never a billing grant or a network health check.
        'commercial': {
            'schema_version': 1,
            'mode': profile.commercial_mode,
            'self_service_available': False,
        },
        'modules': list(service._liwan_installed_modules()),
        'entitlements': service._liwan_dump_entitlements(profile),
        'platform': {
            'schema_version': 1,
            'policy_revision': profile.policy_revision or 0,
            'state': state,
            'valid_until': profile.valid_until.isoformat() if profile.valid_until else None,
            'read_only': state != 'active',
            'readable_features': list(service._liwan_readable_features(profile)),
            'writable_features': list(service._liwan_writable_features(profile)),
        },
        'terminology': {
            'ar': dict(terminology.get('ar') or {}),
            'en': dict(terminology.get('en') or {}),
        },
    }


def dump_appearance(user):
    return {
        'mode': user.liwan_appearance_mode or 'light',
        'font_size': user.liwan_font_size or 'small',
    }


def dump_device(device):
    """One remembered browser: what the holder sees revoking it, never the token or its hash."""
    return {
        'id': device.id,
        'label': device.label,
        'issued_at': _iso(device.issued_at),
        'expires_at': _iso(device.expires_at),
        'last_used_at': _iso(device.last_used_at),
    }


def _iso(value):
    return fields.Datetime.to_string(value).replace(' ', 'T') + 'Z' if value else None
