# UI chart source review

Read-only review of the integrated dashboard page, all new project/dashboard components, ChartCanvas.client.vue, projectChartOptions.ts, analytics composable, tests and locale copy. Read DESIGN.md and linked frontend policy. No source edits/builds/tests/browser validation performed. Known type/prop/test-label issues assigned to Luna are excluded.

## Blockers found in inspected source

1. **P1 - Missing render templates.** `components/project/dashboard/ProjectDashboardMetrics.vue` and `ProjectDashboardRecentProjects.vue` put their root `<section>` directly after `</script>` instead of inside `<template>`. Vue SFC treats that as a custom block, not its template. The KPI strip and required latest-five table therefore have no render template. Wrap each section in template tags. Acceptance: coordinator sees four metrics and no more than five recent project rows rendered.

2. **P2 - Chart grid queries itself.** `components/project/dashboard/ProjectDashboardCharts.vue:154-165` applies `container-type` to `.dashboard-chart-grid`, then attempts to set that same element's columns in `@container`. A query container must be an ancestor of the styled element; it cannot query its own size. Meanwhile child span-two rules (including xl:col-span-2) can create implicit columns without the intended equal minmax tracks. Move container-type to a wrapper and query the inner grid; use the same container breakpoint for spanning comparison panels. Acceptance: two equal columns only when actual content width permits, one column at narrow width, including desktop with contextual rail consuming width.

3. **P2 - Zero tasks misreported as no access.** `ProjectDashboardCharts.vue` computes taskHasData as task-access availability AND a nonempty positive-count series, then always uses `projects.dashboard.charts.noTaskData` for empty state. That text explicitly says task data is unavailable for this user. A permitted portfolio with zero tasks takes the same branch. Select different empty copy for available-but-zero tasks versus unavailable tasks. Acceptance: zero-task and no-task-read fixtures show distinct truthful states.

4. **P2 - Per-project progress loses no-task distinction.** `utils/projectChartOptions.ts` rowProgress/projectProgressByProjectData pass the backend's zero-task `progress:0` through exactly like a project with tasks at 0% completion, and tooltip/label show 0% in both cases. The approved contract explicitly distinguishes no tasks from zero progress when charting progress. Keep row task state in chart data and emit a No tasks label/tooltip (and an unavailable label for null access) without pretending zero-task projects have started task progress. Progress-band chart already makes this distinction correctly.

## Bounded nonblockers / verification gaps

- ChartCanvas's outer `role=img` has only a chart-title accessible name; descendants are semantically flattened. ECharts' internal ARIA descriptions therefore may not expose values through this wrapper. A descriptive outer label generated from actual data, or avoiding conflicting nested image semantics, is a bounded accessibility improvement. Keyboard-only access to dataZoom and chart details needs runtime verification; current source exposes no explicit keyboard controls or alternate accessible per-project values.
- Currency comparison correctly filters by currency ID, retains null planned values, and escapes project/series names in custom HTML tooltips. No introduced XSS path identified.
- All-project chart builders use the complete rows array; zoom controls retain data beyond 200. Recent table explicitly slices to five and detail returnTo uses current fullPath. All Projects carries q/status. Error branch hides prior charts; no stale-on-error presentation found.
- Theme colors derive from CSS tokens and mutation/font watchers refresh options. Colors containing color-mix/var are left as CSS strings; current SVG renderer can consume CSS, but theme contrast, long project labels, large font and mobile chart controls require coordinator browser evidence.
- Task composition correctly subtracts overdue from open tasks and does not double count closed/late. Budget health correctly separates unknown plans and treats known zero budget as a real budget. No currencies are summed together.

Findings describe the source observed during review; coordinator/Luna may already be applying fixes. Reconcile with final diff and fresh runtime checks before acceptance.

## Reconciliation after Luna fixes

Re-read the exact integrated files after coordinator copied fixes. **All four reported blockers are resolved in source.**

- Metrics and recent-project components now have valid template blocks.
- A new `.dashboard-chart-container` ancestor owns container-type; the inner grid gets equal columns at 760px content width, and comparison spans use that same breakpoint. Unconditional xl spans are removed.
- Task empty copy now chooses noTaskItems for readable zero-task data and noTaskData for missing access. Both Arabic and English strings exist.
- Per-project progress points now carry tracked/no_tasks/unknown state. Labels and escaped tooltips distinguish No tasks, Unknown and genuine 0%; zero for unknown/no-task is only a positioning value.
- ChartCanvas now uses role=group rather than role=img, preserving descendant semantics, and all six options explicitly enable ECharts ARIA.

No remaining source-level blocker identified in the assigned re-review scope. Runtime chart rendering, actual container layout, null/no-task visible labels, accessibility tree and coordinator gates are still required; no fresh tests or browser checks were run by this reviewer. ECharts-generated ARIA descriptions may still describe the numeric positioning zero for unknown/no-task progress unless customized; this remains a bounded screen-reader verification concern, not a reopened visual-semantic finding. English runtime is not claimed: project currently has no locale switch and disables browser locale detection; only English source copy was reviewed.

## Final visual-edit review

Reviewed the added hydration skeleton gate, ChartCanvas direction, animation defaults and per-project mobile media options. Hydration gating uses the existing per-component useHydrated flag and keeps title/controls server-rendered; error/empty/data branches render after mount. Chart-only dir=ltr is scoped to SVG coordinate/text anchoring. Animation is disabled consistently across all six charts. No new scope or data-semantic issue found in those changes.

**P2 responsive follow-up:** `projectChartOptions.ts` projectProgressByProjectOption and projectFinanceComparisonOption add maxWidth:480 media entries without a non-query default (or matching wide breakpoint). Installed ECharts `lib/model/OptionManager.js:175-184` does not restore base options when a media query stops matching: it returns no options unless a default exists. After widening a previously narrow chart, mobile labels/tick density/padding remain, and finance stays at three-project zoom. Add fallback media options restoring the desktop values for every overridden field; verify narrow -> wide -> narrow resizing in the coordinator browser gate. All source datasets remain complete; this is a presentation-resize issue, not data truncation.

No reviewer test/build/browser execution; coordinator reported unit/type/build success independently.

## Final P2 reconciliation

Confirmed both project-chart media arrays now include a no-query default. Progress restores wide grid offsets, five ticks and 140px category labels. Finance restores wide grid offsets, label width/rotation and eight-project zoom with the desktop slider offset. **The final responsive P2 is resolved in source; no open source blocker remains from this review.** Coordinator owns the newly added resize browser regression and its result; reviewer ran no validations.
