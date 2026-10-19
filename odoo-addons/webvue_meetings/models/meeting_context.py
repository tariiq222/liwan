# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Context flags and ordering helper shared by the meeting minute modules."""
from contextvars import ContextVar
from datetime import date, datetime

from odoo import fields

_CALENDAR_IMPORT = ContextVar('webvue_calendar_import', default=False)
_CALENDAR_OUTBOUND = ContextVar('webvue_calendar_outbound', default=frozenset())
_SCOPE_SCHEDULE_WRITE = ContextVar('webvue_scope_schedule_write', default=False)
# Set by a series while it creates its occurrences: the series sends one invite per participant.
_SERIES_GENERATION = ContextVar('webvue_series_generation', default=False)
_SNAPSHOT_WRITE = ContextVar('webvue_meeting_snapshot_write', default=False)
_SNAPSHOT_FIELDS = frozenset({'minutes_snapshot', 'minutes_snapshot_data'})


def _occurrence_key(meeting):
    """Order key of a series occurrence: its day, its start, then its id."""
    meeting_date = fields.Date.to_date(meeting.meeting_date) if meeting.meeting_date else date.min
    start = fields.Datetime.to_datetime(meeting.start_datetime) if meeting.start_datetime else datetime.min
    return meeting_date, start, meeting.id
