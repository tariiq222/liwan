# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The usage windows a tenant's allowances renew in: the calendar month and the 5-day trial window.

Pure functions over naive UTC datetimes, the form the ORM stores. A window is ``(start, reset)``: ``start`` is its first
instant and ``reset`` the instant the next window begins (or the trial ends), both naive UTC. The month follows the
timezone of the tenant's root company, so a month changes at local midnight; a trial window is a run of exactly
``TRIAL_WINDOW_DAYS`` days counted from the trial start, so it needs no timezone.
"""
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

DEFAULT_TIMEZONE = 'Asia/Riyadh'
TRIAL_WINDOW_DAYS = 5
TRIAL_WINDOW = timedelta(days=TRIAL_WINDOW_DAYS)


def _utc_naive(local):
    return local.astimezone(timezone.utc).replace(tzinfo=None)


def month_window(now, zone):
    """``(start, reset)`` of the calendar month in ``zone`` that contains ``now`` (naive UTC)."""
    tz = ZoneInfo(zone)
    local = now.replace(tzinfo=timezone.utc).astimezone(tz)
    start = datetime(local.year, local.month, 1, tzinfo=tz)
    following = datetime(local.year + local.month // 12, local.month % 12 + 1, 1, tzinfo=tz)
    return _utc_naive(start), _utc_naive(following)


def month_label(now, zone):
    """``YYYY-MM`` of the calendar month in ``zone`` that contains ``now`` (naive UTC)."""
    return now.replace(tzinfo=timezone.utc).astimezone(ZoneInfo(zone)).strftime('%Y-%m')


def trial_window(now, trial_start, trial_end):
    """``(start, reset)`` of the 5-day trial window that contains ``now``, or ``None`` outside the trial.

    Windows are ``[start + 5k days, start + 5(k+1) days)``; the last one is cut at ``trial_end``. No trial (a null
    start or end) and a ``now`` before the start or from the end on are all ``None``.
    """
    if not trial_start or not trial_end or not trial_start <= now < trial_end:
        return None
    start = trial_start + ((now - trial_start) // TRIAL_WINDOW) * TRIAL_WINDOW
    return start, min(start + TRIAL_WINDOW, trial_end)


def tenant_timezone(env):
    """The IANA timezone of the tenant's root company, ``Asia/Riyadh`` when it has none or an unknown one."""
    zone = env['liwan.entitlement.service']._liwan_profile().root_company_id.partner_id.tz
    try:
        ZoneInfo(zone or DEFAULT_TIMEZONE)
    except (ValueError, ZoneInfoNotFoundError):
        return DEFAULT_TIMEZONE
    return zone or DEFAULT_TIMEZONE
