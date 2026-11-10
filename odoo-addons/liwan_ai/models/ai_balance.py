# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The prepaid balance of the paid assistant (spec 2026-11-10 §5.1, §5.2, §5.4), enforced by the tenant database.

All amounts are cost units (0.00001 USD). The ledger is ``liwan.ai.usage``: the rows with ``billing='platform'`` and a reported
charge. Each such row splits its charge into the part the free allowance of its window covered and ``charge_paid``, the part taken
from the balance. Balance left is the cumulative ``ai.balance.granted`` minus the running total of every ``charge_paid`` ever
recorded (``liwan.tenant.profile.ai_paid_total``, kept in step by ``_liwan_ai_record``); the rows cannot be deleted with their user
or company. A customer-hosted installation (``non_saas``) or a tenant whose granted total is null has no balance and is never blocked.
"""
from odoo import api, fields, models

from odoo.addons.liwan_ai.models.access_service import AI_SETTINGS_MANAGE
from odoo.addons.liwan_api.serializers.common import iso
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule
from odoo.addons.liwan_platform.models.usage_window import (
    month_window,
    tenant_timezone,
    trial_window,
)

BALANCE_GRANTED = 'ai.balance.granted'
ALLOWANCE_TRIAL = 'ai.allowance.trial'
ALLOWANCE_MONTHLY = 'ai.allowance.monthly'
BALANCE_EMPTY = 'ai_balance_empty'
SPEND_CEILING = 'ai_spend_ceiling'


class LiwanAiBalance(models.AbstractModel):
    _name = 'liwan.ai.balance'
    _description = 'LiwanOS AI prepaid balance'
    _liwan_scope = 'global'

    @api.model
    def _liwan_ai_granted(self):
        """The cumulative top-ups of the tenant, or ``None`` when it has no balance (never blocked).

        A ``non_saas`` installation has none whatever its policy holds: the operator pays its own provider. In ``saas`` a missing
        or zero total means nothing was bought.
        """
        entitlement = self.env['liwan.entitlement.service']
        if entitlement._liwan_profile().commercial_mode == 'non_saas':
            return None
        return entitlement._liwan_limit_value(BALANCE_GRANTED)

    @api.model
    def _liwan_ai_window(self, at):
        """``(allowance key, start, reset)`` of the free-allowance window that contains ``at`` (naive UTC).

        Inside the trial period it is the 5-day trial window, otherwise the calendar month in the root company's timezone. A month
        that the trial ended in starts at the trial's end: what the trial allowance covered earlier in it is not the monthly
        allowance's.
        """
        profile = self.env['liwan.entitlement.service']._liwan_profile()
        trial = trial_window(at, profile.ai_trial_start, profile.ai_trial_end)
        if trial:
            return ALLOWANCE_TRIAL, *trial
        start, reset = month_window(at, tenant_timezone(self.env))
        if profile.ai_trial_end and profile.ai_trial_end <= at:
            start = max(start, profile.ai_trial_end)
        return ALLOWANCE_MONTHLY, start, reset

    @api.model
    def _liwan_ai_allowance(self, at):
        """``(allowance, left, reset)`` of the window containing ``at``: the vendor's allowance for it, what its rows left of it,
        and when the next window begins. A missing allowance is 0."""
        key, start, reset = self._liwan_ai_window(at)
        allowance = self.env['liwan.entitlement.service']._liwan_limit_value(key) or 0
        self.env.cr.execute(
            "SELECT COALESCE(SUM(charge - charge_paid), 0) FROM liwan_ai_usage"
            " WHERE billing = 'platform' AND charge_reported AND called_at >= %s AND called_at < %s",
            [start, reset],
        )
        return allowance, max(allowance - self.env.cr.fetchone()[0], 0), reset

    @api.model
    def _liwan_ai_paid_total(self):
        """Every charge ever taken from the balance: the running total, never a sum over the ledger."""
        return self.env['liwan.entitlement.service']._liwan_profile().ai_paid_total

    @api.model
    def _liwan_ai_paid_between(self, start, reset):
        """Sum of ``charge_paid`` of the rows called in ``[start, reset)`` (the ``called_at`` index bounds the scan)."""
        self.env.cr.execute(
            'SELECT COALESCE(SUM(charge_paid), 0) FROM liwan_ai_usage WHERE called_at >= %s AND called_at < %s', [start, reset],
        )
        return self.env.cr.fetchone()[0]

    @api.model
    def _liwan_ai_charge_paid(self, row):
        """The part of the charge of ``row`` (create values) that the free allowance of its window does not cover.

        0 for a call that is not charged to the platform balance, and for a tenant without a balance. The window is the one
        the call happened in, so a row reported late is settled against the allowance it used. The caller holds the recorder
        lock and has written the tenant's quota fence (``ai_usage._liwan_ai_record``), so no parallel batch spends the same
        allowance and the rows of one batch see each other.
        """
        charge = row['charge']
        if row['billing'] != 'platform' or not row['charge_reported'] or not charge or self._liwan_ai_granted() is None:
            return 0
        _allowance, free_left, _reset = self._liwan_ai_allowance(row['called_at'])
        return charge - min(charge, free_left)

    @api.model
    def _liwan_ai_balance_state(self):
        """The balance and the free allowance of the current window, in cost units.

        ``None`` marks "unlimited": a tenant without a balance has none of these. The balance left is never negative (a run in
        progress may overdraw it; the next top-up covers that). ``allowance_resets_at`` is the next window's start (naive UTC), and
        only when there is an allowance. Reads no setting, so the usage recorder can call it.
        """
        granted = self._liwan_ai_granted()
        state = {'balance_granted': granted, 'balance_left': None, 'allowance': None, 'allowance_left': None, 'allowance_resets_at': None}
        if granted is not None:
            allowance, left, reset = self._liwan_ai_allowance(fields.Datetime.now())
            state.update(
                balance_left=max(granted - self._liwan_ai_paid_total(), 0), allowance=allowance, allowance_left=left,
                allowance_resets_at=reset if allowance else None,
            )
        return state

    @api.model
    def _liwan_ai_state(self):
        """What the run policy and the pre-run check read: the balance state, the monthly spend ceiling (``None`` for none) and
        this month's deductions with the instant the month ends (``spend_resets_at``)."""
        month_start, month_reset = month_window(fields.Datetime.now(), tenant_timezone(self.env))
        return {
            **self._liwan_ai_balance_state(),
            'spend_ceiling': self.env['liwan.ai.settings']._liwan_current().monthly_spend_ceiling or None,
            'spend_this_month': self._liwan_ai_paid_between(month_start, month_reset),
            'spend_resets_at': month_reset,
        }

    @api.model
    def _liwan_ai_blocked(self, state):
        """``(code, resets_at)`` of the refusal a new run of the paid assistant meets now, or ``(None, None)`` when it may start.

        The order is the rule: the free allowance and the balance come first, and the tenant's ceiling second and only for paid
        spend. A run that the free allowance can still pay for takes nothing from the balance, so neither an empty balance nor a
        reached ceiling stops it; once the allowance is used up the run is paid, so an empty balance refuses it first and a reached
        ceiling refuses it otherwise. A tenant without a balance is never blocked. ``resets_at`` (naive UTC) is when the free
        allowance renews, or the month's end for the ceiling.
        """
        if state['balance_granted'] is None or state['allowance_left'] > 0:
            return None, None
        if state['balance_left'] <= 0:
            return BALANCE_EMPTY, state['allowance_resets_at']
        if state['spend_ceiling'] and state['spend_this_month'] >= state['spend_ceiling']:
            return SPEND_CEILING, state['spend_resets_at']
        return None, None

    @api.model
    def _liwan_ai_policy_fields(self):
        """The part of the run policy about the balance, reset times as ISO strings.

        The figures (granted total, balance, allowance, ceiling, spend) go only to a holder of ``ai.settings.manage``; every other
        user gets ``None`` for them and just what is needed to refuse and explain: ``blocked`` (the refusal code or ``None``),
        its ``blocked_resets_at`` and ``allowance_resets_at``.
        """
        state = self._liwan_ai_state()
        blocked, blocked_resets_at = self._liwan_ai_blocked(state)
        figures = ('balance_granted', 'balance_left', 'allowance', 'allowance_left', 'spend_ceiling', 'spend_this_month')
        manager = self.env['liwan.access.service']._liwan_has_capability(self.env.user, AI_SETTINGS_MANAGE)
        return {
            **{key: state[key] if manager else None for key in figures},
            'allowance_resets_at': iso(state['allowance_resets_at']),
            'blocked': blocked,
            'blocked_resets_at': iso(blocked_resets_at),
        }

    @api.model
    def _liwan_ai_require_runnable(self):
        """Refuse a new run of the paid assistant by ``_liwan_ai_blocked`` (a run already in progress is never stopped, so it
        may overdraw). The refusal's ``details.resets_at`` is an ISO instant or ``None``; the Nuxt pre-check answers alike."""
        code, resets_at = self._liwan_ai_blocked(self._liwan_ai_state())
        if code:
            message = 'the monthly spend ceiling of the assistant is reached' if code == SPEND_CEILING else 'the assistant balance is used up'
            raise LiwanAccessRule(code, message, status=403, details={'resets_at': iso(resets_at)})
