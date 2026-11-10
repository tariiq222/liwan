# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Seats and branches above the purchased limit: who holds a full seat, and the settle that keeps it true.

``users.limit`` counts full seats (active internal accounts that are not read-only); ``branches.extra_limit``
counts active branches that are not read-only. Anything above a limit is read-only, never deleted or
disabled, until the customer buys it, frees a seat or picks who stays full.
"""
from odoo import api, models

from .read_only_guard import SETTLE_MARKER
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule

USER_LIMIT = 'users.limit'
BRANCH_LIMIT = 'branches.extra_limit'
GRANT = 'access.users.grant'
UNSET_PRIORITY = float('inf')


class LiwanEntitlementSeats(models.AbstractModel):
    _inherit = 'liwan.entitlement.service'

    @api.model
    def _liwan_seat_users(self):
        """The accounts that can hold a seat, read-only ones included.

        Active internal accounts, not the superuser, vendor support or a service account
        (``_liwan_excluded_user_ids``), and not an invitee who has not accepted yet: that one claims a seat
        when the invitation is accepted.
        """
        # Read for the tenant, not as the caller: the public acceptance route and a branch administrator hold
        # no `res.users` read, and the answer is only ids the seat arithmetic needs.
        users = self.env['res.users'].sudo().search([
            ('share', '=', False), ('id', 'not in', list(self._liwan_excluded_user_ids())),
        ])
        return users - users.browse(list(self.env['liwan.access.service']._liwan_awaiting_users(users)))

    @api.model
    def _liwan_full_seat_ids(self):
        return self._liwan_seat_users().filtered(lambda user: not user.liwan_read_only).ids

    @api.model
    def _liwan_branches(self):
        """The active branches of the tenant, whatever companies the caller can see.

        Branch seats are a tenant-wide count: a branch administrator or an HQ administrator who holds only
        some of the companies must still read the whole set.
        """
        return self.env['liwan.tenant.branch'].sudo().search([('state', '=', 'active')], order='create_date, id')

    @api.model
    def _liwan_count_full_branches(self):
        return len(self._liwan_branches().filtered(lambda branch: not branch.read_only))

    @api.model
    def _liwan_excess_counts(self):
        """Read-only seats and branches per limit key, for the usage the control plane and the team page read."""
        return {
            USER_LIMIT: len(self._liwan_seat_users().filtered('liwan_read_only')),
            BRANCH_LIMIT: len(self._liwan_branches().filtered('read_only')),
        }

    @api.model
    def _liwan_capacity(self, key, total):
        limit = self._liwan_limit_value(key)
        if limit is None:
            return total
        return limit if isinstance(limit, int) and not isinstance(limit, bool) and limit >= 0 else None

    @api.model
    def _liwan_settle_excess(self):
        """Make full seats and full branches fit the limits. Idempotent, deterministic, never destructive.

        Above a limit the lowest-ranked full items turn read-only; room under it reopens read-only items in
        order. A choice the customer made is never overwritten by a restore, and nothing is reshuffled while the
        counts already fit. Returns True when it changed a flag.
        """
        changed = self._liwan_settle_users()
        return self._liwan_settle_branches() or changed

    @api.model
    def _liwan_apply_flags(self, records, vals):
        """Write seat flags under the settle marker (the identity guard and the seat claim skip exactly this), then bump the quota revision."""
        if not records:
            return
        data = self.env.cr.precommit.data
        previous = data.get(SETTLE_MARKER)
        data[SETTLE_MARKER] = True
        try:
            # The flags are written for the tenant by the settle, not by the acting user: an access administrator
            # holds no write ACL on `liwan.tenant.branch` and `res.users` refuses a write outside the protected
            # account operations.
            records.sudo().write(vals)
        finally:
            if previous is None:
                data.pop(SETTLE_MARKER, None)
            else:
                data[SETTLE_MARKER] = previous
        self._liwan_profile()._liwan_bump_quota_revision()

    @api.model
    def _liwan_user_keep_order(self, users):
        """Full users by the order they stay full: the customer's picks, grant holders, then oldest first."""
        service = self.env['liwan.access.service']
        holders = {
            user.id for user in users
            if service._liwan_has_capability(user, GRANT, company=user.company_id)
        }
        ordered = sorted(users, key=lambda user: (
            user.liwan_seat_choice != 'customer', user.id not in holders, user.create_date, user.id,
        ))
        return ordered, holders

    @api.model
    def _liwan_settle_users(self):
        users = self._liwan_seat_users()
        users.invalidate_recordset(['liwan_read_only', 'liwan_seat_choice', 'liwan_seat_priority'])
        capacity = self._liwan_capacity(USER_LIMIT, len(users))
        if capacity is None:
            return False
        full = users.filtered(lambda user: not user.liwan_read_only)
        if len(full) > capacity:
            ordered, holders = self._liwan_user_keep_order(full)
            kept = ordered[:capacity]
            held = [user for user in ordered if user.id in holders]
            if capacity and held and not any(user.id in holders for user in kept):
                kept = [*kept[:-1], held[0]]
            demote = full.filtered(lambda user: user not in kept)
            self._liwan_apply_flags(demote, {'liwan_read_only': True, 'liwan_seat_choice': 'auto'})
            return True
        free = capacity - len(full)
        reopenable = sorted(
            (user for user in users - full if user.liwan_seat_choice == 'auto'),
            key=lambda user: (user.liwan_seat_priority or UNSET_PRIORITY, user.create_date, user.id),
        )[:free]
        self._liwan_apply_flags(self.env['res.users'].browse([user.id for user in reopenable]), {'liwan_read_only': False})
        return bool(reopenable)

    @api.model
    def _liwan_settle_branches(self):
        branches = self._liwan_branches()
        branches.invalidate_recordset(['read_only', 'seat_choice', 'restore_priority'])
        capacity = self._liwan_capacity(BRANCH_LIMIT, len(branches))
        if capacity is None:
            return False
        full = branches.filtered(lambda branch: not branch.read_only)
        if len(full) > capacity:
            ordered = sorted(full, key=lambda branch: (branch.seat_choice != 'customer', branch.create_date, branch.id))
            demote = full.filtered(lambda branch: branch not in ordered[:capacity])
            self._liwan_apply_flags(demote, {'read_only': True, 'seat_choice': 'auto'})
            return True
        reopenable = sorted(
            (branch for branch in branches - full if branch.seat_choice == 'auto'),
            key=lambda branch: (branch.restore_priority or UNSET_PRIORITY, branch.create_date, branch.id),
        )[:capacity - len(full)]
        self._liwan_apply_flags(branches.browse([branch.id for branch in reopenable]), {'read_only': False})
        return bool(reopenable)

    @api.model
    def _liwan_set_branch_seat(self, company_id, read_only=None, priority=None):
        """Make a branch full or read-only, or set its reopening priority; the headquarters company is never a branch."""
        profile = self._liwan_profile()
        root = profile.root_company_id
        if self.env.company != root or not self.env['liwan.access.service']._liwan_has_capability(
            self.env.user, 'settings.company.manage', company=root,
        ):
            code = 'forbidden'
            raise LiwanAccessRule(code, 'branch seats require company administration of the root company', status=403)
        branch = self._liwan_branches().filtered(lambda item: item.company_id.id == company_id)
        if not branch:
            code = 'not_found'
            raise LiwanAccessRule(code, 'branch does not exist', status=404)
        profile._liwan_lock()
        vals = {}
        if read_only is not None:
            if not read_only and branch.read_only:
                self.require_within_limit(BRANCH_LIMIT, self._liwan_count_full_branches() + 1)
            vals.update({'read_only': read_only, 'seat_choice': 'customer'})
        if priority is not None:
            vals['restore_priority'] = priority
        self._liwan_apply_flags(branch, vals)
        return branch
