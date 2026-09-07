# Approved design fidelity correction — 2026-09-06

> UI authority update — 2026-09-07: [DESIGN.md](../../DESIGN.md) supersedes this document's customer-UI appearance, component and navigation prescriptions wherever they conflict. Preserve historical implementation/verification evidence and still-valid API, permission, business and delivery contracts. This document is not a second theme source.

The user reported that Projects and the remaining real pages did not match the
approved OpenDesign design after the initial rollout. The initial rollout copied
shell tokens but retained substantial page structure from the original system.

## Reference and isolation

The live OpenDesign `project-0c8a/raw/nasq-shell.html` was retrieved and compared
with `docs/design-system/approved-shell.html`. They match after trailing whitespace
normalization. The comparison includes the late CSS, redefined render functions,
and `refineRenderedView()`, which replace the initial page headers and structures.

Correction branch: `codex/design-fidelity`, based on `main` at `b748ca1`.
Worktree: `/Users/tariq/code/nasq-design-fidelity`.
The canonical checkout's unrelated Nuxt/Caddy/.agent changes remain outside this work.

Root owns shared primitives, CSS, runtime, contracts, integration and checks.
Separate workers own project pages, task detail, and the remaining business pages.

## Correction scope

- Shared cards use the approved header/body spacing without the inherited outer
  padding and gap. Inputs and ordinary buttons use a consistent 40px height;
  icon actions retain the user-approved 32px box and 18px Lucide icon.
- Compact page action rows, 940px forms, divider tables, responsive two-column
  details, and vertical settings navigation follow the final reference.
- Projects: summary cards, unified toolbar, functional table/cards view and sort,
  manager/end-date columns, four project tabs, overview and metadata support rail.
- Task detail: natural page scrolling and two independent cards, structured task
  metadata/sections, activity timeline, explicit inline title editing.
- HR, settings, account, notifications and extra business routes use the same
  hierarchy while retaining their actual fields, permissions and actions.

The project list now exposes only two additional fields already readable on the
project detail endpoint: the manager's id/name and the end date. The minimal
picker contract, record access checks, and model remain unchanged. No per-row
project detail requests are introduced.

User-approved later refinements remain: centered header search dialog, last-five
notification preview, routed More page, thin neutral focus, readable unread count,
company color, dark/light and three persisted font sizes (small by default).

## Boundaries

Prototype fixture values are not copied into product records. Unsupported stage
and assignee server filters, project codes, and richer atomic create fields are
not invented. Existing supported controls remain operational. The prototype task
edit route is represented by the existing inline controls; this correction does
not add a new business workflow.

## Verification

Before implementation, the new project-toolbar acceptance test failed because
the creation action was outside the toolbar. The new project-list contract test
also failed against the prior strict schema, which lacked manager and end date.
Final commands, counts, screenshots and runtime state are recorded after checks.

### Final evidence

- `npm test`: **81 contract + 251 web unit tests passed** on the final source.
- `npm -w apps/web run lint`: passed (`vue-tsc --build --noEmit`).
- `npm run build` with isolated Odoo URL/DB/WebSocket environment: passed.
- Ruff on the changed PMO serializer and project test module: passed.
- Odoo `TestProjects` on freshly initialized `nasq_fidelity_clean_20260906`:
  **16 tests, 0 failures/errors**. The first run on a copied demo database
  exposed fixture assumptions (mixed-language sort and Odoo's paired project
  dates); the final fixture supplies both dates and the clean database gate passes.
- Browser: **50 distinct scenarios verified**. The final expanded run passed
  49/50; the remaining failure was an updated test using `page` instead of
  `pageA`. After correcting that test variable, both realtime tests passed.
  No application code changed after the expanded browser gate.
- Browser coverage includes desktop/mobile, both modes, large text, fixed icon
  geometry, toolbar/card navigation, keyboard task opening, summary visibility,
  project filters/back routes, task edits/description flush, archive actions,
  HR create/edit/archive, appearance/branding, access permissions, account,
  centered search, latest-five notifications, and live task/comment updates.
- Visual inspection caught missing HR edit labels, undersized HR form width,
  narrow selectors, and a separate cancel row; these were corrected and the
  final HR screenshots were inspected. Dark screenshots now wait for the
  control color transition to finish before capture.
- Source review corrected nested card keyboard handling, task keyboard opening,
  view-switch group semantics, and the sticky activity grid item.

Final screenshots and the expanded gate artifacts are retained locally under
`.runtime/fidelity-final-gate/`; final logs are `/tmp/nasq-fidelity-*-final.log`.
These are local verification artifacts, not production evidence.

### Runtime / Git state

- Preview: `http://127.0.0.1:3568/projects` (production Nuxt build).
- Odoo: `http://127.0.0.1:9568`, database `nasq_fidelity_20260906`.
- The preview database is an isolated copy and contains test fixtures.
- Branch `codex/design-fidelity`, worktree `/Users/tariq/code/nasq-design-fidelity`.
- Changes are uncommitted and unmerged. Main remains at `b748ca1`; its unrelated
  Nuxt/Caddy/.agent edits are preserved. No push, deployment, worktree deletion,
  or production database operation was performed.
- Helper worktrees remain at `/Users/tariq/code/nasq-fidelity-pmo`,
  `/Users/tariq/code/nasq-fidelity-other`, and `/Users/tariq/code/nasq-fidelity-task`.
