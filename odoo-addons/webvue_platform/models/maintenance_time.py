# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""IANA wall-clock validation shared by preference and one-off scheduling."""
import re
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


def timezone_info(name):
    try:
        return ZoneInfo(name)
    except (TypeError, ValueError, ZoneInfoNotFoundError) as exc:
        msg = 'invalid_timezone'
        raise ValueError(msg) from exc


def local_to_utc(value, zone):
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}', value):
        msg = 'invalid_local_time'
        raise ValueError(msg)
    try:
        wall = datetime.fromisoformat(value)
    except ValueError as exc:
        msg = 'invalid_local_time'
        raise ValueError(msg) from exc
    tz = timezone_info(zone)
    candidates = {
        candidate.astimezone(timezone.utc).replace(tzinfo=None)
        for fold in (0, 1)
        if (candidate := wall.replace(tzinfo=tz, fold=fold)).astimezone(timezone.utc).astimezone(tz).replace(tzinfo=None) == wall
    }
    if len(candidates) != 1:
        msg = 'invalid_dst_time'
        raise ValueError(msg)
    return candidates.pop()


def validate_window(scheduled_at, duration_minutes, estimated_seconds, deadline_at, now):
    if type(duration_minutes) is not int or not 1 <= duration_minutes <= 1440:
        msg = 'invalid_duration'
        raise ValueError(msg)
    if scheduled_at <= now:
        msg = 'past_window'
        raise ValueError(msg)
    if duration_minutes * 60 < estimated_seconds:
        msg = 'insufficient_window'
        raise ValueError(msg)
    if scheduled_at + timedelta(minutes=duration_minutes) > deadline_at:
        msg = 'deadline_exceeded'
        raise ValueError(msg)


def next_window(now, zone, weekday, start_minute, duration_minutes, deadline_at):
    tz = timezone_info(zone)
    day = now.replace(tzinfo=timezone.utc).astimezone(tz).date()
    day += timedelta(days=(weekday - day.weekday()) % 7)
    wall = datetime.combine(day, datetime.min.time()) + timedelta(minutes=start_minute)
    result = local_to_utc(wall.isoformat(timespec='minutes'), zone)
    if result <= now:
        result = local_to_utc((wall + timedelta(days=7)).isoformat(timespec='minutes'), zone)
    validate_window(result, duration_minutes, 0, deadline_at, now)
    return result
