# Phase 3b — Reconciled Execution Handoff

> UI authority update — 2026-09-07: [DESIGN.md](../../../DESIGN.md) supersedes this document's customer-UI appearance, component and navigation prescriptions wherever they conflict. Preserve historical implementation/verification evidence and still-valid API, permission, business and delivery contracts. This document is not a second theme source.

This handoff replaces the pre-reorganization phase-3b execution brief. Read in
this order:

1. `docs/superpowers/specs/2026-09-05-nasq-phase-3b-people-branding-design.md`
2. `docs/superpowers/plans/2026-09-05-nasq-phase-3b-people-branding.md`
3. `CLAUDE.md` and `docs/parallel-work.md`

## Delivery result — 2026-09-05

The plan is complete on the local `codex/phase-3b` worktree. All T1–T9
packages passed focused review and T10 passed its integrated gate: Odoo
aggregate `182`, contracts `52`, web unit `152`, and Playwright `47`, with
clean `ruff`, `vue-tsc`, production build, and preservation checks. The live
browser gate includes effective role demotion, old-session reset/revoke
invalidation, current-session password continuity, credential-field cleanup,
branding preview/save/reload, and preserved HR documents.

Two legacy PMO UI races found by the full gate were corrected: project rows
now keep stable project-id keys and render a deterministic pre-hydration
skeleton, while query-driven task table/board surfaces mount after their page
has hydrated. The affected three cases passed nine consecutive focused runs
before the fresh 47-case gate.

Canonical `/Users/tariq/code/nasq` `main` remains the pre-Phase-3b baseline.
The branch has not been merged, pushed, tagged, or deployed. The detailed
commands, artifacts, and preview runtime are in
`2026-09-05-nasq-phase-3b-delivery.md`.

## Historical starting point

- After workspace reorganization lands, start from canonical
  `/Users/tariq/code/nasq` `main` and create a fresh Codex task worktree using
  `superpowers:using-git-worktrees`. The temporary `nasq-integration` worktree
  and `codex/workspace-integration` branch are organization machinery and are
  not the phase-3b execution location.
- HR-1 is real baseline software, not planned work. `nasq_hr` is installed in
  the development database after a database and filestore backup.
- Workspace organization preserved and reconciled source; it implemented no
  new phase-3b product feature. Every phase-3b behavior below still requires
  its task's tests and implementation.
- Before phase-3b implementation, the integration lead observed 144 Odoo, 41
  contract, and 136 web unit tests green, with ruff and web lint/vue-tsc green.
  These are baseline observations; rerun the post-change gate before delivery.
- The old phase-3b source is preserved at commit `e4e8e9b`, tag
  `archive/pre-reorganization-20260905`, and
  `/Users/tariq/code/nasq-recovery-20260905/preserved-work.bundle`.
  It is quarantined WIP, not shipped behavior and not a branch to merge.

## Build target

Extend the existing `/hr` directory so a customer admin can create/edit/archive
employees, grant/reset/revoke their access, and set effective employee/admin
roles. Add `/settings/branding` and `/account` while preserving the HR
department documents and PMO assignee picker.

`/hr` presents **الموظفون** and **الأقسام** tabs. Documents remain attached to
the selected department in the departments tab.

Compatibility is fixed:

- `/hr` remains canonical; the retired heading-only `/people` page must not
  return.
- HR lists stay `{items,total}`.
- Existing `Hr*` contract names and every `HrDocument*` export stay.
- Employee payload keeps `work_phone` and `user_id`, then adds `manager`,
  `active`, and `access`.
- Department payload keeps `parent_id` and `child_ids`, then adds
  `employee_count`.
- Department deletion refuses active/archived employees, children, and HR
  documents, returning all three counts.
- `GET /api/v1/people` continues to return PMO user ids; never edit its
  controller, composable, or schema.

## Execution ownership

Use the Codex team only. One Sol lead owns contracts, task assignment,
integration, conflict resolution, and the final gate. Bounded Luna workers may
run the disjoint packages listed in each wave; no two workers edit the same
file, and workers do not run the broad test suite.

```text
W1  T1 HR contracts/error details | T2 HR model rules | T3 common contracts
W2  T4 HR API                     | T5 branding API    | T6 password API
W3  T7 /hr UI                     | T8 branding UI     | T9 account UI
W4  T10 live contracts, e2e, preservation checks, docs, final gate
```

Dependent waves wait. Each worker receives the task's exact `Files`,
`Interfaces`, and acceptance steps plus the Global Constraints; they may run
only focused tests for their task. The lead reviews each result against the
locked contract before starting a consumer wave.

## Non-negotiables

1. Extend `odoo-addons/nasq_hr/controllers/hr_employees.py` and
   `hr_departments.py`; do not create competing controller modules or replace
   the addon.
2. Keep the document model, security XML/CSV, routes, serializers, composables,
   components, e2e, locale keys, and attachment workflow.
3. Add no `sudo()`. The anonymous branding route's existing `sudo()` remains;
   admin operations use caller rights.
4. Direct API tests prove 403 behavior. Hidden controls are UX, not the access
   control boundary.
5. Passwords never enter logs, responses, query keys, or caches. New/reset
   passwords are at least 8 characters.
6. Role changes alter real nasq group membership and preserve unrelated user
   groups. Self-deactivation/demotion and vendor mutations are refused.
7. Forms use explicit Save actions. Arabic and English locale edits are
   additive; logical Tailwind properties only.
8. Commit with explicit pathspecs and preserve unrelated integration changes.
   Do not merge, tag, push, or deploy unless separately authorized.

## Quarantine procedure

When the archived WIP appears useful, inspect one named file or hunk with a
read-only diff. Compare it to the current integration file and the revised
spec. Re-implement only the accepted behavior on the current file. Never
checkout the archived tag, copy its `packages/contracts/src/hr/`, copy its
`nasq_hr` tree, or treat its tests as current proof.

## Verification order

Workers run the focused test named in their task. After T1–T9 are reviewed, the
Sol lead runs T10 once:

1. Fresh disposable Odoo install of
   `nasq_core,nasq_api,nasq_pmo,nasq_hr` with all four test tags.
2. `ruff check odoo-addons`.
3. `npm -w packages/contracts run test`.
4. `npm -w apps/web run test`.
5. `npm -w apps/web run lint`.
6. Playwright with Odoo and Nuxt running, including the existing HR directory
   and document specs plus new people-access, branding, account, and contract
   scenarios.
7. Stop the task Nuxt dev server and run `npm run build`.
8. Preservation checks: no PMO picker diff; no lost `HrDocument*` exports or
   `hr.docs.*` keys; sidebar still targets `/hr`; no new `sudo()`.

Use a disposable test DB and a distinct HTTP port. Never run Odoo tests against
the development database. Service start/stop details must follow the current
project skill and repository instructions at execution time.

## Definition of done

- Every task's focused tests pass and its contract review has no open finding.
- The fresh final gate passes with recorded post-change counts.
- Authenticated browser flows prove HR administration, effective demotion,
  reset/revoke session invalidation, branding refresh, and account password
  continuity.
- Existing department documents still create, edit, upload, read, and validate
  through the live contract.
- Delivery docs distinguish the archived WIP from shipped phase 3b.
- The final report lists commits, exact gate summaries, preservation checks,
  and any deviation. A failed gate blocks merge/tag claims.

## Historical starter prompt

> Execute the reconciled nasq phase 3b from a fresh Codex task worktree created
> from canonical `/Users/tariq/code/nasq` `main` after workspace reorganization.
> Read the revised spec, plan, handoff,
> `CLAUDE.md`, and `docs/parallel-work.md`. Use the Codex team and the plan's
> wave/file ownership. Extend current HR in place, keep `/hr`, paginated `Hr*`
> contracts, documents, and `/api/v1/people`. Treat
> `archive/pre-reorganization-20260905` as quarantined reference only. Run
> focused tests per task, then have the Sol lead run the full gate once and
> report exact evidence. Do not push, merge, tag, or deploy without separate
> authorization.
