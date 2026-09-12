# PMO repair package report

Date: 2026-09-07
Worktree: `/Users/tariq/code/nasq-impeccable-pmo`
Branch: `codex/impeccable-pmo`
Baseline: `a036fa0`

## Status

Implemented the assigned PMO findings A04, A05, A06, A07 (PMO scope), A08, A09 (PMO scope), A10, A11, A12, and A14. A13 remains coordinator-owned and was not changed. No files outside the assigned PMO component, route, locale, and local test/helper scope were edited.

## Changes and evidence

- **A04/A05 — long values:** constrained assignee/tag chips, project metadata values, manager/approver/type/unit/sponsor selectors, and task selectors with shrink-safe wrappers, truncation or wrapping, full-value titles, and accessible removal targets. Selector label associations use `aria-labelledby` while preserving selected values.
- **A06 — keyboard fold control:** folded board columns now expose an `aria-expanded` button for both expansion and collapse, with localized stage-specific labels.
- **A07 — PMO label associations:** visible labels in `ProjectCharterFields`, `ProjectGeneralForm`, and `TaskDetails` now identify their selector/button controls through label IDs and `aria-labelledby`.
- **A08 — dark warning theme:** stale charter warning has a dark amber surface and dark-theme foreground pair.
- **A09 — failed reads:** PMO task detail/activity/attachments, task tables/board, archived tasks, milestone/update lists, project detail, and PMO project child pages render `SharedPageState` errors before loading/empty content and provide retry handlers. Existing details not-found handling remains intact.
- **A10 — final update body:** `DescriptionEditor` emits a synchronous draft event for form state and exposes `flush()`. `ProjectUpdateForm` flushes the editor before reading the request body, so a submit immediately after typing includes the latest HTML while task autosave remains debounced.
- **A11 — leave guard:** `TaskCreateForm`, `MilestoneForm`, and `ProjectUpdateForm` now use `SharedUnsavedChanges` with baselines and a submitted-success reset before navigation.
- **A12 — stage deletion:** empty-stage deletion now requires an inline stage-specific confirm/cancel step; non-empty stage protection remains disabled with its existing explanation.
- **A14 — board cap:** `isBoardCapped()` reports the warning when cached tasks exceed the cap or when exactly the cap is loaded with another page available, including the all-pages-loaded cache case.

Changed files are the PMO task/project components and PMO routes listed by `git status`; added local helper/test files are:

- `apps/web/app/lib/boardCap.ts`
- `apps/web/app/lib/__tests__/boardCap.test.ts`
- `apps/web/app/lib/formDirty.ts`
- `apps/web/app/lib/__tests__/pmoRepairContracts.test.ts`

Locales updated in both Arabic and English task/project namespaces for activity loading, board expand/collapse, and stage-delete confirmation text.

## Verification

Fresh focused checks from `apps/web`:

- `../../node_modules/.bin/vitest run app/lib/__tests__/boardCap.test.ts app/lib/__tests__/debouncedFlush.test.ts` — **2 files passed, 8 tests passed**.
- `../../node_modules/.bin/vue-tsc --noEmit` — **exit 0**.
- Node JSON parse of the four changed Arabic/English `projects.json` and `tasks.json` locale files — **passed**.
- `git diff --check` — **passed**.

No runtime, setup, browser, full-suite, build, Odoo, or broad validation was run per package instructions. The coordinator owns aggregate browser/type/build checks.

## Residual risk

The focused checks establish helper, debounce-flush, TypeScript, locale, and whitespace correctness. Browser verification is still needed for exact 320px/RTL text containment, accessible-name output, error-state rendering with live failed requests, and the stage confirmation interaction. Project-level 403/404 wording follows the existing route behavior; the generic PMO error path now has retry.

## Independent review delta

Addressed the review findings as follows:

- Date controls now have distinct start/end accessible names, and popover controls include both their field label and a selected-value node. Assignee/tag triggers include the selected names in their accessible name while retaining their visible action text.
- Project update save passes `:readonly="isPending"` to `DescriptionEditor`; formatting/link handlers, link input, and link apply are guarded during the pending request. Task autosave remains debounced because the readonly behavior is only used by the explicit-submit project-update form.
- Personal board stage loading/error/refetch state is now consumed only for personal boards. Failed or pending stage reads render a recoverable shared state before the board; project-stage boards remain independent.
- Added `formDirty.ts` and `pmoRepairContracts.test.ts` covering dirty/clean/success transitions for all three explicit-submit forms, immediate update-submit wiring with delayed autosave, and stage delete confirmation wiring including the nonempty-stage guard.

Review-round focused verification (no typecheck, build, lint, full suite, runtime, or browser checks):

- `../../node_modules/.bin/vitest run app/lib/__tests__/pmoRepairContracts.test.ts app/lib/__tests__/boardCap.test.ts app/lib/__tests__/debouncedFlush.test.ts` — **3 files passed, 13 tests passed**.
- `../../node_modules/.bin/vitest run app/components/project/__tests__/ProjectGeneralForm.test.ts app/lib/__tests__/pmoRepairContracts.test.ts` — **2 files passed, 8 tests passed** (including the modified general-form SSR surface).
- Final combined narrow run: `../../node_modules/.bin/vitest run app/lib/__tests__/pmoRepairContracts.test.ts app/lib/__tests__/boardCap.test.ts app/lib/__tests__/debouncedFlush.test.ts app/components/project/__tests__/ProjectGeneralForm.test.ts` — **4 files passed, 17 tests passed**.

The earlier worker-side `vue-tsc --noEmit` result remains historical evidence only; coordinator-owned aggregate typecheck/build gates are still required and were not rerun in this review round.

## Archived-task scope repair delta

The real browser request to `/api/v1/tasks/archived?limit=50&offset=0` omitted the API's required scope and returned HTTP 400. `useArchivedTasks` now builds its query through `archivedTaskQuery`: an unscoped archive always sends `filter=mine`; an explicit `project_id` leaves the project scope available; and an explicit `mine=true` remains honored with a project scope. Pagination, search, and the existing query-key/access behavior are unchanged.

Changed paths for this delta:

- `apps/web/app/composables/useArchivedTasks.ts`
- `apps/web/app/composables/__tests__/useArchivedTasks.test.ts`
- `apps/web/app/lib/__tests__/pmoRepairContracts.test.ts` (review follow-up behavioral harness)

The archived query regression was run RED before the builder implementation: **3 tests failed** because `archivedTaskQuery` was not yet present. After implementation it ran GREEN with **3 tests passed**. The final narrow run combining the archived query and PMO behavioral harness passed **2 files, 13 tests**. No broad gates, runtime actions, commits, or backend changes were performed.
