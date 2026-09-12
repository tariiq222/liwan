> **سجل تاريخي — ليس تعليمات تنفيذ.** المرجع المعتمد الآن: [DESIGN.md](../../../DESIGN.md). النتائج والمسارات الواردة أدناه تخص وقت تسجيلها.

# Projects tabs and Side Sheets pilot

> تاريخي. السياسة: [DESIGN.md](../../../DESIGN.md). الشيت الحالي بتغميق 20% ومُعمَّم خارج المحادثات.

The user approved Projects-only tabs and Side Sheets. The final sheet attaches to the main module rail, fills the available height below the header, enters and exits at the logical start edge (right in RTL, left in LTR). There is no dimming backdrop. Header and module navigation remain clear and available; the sheet can cover contextual navigation. Other modules keep their existing presentation.

Implementation checkout: `/Users/tariq/code/nasq-project-tabs-popups`, branch `codex/project-tabs-popups`, based on `508d256`. No commit, merge, push or deployment performed. Canonical main and other worktrees are preserved.

## Delivered behavior

- All/My project list tabs preserve existing filters.
- A project defaults to Tasks when available, with direct Summary, Milestones, Stakeholders, Risks, Finance, Charter and Settings navigation. Read-only/archived defaults retain their permitted Summary.
- List, board and timeline remain views of project tasks.
- Project workflow URLs reuse their existing forms/details inside one Side Sheet. Direct links, reload and `fullPage=1` remain supported.
- Project-created tasks return to the filtered task list after successful creation. Basic fields stay visible; optional description and deliverables expand on demand.
- Optional project charter sections collapse during project creation. Detailed charter editing retains all fields.
- Existing create API behavior remains: task assignee defaults to the creator; assignee/priority edits remain in task details. No API or Odoo behavior changed.
- Dirty forms are protected on close, Escape, browser history, and transitions between dialog/full-page presentation.

## Validation environment

UI preview: `http://127.0.0.1:4394/projects`, isolated mock API at `127.0.0.1:4894`, synthetic admin/admin credentials. No real Odoo database is used. Browser save/error tests intercept requests; these demonstrate frontend behavior, not backend persistence or production readiness.

Clean prepared baseline: 153 contract tests and 685 frontend tests passed. Initial preparation required `nuxt prepare` before running Vitest.

Typecheck baseline is independently reproduced in `/Users/tariq/code/nasq-project-popup-baseline-check` at `508d256`: 26 pre-existing TypeScript diagnostics in `app/pages/__tests__/meetingEditors.test.ts`. The candidate typecheck was compared line-by-line with that baseline and had the same 26 diagnostics before the final content-frame refinement. Final checks are recorded below.

## Review and fixes

- Changed the route host to observe Vue Router's current route; Nuxt's delayed route initially prevented opening a dialog from a mounted workspace.
- Preserved the background page instance and focus target across opening/closing.
- Preserved task filters when the initial task view has no explicit `tab` query, without conflating finance/register filters.
- Aligned the selected tab with read-only/archived Summary defaults.
- Protected drafts in both directions of dialog/full-page presentation changes.
- Replaced the centered popup with the final user-approved Side Sheet aligned with the main module rail.

## Final checks

Frontend and contract unit suites pass: 153 contract tests and 699 frontend tests. All 39 isolated Playwright scenarios passed, including actual sampled entry/exit travel, reduced motion, expanded module-rail alignment, shell corner, scoped back-link removal, four widths, drafts, mock save/error handling, direct URLs and reload. `npm run build` passed. Final `npm -w apps/web run lint` still reports exactly the same 26 baseline diagnostics in the meetings test file; line-by-line comparison matches, with no new diagnostics. `git diff --check` passed.

The final sheet preserves the shell start-corner radius on both its clipped frame and its own border. Duplicate back links are omitted in the shared page header and task detail panel only when the project sheet injection is present; standalone and other-module navigation is retained.

Fresh evidence logs:
- `/tmp/nasq-project-sidesheet-verified-tests.log`: 153 contract tests + 699 frontend tests passed.
- `/tmp/nasq-project-sidesheet-verified-e2e.log`: 39 browser scenarios passed.
- `/tmp/nasq-project-sidesheet-build.log`: production build complete.
- `/tmp/nasq-project-sidesheet-verified-typecheck.log`: same 26 baseline diagnostics as `/tmp/nasq-project-popups-baseline-typecheck.log`.

Canonical main was observed clean at `c63d42f` at completion; it advanced independently from the pilot's `508d256` baseline. This pilot has not been integrated. Any later authorized integration must reconcile against the then-current main and preserve its approved changes under AGENTS.md.

## Spacing and RTL motion refinement

Standard sheets now use an 800px target width, compact task creation 560px, and complex charter/finance/template forms 900px, capped to available space. Content gutters are 16px on small screens and 24px on desktop. The user corrected the earlier left-exit request: entry and exit now use the same logical start edge (right in RTL, left in LTR). The RTL browser regression samples entry and exit separately and verifies actual rightward exit travel before removal. Fresh isolated Playwright verification: 39 passed (52.2s), log `/tmp/nasq-project-sheet-rtl-e2e.log`. Visually reviewed project creation in the in-app browser. `git diff --check` passed. Prior build/unit/typecheck evidence above predates this narrow refinement. No integration or deployment performed.
