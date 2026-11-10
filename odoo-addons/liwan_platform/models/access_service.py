# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

from .res_users import INVITEE_CONTEXT
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule

GRANT = 'access.users.grant'


class LiwanPlatformAccessService(models.AbstractModel):
    _inherit = 'liwan.access.service'

    @api.model
    def _liwan_create_invitee(self, name, login, partner_id):
        """An invitee holds no seat while the invitation is pending; the seat is claimed at acceptance."""
        return super(LiwanPlatformAccessService, self.with_context(**{INVITEE_CONTEXT: True}))._liwan_create_invitee(
            name, login, partner_id,
        )

    @api.model
    def _liwan_use_link(self, link, vals, audit_action):
        if link.purpose == 'invite':
            vals = {**vals, **self._liwan_acceptance_seat_vals()}
        return super()._liwan_use_link(link, vals, audit_action)

    @api.model
    def _liwan_acceptance_seat_vals(self):
        """Read-only flags for an invitee who accepts while every full seat is taken.

        The accepting account takes its seat without a claim, so the profile row is updated here, before the
        count: a concurrent acceptance whose snapshot predates the winner's commit then fails to serialize
        (and is retried) instead of counting a stale free seat, as a seat claim does.
        """
        entitlement = self.env['liwan.entitlement.service']
        entitlement._liwan_profile()._liwan_bump_quota_revision()
        limit = entitlement._liwan_limit_value('users.limit')
        if limit is None or entitlement._liwan_count_users() < limit:
            return {}
        return {'liwan_read_only': True, 'liwan_seat_choice': 'auto'}

    @api.model
    def _liwan_disable_user(self, user, expected_version):
        if self._liwan_has_capability(user, GRANT, company=user.company_id):
            user._liwan_seat_holders()._liwan_assert_grant_holder_survives()
        result = super()._liwan_disable_user(user, expected_version)
        # The freed seat reopens the next read-only account in order.
        self.env['liwan.entitlement.service']._liwan_settle_users()
        return result

    @api.model
    def _liwan_set_seat(self, user, expected_version, read_only=None, priority=None):
        """Make USER a full or a read-only seat holder, or set their reopening priority; the limit is enforced by the claim."""
        self._liwan_require_capability(GRANT)
        self._liwan_assert_user_scope(user)
        if user == self.env.user:
            msg = 'self_access_change'
            raise LiwanAccessRule(msg)
        user = self._liwan_locked_target(user, expected_version, GRANT)
        if not user.active or user.share or user.id in self.env['liwan.entitlement.service']._liwan_excluded_user_ids():
            msg = 'seat_not_applicable'
            raise LiwanAccessRule(msg, 'this account does not hold a seat', status=409)
        before = {'read_only': user.liwan_read_only, 'priority': user.liwan_seat_priority}
        vals = {}
        if read_only is not None:
            vals.update({'liwan_read_only': read_only, 'liwan_seat_choice': 'customer'})
        if priority is not None:
            vals['liwan_seat_priority'] = priority
        user._liwan_access_write(vals, GRANT)
        self.env['liwan.access.audit']._liwan_log(
            'user.seat_changed', user, before=before,
            after={'read_only': user.liwan_read_only, 'priority': user.liwan_seat_priority},
        )
        self._liwan_bump_policy(user.company_id)
        return user
