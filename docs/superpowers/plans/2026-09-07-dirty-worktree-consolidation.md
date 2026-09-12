> **سياق تاريخي للمنتج والتنفيذ.** قرارات الشكل القديمة هنا ليست تعليمات واجهة؛ اتبع [DESIGN.md](../../../DESIGN.md). تبقى العقود وقيود الأمن والبيانات خاضعة للمصادر الحالية في المشروع.

# Coordinated consolidation of sixteen dirty worktrees

> Execute with subagent-driven-development; user explicitly authorizes commits and local merges.

**Goal:** Preserve every source snapshot and integrate its useful behavior into current main without regressing newer functionality.
**Architecture:** Checkpoint each original branch. Merge all source histories into one isolated candidate. Reconcile overlaps in disjoint worker worktrees; coordinator owns shared files, Git operations and final validation. Promote the accepted candidate to main locally.
**Tech Stack:** Nuxt 4/Vue 3/TypeScript/Zod, Odoo 19 CE, Vitest, Playwright, Ruff.
**Spec:** User request to commit and merge all sixteen dirty worktrees, after the preflight audit. Approved UI reference remains the subsequent layout migration specification in DESIGN.md.

## Global constraints

- Preserve all sixteen checkpoint commits as ancestors of final main. Never delete branches/worktrees, discard source snapshots, push or deploy.
- Preserve newer main functionality: project workspace tabs, cream theme, routed pages, unsaved-change confirmation, record/company capability guards, finance precision and optimistic concurrency.
- Work only in assigned isolated worktrees. Never overwrite another worker. No worker delegation or Git mutations; coordinator owns commits and integration.
- Workers do not run build, lint or full suites. Focused regression tests are allowed with independent dependencies. Coordinator runs final gates.
- Never test on odoo19 or mutate upstream Odoo source/config/Git. Coordinator owns isolated scratch databases and runtime ports.
- Scope is consolidation and integration fixes. The approved replacement layout and complete Projects redesign follow consolidation.

## Source evidence

External recovery directory: `/Users/tariq/.codex/visualizations/2026/09/07/01a07b91-635e-7300-8483-4d649f43ae0e/nasq-consolidation`.
`checkpoints.json` records every source parent, commit, tree, worktree and file list. `merges.jsonl` records initial resolutions. Initial candidate retains current files at conflicts pending explicit reconciliation; this alone is not acceptance.

## Ownership and independence

| Task | Agent | Owns | Independence |
| --- | --- | --- | --- |
| 1 Web repairs | Luna high | Non-HR impeccable web paths and access/settings/tasks locale namespaces | Independent from HR and meetings; projects locale requests go to coordinator |
| 2 HR | Luna high | HR components/pages/composables/tests, departmentOrgChart, ar/en hr.json | Independent, no shared file writes |
| 3 Meetings | Astra medium | Cyan addon, meetings backend/core changes and tests, meetings web/notifications, meetings/access contracts | Independent after merged candidate; shared nav/common locale/barrel proposals go to coordinator |
| Coordinator | Astra | Git, global CSS/Gantt, nav/accessPolicy/common/project locales, docs, historical phases, integration and tests | Final validation depends on all packages |

Project parallel-work instructions supersede SDD's generic serial-worker default: isolated paths and independent runtimes permit this explicit parallel batch. Existing user work is preserved rather than deleted for a test-first rewrite. Integration regressions receive focused reproduction before fixes; reversible styling does not require tests that mirror implementation.

### Task 1: Reconcile web repair snapshots

- [x] Compare `codex/impeccable-fixes^..codex/impeccable-fixes`, PMO and settings snapshots to candidate. Inventory owned files with a disposition, especially initial conflicts.
- [x] Preserve newer chrome/tabs and restore useful dirty guards, description flush, retry states, explicit personal archive scope, selectors, inline deletion and responsive fixes.
- [x] Reconcile the remaining settings/account/password/table conflicts and report shared CSS/project-locale needs.
- [x] Add/run focused behavioral regression checks where integration changes behavior. Report files, dispositions and evidence.

### Task 2: Reconcile HR snapshots

- [x] Compare impeccable HR/fixes and HR department tree source commits with candidate, including distinct DirectoryTable versions.
- [x] Retain responsive tables, request scoping/invalidation, employee/document form repairs and the working department chart/tree UI in current route/chrome architecture.
- [x] Reconcile every HR conflict listed in merges.jsonl; chart files existing without a page entry are incomplete.
- [x] Run focused HR regression checks only; record source-to-final decisions.

### Task 3: Complete meetings integration

- [x] Review full Cyan and meetings source changes end-to-end, including newest org-admin role additions and calendar/edit/resolution routes.
- [x] Reproduce and fix meeting notifications being excluded by recipient list/read domain; preserve current-company, record visibility and recipient ownership. Test cross-company/hidden/readability/read states.
- [x] Reconcile Cyan standalone security tests versus Nasq-dependent added tests in the source conflict. Nasq-specific behavior belongs to dependent addon tests.
- [x] Check meeting creation/edit/workflow/attachments/resolution conversion and access grants. Correct concrete integration failures, preserve attachment ACL and capability guards; report shared file needs.
- [x] Worker performs source checks/focused tests only; coordinator runs isolated Odoo tests and all final gates.

### Task 4: Coordinator reconciliation and acceptance

- [x] Checkpoint all sixteen dirty worktrees and create candidate with source merge history.
- [x] Review historical phase1/phase2 differences per file; preserve useful missing behavior, document duplicated/superseded choices.
- [x] Repair Gantt integration regressions: visible dates, long names, today cue, boundary milestones and undated metadata; scope global active style.
- [x] Integrate worker diffs; independent review of spec and quality, fix important findings.
- [x] Run contracts/web tests, typecheck/lint, build, isolated Odoo addon tests and relevant runtime checks; record limitations honestly.
- [x] Commit evidence and promote candidate to main. Verify every source ancestor and source worktree cleanliness; preserve any late edits through additional checkpoints.
