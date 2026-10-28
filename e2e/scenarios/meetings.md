# Meetings

Pages: `/meetings`, `/meetings/new`, `/meetings/calendar`, `/meetings/follow-up`,
`/meetings/series`, `/meetings/[id]` (`edit`, `minutes`, `print`, `resolutions`).
Owners: `webvue_meetings`, `webvue_meetings_pmo`. Personas and status values: [README](README.md).

Capability note: employees hold `meetings.read` only; `meetings.create` and
`meetings.manage` come with `system_admin`. No business persona (`ceo`, `pm`) can create a
meeting today (`MTG-20`).

| ID | Scenario | Persona | Expected | Status | Test / notes |
| --- | --- | --- | --- | --- | --- |
| MTG-01 | Schedule a meeting with an attendee and add a recommendation; find it in the list and calendar | admin | Saved and listed | automated | `e2e/tests/meetings-journey.e2e.ts` |
| MTG-02 | Employee creates a meeting | staff1 | Refused (read-only by default) | planned | |
| MTG-03 | Confirm, complete, cancel, reopen | it_admin | Each transition; done/cancelled immutable | planned | |
| MTG-04 | Attendee invitation, change and cancellation notices | it_admin → staff1 | Bell `meeting_invite`, `meeting_changed`, `meeting_cancelled` | planned | |
| MTG-05 | Reminder 24 hours ahead | staff1 | Bell `meeting_reminder` | planned | |
| MTG-06 | Delete a meeting that is done or has minutes versions | it_admin | Refused | planned | |
| MTG-07 | Minutes, versions and PDF print | it_admin | Versions listed; PDF downloads | planned | |
| MTG-08 | Series weekly / biweekly / monthly with until date or count | it_admin | Occurrences generated as configured | planned | |
| MTG-09 | End a series with upcoming meetings as a non-manager editor | organizer | Refused | planned | |
| MTG-10 | Resolution with a responsible participant and deadline | it_admin | Bell `meeting_resolution` to the responsible | planned | |
| MTG-11 | Responsible updates progress; tries to cancel | staff1 | Progress saved; cancel refused | planned | |
| MTG-12 | Responsible person who is not a participant | it_admin | Refused | planned | |
| MTG-13 | Overdue resolution | staff1 | Bell `meeting_resolution_overdue` | planned | |
| MTG-14 | Convert a resolution to a project task; convert again | it_admin | Task created in the project; second conversion refused | planned | Also J-08 |
| MTG-20 | A business manager schedules meetings | ceo / pm | Owner decision: no meetings role exists outside `system_admin` | decision | Found 2026-10-28 |
