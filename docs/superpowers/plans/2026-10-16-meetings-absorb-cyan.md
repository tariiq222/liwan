# Meetings: absorb `cyan_meeting_minutes` into `webvue_meetings` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Meetings live in one addon, `webvue_meetings`, that owns the meeting and recommendation models directly; the vendored `odoo-addons/cyan_meeting_minutes` is deleted with no second engine layer and no compatibility remnants.

**Architecture:** `cyan.meeting.minute` and `cyan.meeting.resolution` become `webvue.meeting.minute` and `webvue.meeting.resolution`, each defined once (`_name`) in one owning file of `webvue_meetings` that folds the Cyan base class and every `_inherit = 'cyan.*'` layer of `webvue_meetings`. Cyan's support groups collapse into the existing `meetings.*` capability groups. Backend-only Odoo screens (views, menus, window actions, calendar backend buttons, escalation cron, mail activities) are dropped because customers never open Odoo; the PDF minutes report stays because `/api/v1/meetings/<id>/minutes.pdf` renders it. A `webvue_meetings` 19.0.1.1.0 pre-migration renames tables, model/field/xml-id rows and model-name columns in place and removes the Cyan module row.

**Tech Stack:** Odoo 19 Community, PostgreSQL, Python 3, WebVue tooling (`tools/arch_policy.py`, `tools/git_policy.py`, `tools/catalog_check.py`), `npm test`.

**Spec:** the task brief from the orchestrating session (2026-10-16, quoted in the hand-over note in the shared notes folder), `AGENTS.md` (clean pre-release codebase, R1–R10), `docs/agents/odoo-rules.md`, `docs/migrations.md`.

## Port to the WebVue namespace (2026-10-16, after the plan was written)

`main` renamed the product namespace (`878b7875`, merged as `ec88b4b0`): every `nasq_*` addon,
model, method, test case and environment variable is now `webvue_*` / `webvue.*` / `_webvue_*` /
`WebVue*` / `WEBVUE_*`. The owner then chose the parallel branch `codex/meetings-absorb-cyan` as
the base for this work and asked to add what it lacked (no `mail.activity.mixin`; `ir_filters`,
`ir_exports` and `ir.model.inherit` in the rename). The result was ported onto `main` in
`codex/meetings-absorb-cyan-webvue`. The names below were written before the rename; read
every `webvue_*` as written and every Cyan source path as historical.

Version and migration decision on `main`: the WebVue namespace is a fresh-database baseline
(`webvue_*/migrations/19.0.1.1.0/README.md`), and the CI upgrade step runs only from a
WebVue-namespace release tag (`tools/upgrade_baseline.py`). So there is no database to adopt in
place: `webvue_meetings` and `webvue_meetings_pmo` move to `19.0.1.2.0` with a README-only
migration, and the in-place adoption code (`cyan_adoption.py`, `retired_fields.py`, the install
hook) is not ported. Task 5 and Task 6 (in-place migration and upgrade proof) are superseded by
that decision; the fresh-install gate is binding. D4 is applied as approved (`hooks.py`,
`webvue_pmo/migrations/19.0.1.4.0` and the ownership-migration test removed); no release tag is
needed for it any more.

## Global Constraints

- No API surface change: `/api/v1/meetings*` and `/api/v1/meeting-series*` responses, status codes and error codes stay identical; nothing under `packages/contracts` changes.
- Replace, do not layer: one `_name` definition per model, no `_inherit` of a model by the addon that defines it, no `cyan` token left anywhere outside `docs/archive`, dated `docs/reports`, `docs/consolidation`, `docs/verification`, older `docs/superpowers/{plans,specs}` and approval JSON (historical records).
- One schema: no kept or renamed-and-kept columns, tables, groups or xml ids; dropped features leave no column behind.
- R7: the R7 total in `tools/arch_baseline.json` must not grow (`--write-baseline` refuses growth). Cyan's two calendar `sudo()` calls disappear with the dropped calendar extension; its group lookup is already replaced by the `webvue_meetings` one.
- Versions (superseded by the port section above): `webvue_meetings` and `webvue_meetings_pmo` `19.0.1.1.0` → `19.0.1.2.0`, each bump in the same commit as its README-only `migrations/19.0.1.2.0/` directory.
- Never run tests on `odoo19`; scratch DBs only (`webvue_absorb_fresh`, `webvue_absorb_upgrade`), `--http-port=8179`, addons path = this worktree's `odoo-addons`. Read-only `psql` queries on `odoo19` are allowed for inspection only.
- Licensing: code derived from upstream `rezachidotnet/meeting_minutes-odoo` (author Cyan, LGPL-3) keeps its `SPDX-License-Identifier: LGPL-3` and `Original author: Cyan` header lines; attribution is recorded in `odoo-addons/webvue_meetings/PROVENANCE.md`. This is a record of declared provenance, not legal advice.
- No commit, merge, push or tag without the owner's explicit authorization for that action. Work only in this worktree.
- `webvue_registry_probe` is not touched (it stays in `tools/arch_layers.json` `exempt`).

## Owner decisions this plan assumes (approve or change before Phase 2)

- **D1 — one group layer.** `cyan_meeting_minutes.group_meeting_user` is merged into `webvue_meetings.group_cap_meetings_read` and `group_meeting_manager` into `group_cap_meetings_manage` (today each capability group only implies its Cyan group). The Cyan privilege `privilege_meeting_minutes` goes. Record rules and ACLs target the capability groups.
- **D2 — drop the Odoo-calendar backend path.** Removed: the `calendar.event` extension (`meeting_minute_count`, `cyan_can_create_minutes`, `action_open_meeting_minutes`, calendar→meeting schedule sync on `calendar.event.write`, the `unlink` guard). Kept: meeting→calendar outbound sync (`_webvue_sync_calendar`) and `calendar_event_id` with `ondelete='restrict'`, which still blocks deleting a linked event at DB level. Nothing in `/api/v1` edits `calendar.event`.
- **D3 — drop Cyan escalation and mail activities.** Removed: `is_escalated`, `escalated_on`, `escalated_to_id`, `activity_id`, `_cron_check_overdue_escalations`, `_sync_activity`, `_activity_values`, the escalation cron and `_check_escalated_completion_notes`; also the backend-only computed/search fields `days_overdue`, `is_due_soon`, `deadline_status`. The `meeting_resolution_overdue` bell in `_webvue_run_meeting_reminders` already covers overdue recommendations. No serializer reads any of these fields.
- **D4 — new upgrade baseline.** The CI `upgrade` step starts from the newest `release/*` tag, today `release/19.0.1.0.0`, which predates `webvue_meetings`. Supporting that path would mean rewriting the unreleased `webvue_pmo` 19.0.1.4.0 hand-off migration and `webvue_meetings/hooks.py` around renamed tables. There are no tenants and the dev DB (`odoo19`) is already at `webvue_pmo` 19.0.1.6.0 / `webvue_meetings` 19.0.1.0.0. So: delete `webvue_meetings/hooks.py` and its `pre_init_hook`, `webvue_pmo/migrations/19.0.1.4.0/` and `webvue_meetings_pmo/tests/test_meetings_ownership_migration.py`; before this branch is merged, the owner creates a new release tag on current `main` (proposed `release/19.0.1.1.0` on `67902a05`) so the CI upgrade starts from a DB that already has `webvue_meetings` + Cyan.

## Review Focus

- Existing dev data after upgrade: the one meeting and two recommendations in `odoo19` (and their chatter, followers, attachments, bell rows, versions, events) must read identically through `/api/v1/meetings/<id>` before and after; Task 6 pins it with a before/after serializer dump.
- A user who held only `cyan_meeting_minutes.group_meeting_user` without a capability group must lose meeting access, not keep it through a stray group (D1); Task 6 asserts no `res_groups` row named after Cyan's groups survives.
- Odoo's end-of-update obsolete-record cleanup must remove the renamed Cyan views, menus, actions, escalation cron and dropped fields without dropping a kept column; Task 6 compares the column list of both tables to the expected set.
- The PDF report must still render with the history snapshot (folded template) for a completed meeting and refuse an outsider; Task 3 keeps `test_meeting_history` and `test_meeting_history_pmo` report tests.
- Calendar deletion of a linked event must still fail after the `unlink` guard is gone (D2); Task 4 keeps `test_cannot_delete_event_while_meeting_linked`, expecting the FK error.

---

## File map

Created in `odoo-addons/webvue_meetings/`:

| File | Responsibility |
|---|---|
| `models/meeting_minute.py` (rewritten) | `webvue.meeting.minute`: Cyan fields/CRUD/state machine/follower+mail guards + WebVue series, calendar outbound sync, notifications, reminders cron, schedule scope, capability checks, minutes history snapshot, minutes workspace form/version capture |
| `models/meeting_resolution.py` (rewritten) | `webvue.meeting.resolution`: Cyan decision/execution rules + WebVue optional deadline/`execution_period`, linked-task freeze, capability checks, workspace event logging |
| `models/meeting_record.py` (new, from `meeting_workspace.py`) | the server-controlled `webvue.meeting.minutes.version` and `webvue.meeting.event` models and `workspace_write_context()` |
| `models/minutes_snapshot.py` (new, plain Python, no model) | pure helpers moved out of the history/workspace layers: `snapshot_person(user) -> dict`, `validate_minutes_form(env, form) -> dict`, `occurrence_key(meeting) -> tuple` |
| `models/res_users.py` (new) | the single `res.users` extension: `_webvue_meeting_access_domain` (from `meeting_access.py`) and `_webvue_meeting_series_access_domain` (from `meeting_series.py`) |
| `data/meeting_sequence.xml` | sequence `sequence_meeting_minute`, code `webvue.meeting.minute`, prefix `MIN/%(year)s/`, padding 4, `noupdate="1"` |
| `security/meeting_rules.xml` | company rules and the six participant/manager rules from Cyan, retargeted to `group_cap_meetings_read` / `group_cap_meetings_manage`, plus today's two global capability rules from `meeting_access.xml` |
| `report/meeting_report.xml` | `action_report_meeting_minutes` (model `webvue.meeting.minute`, `report_name` `webvue_meetings.report_meeting_minutes`), the paperformat, and one `report_meeting_minutes_document` template with the history section folded in |
| `i18n/ar.po` | Cyan's Arabic entries re-tagged `module: webvue_meetings`, `model:` refs renamed, view/menu/action-only entries removed |
| `PROVENANCE.md` | upstream URL, pin `3a549ffe5ce6a92daa318810bce5e199f7c5c24b`, upstream version 19.0.1.3.0, author Cyan, LGPL-3, list of WebVue changes, sudo cases |
| `migrations/19.0.1.1.0/pre-absorb_cyan_meeting_minutes.py` | the in-place rename (Task 5) |
| `tests/common.py` (extended) | `WebVueMeetingRulesCase`: Cyan's role fixture rebuilt on capability groups |
| `tests/test_meeting_rules.py`, `test_meeting_resolution_rules.py`, `test_meeting_guards.py`, `test_meeting_workflow.py` | ported Cyan tests (Task 4) |

Removed: `odoo-addons/cyan_meeting_minutes/` (whole tree), `webvue_meetings/models/{meeting_access.py,meeting_history.py,meeting_workspace.py}`, `webvue_meetings/report/meeting_report_history_templates.xml`, `webvue_meetings/security/meeting_access.xml` (moved into `meeting_rules.xml`), `webvue_meetings/hooks.py` (D4), `webvue_pmo/migrations/19.0.1.4.0/` (D4), `webvue_meetings_pmo/tests/test_meetings_ownership_migration.py` (D4).

Modified: `webvue_meetings/__manifest__.py`, `models/__init__.py`, `models/meeting_series.py`, `models/meeting_notification_types.py`, `security/ir.model.access-meetings.csv`, `security/meeting_capability_groups.xml`, `data/meeting_reminder_cron.xml`, `controllers/{meetings,meeting_attachments,meeting_workspace,meeting_series}.py`, `serializers/{meeting,meeting_notification}.py`, every `webvue_meetings/tests/*.py` and `webvue_meetings_pmo/{models,controllers,tests}/*.py` that names Cyan, `webvue_meetings_pmo/__manifest__.py` + `migrations/19.0.1.1.0/README.md`, `tools/arch_layers.json`, `tools/arch_policy.py`, `tools/test_arch_policy.py`, `tools/test_odoo_test.py`, `AGENTS.md`, `docs/agents/odoo-rules.md`, `docs/agents/repository-layout.md`, `apps/web/PRODUCT.md`, `docs/migrations.md` (remove step 5, the 19.0.1.4.0 recovery note, per D4).

## Renames (the contract every task uses)

| Old | New |
|---|---|
| model `cyan.meeting.minute` / table `cyan_meeting_minute` | `webvue.meeting.minute` / `webvue_meeting_minute` |
| model `cyan.meeting.resolution` / table `cyan_meeting_resolution` | `webvue.meeting.resolution` / `webvue_meeting_resolution` |
| m2m `cyan_meeting_attendee_rel` | `webvue_meeting_attendee_rel` (columns `meeting_id`, `user_id` unchanged) |
| `cyan_meeting_minutes.action_report_meeting_minutes` | `webvue_meetings.action_report_meeting_minutes` |
| `cyan_meeting_minutes.group_meeting_user` / `group_meeting_manager` | `webvue_meetings.group_cap_meetings_read` / `group_cap_meetings_manage` (D1) |
| `_cyan_is_manager`, `_cyan_is_editor`, `_cyan_is_meeting_editor`, `_cyan_is_assignee`, `_cyan_participant_users`, `_cyan_allowed_follower_partners`, `_cyan_sync_followers`, `_cyan_check_human_write`, `_cyan_check_transition`, `_cyan_assert_internal_user`, `_cyan_assert_mail_post_kwargs`, `_cyan_link_calendar_event`, `_cyan_system_write` | same name with `_webvue_` prefix; `_cyan_follower_partners` is dropped (it only returned `_cyan_allowed_follower_partners`) |
| `action_schedule_calendar_event` / `action_open_calendar_event` (act_window) | `_webvue_create_calendar_event() -> calendar.event` (private, no window action) |

Field names on both models do not change, so serializers and the API stay identical. No clash: the existing models are `webvue.meeting.series`, `webvue.meeting.links`, `webvue.meeting.minutes.version`, `webvue.meeting.event` (tables `webvue_meeting_minutes_version`, `webvue_meeting_event` differ from `webvue_meeting_minute`).

---

### Task 1: Fold the meeting and recommendation models into `webvue_meetings`

**Files:**
- Rewrite: `odoo-addons/webvue_meetings/models/meeting_minute.py`, `models/meeting_resolution.py`
- Create: `models/meeting_record.py`, `models/minutes_snapshot.py`, `models/res_users.py`
- Modify: `models/__init__.py`, `models/meeting_series.py` (model names, `_webvue_link_calendar_event`, drop its `ResUsers` class), `models/meeting_notification_types.py` (model names)
- Delete: `models/meeting_access.py`, `models/meeting_history.py`, `models/meeting_workspace.py`

**Interfaces:**
- Produces: models `webvue.meeting.minute` and `webvue.meeting.resolution` with every field they have today except the D3 fields; methods per the Renames table; `res.users._webvue_meeting_access_domain(company_id, resolution=False)` and `_webvue_meeting_series_access_domain(company_id)` unchanged in signature; `minutes_snapshot.workspace_write_context()` import path becomes `odoo.addons.webvue_meetings.models.meeting_record`.

- [ ] **Step 1:** In `meeting_minute.py` define `class WebVueMeetingMinute(models.Model)` with `_name = 'webvue.meeting.minute'`, `_inherit = ['mail.thread', 'mail.activity.mixin']`, `_description`, `_rec_name = 'reference'`, `_order`, `_check_company_auto`, `_mail_post_access = 'read'` from Cyan. Merge, in this order of precedence, the bodies of Cyan `meeting.py`, `webvue_meetings` `meeting_access.MeetingMinute`, `meeting_minute.CyanMeetingMinute`, `meeting_history`, `meeting_workspace.WebVueMeetingWorkspace`: each overridden method (`create`, `write`, `copy`, `unlink`, `default_get`, `_webvue_is_manager`, `_webvue_allowed_follower_partners`, `_compute_can_flags`, `_webvue_build_minutes_snapshot`) becomes one method whose body runs the former layers' logic in the former MRO order (outermost = history, then workspace, then `meeting_minute`, then access, then Cyan). `_webvue_is_manager` is the capability check (`env.su or _webvue_has_capability(user, 'meetings.manage')`); the Cyan group check goes. The follower allow-list keeps the one `sudo()` group lookup, now on `webvue_meetings.group_cap_meetings_manage`.
- [ ] **Step 2:** Drop from the minute model: `action_view_resolutions`, `action_open_calendar_event`, `action_schedule_calendar_event` (replaced by `_webvue_create_calendar_event`, same create values: `privacy='confidential'`, partners of participants), `_cyan_write_calendar_schedule` and its WebVue override, `_CALENDAR_IMPORT`, `_CALENDAR_OUTBOUND` (no inbound sync remains, D2). Keep the "Linked to Calendar event" `message_post`.
- [ ] **Step 3:** In `meeting_resolution.py` define `WebVueMeetingResolution` (`_name = 'webvue.meeting.resolution'`) merging Cyan `resolution.py`, `meeting_access.MeetingResolution`, `meeting_resolution.CyanMeetingResolution` (linked-task freeze) and `meeting_workspace.WebVueMeetingResolutionWorkspace`: `deadline` is `fields.Date(required=False, tracking=True, index=True)` with `execution_period = fields.Char(size=500)` and the either-or constraint, as today. Remove the D3 fields and methods. `_ESCALATION_DAYS_BY_PRIORITY` goes; `_INTERNAL_FIELDS`/`_SYSTEM_FIELDS` lose the removed names.
- [ ] **Step 4:** Move `WebVueMeetingMinutesVersion`, `WebVueMeetingEvent`, `_WORKSPACE_WRITE` and `workspace_write_context` to `meeting_record.py` with `meeting_id` → `'webvue.meeting.minute'`; move `_snapshot_person`, the minutes-form validator body and both `occurrence_key` closures (history and `_webvue_scope_meetings` share it) to `minutes_snapshot.py` as plain functions. Move both `res.users` extensions to `res_users.py`.
- [ ] **Step 5:** `models/__init__.py` imports, without the `isort: split` MRO comment: `entitlement_service, feature_registry, meeting_access_service, meeting_directory, meeting_links, meeting_mail_message, meeting_minute, meeting_notification_types, meeting_record, meeting_resolution, meeting_series, res_users`.
- [ ] **Step 6:** Verify no layering remains: `rg -n "_inherit = 'webvue.meeting.(minute|resolution)'" odoo-addons/webvue_meetings` → no output; `rg -n -i cyan odoo-addons/webvue_meetings/models` → only the two `Original author: Cyan` header lines.

### Task 2: Security, data, report, i18n, manifest and provenance

**Files:**
- Create: `webvue_meetings/data/meeting_sequence.xml`, `security/meeting_rules.xml`, `report/meeting_report.xml`, `i18n/ar.po`, `PROVENANCE.md`
- Modify: `__manifest__.py`, `security/ir.model.access-meetings.csv`, `security/meeting_capability_groups.xml`, `data/meeting_reminder_cron.xml`
- Delete: `security/meeting_access.xml`, `report/meeting_report_history_templates.xml`

**Interfaces:**
- Consumes: Task 1 model names.
- Produces: xml ids `webvue_meetings.sequence_meeting_minute`, `webvue_meetings.action_report_meeting_minutes`, `webvue_meetings.report_meeting_minutes`, `webvue_meetings.report_meeting_minutes_document`, rule ids `rule_meeting_company`, `rule_resolution_company`, `rule_meeting_user_read`, `rule_meeting_user_write`, `rule_meeting_manager_all`, `rule_resolution_user_read`, `rule_resolution_user_write`, `rule_resolution_manager_all`, `rule_meeting_capability_scope`, `rule_resolution_capability_scope` (same names as today so the migration's module move keeps them).

- [ ] **Step 1:** `__manifest__.py`: version `19.0.1.1.0`; `depends` = `webvue_api, webvue_platform, webvue_notify, webvue_directory, calendar, mail, web` (`web` for `web.external_layout` in the report); remove `cyan_meeting_minutes` and `pre_init_hook`; comment line names `calendar` (outbound event sync) and `web` (report layout). `data` order: `security/meeting_capability_groups.xml`, `data/meeting_access_permissions.xml`, `security/ir.model.access-meetings.csv`, `security/meeting_rules.xml`, `security/meeting_series_rules.xml`, `data/meeting_sequence.xml`, `data/meeting_reminder_cron.xml`, `report/meeting_report.xml`.
- [ ] **Step 2:** ACL csv gains `access_meeting_minute_read` (read group, 1,1,1,0), `access_meeting_minute_manage` (manage, 1,1,1,1), `access_meeting_resolution_read` (1,1,1,0), `access_meeting_resolution_manage` (1,1,1,1) — the Cyan user/manager rights on the capability groups (D1). Capability groups lose their `implied_ids` to Cyan groups.
- [ ] **Step 3:** `meeting_rules.xml` = Cyan's eight rules (same `noupdate` split, `model_webvue_meeting_minute`/`model_webvue_meeting_resolution`, groups retargeted) + the two global rules from `meeting_access.xml`.
- [ ] **Step 4:** `meeting_report.xml`: the paperformat `webvue_meeting_minutes_landscape`, the report action, `report_meeting_minutes` and one `report_meeting_minutes_document` that is Cyan's template with the history inheritance from `meeting_report_history_templates.xml` applied in place (no `inherit_id` left).
- [ ] **Step 5:** `i18n/ar.po`: copy Cyan's `ar.po`, replace `module: cyan_meeting_minutes` → `webvue_meetings`, `cyan_meeting_minutes.` → `webvue_meetings.`, `model_cyan_meeting_` → `model_webvue_meeting_`, `field_cyan_meeting_` → `field_webvue_meeting_`; delete entries whose only references are `ir.ui.view`, `ir.ui.menu`, `ir.actions.act_window`, the escalation cron, the privilege/groups or D3 fields. Check: `msgfmt -c -o /dev/null odoo-addons/webvue_meetings/i18n/ar.po` exits 0.
- [ ] **Step 6:** `PROVENANCE.md`: content of Cyan's PROVENANCE minus the obsolete cleanup/`user_admin` paragraphs, plus "Absorbed into webvue_meetings on 2026-10-16; models renamed `webvue.meeting.minute` / `webvue.meeting.resolution`; backend views, menus, calendar backend actions, escalation and activities removed." Sudo section lists only: the `group_cap_meetings_manage` user lookup for follower allow-lists.
- [ ] **Step 7:** Fresh install check (with Tasks 1–3 done): `-i "$MODULES"` on a new `webvue_absorb_fresh` DB loads without `ERROR`.

### Task 3: Rename callers in controllers, serializers, tests and the bridge

**Files:**
- Modify: `webvue_meetings/controllers/{meetings,meeting_attachments,meeting_workspace,meeting_series}.py`, `serializers/{meeting,meeting_notification}.py`, every `webvue_meetings/tests/test_*.py` naming Cyan, `webvue_meetings_pmo/models/{meeting_convert,meeting_project}.py`, `controllers/meeting_convert.py`, every `webvue_meetings_pmo/tests/test_*.py` naming Cyan, `webvue_meetings_pmo/tests/__init__.py`, `webvue_meetings_pmo/__manifest__.py`
- Create: `webvue_meetings_pmo/migrations/19.0.1.1.0/README.md`
- Delete: `webvue_meetings_pmo/tests/test_meetings_ownership_migration.py`, `webvue_pmo/migrations/19.0.1.4.0/` (D4)

**Interfaces:**
- Consumes: the Renames table.

- [ ] **Step 1:** Mechanical renames per the table (`'cyan.meeting.minute'`, `'cyan.meeting.resolution'`, `cyan_meeting_minutes.action_report_meeting_minutes`, `_cyan_is_manager` in `serializers/meeting.py:145`, group xml ids in `test_meeting_lifecycle.py:17`, `test_meetings_access_composition.py:60`, `test_resolution_convert.py:17`); the raw `UPDATE cyan_meeting_minute` in `test_meeting_history.py:204` → `webvue_meeting_minute`; rename bridge classes `CyanMeeting*` → `WebVueMeeting*`.
- [ ] **Step 2:** `test_meeting_lifecycle.py`: the two tests of the inbound calendar paths (`test_calendar_import_does_not_create_an_extra_event`, `test_calendar_origin_membership_keeps_secretary_and_no_stale_attendee`) are removed with D2; no other test changes behavior.
- [ ] **Step 3:** Bridge manifest version `19.0.1.1.0`; README: "The project_id field xml ids of webvue.meeting.minute/resolution are renamed by webvue_meetings 19.0.1.1.0 pre-migration, which runs first; this addon has no data step of its own."
- [ ] **Step 4:** `rg -n -i cyan odoo-addons/webvue_meetings odoo-addons/webvue_meetings_pmo odoo-addons/webvue_pmo` → only header attribution lines and `PROVENANCE.md`.
- [ ] **Step 5:** Run the suites on `webvue_absorb_fresh` (from `/Users/tariq/code/odoo`, `WT` = this worktree): `--test-tags /webvue_meetings,/webvue_meetings_pmo -u webvue_meetings,webvue_meetings_pmo --http-port=8179`. Expected: `0 failed, 0 error(s)`; test count = today's count minus the removed tests.

### Task 4: Port Cyan's tests

**Files:**
- Modify: `webvue_meetings/tests/common.py`, `tests/__init__.py`
- Create: `tests/test_meeting_rules.py` (from `test_meeting_security.py`), `test_meeting_resolution_rules.py` (from `test_resolution_security.py`), `test_meeting_guards.py` (from `test_bypass.py` + `test_calendar_security.py`), `test_meeting_workflow.py` (from `test_workflow.py`)

**Interfaces:**
- Produces: `WebVueMeetingRulesCase(TransactionCase)` tagged `('post_install', '-at_install', 'webvue')` with `organizer`, `secretary`, `attendee`, `outsider` (each `webvue_core.group_employee` + `webvue_meetings.group_cap_meetings_read` + `group_cap_meetings_create`), `manager` (`group_cap_meetings_manage`), `settings_admin` (`base.group_system` only), `other_user` in `company_other`, and the Cyan helpers for a draft meeting with a resolution.

- [ ] **Step 1:** Port every Cyan test with its assertions unchanged, model names renamed, except the tests of dropped features: `test_activity_note_does_not_include_minutes` (D3), `test_event_write_does_not_change_locked_meeting`, `test_event_owner_cannot_bypass_via_participants`, `test_context_flag_cannot_spoof_calendar_sync`, `test_search_read_event_does_not_leak_minutes`, `test_non_owner_cannot_create_minutes_from_event`, `test_open_minutes_requires_event_read`, `test_calendar_user_without_meeting_acl_does_not_crash` (D2). `test_cannot_delete_event_while_meeting_linked` stays and now expects the FK failure: `with self.assertRaises(IntegrityError), mute_logger('odoo.sql_db'): event.unlink(); self.env.flush_all()` inside a savepoint. `test_settings_admin_has_no_meeting_scope` stays: `base.group_system` alone reads no meeting.
- [ ] **Step 2:** Import the four files in `tests/__init__.py`; run as in Task 3 Step 5; all pass.

### Task 5: The in-place migration

**Files:**
- Create: `odoo-addons/webvue_meetings/migrations/19.0.1.1.0/pre-absorb_cyan_meeting_minutes.py`

**Interfaces:**
- Produces: `migrate(cr, version)`; module constants `MODELS = {'cyan.meeting.minute': 'webvue.meeting.minute', 'cyan.meeting.resolution': 'webvue.meeting.resolution'}`, `TABLES = {'cyan_meeting_minute': 'webvue_meeting_minute', 'cyan_meeting_resolution': 'webvue_meeting_resolution', 'cyan_meeting_attendee_rel': 'webvue_meeting_attendee_rel'}`, `SOURCE = 'cyan_meeting_minutes'`, `TARGET = 'webvue_meetings'`.

- [ ] **Step 1:** Write `migrate`, starting with `if not version: return`, then returning early when `cyan_meeting_minute` does not exist and `webvue_meeting_minute` does (idempotent). Raise `ValueError` with an operator instruction when both tables exist. Steps, in one transaction, all with parameterised SQL on WebVue-owned tables and Odoo metadata tables only:
  1. `ALTER TABLE ... RENAME TO` for `TABLES`; rename every `pg_class` sequence/index and every `pg_constraint` whose name starts with a `TABLES` key, replacing that prefix.
  2. `ir_model.model`, `ir_model_fields.model`, `ir_model_fields.relation`, `ir_model_fields.relation_table`, `ir_model_relation.name`, `ir_model_constraint.name` (prefix `cyan_meeting_`), `ir_sequence.code`, and every `varchar` column named `model`, `res_model`, `model_name` or `res_model_name` in `information_schema.columns` of schema `public` whose value is a `MODELS` key.
  3. `ir_model_data.name` (any module): prefixes `model_cyan_meeting_`, `field_cyan_meeting_`, `selection__cyan_meeting_`, `constraint_cyan_meeting_` → `webvue_meeting_` equivalents; then `module = TARGET` where `module = SOURCE`, raising on a `(module, name)` clash with different `(model, res_id)` and deleting an exact duplicate (pattern of today's `hooks.py`).
  4. D1: log at INFO the logins that are direct members of the old `group_meeting_user`/`group_meeting_manager` without the matching capability group (they lose meeting access by design; on `odoo19` the expected list is empty or the admin only). Then delete the two old groups (their `res_groups_users_rel` and `res_groups_implied_rel` rows go by cascade), their `ir_model_data` rows and `privilege_meeting_minutes`.
  5. Remove the module: delete `ir_module_module_dependency` rows with `name = SOURCE`, the `ir_model_data` row `base.module_cyan_meeting_minutes`, and the `ir_module_module` row `name = SOURCE`.
  Views, menus, window actions, the escalation cron and D3 fields keep their (now `webvue_meetings`) xml ids and are removed by Odoo's obsolete-record cleanup at the end of the `webvue_meetings` update; D3 columns are dropped by the same cleanup.
- [ ] **Step 2:** `python3 -B tools/git_policy.py --base main` accepts the bump with its migration directory.

### Task 6: Upgrade proof from current `main` data

**Files:** none in the repo; scripts and logs live in the shared notes folder.

- [ ] **Step 1:** Build `webvue_absorb_upgrade`: `git worktree add` a detached checkout of `main` (`67902a05`) under the scratchpad; `-i "$MODULES"` with that checkout's addons path; seed through `odoo-bin shell` one series with two meetings, two recommendations (one with deadline, one with `execution_period`), a chatter message with an attachment, a follower, a bell row, one completed meeting with a history snapshot and a minutes version, and a converted task through the bridge. Dump `serializers.meeting.dump_meeting(...)` and `dump_resolution(...)` for every meeting/recommendation as the admin and as an attendee to `before.json`.
- [ ] **Step 2:** Run with this worktree's addons path: `-u webvue_meetings,webvue_meetings_pmo -d webvue_absorb_upgrade --stop-after-init --logfile upgrade.log`; `python3 -B tools/upgrade_log_guard.py upgrade.log` → exit 0.
- [ ] **Step 3:** Dump again to `after.json`; `diff before.json after.json` → empty except `reference`-free volatile keys (none expected).
- [ ] **Step 4:** Assertions, by SQL: no row in `ir_module_module` named `cyan_meeting_minutes`; no `ir_model_data` row with module or name containing `cyan`; no table, index, sequence or constraint name starting `cyan_`; no value `cyan.meeting.%` in any `varchar`/`text` column of `public`; no `res_groups` row for the old groups; the column sets of `webvue_meeting_minute` and `webvue_meeting_resolution` equal those of a fresh install (`webvue_absorb_fresh`).
- [ ] **Step 5:** Run the `webvue_meetings` and `webvue_meetings_pmo` suites on the upgraded DB; all pass.

### Task 7: Remove Cyan, tools and docs

**Files:**
- Delete: `odoo-addons/cyan_meeting_minutes/`
- Modify: `tools/arch_layers.json` (`exempt` → `["webvue_registry_probe"]`; shrinking `exempt` is a tightening, no approval trailer), `tools/arch_policy.py:30` (`STATIC_APP_TOKENS = ('project',)` and the comment at :494), `tools/test_arch_policy.py:260-268` (drop the `cyan_meeting_minutes.x` fragment; expected counts 1 and 2), `tools/test_odoo_test.py:100-108` (fixture `cyan_like` → `engine_like`), `AGENTS.md` (sudo sentence for `webvue_meetings`: add nothing — the Cyan calendar sudo cases are gone; the meeting-manager group lookup is already listed), `docs/agents/odoo-rules.md:120` (meetings depend on `webvue_platform`, `webvue_notify`, `webvue_directory`, `calendar`, `mail`, `web`), `docs/agents/repository-layout.md:54-58` (drop the Cyan engine line; `webvue_meetings` owns the meeting and recommendation models), `apps/web/PRODUCT.md:63` ("Meetings are the `webvue_meetings` application"), `docs/migrations.md` step 5 (D4).

- [ ] **Step 1:** Apply the edits; `rg -n -i "cyan" --hidden -g '!.git' -g '!node_modules' -g '!docs/archive/**' -g '!docs/reports/**' -g '!docs/consolidation/**' -g '!docs/verification/**' -g '!docs/approvals/**' -g '!docs/superpowers/**' -g '!docs/project-closure/**' .` → only `webvue_meetings/PROVENANCE.md`, the attribution header lines and `tools/ui_policy.py:316` (Tailwind colour).
- [ ] **Step 2:** `python3 -B tools/arch_policy.py --write-baseline` (R7 total must not grow), then `python3 -B tools/arch_policy.py --base main` and `python3 -B tools/git_policy.py --base main` → pass; `python3 -B tools/catalog_check.py --release-modules` lists no `cyan`.
- [ ] **Step 3:** `npm test` (Node 22) → pass; `ruff check odoo-addons` → no new findings.

### Task 8: Review and hand-off

- [ ] **Step 1:** Full fresh run: drop and recreate `webvue_absorb_fresh`, `-i "$MODULES" --test-tags "$TAGS"` (all release modules) → `0 failed, 0 error(s)`.
- [ ] **Step 2:** `odoo-reviewer` agent on `git diff main...HEAD` with this plan; Jev run (`tools/jev_review.mjs` if present) and report its scores; fix blocking findings.
- [ ] **Step 3:** Report to the owner in Arabic with fresh evidence; commit only after authorization, as separate commits: `refactor(meetings): absorb cyan meeting engine into webvue_meetings` (Tasks 1–5, with both version bumps and migrations) and `chore(tools): drop cyan_meeting_minutes from policy and docs` (Task 7). Remove scratch DBs and the temporary `main` worktree.

## Execution notes

- Writers: Task 1 + 2 + 5 = one Sonnet worker (all of `webvue_meetings` models/data/security/report/i18n/migrations). Task 3 + 4 = a second Sonnet worker, started after Task 1's Interfaces exist (it touches only controllers, serializers, tests and the bridge). Task 7 = a third Sonnet worker in parallel (tools/docs only). Task 6 and 8 run by the orchestrator.
- Out of scope, reported as follow-ups: `webvue_pmo/migrations/19.0.1.1.0`–`19.0.1.3.0` also exist only for the `release/19.0.1.0.0` upgrade path; translating `webvue_meetings`' own `self.env._()` messages into `ar.po`; folding the two bridge `webvue.meeting.resolution` extensions of `webvue_meetings_pmo` into one file.
