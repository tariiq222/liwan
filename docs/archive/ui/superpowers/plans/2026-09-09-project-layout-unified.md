> **سجل تاريخي — ليس تعليمات تنفيذ.** المرجع المعتمد الآن: [DESIGN.md](../../../../../DESIGN.md). النتائج والمسارات الواردة أدناه تخص وقت تسجيلها.

# Project section layout unification implementation plan

> Execute with subagent-driven-development. User approved the design in this task on 2026-09-09. No commit/merge authorized.

**Goal:** All sections in the project sidebar and child records use one consistent header/tools/content and form recipe.
**Architecture:** Reuse SharedPageContainer, SharedPageHeader, FilterBar and existing nasq-panel/form recipes. Scope CSS to project records. Shared ownership stays with coordinator; two isolated source workers own disjoint page groups.
**Tech Stack:** Nuxt, Vue, existing Tailwind tokens.
**Spec:** Approved chat design and DESIGN.md, updated with the accepted anatomy in this task.

## Constraints
Preserve API/data, permissions, routes/query/back, overlays, drafts, stock Odoo, other modules. No dependency updates. Frozen replay only. No commit/merge/push. Desktop first and responsive safeguards. Forms remain narrower than section roots; section roots align to same width.

## Tasks
- [x] Coordinator: add project-record marker to PageContainer, shared project page spacing/header/tools styles in approved-shell.css. Normalize parent tasks/milestones/summary header and move task create into header; retain views and filter state. TaskToolbar gains independent inline prop defaulting to embedded, so project page can request collapsed filters without changing global tasks. Baseline focused tests before editing.
- [x] Luna lists: owned pages stakeholders/index, register/index, finance, raci, schedule, updates/index and ScheduleGantt. FilterBar default style, views in its view slot. Finance header/tools/summary/ledger; schedule tools own scale and view, embedded Gantt hides repeated header. Exact ownership in /tmp/nasq-layout-briefs/lists.md.
- [x] Luna records: child detail/create/edit pages and existing project form components. One surface, consistent headings/field grids/footer; inspect all child routes. Exact ownership in /tmp/nasq-layout-briefs/records.md.
- [x] Coordinator: section-level charter/settings width=list, eliminate narrow outer form cards in read/section views. Charter read semantic panels, no duplicate essentials heading. Settings section panels with actual operations/auto-save clarity. Summary consistent stack and panels, preserve calculations.
- [x] Coordinator: integrate worker patches after file-ownership review. Run typecheck, complete web unit suite, build; focused browser mock runtime E2E and screenshots for every menu section plus critical detail/draft flows. Update stale structural expectations only for approved layout changes; never weaken behavior checks.
- [x] Independent read-only review and final delivery report with branch/path, fresh results and runtime limits. Preserve worktrees.

## Interface and collision review
| Pair | Shared contract | Result |
| --- | --- | --- |
| Coordinator / lists | Existing header/FilterBar slots, new CSS class nasq-project-toolbar | No shared writers |
| Coordinator / records | Existing container/form/panel classes | No shared writers |
| Lists / records | List returns/query and child routes unchanged | No shared writers |
Each task preserves business contracts. Broad tests are coordinator-only. User authorization overrides skill commit/cleanup steps.
