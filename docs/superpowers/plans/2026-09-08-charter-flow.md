> **سياق تاريخي للمنتج والتنفيذ.** قرارات الشكل القديمة هنا ليست تعليمات واجهة؛ اتبع [DESIGN.md](../../../DESIGN.md). تبقى العقود وقيود الأمن والبيانات خاضعة للمصادر الحالية في المشروع.

# Charter flow Implementation Plan

> For agentic workers: use subagent-driven-development; user-approved project routing and ownership override skill defaults.

**Goal:** A compact printable charter followed by milestone checklists and bounded task schedules.
**Architecture:** Extend stock Odoo milestones, retain existing project/task fields, and update routed Nuxt views with frozen shared contracts.
**Tech Stack:** Odoo 19 CE, Python, Nuxt 4, Vue, Zod.
**Spec:** `docs/superpowers/specs/2026-09-08-charter-flow-design.md`.

## Global Constraints

No commit, merge, push, deployment, main restart, destructive cleanup, tests on odoo19, provider API fallback, or extra agents from workers. All implementation workers use Luna high. Three independent worktrees, no shared mutable runtimes. Coordinator runs all checks. UI follows DESIGN.md, shared component catalog and frontend role.

### Task 1: Backend and contracts

Owned worktree: `/Users/tariq/code/nasq-charter-backend`. Own `odoo-addons/nasq_pmo/**` and `packages/contracts/src/pmo/**` only. Reference the spec frozen contracts. Add model extension, validators, API serialization and task planned_start support, protecting native capabilities. Read-only inspect all relevant call paths including templates and parent changes. Write tests in milestone/schedule suites and contract test files for checklist roundtrip, independent progress, date boundaries, parent shrinking, task reassignment, authorization and legacy undated behavior.

- [ ] Write regression tests first and tell coordinator exact command/paths for red gate. Do not run tests yourself.
- [ ] Implement model and serializer contracts after coordinator sees expected red.
- [ ] Self-review changes and leave uncommitted diff. Report owned paths and required gates.

Concrete test behavior: create dated project 2026-10-01..2026-10-31, milestone 2026-10-05..2026-10-20 with `[{name:'Requirements',done:false}]`; toggle done and assert task counts/reach unchanged. Task planned_start 2026-10-04 must fail; start on 2026-10-05 must pass. Shrinking milestone deadline before an existing task deadline must fail. Shrinking project end before milestone deadline must fail. A second company's record cannot be assigned.

### Task 2: Compact charter and document

Owned worktree: `/Users/tariq/code/nasq-charter-ui`. Own charter/create components and tests under `apps/web/app/components/project/Project{Charter*,CreateForm*}`, `apps/web/app/utils/projectCharter.ts` and its tests, `apps/web/app/pages/projects/new.vue`, `apps/web/app/pages/projects/[id]/charter.vue` only. Do not edit milestone components, main project page, contracts or locale JSON. Give coordinator locale additions in a report. Consume spec's milestone shape via existing useMilestones; locally contract imports remain old until integration, do not edit contracts to compensate.

- [ ] Write focused tests for hidden-value preservation and creation route; request red gate.
- [ ] Simplify existing fields/display, preserve hidden persisted values in patch construction, aggregate milestone outputs in document, and implement print rendering scoped to charter.
- [ ] Route new project to `?tab=milestones` while preserving returnTo. Leave uncommitted diff and report acceptance.

Concrete assertion: editing only name must not clear sponsor_id, benefits, requirements or legacy deliverable acceptance. Printed document contains milestone checklist names, and no approval/signature workflow. Creation navigates to project milestones, not overview.

### Task 3: Milestone and task UI

Owned worktree: `/Users/tariq/code/nasq-milestone-ui`. Own milestone components/forms/table, `useMilestones.ts`, `apps/web/app/pages/projects/[id].vue`, nested milestone routes, nested task creation route, task creation/date/deadline components, schedule task form, task detail components, associated focused tests. Do not edit charter components, contract/Python files, locale JSON or shell. Inform coordinator of task date API shape needs. Use `{start_date,deadline,deliverables:[{name,done}]}` for milestones and `{planned_start,date_deadline}` for tasks. Preserve current filters, can_manage and per-task actions.

- [ ] Write focused form behavior tests and request red gate.
- [ ] Implement date inputs constrained by project, checklist add/remove/toggle saving, task count-derived progress and clear continue-to-tasks action. New task route accepts milestone_id query and initializes it safely within project.
- [ ] Implement task start/end bounds in creation/edit/schedule surfaces without new popups. Preserve unrelated task flows and existing control permissions.
- [ ] Report translations in separate JSON fragments and leave uncommitted diff.

Concrete assertion: checklist toggle sends only deliverables update, not is_reached. Selected milestone restricts date inputs. Task starts before milestone or ends after milestone display errors and cannot submit. Back retains originating project filters.

### Task 4: Integration, review and verification

Coordinator owns `/Users/tariq/code/nasq-charter-flow`, locale files, integration test fixtures, docs and runtime. Copy only approved owned changes from worktrees, never merge/commit branches. Run targeted red gates before worker implementation, then focused final tests, typecheck/build, isolated Odoo tests and browser check. Dispatch read-only Astra review of complete uncommitted diff. Resolve findings through owning workers. Report local branch/runtime and actual gates; no production claim.
