# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models

from .read_only_guard import SETTLE_MARKER
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule

SEAT_KEYS = frozenset({'active', 'share', 'liwan_read_only'})
# Set while the access service creates an invitee: the seat is claimed when the invitation is accepted.
INVITEE_CONTEXT = 'liwan_platform.invitee_create'


class LiwanPlatformResUsers(models.Model):
    _inherit = 'res.users'

    # Above `users.limit` an account stays active and readable but takes no writes (`read_only_guard`).
    # `liwan_seat_choice` records who decided (the settle, or the administrator who picked it) and
    # `liwan_seat_priority` is the administrator's order for reopening read-only accounts (0 = not set).
    liwan_read_only = fields.Boolean(default=False, copy=False)
    liwan_seat_choice = fields.Selection(
        [('auto', 'Automatic'), ('customer', 'Customer')], default='auto', required=True, copy=False,
    )
    liwan_seat_priority = fields.Integer(default=0, required=True, copy=False)

    _liwan_seat_priority_positive = models.Constraint(
        'CHECK(liwan_seat_priority >= 0)', 'liwan seat priority cannot be negative',
    )

    def _liwan_seat_holders(self):
        """The accounts of ``self`` that count as a full seat right now."""
        service = self.env['liwan.entitlement.service']
        held = set(service._liwan_full_seat_ids())
        return self.filtered(lambda user: user.id in held)

    def _liwan_user_quota_delta(self, vals_list=None, records=None, write_vals=None):
        service = self.env['liwan.entitlement.service']
        delta = 0
        if vals_list and not self.env.context.get(INVITEE_CONTEXT):
            for vals in vals_list:
                if vals.get('active', True) and not vals.get('share', False) and not vals.get('liwan_read_only'):
                    delta += 1
        if records is not None and write_vals and SEAT_KEYS & set(write_vals):
            held_ids = set(service._liwan_full_seat_ids())
            awaiting = self.env['liwan.access.service']._liwan_awaiting_users(records)
            excluded = set(service._liwan_excluded_user_ids())
            for user in records:
                counted = (
                    write_vals.get('active', user.active)
                    and not write_vals.get('share', user.share)
                    and not write_vals.get('liwan_read_only', user.liwan_read_only)
                    and user.id not in excluded
                    # An invitee who has not accepted claims their seat at acceptance, not here.
                    and user.id not in awaiting
                )
                delta += int(bool(counted)) - int(user.id in held_ids)
        if delta and not self.env.cr.precommit.data.get(SETTLE_MARKER):
            service._liwan_claim_users(delta)
        return delta

    def _liwan_assert_grant_holder_survives(self):
        """Refuse to turn the last full holder of ``access.users.grant`` read-only or off."""
        access = self.env['liwan.access.service']
        for company in self.company_id:
            leaving = self.filtered(lambda user, company=company: user.company_id == company)
            remaining = self.browse(self.env['liwan.entitlement.service']._liwan_full_seat_ids()) - leaving
            if not any(
                user.company_id == company and access._liwan_has_capability(user, 'access.users.grant', company=company)
                for user in remaining
            ):
                msg = 'last_access_admin'
                raise LiwanAccessRule(msg, 'at least one full access administrator is required', status=409)

    @api.model_create_multi
    def create(self, vals_list):
        self._liwan_user_quota_delta(vals_list=vals_list)
        return super().create(vals_list)

    def write(self, vals):
        if 'liwan_read_only' in vals and vals['liwan_read_only'] and not self.env.cr.precommit.data.get(SETTLE_MARKER):
            self._liwan_seat_holders()._liwan_assert_grant_holder_survives()
        self._liwan_user_quota_delta(records=self, write_vals=vals)
        return super().write(vals)

    def _liwan_access_create(self, vals, capability='access.users.grant'):
        self._liwan_user_quota_delta(vals_list=[vals])
        return super()._liwan_access_create(vals, capability=capability)

    def _liwan_access_write(self, vals, capability):
        self._liwan_user_quota_delta(records=self, write_vals=vals)
        return super()._liwan_access_write(vals, capability=capability)

    def _login(self, credential, user_agent_env):
        auth_info = super()._login(credential, user_agent_env)
        user = self.browse(auth_info['uid'])
        self.env['liwan.entitlement.service']._liwan_assert_login_allowed(user)
        return auth_info
