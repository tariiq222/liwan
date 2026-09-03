# Part of Odoo. See LICENSE file for full copyright and licensing details.
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
        'lang': user.lang,
        'tz': user.tz or '',
        'role': role_of(user),
        'company': {'id': user.company_id.id, 'name': user.company_id.name},
    }
