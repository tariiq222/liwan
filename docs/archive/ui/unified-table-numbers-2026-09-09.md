> **سجل تاريخي — ليس تعليمات تنفيذ.** المرجع المعتمد الآن: [DESIGN.md](../../../DESIGN.md). النتائج والمسارات الواردة أدناه تخص وقت تسجيلها.

# Unified record-number columns — 2026-09-09

## Result

Sixteen record tables use a first “الرقم” / “No.” column and shared RecordNumber renderer. Meetings use their existing reference; finance entries use their existing reference or record id; other tables use stable record ids. No row-index numbering or private identity numbers are introduced. Number text is isolated LTR for Arabic layouts. Meeting references remain visible on mobile cards.

Coverage: projects, personal/project tasks, recent dashboard projects, finance entries, finance report projects, project register, stakeholders, RACI task rows, meetings, HR directory, departments, global HR documents, employee documents, users, roles and audit records. Personal/project task variants share one component (16 table components/routes total).

Existing pending unified filter cards are preserved. Empty/loading column spans and read-only action-cell alignment are updated. RACI number and name columns retain sticky positioning. Non-table cards, pickers and aggregate rows are outside this table-column change.

## Fresh verification

- npm test: 153 contract tests and 695 web tests passed.
- vue-tsc --noEmit: passed.
- npm run build: passed (existing duplicate-auto-import and bundle annotation warnings remain).
- git diff --check: passed.
- Authenticated browser verification on isolated preview: project 12, meeting references MIN/2026/0680, MIN/2026/0353 and MIN/2026/0352; task 903 in task table and RACI; register record 1; employee and user ids in their separate first columns.
- At 390px viewport, project table scrolls within its container (860px table; document scrollWidth 375px), and meetings keep references in responsive cards without page-width overflow.
- Representative screenshots and command logs: /tmp/nasq-table-numbers/.

## Delivery state

Candidate checkout: /Users/tariq/code/nasq-meeting-filter-card, branch codex/meeting-filter-card. Preview: http://127.0.0.1:3969/meetings. Scratch database nasq_filter_card_20260909 only; representative test rows were added there. No tests or fixtures were run against odoo19. Canonical main was not changed; no commit, merge, push or deployment performed for this change. Browser checks cover representative populated tables, not every permission/empty-state combination.
