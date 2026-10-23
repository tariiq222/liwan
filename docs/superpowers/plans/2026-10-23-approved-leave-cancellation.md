# Approved-leave Cancellation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Existing authorization covers implementation; the coordinator owns integrated checks and protected delivery.

**Goal:** Deliver configurable employee cancellation of approved leave, defaulting to an audited manager approval that retains native cancellation effects.

**Architecture:** `webvue_hr` owns company settings and one tracked cancellation aggregate per native leave. Narrow public wizard/write guards enforce policy; a protected transaction-local bridge executes the unchanged native owner wizard after manager authorization. Nuxt uses strict shared contracts and existing HR pages/components.

**Tech Stack:** Odoo 19 Community, PostgreSQL repeatable read, Nuxt 4/Vue 3, Zod, TanStack Query, Vitest, Storybook and Playwright.

**Spec:** `docs/superpowers/specs/2026-10-23-approved-leave-cancellation-design.md` (including its source-grounded Context Brief).

## Global Constraints

- Policies: `manager_approval` (default even with no saved row), `direct_employee`, `manager_only`.
- No new addon, private native/access override, raw SQL, new sudo, copied engine body or architecture baseline growth. Native source is read-only.
- Manager means existing company-scoped `hr.leave.approve` plus native visibility, not an assigned-person hierarchy; `hr.leave.manage` alone grants no decision authority. No self decision.
- Native cancellation runs as the active ordinary employee owner, with current request capability and a single owning company; preserve native date/work-entry vetoes and side effects.
- Owner business choices are fixed. The native bridge, audit identity and manager-only direct path are coordinator implementation decisions documented in the spec.
- Bump `webvue_hr` `19.0.1.8.0` → `19.0.1.9.0`; use fresh scratch databases only, never `odoo19` or a live database.
- Preserve unrelated changes. Coordinator owns shared/generated files and all runtime; no deployment or real database upgrade is authorized.
- All write responses return the complete strict detail. Keep `{items, total}`, Arabic/English, RTL, direct links, refresh/back and inline confirmation under DESIGN.md.

## Review Focus

- Historical approved aggregate or forged context must never authorize a second native cancellation (Task 2 token-replay test).
- Manager permission plus owner deactivation/revocation/past date/validated work entries must fail closed without consuming approval (Task 2 eligibility tests).
- Manager-only direct initiation must name the real initiator and never manufacture an employee submission (Tasks 2 and 4 audit tests).
- A native edit or simultaneous request/decision must never leave a ghost pending request or duplicate work-entry effect (Task 3 cursor/HTTP tests).
- Settings-only custom roles must open/save leave settings with no employee, leave-balance or payroll requests (Task 5 settings isolation tests).

## Packages, Ownership and Order

Decision: **inline**, because security, policy and native transaction semantics are coupled. Backend/strict contracts precede UI; no independent runtime/test workers. If the coordinator later delegates, use isolated worktrees and non-overlapping ownership, native `gpt-6.1-sol` at high for backend/review and medium for UI, with this spec/plan as the interface. No worker children.

| Package | Owned files/responsibility | Prerequisite |
| --- | --- | --- |
| Settings and audit model | HR models/security/data/migration/tests | Existing worktree and instructions |
| Native execution/API | HR models/wizard/controller/serializer/tests; strict HR contracts | Settings/model interface |
| Personal/admin interface | HR composables/components/pages/stories/locale/preview fixtures | Strict backend contract |
| Settings interface | HR settings form/composable/manifest/settings page/stories/tests | Settings contract |
| Integration | API/catalog generated files, shared checks, scratch/browser runtime, delivery | All product packages |

All paths below are repository-relative. Read `AGENTS.md`, `docs/agents/odoo-rules.md`, `docs/agents/web-rules.md`, `DESIGN.md`, and `docs/parallel-work.md` before implementing their layer. Record the coordinator measurement baseline/participants under the existing routing receipt; any late/missing attribution remains unknown.

### Task 1: Company policy and protected audit aggregate

**Files:** Create `odoo-addons/webvue_hr/models/leave_settings.py`, `models/leave_cancellation.py`, `security/hr_leave_rules.xml`, `tests/test_leave_cancellation_model.py`, `tests/test_leave_settings.py`; modify `models/__init__.py`, `models/access_service.py`, `security/hr_capability_groups.xml`, `security/ir.model.access.csv`, `data/hr_access_permissions.xml`, `__manifest__.py`, `tests/__init__.py`; create `migrations/19.0.1.9.0/post-leave_policy.py` (or README if no data repair is needed).

**Interfaces:** Settings `_webvue_effective_policy(company) -> str` reads the effective value under owning-company policy without requiring settings capability or inserting defaults; configuration actions separately require `hr.leave.config`. Grant company-scoped model read to `hr.leave.read` or `hr.leave.config`, and writes only to config. Aggregate model-level `action_request(leave_id: int, reason: str = '') -> cancellation` works even without an existing aggregate; record actions `action_approve(revision: int, reason: str = '') -> cancellation`, `action_refuse(revision: int, reason: str) -> cancellation`; model-level `action_direct_cancel(leave_id: int, reason: str = '', revision: int | None = None) -> cancellation`. Every action rechecks actor/company/native visibility, including direct read of aggregates after employee-account reassignment. Private transitions perform writes without exposing a forgeable context flag; public direct create/write/unlink reject protected field forgery.

- [ ] Write failing model tests: `test_default_policy_does_not_create_row` asserts `manager_approval`, zero saved rows; `test_config_only_role_has_no_hr_reads` proves configuration without employee/payroll access; `test_policy_company_and_revision_fences` checks foreign company and stale revision; `test_aggregate_orm_cannot_forge_decision` rejects reviewer/state/company/requester/version/revision forgery and unlink.
- [ ] Convert `tests/__init__.py` to the required `import_all_tests(__name__)` helper and run the focused module suite via coordinator scratch command `npm run test:odoo -- --addons webvue_hr --no-dependents`; require nonzero count and the expected new-test failures. Confirm existing and new tests load; leave none unimported.
- [ ] Implement settings selection/revision with company uniqueness, positive saved revision and read-only default revision 0. Register `hr.leave.config` with no employee/payroll dependencies, seed the customer HR manager role and migrate grants idempotently. Preserve the existing core vendor-support all-catalog operator policy with matching HR-owned config ACL/group links; ordinary system administrators and customer custom roles gain no implicit grant. Add no HR-specific capability evaluator.
- [ ] Implement tracked aggregate fields from the spec with `models.Constraint('UNIQUE(leave_id)', ...)`, positive revision, restrictive leave relation, derived company/requester and protected initiator/reviewer. `mail.thread` tracks request/decision/version/revision fields; explicit events preserve repeated equal values. Reject empty refusal reason; resubmission after refusal resets current decision fields and advances revision while preserving tracked history.
- [ ] Add `test_refusal_resubmission_preserves_events`: original request/reason, refusal reviewer/reason and new request all remain in native tracking/messages after reuse of the same aggregate id. Add own/approver/company/revoked-capability ACL/record-rule tests; ordinary native officer/balance manager cannot decide without current `hr.leave.approve`.
- [ ] Run focused scratch tests and `ruff check odoo-addons/webvue_hr`; expect zero failures, nonzero Odoo tests and no architecture-baseline growth. Commit this independently testable model/migration batch only through the coordinator's authorized commit flow.

### Task 2: Native execution bridge and public ORM fences

**Files:** Create `odoo-addons/webvue_hr/models/hr_leave.py`, `wizard/__init__.py`, `wizard/hr_holidays_cancel_leave.py`, `tests/test_leave_cancellation_native.py`; modify `__init__.py`, `models/__init__.py`, `models/leave_cancellation.py`. Reuse `webvue_core.models.protected_write` without editing shared core.

**Interfaces:** Private aggregate `_webvue_execute_native() -> None` operates on one already authorized approved aggregate; public wizard `action_cancel_leave() -> dict` authorizes policy then delegates once to `super()`. Public native `hr.leave.write(vals) -> bool` rejects non-superuser raw `state='cancel'`. HR-owned cursor marker binds aggregate id/approved revision and is active only inside `_webvue_execute_native`; it is never an HTTP field/context token.

- [ ] Write failing tests: `test_manager_approval_runs_owner_wizard_and_real_manager_audit` asserts native `cancel`, ordinary owner actor in wizard, reviewer/initiator real ids, correct native reason; `test_pending_retains_state_balance_and_work_entries` asserts native `validate` and unchanged balances/resource/work entries before decision.
- [ ] Run focused scratch suite with the Task 1 command; expect new behavior tests to fail before implementation, never bypass native eligibility in the fixture.
- [ ] Implement manager authorization and CAS revision/version checks. Record approved state/reviewer transactionally; recheck active linked owner, owning-company access, `hr.leave.request`, owner/native read and `can_cancel` using `with_user(owner).with_context(allowed_company_ids=[company.id])`. Reject `env.is_superuser()` after switching. Preserve exact native version; no native writes before the stale check.
- [ ] Issue the cursor-local marker with `protected_write.marked` only after all authorization. Require it plus the approved aggregate's exact leave/requester/reviewer/company/version/revision in the fresh owner wizard. Include real manager id/name and both reasons in native reason, escape through native APIs, then call the unchanged wizard chain. Restore marker in all cases; exceptions roll back the full decision and effects.
- [ ] Implement public wizard policy guard for direct native ORM calls and public write fence, retaining native internal superuser operations. Direct own fully approved cancellation requires `direct_employee` and no pending aggregate. A pending aggregate always blocks unmarked cancellation; existing own non-approved cancellable states without pending aggregate retain stock behavior. No `_compute_can_cancel`, `_check_approval_update`, `_action_user_cancel`, `_force_cancel` or access override.
- [ ] Implement manager direct cancellation under all policies: current approver, other employee, native owner eligibility, optional existing aggregate. Require pending revision when resolving a pending request; create/reuse audit aggregate otherwise with actual manager initiator/reviewer. `manager_only` hides employee action; missing ordinary active linked owner fails with actionable error. No self decision even for HR managers.
- [ ] Add `test_native_wizard_and_raw_write_cannot_bypass_policy`, `test_historical_approval_and_context_cannot_issue_marker`, `test_native_failure_rolls_back_approval_and_chatter`, `test_manager_only_direct_has_real_initiator`, `test_balance_manager_cannot_direct_cancel`, `test_owner_role_company_or_active_revocation_blocks_execution`, `test_past_date_and_validated_work_entry_veto_remain_native`. Assert native balance/resource/work-entry results once after successful cancellation and unchanged on failure. Test validated-work-entry veto through installed native extension, not a fake boolean.
- [ ] Run focused scratch suite plus `python3 -B tools/arch_policy.py` and Ruff; expect nonzero tests, zero failures and no new sudo/private override/baseline. Coordinator reviews actual native-hook diff before committing.

### Task 3: HTTP, strict contracts and concurrency

**Files:** Modify `odoo-addons/webvue_hr/controllers/hr_leave.py`, `serializers/hr_leave.py`, `tests/test_hr_leave.py`, `packages/contracts/src/hr/index.ts`, `packages/contracts/src/hr/__tests__/schemas.test.ts`; create `odoo-addons/webvue_hr/tests/test_leave_cancellation_http.py`, `tests/test_leave_cancellation_concurrency.py`.

**Interfaces:** Settings GET/PATCH `/api/v1/hr/leave/settings` returns `{cancellation_policy, revision}`; PATCH requires both keys and revision ≥0. `/requests/:id/cancel` accepts `{reason?, revision?}` and routes own submission/direct or authorized manager direct; withdrawal envelope stays unchanged. `/cancellation/approve` accepts `{revision, reason?}` and `/refuse` `{revision, reason}`. `HrLeaveSchema.cancellation` is nullable `{id,state,revision,reason,requested_at,initiator,reviewed_at,reviewer,review_reason}`; actor refs use existing `{id,name}` user ref shape. Add policy enum and strict settings/action schemas/types. Add the four cancellation flags/fields exactly as the spec. Internal `leave_version`/marker never serialize.

- [ ] Write failing HTTP/schema tests asserting 403/404/422/409 status/code boundaries, unknown field/filter rejection, required decision revision, no own decisions, settings-only access, strict full response shape and all three policy responses.
- [ ] Implement thin controller routing to Task 1/2 actions, strict parsers and current-company searches. Add `cancellation_state=pending` list filter independent of native state and strict invalid-value rejection. Cancellation queue never includes another company's aggregate; guard every new route by feature/capability and update explicit route allowlists only if justified.
- [ ] Implement serializers using native owner eligibility in an ordinary owner environment for manager actions, explicit current manager capability, own/pending/policy restrictions and whitelisted refs. Own personal views never advertise manager approval/refusal. Batch page aggregate reads to avoid one search per leave. Recheck permission on actions; flags are no authorization token.
- [ ] Add independent-cursor tests `test_concurrent_submission_has_one_pending_aggregate`, `test_racing_decisions_have_one_effect`, `test_native_edit_racing_approval_conflicts`, `test_stale_approval_can_be_refused_and_resubmitted`, `test_policy_change_preserves_pending_decision`. Require unique aggregate id, one final revision/decision, real 409 for stale requests, no duplicate work-entry effect and no ghost pending after manager direct cancellation. Exercise actual repeatable-read retry behavior; do not swallow a unique/serialization error and then read from the stale snapshot. Refusal may resolve a stale native version.
- [ ] Run focused scratch suite plus `npm -w packages/contracts run test -- src/hr/__tests__/schemas.test.ts` and `python3 -B tools/route_gate_policy.py`; expect all new cases passing. Coordinator reviews/commits backend+contract batch together; generated API files wait for Task 6.

### Task 4: Personal and administrator cancellation journeys

**Files:** Modify `apps/web/app/composables/useHrLeave.ts`, `useHrLeaveFormat.ts`, `components/hr/LeaveList.vue`, `LeaveRecord.vue`, `LeaveDecisionConfirm.vue`, `pages/hr/self/leave.vue`, `pages/hr/self/leave/[leaveId].vue`, `pages/hr/leave.vue`, `pages/hr/leave/[leaveId].vue`, owning `i18n/locales/{ar,en}/hr.json`, HR stories/fixtures and preview fixtures. Tests: existing `pages/hr/__tests__/self-service-leave*.test.ts`, new `composables/__tests__/useHrLeave.test.ts`, `components/hr/__tests__/leave-cancellation.test.ts`; update `apps/web/e2e/hr-leave.spec.ts`, `e2e/self-service.spec.ts` and every discovered strict leave fixture.

**Interfaces:** Extend `HrLeaveListParams` with optional `cancellation_state: 'pending'`; add `useCancellationDecision()` accepting `{id, decision:'approve'|'refuse', revision, reason?}`. Extend `useLeaveDecision` cancel payload with optional revision for manager pending resolution; all successful writes invalidate `hrLeaveKeys.all`. Existing personal identity query scope and own endpoint remain intact. Inline confirm kinds add request/approve/refuse cancellation while preserving withdrawal semantics.

- [ ] Write failing tests: `test_personal_approved_leave_requests_cancellation` sends reason and retains approved state/pending badge; `test_personal_manager_never_sees_decision_actions` hides them even for an approver; `test_admin_cancellation_filter_round_trips_url` retains filter and excludes initial-approval-only state filter; `test_decision_sends_revision_and_requires_refusal_reason` prevents blank refusal and refreshes 409 with reload feedback.
- [ ] Implement action labels from policy/server flags, current request/decision/initiator status and reasons, inline confirmation, pending/error guards and fresh server response rendering. Manager direct initiation is labelled explicitly. Preserve personal create/withdraw behavior; no optimistic cancellation state. Admin queue uses `cancellation_state=pending` and badges, with approve/refuse actions only on authorized items.
- [ ] Add Arabic/English messages and stories for approved/requestable, pending, refused/resubmitted, manager-only, direct employee, manager direct, stale conflict and forbidden states. Update real serializers, preview mocks, module tests and stories together; add no schema defaults to conceal missing fixture fields.
- [ ] Run `npm -w apps/web run test -- app/pages/hr/__tests__/self-service-leave.test.ts app/pages/hr/__tests__/self-service-leave-record.test.ts app/composables/__tests__/useHrLeave.test.ts app/components/hr/__tests__/leave-cancellation.test.ts app/utils/__tests__/hrPreviewFixtures.test.mjs`; expect passing actions/query keys/schema fixtures. Review actual UI diff and commit focused interface batch.

### Task 5: Capability-scoped leave settings

**Files:** Create `apps/web/app/composables/useHrLeaveSettings.ts`, `components/hr/LeaveSettingsForm.vue`, `stories/hr/LeaveSettingsForm.stories.ts`, `composables/__tests__/useHrLeaveSettings.test.ts`, `components/hr/__tests__/leave-settings-form.test.ts`, `pages/__tests__/hrLeaveSettings.test.ts`; modify `app/modules/hr/manifest.ts`, `app/pages/settings/apps/hr/index.vue`, owning Arabic/English HR locale keys and relevant manifest/settings tests.

**Interfaces:** `useHrLeaveSettings(enabled)` queries the strict settings schema; `useSaveHrLeaveSettings()` PATCHes `{cancellation_policy,revision}`. `LeaveSettingsForm` takes `{settings,canEdit,reloadSettings: () => Promise<HrLeaveSettings>}`. Await a successful fresh reload before resetting draft/conflict; preserve the mounted cached form and its draft through a failed or delayed GET. The earlier shift form emitted reload too early; do not copy that defect. HR manifest settings part id `leave`, capability `hr.leave.config`, label in `hr.leaveSettings` namespace.

- [ ] Write failing tests for all three options, default revision 0, preserved dirty draft after failed save, 409 explicit reload, and settings-only role opening directly with no employee/balance/payroll calls.
- [ ] Implement section with existing shared settings/form/page-state primitives and meaningful Arabic/English descriptions. On PATCH success capture the original identity key, cancel an older in-flight GET for that exact key, recheck current identity after cancellation, and cache the full write response before marking other leave queries stale; saving must not depend on an additional GET. Test the controlled old-GET-after-PATCH race using actual QueryClient behavior. Enable query only when the leave settings part is visible. Audit existing payroll/leave-type hooks on the settings page and gate them by their existing capabilities/sections so this new settings-only route performs no unauthorized unrelated reads.
- [ ] Add Storybook normal/saving/error/conflict and settings-only states. Run `npm -w apps/web run test -- app/composables/__tests__/useHrLeaveSettings.test.ts app/components/hr/__tests__/leave-settings-form.test.ts app/pages/__tests__/hrLeaveSettings.test.ts app/composables/nav/__tests__/settingsSections.test.ts`; expect passing tests. Review/commit settings interface batch.

### Task 6: Coordinator integration and acceptance

**Files:** Coordinator owns `docs/api/openapi.json`, `docs/api/route-capabilities.json`, `docs/design-system/catalog.json` regeneration and acceptance evidence. No application worker edits these files. Preserve the unrelated generated changes already present in this worktree until integration.

- [ ] Review actual combined diff against this spec, confirm only narrow public native hooks, no extra privilege/scope, no stale alternate path/unused fields/locale keys, and fresh role/migration behavior. Run independent Sol review using the requesting-code-review workflow; repair actionable findings before broad checks.
- [ ] Regenerate only through current repository commands: `python3 -B tools/api_surface.py`, `node tools/ui_catalog.mjs`; verify `python3 -B tools/api_surface.py --check`, `node tools/ui_catalog.mjs --check`, `python3 -B tools/arch_policy.py`, `python3 -B tools/route_gate_policy.py`, and `ruff check odoo-addons`.
- [ ] Run integrated `npm test`, `npm run lint`, `npm run build`, and `npm -w apps/web run build-storybook` once after integration. Require passing type/build/contracts/UI checks; rerun only affected checks after a repair.
- [ ] Run a fresh all-release scratch install, selected worktree addons path and nonzero tests with the documented `docs/agents/odoo-rules.md` Check commands / `deploy/ci/odoo.sh` shape, plus focused concurrency/HTTP cases. The template-clone helper alone does not establish fresh-install acceptance. Verify install and isolated upgrade to `19.0.1.9.0` including role data; retain logs/counts and clean only task-owned scratch resources.
- [ ] Using a coordinator-owned isolated scratch/backend/browser runtime, run `npm -w apps/web run test:e2e -- e2e/hr-leave.spec.ts e2e/self-service.spec.ts` with its explicit base URL. Add/execute settings journey in that HR suite: default request→manager approval, refusal→resubmission, direct employee, manager-only direct manager action, stale 409/reload and permission isolation. Exercise Arabic/English, 390px RTL plus desktop, keyboard, direct-link/refresh/back and retained cancellation filter. Record backend/native outcomes separately from preview coverage.
- [ ] Use verification-before-completion; attach exact commands/results, Odoo nonzero counts, browser journeys, native balance/work-entry/audit evidence and material unverified limits to the routing receipt/acceptance record. A worker report or this plan is not acceptance.
- [ ] Commit integrated/generated outputs as authorized; follow `docs/agents/integration-rules.md` for protected draft PR, current-head CI/review and sensitive-change exact-head owner approval. No direct push to main, merge bypass, real database upgrade or deployment. Report current branch/PR/CI truth and any required owner action concisely.
