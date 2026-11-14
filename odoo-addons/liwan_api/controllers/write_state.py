# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import UserError

from odoo.addons.liwan_platform.models.read_only_guard import assert_writable


def session_may_write(company):
    """Whether a write by this session on ``company`` passes the fences, so a screen only offers what will be accepted.

    One question, asked of the fences themselves, never a copy of their rules: the tenant lifecycle (an expired or
    suspended tenant is read-only, what ``liwan_platform`` ``_liwan_guard_api`` refuses as ``tenant_read_only``) and
    ``assert_writable`` (the read-only seat, ``user_read_only``, and the read-only branch, ``branch_read_only``).
    An unreadable tenant profile fails closed, as ``/api/v1/me`` does for ``read_only``.
    """
    try:
        if company.env['liwan.entitlement.service']._liwan_effective_state() != 'active':
            return False
        assert_writable(company, 'write')
    except UserError:
        return False
    return True
