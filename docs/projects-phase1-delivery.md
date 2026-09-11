# Projects phase one — local delivery

> تاريخي. السياسة: [DESIGN.md](../DESIGN.md). ليس تعليمات واجهة.

**Status: implemented and locally verified, 2026-09-07.** Work remains uncommitted in `/Users/tariq/code/nasq-projects-phase1`, branch `codex/projects-phase1`, based on main `d63f82f5367958eb9fb9c856d938b2cc0a0c9396`. No commit, merge, push or deployment was performed. Canonical checkout changes in nuxt.config.ts, deploy/Caddyfile and .agent were preserved. At close, an additional concurrent main-checkout edit in apps/web/app/composables/__tests__/hrAdmin.test.ts was observed; this task did not edit or revert it.

## Delivered behavior

- **Project Templates:** company-scoped catalog, authored stage/milestone/task/dependency definitions, full-page create/edit/apply, pagination and retained filters. Applying creates fresh independent records atomically using inclusive calendar days; no execution data is copied. Native project creators can apply without receiving generic task read/create permissions.
- **Stakeholders / RACI:** external or internal stakeholders, full routed CRUD, task-by-stakeholder matrix with R/A/C/I, one accountable role per task and one assignment per pair. Assignment conflicts are handled; linked stakeholder deletion requires removing assignments first. Searches and both matrix pages survive refresh/back.
- **Risks and issues:** routed CRUD, owner/task selectors, response/due date/status/priority, risk probability and impact with derived score, issue metrics empty. Filters and pagination persist in URLs.
- **Timeline / Gantt:** separate from the existing activity feed; weekly/monthly view, dates, milestones, visible dependency links, unscheduled and legacy deadline-only tasks, guarded full-page date editing. Date changes do not automatically cascade and there is no drag scheduling in this phase.
- Arabic/English labels, RTL, hydration/pending controls, inline deletion confirmation and shared unsaved-change guards.

Budget/cost actuals and consolidated project reports remain **phase two**. The existing charter estimate is preserved.

## Verification evidence

All logs are in `/Users/tariq/code/nasq-phase1-artifacts`.

| Gate | Fresh result | Evidence |
| --- | --- | --- |
| Contract tests | 108 passed | node-tests-final.log |
| Web unit tests | 349 passed | node-tests-final.log |
| TypeScript | passed | lint-final.log |
| Python lint | all checks passed | ruff-final.log |
| Contracts + Nuxt build | passed | build-final.log |
| Full Odoo addon install/tests | 390 passed, zero failures/errors | odoo-full-final.log |
| Additional linked archived-task visibility regression | 1 passed | odoo-archived-task-final.log |
| Production-build feature browser suite | 9 passed | e2e-phase1-final.log |
| Existing project regression sample | 27 passed; 3 other failures explained below | e2e-project-regressions.log |
| Diff whitespace | passed | final git diff --check |

The full Odoo run installed nasq_core, nasq_api, nasq_pmo and nasq_hr from this explicit worktree into fresh scratch DB `nasq_phase1_full_20260907` with a separate data directory. The added archived-task regression ran afterwards against the earlier owned scratch DB. Odoo `odoo19` was never a test target. Final formatting-only edits do not change tested backend behavior.

The nine browser tests used the built Node/Nitro output, real authenticated APIs and scratch DB `nasq_phase1_20260907`. They cover template editing/application, repeated independent projects, pending-save controls, reference cleanup, 51-template pagination, warm project-picker cache refresh; schedule save/reload/clear/date errors/failed drafts/mobile/milestone alignment; stakeholder CRUD, RACI duplicate-A rejection and inline deletion; register CRUD/score/filters/failed drafts/mobile; 201 stakeholders, 51 tasks, matrix assignment and viewport refresh/back. Deliberate 503 interception is limited to failed-save guard tests; successful flows persist actual Odoo records. Final Arabic Gantt, matrix, template editor and mobile register screenshots were visually inspected and copied to artifacts/screenshots.

## Independent review

- Schedule: schedule-review.md and schedule-rereview.md; remaining marker geometry corrected by coordinator and verified in the browser.
- Templates: templates-review.md and templates-rereview.md; final source PASS. Runtime probes exposed and then verified the native project-only creator edge and preserved generic task denials. Template temporary read scope is caller/company/new-project-bound, preserves stock ACL/rules and is cleared in finally.
- Governance: governance-review.md and governance-rereview.md; final source PASS. An earlier rule-only visibility inference was disproved by the real private-project test. Caller-built SQL visibility queries and shared _check_access now protect ORM reads/search/has_access, and the corrected 13-test suite passed before the full 390-test gate. The additional archived linked-task test also passed.

RACI concurrency coverage races two independent database connections against a disposable copy of the installed SQL table/indexes; this proves the installed unique indexes arbitrate conflicts, not a complete end-to-end concurrent ORM transaction scenario.

## Existing regression limitations

Two failures in the existing settings role-form unsaved-navigation test reproduced identically against a clean archive of the **base frontend**, served separately on port 3870 against the owned scratch backend (e2e-unsaved-baseline.log). Those untouched role screens remain outside this project phase. One project-settings digest browser test requires an external `E2E_PSC_FIXTURE` from its dedicated verifier; that fixture was not provisioned for this phase. These three results are not presented as passing. New project-feature unsaved guards passed, including failed-save preservation and successful-save navigation.

## Worktree and preview

- Integration source: `/Users/tariq/code/nasq-projects-phase1` / `codex/projects-phase1`.
- Preview: http://127.0.0.1:3869/projects ; built Nuxt on 3869, Odoo on 9869.
- Preview database: `nasq_phase1_20260907`; deliberately contains acceptance-test records. Default scratch administrator login is admin/admin.
- Full-test database: `nasq_phase1_full_20260907`; retained separately.
- Worker source trees: `/Users/tariq/code/nasq-phase1-schedule`, `/Users/tariq/code/nasq-phase1-governance`, `/Users/tariq/code/nasq-phase1-templates`.
- Design and checked plan: docs/superpowers/specs/2026-09-07-projects-phase1-design.md and docs/superpowers/plans/2026-09-07-projects-phase1.md.

The preview processes and source worktrees are retained. Local test/build success is not production or main-branch integration evidence.

## Delegation record

Used the requested claude-delegate workflow with OAuth subscription. Both initial Claude calls resolved claude-sonnet-5/high and stopped before editing because the session quota was exhausted; both processes exited. Native Luna high workers took over isolated packages. Astra high handled demonstrated security/runtime corrections and independent reviews. No paid API fallback or permission bypass was used. Coordinator owned shared files, source integration and all broad/runtime gates.
