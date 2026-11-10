# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models

from .read_only_guard import SETTLE_MARKER
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule

GRANT = 'access.users.grant'
SEAT_KEYS = frozenset({'active', 'share', 'liwan_read_only'})
# A server-created invitation reserves room without counting as a full seat until acceptance.
INVITEE_CONTEXT = 'liwan_platform.invitee_create'
INVITEE_TOKEN = object()


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

    def _liwan_user_quota_delta(self, vals_list=None, records=None, write_vals=None):
        service = self.env['liwan.entitlement.service']
        delta = 0
        for vals in vals_list or ():
            if vals.get('active', True) and not vals.get('share', False):
                if self.env.context.get(INVITEE_CONTEXT) is INVITEE_TOKEN or not vals.get('liwan_read_only'):
                    delta += 1
        if records is not None and write_vals and SEAT_KEYS & set(write_vals):
            held_ids = set(service._liwan_full_seat_ids())
            awaiting = self.env['liwan.access.service']._liwan_awaiting_users(records)
            excluded = set(service._liwan_excluded_user_ids())
            for user in records:
                active = write_vals.get('active', user.active)
                share = write_vals.get('share', user.share)
                if user.id in awaiting:
                    if user.id not in excluded:
                        delta += int(bool(active and not share)) - int(bool(user.active and not user.share))
                    continue
                counted = (
                    active and not share and not write_vals.get('liwan_read_only', user.liwan_read_only)
                    and user.id not in excluded
                )
                delta += int(bool(counted)) - int(user.id in held_ids)
        if delta and not self.env.cr.precommit.data.get(SETTLE_MARKER):
            service._liwan_claim_users(delta)

    def _liwan_assert_grant_holder_survives(self):
        """Protect each company in which a departing account is the last full grant holder."""
        service = self.env['liwan.entitlement.service']
        full = service._liwan_seat_users().filtered(lambda user: not user.liwan_read_only)
        leaving = full & self
        remaining = full - leaving
        for company in leaving.company_ids.filtered('active'):
            if service._liwan_grant_holders(leaving, company) and not service._liwan_grant_holders(remaining, company):
                msg = 'last_access_admin'
                raise LiwanAccessRule(msg, 'at least one full access administrator is required', status=409)

    def _liwan_check_seat_change(self, vals):
        if not SEAT_KEYS.intersection(vals) or self.env.cr.precommit.data.get(SETTLE_MARKER):
            return
        if vals.get('liwan_read_only') or vals.get('share') or vals.get('active') is False:
            self._liwan_assert_grant_holder_survives()
        self._liwan_user_quota_delta(records=self, write_vals=vals)

    @api.model_create_multi
    def create(self, vals_list):
        self._liwan_user_quota_delta(vals_list=vals_list)
        return super().create(vals_list)

    def write(self, vals):
        self._liwan_check_seat_change(vals)
        result = super().write(vals)
        self._liwan_settle_after_activation_change(vals)
        return result

    def _liwan_settle_after_activation_change(self, vals):
        """A disabled account frees its seat and a reactivated one may need none: settle once the flag is written."""
        if 'active' in vals and not self.env.cr.precommit.data.get(SETTLE_MARKER):
            self.env['liwan.entitlement.service']._liwan_settle_users()

    def _liwan_access_create(self, vals, capability='access.users.grant'):
        self._liwan_user_quota_delta(vals_list=[vals])
        return super()._liwan_access_create(vals, capability=capability)

    def _liwan_access_write(self, vals, capability):
        self._liwan_check_seat_change(vals)
        result = super()._liwan_access_write(vals, capability=capability)
        self._liwan_settle_after_activation_change(vals)
        return result

    def _login(self, credential, user_agent_env):
        auth_info = super()._login(credential, user_agent_env)
        user = self.browse(auth_info['uid'])
        self.env['liwan.entitlement.service']._liwan_assert_login_allowed(user)
        return auth_info
