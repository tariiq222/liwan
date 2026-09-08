# Meeting series — design

**Worktree:** `/Users/tariq/code/nasq-meetings-series` (`codex/meetings-series` from `main` `51e4362`). No commit/merge.

## Scope order

1. Data + scheduling (this slice)
2. Meeting cycle + resolutions
3. Pages
4. Notifications + PDF/templates
5. Full acceptance with the user

Keep independent meetings. Series is optional. Extend `nasq_pmo` / `nasq_core` grants; do not rewrite Cyan.

## Data

`nasq.meeting.series`: name, company, optional project, default organizer/secretary/attendees, recurrence `none|weekly|biweekly|monthly`, `until_date` xor `until_count` when recurring.

`cyan.meeting.minute` gains optional `series_id` and `project_id`. Minutes, attendance and resolutions stay per occurrence.

ACL: `meetings.read/create/manage`. Series list may be visible if the user participates in the series **or** can see at least one occurrence. Occurrence dumps never include meetings the user cannot read.

## Scheduling

Recurring series creates Odoo `calendar.event` recurrences, then one meeting per event. On-demand series starts empty; later POSTs add occurrences.

Patch/cancel accept `scope=this|this_and_following`. Past minutes/resolutions are not rewritten. Times use existing UTC `iso()` helpers; end must be after start; organizer overlap is rejected.

`GET /api/v1/meetings` filters: `q`, `state`, `date_from`, `date_to`, `organizer_id`, `project_id`, `series_id`, `mine=1`. A month range may return up to 2000 rows.

## Frozen list item

`id, name, reference, meeting_date, start_datetime, end_datetime, state, organizer, open_resolution_count, series_id, project_id`
