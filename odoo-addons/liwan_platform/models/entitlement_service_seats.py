# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Seats and branches above the purchased limit: who holds a full seat, and the settle that keeps it true.

``users.limit`` counts full seats (active internal accounts that are not read-only); ``branches.extra_limit``
counts active branches that are not read-only. Anything above a limit is read-only, never deleted or
disabled, until the customer buys it, frees a seat or picks who stays full.
"""
from odoo import api, models

from .read_only_guard import SETTLE_MARKER
from .res_users import GRANT
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule

USER_LIMIT = 'users.limit'
BRANCH_LIMIT = 'branches.extra_limit'
UNSET_PRIORITY = float('inf')
DEFER_BRANCH_REOPENING = 'liwan_platform.defer_branch_reopening'


class LiwanEntitlementSeats(models.AbstractModel):
    _inherit = 'liwan.entitlement.service'

    @api.model
    def _liwan_seat_candidates(self):
        """``(users, pending)``: the accounts that can hold a seat, and the invitees among them who have not accepted yet.

        Active internal accounts, not the superuser, vendor support or a service account
        (``_liwan_excluded_user_ids``). A pending invitee claims a full seat only when the invitation is accepted.
        """
        # Read for the tenant, not as the caller: the public acceptance route and a branch administrator hold
        # no `res.users` read, and the answer is only ids the seat arithmetic needs. Active accounts only, whatever
        # `active_test` the caller's context carries (an access operation browses its target with it off).
        users = self.env['res.users'].sudo().with_context(active_test=True).search([
            ('share', '=', False), ('id', 'not in', list(self._liwan_excluded_user_ids())),
        ])
        pending = users.browse(list(self.env['liwan.access.service']._liwan_awaiting_users(users)))
        return users - pending, pending

    @api.model
    def _liwan_seat_users(self):
        """The accounts that can hold a seat, read-only ones included, pending invitees excluded."""
        return self._liwan_seat_candidates()[0]

    @api.model
    def _liwan_count_held_seats(self):
        """Full seats plus pending invitations: what a new invitation has to fit under ``users.limit``.

        Read-only accounts above the limit only ever come from a limit decrease, never from inviting past it.
        """
        users, pending = self._liwan_seat_candidates()
        return len(users.filtered(lambda user: not user.liwan_read_only)) + len(pending)

    @api.model
    def _liwan_full_seat_ids(self):
        return self._liwan_seat_users().filtered(lambda user: not user.liwan_read_only).ids

    @api.model
    def _liwan_read_only_allowances(self):
        """What a read-only identity or branch may still write, registered by the owning addons through super().

        ``plumbing``: models whose writes are the system's own bookkeeping, never fenced.
        ``own``: models whose rows carry a ``user_id``; the acting user's own rows (a view log, personal stages)
        stay writable.
        ``seed``: context key -> token an addon sets while it seeds defaults on the first read of a page.
        """
        return {'plumbing': frozenset(), 'own': frozenset(), 'seed': {}}

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
    def _liwan_grant_holders(self, users, company):
        access = users.env['liwan.access.service'].with_company(company)
        return users.filtered(lambda user: access._liwan_has_capability(user, GRANT, company=company))

    @api.model
    def _liwan_user_keep_order(self, users):
        """Full users in keep order, with headquarters recovery preferred when a holder must be preserved."""
        root = self._liwan_profile().root_company_id
        root_holders = self._liwan_grant_holders(users, root)
        holders = root_holders | users.filtered(lambda user: self._liwan_grant_holders(user, user.company_id))
        holder_ids = set(holders.ids)
        ordered = sorted(users, key=lambda user: (
            user.liwan_seat_choice != 'customer', user.id not in holder_ids, user.create_date, user.id,
        ))
        return ordered, set((root_holders or holders).ids)

    @api.model
    def _liwan_settle_users(self):
        users, pending = self._liwan_seat_candidates()
        users.invalidate_recordset(['liwan_read_only', 'liwan_seat_choice', 'liwan_seat_priority'])
        capacity = self._liwan_capacity(USER_LIMIT, len(users) + len(pending))
        if capacity is None:
            return False
        full = users.filtered(lambda user: not user.liwan_read_only)
        if len(full) > capacity:
            ordered, holders = self._liwan_user_keep_order(full)
            kept = ordered[:capacity]
            held = [user for user in ordered if user.id in holders]
            if held and not any(user.id in holders for user in kept):
                # The last full access administrator stays full even under a limit of zero: nobody else could buy or pick seats.
                kept = [*kept[:max(capacity - 1, 0)], held[0]]
            demote = full.filtered(lambda user: user not in kept)
            self._liwan_apply_flags(demote, {'liwan_read_only': True, 'liwan_seat_choice': 'auto'})
            return bool(demote)
        reopenable = sorted(
            (user for user in users - full if user.liwan_seat_choice == 'auto'),
            key=lambda user: (user.liwan_seat_priority or UNSET_PRIORITY, user.create_date, user.id),
        )[:max(0, capacity - len(full) - len(pending))]
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
            return bool(demote)
        if DEFER_BRANCH_REOPENING in self.env.cr.cache:
            return False
        reopenable = sorted(
            (branch for branch in branches - full if branch.seat_choice == 'auto'),
            key=lambda branch: (branch.restore_priority or UNSET_PRIORITY, branch.create_date, branch.id),
        )[:capacity - len(full)]
        self._liwan_apply_flags(branches.browse([branch.id for branch in reopenable]), {'read_only': False})
        return bool(reopenable)

    @api.model
    def _liwan_assert_branch_admin(self):
        """Branch seats belong to the company administration of the root company, never to a branch's own administrator."""
        root = self._liwan_profile().root_company_id
        if self.env.company != root or not self.env['liwan.access.service']._liwan_has_capability(
            self.env.user, 'settings.company.manage', company=root,
        ):
            code = 'forbidden'
            raise LiwanAccessRule(code, 'branch seats require company administration of the root company', status=403)

    @api.model
    def _liwan_set_branch_seat(self, company_id, read_only=None, priority=None):
        """Make a branch full or read-only, or set its reopening priority; the headquarters company is never a branch."""
        self._liwan_assert_branch_admin()
        profile = self._liwan_profile()
        profile._liwan_lock()
        branch = self._liwan_branches().filtered(lambda item: item.company_id.id == company_id)
        if not branch:
            code = 'not_found'
            raise LiwanAccessRule(code, 'branch does not exist', status=404)
        vals = {}
        if read_only is not None:
            if not read_only and branch.read_only:
                self.require_within_limit(BRANCH_LIMIT, self._liwan_count_full_branches() + 1)
            vals.update({'read_only': read_only, 'seat_choice': 'customer'})
        if priority is not None:
            vals['restore_priority'] = priority
        self._liwan_apply_flags(branch, vals)
        return branch
