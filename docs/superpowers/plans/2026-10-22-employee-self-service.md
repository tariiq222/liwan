# Employee Self-service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Checkboxes track acceptance, not commits. The user does not authorize commits.

**Goal:** One employee-owned Self-service destination with the approved contents and separation from administrative work.

**Architecture:** Foundation aggregates permission-filtered personal contributions from application manifests. Application-owned pages retain their physical ownership but use canonical `/account/*` URLs. HR resolves own employee; operations classifies employee service requests explicitly; the documents–HR bridge links personal documents to employees.

**Tech Stack:** Nuxt/Vue, existing shared UI, Vue Query, zod contracts, Odoo 19.

**Spec:** `docs/superpowers/specs/2026-10-22-employee-self-service.md`.

## Global Constraints

- Preserve existing dirty files, no commits/push/merges/deployments. One writer per path, isolated worker checkout from the integration branch.
- Arabic first, existing DESIGN.md components, ordinary capability/current-company/record guards, no new sudo, no fake product data.
- Parent owns shared manifest interfaces, shell, shared locales, generated inventory/API artifacts and all runtime/integrated checks.
- Native GPT-6.1 Sol only for workers/reviewers. Unknown whole-task token attribution stays unknown.

## Package ownership and order

- Backend package: `odoo-addons/webvue_hr`, `odoo-addons/webvue_operations`, `odoo-addons/webvue_documents_hr`, `packages/contracts/src/hr`, `packages/contracts/src/operations`, and related contract tests. One worker; no unrelated addon edits or shared barrel edits without parent coordination.
- HR frontend package: a second worker owns HR pages/components/module, HR leave/shift/profile composables and HR locale namespace in a separate worktree. It consumes the personal manifest interface and HR APIs below. Parent supplies shared interface changes; workers never edit them.
- Frontend integration package: parent owns operations/documents pages/composables/manifests, account foundation/shell, shared tests/stories/locales/docs. It consumes the fixed contracts below while backend and HR frontend work independently.
- Verification: after actual patches are inspected and applied without committing, coordinator runs integrated checks and a fresh read-only reviewer checks changed source/authorization boundaries. No shared runtime is started by workers.

## Interfaces

- `GET /api/v1/hr/me`: nullable existing `HrEmployeeSchema`, own current-company employee, include_access/include_contract false; no payroll values. Capability `hr.employees.read`, feature `hr.enabled`.
- `GET /api/v1/hr/leave/me/<int:leave_id>`: existing leave detail shape, strictly caller-owned employee in current company, non-owned ID 404. Standard leave read feature/capability gates.
- Operations process and request wire shapes gain required `purpose: 'work' | 'employee'`; process create/configure accepts it, request create never accepts caller control of it. Request snapshots purpose. Lists accept optional purpose, reject invalid values. Work lists use work; account lists use employee + mine. Reconfiguration cannot silently move submitted requests between purposes.
- `GET /api/v1/documents/employee/me` and `GET /api/v1/documents/employee/me/<int:document_id>`: existing document list/detail shapes, explicit own employee linkage plus existing document access. Bridge-owned, gated on documents+HR and own employee access; no employee_id selector accepted from the caller. Detail of a non-owned record is 404.
- Documents–HR registers `hr.employee` context and a single employee relationship, preserving department contexts. Context assignment requires HR management and document mutation authority; personal files cannot become company-public through this context. Reuse existing restricted grants; do not broaden arbitrary employee-document access.
- Foundation `AppPersonalEntry`: `section` is profile/leave/requests/pay/assets/documents/schedule; standard service id/labelKey/descriptionKey/icon/to/capability, optional feature/requiredCapabilities, primaryAction, summary `{queryKey, load(api,t) -> {value?, caption?, rows?, attention?}}`. AppManifest.personal registers contributions. No owning application names in foundation.

## Review Focus

- HR staff opening own links must not inherit management list scope or another employee ID.
- Company switch/logout and cached summaries must not retain another identity's private information.
- A self-service document context must not expose a salary contract through company visibility or guessed detail/download IDs.
- Changing a process purpose must not reclassify submitted requests or enable caller-forged ownership/purpose.
- Missing employee/sub-feature and stale personal routes must produce useful, permitted navigation on mobile and direct URL entry.

### Task 1: Own employee, personal request and document contracts

**Files:** backend package above, application-owned serializers/controllers/models/tests and schema/version migration files only.
**Consumes:** existing authorization, employee relations, operations snapshots, managed document context/grant extension points.
**Produces:** interfaces above and a changed-files/focused-verification report.

- [x] Read odoo-workflow and odoo-19; record source-backed Context Brief before edits.
- [x] Write focused tests for own/current-company/no-employee profile; purpose filtering, immutable snapshot, forged context; document owner/other user/other company/restricted visibility and grant behavior.
- [x] Backend worker runs the new focused Odoo tests against its own isolated scratch database and records expected missing-feature failures before production edits; coordinator owns the integrated run and live runtime.
- [x] Implement narrow extension points and zod schemas. Add required schema version/migrations, no parallel old schema. Preserve existing callers with intentional updates, not compatibility copies.
- [x] Run worker-owned focused contracts/static checks. Coordinator runs affected Odoo addon tests at integration; failures block acceptance.

### Task 2: Canonical personal navigation and settings

**Files:** `apps/web/app/modules/types.ts`, account/nav composables and tests, shell account button/sidebar integration, `pages/account/index.vue`, `pages/account/settings.vue`, account components/stories, shared locale keys. Remove superseded `pages/account.vue` and `/services` page/component after consumers move.
**Consumes:** manifest personal entries; existing appearance/password/logout behavior.
**Produces:** stable permitted section navigation, summary renderer, account actions and settings persistence.

- [x] Test manifest contribution filtering (missing feature/capability), account active module behavior and canonical URLs; verify expected failure.
- [x] Add interfaces and permission filter, settings/overview foundation, scoped reorder persistence, and context/sidebar integration; move existing account controls without losing hydration guards.
- [x] Update entry-point tests/stories and remove stale services consumers. Run focused account/navigation tests; expected exit 0.

### Task 3: Application-owned personal pages

**Files:** HR/operations/documents pages/components/composables/manifests/locales/tests; HR route helper; related Storybook stories.
**Consumes:** Tasks 1–2 interfaces; existing leave/assets/payslip/schedule APIs.
**Produces:** profile, own leave/request/create/details, pay/assets/documents/schedule destinations and summaries.

- [x] Write behavior regressions for own-only HR view, management leave capability variants, request purpose filtering and removed old personal links; verify failure.
- [x] Move existing own pages to account paths, reuse application components, split own/admin leave behavior, implement profile and schedule states, personal operations catalog/list/detail routes, and own document pages.
- [x] Personal requests include links to the same own leave requests; avoid duplicated request records. Human-readable status/actions follow actual backend fields.
- [x] Implement application summaries and process-purpose selection in operations settings. Preserve permission gates and direct/back routes.
- [x] Run focused affected frontend tests and contracts; expected exit 0.

### Task 4: Integrated acceptance

**Files:** affected documentation/catalog/API artifacts, scoped E2E coverage and evidence only.

- [x] Refresh generated API/UI inventories using repository commands; no policy/baseline weakening.
- [x] Run web type check, contracts, relevant policy checks, affected Odoo tests; then one integrated test batch.
- [x] Inspect live account entry, each enabled personal route, refresh/Back, RTL/LTR, desktop/mobile and feature/role restrictions in isolated runtime.
- [x] Independent read-only review of actual diff, fix material issues with regressions, record fresh evidence and any unavailable domain coverage. Leave all source changes uncommitted for the owner.

Acceptance evidence: `.superpowers/sdd/2026-10-22-employee-self-service/acceptance.md`. Role/ownership coverage combines unit/Odoo fixtures with live empty-state account navigation; all-role populated browser coverage and production deployment are not claimed.

## Subsequent delivery authorization

On 2026-10-22 the owner requested a local commit of the completed work. This supersedes the earlier no-commit boundary for this delivery only. Push, merge, deployment and cleanup remain outside this authorization.
