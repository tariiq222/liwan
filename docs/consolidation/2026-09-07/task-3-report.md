# Task 3 — meetings/access consolidation

Status: DONE_WITH_CONCERNS. Bounded repairs and source reconciliation completed; coordinator-owned Odoo/runtime/type/build gates remain. No claim of overall integration or deployment.

Worktree: `/Users/tariq/code/nasq/.worktrees/reconcile-meetings-20260907`, branch `codex/reconcile-meetings-20260907`, base `667c184`. No Git mutations, runtime/DB changes, shared-file edits, upstream source edits, or subagents. Installed independent node_modules with `npm ci --ignore-scripts --prefer-offline`; generated this worktree's `.nuxt` via `nuxt prepare` solely for focused Vitest. Prepare warned about pre-existing duplicate projectCharter/projectFinance and report/finance query auto-import names; coordinator owns resolution.

## Concrete fixes

1. **Meeting inbox exclusion.** The producer emits `cyan.meeting.minute` with `nasq_meeting_id`; old `_domain` admitted only task and overdue-digest company messages. Added recipient-owned candidate lookup, ordinary caller-env meeting ACL search, explicit current company and active record restriction, plus model/id restrictions in the shared domain. List/total/unread/read/read-all share it. No unrestricted sudo meeting search. Task and digest lookups short-circuit when task capability/ACL is unavailable, so meetings-only identities can use their inbox without exposing old task notifications.
2. **Meetings-only detail failed at task lookup.** Detail serializer now consults task capability/ACL before searching linked tasks, stays in caller environment, and explicitly scopes tasks/projects to current company and active projects. A meetings-only role still receives meeting detail and no unauthorized task links.
3. **Locked meetings offered edit/attachment mutation to managers.** Serializer and attachment API now honor `can_edit` rather than OR-ing `can_manage`, which ignores locked state. Conversion explicitly rejects locked meetings and checks resolution readability in addition to meeting readability. Existing exact attachment binary linkage, ordinary attachment ACLs and upload validation remain.
4. **Duplicate/concurrent resolution conversion.** Added partial unique index `project_task_nasq_resolution_task_unique` on positive resolution ids. Conversion catches only this index's IntegrityError inside a savepoint and returns a domain UserError; unrelated integrity failures propagate. Savepoint entry precedes the creation marker and marker cleanup precedes exit because Odoo precommit flush/rollback clears marker data (verified against stock sql_db.py/misc.py). Existing origin integer privacy, server-side creation marker, project visibility, task-create capability and generic write guards are retained. The index includes archived tasks, preventing a second conversion by archival. **Before upgrading any existing DB, check duplicate positive resolution_id values; do not delete/deduplicate automatically.** Fresh scratch index creation, actual second conversion and concurrent sessions are coordinator gates.
5. **Calendar integration drift.** Nasq sync now updates name/start/stop/location/URL of the existing event, including clearing URL, inside a savepoint so suppressed optional scheduling ACL/UserError cannot leave partial writes. Nasq CalendarEvent override suppresses only optional auto-scheduling when Cyan imports an existing event; Cyan retains its full linking and access behavior, and no orphan second event is created. The context flag is not an authorization flag.
6. **Unsaved meeting forms.** Edit previously became dirty immediately on load; create/resolution forms stayed dirty after successful saves and omitted end/priority changes. Snapshot baselines now detect changes and revert-to-original correctly, reset after successful saves, and flush to SharedUnsavedChanges before navigation. Editing unrelated metadata preserves original agenda/minutes HTML rather than stripping tags. Shared confirmation UI is unchanged.
7. **Cyan conflict.** Kept standalone Cyan security coverage; restored the source's Nasq office-manager/participant/outsider case in dependent `nasq_pmo/tests/test_meetings.py`, avoiding a nonexistent nasq_core reference during standalone Cyan installation. Trimmed two source EOF whitespace errors requested by coordinator.

## Access and source design decisions

The latest `access_roles_org_admin.xml` intentionally assigns meetings read/create/manage to system_admin and all permissions to vendor_support. Retained, together with legacy capability mapping and capability-to-Cyan-group implications. It grants no implicit HR or PMO write permission to system_admin. The company-wide meetings.manage visibility is intentional; global current-company rule still applies. Conversion never treats meetings.manage alone as PMO task-create authority.

All six routes exist. `[id].vue` already contains a conditional `<NuxtPage v-else />` and suspends detail/attachment queries on child paths; this source functionality was retained. Calendar/index/new are sibling routes. No new business overlays, shell, CSS tokens, nav or locale keys were introduced. Existing meeting notification labels/link targets and contracts retained.

## Focused evidence (fresh)

- `npm test --workspace=web -- app/pages/__tests__/meetingForms.test.ts`: **3 passed** after observed **3 failing behavioral assertions** on the original forms. The initial invocation could not run because `.nuxt/tsconfig.app.json` was missing; independent `nuxt prepare` resolved the environment, then RED and GREEN were observed.
- `npm test --workspace=@nasq/contracts -- src/meetings/__tests__/schemas.test.ts src/access/__tests__/schemas.test.ts src/pmo/__tests__/notifications.test.ts`: **15 passed** across three files.
- Vue SFC parse + compileTemplate on every meetings page: **6 route templates compiled**. This is compilation, not browser navigation proof.
- `/tmp/nasq-meeting-domain-check.py`: executes original and modified production `_domain` function extracted by AST with deterministic request data. RED reproduces excluded readable recipient meeting. GREEN verifies recipient/id/read-state isolation and retained task/digest cases. This is a pure domain check, not ORM/record-rule execution.
- Changed backend files parsed with Python AST; `git diff --check`: PASS. No Ruff, full tests, build, browser runtime, Odoo tests or database mutations were run by this worker.

## Exact coordinator Odoo selectors

Run against a fresh isolated DB with this candidate's explicit addon path (never odoo19):

- `/nasq_pmo:TestMeetingsApi` — participant-only lists, restored manager/outsider coverage, company/hidden/archive/revocation/ownership/read/read-all/count semantics, meetings-only identity.
- `/nasq_pmo:TestResolutionConvert` — existing origin/privacy/capability checks plus duplicate conversion, locked meeting flags/conversion, event reschedule and existing calendar import without an extra event.
- `/nasq_pmo:TestTaskNotifications` — existing task and overdue delivery contracts; also include existing digest tests.
- `/nasq_core` — current role/capability/assignment behavior and no unintended HR/PMO writes.
- `/cyan_meeting_minutes` **in standalone Cyan installation as well as combined installation**, proving its tests have no Nasq dependency.

Odoo cases were written before the associated backend production edits but not executed here under the worker DB restriction. Their RED/GREEN remains coordinator-owned. The duplicate index is a concurrency mechanism, not executed concurrency evidence; exercise two simultaneous conversions and confirm exactly one task and a clean second error.

## Shared files / requests

Root is already handling bell visibility and `/notifications` route access for task-read OR meetings-read identities; no further nav/common locale request. Root should update the CLAUDE notification elevation paragraph (currently tasks-only) to include recipient-owned readable current-company meetings. Root owns duplicate auto-import warnings from Nuxt prepare, unrelated to this package.

## Remaining limits and escalation

- Odoo integration/standalone/runtime/actual browser/type gates remain; failure should return to this package before acceptance.
- Existing source exposes meeting state as read-only in Nuxt; confirm/done/cancel/reopen remain Cyan ORM/vendor actions, not new Nasq endpoints. No invented workflow expansion was added.
- Calendar page currently displays the first 200 meetings and does not request a server-side date range. Large history/calendar completeness remains a source limitation; it is not claimed complete for arbitrary volume.
- Existing scheduling errors (AccessError/UserError) remain optional by source design, now atomic. No automatic external meeting-provider integration is claimed.
- Existing database with duplicate positive task resolution ids must be checkpointed and reviewed before index upgrade. No cleanup authorized here.

## Changed paths

- `apps/web/app/pages/meetings/[id]/edit.vue`
- `apps/web/app/pages/meetings/[id]/resolutions/new.vue`
- `apps/web/app/pages/meetings/new.vue`
- `odoo-addons/cyan_meeting_minutes/report/meeting_report_templates.xml`
- `odoo-addons/cyan_meeting_minutes/security/ir.model.access.csv`
- `odoo-addons/nasq_pmo/controllers/meeting_attachments.py`
- `odoo-addons/nasq_pmo/controllers/notifications.py`
- `odoo-addons/nasq_pmo/models/meeting_minute.py`
- `odoo-addons/nasq_pmo/models/meeting_resolution.py`
- `odoo-addons/nasq_pmo/models/project_task.py`
- `odoo-addons/nasq_pmo/serializers/meeting.py`
- `odoo-addons/nasq_pmo/tests/test_meetings.py`
- `odoo-addons/nasq_pmo/tests/test_resolution_convert.py`
- `apps/web/app/pages/__tests__/meetingForms.test.ts`

## Per-owned-source disposition

Compared latest immutable `codex/meetings-access` checkpoint with this worktree; Cyan hardening was also compared against its standalone source. “Retained” means byte-equal to the latest source (or noted whitespace only), not a claim that all runtime cases have passed.

| Source path | Disposition / rationale |
|---|---|
| `apps/web/app/components/notifications/NotificationCenter.vue` | Retained verbatim; source integration capability/model/API/contract/UI behavior preserved. |
| `apps/web/app/composables/useMeetings.ts` | Retained verbatim; source integration capability/model/API/contract/UI behavior preserved. |
| `apps/web/app/composables/useNotifications.ts` | Retained verbatim; source integration capability/model/API/contract/UI behavior preserved. |
| `apps/web/app/pages/meetings/[id].vue` | Retained verbatim; source integration capability/model/API/contract/UI behavior preserved. |
| `apps/web/app/pages/meetings/[id]/edit.vue` | Retained source plus targeted regression repair described above; no wholesale replacement. |
| `apps/web/app/pages/meetings/[id]/resolutions/new.vue` | Retained source plus targeted regression repair described above; no wholesale replacement. |
| `apps/web/app/pages/meetings/calendar.vue` | Retained verbatim; source integration capability/model/API/contract/UI behavior preserved. |
| `apps/web/app/pages/meetings/index.vue` | Retained verbatim; source integration capability/model/API/contract/UI behavior preserved. |
| `apps/web/app/pages/meetings/new.vue` | Retained source plus targeted regression repair described above; no wholesale replacement. |
| `apps/web/app/pages/notifications.vue` | Retained verbatim; source integration capability/model/API/contract/UI behavior preserved. |
| `odoo-addons/cyan_meeting_minutes/.gitignore` | Retained verbatim; source integration capability/model/API/contract/UI behavior preserved. |
| `odoo-addons/cyan_meeting_minutes/PROVENANCE.md` | Retained verbatim; source integration capability/model/API/contract/UI behavior preserved. |
| `odoo-addons/cyan_meeting_minutes/README.md` | Retained verbatim; source integration capability/model/API/contract/UI behavior preserved. |
| `odoo-addons/cyan_meeting_minutes/__init__.py` | Retained verbatim; source integration capability/model/API/contract/UI behavior preserved. |
| `odoo-addons/cyan_meeting_minutes/__manifest__.py` | Retained verbatim; source integration capability/model/API/contract/UI behavior preserved. |
| `odoo-addons/cyan_meeting_minutes/data/escalation_cron.xml` | Retained verbatim; source integration capability/model/API/contract/UI behavior preserved. |
| `odoo-addons/cyan_meeting_minutes/data/meeting_sequence.xml` | Retained verbatim; source integration capability/model/API/contract/UI behavior preserved. |
| `odoo-addons/cyan_meeting_minutes/i18n/ar.po` | Retained verbatim; source integration capability/model/API/contract/UI behavior preserved. |
| `odoo-addons/cyan_meeting_minutes/models/__init__.py` | Retained verbatim; source integration capability/model/API/contract/UI behavior preserved. |
| `odoo-addons/cyan_meeting_minutes/models/calendar_event.py` | Retained verbatim; source integration capability/model/API/contract/UI behavior preserved. |
| `odoo-addons/cyan_meeting_minutes/models/meeting.py` | Retained verbatim; source integration capability/model/API/contract/UI behavior preserved. |
| `odoo-addons/cyan_meeting_minutes/models/resolution.py` | Retained verbatim; source integration capability/model/API/contract/UI behavior preserved. |
| `odoo-addons/cyan_meeting_minutes/report/meeting_report.xml` | Retained verbatim; source integration capability/model/API/contract/UI behavior preserved. |
| `odoo-addons/cyan_meeting_minutes/report/meeting_report_templates.xml` | Retained source plus targeted regression repair described above; no wholesale replacement. |
| `odoo-addons/cyan_meeting_minutes/security/ir.model.access.csv` | Retained source plus targeted regression repair described above; no wholesale replacement. |
| `odoo-addons/cyan_meeting_minutes/security/meeting_security.xml` | Retained verbatim; source integration capability/model/API/contract/UI behavior preserved. |
| `odoo-addons/cyan_meeting_minutes/tests/__init__.py` | Retained verbatim; source integration capability/model/API/contract/UI behavior preserved. |
| `odoo-addons/cyan_meeting_minutes/tests/common.py` | Retained verbatim; source integration capability/model/API/contract/UI behavior preserved. |
| `odoo-addons/cyan_meeting_minutes/tests/test_bypass.py` | Retained verbatim; source integration capability/model/API/contract/UI behavior preserved. |
| `odoo-addons/cyan_meeting_minutes/tests/test_calendar_security.py` | Retained verbatim; source integration capability/model/API/contract/UI behavior preserved. |
| `odoo-addons/cyan_meeting_minutes/tests/test_meeting_security.py` | Ported Nasq-dependent case into PMO; standalone Cyan tests retained from hardening source. |
| `odoo-addons/cyan_meeting_minutes/tests/test_resolution_security.py` | Retained verbatim; source integration capability/model/API/contract/UI behavior preserved. |
| `odoo-addons/cyan_meeting_minutes/tests/test_workflow.py` | Retained verbatim; source integration capability/model/API/contract/UI behavior preserved. |
| `odoo-addons/cyan_meeting_minutes/views/calendar_event_views.xml` | Retained verbatim; source integration capability/model/API/contract/UI behavior preserved. |
| `odoo-addons/cyan_meeting_minutes/views/meeting_views.xml` | Retained verbatim; source integration capability/model/API/contract/UI behavior preserved. |
| `odoo-addons/cyan_meeting_minutes/views/menus.xml` | Retained verbatim; source integration capability/model/API/contract/UI behavior preserved. |
| `odoo-addons/cyan_meeting_minutes/views/resolution_views.xml` | Retained verbatim; source integration capability/model/API/contract/UI behavior preserved. |
| `odoo-addons/nasq_core/__manifest__.py` | Retained verbatim; source integration capability/model/API/contract/UI behavior preserved. |
| `odoo-addons/nasq_core/data/access_permissions.xml` | Retained verbatim; source integration capability/model/API/contract/UI behavior preserved. |
| `odoo-addons/nasq_core/data/access_roles.xml` | Retained verbatim; source integration capability/model/API/contract/UI behavior preserved. |
| `odoo-addons/nasq_core/data/access_roles_org_admin.xml` | Retained verbatim; source integration capability/model/API/contract/UI behavior preserved. |
| `odoo-addons/nasq_core/models/access_permission.py` | Retained verbatim; source integration capability/model/API/contract/UI behavior preserved. |
| `odoo-addons/nasq_core/models/access_service.py` | Retained verbatim; source integration capability/model/API/contract/UI behavior preserved. |
| `odoo-addons/nasq_core/security/nasq_access_groups.xml` | Retained verbatim; source integration capability/model/API/contract/UI behavior preserved. |
| `odoo-addons/nasq_core/tests/test_access_models.py` | Retained verbatim; source integration capability/model/API/contract/UI behavior preserved. |
| `odoo-addons/nasq_core/tests/test_access_security.py` | Retained verbatim; source integration capability/model/API/contract/UI behavior preserved. |
| `odoo-addons/nasq_pmo/__manifest__.py` | Retained verbatim; source integration capability/model/API/contract/UI behavior preserved. |
| `odoo-addons/nasq_pmo/controllers/__init__.py` | Retained verbatim; source integration capability/model/API/contract/UI behavior preserved. |
| `odoo-addons/nasq_pmo/controllers/meeting_attachments.py` | Retained source plus targeted regression repair described above; no wholesale replacement. |
| `odoo-addons/nasq_pmo/controllers/meetings.py` | Retained verbatim; source integration capability/model/API/contract/UI behavior preserved. |
| `odoo-addons/nasq_pmo/models/__init__.py` | Retained verbatim; source integration capability/model/API/contract/UI behavior preserved. |
| `odoo-addons/nasq_pmo/models/mail_notification_nasq.py` | Retained verbatim; source integration capability/model/API/contract/UI behavior preserved. |
| `odoo-addons/nasq_pmo/models/meeting_minute.py` | Retained source plus targeted regression repair described above; no wholesale replacement. |
| `odoo-addons/nasq_pmo/models/meeting_resolution.py` | Retained source plus targeted regression repair described above; no wholesale replacement. |
| `odoo-addons/nasq_pmo/models/project_task.py` | Retained source plus targeted regression repair described above; no wholesale replacement. |
| `odoo-addons/nasq_pmo/serializers/meeting.py` | Retained source plus targeted regression repair described above; no wholesale replacement. |
| `odoo-addons/nasq_pmo/serializers/notification.py` | Retained verbatim; source integration capability/model/API/contract/UI behavior preserved. |
| `odoo-addons/nasq_pmo/tests/__init__.py` | Retained verbatim; source integration capability/model/API/contract/UI behavior preserved. |
| `odoo-addons/nasq_pmo/tests/test_meetings.py` | Retained source plus targeted regression repair described above; no wholesale replacement. |
| `odoo-addons/nasq_pmo/tests/test_resolution_convert.py` | Retained source plus targeted regression repair described above; no wholesale replacement. |
| `packages/contracts/src/access/__tests__/schemas.test.ts` | Retained verbatim; source integration capability/model/API/contract/UI behavior preserved. |
| `packages/contracts/src/access/access.ts` | Retained verbatim; source integration capability/model/API/contract/UI behavior preserved. |
| `packages/contracts/src/meetings/__tests__/schemas.test.ts` | Retained verbatim; source integration capability/model/API/contract/UI behavior preserved. |
| `packages/contracts/src/meetings/index.ts` | Retained verbatim; source integration capability/model/API/contract/UI behavior preserved. |
| `packages/contracts/src/pmo/notification.ts` | Retained verbatim; source integration capability/model/API/contract/UI behavior preserved. |

## Independent review M1–M4 rework (2026-09-07, base 07b8747)

Code ready for coordinator isolated acceptance rerun; no worker Git/runtime/DB actions.

- **M1:** Added `nasq_core/models/meeting_access.py` and global `security/meeting_access.xml`, registered in manifest/model imports. The global meeting/resolution rules intersect Cyan support-group rules for search, read/fetch, read_group and linked attachment checks. Rule domains evaluate actual capability in explicit current company and then manager-or-participant membership. Nasq manager helpers now use current-company capability; direct meeting create requires meetings.create. Computed edit/manage flags depend on uid/company context. Follower-manager lookup is narrowed by actual company grant. Calendar create-minutes checks actual meetings.create and organizer/manage. No native-group fallback; standalone Cyan addon unchanged. Combined Nasq fixtures now carry deliberate valid grants; standalone Cyan policy has its separate acceptance run.
- **M2:** Calendar sync includes all participant partner_ids and organizer user_id and runs on membership/secretary/organizer edits. A server-only ContextVar marks outbound synchronization so Cyan's full schedule round-trip cannot restore stale attendees. Client context values cannot activate this marker. Calendar-origin changes still use ordinary Cyan guards, preserve an included secretary outside the attendee list, and remove the secretary role if explicitly absent from event participants. Linked-event sync failures propagate to prevent persisting changed membership with stale calendar access. Import suppression also moved from client context to ContextVar.
- **M3:** Page-one navigation explicitly sets URL offset undefined while preserving other search/filter query values, fixing refresh/detail-return behavior.
- **M4:** Detail project lookup and conversion controls require actual meeting editability plus pmo.projects.read and pmo.tasks.create. Conversion catches failures and renders an inline role=alert message using API message or localized meetingsUi.convertError fallback. Root owns the new enabled argument on useProjects and both locale additions (a47c6a1); no worker changes to those shared files.
- **Fixtures:** Changed groups_id to Odoo19 group_ids and explicit state=draft in privileged meeting creates. Restored manager fixture now has an actual role assignment rather than treating a support group as authority. Root owns the 25→28 catalog assertion.

New/expanded selectors:

- `/nasq_core:TestNasqMeetingCompanyAccess` (registered test_meeting_access): manager grant in A/read grant in B; denied unrelated B search/read/write/resolution access; read-only direct create denied; B participant read allowed/edit denied; linked attachment target ACL denied.
- `/nasq_pmo:TestMeetingsApi`: HTTP B list/detail/PATCH/attachment list/inbox/read/read-all hidden despite manager assignment in A, plus existing invitation/read-only identity cases.
- `/nasq_pmo:TestResolutionConvert`: ordinary organizer/resolution/calendar flows now have explicit current-company grants; tests removal then rename/reschedule, simultaneous membership+metadata, adding attendee, secretary preservation, calendar-origin membership, forged sync context, and prior conversion tests.
- `apps/web/app/pages/__tests__/meetingNavigation.test.ts`: observed **3 failures** before corrections (URL retained 25, projects enabled absent, uncaught rejected conversion), then **3 passed** after corrections.
- Combined focused web run `npm test --workspace=web -- app/pages/__tests__/meetingNavigation.test.ts app/pages/__tests__/meetingForms.test.ts`: **6 passed**. Changed Python AST and XML parse and `git diff --check`: PASS. Backend security tests remain unrun by worker and require coordinator acceptance; no claim that source syntax verifies record rules.

Additional changed files relative to 07b8747: nasq_core/{__manifest__.py,models/__init__.py,models/meeting_access.py,security/meeting_access.xml,tests/__init__.py,tests/test_meeting_access.py}; nasq_pmo/{models/meeting_minute.py,tests/test_meetings.py,tests/test_resolution_convert.py}; apps/web/app/pages/{meetings/index.vue,meetings/[id].vue,__tests__/meetingNavigation.test.ts}.

### Coordinator RED fixture correction

Read `/tmp/nasq-consolidation-security-red.log`: four M2 failures are valid behavioral RED. The other errors were fixture problems, now corrected only in tests:

- `access_role._nasq_access_create` deliberately forces custom role company to `env.company`. Both multi-company tests now create roles with `.with_company(company)`; setting company_id in values alone was overwritten and caused unsupported_scope at assignment (no scope enum exists on this model).
- Outsider task-isolation test now reassigns through explicit privileged **fixture setup** (`task.sudo().write`) because the converting organizer deliberately has create without general task-write. The actual outsider read/write assertions still execute as outsider; no extra capability granted.
- Shared `get_record` uses exists + check_access; api_handler maps existing-but-hidden record AccessError to **403 forbidden**, not 404. Meeting detail/PATCH/attachment denial expectations now assert 403; absent/recipient-filtered notification read remains **404**. No production error mapping was changed.

Three corrected test files parsed successfully; diff --check PASS. Coordinator retains exclusive ownership of the actual RED/GREEN Odoo rerun.

### M2 residual: linked meeting with incomplete schedule (base 6bd3122)

The early return previously skipped all calendar work when either meeting datetime was empty, leaving removed participants on an already-linked event. `_nasq_sync_calendar` now skips only an **unlinked** meeting with incomplete dates. Linked events always reconcile participant/organizer and metadata; their existing start/stop remain intact until both meeting datetimes are available. The server-local outbound marker and linked-event error propagation remain unchanged.

Added tests before changing the guard: `TestResolutionConvert.test_linked_membership_sync_survives_missing_schedule` covers clearing either datetime then removing an attendee, checking membership/followers/read denial and preserved calendar dates. `test_clear_schedule_and_remove_membership_in_one_write` covers clearing both times and removing attendee+secretary atomically. Selector `/nasq_pmo:TestResolutionConvert` (or these individual methods). Python AST for both changed files and diff --check PASS; no worker runtime/DB/test-suite actions. Actual Odoo regression execution remains coordinator-owned.

### Bounded Ruff cleanup

Corrected the 10 findings supplied in `/tmp/nasq-consolidation-lint.log`: moved dump_meeting import to module scope, applied the 9 safe import/blank-line/Yoda-condition fixes only to the four explicitly assigned files (`nasq_core/tests/test_access_models.py`, `nasq_pmo/tests/test_meetings.py`, `nasq_pmo/models/meeting_minute.py`, `nasq_pmo/tests/test_resolution_convert.py`). Fresh bounded `ruff check` on exactly those four files: **All checks passed**; `git diff --check`: PASS. No commit or broad checks. The missing-datetime membership correction and both regression tests remain in this ready diff.
