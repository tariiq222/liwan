# Part of Odoo. See LICENSE file for full copyright and licensing details.
DEFAULT_LANG = 'ar_001'

ROLE_GROUPS = (
    ('vendor', 'nasq_core.group_vendor_support'),
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
    return {
        'id': user.id,
        'name': user.name,
        'login': user.login,
        'email': user.email or '',
        # res.users.lang is False for a user whose partner has no language set;
        # the contract requires a string, and a null here 502s the whole app.
        'lang': user.lang or DEFAULT_LANG,
        'tz': user.tz or '',
        'role': role_of(user),
        'company': {'id': user.company_id.id, 'name': user.company_id.name},
    }
