# Independent meetings integration review

Verdict: CHANGES REQUIRED. No Critical findings; three Important findings and one Minor finding. Reviewed source at `07b8747f5265973f96b9717220ca158ca3e32f3c` in `/Users/tariq/code/nasq/.worktrees/reconcile-meetings-20260907`; worktree was clean. No tests, Git/source/runtime/database mutations or subagents. This designated report is the only written file.

## Important findings

### M1 — P1: company-scoped meetings.manage becomes global manager authority

Primary new integration location: `odoo-addons/nasq_core/security/nasq_access_groups.xml:30`. Supporting paths: `nasq_core/models/res_users.py:160-188`, `cyan_meeting_minutes/security/meeting_security.xml` manager-all rules, `cyan_meeting_minutes/models/meeting.py:78-89`, `nasq_pmo/controllers/meetings.py:20-32,89-128`, `nasq_pmo/models/meeting_resolution.py:22-25`.

Capability groups are synchronized from the union of permissions across every company available to the user. The new meetings.manage group implies Cyan's global manager group. Cyan's manager-all record rule and `_cyan_is_manager` then authorize all meetings in whichever company is current, independent of the capability assignment's company. Nasq list/detail/PATCH require only meetings.read; resolution conversion additionally accepts `_cyan_is_meeting_editor`, which also trusts that global group. A user assigned meetings.manage in company A and meetings.read in B can therefore switch to B and list/read/edit meetings they do not participate in, manipulate their attachments/resolutions, and potentially convert recommendations when they separately hold PMO task-create permission there. Current-company record rules limit rows to B, but do not restore the missing company-specific manager check.

Fix in the Nasq extension: apply current-company capability and participant/editor checks to the model search/read/write/manager paths rather than treating the support group as authority. Preserve standalone Cyan operation. Regress with two companies, a manager grant only in A, read-only meetings grant in B, and a B meeting owned by another user; exercise list/detail/PATCH/attachment and notification visibility. Also verify direct ORM create cannot bypass meetings.create merely via the read group, since Cyan user ACL currently includes create. The latter is an additional boundary to cover within the same model-guard repair.

### M2 — P1: calendar round-trip restores removed attendees

Primary location: `odoo-addons/nasq_pmo/models/meeting_minute.py:54-63,80-82`. Supporting path: `odoo-addons/cyan_meeting_minutes/models/calendar_event.py:67-75,110-123`.

Nasq automatically links scheduled meetings to Calendar. Its sync updates event name/times/location/URL, but neither updates event participant ids nor runs for attendee-only edits. Cyan's calendar write hook then copies the event's entire schedule, including its old `partner_ids` transformed into `attendee_ids`, back into the meeting. Remove an attendee from an existing scheduled meeting, then rename it or change its times/location: `_nasq_sync_calendar` writes the stale event; CalendarEvent.write restores the removed attendee on the meeting. A simultaneous name+attendees edit has the same issue. This restores that person's visibility of confidential meeting minutes and attachments, and can remove newly added participants. A removed participant who remains an event attendee may also retain event metadata visibility even before the next edit.

Make the synchronization direction explicit and reconcile participant/organizer state, without a client-forgeable authorization bypass. Do not let a metadata update overwrite membership. Add regression cases for removal then rename/reschedule, simultaneous membership+metadata edits, adding attendees, secretary preservation, and calendar-origin edits. Assert final meeting membership, followers/visibility and calendar membership, not only event name/start/stop. Existing reschedule coverage checks only event fields and does not catch this round-trip.

### M3 — P2: returning to page one leaves the previous offset in the URL

Location: `apps/web/app/pages/meetings/index.vue:40-43`.

`setPage(1)` sets the local offset to zero but spreads `route.query` and omits the override when the new offset is zero. An existing `offset=25` remains in the URL. The list may show page one locally while refresh and the meeting detail's returnTo restore page two. This violates the required refresh/back/filter route contract. Explicitly remove offset (or replace it with undefined) when returning to page one and cover page two -> previous -> detail -> back and refresh.

## Minor finding

### M4 — P2: conversion controls use meeting-edit authority and omit failure UI

Location: `apps/web/app/pages/meetings/[id].vue:22,67-71,135-141`.

The detail always requests projects and offers conversion whenever `can_edit` is true, including the new meetings-only system-admin role that has no PMO task-create authority. A meeting editor with project-read but no task-create can select a project and click a button that the backend correctly rejects. `convertResolution` awaits the mutation without catch and does not render its error, so capability failures and the newly added duplicate-conversion error yield no useful page feedback. Gate project lookup and conversion by the required PMO capability as well as meeting editability, and show an inline/localized mutation error. This is a usability/contract issue, not a demonstrated backend permission bypass.

## Spec and quality assessment

- Recipient ownership is in the domain before notification elevation. Meeting candidates are read under ordinary caller meeting ACLs with explicit current-company/active filters. List, total, unread count, read and read-all share that domain, and digest visibility remains checked. The M1 model visibility issue also affects which meetings that caller search considers readable; the notification repair itself adds no unrestricted meeting search.
- Notification kind discriminants, serializers and client meeting routes are coherent. Coordinator candidate `accessPolicy.ts` defines NOTIFICATION_ACCESS as task-read OR meeting-read and applies it to `/notifications`.
- Attachment API retains exact meeting/binary linkage, ordinary attachment ACLs, upload parsing, and `can_edit` locked-state checks. These checks depend on the model authority addressed in M1.
- Task origin ids remain opaque integers omitted from ordinary task serializer output. Generic task create/write whitelists reject them for ordinary writers. The conversion marker is server/cursor-local, and project visibility plus task-create are enforced by project.task.create. The partial unique index covers positive resolution ids including archived tasks. Duplicate handling is savepoint-protected and checks the named index; actual concurrent transaction behavior remains unverified here.
- system_admin role XML adds meeting permissions without adding HR/PMO write permissions. This does not by itself cure the group/company issue above.
- All six meeting route sources exist, and `[id].vue` contains the child `<NuxtPage>` branch. Form baselines reset after successful writes and preserve original agenda/minutes HTML. Existing route and shared unsaved-changes components are retained. Calendar navigation does not serialize selected month or returnTo, and its first-200-record limit remains a disclosed source limitation.
- Source dispositions in task-3-report are explicit; the reviewed corrections preserve the Cyan standalone addon and relocate Nasq-specific tests into nasq_pmo. This review did not independently compare every source checkpoint byte-for-byte and makes no all-history preservation claim.

## Required fresh evidence / remaining limits

No source-only review proves live Odoo ACL/rule behavior, fresh-install unique-index creation, concurrent conversion, session/company switching, binary download ACLs, standalone Cyan installation, or browser hydration/back navigation. Coordinator owns those checks. Existing database duplicate cleanup/upgrade is outside this local-merge scope. The report and worker test descriptions are not production or deployment evidence. Resolve M1/M2 and their regression tests before accepting security integration; resolve M3 for the promised route contract. Re-review the actual resulting diff and fresh coordinator test output.

## Coordinator gate update received after review

Coordinator reports fresh combined Odoo gate: 506 tests, 1 failure and 4 errors; standalone Cyan: 55 passed. This reviewer did not execute those gates. The catalog assertion still expects 25 capabilities instead of 28, meeting fixtures use removed Odoo-18 `groups_id` instead of Odoo-19 `group_ids`, and a privileged meeting fixture omits state. Source explains the latter: Cyan default_get strips state for all callers while create injects draft only for non-superusers; ordinary API create uses that non-superuser path. Coordinator chose explicit draft in fixtures rather than expanding scope into trusted-ORM default redesign. These reported failures do not resolve M1/M2; their dedicated regression evidence is still required. Log supplied by coordinator: `/tmp/nasq-consolidation-odoo.log`.

## Re-review of M1–M4 remediation (worker 56cd8c6 + shared a47c6a1)

Reviewed the actual candidate source, worker diff `07b8747..56cd8c6`, and root shared useProjects enabled argument at a47c6a1. Candidate HEAD observed as `6f779af91701f6dcca9beaabe86a6ebbfe5b5e07`; existing dirty `nasq_core/tests/__init__.py` was left untouched. No tests executed by reviewer. Coordinator reports standalone Cyan55 passing; combined acceptance remains pending fixture repairs and rerun.

**Verdict: M1, M3 and M4 addressed by source; M2 normal round-trip fixed, but one Important residual remains. No additional Critical finding.**

- **M1 source accepted:** `nasq_core/security/meeting_access.xml:4-13` installs global meeting/resolution rules, which intersect Cyan's support-group rules. `models/meeting_access.py:10-21` uses explicit evaluated current-company capabilities and applies participant restrictions when manager capability is absent. Meeting and resolution manager helpers use current-company capability, meeting native create requires meetings.create, Calendar minutes creation requires actual create authority, and computed flags include uid/company context. Follower manager lookup is narrowed to actual company grant. Stock Odoo rule evaluation was inspected: its global domains intersect group domains, and the provided company_id is trusted current company even though user has empty context. There is no native-group fallback with nasq_core installed; standalone Cyan is unchanged. Actual assignment/revocation, attachment, RPC and two-company behavior still need the coordinator's repaired tests.
- **M2 normal paths accepted:** the outbound payload now reconciles partner_ids/user_id; attendee/secretary/organizer changes invoke sync. The ContextVar token is server-local, reset in finally, and suppresses only the same meeting's outbound callback. Client context cannot forge it. Calendar-origin updates retain normal Cyan authorization and explicitly reconcile secretary membership. Linked-event AccessError/UserError propagates; current api_handler wraps the whole operation in an outer savepoint, so handled errors do not commit the preceding meeting change.
- **M3 source accepted:** page-one navigation overrides stale offset with undefined while retaining q and other query values.
- **M4 source accepted:** picker query and controls share current canConvert, which requires meeting editability plus PMO project-read/task-create; useProjects accepts the reactive enabled flag. Mutation failures render an inline alert with localized fallback.

### M2-R1 — Important / P2: clearing a linked meeting datetime bypasses membership synchronization

Location: `odoo-addons/nasq_pmo/models/meeting_minute.py:52-54`. `_nasq_sync_calendar` returns before inspecting an existing link whenever start or end is false. Cyan's native meeting write allows clearing either optional field and its datetime constraint checks ordering only when both exist. Reproduction through authorized native ORM/RPC: create a linked scheduled meeting with an attendee, clear start_datetime or end_datetime (possibly in the same write that removes the attendee), then remove the attendee. Both writes skip all event reconciliation, so the removed partner remains in the confidential calendar event indefinitely. The normal Nuxt PATCH currently cannot clear these values, so this residual is specifically the supported native model/RPC path. It preserves calendar access after meeting membership removal and can reintroduce stale membership through a later calendar-origin update.

Handle already-linked event membership separately from schedule completeness, or reject clearing a linked schedule atomically. Add a native ordinary-user regression that clears a date then removes an attendee, and one combined date-clear/membership write; assert final calendar membership or that the entire mutation is rejected unchanged. This is part of the M2 security invariant, not a request for additional calendar features.

Other limits remain as recorded above: actual concurrent conversion, standalone/full runtime gates, cache invalidation after role changes and browser refresh/back need fresh evidence. New M1 test fixture unsupported_scope errors are not proof of an implementation failure or a passing authorization check.

## Final residual re-review — worker 5f592d8

**Verdict: PASS for reviewed source. M2-R1 closed; M1–M4 have no remaining Important source finding in the reviewed scope.** Final runtime acceptance remains coordinator-owned.

Inspected the actual `6bd3122..5f592d8` production/test diff in candidate HEAD `b9a856d31ccac3969b379a3947c4e5083a931c74`; worktree status was clean. The only production behavior change is in `nasq_pmo/models/meeting_minute.py:_nasq_sync_calendar`: existing links now continue through metadata/organizer/membership reconciliation even when either datetime is absent. Start/stop are written only when both meeting values exist, preserving the event's last valid dates otherwise. The earlier server-local outbound marker and failure propagation remain intact, so incomplete schedules cannot bypass revocation or restore attendees through the ordinary outbound callback.

The two new ordinary-organizer model regressions cover clearing start and end separately followed by removal, plus clearing both together with attendee/secretary removal. Assertions verify meeting and calendar membership, follower removal, denied former-attendee record reads, retained secretary where applicable, metadata sync, and preserved calendar dates. These tests exercise the reported failure directly.

Coordinator reports three RED assertions across the two tests on the pre-fix candidate and a passing 460-test Nasq gate before this final fix. On this re-review, `/tmp/nasq-consolidation-final-odoo.log` still showed the fresh full update run in progress, so this reviewer makes no final-run pass claim. Earlier standalone Cyan55 pass is coordinator evidence and the final fix does not change standalone Cyan source. No tests, source, Git, runtime or database mutations were performed by this reviewer; only this report was appended. Historical findings and gate states above are retained as review history and superseded by this source verdict where explicitly closed.
