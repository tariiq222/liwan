# Tasmim Plan 5 — The pilot: `/projects` and `/projects/[id]` on the new templates

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver phase 5 of the spec. Move the first real pages onto the Plan 4 templates: `/projects`, `/tasks` and the project task tab as list pages on `SharedListPage` + `SharedDataTable`, the project overview as a record page on `SharedRecordPage` with `SharedPropertiesPanel`, and `/projects/dashboard` on `SharedDashboardPage` + `SharedChartPanel`. Every route, URL filter, visible heading and `data-testid` stays. The plan ends at owner checkpoint CP5, the decisive one: the owner confirms or adjusts the direction before the Plan 6 rollout.

**Architecture:** Three small template additions land first (a `hideHeader` mode so a template inside the project frame draws no second heading, a create-button test id and view test ids on `ListPage`/`ViewSwitch`, a `ChartPanel` `emptyText`) plus one policy fix so a page built on a template counts as having a shell. Then four page groups move in parallel, each on its own sub-branch and mock stack, each ending with its own mock-backed pilot spec. Application tone maps, query parsers and cache keys do not move: pages hand the templates already-translated rows, cells and slots. The project workspace frame (`pages/projects/[id].vue`) is unchanged and keeps the page's only `<h1>`.

**Tech Stack:** Nuxt 4.6, Nuxt UI 4.11.1 (`UTable`, `UButton`, `UBadge`, `UCard`), Tailwind 4.3 (container queries `@container` / `@min-[…]:`), `@tanstack/vue-query`, Storybook 10.6 with `@storybook/addon-a11y`, Playwright 1.62, Vitest 4 (no DOM: SSR string rendering through `@vue/compiler-sfc` + `@vue/server-renderer`, as `components/shared/__tests__` do), Python policy checks in `tools/`.

**Spec:** `docs/superpowers/specs/2026-10-11-webvue-tasmim-design.md` (§6 page templates and states, §5 keyboard, §9 tooling, §10 phase 5 / CP5, §11 documentation, §12 verification, §13 risks). Plan 4 (`docs/superpowers/plans/2026-10-13-tasmim-plan-4-templates.md`) built the templates this plan adopts; Plan 3 (`…-plan-3-palette.md`, Task 9) owns the failing-title normalizer used here.

## Binding rulings (2026-10-13, from the owner brief — override any task text below)

1. **Scope.** Only these pages move: `/projects`; `/tasks` and `/projects/[id]/tasks`; `/projects/[id]` (overview); `/projects/dashboard`. Nothing else moves in this plan.
   - `/projects`: `SharedListPage` + `SharedDataTable`. `ProjectTable` moves onto `DataTable`; the cards become a `ViewSwitch` option. The `?view=` values and URL behaviour stay.
   - `/tasks` and `/projects/[id]/tasks`: `SharedListPage` + `SharedDataTable`. `TaskTable` moves onto `DataTable`. `?view=board` stays.
   - `/projects/[id]`: `SharedRecordPage` + `SharedPropertiesPanel` + `SharedRecordSection`, inside the existing frame. The frame keeps the `<h1>`.
   - `/projects/dashboard`: `SharedDashboardPage` + `SharedChartPanel`.
2. **Contracts that do not change:** routes and URL query filters; back navigation that keeps filters; visible headings; every `data-testid` the e2e uses; `?view=board`; `useHydrated` gating; inline destructive confirmation. Never rename an e2e title. Where the DOM legitimately changes, update the assertion in place and list it in the commit body.
3. **Mobile.** `DataTable`'s `#mobile-row` slot replaces the existing `md:hidden` lists, with the same information visible.
4. **Keyboard.** On the migrated lists `J`/`K` work (table views), `C` presses the page's own create button, `/` focuses the search. Mock e2e checks pin each.
5. **Per-task e2e gate.** Run the affected specs on the task's own mock stack and compare with `.superpowers/tasmim-shared/e2e-cp3-failures.txt`. Only NEW failures count (recipe in Global Constraints).
6. **Parallel execution.** Each task runs on `codex/web-tasmim-p5-<slug>` in its own worktree with mock ports `43NN`/`47NN` (NN is the task number). Files are kept disjoint across tasks (the few shared append-only files are listed below).
7. **CP5 is the last task:** full gates, Storybook gates, the failing-title diff, and screenshots of the four page groups in ar/en × light/dark, desktop and 390px mobile.

## Waves

| Wave | Tasks | Notes |
|---|---|---|
| 1 — templates and policy | T1 `chartpanel`, T2 `templates`, T3 `shells` | Parallel. Disjoint files. Merge all three into `codex/web-tasmim` before wave 2 starts. |
| 2 — the four page groups | T4 `projects-list`, T5 `tasks-lists`, T6 `project-record`, T7 `dashboard` | Parallel. Branch from the merged wave-1 tip. |
| 3 — checkpoint | T8 `cp5` | Branches from the merged wave-2 tip. |

| Task | Branch · worktree | Mock ports |
|---|---|---|
| T1 | `codex/web-tasmim-p5-chartpanel` · `.worktrees/tasmim-p5-chartpanel` | Nuxt 4301, mock 4701 |
| T2 | `codex/web-tasmim-p5-templates` · `.worktrees/tasmim-p5-templates` | 4302, 4702 |
| T3 | `codex/web-tasmim-p5-shells` · `.worktrees/tasmim-p5-shells` | 4303, 4703 |
| T4 | `codex/web-tasmim-p5-projects-list` · `.worktrees/tasmim-p5-projects-list` | 4304, 4704 |
| T5 | `codex/web-tasmim-p5-tasks-lists` · `.worktrees/tasmim-p5-tasks-lists` | 4305, 4705 |
| T6 | `codex/web-tasmim-p5-project-record` · `.worktrees/tasmim-p5-project-record` | 4306, 4706 |
| T7 | `codex/web-tasmim-p5-dashboard` · `.worktrees/tasmim-p5-dashboard` | 4307, 4707 |
| T8 | `codex/web-tasmim-p5-cp5` · `.worktrees/tasmim-p5-cp5` | 4308, 4708 |

## Orchestrator notes (binding)

1. **Setup per task** (run by the orchestrator, or by the task agent as its first step):

   ```bash
   cd /Users/tariq/code/nasq/.worktrees/tasmim
   git worktree add ../tasmim-p5-<slug> -b codex/web-tasmim-p5-<slug> codex/web-tasmim
   cd ../tasmim-p5-<slug> && npm ci --ignore-scripts
   ```

   Worktrees get their own `node_modules` and `.nuxt`; nothing is symlinked. The orchestrator verifies each branch, reviews it, and merges it with `--no-ff` into `codex/web-tasmim`. Task agents never touch `codex/web-tasmim`, `main` or any remote.
2. **Prerequisite P0 (orchestrator, before wave 1): the e2e gate script.** Save the script under *The e2e gate recipe* (Global Constraints) as `/Users/tariq/code/nasq/.worktrees/tasmim/.superpowers/tasmim-shared/p5-e2e.sh`, `chmod +x` it, and check `.superpowers/tasmim-shared/e2e-cp3-failures.txt` exists (196 lines). Both live in the untracked shared folder, so every worktree reads the same copy.
3. **Shared append-only files, reconciled at merge** (the second branch to merge resolves a trivial union, or regenerates the file):
   - `docs/design-system/components.md` (T4 appends one row, T8 edits two lines);
   - `docs/design-system/catalog.json` (regenerate with `node tools/ui_catalog.mjs` after every merge);
   - `apps/web/i18n/locales/{ar,en}/common.json` (T2 adds `states.untitled`; nothing else in wave 2 adds a key);
   - `apps/web/e2e/shortcuts-tasmim.spec.ts`: T4 edits the `/projects` lines and T5 the single `/tasks` line of the same existing test (they are separated by unchanged lines); merge both.
4. **Merge order inside a wave does not matter.** Wave 2 branches start from the merged wave-1 tip, so T2's props and T3's policy are already there.
5. **Owner decisions taken for this plan** (the owner said «تصرف»; listed again in the CP5 note for confirmation):
   - (a) The frame keeps the `<h1>`; the overview and the project task tab add no heading (`hideHeader`). Plan 6 pages that sit in a frame reuse the same prop.
   - (b) Cards stay the default view of `/projects` (the bare URL); `?view=table` is the table; `?view=cards` still opens the cards. Choosing cards in the switch drops `view` from the URL.
   - (c) The view switch shows on phones too (it was hidden below `md`). Phones get cards, or the table's mobile rows.
   - (d) `C` now creates the page's own record on the migrated lists: «مشروع جديد» on `/projects`, «مهمة جديدة» on `/tasks` and the project tab.
   - (e) `J`/`K` work in table views only (cards are not rows).

## Global Constraints

- Work for each task only in its own worktree on its own sub-branch (see *Waves*). The orchestrator alone merges into `codex/web-tasmim`. Never commit to or push `main`. Never push at all. Read-only commands only in `/Users/tariq/code/nasq/.worktrees/tasmim` while tasks run.
- Commit subjects: `type(web|tools|docs): imperative subject`, ≤ 72 chars, with `type` ∈ `feat fix refactor perf test docs ci build chore`. One logical change per commit. End every message with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` (use the trailer your own session names; the snippets show this one).
- `npm -w apps/web run lint` (from the worktree root; never `npx -w`) and `npm test` must be green at **every** commit. A commit that changes a component's props runs `node tools/ui_catalog.mjs` and includes the regenerated `docs/design-system/catalog.json`.
- No changes under `odoo-addons/`, `packages/contracts/`, `packages/commercial-contracts/` or `apps/control-plane/`. No new API endpoint, request, route or visible heading.
- **Contracts kept (ruling 2).** Existing `data-testid`s stay, including `project-new`, `project-header-create`, `project-templates-link`, `projects-toolbar`, `projects-status-filter`, `projects-sort`, `projects-result-count`, `projects-view-table`, `projects-view-cards`, `project-row`, `project-card`, `project-status`, `project-progress`, `project-menu`, `project-overview`, `project-active-tasks`, `project-overview-latest-update`, `deadline-badge`, `project-dashboard-page`, `project-dashboard-empty`, `project-dashboard-analytics-error`, `chart-status`, `chart-tasks`, `chart-progress-bands`, `chart-budget-health`, `chart-project-progress`, `chart-project-finance`, `chart-currency-filter`, `recent-project-row`, `metric-tile`, `project-workspace-*`, `project-tab-*`, `governance-tab-*`. Never rename an e2e test title: the failing-title diff keys on titles.
- **Pinned unit tests that load a page's real `<script setup>`.** These run in `npm test` and must stay green; edit one only where this plan says so:
  - `app/pages/__tests__/projectSectionGuards.test.ts` reads `notFound`, `canCreate`, `isBoard` and `stageSource` from `pages/projects/[id]/tasks.vue`.
  - `app/pages/__tests__/taskBackTargets.test.ts` reads `taskTo` from `pages/projects/[id]/tasks.vue` and (today) `openTask` from `pages/tasks.vue`. T5 changes the second to `taskTo`, in place.
  - `app/pages/__tests__/uiReviewNavigationForms.test.ts` renders `pages/projects/[id]/tasks.vue` with every capitalised tag stubbed (the stub renders only the `default`, `header` and `view` slots, with no slot props) and reads the first `NuxtLink`. So that page must keep: no destructured slot props in its template, and the archive link as the first `NuxtLink` it renders.
- R3: nothing under `components/shared/` imports or tags an application component folder (`project task meetings hr chat access vendor subscription settings`) or an application util. Pages and application components may use `Shared*`. `python3 -B tools/arch_policy.py` stays at exit 0; `tools/arch_baseline.json` and `tools/arch_layers.json` are not touched.
- Logical properties only (`ms- me- ps- pe- start- end- text-start`, `inset-inline-*`). Direction icons flip with `rtl:-scale-x-100` or `ltr:rotate-180`.
- `useHydrated()`: every interactive control stays disabled until hydrated (`ListPage`'s create button, `ViewSwitch` and `DataTable` already do). A list's dynamic result surface that is mounted behind `hydrated` today (`/tasks`) stays behind it.
- One keyboard layer: rows use `data-shortcut-row` (marked by `DataTable`), the search `data-shortcut-search` (inside `FilterBar`), the create `data-shortcut-create` (on `ListPage`'s button). No `defineShortcuts`, no `event.key === '<letter>'`. **One `DataTable` per page.**
- Overlays: no new `UModal`, `USlideover` or `UDrawer`. Destructive actions keep their inline confirmation (`ProjectMenu` archive confirm).
- i18n: the only new key is `states.untitled` (T2, ar/en parity). Every page string reuses an existing key. Arabic first, RTL first.
- **Stories.** `a11y.test = 'error'` on template stories. A prop change runs `node tools/ui_catalog.mjs`. Every new `components/**/*.vue` needs its exact path in `docs/design-system/components.md` (only `ProjectCardBody.vue`, T4). A story's `storyContext(<file:line>)` must cite a file that still mentions the story's component: after editing a cited file run `python3 -B tools/ui_policy.py --refresh-story-context`, and repoint by hand the cases each task lists.
- **Tests without a DOM.** The web suite has no jsdom. Component tests of `components/shared/*` use `renderShared(name, props, slots, options)` (`components/shared/__tests__/helpers/renderShared.ts`). Application components and pages are pinned by the mock-backed Playwright specs each task adds (`e2e/pilot-*.spec.ts`) and by the existing pinned tests above.
- **Visual baselines.** A diff in a family the task did not intend to change is a defect: investigate before `--update-snapshots`. `git status --short apps/web/e2e/storybook-visual.spec.ts-snapshots` must show only the families the task lists.
- **Ports and processes.** Never use ports 3000/8069 or the `odoo19` database. Use only the task's `43NN`/`47NN`. Start background processes with `& PID=$!` and wait on that PID (`while kill -0 "$PID" 2>/dev/null; do sleep 1; done`). Never use `pgrep -f`. If `npx nuxt dev` leaves a child on the port after `kill`, stop it by port: `lsof -ti tcp:43NN | xargs kill`. Storybook specs start their own server on a random port.
- **Anti-loop.** The same check failing twice with the same cause stops the task and is reported. A test the plan asks for is never weakened to pass. If a step's expected output differs, report it instead of editing the expectation.

### The e2e gate recipe

Every page task runs `p5-e2e.sh <NN> <spec>…` from its worktree's `apps/web`. The script starts the mock API on `47NN` and Nuxt on `43NN`, runs the given specs with `E2E_PROJECT_POPUPS=1`, normalizes the failing titles exactly as Plan 3 Task 9 does, and prints the titles that are NEW against the CP3 list, restricted to the specs it ran. **The pass condition is an empty `NEW failures` block.** A title that is also in the CP3 list is not counted, fixed or not. Most project and task specs already fail on this mock (CP3: 196 failures), so the new `e2e/pilot-*.spec.ts` files are the real protection: they must pass in full.

```bash
#!/usr/bin/env bash
# Usage, from a task worktree's apps/web:  p5-e2e.sh <NN> <spec> [<spec> ...]
set -u
NN="$1"; shift
NUXT_PORT="43${NN}"; MOCK_PORT="47${NN}"
SHARED=/Users/tariq/code/nasq/.worktrees/tasmim/.superpowers/tasmim-shared
OUT=$(mktemp -d)
norm() {
  python3 -c '
import re, sys
for line in sys.stdin:
    s = re.sub(r"\x1b\[[0-9;]*m", "", line).strip()
    s = re.sub(r"^\[[^\]]*\] › ", "", s)
    s = re.sub(r"^(\S+\.spec\.ts):\d+:\d+ ", r"\1 ", s)
    s = re.sub(r"[─\s]+$", "", s)
    if s:
        print(s[:90])
' | sort -u
}
PROJECTS_UI_PREVIEW=1 MODULE_UI_PREVIEW=1 MOCK_PORT="$MOCK_PORT" node e2e/internal-ui-audit-mock.mjs > "$OUT/mock.log" 2>&1 & MOCK_PID=$!
NUXT_ODOO_URL="http://127.0.0.1:$MOCK_PORT" NUXT_ODOO_DB=webvue_ui_mock_only NUXT_PUBLIC_WS_URL="ws://127.0.0.1:$MOCK_PORT/websocket" npx nuxt dev --port "$NUXT_PORT" > "$OUT/nuxt.log" 2>&1 & NUXT_PID=$!
for i in $(seq 1 120); do curl -sf -o /dev/null "http://localhost:$NUXT_PORT/login" && break; sleep 2; done
FORCE_COLOR=0 E2E_BASE_URL="http://localhost:$NUXT_PORT" E2E_PROJECT_POPUPS=1 npx playwright test "$@" --reporter=line > "$OUT/e2e.log" 2>&1 || true
awk '/^ +[0-9]+ failed$/{f=1;next} f && /^ +[0-9]+ (flaky|passed|skipped|interrupted|did not run)/{f=0} f' "$OUT/e2e.log" > "$OUT/failures.txt"
: > "$OUT/baseline.restricted"
for spec in "$@"; do grep -F "$spec:" "$SHARED/e2e-cp3-failures.txt" >> "$OUT/baseline.restricted"; done
norm < "$OUT/baseline.restricted" > "$OUT/baseline.norm"
norm < "$OUT/failures.txt" > "$OUT/now.norm"
echo "== summary"; grep -E "^ +[0-9]+ (passed|failed|flaky|skipped|did not run)" "$OUT/e2e.log"
echo "== NEW failures (empty is the pass condition)"; comm -13 "$OUT/baseline.norm" "$OUT/now.norm"
echo "== FIXED (not counted)"; comm -23 "$OUT/baseline.norm" "$OUT/now.norm"
echo "== logs in $OUT"
kill "$NUXT_PID" "$MOCK_PID" 2>/dev/null
while kill -0 "$NUXT_PID" 2>/dev/null || kill -0 "$MOCK_PID" 2>/dev/null; do sleep 1; done
lsof -ti "tcp:$NUXT_PORT" | xargs kill 2>/dev/null
exit 0
```

A title that fails alone but only under load (Plan 3 CP3: `project-clarity`) is re-run alone; it counts as a flake only if it then passes.

## Review Focus

The five input classes the spec implies but no existing test exercises, most likely first. Each line names the task whose test pins it.

1. **Search typed, then a row opened before the 250 ms debounce lands.** The user types in the projects search and immediately clicks a project (the name link, or the row background). Expected: the project page's `returnTo` carries the search (`q=…`), so its Back control returns to the filtered list; nothing is dropped. Pinned in T4 (`pilot-projects.spec.ts`: "a row opened right after typing keeps the search in its return path").
2. **A `?view=` value the list does not offer.** An old link (`/projects?view=gantt`, `/tasks?view=cards`) or a hand-edited URL. Expected: the list's default view (cards on `/projects`, table on `/tasks`), never a blank page; every other filter in the URL is kept when the user then switches view; an explicit `?view=cards` still opens the cards. Pinned in T4 (`pilot-projects.spec.ts` "an unknown or explicit ?view= opens a list view and a switch keeps the other filters") and T5 (`pilot-tasks.spec.ts` "an unknown ?view= shows the table and ?view=board survives a task round trip").
3. **A 390px phone.** The desktop table is `display: none` and the mobile rows are visible. Expected: `J` moves between the visible mobile rows only, the row still shows name, status, progress, manager, date and the actions menu (projects) or state, priority and deadline (tasks), and nothing overflows horizontally. Pinned in T4 and T5 (`"on a 390px phone the mobile rows carry the same information and J skips the hidden table"`).
4. **Exactly one `<h1>` in the project workspace.** The overview and the task tab sit under the frame's `<h1>`; the frame's heading is absent while the project is loading or when it failed to load. Expected: never two top-level headings and never a new `<h2>` where the page had none (the overview's two section headings are the only ones). Pinned in T2 (`PageHeader.hideTitle.test.ts` "draws the actions alone when the title is hidden"; `ListPage.test.ts` and `RecordPage.test.ts` "hideHeader draws no heading…") and T5/T6 (`pilot-tasks.spec.ts` "the project tab keeps the frame heading as the only heading…", `pilot-project-record.spec.ts` "the frame keeps the only h1 and the overview adds exactly its two section headings").
5. **Missing data.** A chart with no rows, an analytics call that fails or returns nothing, a project with no dates. Expected: the chart panel shows the chart's own empty sentence (never the generic one when the caller gave text, and never a blank card); the dashboard keeps its `project-dashboard-empty` / `project-dashboard-analytics-error` blocks with a working retry; a property with no value shows «—» with a screen-reader «لا قيمة»; a record with a blank name shows «بلا عنوان», not an empty heading. Pinned in T1 (`ChartPanel.emptyText.test.ts`), T2 (`RecordPage.test.ts` "names a record without a name «untitled» once it has loaded"), T6 (`pilot-project-record.spec.ts` "a project without dates shows dashes with a spoken «لا قيمة»") and T7 (`pilot-dashboard.spec.ts` "analytics failure and an empty result keep their blocks, and the failure retries").

---

## Wave 1 — templates and policy

### Task 1: `ChartPanel` takes the chart's own empty sentence

`DashboardChartPanel` (the project dashboard) shows a different sentence per chart when there is nothing to draw («لا توجد بيانات حالة» for the status pie, «لا توجد بنود مالية» for finance, and so on). `SharedChartPanel` only knows the generic `states.chartEmpty`. This task adds an optional `emptyText` so T7 can move the dashboard's panels onto the template without losing any sentence. A blank text falls back to the generic line, so a panel is never empty and never blank.

**Files:**
- Modify: `apps/web/app/components/shared/ChartPanel.vue`
- Create: `apps/web/app/components/shared/__tests__/ChartPanel.emptyText.test.ts`
- Modify: `apps/web/stories/shared/ChartPanel.stories.ts` (one story)
- Regenerate: `docs/design-system/catalog.json`; 4 new PNGs `shared-chartpanel--empty-with-text-*`

**Interfaces:**
- Consumes: `renderShared` (`components/shared/__tests__/helpers/renderShared.ts`), `states.chartEmpty`.
- Produces: `SharedChartPanel` gains the optional prop `emptyText?: string`. It shows when `empty` is true and `loading` is false; a missing, empty or whitespace-only value shows `$t('states.chartEmpty')`. T7 passes `:empty-text`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/components/shared/__tests__/ChartPanel.emptyText.test.ts`:

```ts
import { h } from 'vue'
import { describe, expect, it } from 'vitest'
import { renderShared } from './helpers/renderShared'

const chart = () => h('svg', { 'data-chart': '' })

describe('SharedChartPanel emptyText', () => {
  it('shows the caller sentence instead of the generic empty line', async () => {
    const html = await renderShared('ChartPanel', { title: 'Budget', empty: true, emptyText: 'No budget set yet' }, { default: chart })
    expect(html).toContain('No budget set yet')
    expect(html).not.toContain('states.chartEmpty')
    expect(html).not.toContain('data-chart')
  })

  it('falls back to the generic line for a missing, empty or blank sentence', async () => {
    for (const emptyText of [undefined, '', '   ']) {
      const html = await renderShared('ChartPanel', { title: 'Budget', empty: true, emptyText }, { default: chart })
      expect(html, JSON.stringify(emptyText)).toContain('states.chartEmpty')
    }
  })

  it('shows the chart, not the sentence, while there is data', async () => {
    const html = await renderShared('ChartPanel', { title: 'Budget', emptyText: 'No budget set yet' }, { default: chart })
    expect(html).toContain('data-chart')
    expect(html).not.toContain('No budget set yet')
  })

  it('shows the loading placeholder, not the sentence, while loading', async () => {
    const html = await renderShared('ChartPanel', { title: 'Budget', loading: true, empty: true, emptyText: 'No budget set yet' }, { default: chart })
    expect(html).toContain('role="status"')
    expect(html).not.toContain('No budget set yet')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim-p5-chartpanel/apps/web && npx vitest run app/components/shared/__tests__/ChartPanel.emptyText.test.ts
```

Expected: FAIL. "shows the caller sentence…" reports `expected '<section …states.chartEmpty…' to contain 'No budget set yet'`; the other three pass.

- [ ] **Step 3: Implement**

In `apps/web/app/components/shared/ChartPanel.vue`, replace the script's props block and add the computed:

```ts
// One chart on a dashboard (Tasmim Plan 4): a titled card whose body is the chart in
// the default slot, a loading placeholder, or one empty line. `emptyText` is that line
// when the chart has its own words ("no budget set yet"); without it the generic
// states.chartEmpty shows. It draws no chart itself, so SharedDashboardChart or any
// other figure goes in the slot; `actions` sits at the header's inline end (a currency
// or period select). In SharedDashboardPage a wide chart spans both columns with
// class="@min-[768px]:col-span-2".
const props = withDefaults(defineProps<{
  title: string
  description?: string
  loading?: boolean
  empty?: boolean
  emptyText?: string
}>(), {
  loading: false,
  empty: false,
})
const { t } = useI18n()
const titleId = useId()
const emptyLine = computed(() => props.emptyText?.trim() || t('states.chartEmpty'))
```

(Delete the previous leading comment block of the script; the new one replaces it.) In the template replace the empty line

```vue
    <p v-else-if="props.empty" class="flex min-h-56 items-center justify-center text-center text-sm text-muted">{{ t('states.chartEmpty') }}</p>
```

with

```vue
    <p v-else-if="props.empty" class="flex min-h-56 items-center justify-center text-center text-sm text-muted">{{ emptyLine }}</p>
```

- [ ] **Step 4: Run the tests**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim-p5-chartpanel/apps/web && npx vitest run app/components/shared/__tests__/ChartPanel.emptyText.test.ts app/components/shared/__tests__/DashboardPage.test.ts
```

Expected: PASS (all four new tests, and the existing `SharedChartPanel` and `SharedDashboardPage` suites).

- [ ] **Step 5: The story, the catalog and the baseline**

Append to `apps/web/stories/shared/ChartPanel.stories.ts`:

```ts
export const EmptyWithText: Story = {
  name: 'لا بيانات بنص خاص بالمخطط',
  args: { empty: true },
  render: args => ({
    components: { ChartPanel },
    setup: () => ({ args, t: useI18n().t }),
    template: `<div class="max-w-xl">
      <ChartPanel v-bind="args" :title="t('projects.dashboard.charts.budgetHealthTitle')" :description="t('projects.dashboard.charts.budgetHealthDescription')" :empty-text="t('projects.dashboard.charts.noBudgetData')" />
    </div>`,
  }),
}
```

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim-p5-chartpanel
python3 -B tools/ui_policy.py --refresh-story-context && node tools/ui_catalog.mjs
npm -w apps/web run lint && npm test 2>&1 | tail -4
cd apps/web && npm run build-storybook >/dev/null
npx playwright test e2e/storybook-visual.spec.ts -g 'shared-chartpanel--empty-with-text' --update-snapshots=missing --reporter=line | tail -3
WEBVUE_REQUIRE_STORYBOOK=1 npx playwright test e2e/storybook-visual.spec.ts e2e/storybook-smoke.spec.ts -g 'shared-chartpanel' --reporter=line | tail -4
git status --short e2e/storybook-visual.spec.ts-snapshots | grep -v 'shared-chartpanel--empty-with-text'; echo "unexpected=$?"
```

Expected: lint and `npm test` pass; 4 PNGs written; the second run passes every `shared-chartpanel` screenshot, axe and smoke test; `unexpected=1` (the `grep -v` prints nothing).

- [ ] **Step 6: Commit**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim-p5-chartpanel
git add apps/web docs/design-system
git commit -m "feat(web): let ChartPanel show the chart's own empty sentence

An optional emptyText replaces the generic line when a chart has
words of its own; a blank text still falls back to the generic one.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: A frame-owned header, a create test id, view test ids and a blank-title fallback

Inside the project workspace the frame is the page's `<h1>` and `PageHeader` already demotes itself to `<h2>`. The overview and the task tab have **no** heading today (ruling 2: headings do not change), so a template there must draw no heading at all, while its actions (the create button) still render. This task adds one mechanism, `PageHeader` `hideTitle`, and one prop, `hideHeader`, on the four templates that wrap a `PageHeader` (`ListPage`, `RecordPage`, `DashboardPage`, `TimelineFrame`). It also adds three things the pilot pages need from the templates: a test id on `ListPage`'s create button, a test id per `ViewSwitch` option, and `RecordPage`'s blank-title fallback (the Plan 4 review note), plus a `filters` slot on `DashboardPage` (the dashboard's filter bar sits between the heading and the metrics).

Four commits, one per logical change.

**Files:**
- Modify: `apps/web/app/components/shared/PageHeader.vue`, `ListPage.vue`, `ViewSwitch.vue`, `RecordPage.vue`, `DashboardPage.vue`, `TimelineFrame.vue`
- Modify: `apps/web/app/utils/listView.ts` (one optional field)
- Modify: `apps/web/i18n/locales/ar/common.json`, `apps/web/i18n/locales/en/common.json` (`states.untitled`)
- Create: `apps/web/app/components/shared/__tests__/PageHeader.hideTitle.test.ts`
- Modify: `apps/web/app/components/shared/__tests__/ListPage.test.ts`, `RecordPage.test.ts`, `DashboardPage.test.ts`, `TimelineFrame.test.ts`
- Modify: `apps/web/stories/shared/PageHeader.stories.ts` (one story)
- Regenerate: `docs/design-system/catalog.json`; 4 new PNGs `shared-pageheader--hidden-title-*`

**Interfaces:**
- Consumes: `renderShared` and `SharedRenderOptions` (Plan 4 Task 1); `usePageHeader`, `useEscapeBack`, `useProjectFrameHeading` (stubbed through `options.globals`).
- Produces:
  - `SharedPageHeader` prop `hideTitle?: boolean`. When true it draws no heading, description or back control; it draws only the `actions`/default slot (inside the same `<header data-slot="page-header">`), or nothing at all when there are none. It still registers the title with the shell and still answers Escape through `backTo`.
  - `SharedListPage` props `hideHeader?: boolean` and `createTestId?: string`. `hideHeader` passes `hideTitle` to the header; the create button and the `actions` slot still render. `createTestId` becomes the create button's `data-testid`.
  - `ListViewOption` (`utils/listView.ts`) gains `testId?: string`; `SharedViewSwitch` renders it as the option button's `data-testid`.
  - `SharedRecordPage` props `hideHeader?: boolean`. A blank `title` shows `$t('states.untitled')` once the record is ready (not loading, no error).
  - `SharedDashboardPage` and `SharedTimelineFrame` props `hideHeader?: boolean`; `SharedDashboardPage` slot `filters`, drawn between the header and the metric row.
  - i18n `states.untitled`: ar «بلا عنوان», en «Untitled».

#### Commit A — `PageHeader` `hideTitle`

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/components/shared/__tests__/PageHeader.hideTitle.test.ts`:

```ts
import * as Vue from 'vue'
import { h } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { renderShared, type SharedRenderOptions } from './helpers/renderShared'

const registerTitle = vi.fn()
const escapeTarget = vi.fn()
function options(frameOwnsHeading = false): SharedRenderOptions {
  return {
    globals: {
      usePageHeader: registerTitle,
      useEscapeBack: escapeTarget,
      useProjectFrameHeading: () => Vue.ref(frameOwnsHeading),
    },
  }
}
const actions = { actions: () => h('button', 'Create') }
// SSR marks slot boundaries with comments; the assertions read the markup without them.
const clean = (html: string) => html.replace(/<!--[\s\S]*?-->/g, '')

describe('SharedPageHeader hideTitle', () => {
  it('still draws the heading, description and back control by default', async () => {
    const html = clean(await renderShared('PageHeader', { title: 'Tasks', description: 'All tasks', backTo: '/projects', backLabel: 'Back to projects' }, actions, options()))
    expect(html).toMatch(/<h1[^>]*>Tasks<\/h1>/)
    expect(html).toContain('All tasks')
    expect(html).toContain('href="/projects"')
  })

  it('still demotes to h2 under a frame that owns the heading', async () => {
    const html = clean(await renderShared('PageHeader', { title: 'Tasks' }, actions, options(true)))
    expect(html).toMatch(/<h2[^>]*>Tasks<\/h2>/)
    expect(html).not.toContain('<h1')
  })

  it('draws the actions alone when the title is hidden', async () => {
    const html = clean(await renderShared('PageHeader', { title: 'Tasks', description: 'All tasks', backTo: '/projects', hideTitle: true }, actions, options()))
    expect(html).toContain('data-slot="page-header"')
    expect(html).toContain('<button>Create</button>')
    expect(html).not.toMatch(/<h[12]/)
    expect(html).not.toContain('All tasks')
    expect(html).not.toContain('href="/projects"')
  })

  it('draws nothing when the title is hidden and there is nothing else to show', async () => {
    const html = clean(await renderShared('PageHeader', { title: 'Tasks', hideTitle: true }, {}, options()))
    expect(html).not.toContain('page-header')
    expect(html).not.toMatch(/<h[12]/)
  })

  it('keeps naming the page for the shell and keeps the Escape target', async () => {
    registerTitle.mockClear()
    escapeTarget.mockClear()
    await renderShared('PageHeader', { title: 'Tasks', description: 'All tasks', backTo: '/projects', hideTitle: true }, {}, options())
    const [title, description] = registerTitle.mock.calls[0]!
    expect(title()).toBe('Tasks')
    expect(description()).toBe('All tasks')
    expect(escapeTarget.mock.calls[0]![0]()).toBe('/projects')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim-p5-templates/apps/web && npx vitest run app/components/shared/__tests__/PageHeader.hideTitle.test.ts
```

Expected: FAIL in "draws the actions alone…" (`expected … not to match /<h[12]/`) and "draws nothing…"; the other three pass.

- [ ] **Step 3: Implement**

In `apps/web/app/components/shared/PageHeader.vue` make three edits.

1. Props:

```ts
const props = defineProps<{
  title: string
  description?: string
  backTo?: RouteLocationRaw
  backLabel?: string
  /** A frame around the page already shows the heading (the project workspace's h1): draw the actions only. The title still names the page for the shell and `backTo` still answers Escape. */
  hideTitle?: boolean
}>()
```

2. The root element gets a condition:

```vue
  <header
    v-if="!props.hideTitle || $slots.actions || $slots.default"
    data-slot="page-header"
    data-empty="false"
    class="flex flex-wrap items-center justify-between gap-4"
  >
```

3. The title block is the one the title owns:

```vue
      <div v-if="!props.hideTitle" class="min-w-0">
```

(replacing `<div class="min-w-0">`; its content is unchanged).

- [ ] **Step 4: Run the tests**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim-p5-templates/apps/web && npx vitest run app/components/shared/__tests__/PageHeader.hideTitle.test.ts app/components/shared/__tests__/headerBackRule.ssr.test.ts
```

Expected: PASS (the back-rule suite is unchanged).

- [ ] **Step 5: The story, the catalog and the baseline**

Append to `apps/web/stories/shared/PageHeader.stories.ts`:

```ts
export const HiddenTitle: Story = {
  name: 'عنوان يملكه الإطار',
  parameters: storyContext('unused', 'داخل إطار مشروع يملك العنوان: `hideTitle` يرسم الإجراءات وحدها ويبقى اسم الصفحة مسجلًا للغلاف.'),
  render: () => ({
    components: { PageContainer, PageHeader },
    setup: () => ({ t: useI18n().t }),
    template: `<main class="webvue-shell-main"><PageContainer width="list"><h1 class="text-xl font-semibold text-highlighted">{{ t('projects.title') }}</h1><PageHeader :title="t('tasks.title')" hide-title><template #actions><UButton icon="i-lucide-plus">{{ t('tasks.new') }}</UButton></template></PageHeader></PageContainer></main>`,
  }),
}
```

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim-p5-templates
python3 -B tools/ui_policy.py --refresh-story-context && node tools/ui_catalog.mjs
npm -w apps/web run lint && npm test 2>&1 | tail -4
cd apps/web && npm run build-storybook >/dev/null
npx playwright test e2e/storybook-visual.spec.ts -g 'shared-pageheader--hidden-title' --update-snapshots=missing --reporter=line | tail -3
WEBVUE_REQUIRE_STORYBOOK=1 npx playwright test e2e/storybook-visual.spec.ts e2e/storybook-smoke.spec.ts -g 'shared-pageheader' --reporter=line | tail -4
git status --short e2e/storybook-visual.spec.ts-snapshots | grep -v 'shared-pageheader--hidden-title'; echo "unexpected=$?"
```

Expected: lint and `npm test` pass; 4 PNGs written; the `shared-pageheader` screenshots and smoke tests pass; `unexpected=1`.

- [ ] **Step 6: Commit**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim-p5-templates
git add apps/web docs/design-system
git commit -m "feat(web): let PageHeader hide its title inside a frame

hideTitle draws the actions alone, keeps the shell title and the
Escape target, and draws nothing when there are no actions.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

#### Commit B — `ListPage` `hideHeader` and `createTestId`, `ViewSwitch` option test ids

- [ ] **Step 7: Write the failing tests**

In `apps/web/app/components/shared/__tests__/ListPage.test.ts`, inside `describe('SharedListPage', …)` before its closing `})`, add:

```ts
  it('passes a create test id to the create button', async () => {
    const html = await renderShared('ListPage', { title: 'Projects', createTo: '/projects/new', createTestId: 'project-new' }, {}, options())
    expect(html).toMatch(/<a(?=[^>]*data-testid="project-new")(?=[^>]*data-shortcut-create)[^>]*>/)
  })

  it('hideHeader draws no heading but keeps the create button and the actions', async () => {
    const html = await renderShared('ListPage', { title: 'Tasks', hideHeader: true, createTo: '/projects/1/tasks/new' }, { actions: () => h('button', 'Archived') }, options())
    expect(html).not.toMatch(/<h[12]/)
    expect(html).toContain('data-slot="page-header"')
    expect(html).toContain('data-shortcut-create')
    expect(html).toContain('Archived')
  })

  it('hideHeader with no create button and no actions renders no page header', async () => {
    const html = await renderShared('ListPage', { title: 'Tasks', hideHeader: true }, showView, options())
    expect(html).not.toContain('data-slot="page-header"')
    expect(html).not.toMatch(/<h[12]/)
  })
```

Inside `describe('SharedViewSwitch', …)` add:

```ts
  it('puts an option test id on its button only when the option has one', async () => {
    const withIds = [{ ...views[0]!, testId: 'projects-view-table' }, views[1]!]
    const html = await renderShared('ViewSwitch', { modelValue: 'table', options: withIds }, {}, { stubs: { UTooltip: TooltipStub } })
    expect(html).toMatch(/<button(?=[^>]*data-view="table")(?=[^>]*data-testid="projects-view-table")[^>]*>/)
    expect(html.match(/data-testid=/g)).toHaveLength(1)
  })
```

- [ ] **Step 8: Run and watch them fail**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim-p5-templates/apps/web && npx vitest run app/components/shared/__tests__/ListPage.test.ts
```

Expected: FAIL in the four new tests (no `data-testid`, a heading still drawn).

- [ ] **Step 9: Implement**

`apps/web/app/utils/listView.ts` — extend the option:

```ts
/** One choice of SharedViewSwitch: the `?view=` value, its translated label, its icon and an optional test id. */
export interface ListViewOption { value: string; label: string; icon: string; testId?: string }
```

`apps/web/app/components/shared/ViewSwitch.vue` — add the attribute to the option button, after `:data-view="option.value"`:

```vue
        :data-testid="option.testId"
```

`apps/web/app/components/shared/ListPage.vue` — extend the props and the comment:

```ts
 * data-shortcut-search, so `/` focuses it. On a ListPage, filters go in its #filters slot, not in
 * the DataTable's own. `hideHeader` is for a page inside a frame that already owns the heading
 * (the project workspace): no heading is drawn, the create button and the actions still are.
 */
const props = defineProps<{
  title: string
  description?: string
  createTo?: RouteLocationRaw
  createLabel?: string
  /** The create button's data-testid, for pages whose e2e already name it. */
  createTestId?: string
  views?: ListViewOption[]
  hideHeader?: boolean
}>()
```

(keep the earlier lines of the existing comment above it) and in the template:

```vue
    <PageHeader :title="props.title" :description="props.description" :hide-title="props.hideHeader">
      <template v-if="props.createTo || $slots.actions" #actions>
        <UButton
          v-if="props.createTo"
          :to="props.createTo"
          icon="i-lucide-plus"
          data-shortcut-create
          :data-testid="props.createTestId"
          aria-keyshortcuts="c"
          :disabled="!hydrated"
        >{{ props.createLabel ?? t('app.create') }}</UButton>
```

- [ ] **Step 10: Run, regenerate, commit**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim-p5-templates
(cd apps/web && npx vitest run app/components/shared/__tests__/ListPage.test.ts app/utils/__tests__/listView.test.ts)
node tools/ui_catalog.mjs && python3 -B tools/ui_policy.py
npm -w apps/web run lint && npm test 2>&1 | tail -4
git add apps/web docs/design-system
git commit -m "feat(web): add hideHeader and test ids to the list template

ListPage takes hideHeader and a create test id; ViewSwitch options
may carry a test id, so existing e2e names keep working.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

Expected: the vitest files pass, catalog and policy exit 0, lint and `npm test` pass.

#### Commit C — `RecordPage` `hideHeader` and the blank-title fallback

- [ ] **Step 11: Write the failing tests**

Append to `apps/web/app/components/shared/__tests__/RecordPage.test.ts` (it already defines `options`, `clean` and `record`):

```ts
describe('SharedRecordPage blank title and hideHeader', () => {
  it('names a record without a name «untitled» once it has loaded', async () => {
    for (const title of ['', '   ']) {
      const html = await renderShared('RecordPage', { title }, record, options)
      expect(clean(html), JSON.stringify(title)).toMatch(/<h1[^>]*>states\.untitled<\/h1>/)
    }
  })

  it('keeps the fallback away from a record that is loading or failed', async () => {
    expect(await renderShared('RecordPage', { title: '', loading: true }, record, options)).not.toContain('states.untitled')
    expect(await renderShared('RecordPage', { title: '', error: { status: 500 } }, record, options)).not.toContain('states.untitled')
  })

  it('hideHeader draws no heading, and keeps actions, tabs, body and aside', async () => {
    const html = clean(await renderShared('RecordPage', { title: 'Alpha', hideHeader: true }, record, options))
    expect(html).not.toMatch(/<h[12]/)
    for (const kept of ['Edit', 'TABS', 'MAIN', 'PROPERTIES']) expect(html).toContain(kept)
  })

  it('hideHeader with no actions draws no page header at all', async () => {
    const html = clean(await renderShared('RecordPage', { title: 'Alpha', hideHeader: true }, { default: () => h('p', 'MAIN') }, options))
    expect(html).not.toContain('data-slot="page-header"')
    expect(html).toContain('MAIN')
  })
})
```

- [ ] **Step 12: Run and watch them fail**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim-p5-templates/apps/web && npx vitest run app/components/shared/__tests__/RecordPage.test.ts
```

Expected: FAIL in all four new tests (an empty `<h1>`, a heading still drawn under `hideHeader`).

- [ ] **Step 13: Implement**

`apps/web/app/components/shared/RecordPage.vue`:

```ts
const props = defineProps<{
  title: string
  description?: string
  backTo?: RouteLocationRaw
  backLabel?: string
  loading?: boolean
  error?: unknown
  /** A frame around the page already shows the heading (the project workspace): draw no heading. Actions still render. */
  hideHeader?: boolean
}>()
defineEmits<{ retry: [] }>()
const { t } = useI18n()
const ready = computed(() => !props.loading && !props.error)
// A loaded record whose name is blank still gets a heading; a loading or failed one keeps what it was given.
const heading = computed(() => (ready.value ? props.title.trim() || t('states.untitled') : props.title))
```

```vue
    <PageHeader :title="heading" :description="props.description" :back-to="props.backTo" :back-label="props.backLabel" :hide-title="props.hideHeader">
```

`apps/web/i18n/locales/ar/common.json` — in `states`, after `"noValue": "لا قيمة",` add `"untitled": "بلا عنوان",`. `apps/web/i18n/locales/en/common.json` — after `"noValue": "No value",` add `"untitled": "Untitled",`.

- [ ] **Step 14: Run, regenerate, commit**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim-p5-templates
(cd apps/web && npx vitest run app/components/shared/__tests__/RecordPage.test.ts)
node tools/ui_catalog.mjs && python3 -B tools/ui_policy.py
npm -w apps/web run lint && npm test 2>&1 | tail -4
git add apps/web docs/design-system
git commit -m "feat(web): add hideHeader and an untitled fallback to RecordPage

A loaded record with a blank name shows «بلا عنوان» instead of an
empty heading; hideHeader leaves the heading to the surrounding frame.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

Expected: tests pass; `ui_policy` locale-parity check passes (both locale files have `states.untitled`).

#### Commit D — `DashboardPage` and `TimelineFrame`

- [ ] **Step 15: Write the failing tests**

In `apps/web/app/components/shared/__tests__/DashboardPage.test.ts` replace the `SharedPageHeader` stub with one that models `hideTitle`:

```ts
  SharedPageHeader: defineComponent({
    props: { title: String, description: String, hideTitle: Boolean },
    setup(props, { slots }) {
      return () => h('header', { 'data-hide-title': props.hideTitle || undefined }, [
        props.hideTitle ? null : h('h1', props.title),
        props.description && !props.hideTitle ? h('p', props.description) : null,
        slots.actions ? h('div', { 'data-actions': '' }, slots.actions()) : null,
      ])
    },
  }),
```

and add to `describe('SharedDashboardPage', …)`:

```ts
  it('draws the filters between the header and the metric row', async () => {
    const html = await renderShared('DashboardPage', { title: 'Overview' }, {
      filters: () => h('div', { 'data-filter-bar': '' }),
      metrics: () => h('div', { 'data-metric': '' }),
      default: () => h('section', { 'data-chart-panel': '' }),
    }, { stubs })
    const order = ['<h1>', 'data-template="dashboard-filters"', 'data-filter-bar', 'data-template="dashboard-metrics"']
    const positions = order.map(marker => html.indexOf(marker))
    expect(positions.every(position => position >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })

  it('omits the filter wrapper without a filters slot', async () => {
    const html = await renderShared('DashboardPage', { title: 'Overview' }, { default: () => h('section') }, { stubs })
    expect(html).not.toContain('dashboard-filters')
  })

  it('hideHeader hands hideTitle to the header and keeps the actions', async () => {
    const html = await renderShared('DashboardPage', { title: 'Overview', hideHeader: true }, {
      actions: () => h('button', 'Export'),
      default: () => h('section', { 'data-chart-panel': '' }),
    }, { stubs })
    expect(html).toContain('data-hide-title')
    expect(html).not.toContain('<h1>')
    expect(html).toContain('Export')
    expect(html).toContain('data-chart-panel')
  })
```

In `apps/web/app/components/shared/__tests__/TimelineFrame.test.ts` replace the `SharedPageHeader` stub:

```ts
  SharedPageHeader: defineComponent({
    props: { title: String, hideTitle: Boolean },
    setup(props, { slots }) {
      return () => h('header', { 'data-hide-title': props.hideTitle || undefined }, [props.hideTitle ? null : h('h1', props.title), slots.actions ? h('div', { 'data-actions': '' }, slots.actions()) : null])
    },
  }),
```

and add to its describe:

```ts
  it('hideTitle passes through so a frame-owned page draws no second heading', async () => {
    const html = await render({ hideHeader: true })
    expect(html).toContain('data-hide-title')
    expect(html).not.toContain('<h1>Calendar</h1>')
    expect(html).toContain('timeline-prev')
    expect(html).toContain('data-body')
  })
```

- [ ] **Step 16: Run and watch them fail**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim-p5-templates/apps/web && npx vitest run app/components/shared/__tests__/DashboardPage.test.ts app/components/shared/__tests__/TimelineFrame.test.ts
```

Expected: FAIL in the new tests (`dashboard-filters` missing, `data-hide-title` missing).

- [ ] **Step 17: Implement**

`apps/web/app/components/shared/DashboardPage.vue`:

```ts
// The dashboard template (Tasmim Plan 4): the page header and its actions, the page's
// filters, a row of SharedMetricTile in `metrics`, then the SharedChartPanel grid. The grid
// goes two-up when its own width reaches 768px: a container query, so a wide context
// sidebar narrows it the way a phone does. Loading and errors stay with the page (it puts a
// state in the default slot with class="@min-[768px]:col-span-2"). `hideHeader` is for a
// page inside a frame that owns the heading.
const props = defineProps<{
  title: string
  description?: string
  hideHeader?: boolean
}>()
const { t } = useI18n()
```

```vue
    <SharedPageHeader :title="props.title" :description="props.description" :hide-title="props.hideHeader">
      <template v-if="$slots.actions" #actions>
        <slot name="actions" />
      </template>
    </SharedPageHeader>
    <div v-if="$slots.filters" data-template="dashboard-filters" class="min-w-0"><slot name="filters" /></div>
```

`apps/web/app/components/shared/TimelineFrame.vue` — add `hideHeader?: boolean` to the props (after `scales?`) with the comment `/** A frame around the page already shows the heading: draw no second one. Actions still render. */` and change the header line to:

```vue
    <SharedPageHeader :title="props.title" :hide-title="props.hideHeader">
```

- [ ] **Step 18: Run, regenerate, final checks, commit**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim-p5-templates
(cd apps/web && npx vitest run app/components/shared/__tests__/DashboardPage.test.ts app/components/shared/__tests__/TimelineFrame.test.ts)
node tools/ui_catalog.mjs && python3 -B tools/ui_policy.py
npm -w apps/web run lint && npm test 2>&1 | tail -4
git add apps/web docs/design-system
git commit -m "feat(web): add hideHeader and a filters slot to the dashboard

DashboardPage and TimelineFrame can leave the heading to a frame;
DashboardPage draws its filter bar between the header and metrics.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
cd apps/web && npm run build-storybook >/dev/null
WEBVUE_REQUIRE_STORYBOOK=1 npx playwright test e2e/storybook-visual.spec.ts e2e/storybook-smoke.spec.ts e2e/storybook-templates.spec.ts e2e/storybook-display-templates.spec.ts -g 'shared-(pageheader|listpage|viewswitch|recordpage|dashboardpage|timelineframe|chartpanel)|Tasmim' --reporter=line | tail -5
git status --short e2e/storybook-visual.spec.ts-snapshots; echo "clean=$?"
```

Expected: every screenshot, axe and behaviour test in those families passes with no diff, `git status` prints nothing. No other family changed: the templates draw exactly what they drew before unless a new prop is set.

---

### Task 3: A page built on a template counts as having a shell

`tools/ui_policy.py:512` lists the strings a page must contain to count as having an approved shell (`SharedPageContainer`, `SharedCreatePanel`, …). A page that is only `<SharedListPage>`, `<SharedRecordPage>` or `<SharedDashboardPage>` has none of them, so the first migrated page would fail `python3 -B tools/ui_policy.py` and with it `npm test`. This task adds the six template shells. It is `tools/` only, so it runs in parallel with T1 and T2.

**Files:**
- Modify: `tools/ui_policy.py:512-513` (`PAGE_SHELLS`)
- Modify: `tools/test_ui_policy.py` (one test, after `test_page_without_an_approved_shell_is_reported`)

**Interfaces:**
- Produces: `PAGE_SHELLS` also accepts `SharedListPage`, `SharedRecordPage`, `SharedDashboardPage`, `SharedTimelineFrame`, `SharedConversationLayout`, `SharedStandalonePage`. Plans 5 and 6 pages rely on it.

- [ ] **Step 1: Write the failing test**

In `tools/test_ui_policy.py`, after `test_page_without_an_approved_shell_is_reported`, add:

```python
    def test_template_pages_count_as_approved_shells(self):
        for tag in ('SharedListPage', 'SharedRecordPage', 'SharedDashboardPage', 'SharedTimelineFrame',
                    'SharedConversationLayout', 'SharedStandalonePage'):
            page = self.whole(**{self.PAGES + "probe.vue": f'<{tag} title="x" />'})
            self.assertEqual([e for e in policy.page_shell_errors(page) if "approved shells" in e], [], tag)
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim-p5-shells/tools && python3 -B -m unittest test_ui_policy.UiPolicyTest.test_template_pages_count_as_approved_shells -v
```

Expected: FAIL with `AssertionError: ['apps/web/app/pages/probe.vue: page needs one of the approved shells (…)'] != [] : SharedListPage`.

- [ ] **Step 3: Implement**

In `tools/ui_policy.py` replace the `PAGE_SHELLS` tuple:

```python
PAGE_SHELLS = ('SharedPageContainer', 'SharedCreatePanel', 'SharedSettingsPage', 'webvue-page-width-form',
               'ChatWorkspace', 'TaskDetailPage',
               # The Plan 4 page templates are shells themselves (each wraps SharedPageContainer).
               'SharedListPage', 'SharedRecordPage', 'SharedDashboardPage', 'SharedTimelineFrame',
               'SharedConversationLayout', 'SharedStandalonePage')
```

- [ ] **Step 4: Run the tests and the real tree**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim-p5-shells
(cd tools && python3 -B -m unittest test_ui_policy -q) && python3 -B tools/ui_policy.py && python3 -B tools/arch_policy.py
npm -w apps/web run lint && npm test 2>&1 | tail -4
```

Expected: the whole `test_ui_policy` suite passes, `ui_policy` and `arch_policy` exit 0, lint and `npm test` pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim-p5-shells
git add tools/ui_policy.py tools/test_ui_policy.py
git commit -m "build(tools): accept the page templates as approved shells

A page that is only a ListPage, RecordPage or DashboardPage has no
SharedPageContainer in its own source; the template is the shell.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Wave 2 — the four page groups (parallel, after wave 1 is merged)

### Task 4: `/projects` on `ListPage` + `DataTable`, cards as a `ViewSwitch` option

Today the page (`pages/projects/index.vue`) draws its own heading, its own create button (`openCreate`, which flushes the pending search into the URL first), a `FilterBar` whose `#view` slot holds the archived tabs and a hand-made cards/table toggle (hidden below `md`), then either `ProjectTable` (a desktop `UTable` plus a `md:hidden` `ProjectCards`) or `ProjectCards`, then `SharedPagination`. It owns the URL state (`useProjectList` parsing, a debounced search, `scheduleQueryWrite`) and that stays untouched.

What changes:

- The page becomes `SharedListPage` (`createTo`, `createTestId="project-new"`, `views` = cards (first, the bare URL) and table, with the existing test ids `projects-view-cards` / `projects-view-table`). The toggle in `FilterBar`'s `#view` slot goes; the archived tabs stay.
- `ProjectTable` renders through `SharedDataTable` (columns, link cell, status badge, progress, menu as slots; `#mobile-row` replaces the `md:hidden` cards).
- The card body is shared: new `ProjectCardBody.vue` is the body of a card and of a mobile row.
- The empty state keeps its title **and** hint, so it is drawn by the page (`SharedEmptyState`), not by the table; pagination and the page-level error stay with the page (the cards view needs them too).
- The create link and every project link carry the *live* list path (committed filters plus the search being typed), so a project opened inside the 250 ms debounce still returns to the filtered list (Review Focus 1). The existing `flushPendingSearch` path of `openProject` stays for link clicks.

**Files:**
- Modify: `apps/web/app/pages/projects/index.vue`
- Rewrite: `apps/web/app/components/project/ProjectTable.vue`, `apps/web/app/components/project/ProjectCards.vue`
- Create: `apps/web/app/components/project/ProjectCardBody.vue`
- Create: `apps/web/e2e/pilot-projects.spec.ts`
- Modify: `apps/web/e2e/shortcuts-tasmim.spec.ts` (the `/projects` lines of one existing test; title unchanged)
- Modify: `apps/web/stories/project/ProjectMenu.stories.ts` (story context repoint), other story contexts via `--refresh-story-context`
- Modify: `docs/design-system/components.md` (append one row to the `## المشاريع والمهام` table)

**Interfaces:**
- Consumes: `SharedListPage` (`title`, `createTo`, `createLabel`, `createTestId`, `views: ListViewOption[]` with `testId`, slots `actions`/`filters`/default `{ view }`), `SharedDataTable` (`rows`, `columns`, `rowKey`, `rowTo`, `loading`, `caption`; slots `#<column>-cell`, `#mobile-row`), `SharedEmptyState`, `SharedPageState`, `SharedPagination`, `SharedLoadingSkeleton` (`variant="cards"`), `useProjectWorkspaceMemory().entryTo`, `serializeProjectListRoute`, `returnToQuery`.
- Produces:
  - `ProjectTable` props `{ items: ProjectListItem[]; isLoading: boolean; toFor: (project: ProjectListItem) => RouteLocationRaw }`, emit `open: [id: number]` (the name link's plain click, which flushes the search).
  - `ProjectCards` props and emit identical to `ProjectTable`.
  - `ProjectCardBody` props `{ project: ProjectListItem; toFor: (project: ProjectListItem) => RouteLocationRaw }`.
  - The page's URL contract: `/projects` (cards), `/projects?view=table`, an explicit `?view=cards` still opens the cards, any other `view` value opens the cards; choosing cards drops `view`, choosing the table sets it; every other query key survives a switch.

- [ ] **Step 1: Write the failing pilot spec**

Create `apps/web/e2e/pilot-projects.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test'

// Plan 5 pilot: /projects on SharedListPage + SharedDataTable. Runs on the isolated mock stack
// (Nuxt + mock API, see p5-e2e.sh); the session comes from the login API. The mock lists three projects.
const ADMIN_LOGIN = process.env.E2E_ADMIN_LOGIN ?? 'admin'
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'admin'
async function login(page: Page) {
  const response = await page.request.post('/api/auth/login', { data: { login: ADMIN_LOGIN, password: ADMIN_PASSWORD } })
  expect(response.status()).toBe(200)
}
async function open(page: Page, path: string) {
  await page.goto(path)
  await expect(page.getByTestId('global-search-trigger')).toBeEnabled()
}
const rows = (page: Page) => page.locator('tbody tr[data-shortcut-row]')
const mobileRows = (page: Page) => page.locator('li[data-shortcut-row]')
const fitsWidth = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)

test.describe('Plan 5 pilot: the projects list', () => {
  test.beforeEach(async ({ page }) => { await login(page) })

  test.describe('desktop', () => {
    test.use({ viewport: { width: 1440, height: 900 } })

    test('the table view is the list template: one heading, the page create button, a data table', async ({ page }) => {
      await open(page, '/projects?view=table')
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
      await expect(page.getByRole('heading', { level: 1 })).toContainText('المشاريع')
      await expect(page.locator('[data-template="list"]')).toHaveCount(1)
      await expect(page.locator('[data-slot="data-table"]')).toBeVisible()
      await expect(rows(page)).toHaveCount(3)
      const create = page.getByTestId('project-new')
      await expect(create).toBeVisible()
      await expect(create).toHaveAttribute('data-shortcut-create', '')
      await expect(page.getByTestId('projects-toolbar')).toBeVisible()
      await expect(page.getByTestId('projects-result-count')).toContainText('3')
      await expect(page.getByTestId('project-templates-link')).toBeVisible()
      await expect(page.getByTestId('projects-view-table')).toHaveAttribute('aria-pressed', 'true')
      await expect(page.getByTestId('project-row').first()).toHaveAttribute('href', /\/projects\/\d+\?.*returnTo=/)
      await expect(rows(page).first().getByTestId('project-progress')).toBeVisible()
    })

    test('an unknown or explicit ?view= opens a list view and a switch keeps the other filters', async ({ page }) => {
      await open(page, '/projects')
      await expect(page.getByTestId('project-card')).toHaveCount(3)
      await expect(page.getByTestId('projects-view-cards')).toHaveAttribute('aria-pressed', 'true')
      await expect(page.locator('[data-slot="data-table"]')).toHaveCount(0)
      await open(page, '/projects?view=gantt')
      await expect(page.getByTestId('project-card')).toHaveCount(3)
      await open(page, '/projects?view=cards')
      await expect(page.getByTestId('project-card')).toHaveCount(3)
      await open(page, '/projects?status=on_track&view=table')
      await expect(rows(page)).toHaveCount(3)
      await page.getByTestId('projects-view-cards').click()
      await expect(page.getByTestId('project-card')).toHaveCount(3)
      expect(new URL(page.url()).searchParams.get('status')).toBe('on_track')
      expect(new URL(page.url()).searchParams.has('view')).toBe(false)
      await page.getByTestId('projects-view-table').click()
      await expect(rows(page)).toHaveCount(3)
      expect(new URL(page.url()).searchParams.get('view')).toBe('table')
      expect(new URL(page.url()).searchParams.get('status')).toBe('on_track')
    })

    test('J and K move between rows and Enter opens the focused project', async ({ page }) => {
      await open(page, '/projects?view=table')
      await page.getByRole('heading', { level: 1 }).click()
      await page.keyboard.press('j')
      await expect(rows(page).nth(0)).toBeFocused()
      await page.keyboard.press('j')
      await expect(rows(page).nth(1)).toBeFocused()
      await page.keyboard.press('k')
      await expect(rows(page).nth(0)).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(page).toHaveURL(/\/projects\/1(?:\?|$)/)
    })

    test('/ focuses the search and C presses the page create button, keeping the view in the return path', async ({ page }) => {
      await open(page, '/projects?view=table')
      await page.getByRole('heading', { level: 1 }).click()
      await page.keyboard.press('/')
      await expect(page.locator('[data-shortcut-search] input')).toBeFocused()
      await page.getByRole('heading', { level: 1 }).click()
      await page.keyboard.press('c')
      await expect(page).toHaveURL(/\/projects\/new\?/)
      expect(new URL(page.url()).searchParams.get('returnTo')).toBe('/projects?view=table')
    })

    for (const target of ['row background', 'name link'] as const) {
      test(`a row opened right after typing keeps the search in its return path (${target})`, async ({ page }) => {
        await open(page, '/projects?view=table')
        await expect(page.locator('[data-shortcut-search] input')).toBeEnabled()
        // Type and open in one task, so the 250ms search debounce has not landed in the URL yet.
        await page.evaluate((how) => {
          const input = document.querySelector<HTMLInputElement>('[data-shortcut-search] input')!
          input.value = 'ألفا'
          input.dispatchEvent(new Event('input', { bubbles: true }))
          const row = document.querySelectorAll<HTMLElement>('tbody tr[data-shortcut-row]')[0]!
          if (how === 'name link') row.querySelector<HTMLElement>('[data-testid="project-row"]')!.click()
          else row.querySelectorAll<HTMLElement>('td')[2]!.click()
        }, target)
        await expect(page).toHaveURL(/\/projects\/\d+/)
        expect(new URL(page.url()).searchParams.get('returnTo') ?? '').toContain('q=')
      })
    }
  })

  test.describe('phone', () => {
    test.use({ viewport: { width: 390, height: 844 } })

    test('on a 390px phone the mobile rows carry the same information and J skips the hidden table', async ({ page }) => {
      await open(page, '/projects?view=table')
      await expect(mobileRows(page)).toHaveCount(3)
      await expect(page.locator('table')).toBeHidden()
      const first = mobileRows(page).first()
      await expect(first).toContainText('مشروع ألفا')
      await expect(first.getByTestId('project-status')).toBeVisible()
      await expect(first.getByText('40%')).toBeVisible()
      await expect(first.getByText('Admin')).toBeVisible()
      await expect(first.getByTestId('project-menu')).toBeVisible()
      await expect(page.getByTestId('projects-view-table')).toBeVisible()
      expect(await fitsWidth(page)).toBe(true)
      await page.getByRole('heading', { level: 1 }).click()
      await page.keyboard.press('j')
      await expect(mobileRows(page).nth(0)).toBeFocused()
      await page.keyboard.press('j')
      await expect(mobileRows(page).nth(1)).toBeFocused()
      await mobileRows(page).nth(0).click({ position: { x: 4, y: 4 } })
      await expect(page).toHaveURL(/\/projects\/1(?:\?|$)/)
    })

    test('the cards view fits the phone width', async ({ page }) => {
      await open(page, '/projects')
      await expect(page.getByTestId('project-card')).toHaveCount(3)
      expect(await fitsWidth(page)).toBe(true)
    })
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim-p5-projects-list/apps/web
bash /Users/tariq/code/nasq/.worktrees/tasmim/.superpowers/tasmim-shared/p5-e2e.sh 04 e2e/pilot-projects.spec.ts
```

Expected: the summary shows failures and `NEW failures` lists the pilot titles (none of them is in the CP3 list, so every failing one is "new"). At least the table-view test (`data-template="list"` is absent), the J/K test (no `data-shortcut-row`), the `/`-and-`C` test (`C` does not reach `/projects/new`) and the phone test fail.

- [ ] **Step 3: The shared card body**

Create `apps/web/app/components/project/ProjectCardBody.vue`:

```vue
<script setup lang="ts">
import type { Project, ProjectStatus } from '@webvue/contracts'
import type { RouteLocationRaw } from 'vue-router'
import { formatCalendarDate } from '@/composables/calendarDate'
import { projectStatusBadge } from '@/composables/projectStatus'
import { badgeLabel } from '@/utils/statusBadge'
import RecordNumber from '@/components/shared/RecordNumber.vue'
import ProjectMenu from './ProjectMenu.vue'

// One project as a body: number, name, status, progress, manager, end date and the actions menu.
// It is the inside of a card (ProjectCards) and of a phone row of the table (ProjectTable's
// #mobile-row), so both show the same information. The caller owns the surface around it.
type ProjectListItem = Project & { manager?: { id: number; name: string } | null; date_end?: string | null }
defineProps<{ project: ProjectListItem; toFor: (project: ProjectListItem) => RouteLocationRaw }>()
const { t, locale } = useI18n()
const projectBadge = (status: ProjectStatus | null) => { const entry = projectStatusBadge(status); return { tone: entry.tone, label: badgeLabel(entry, status, t) } }
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <RecordNumber :value="project.id" />
        <h2 :id="`project-card-${project.id}`" class="mt-1 truncate text-base font-semibold text-highlighted">
          <NuxtLink :to="toFor(project)" class="rounded hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{{ project.name }}</NuxtLink>
        </h2>
      </div>
      <SharedStatusBadge v-bind="projectBadge(project.status)" data-testid="project-status" class="shrink-0" />
    </div>
    <div class="space-y-2">
      <div class="flex items-center justify-between gap-3 text-xs text-muted">
        <span>{{ t('projects.progressOf', { closed: project.closed_task_count, total: project.task_count }) }}</span>
        <span class="tabular-nums font-medium text-highlighted">{{ project.progress }}%</span>
      </div>
      <UProgress :model-value="project.progress" size="sm" :aria-label="t('projects.columns.progress')" />
    </div>
    <div class="mt-auto flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-default pt-3 text-xs text-muted">
      <span class="inline-flex min-w-0 flex-1 items-center gap-1.5">
        <UIcon name="i-lucide-user-round" class="size-4 shrink-0" aria-hidden="true" />
        <span class="sr-only">{{ t('projects.columns.manager') }}: </span>
        <span class="truncate">{{ project.manager?.name ?? '—' }}</span>
      </span>
      <span class="inline-flex shrink-0 items-center gap-1.5">
        <UIcon name="i-lucide-calendar-days" class="size-4" aria-hidden="true" />
        <span class="sr-only">{{ t('projects.columns.dateEnd') }}: </span>
        <span>{{ project.date_end ? formatCalendarDate(project.date_end, locale) : '—' }}</span>
      </span>
      <ProjectMenu :project="project" hide-settings />
    </div>
  </div>
</template>
```

- [ ] **Step 4: `ProjectCards` and `ProjectTable`**

Replace `apps/web/app/components/project/ProjectCards.vue` with:

```vue
<script setup lang="ts">
import type { Project } from '@webvue/contracts'
import type { RouteLocationRaw } from 'vue-router'
import ProjectCardBody from './ProjectCardBody.vue'

// The cards view of /projects. Empty and error states belong to the page; this draws the cards
// or, while loading, the shared card skeleton.
type ProjectListItem = Project & { manager?: { id: number; name: string } | null; date_end?: string | null }
defineProps<{
  items: ProjectListItem[]
  isLoading: boolean
  toFor: (project: ProjectListItem) => RouteLocationRaw
}>()
const emit = defineEmits<{ open: [id: number] }>()
const hydrated = useHydrated()

function open(project: Project, event: MouseEvent) {
  if (!hydrated.value || (event.target as HTMLElement).closest('a, button, [role="menu"], [role="alert"]')) return
  emit('open', project.id)
}
function openWithKeyboard(project: Project, event: KeyboardEvent) {
  if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return
  event.preventDefault()
  if (!hydrated.value) return
  emit('open', project.id)
}
</script>

<template>
  <SharedLoadingSkeleton v-if="isLoading" variant="cards" :count="6" />
  <div v-else class="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
    <article
      v-for="project in items"
      :key="project.id"
      class="cursor-pointer rounded-lg bg-default p-5 ring ring-default transition-colors hover:bg-elevated/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      data-testid="project-card"
      tabindex="0"
      :aria-labelledby="`project-card-${project.id}`"
      @click="open(project, $event)"
      @keydown="openWithKeyboard(project, $event)"
    >
      <ProjectCardBody :project="project" :to-for="toFor" />
    </article>
  </div>
</template>
```

Replace `apps/web/app/components/project/ProjectTable.vue` with:

```vue
<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { Project, ProjectStatus } from '@webvue/contracts'
import type { RouteLocationRaw } from 'vue-router'
import { formatCalendarDate } from '@/composables/calendarDate'
import { projectStatusBadge } from '@/composables/projectStatus'
import { badgeLabel } from '@/utils/statusBadge'
import RecordNumber from '@/components/shared/RecordNumber.vue'
import ProjectCardBody from './ProjectCardBody.vue'
import ProjectMenu from './ProjectMenu.vue'
import ProjectProgress from './ProjectProgress.vue'

// The table view of /projects on SharedDataTable. A background click and Enter on a row open the
// project through `toFor`; the name link's plain click goes through `open`, so the page can first
// commit the search being typed. Empty, error and pagination belong to the page.
type ProjectListItem = Project & { manager?: { id: number; name: string } | null; date_end?: string | null }
defineProps<{
  items: ProjectListItem[]
  isLoading: boolean
  toFor: (project: ProjectListItem) => RouteLocationRaw
}>()
const emit = defineEmits<{ open: [id: number] }>()

const { t, locale } = useI18n()
const projectBadge = (status: ProjectStatus | null) => { const entry = projectStatusBadge(status); return { tone: entry.tone, label: badgeLabel(entry, status, t) } }
const hydrated = useHydrated()

const columns = computed<TableColumn<ProjectListItem>[]>(() => [
  { accessorKey: 'id', header: t('app.recordNumber') },
  { accessorKey: 'name', header: t('projects.columns.name') },
  { accessorKey: 'manager', header: t('projects.columns.manager') },
  { accessorKey: 'status', header: t('projects.columns.status') },
  { accessorKey: 'date_end', header: t('projects.columns.dateEnd') },
  { accessorKey: 'progress', header: t('projects.columns.progress') },
  { accessorKey: 'menu', header: t('app.actions') },
])

function openLink(project: ProjectListItem, event: MouseEvent) {
  if (!hydrated.value) return
  event.stopPropagation()
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
  event.preventDefault()
  emit('open', project.id)
}
</script>

<template>
  <SharedDataTable :rows="items" :columns="columns" row-key="id" :row-to="toFor" :loading="isLoading" :caption="t('projects.title')">
    <template #id-cell="{ row }"><RecordNumber :value="row.original.id" /></template>
    <template #name-cell="{ row }">
      <NuxtLink
        :to="toFor(row.original)"
        data-testid="project-row"
        class="block min-w-0 truncate font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        @click="openLink(row.original, $event)"
      >{{ row.original.name }}</NuxtLink>
    </template>
    <template #manager-cell="{ row }">{{ row.original.manager?.name ?? '—' }}</template>
    <template #status-cell="{ row }"><SharedStatusBadge v-bind="projectBadge(row.original.status)" data-testid="project-status" /></template>
    <template #date_end-cell="{ row }">{{ row.original.date_end ? formatCalendarDate(row.original.date_end, locale) : '—' }}</template>
    <template #progress-cell="{ row }">
      <ProjectProgress :progress="row.original.progress" :task-count="row.original.task_count" :closed-task-count="row.original.closed_task_count" compact />
    </template>
    <template #menu-cell="{ row }">
      <ProjectMenu :project="row.original" hide-settings @click.stop />
    </template>
    <template #mobile-row="{ row }">
      <ProjectCardBody :project="row" :to-for="toFor" />
    </template>
  </SharedDataTable>
</template>
```

- [ ] **Step 5: The page**

In `apps/web/app/pages/projects/index.vue`, edit the `<script setup>`:

1. Delete `const view = computed(() => filters.view ?? 'cards')`, `function onViewChange(value: 'table' | 'cards') { applyPatch({ view: value }) }` and the whole `async function openCreate() { … }`.
2. Right after `const canCreate = computed(() => latestCapability.value.allowed)` add:

```ts
// The list URL as it will be once the debounced search lands. The create link and every project link
// carry it as their return path, so a project opened inside the 250ms debounce still returns to the
// filtered list. The route itself catches up on its own.
const liveListPath = computed(() => router.resolve({
  path: '/projects',
  query: serializeProjectListRoute({ ...committedState(), q: search.value }),
}).fullPath)
const createTo = computed(() => canCreate.value ? { path: '/projects/new', query: returnToQuery(liveListPath.value) } : undefined)
// The switch lives in SharedListPage and writes ?view= itself. Cards, the first option, is the bare URL.
const views = computed(() => [
  { value: 'cards', label: t('projects.filters.cardView'), icon: 'i-lucide-layout-grid', testId: 'projects-view-cards' },
  { value: 'table', label: t('projects.filters.tableView'), icon: 'i-lucide-list', testId: 'projects-view-table' },
])
```

3. After `const isLoading = computed(() => projectList.isLoading.value)` add:

```ts
// The empty state keeps its title and its hint, so the page draws it, not the table.
const emptyKey = computed(() => (Boolean(rawSearch.value.trim()) || statusFilter.value !== 'all') ? 'filteredEmpty' : archived.value ? 'archivedEmpty' : 'empty')
const showEmpty = computed(() => !isLoading.value && items.value.length === 0)
```

4. Replace `projectTo`:

```ts
function projectTo(project: { id: number; active: boolean }) {
  return entryTo(project.id, liveListPath.value, project.active)
}
```

Replace the whole `<template>` with:

```vue
<template>
  <SharedListPage
    :title="t(filters.mine ? 'nav.myProjects' : 'nav.allProjects')"
    :create-to="createTo"
    :create-label="t('projects.new')"
    create-test-id="project-new"
    :views="views"
  >
    <template #actions>
      <UButton color="neutral" variant="outline" :to="{ path: '/project-templates', query: returnToQuery(route.fullPath) }" data-testid="project-templates-link" :label="t('projects.planningLinks.templates')" />
    </template>

    <template #filters>
      <div class="w-full min-w-0" data-testid="projects-toolbar">
        <FilterBar class="w-full" :active-count="activeFilterCount" :disabled="!hydrated" @clear="clearFilters">
          <template #search>
            <UInput v-model="search" :disabled="!hydrated" :placeholder="t('projects.filters.search')" :aria-label="t('projects.filters.search')" icon="i-lucide-search" class="w-full min-w-52" />
          </template>
          <template #default>
            <SharedFilterChoice data-testid="projects-status-filter" :label="t('projects.filters.statusLabel')" :items="statusOptions" :model-value="statusFilter" :disabled="!hydrated" @update:model-value="onStatusChange" />
            <SharedFilterChoice data-testid="projects-sort" layout="segment" :label="t('projects.filters.sortLabel')" :items="sortOptions" :model-value="sort" :disabled="!hydrated" @update:model-value="onSortChange" />
          </template>
          <template #view>
            <UTabs
              v-if="canListArchived"
              :model-value="archived ? 'archived' : 'active'"
              :items="[{ label: t('projects.filters.active'), value: 'active', disabled: !hydrated }, { label: t('projects.filters.archived'), value: 'archived', disabled: !hydrated }]"
              size="sm"
              @update:model-value="onFilterChange"
            />
          </template>
          <template #active>
            <div v-if="rawSearch || statusFilter !== 'all' || sort !== 'default'" class="flex flex-wrap items-center gap-2">
              <SharedFilterChip v-if="rawSearch" :label="t('projects.filters.searchValue', { value: rawSearch })" @remove="clearSearch" />
              <SharedFilterChip v-if="statusFilter !== 'all'" :label="statusLabel" @remove="onStatusChange('all')" />
              <SharedFilterChip v-if="sort !== 'default'" :label="sortLabel" @remove="onSortChange('default')" />
            </div>
          </template>
        </FilterBar>
      </div>
    </template>

    <template #default="{ view }">
      <UAlert
        v-if="activeList.error.value && !projectList.error.value"
        role="alert"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        :title="t('projects.loadError')"
      >
        <template #actions>
          <UButton color="neutral" variant="outline" size="sm" :disabled="!hydrated" :label="t('app.retry')" @click="activeList.refetch()" />
        </template>
      </UAlert>

      <SharedPageState v-if="projectList.error.value" :error="projectList.error.value" @retry="projectList.refetch" />
      <div v-else class="grid gap-3">
        <p v-if="projectList.data.value" data-testid="projects-result-count" class="text-sm text-muted">
          {{ t('projects.refresh.workspace.resultCount', { count: total }) }}
        </p>
        <SharedEmptyState v-if="showEmpty" :title="t(`projects.${emptyKey}`)" :description="t(`projects.${emptyKey}Hint`)" />
        <ProjectTable v-else-if="view === 'table'" :items="displayedItems" :is-loading="isLoading" :to-for="projectTo" @open="openProject" />
        <ProjectCards v-else :items="displayedItems" :is-loading="isLoading" :to-for="projectTo" @open="openProject" />
        <SharedPagination :page="page" :pages="pages" :disabled="projectList.isFetching.value" @update:page="setPage" />
      </div>
    </template>
  </SharedListPage>
</template>
```

Then the existing `/projects` assertion in `apps/web/e2e/shortcuts-tasmim.spec.ts` (test `/ focuses the list search without typing a slash; C follows the sidebar create link`, title unchanged). Replace

```ts
    // The sidebar hides the pinned new-project link on /projects, so C leaves the key alone there.
    await page.keyboard.press('c')
    await expect(page).toHaveURL(/\/projects$/)
```

with

```ts
    // /projects has its own create button (data-shortcut-create); C presses it before any sidebar link.
    await page.keyboard.press('c')
    await expect(page).toHaveURL(/\/projects\/new\?returnTo=(?:%2F|\/)projects$/)
```

Leave the following `/tasks` lines of that test alone (T5 edits the single `toHaveURL` of the `/tasks` half).

- [ ] **Step 6: Story contexts, catalog row, policy**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim-p5-projects-list
rg -n '<ProjectMenu' apps/web/app/components/project/ProjectCardBody.vue
```

In `apps/web/stories/project/ProjectMenu.stories.ts` replace `ProjectCards.vue:85` in the `storyContext(...)` with `ProjectCardBody.vue:<line printed above>`. Append one row at the end of the `## المشاريع والمهام` table in `docs/design-system/components.md`:

```markdown
| بدن بطاقة المشروع | `apps/web/app/components/project/ProjectCardBody.vue` | رقم واسم وحالة وتقدم ومدير وتاريخ وقائمة الإجراءات؛ داخل البطاقة وصف الجوال في جدول المشاريع |
```

```bash
python3 -B tools/ui_policy.py --refresh-story-context
python3 -B tools/ui_policy.py && python3 -B tools/arch_policy.py && node tools/ui_catalog.mjs --check
npm -w apps/web run lint
```

Expected: policies exit 0. If `ui_policy` reports `storyContext … does not point at a real usage` for another story, repoint it to the file that now holds the usage (it lists the story and the cited file) and re-run; do not delete the story.

- [ ] **Step 7: Run the pilot spec, the pinned tests and the affected specs**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim-p5-projects-list
(cd apps/web && npx vitest run app/pages/__tests__ app/composables/__tests__/useProjects.test.ts)
cd apps/web
bash /Users/tariq/code/nasq/.worktrees/tasmim/.superpowers/tasmim-shared/p5-e2e.sh 04 \
  e2e/pilot-projects.spec.ts e2e/shortcuts-tasmim.spec.ts e2e/shell-tasmim.spec.ts e2e/projects.spec.ts \
  e2e/project-entry-regressions.spec.ts e2e/project-admin.spec.ts e2e/project-clarity.spec.ts \
  e2e/design-fidelity.spec.ts e2e/projects-phase1.spec.ts e2e/navigation-gate.spec.ts e2e/hydration.spec.ts \
  e2e/project-workspace-continuity.spec.ts e2e/internal-pages.spec.ts e2e/command-menu.spec.ts
```

Expected: vitest passes (`useProjects` helpers and every pinned page test); the `NEW failures` block is empty, and every `Plan 5 pilot: the projects list` test passed. `project-entry-regressions` "immediate search to create and back preserves mine, search, sort, and view" and `navigation-gate` "every page has exactly one h1 › all projects (/projects)" must pass; they guard the create link and the single heading. If a title that passes in CP3 fails, fix the code, not the spec.

- [ ] **Step 8: Gates and commit**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim-p5-projects-list
npm test 2>&1 | tail -4
git add apps/web docs/design-system
git commit -m "refactor(web): move /projects onto ListPage and DataTable

The page is a ListPage with the cards as its first view and the
table as ?view=table; ProjectTable renders through DataTable with
phone rows from a shared ProjectCardBody. The create link and row
links carry the live list path, so a search typed just before
opening keeps its return path. C now presses the page's own
«مشروع جديد» button.

Updated assertions: shortcuts-tasmim '/ focuses the list search…'
now expects C on /projects to open /projects/new with returnTo.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `/tasks` and the project task tab on `ListPage` + `DataTable`

Both pages share `TaskToolbar` and `TaskTable`; `?view=board` is read by `TaskBoard`. Today `/tasks` draws its own `SharedPageHeader` with a create button, `TaskToolbar` with a table/board toggle (`update:view`), and mounts `TaskTable`/`TaskBoard` only after hydration. The project tab (`pages/projects/[id]/tasks.vue`) has **no heading** (the frame is the `<h1>`), a right-aligned create button (`project-header-create`), the toolbar with a link-style view switch passed through `TaskToolbar`'s `#view` slot, and the table or board in a ring card.

What changes:

- Both pages become `SharedListPage`; the project tab uses `hideHeader` (no heading, create button kept). The view switch is `ListPage`'s (`table` first, `board` the `?view=board` URL), and `TaskToolbar` loses its own `view` prop, `update:view` event and `#view` pass-through (open/closed tabs stay).
- `TaskTable` renders through `SharedDataTable`. Columns become plain `{ id, header }` with `#<id>-cell` slots; the title is a real link (`rowTo`); `StateMenu` and `PrioritySelect` stay in their cells (a click on a button or select never opens the row); `#mobile-row` carries the old phone card. "Load more" (an infinite query, not paging) and the empty state with its create action stay in `TaskTable`.
- Pages hand `TaskTable` a `rowTo` function. `openTask` of `/tasks` becomes `taskTo(id)`, the same shape the project tab already has; the `taskBackTargets` test is updated in place for that.
- Known, accepted difference: when the project is missing or failed to load, the tab draws no `ListPage` and so registers no shell title (the old `ListTitle` helper did); the shell shows its default title there.

**Files:**
- Modify: `apps/web/app/pages/tasks.vue`, `apps/web/app/pages/projects/[id]/tasks.vue`
- Rewrite: `apps/web/app/components/task/TaskTable.vue`
- Modify: `apps/web/app/components/task/TaskToolbar.vue`
- Create: `apps/web/e2e/pilot-tasks.spec.ts`
- Modify: `apps/web/e2e/shortcuts-tasmim.spec.ts` (the single `/tasks` expectation of one existing test)
- Modify: `apps/web/app/pages/__tests__/taskBackTargets.test.ts` (one test, in place)
- Modify: `apps/web/stories/shared/PageHeader.stories.ts`, `apps/web/stories/shared/PageContainer.stories.ts` (story contexts repointed); other contexts via `--refresh-story-context`

**Interfaces:**
- Consumes: `SharedListPage` (`hideHeader`, `createTestId`, `views`), `SharedDataTable`, `SharedEmptyState`, `SharedPageState`, `SharedStatusBadge`, `listViewQuery`/`currentListView` (through `ListPage`), `projectTaskParams`, `projectTaskQuery`, `useTaskFilters`, `returnToQuery`.
- Produces:
  - `TaskTable` props `{ params: TaskListParams; rowTo: (task: Task) => RouteLocationRaw; variant?: 'mine' | 'project' }`, emit `create` (the empty state's create action). It no longer takes `embedded` or emits `open`.
  - `TaskToolbar` props `{ modelValue; hideProjectFilter?; embedded?; collapsible? }`, emit `update:modelValue`. `view`, `update:view` and the `#view` slot are gone.
  - Both pages expose `taskTo(taskId: number): RouteLocationRaw` (`/tasks/{id}` carrying the list query; `/projects/{id}/tasks/{taskId}` carrying the list query without a referrer's `returnTo`) and keep `isBoard`, `notFound`, `canCreate`, `stageSource` (project tab).
  - URL contract: `/tasks` (table), `/tasks?view=board`, any other `view` value shows the table; the same on the project tab. The query a switch writes keeps every other key.

- [ ] **Step 1: Write the failing pilot spec**

Create `apps/web/e2e/pilot-tasks.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test'

// Plan 5 pilot: /tasks and /projects/1/tasks on SharedListPage + SharedDataTable (isolated mock stack).
// The mock lists four tasks, all in project 1 «مشروع ألفا».
const ADMIN_LOGIN = process.env.E2E_ADMIN_LOGIN ?? 'admin'
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'admin'
async function login(page: Page) {
  const response = await page.request.post('/api/auth/login', { data: { login: ADMIN_LOGIN, password: ADMIN_PASSWORD } })
  expect(response.status()).toBe(200)
}
async function open(page: Page, path: string) {
  await page.goto(path)
  await expect(page.getByTestId('global-search-trigger')).toBeEnabled()
}
const rows = (page: Page) => page.locator('tbody tr[data-shortcut-row]')
const mobileRows = (page: Page) => page.locator('li[data-shortcut-row]')
const fitsWidth = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)

test.describe('Plan 5 pilot: the task lists', () => {
  test.beforeEach(async ({ page }) => { await login(page) })

  test.describe('desktop', () => {
    test.use({ viewport: { width: 1440, height: 900 } })

    test('/tasks is the list template with a table, the page create button and one heading', async ({ page }) => {
      await open(page, '/tasks')
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
      await expect(page.locator('[data-template="list"]')).toHaveCount(1)
      await expect(rows(page)).toHaveCount(4)
      const create = page.locator('[data-shortcut-create]')
      await expect(create).toHaveCount(1)
      await expect(create).toContainText('مهمة جديدة')
      await expect(page.getByTestId('deadline-badge').first()).toBeVisible()
      await expect(rows(page).first().getByRole('link').first()).toHaveAttribute('href', /\/tasks\/\d+/)
      await expect(rows(page).first().getByRole('button').first()).toBeVisible()
    })

    test('an unknown ?view= shows the table and ?view=board survives a task round trip', async ({ page }) => {
      await open(page, '/tasks?view=gantt')
      await expect(rows(page)).toHaveCount(4)
      await open(page, '/tasks')
      await page.locator('[data-view="board"]').click()
      await expect(page).toHaveURL(/\/tasks\?view=board$/)
      await expect(page.getByTestId('board-column').first()).toBeVisible()
      await page.getByTestId('board-card-101').click()
      await expect(page).toHaveURL(/\/tasks\/101/)
      await page.goBack()
      await expect(page).toHaveURL(/\/tasks\?view=board$/)
      await page.locator('[data-view="table"]').click()
      await expect(page).toHaveURL(/\/tasks$/)
      await expect(rows(page)).toHaveCount(4)
    })

    test('J and K move through the rows, / focuses the search and C creates a task', async ({ page }) => {
      await open(page, '/tasks')
      await page.getByRole('heading', { level: 1 }).click()
      await page.keyboard.press('j')
      await expect(rows(page).nth(0)).toBeFocused()
      await page.keyboard.press('j')
      await expect(rows(page).nth(1)).toBeFocused()
      await page.keyboard.press('k')
      await expect(rows(page).nth(0)).toBeFocused()
      await page.keyboard.press('/')
      await expect(page.locator('[data-shortcut-search] input')).toBeFocused()
      await page.getByRole('heading', { level: 1 }).click()
      await page.keyboard.press('c')
      await expect(page).toHaveURL(/\/tasks\/new\?returnTo=/)
    })

    test('Enter on a focused task row opens that task', async ({ page }) => {
      await open(page, '/tasks')
      await page.getByRole('heading', { level: 1 }).click()
      await page.keyboard.press('j')
      await expect(rows(page).nth(0)).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(page).toHaveURL(/\/tasks\/\d+/)
    })

    test('a click on the state menu does not open the task, a click on the row does', async ({ page }) => {
      await open(page, '/tasks')
      await rows(page).first().getByRole('button').first().click()
      await expect(page).toHaveURL(/\/tasks$/)
      await page.keyboard.press('Escape')
      await rows(page).first().locator('td').nth(1).click({ position: { x: 4, y: 4 } })
      await expect(page).toHaveURL(/\/tasks\/\d+/)
    })

    test('the project tab keeps the frame heading as the only heading and a header-level create button', async ({ page }) => {
      await open(page, '/projects/1/tasks')
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('مشروع ألفا')
      await expect(page.locator('main h2')).toHaveCount(0)
      await expect(page.getByTestId('project-workspace-tabs')).toHaveCount(1)
      const create = page.getByTestId('project-header-create')
      await expect(create).toHaveAttribute('data-shortcut-create', '')
      await expect(page.locator('main [data-slot="page-header"]').getByTestId('project-header-create')).toBeVisible()
      await expect(rows(page)).toHaveCount(4)
      await expect(page.getByRole('link', { name: 'المهام المؤرشفة' })).toBeVisible()
    })

    test('the project tab switches to the board with ?view=board and back, keeping its filters', async ({ page }) => {
      await open(page, '/projects/1/tasks?q=%D9%85%D9%87%D9%85%D8%A9')
      await page.getByRole('button', { name: 'لوحة', exact: true }).click()
      await expect(page).toHaveURL(/\/projects\/1\/tasks\?(?=.*q=)(?=.*view=board)/)
      await expect(page.getByTestId('board-column').first()).toBeVisible()
      await page.getByRole('button', { name: 'قائمة', exact: true }).click()
      expect(new URL(page.url()).searchParams.has('view')).toBe(false)
      expect(new URL(page.url()).searchParams.get('q')).toBe('مهمة')
      await expect(rows(page)).toHaveCount(4)
    })

    test('a task opened from the project tab returns to the tab with its filters', async ({ page }) => {
      await open(page, '/projects/1/tasks?q=%D9%85%D9%87%D9%85%D8%A9')
      await rows(page).first().getByRole('link').first().click()
      await expect(page).toHaveURL(/\/projects\/1\/tasks\/\d+/)
      expect(new URL(page.url()).searchParams.get('q')).toBe('مهمة')
      await page.goBack()
      await expect(page).toHaveURL(/\/projects\/1\/tasks\?/)
      await expect(rows(page)).toHaveCount(4)
    })

    test('the task tab of a missing project shows the not-found block and no list', async ({ page }) => {
      await page.goto('/projects/999/tasks')
      await expect(page.getByText('المشروع غير موجود أو لا تملك صلاحية عرضه')).toBeVisible()
      await expect(page.locator('[data-template="list"]')).toHaveCount(0)
    })
  })

  test.describe('phone', () => {
    test.use({ viewport: { width: 390, height: 844 } })

    test('on a 390px phone the mobile rows carry the same information and J skips the hidden table', async ({ page }) => {
      await open(page, '/tasks')
      await expect(mobileRows(page)).toHaveCount(4)
      await expect(page.locator('table')).toBeHidden()
      const first = mobileRows(page).first()
      await expect(first).toContainText('مهمة')
      await expect(first.getByTestId('deadline-badge')).toBeVisible()
      await expect(first.getByRole('button').first()).toBeVisible()
      await expect(first.getByRole('combobox')).toBeVisible()
      expect(await fitsWidth(page)).toBe(true)
      await page.getByRole('heading', { level: 1 }).click()
      await page.keyboard.press('j')
      await expect(mobileRows(page).nth(0)).toBeFocused()
      await page.keyboard.press('j')
      await expect(mobileRows(page).nth(1)).toBeFocused()
    })

    test('the project tab fits the phone width', async ({ page }) => {
      await open(page, '/projects/1/tasks')
      await expect(mobileRows(page)).toHaveCount(4)
      expect(await fitsWidth(page)).toBe(true)
    })
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim-p5-tasks-lists/apps/web
bash /Users/tariq/code/nasq/.worktrees/tasmim/.superpowers/tasmim-shared/p5-e2e.sh 05 e2e/pilot-tasks.spec.ts
```

Expected: the `NEW failures` block lists the pilot titles that cannot pass yet (at least the template, J/K, project-tab heading, `data-view` and phone tests).

- [ ] **Step 3: `TaskToolbar` loses its view switch**

In `apps/web/app/components/task/TaskToolbar.vue`:

- Props and emits become

```ts
const props = defineProps<{ modelValue: TaskListParams; hideProjectFilter?: boolean; embedded?: boolean; collapsible?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [TaskListParams] }>()
```

- In the template's `#view` block keep only the open/closed tabs. Delete `<slot name="view" />` and the whole `<div v-if="view" class="hidden md:block"> … </div>` group, so the block is

```vue
    <template #view>
      <UTabs
        :items="[{ label: t('tasks.filters.open'), value: 'open', disabled: !hydrated }, { label: t('tasks.filters.closed'), value: 'closed', disabled: !hydrated }]"
        :model-value="modelValue.closed ? 'closed' : 'open'"
        size="sm"
        @update:model-value="(v) => patch({ closed: v === 'closed' })"
      />
    </template>
```

- [ ] **Step 4: `TaskTable` on `DataTable`**

Replace `apps/web/app/components/task/TaskTable.vue` with:

```vue
<script setup lang="ts">
import type { Task } from '@webvue/contracts'
import type { TableColumn } from '@nuxt/ui'
import type { RouteLocationRaw } from 'vue-router'
import { deadlineLabel, deadlineTone } from '@/composables/taskState'
import { useTasks, type TaskListParams } from '@/composables/useTasks'
import EmptyState from '@/components/shared/EmptyState.vue'
import RecordNumber from '@/components/shared/RecordNumber.vue'
import PrioritySelect from './PrioritySelect.vue'
import StateMenu from './StateMenu.vue'

// The task list on SharedDataTable. The title is a real link to `rowTo(task)`, a click on the row
// background opens it too, and StateMenu / PrioritySelect keep their own clicks. "Load more" is an
// infinite query, not paging, so it stays here; the empty state keeps its create action.
const props = withDefaults(defineProps<{
  params: TaskListParams
  rowTo: (task: Task) => RouteLocationRaw
  variant?: 'mine' | 'project'
}>(), { variant: 'mine' })
const emit = defineEmits<{ create: [] }>()

const { t } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()

const paramsRef = computed(() => props.params)
const { data, isLoading, hasNextPage, fetchNextPage, isFetchingNextPage, error, refetch } = useTasks(paramsRef)
const items = computed<Task[]>(() => data.value?.pages.flatMap(page => page.items) ?? [])

// A search/state/project filter yielding zero rows is a different situation from genuinely having no
// tasks: the empty state's create action only makes sense when nothing is filtered out. `closed` is a
// tab, not a filter in that sense, but an empty closed tab still isn't "no tasks assigned to you".
const hasActiveFilters = computed(
  () => !!props.params.q || (props.variant === 'mine' && !!props.params.project_id) || !!props.params.state?.length,
)
const emptyTitleKey = computed(() => {
  if (hasActiveFilters.value) return 'app.noResults'
  return props.params.closed ? 'tasks.empty.closedTitle' : 'tasks.empty.title'
})
const showCreateAction = computed(() => can('pmo.tasks.create') && !hasActiveFilters.value && !props.params.closed)

// Widths are applied to both the header and the cell; the number and title columns stay stable.
function column(id: string, header: string, width: string): TableColumn<Task> {
  return { id, header, meta: { class: { th: `text-start ${width}`, td: `max-w-0 overflow-hidden text-ellipsis whitespace-nowrap ${width}` } } }
}
const columns = computed<TableColumn<Task>[]>(() => props.variant === 'project'
  ? [
      column('record_number', t('app.recordNumber'), 'w-[6%]'), column('title', t('tasks.columns.title'), 'w-[30%]'),
      column('assignees', t('tasks.columns.assignees'), 'w-[12%]'), column('stage', t('tasks.columns.stage'), 'w-[12%]'),
      column('deadline', t('tasks.columns.deadline'), 'w-[12%]'), column('priority', t('tasks.columns.priority'), 'w-[14%]'),
      column('state', t('tasks.columns.state'), 'w-[14%]'),
    ]
  : [
      column('record_number', t('app.recordNumber'), 'w-[7%]'), column('title', t('tasks.columns.title'), 'w-[30%]'),
      column('project', t('tasks.columns.project'), 'w-[14%]'), column('state', t('tasks.columns.state'), 'w-[14%]'),
      column('deadline', t('tasks.columns.deadline'), 'w-[13%]'), column('priority', t('tasks.columns.priority'), 'w-[12%]'),
      column('stage', t('tasks.columns.stage'), 'w-[10%]'),
    ])

const stageName = (task: Task) => (props.variant === 'project' ? task.stage?.name : task.personal_stage?.name) ?? '—'
// Same short-initials rule as TaskCard/Timeline: first letter of up to two words.
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return parts.length ? parts.slice(0, 2).map(part => part[0]!.toUpperCase()).join('') : '?'
}
</script>

<template>
  <div class="min-w-0 space-y-2">
    <SharedPageState v-if="error" :error="error" @retry="refetch" />
    <EmptyState v-else-if="!isLoading && items.length === 0" :title="t(emptyTitleKey)">
      <template v-if="showCreateAction" #action>
        <UButton size="sm" :disabled="!hydrated" @click="emit('create')">{{ t('tasks.empty.action') }}</UButton>
      </template>
    </EmptyState>
    <SharedDataTable
      v-else
      :rows="items"
      :columns="columns"
      row-key="id"
      :row-to="rowTo"
      :loading="isLoading"
      :caption="props.variant === 'project' ? t('projects.tabs.tasks') : t('tasks.title')"
    >
      <template #record_number-cell="{ row }"><RecordNumber :value="row.original.id" /></template>
      <template #title-cell="{ row }">
        <NuxtLink
          :to="rowTo(row.original)"
          class="block max-w-full truncate font-medium text-highlighted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >{{ row.original.name }}</NuxtLink>
      </template>
      <template #project-cell="{ row }">{{ row.original.project?.name ?? '—' }}</template>
      <template #assignees-cell="{ row }">
        <span v-if="!row.original.assignees.length" class="text-muted">—</span>
        <span v-else class="inline-flex min-w-0 max-w-full items-center gap-2">
          <UAvatar :text="initials(row.original.assignees[0]!.name)" size="xs" class="shrink-0 bg-brand-soft text-brand-link" />
          <span class="truncate">{{ row.original.assignees.map(person => person.name).join('، ') }}</span>
        </span>
      </template>
      <template #stage-cell="{ row }">{{ stageName(row.original) }}</template>
      <template #state-cell="{ row }"><StateMenu :task="row.original" /></template>
      <template #deadline-cell="{ row }">
        <SharedStatusBadge data-testid="deadline-badge" :tone="deadlineTone(row.original.days_remaining, row.original.is_closed)" :label="deadlineLabel(row.original.days_remaining, t)" />
      </template>
      <template #priority-cell="{ row }"><PrioritySelect :task="row.original" /></template>
      <template #mobile-row="{ row: task }">
        <div class="space-y-3">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0 flex-1">
              <RecordNumber :value="task.id" />
              <NuxtLink :to="rowTo(task)" class="block min-w-0 max-w-full truncate font-medium text-highlighted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{{ task.name }}</NuxtLink>
            </div>
            <SharedStatusBadge class="shrink-0" data-testid="deadline-badge" :tone="deadlineTone(task.days_remaining, task.is_closed)" :label="deadlineLabel(task.days_remaining, t)" />
          </div>
          <p class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
            <span class="truncate">{{ task.project?.name ?? (props.variant === 'project' ? task.stage?.name : '—') }}</span>
            <span v-if="props.variant === 'project' && task.stage && task.project" aria-hidden="true">·</span>
            <span v-if="props.variant === 'project' && task.stage && task.project" class="truncate">{{ task.stage.name }}</span>
            <span v-else-if="props.variant !== 'project' && task.personal_stage" aria-hidden="true">·</span>
            <span v-if="props.variant !== 'project' && task.personal_stage" class="truncate">{{ task.personal_stage.name }}</span>
            <span v-if="task.assignees.length" aria-hidden="true">·</span>
            <span v-if="task.assignees.length" class="truncate">{{ task.assignees.map(person => person.name).join('، ') }}</span>
          </p>
          <div class="flex flex-wrap items-center gap-2">
            <StateMenu :task="task" />
            <PrioritySelect :task="task" />
          </div>
        </div>
      </template>
    </SharedDataTable>
    <div v-if="hasNextPage" class="flex justify-center">
      <UButton color="neutral" variant="outline" size="sm" :loading="isFetchingNextPage" :disabled="isFetchingNextPage || !hydrated" @click="fetchNextPage()">
        {{ t('app.loadMore') }}
      </UButton>
    </div>
  </div>
</template>
```

- [ ] **Step 5: `pages/tasks.vue`**

Replace the `<script setup>` and `<template>` of `apps/web/app/pages/tasks.vue` with:

```vue
<script setup lang="ts">
import TaskBoard from '@/components/task/TaskBoard.vue'
import TaskTable from '@/components/task/TaskTable.vue'
import TaskToolbar from '@/components/task/TaskToolbar.vue'
import { useTaskFilters } from '@/composables/useTaskFilters'
import { returnToQuery } from '@/utils/safeReturnTo'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { can } = useAccess()

// The SSR-rendered toolbar is clickable before hydration attaches its listeners (see useHydrated()).
const hydrated = useHydrated()

const isBoard = computed(() => route.query.view === 'board')
const normalizedPath = computed(() => route.path.replace(/\/+$/, '') || '/')
const isBaseRoute = computed(() => normalizedPath.value === '/tasks')
const isCreateRoute = computed(() => normalizedPath.value === '/tasks/new')
const showList = computed(() => isBaseRoute.value || isCreateRoute.value)
// Table is the first option, so it is the bare URL; the switch writes ?view=board for the board.
const views = computed(() => [
  { value: 'table', label: t('projects.filters.tableView'), icon: 'i-lucide-list' },
  { value: 'board', label: t('projects.filters.boardView'), icon: 'i-lucide-layout-grid' },
])

// Detail is a real route (/tasks/{id}, see pages/tasks/[id].vue). The list's own state travels as
// plain query, not wrapped in a returnTo: the detail page hands the same keys straight back, so
// ?view=board survives the round trip and nothing accumulates in the URL.
function taskTo(id: number) {
  return { path: `/tasks/${id}`, query: { ...route.query } }
}

// Filters persist per browser; useTaskFilters centralizes the localStorage key/defaults so the
// detail page's prev/next lookup reads the exact cache entry this table queries with.
const params = useTaskFilters()

const createTo = computed(() => can('pmo.tasks.create') ? { path: '/tasks/new', query: returnToQuery(route.fullPath) } : undefined)
function openCreate() {
  router.push({ path: '/tasks/new', query: returnToQuery(route.fullPath) })
}
</script>

<template>
  <SharedListPage
    v-if="showList"
    :title="t('tasks.title')"
    :description="t('tasks.description')"
    :create-to="createTo"
    :create-label="t('tasks.new')"
    :views="views"
  >
    <template #actions>
      <UButton color="neutral" variant="outline" :to="{ path: '/archived-tasks', query: returnToQuery(route.fullPath) }">
        {{ t('taskLifecycle.archivedTasks') }}
      </UButton>
    </template>
    <template #filters>
      <TaskToolbar v-model="params" collapsible />
    </template>
    <!-- Query data may resolve after SSR markup is emitted but before client hydration starts. Mount
         the dynamic result surface only after this page has hydrated so the toolbar controls above
         keep their listeners and their first click is never lost. -->
    <TaskTable v-if="hydrated && !isBoard" :params="params" :row-to="task => taskTo(task.id)" @create="openCreate" />
    <TaskBoard v-else-if="hydrated" :params="params" @open="id => router.push(taskTo(id))" />
  </SharedListPage>
  <NuxtPage />
</template>
```

Update the pinned test `apps/web/app/pages/__tests__/taskBackTargets.test.ts`, test `returns a standalone task opened from the board back to the board`, in place. Replace its body's first part

```ts
    const router = makeRouter()
    await router.push('/tasks?view=board')
    await router.isReady()
    // openTask navigates rather than returning a location, so record the push.
    let pushed: RouteLocationRaw | undefined
    const recorder = { ...router, currentRoute: router.currentRoute, push: (to: RouteLocationRaw) => { pushed = to; return Promise.resolve() }, replace: () => Promise.resolve() }
    const list = loadSetupState('app/pages/tasks.vue', router, { useRouter: () => recorder })
    ;(list.openTask as (id: number) => void)(5)

    const detail = router.resolve(pushed!)
```

with

```ts
    const router = makeRouter()
    await router.push('/tasks?view=board')
    await router.isReady()
    const list = loadSetupState('app/pages/tasks.vue', router)
    const to = (list.taskTo as (id: number) => RouteLocationRaw)(5)

    const detail = router.resolve(to)
```

(the rest of the test is unchanged). If the file's `pushed` variable or the `recorder` helper is now unused anywhere else in that file, delete only those lines.

Then the `/tasks` expectation in `apps/web/e2e/shortcuts-tasmim.spec.ts`: in the same test as T4's change, the last line of the file's `/tasks` half becomes

```ts
    await expect(page).toHaveURL(/\/tasks\/new\?returnTo=(?:%2F|\/)tasks$/)
```

replacing `await expect(page).toHaveURL(/\/projects\/new\?returnTo=(?:%2F|\/)projects$/)` that follows `await hydrated(page, '/tasks')`. Leave the test title and the `/projects` half alone (T4 owns it).

- [ ] **Step 6: `pages/projects/[id]/tasks.vue`**

Keep the script's `route`, `router`, `t`, `can`, `hydrated`, `projectId`, `useProject` block, `project`, `notFound`, `projectReturnTo`, `isBoard`, `normalizedPath`, `isListRoute`, `params`, `stageSource`, `canCreate`, `filterQuery`, `onParams`, `taskTo` and `openCreate` exactly as they are. Delete the `ListTitle` component (the template's `ListPage` header registers the shell title) and `viewTo`. Add:

```ts
// Table is the first option, so it is the bare URL; the switch writes ?view=board for the board.
const views = computed(() => [
  { value: 'table', label: t('projects.tabs.list'), icon: 'i-lucide-list' },
  { value: 'board', label: t('projects.tabs.board'), icon: 'i-lucide-layout-grid' },
])
const createTo = computed(() => ({ path: `/projects/${projectId.value}/tasks/new`, query: filterQuery.value }))
```

Replace the `<template>` with:

```vue
<template>
  <template v-if="isListRoute">
    <SharedPageContainer v-if="notFound || error" width="list">
      <div v-if="notFound" class="flex flex-col items-start gap-3">
        <p class="text-muted">{{ t('projects.notFound') }}</p>
        <UButton type="button" color="neutral" variant="outline" size="sm" @click="router.push(projectReturnTo)">{{ t('projects.backToProjects') }}</UButton>
      </div>
      <SharedPageState v-else :error="error" @retry="refetch" />
    </SharedPageContainer>
    <!-- The frame is this page's h1: hide-header draws no heading, the create button stays in the header row. -->
    <SharedListPage
      v-else
      hide-header
      :title="t('nav.projectTasks')"
      :create-to="canCreate ? createTo : undefined"
      :create-label="t('tasks.new')"
      create-test-id="project-header-create"
      :views="views"
    >
      <template #filters>
        <TaskToolbar :model-value="params" embedded collapsible hide-project-filter @update:model-value="onParams" />
      </template>
      <section class="min-w-0 space-y-4" :aria-label="t('projects.tabs.tasks')">
        <TaskTable v-if="!isBoard" :params="params" variant="project" :row-to="task => taskTo(task.id)" @create="openCreate" />
        <div v-else class="overflow-hidden rounded-lg bg-default ring ring-default">
          <TaskBoard :params="params" :stage-source="stageSource" embedded @open="(id: number) => router.push(taskTo(id))" />
        </div>
        <div class="flex justify-end">
          <NuxtLink :to="{ path: '/archived-tasks', query: { project_id: projectId, returnTo: route.fullPath } }" class="text-sm text-muted hover:underline">{{ t('taskLifecycle.archivedTasks') }}</NuxtLink>
        </div>
      </section>
    </SharedListPage>
  </template>
  <NuxtPage />
</template>
```

This keeps the three pinned page tests green: no destructured slot props, `NuxtLink` for the archive link is the first `NuxtLink` in render order, `isBoard`/`canCreate`/`notFound`/`stageSource` are still exposed.

- [ ] **Step 7: Story contexts and gates**

`PageHeader.stories.ts` line 18 cited `pages/tasks.vue`, and `PageContainer.stories.ts` (the `List` story) cites `pages/tasks.vue`; neither file mentions those components now. Repoint them to a page that still does:

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim-p5-tasks-lists
rg -n "SharedPageHeader|SharedPageContainer" apps/web/app/pages/archived-tasks.vue
```

In `apps/web/stories/shared/PageHeader.stories.ts` change `apps/web/app/pages/tasks.vue:48` to `apps/web/app/pages/archived-tasks.vue:<line of <SharedPageHeader>>`; in `apps/web/stories/shared/PageContainer.stories.ts` change `apps/web/app/pages/tasks.vue:47` to `apps/web/app/pages/archived-tasks.vue:<line of <SharedPageContainer>>`. Then:

```bash
python3 -B tools/ui_policy.py --refresh-story-context
python3 -B tools/ui_policy.py && python3 -B tools/arch_policy.py && node tools/ui_catalog.mjs --check
npm -w apps/web run lint
(cd apps/web && npx vitest run app/pages/__tests__)
```

Expected: policies exit 0; the three pinned page suites (`projectSectionGuards`, `taskBackTargets`, `uiReviewNavigationForms`) pass. If `ui_policy` names another story whose cited file no longer mentions its component (the `EmptyState` and `StateMenu`/`PrioritySelect` stories cite `TaskTable.vue`, which still mentions all three), repoint it to the file that does.

- [ ] **Step 8: Run the pilot spec and the affected specs**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim-p5-tasks-lists/apps/web
bash /Users/tariq/code/nasq/.worktrees/tasmim/.superpowers/tasmim-shared/p5-e2e.sh 05 \
  e2e/pilot-tasks.spec.ts e2e/shortcuts-tasmim.spec.ts e2e/tasks.spec.ts e2e/board.spec.ts e2e/detail.spec.ts \
  e2e/task-lifecycle.spec.ts e2e/scroll-restoration.spec.ts e2e/projects.spec.ts e2e/project-layout-unified.spec.ts \
  e2e/project-workspace-continuity.spec.ts e2e/navigation-gate.spec.ts e2e/hydration.spec.ts e2e/header-overlays.spec.ts \
  e2e/design-fidelity.spec.ts e2e/project-popups.spec.ts
```

Expected: `NEW failures` empty and every `Plan 5 pilot: the task lists` test passed. `navigation-gate` "every page has exactly one h1 › my tasks (/tasks)" and "› project tasks (/projects/1/tasks)" must pass. `shortcuts-tasmim` "/ focuses the list search…" passes on this branch (its `/projects` half still describes the old page, which has not moved here) and on T4's branch (the `/tasks` half still describes the old page there). The orchestrator re-runs it on the merged tip, where both halves describe the new pages.

- [ ] **Step 9: Gates and commit**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim-p5-tasks-lists
npm test 2>&1 | tail -4
git add apps/web docs/design-system
git commit -m "refactor(web): move the task lists onto ListPage and DataTable

/tasks and the project task tab are ListPages with a table/board
switch bound to ?view=; TaskTable renders through DataTable with a
real title link and phone rows, TaskToolbar drops its own view
switch. The project tab keeps the frame's h1 as its only heading
(hide-header) and its header-level create button. C now presses
«مهمة جديدة» on both.

Updated assertions: shortcuts-tasmim '/ focuses the list search…'
expects C on /tasks to open /tasks/new; taskBackTargets 'returns a
standalone task opened from the board back to the board' reads
taskTo(5) instead of recording openTask(5).

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `/projects/[id]` overview as a record page

The overview (`pages/projects/[id]/index.vue` + `ProjectOverview`) sits under the frame: no heading of its own, a dates line, three metric tiles, a «يحتاج انتباهك» card and a «آخر تحديث» card in a two-column grid, its own container-query CSS in a scoped `<style>`. It becomes a `SharedRecordPage` with `hideHeader` (the frame keeps the `<h1>`): the main column holds the metric tiles and two `SharedRecordSection`s (the same two `<h2>` it has now), the aside holds a `SharedPropertiesPanel` with the facts the frame does not already show (start date, end date, tasks, milestones, followers; status and manager stay in the frame, so no second `project-status`). The not-found block (text and button) is unchanged, because e2e read its text. Known, accepted difference: on that block the page registers no shell title (the old script registered `nav.projectSummary` unconditionally); the shell shows its default title there.

**Files:**
- Modify: `apps/web/app/pages/projects/[id]/index.vue`
- Rewrite: `apps/web/app/components/project/ProjectOverview.vue`, `apps/web/app/components/project/ProjectOverviewTasks.vue`
- Create: `apps/web/e2e/pilot-project-record.spec.ts`

**Interfaces:**
- Consumes: `SharedRecordPage` (`title`, `loading`, `error`, `hideHeader`, slots default/`aside`, emit `retry`), `SharedRecordSection` (`title`, slot `actions`), `SharedPropertiesPanel`, `SharedPropertyRow` (`label`, `value`), `SharedMetricTile`, `useProject`, `useMilestones`, `useProjectUpdates`.
- Produces:
  - `ProjectOverview` keeps its prop `{ project: ProjectDetail }`; it now renders only the main column (tiles + sections) and no scoped style. Its root carries `data-testid="project-overview"`.
  - `ProjectOverviewTasks` keeps `{ projectId: number; returnTo: string }`, root `data-testid="project-active-tasks"`.
  - The page's aside rows: `projects.charter.fields.date_start`, `projects.columns.dateEnd`, `projects.overview.tasks`, `projects.overview.milestones`, `projects.overview.followers`. No new i18n key.

- [ ] **Step 1: Write the failing pilot spec**

Create `apps/web/e2e/pilot-project-record.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test'

// Plan 5 pilot: the project overview (/projects/1) on SharedRecordPage inside the workspace frame
// (isolated mock stack). Project 1 is «مشروع ألفا» with start 2026-01-01 and one follower.
const ADMIN_LOGIN = process.env.E2E_ADMIN_LOGIN ?? 'admin'
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'admin'
async function login(page: Page) {
  const response = await page.request.post('/api/auth/login', { data: { login: ADMIN_LOGIN, password: ADMIN_PASSWORD } })
  expect(response.status()).toBe(200)
}
async function open(page: Page, path: string) {
  await page.goto(path)
  await expect(page.getByTestId('global-search-trigger')).toBeEnabled()
}
const fitsWidth = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)

test.describe('Plan 5 pilot: the project overview', () => {
  test.beforeEach(async ({ page }) => { await login(page) })

  test.describe('desktop', () => {
    test.use({ viewport: { width: 1440, height: 900 } })

    test('the frame keeps the only h1 and the overview adds exactly its two section headings', async ({ page }) => {
      await open(page, '/projects/1')
      await expect(page.getByTestId('project-overview')).toBeVisible()
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('مشروع ألفا')
      const headings = await page.locator('main h2').allTextContents()
      expect(headings.map(text => text.trim())).toEqual(['يحتاج انتباهك', 'آخر تحديث'])
      await expect(page.locator('[data-template="record"]')).toHaveCount(1)
      await expect(page.locator('[data-template="record"] [data-slot="page-header"]')).toHaveCount(0)
      await expect(page.getByTestId('project-workspace-name')).toHaveText('مشروع ألفا')
    })

    test('metrics, sections and the properties aside show the project facts once', async ({ page }) => {
      await open(page, '/projects/1')
      await expect(page.getByTestId('metric-tile')).toHaveCount(3)
      await expect(page.getByTestId('project-active-tasks')).toBeVisible()
      await expect(page.getByTestId('project-overview-latest-update')).toBeVisible()
      const aside = page.getByRole('complementary', { name: 'الخصائص' })
      await expect(aside).toBeVisible()
      await expect(aside.locator('[data-slot="property-row"]')).toHaveCount(5)
      await expect(aside.getByText('تاريخ البدء')).toBeVisible()
      await expect(aside.getByText('المعالم')).toBeVisible()
      await expect(aside.getByText('المتابعون')).toBeVisible()
      // Status and manager live in the frame only: one project-status on the page.
      await expect(page.getByTestId('project-status')).toHaveCount(1)
      await expect(page.getByTestId('project-overview').getByTestId('project-status-select')).toHaveCount(0)
    })

    test('a project without dates shows dashes with a spoken «لا قيمة»', async ({ page }) => {
      await open(page, '/projects?view=table')
      // Opened from the list, the project is fetched by the browser, so the response can be replaced.
      await page.route('**/api/v1/projects/1', async route => {
        const response = await route.fetch()
        const body = await response.json()
        await route.fulfill({ response, json: { ...body, date_start: null, date_end: null } })
      })
      await page.getByTestId('project-row').first().click()
      await expect(page).toHaveURL(/\/projects\/1(?:\?|$)/)
      const aside = page.getByRole('complementary', { name: 'الخصائص' })
      const start = aside.locator('[data-slot="property-row"]').filter({ hasText: 'تاريخ البدء' })
      await expect(start.locator('dd')).toContainText('—')
      await expect(start.locator('dd .sr-only')).toHaveText('لا قيمة')
    })

    test('a project that cannot be read keeps the not-found text and its way back', async ({ page }) => {
      await page.goto('/projects/999')
      await expect(page.getByText('المشروع غير موجود أو لا تملك صلاحية عرضه')).toBeVisible()
      await expect(page.getByRole('button', { name: 'العودة إلى المشاريع' })).toBeVisible()
      await expect(page.locator('[data-template="record"]')).toHaveCount(0)
    })
  })

  test.describe('phone', () => {
    test.use({ viewport: { width: 390, height: 844 } })

    test('on a 390px phone the properties follow the sections and nothing overflows', async ({ page }) => {
      await open(page, '/projects/1')
      const section = await page.getByTestId('project-active-tasks').boundingBox()
      const aside = await page.getByRole('complementary', { name: 'الخصائص' }).boundingBox()
      expect(aside!.y).toBeGreaterThan(section!.y)
      expect(await fitsWidth(page)).toBe(true)
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    })
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim-p5-project-record/apps/web
bash /Users/tariq/code/nasq/.worktrees/tasmim/.superpowers/tasmim-shared/p5-e2e.sh 06 e2e/pilot-project-record.spec.ts
```

Expected: `NEW failures` lists the heading-inventory, properties-aside, no-dates and phone tests (no `data-template="record"`, no aside); the not-found test passes already.

- [ ] **Step 3: The overview sections**

Replace `apps/web/app/components/project/ProjectOverviewTasks.vue` with:

```vue
<script setup lang="ts">
import { useTasks, type TaskListParams } from '@/composables/useTasks'
import { formatCalendarDate } from '@/composables/calendarDate'
import { returnToQuery } from '@/utils/safeReturnTo'

// "Needs your attention": the overdue open tasks of the project (first five), as a record section.
const props = defineProps<{ projectId: number; returnTo: string }>()
const taskParams = computed<TaskListParams>(() => ({ mine: false, project_id: props.projectId, closed: false }))
const { data, isLoading, isError, error, refetch } = useTasks(taskParams)
const tasks = computed(() => data.value?.pages.flatMap(page => page.items) ?? [])
const attention = computed(() => tasks.value.filter(task => task.is_overdue).slice(0, 5))
const { t, locale } = useI18n()

function taskQuery() {
  return returnToQuery(props.returnTo)
}
function deadlineLabel(value: string | null) {
  return value ? formatCalendarDate(value, locale.value) : '—'
}
</script>

<template>
  <SharedRecordSection data-testid="project-active-tasks" :title="t('projects.overview.needsAttention')">
    <template #actions>
      <NuxtLink :to="`/projects/${props.projectId}/tasks`" class="text-xs text-muted underline underline-offset-4 hover:text-highlighted">
        {{ t('projects.overview.viewTasks') }}
      </NuxtLink>
    </template>
    <div class="rounded-lg bg-default p-4 ring ring-default">
      <div v-if="isLoading" class="space-y-3" data-testid="project-active-tasks-loading">
        <USkeleton v-for="n in 3" :key="n" class="h-10 w-full" />
      </div>
      <UAlert v-else-if="isError" role="alert" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="error instanceof Error ? error.message : t('errors.generic')">
        <template #actions>
          <UButton type="button" color="neutral" variant="outline" size="sm" :label="t('app.retry')" @click="refetch()" />
        </template>
      </UAlert>
      <template v-else>
        <p v-if="!attention.length" class="text-sm text-muted">{{ t('projects.refresh.workspace.needsAttentionPreviewEmpty') }}</p>
        <div v-else class="divide-y divide-default">
          <NuxtLink
            v-for="task in attention"
            :key="task.id"
            :to="{ path: `/projects/${props.projectId}/tasks/${task.id}`, query: taskQuery() }"
            class="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0 hover:bg-elevated/50"
          >
            <span class="min-w-0">
              <span class="block truncate text-sm font-medium">{{ task.name }}</span>
              <span class="mt-1 flex flex-wrap gap-x-2 text-xs text-muted">
                <span>{{ task.assignees[0]?.name ?? t('tasks.drawer.unassigned') }}</span>
                <span aria-hidden="true">·</span>
                <bdi>{{ deadlineLabel(task.date_deadline) }}</bdi>
              </span>
            </span>
            <UBadge variant="subtle" color="error">{{ t('projects.milestones.overdue') }}</UBadge>
          </NuxtLink>
        </div>
        <p class="mt-3 text-xs text-muted">{{ t('projects.overview.activeTasksCap') }}</p>
      </template>
    </div>
  </SharedRecordSection>
</template>
```

Replace `apps/web/app/components/project/ProjectOverview.vue` with:

```vue
<script setup lang="ts">
import type { ProjectDetail, ProjectStatus } from '@webvue/contracts'
import { formatCalendarDate } from '@/composables/calendarDate'
import { projectStatusBadge } from '@/composables/projectStatus'
import { useMilestones } from '@/composables/useMilestones'
import { useProjectUpdates } from '@/composables/useProjectUpdates'
import { badgeLabel } from '@/utils/statusBadge'
import ProjectOverviewTasks from './ProjectOverviewTasks.vue'

// The main column of the project record: progress figures, tasks that need attention, the latest
// update. The page puts the properties in the record's aside. Status and manager are shown once, by the
// workspace frame, and are changed only in project settings.
const props = defineProps<{ project: ProjectDetail }>()
const { t, locale } = useI18n()
const projectBadge = (status: ProjectStatus | null) => { const entry = projectStatusBadge(status); return { tone: entry.tone, label: badgeLabel(entry, status, t) } }
const route = useRoute()
const projectId = computed(() => props.project.id)
const milestones = useMilestones(projectId)
const updates = useProjectUpdates(projectId)

const nearestMilestone = computed(() => {
  return (milestones.data.value ?? [])
    .filter(item => !item.is_reached)
    .sort((a, b) => (a.deadline ?? '9999-12-31').localeCompare(b.deadline ?? '9999-12-31'))[0] ?? null
})
const latestUpdate = computed(() => [...(updates.data.value ?? [])].sort((a, b) => b.date.localeCompare(a.date))[0] ?? null)
const openTaskCount = computed(() => Math.max(0, props.project.task_count - props.project.closed_task_count))

function dateLabel(value: string | null) {
  return value ? formatCalendarDate(value, locale.value) : '—'
}
</script>

<template>
  <div data-testid="project-overview" class="@container min-w-0 space-y-6">
    <section class="grid gap-6 @min-[35rem]:grid-cols-2 @min-[48rem]:grid-cols-3">
      <SharedMetricTile
        icon="i-lucide-chart-no-axes-column-increasing"
        :label="t('projects.overview.progress')"
        :value="project.progress"
        unit="%"
        value-dir="ltr"
        :hint="t('projects.overview.completedOf', { closed: project.closed_task_count, total: project.task_count })"
      >
        <UProgress :model-value="project.progress" class="mt-2" size="sm" />
      </SharedMetricTile>
      <SharedMetricTile
        icon="i-lucide-list-checks"
        :label="t('projects.overview.openTasks')"
        :value="openTaskCount"
        :hint="t('projects.overview.completedOf', { closed: project.closed_task_count, total: project.task_count })"
      />
      <SharedMetricTile
        icon="i-lucide-flag"
        :label="t('projects.overview.nextMilestone')"
        :value="nearestMilestone ? dateLabel(nearestMilestone.deadline) : null"
        :hint="nearestMilestone?.name ?? t('projects.overview.noUpcomingMilestone')"
      />
    </section>

    <ProjectOverviewTasks :project-id="project.id" :return-to="route.fullPath" />

    <SharedRecordSection data-testid="project-overview-latest-update" :title="t('projects.overview.latestUpdate')">
      <template #actions>
        <NuxtLink :to="`/projects/${project.id}/updates`" class="text-xs text-muted underline underline-offset-4 hover:text-highlighted">
          {{ t('projects.refresh.workspace.viewAllUpdates') }}
        </NuxtLink>
      </template>
      <div class="rounded-lg bg-default p-4 ring ring-default">
        <USkeleton v-if="updates.isLoading.value" class="h-10 w-full" />
        <SharedPageState v-else-if="updates.error.value" :error="updates.error.value" @retry="updates.refetch()" />
        <div v-else-if="latestUpdate" class="grid min-w-0 gap-2">
          <div class="flex min-w-0 items-center gap-2">
            <SharedStatusBadge v-bind="projectBadge(latestUpdate.status)" />
            <span class="truncate text-sm font-medium">{{ latestUpdate.name }}</span>
          </div>
          <p class="flex flex-wrap gap-x-2 text-xs text-muted">
            <span>{{ latestUpdate.author.name }}</span>
            <span aria-hidden="true">·</span>
            <bdi>{{ dateLabel(latestUpdate.date) }}</bdi>
          </p>
        </div>
        <p v-else class="text-sm text-muted">{{ t('projects.overview.noUpdates') }}</p>
      </div>
    </SharedRecordSection>
  </div>
</template>
```

(The `project-status` test id is no longer on the latest-update badge: the frame holds the page's one `project-status`, which the pilot spec pins; the old badge made it two.)

- [ ] **Step 4: The page**

Replace `apps/web/app/pages/projects/[id]/index.vue` with:

```vue
<script setup lang="ts">
import ProjectOverview from '@/components/project/ProjectOverview.vue'
import { formatCalendarDate } from '@/composables/calendarDate'
import { ApiError } from '@/composables/useApi'
import { projectIdFromPath } from '@/composables/nav/activeRoute'
import { useProject } from '@/composables/useProjects'
import { safeReturnTo } from '@/utils/safeReturnTo'

const route = useRoute()
const router = useRouter()
const { t, locale } = useI18n()
const hydrated = useHydrated()
const projectId = computed(() => projectIdFromPath(route.path))
const { data: projectData, isLoading, error, refetch } = useProject(projectId)
// Same SSR contract as the frame: reveal the cached project only once hydrated.
const project = computed(() => hydrated.value ? projectData.value : undefined)
const notFound = computed(() => projectId.value === null || (error.value instanceof ApiError && (error.value.status === 404 || error.value.status === 403)))
const projectReturnTo = computed(() => safeReturnTo(route.query.returnTo, '/projects', ['/projects', '/tasks', '/hr', '/settings', '/account', '/search', '/notifications', '/reports']))
// The first client render must match SSR, which has no project yet: loading until hydrated.
const loading = computed(() => !project.value && !error.value && (isLoading.value || !hydrated.value))

function dateLabel(value: string | null | undefined) {
  return value ? formatCalendarDate(value, locale.value) : null
}
</script>

<template>
  <SharedPageContainer v-if="notFound" width="list">
    <div class="flex flex-col items-start gap-3">
      <p class="text-muted">{{ t('projects.notFound') }}</p>
      <UButton type="button" color="neutral" variant="outline" size="sm" @click="router.push(projectReturnTo)">{{ t('projects.backToProjects') }}</UButton>
    </div>
  </SharedPageContainer>
  <!-- The workspace frame above is this page's h1, so hide-header draws no heading here. The title still
       names the page for the shell. -->
  <SharedRecordPage v-else hide-header :title="t('nav.projectSummary')" :loading="loading" :error="error" @retry="refetch">
    <ProjectOverview v-if="project" :project="project" />
    <template v-if="project" #aside>
      <SharedPropertiesPanel>
        <SharedPropertyRow :label="t('projects.charter.fields.date_start')" :value="dateLabel(project.date_start)" />
        <SharedPropertyRow :label="t('projects.columns.dateEnd')" :value="dateLabel(project.date_end)" />
        <SharedPropertyRow :label="t('projects.overview.tasks')" :value="t('projects.overview.completedOf', { closed: project.closed_task_count, total: project.task_count })" />
        <SharedPropertyRow :label="t('projects.overview.milestones')" :value="project.milestone_count" />
        <SharedPropertyRow :label="t('projects.overview.followers')" :value="project.followers_count" />
      </SharedPropertiesPanel>
    </template>
  </SharedRecordPage>
</template>
```

- [ ] **Step 5: Policy, lint and the pinned tests**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim-p5-project-record
python3 -B tools/ui_policy.py --refresh-story-context
python3 -B tools/ui_policy.py && python3 -B tools/arch_policy.py && node tools/ui_catalog.mjs --check
npm -w apps/web run lint
(cd apps/web && npx vitest run app/pages/__tests__ app/components/shared/__tests__)
```

Expected: exit 0 everywhere. `ProjectOverview.vue` no longer has a `<style>` block; `tools/ui_policy.py`'s `STYLE_OWNERS` still lists it (a stale entry is harmless and is removed by T8).

- [ ] **Step 6: Run the pilot spec and the affected specs**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim-p5-project-record/apps/web
bash /Users/tariq/code/nasq/.worktrees/tasmim/.superpowers/tasmim-shared/p5-e2e.sh 06 \
  e2e/pilot-project-record.spec.ts e2e/projects.spec.ts e2e/nuxt-reference-details.spec.ts e2e/project-clarity.spec.ts \
  e2e/project-layout-unified.spec.ts e2e/navigation-gate.spec.ts e2e/design-fidelity.spec.ts e2e/project-popups.spec.ts \
  e2e/project-admin.spec.ts e2e/project-workspace-continuity.spec.ts e2e/hydration.spec.ts
```

Expected: `NEW failures` empty and all pilot tests passed. `navigation-gate` "every page has exactly one h1 › project summary (/projects/1)" must pass. `project-admin` titles that read «المشروع غير موجود أو لا تملك صلاحية عرضه» must keep passing (the text block is unchanged).

- [ ] **Step 7: Gates and commit**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim-p5-project-record
npm test 2>&1 | tail -4
git add apps/web
git commit -m "refactor(web): move the project overview onto RecordPage

The overview is a RecordPage with hide-header under the workspace
frame, which keeps the page's only h1. Its two section headings are
RecordSections, the date range becomes a PropertiesPanel with the
facts the frame does not show, and the scoped container-query CSS
is gone. The project-status test id now appears once (the frame).

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: `/projects/dashboard` on `DashboardPage` + `ChartPanel`

The dashboard page draws a container, a header, a `FilterBar`, then one of: a hand-made loading skeleton, an analytics `UAlert`, an empty block, or `ProjectDashboardMetrics` + `ProjectDashboardCharts` (its own container-query grid in a scoped `<style>`, six hand-built chart cards) + `ProjectDashboardRecentProjects`. It becomes a `SharedDashboardPage`: the filter bar goes in the new `#filters` slot, the metric tiles in `#metrics`, the six charts are `SharedChartPanel`s (via the slimmed `DashboardChartPanel` wrapper) in the template's grid with the two wide ones spanning both columns, and the loading, error and empty states stay with the page but use the shared states (`SharedLoadingSkeleton`, `SharedErrorState`, `SharedEmptyState`) with the same test ids.

**Files:**
- Modify: `apps/web/app/pages/projects/dashboard.vue`
- Modify: `apps/web/app/components/project/dashboard/DashboardChartPanel.vue`, `ProjectDashboardCharts.vue`, `ProjectDashboardMetrics.vue`
- Modify: `apps/web/stories/project/dashboard/DashboardChartPanel.stories.ts` (drops the `titleId` arg)
- Create: `apps/web/e2e/pilot-dashboard.spec.ts`

**Interfaces:**
- Consumes: `SharedDashboardPage` (`title`, `hideHeader`; slots `actions`, `filters`, `metrics`, default), `SharedChartPanel` (`title`, `description`, `loading`, `empty`, `emptyText`; slot `actions`), `SharedLoadingSkeleton` (`variant="cards"`), `SharedErrorState` (`error`, `title`; emit `retry`), `SharedEmptyState`, `SharedMetricTile`.
- Produces:
  - `DashboardChartPanel` props `{ testId; title; description; chart; variant?; hasData; loading?; emptyText; accessibleLabel; height? }` (the `titleId` prop is gone: the panel generates its own heading id). Its root is `SharedChartPanel`, so a caller's `class` lands on the card.
  - `ProjectDashboardCharts` and `ProjectDashboardMetrics` render fragments (panels, tiles) with no wrapper, so they sit directly in `DashboardPage`'s grid and metric row.
  - Page contract: test ids `project-dashboard-page`, `project-dashboard-empty`, `project-dashboard-analytics-error`, `chart-*`, `chart-currency-filter`, `recent-project-row` unchanged; the analytics failure still offers a button named «إعادة المحاولة».

- [ ] **Step 1: Write the failing pilot spec**

Create `apps/web/e2e/pilot-dashboard.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test'

// Plan 5 pilot: /projects/dashboard on SharedDashboardPage + SharedChartPanel (isolated mock stack).
// The mock analytics call returns three projects, so the six panels and the recent-projects card render.
const ADMIN_LOGIN = process.env.E2E_ADMIN_LOGIN ?? 'admin'
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'admin'
const PANELS = ['chart-status', 'chart-tasks', 'chart-progress-bands', 'chart-budget-health', 'chart-project-progress', 'chart-project-finance']
async function login(page: Page) {
  const response = await page.request.post('/api/auth/login', { data: { login: ADMIN_LOGIN, password: ADMIN_PASSWORD } })
  expect(response.status()).toBe(200)
}
async function open(page: Page, path = '/projects/dashboard') {
  await page.goto(path)
  await expect(page.getByTestId('global-search-trigger')).toBeEnabled()
}
const fitsWidth = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)

test.describe('Plan 5 pilot: the project dashboard', () => {
  test.beforeEach(async ({ page }) => { await login(page) })

  test.describe('desktop', () => {
    test.use({ viewport: { width: 1440, height: 900 } })

    test('the dashboard template holds the filters, four metric tiles, six chart panels and the recent projects', async ({ page }) => {
      await open(page)
      await expect(page.getByTestId('project-dashboard-page')).toBeVisible()
      await expect(page.locator('[data-template="dashboard-page"]')).toHaveCount(1)
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('لوحة المشاريع')
      await expect(page.locator('[data-template="dashboard-filters"]')).toBeVisible()
      await expect(page.getByTestId('project-dashboard-status-filter')).toBeAttached()
      await expect(page.locator('[data-template="dashboard-metrics"] [data-testid="metric-tile"]')).toHaveCount(4)
      for (const id of PANELS) await expect(page.getByTestId(id)).toBeVisible()
      await expect(page.locator('[data-template="chart-panel"]')).toHaveCount(6)
      await expect(page.getByTestId('recent-project-row')).toHaveCount(3)
      await expect(page.getByTestId('chart-canvas').first()).toBeVisible()
    })

    test('charts sit two-up and the wide ones span both columns', async ({ page }) => {
      await open(page)
      const box = async (id: string) => (await page.getByTestId(id).boundingBox())!
      const [status, tasks, wide, finance] = [await box('chart-status'), await box('chart-tasks'), await box('chart-project-progress'), await box('chart-project-finance')]
      expect(status.y).toBeCloseTo(tasks.y, 0)
      expect(wide.width).toBeGreaterThan(status.width + tasks.width)
      expect(finance.width).toBeGreaterThan(status.width + tasks.width)
    })

    test('analytics failure and an empty result keep their blocks, and the failure retries', async ({ page }) => {
      let unavailable = true
      await page.route('**/api/v1/reports/projects/analytics*', route => unavailable
        ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'unavailable', message: 'Test unavailable' }) })
        : route.continue())
      await page.goto('/projects/dashboard')
      const failure = page.getByTestId('project-dashboard-analytics-error')
      await expect(failure).toBeVisible({ timeout: 15_000 })
      await expect(page.getByTestId('chart-canvas')).toHaveCount(0)
      unavailable = false
      await failure.getByRole('button', { name: 'إعادة المحاولة', exact: true }).click()
      await expect(page.getByTestId('chart-status')).toBeVisible()
      await page.unroute('**/api/v1/reports/projects/analytics*')
      await page.route('**/api/v1/reports/projects/analytics*', async route => {
        const response = await route.fetch()
        const body = await response.json()
        await route.fulfill({ response, json: { ...body, project_count: 0, projects: [], recent_projects: [], status_counts: [] } })
      })
      await page.goto('/projects/dashboard?q=does-not-exist')
      await expect(page.getByTestId('project-dashboard-empty')).toBeVisible()
      await expect(page.getByTestId('recent-project-row')).toHaveCount(0)
      await expect(page.locator('[data-template="chart-panel"]')).toHaveCount(0)
    })

    test('a filter lands in the URL and survives a reload', async ({ page }) => {
      await open(page, '/projects/dashboard?status=off_track')
      await expect(page).toHaveURL(/status=off_track/)
      await page.reload()
      await expect(page.getByTestId('global-search-trigger')).toBeEnabled()
      await expect(page).toHaveURL(/status=off_track/)
      await expect(page.getByTestId('project-dashboard-page')).toBeVisible()
    })
  })

  test.describe('phone', () => {
    test.use({ viewport: { width: 390, height: 844 } })

    test('on a 390px phone the panels stack and nothing overflows', async ({ page }) => {
      await open(page)
      for (const id of PANELS) await expect(page.getByTestId(id)).toBeVisible()
      const status = (await page.getByTestId('chart-status').boundingBox())!
      const tasks = (await page.getByTestId('chart-tasks').boundingBox())!
      expect(tasks.y).toBeGreaterThan(status.y + status.height - 1)
      expect(await fitsWidth(page)).toBe(true)
    })
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim-p5-dashboard/apps/web
bash /Users/tariq/code/nasq/.worktrees/tasmim/.superpowers/tasmim-shared/p5-e2e.sh 07 e2e/pilot-dashboard.spec.ts
```

Expected: `NEW failures` lists the template test (`data-template="dashboard-page"` is absent), the two-up test and the failure/empty test only if the template markers are asserted; the filter and phone tests may already pass.

- [ ] **Step 3: The chart panels**

Replace `apps/web/app/components/project/dashboard/DashboardChartPanel.vue` with:

```vue
<script setup lang="ts">
import type { DashboardChart as DashboardChartModel } from '@/utils/projectChartData'
import ChartPanel from '@/components/shared/ChartPanel.vue'
import DashboardChart from '@/components/shared/DashboardChart.client.vue'

// One project chart: the shared panel (title, loading, the chart's own empty sentence) around the Unovis chart.
withDefaults(defineProps<{
  testId: string
  title: string
  description: string
  chart: DashboardChartModel
  variant?: 'pie' | 'donut' | 'donut-text'
  hasData: boolean
  loading?: boolean
  emptyText: string
  accessibleLabel: string
  height?: string
}>(), {
  loading: false,
  height: '300px',
})
</script>

<template>
  <ChartPanel :data-testid="testId" :title="title" :description="description" :loading="loading" :empty="!hasData" :empty-text="emptyText">
    <DashboardChart :chart="chart" :variant="variant" :accessible-label="accessibleLabel" :height="height" />
  </ChartPanel>
</template>
```

In `apps/web/stories/project/dashboard/DashboardChartPanel.stories.ts` delete `titleId: 'story-title',` from `meta.args` and `:title-id="'story-' + title + '-title'"` from the template string. Keep every `storyContext(...)` ref; run `python3 -B tools/ui_policy.py --refresh-story-context` to move their line numbers.

Replace `apps/web/app/components/project/dashboard/ProjectDashboardCharts.vue` with (script unchanged up to `financeChart`; the scoped style is gone):

```vue
<script setup lang="ts">
import type { ProjectReportRow } from '@webvue/contracts'
import DashboardChart from '@/components/shared/DashboardChart.client.vue'
import DashboardChartPanel from './DashboardChartPanel.vue'
import {
  projectDashboardCurrencies,
  projectDashboardHasTaskData,
  projectBudgetHealthChart,
  projectFinanceComparisonData,
  projectFinanceComparisonChart,
  projectProgressBandData,
  projectProgressBandsChart,
  projectProgressByProjectChart,
  projectStatusDoughnutChart,
  projectTaskCompositionChart,
  projectChartLabels,
  type ChartLabels,
} from '@/utils/projectChartData'

// The six charts of the dashboard as chart panels. They render straight into SharedDashboardPage's grid
// (two columns from 768px of the grid's own width); the progress and finance charts span both.
const props = defineProps<{ rows: readonly ProjectReportRow[] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const selectedCurrencyId = ref<number | null>(null)

const labels = computed<ChartLabels>(() => projectChartLabels(t))

const currencies = computed(() => projectDashboardCurrencies(props.rows))
const selectedCurrency = computed(() => currencies.value.find(currency => currency.id === selectedCurrencyId.value) ?? currencies.value[0] ?? null)
watch(currencies, values => {
  if (!values.some(currency => currency.id === selectedCurrencyId.value)) selectedCurrencyId.value = values[0]?.id ?? null
}, { immediate: true })

const statusHasData = computed(() => props.rows.length > 0)
const taskHasData = computed(() => projectDashboardHasTaskData(props.rows))
const taskEmptyText = computed(() => projectDashboardHasTaskData(props.rows) ? t('projects.dashboard.charts.noTaskItems') : t('projects.dashboard.charts.noTaskData'))
const progressBandsHasData = computed(() => projectProgressBandData(props.rows, labels.value).available)
const budgetHasData = computed(() => props.rows.length > 0)
const financeHasData = computed(() => selectedCurrency.value != null && projectFinanceComparisonData(props.rows, selectedCurrency.value.id).length > 0)

const statusChart = computed(() => projectStatusDoughnutChart(props.rows, labels.value, t('projects.dashboard.charts.statusTitle')))
const taskChart = computed(() => projectTaskCompositionChart(props.rows, labels.value, t('projects.dashboard.charts.taskTitle')))
const progressBandsChart = computed(() => projectProgressBandsChart(props.rows, labels.value))
const budgetChart = computed(() => projectBudgetHealthChart(props.rows, labels.value, t('projects.dashboard.charts.budgetHealthTitle')))
const projectProgressChart = computed(() => projectProgressByProjectChart(props.rows, labels.value))
const financeChart = computed(() => selectedCurrency.value ? projectFinanceComparisonChart(props.rows, selectedCurrency.value.id, labels.value) : null)
</script>

<template>
  <DashboardChartPanel
    test-id="chart-status"
    :title="t('projects.dashboard.charts.statusTitle')"
    :description="t('projects.dashboard.charts.statusDescription')"
    :chart="statusChart"
    variant="pie"
    :has-data="statusHasData"
    :empty-text="t('projects.dashboard.charts.noStatusData')"
    :accessible-label="t('projects.dashboard.charts.statusTitle')"
  />
  <DashboardChartPanel
    test-id="chart-tasks"
    :title="t('projects.dashboard.charts.taskTitle')"
    :description="t('projects.dashboard.charts.taskDescription')"
    :chart="taskChart"
    variant="donut-text"
    :has-data="taskHasData"
    :empty-text="taskEmptyText"
    :accessible-label="t('projects.dashboard.charts.taskTitle')"
  />
  <DashboardChartPanel
    test-id="chart-progress-bands"
    :title="t('projects.dashboard.charts.progressBandsTitle')"
    :description="t('projects.dashboard.charts.progressBandsDescription')"
    :chart="progressBandsChart"
    :has-data="progressBandsHasData"
    :empty-text="t('projects.dashboard.charts.noProgressData')"
    :accessible-label="t('projects.dashboard.charts.progressBandsTitle')"
    height="240px"
  />
  <DashboardChartPanel
    test-id="chart-budget-health"
    :title="t('projects.dashboard.charts.budgetHealthTitle')"
    :description="t('projects.dashboard.charts.budgetHealthDescription')"
    :chart="budgetChart"
    variant="donut"
    :has-data="budgetHasData"
    :empty-text="t('projects.dashboard.charts.noBudgetData')"
    :accessible-label="t('projects.dashboard.charts.budgetHealthTitle')"
    height="240px"
  />
  <DashboardChartPanel
    class="@min-[768px]:col-span-2"
    test-id="chart-project-progress"
    :title="t('projects.dashboard.charts.projectProgressTitle')"
    :description="t('projects.dashboard.charts.projectProgressDescription')"
    :chart="projectProgressChart"
    :has-data="rows.length > 0"
    :empty-text="t('projects.dashboard.charts.noProgressData')"
    :accessible-label="t('projects.dashboard.charts.projectProgressTitle')"
    height="360px"
  />
  <SharedChartPanel
    class="@min-[768px]:col-span-2"
    data-testid="chart-project-finance"
    :title="t('projects.dashboard.charts.financeTitle')"
    :description="t('projects.dashboard.charts.financeDescription')"
    :empty="!financeHasData"
    :empty-text="t('projects.dashboard.charts.noFinanceData')"
  >
    <template v-if="currencies.length" #actions>
      <USelect
        data-testid="chart-currency-filter"
        :model-value="selectedCurrency ? String(selectedCurrency.id) : undefined"
        :items="currencies.map(currency => ({ value: String(currency.id), label: `${currency.name} (${currency.symbol})` }))"
        :aria-label="t('projects.dashboard.charts.currency')"
        :placeholder="t('projects.dashboard.charts.currency')"
        class="w-full sm:w-44"
        :disabled="!hydrated"
        @update:model-value="value => { selectedCurrencyId = Number(value) }"
      />
    </template>
    <DashboardChart v-if="financeChart" :chart="financeChart" :accessible-label="t('projects.dashboard.charts.financeTitle')" height="360px" />
  </SharedChartPanel>
</template>
```

Replace the template of `ProjectDashboardMetrics.vue` (the template lives in a section that `DashboardPage`'s `#metrics` slot already provides, with its own label `states.metrics`) with:

```vue
<template>
  <SharedMetricTile
    v-for="metric in metrics"
    :key="metric.key"
    :icon="METRIC_ICON[metric.key] ?? 'i-lucide-chart-column'"
    :label="t(`projects.dashboard.metrics.${metric.key}`)"
    :value="metric.value == null ? unknown : metric.value"
    :unit="metric.value != null ? metric.suffix || undefined : undefined"
    :value-dir="metric.suffix ? 'ltr' : undefined"
  />
</template>
```

- [ ] **Step 4: The page**

In `apps/web/app/pages/projects/dashboard.vue` keep the whole `<script setup>`, and add after `activeFilterCount`:

```ts
// Loading until hydrated keeps the first client render equal to SSR (the query may finish before hydration).
const loadingState = computed(() => !hydrated.value || (analytics.isLoading.value && !analytics.data.value))
const hasRows = computed(() => !loadingState.value && !analytics.error.value && rows.value.length > 0)
```

Replace the `<template>` with:

```vue
<template>
  <SharedDashboardPage :title="t('projects.dashboard.title')" data-testid="project-dashboard-page">
    <template #filters>
      <div class="w-full min-w-0">
        <FilterBar class="w-full" :title="t('filterCard.title')" :active-count="activeFilterCount" :disabled="!hydrated" @clear="clearFilters">
          <template #search>
            <UInput v-model="search" :disabled="!hydrated" :placeholder="t('projects.reports.search')" :aria-label="t('projects.reports.search')" icon="i-lucide-search" class="min-w-52 flex-1" />
          </template>
          <template #default>
            <SharedFilterChoice
              data-testid="project-dashboard-status-filter"
              :label="t('projects.filters.statusLabel')"
              :items="statusOptions"
              :model-value="filters.status"
              :disabled="!hydrated"
              @update:model-value="onStatusChange"
            />
          </template>
          <template #active>
            <div v-if="filtered" class="flex flex-wrap items-center gap-2">
              <SharedFilterChip v-if="filters.q.trim()" :label="t('projects.filters.searchValue', { value: filters.q })" @remove="clearSearch" />
              <SharedFilterChip v-if="filters.status !== 'all'" :label="statusLabel" @remove="onStatusChange('all')" />
            </div>
          </template>
        </FilterBar>
      </div>
    </template>

    <template v-if="hasRows" #metrics>
      <ProjectDashboardMetrics :rows="rows" />
    </template>

    <SharedLoadingSkeleton v-if="loadingState" variant="cards" :count="4" class="@min-[768px]:col-span-2" />
    <SharedErrorState
      v-else-if="analytics.error.value"
      class="@min-[768px]:col-span-2"
      data-testid="project-dashboard-analytics-error"
      :error="analytics.error.value"
      :title="t('projects.dashboard.analyticsError')"
      @retry="analytics.refetch()"
    />
    <div v-else-if="rows.length === 0" class="@min-[768px]:col-span-2" data-testid="project-dashboard-empty">
      <SharedEmptyState
        :title="t(filtered ? 'projects.filteredEmpty' : 'projects.dashboard.empty')"
        :description="t(filtered ? 'projects.filteredEmptyHint' : 'projects.emptyHint')"
      >
        <template v-if="filtered" #action>
          <UButton color="neutral" variant="outline" :disabled="!hydrated" :label="t('projects.filters.clear')" @click="clearFilters" />
        </template>
      </SharedEmptyState>
    </div>
    <template v-else>
      <ProjectDashboardCharts :rows="rows" />
      <ProjectDashboardRecentProjects class="@min-[768px]:col-span-2" :rows="recentRows" />
    </template>
  </SharedDashboardPage>
</template>
```

`SharedErrorState`'s retry button reads `app.retry` («إعادة المحاولة» in Arabic, as the e2e name it); the old `projects.dashboard.retryAnalytics` key stays in the locale files unused.

- [ ] **Step 5: Policy, lint, tests**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim-p5-dashboard
python3 -B tools/ui_policy.py --refresh-story-context
python3 -B tools/ui_policy.py && python3 -B tools/arch_policy.py && node tools/ui_catalog.mjs
npm -w apps/web run lint
npm test 2>&1 | tail -4
```

Expected: exit 0. `node tools/ui_catalog.mjs` regenerates the catalog because `DashboardChartPanel`'s props changed; commit the result. The `DashboardChartPanel` story still renders: every arg it passes (`testId`, `title`, `description`, `chart`, `hasData`, `emptyText`, `accessibleLabel`, `variant`, `height`, `loading`) is still a prop.

- [ ] **Step 6: Run the pilot spec and the affected specs**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim-p5-dashboard/apps/web
bash /Users/tariq/code/nasq/.worktrees/tasmim/.superpowers/tasmim-shared/p5-e2e.sh 07 \
  e2e/pilot-dashboard.spec.ts e2e/project-dashboard.spec.ts e2e/project-clarity.spec.ts e2e/project-popups.spec.ts e2e/navigation-gate.spec.ts
```

Expected: `NEW failures` empty and every pilot test passed. `project-dashboard.spec.ts` is skipped on this stack (it needs the isolated chart fixture on 3985): note "skipped" in the report; it is covered by the pilot spec's testids, and the orchestrator runs it on the 3985 fixture at CP5 if that fixture is available.

- [ ] **Step 7: Storybook check and commit**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim-p5-dashboard/apps/web
npm run build-storybook >/dev/null
WEBVUE_REQUIRE_STORYBOOK=1 npx playwright test e2e/storybook-smoke.spec.ts e2e/storybook-visual.spec.ts -g 'project-dashboardchartpanel|shared-chartpanel|shared-dashboardpage' --reporter=line | tail -4
git status --short e2e/storybook-visual.spec.ts-snapshots; echo "clean=$?"
cd .. && cd .. && git add apps/web docs/design-system
git commit -m "refactor(web): move the project dashboard onto DashboardPage

The dashboard is a DashboardPage: filters in its filters slot, the
metric tiles in its metrics row, six ChartPanels in its grid (the
progress and finance charts span both columns) and the recent
projects card. Loading, failure and empty use the shared states
with their old test ids; the scoped container-query CSS is gone.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

Expected: smoke and visual tests of those families pass with no snapshot diff (`git status` prints nothing).

---

## Wave 3 — checkpoint

### Task 8: Checkpoint CP5 — cleanup, full gates, e2e diff, pilot shots

The checkpoint is decisive: the owner confirms or adjusts the direction before Plan 6 rolls the templates out. This task has three parts: a small cleanup and guard commit, the full gates and failing-title diff, and the screenshot set.

**Files:**
- Modify: `tools/ui_policy.py` (`STYLE_OWNERS`: drop the two entries whose scoped style is gone)
- Create: `apps/web/app/pages/__tests__/pilotTemplates.test.ts`
- Modify: `DESIGN.md` (one sentence in «القوالب والحالات»)
- Modify: `docs/design-system/components.md` (the rows for the pilot components)
- Regenerate (only if the Storybook gate shows an approved diff): `apps/web/e2e/storybook-visual.spec.ts-snapshots/*`
- Create (not committed): `.superpowers/tasmim-shared/cp5/*.png`, `.superpowers/tasmim-shared/cp5/CP5-NOTE.md`, `.superpowers/tasmim-shared/e2e-cp5-failures.txt`

**Interfaces:**
- Consumes: everything merged from waves 1 and 2; `p5-e2e.sh`'s normalizer logic; `POST /api/auth/login` and `PATCH /api/v1/me/appearance` (see `.superpowers/tasmim-shared/cp3/CP3-NOTE.md`: the user's server-side appearance wins over the cookie).
- Produces: the pilot guard test, and the CP5 evidence folder.

- [ ] **Step 1: The pilot guard test (failing first is not possible: it passes on the merged tip)**

Create `apps/web/app/pages/__tests__/pilotTemplates.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// The pilot pages stay on their templates. This is a source guard, not a behaviour test: the behaviour
// is pinned by e2e/pilot-*.spec.ts.
const app = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(app, path), 'utf8')

describe('the pilot pages stay on their templates', () => {
  it.each([
    ['pages/projects/index.vue', ['<SharedListPage', 'create-test-id="project-new"']],
    ['pages/tasks.vue', ['<SharedListPage', ':views="views"']],
    ['pages/projects/[id]/tasks.vue', ['<SharedListPage', 'hide-header', 'create-test-id="project-header-create"']],
    ['pages/projects/[id]/index.vue', ['<SharedRecordPage', 'hide-header', '<SharedPropertiesPanel']],
    ['pages/projects/dashboard.vue', ['<SharedDashboardPage', '#filters']],
  ])('%s uses its template', (file, needles) => {
    const source = read(file)
    for (const needle of needles) expect(source, needle).toContain(needle)
    expect(source, 'no hand-made page header').not.toContain('<SharedPageHeader')
  })

  it.each(['components/project/ProjectTable.vue', 'components/task/TaskTable.vue'])('%s renders through SharedDataTable', (file) => {
    const source = read(file)
    expect(source).toContain('<SharedDataTable')
    expect(source).not.toContain('<UTable')
    expect(source).toContain('#mobile-row')
  })

  it('the dashboard charts are chart panels, with no scoped style and no hand-made card', () => {
    expect(read('components/project/dashboard/DashboardChartPanel.vue')).toContain('<ChartPanel')
    const charts = read('components/project/dashboard/ProjectDashboardCharts.vue')
    expect(charts).toContain('<SharedChartPanel')
    expect(charts).not.toContain('<UCard')
    expect(charts).not.toContain('<style')
  })

  it('the project overview has no scoped style and no container hack', () => {
    const source = read('components/project/ProjectOverview.vue')
    expect(source).not.toContain('<style')
    expect(source).not.toContain('webvue-page-width')
  })
})
```

- [ ] **Step 2: Run it, then the cleanup**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim-p5-cp5/apps/web && npx vitest run app/pages/__tests__/pilotTemplates.test.ts
```

Expected: PASS on the merged tip. If a needle fails, the page lost its template: report which, do not edit the needle.

In `tools/ui_policy.py`, `STYLE_OWNERS`: delete `COMPONENTS + 'project/ProjectOverview.vue',` and `COMPONENTS + 'project/dashboard/ProjectDashboardCharts.vue',` (the set only shrinks). In `DESIGN.md` replace the sentence «انتقال الصفحات إلى القوالب يبدأ في الخطة 5 بالمشاريع، ثم في الخطة 6 لكل تطبيق.» with:

```
انتقلت إلى القوالب صفحات الخطة 5 التجريبية: المشاريع (`/projects`) وملخص المشروع (`/projects/[id]`) والمهام (`/tasks` وتبويب المهام) ولوحة المشاريع، ثم تنتقل بقية الصفحات في الخطة 6 لكل تطبيق. داخل إطار المشروع يملك الإطار العنوان الأول، فتستعمل القوالب `hideHeader` ولا ترسم عنوانًا ثانيًا.
```

In `docs/design-system/components.md`, in the row «قوائم المشاريع وملخصها» and the row «لوحة المشروع» change the last column to «يُبنى على `SharedListPage`/`SharedDataTable`/`SharedRecordPage` (الصفحات التجريبية)» and «يُبنى على `SharedDashboardPage`/`SharedChartPanel`» respectively (keep the file lists).

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim-p5-cp5
python3 -B tools/ui_policy.py && (cd tools && python3 -B -m unittest test_ui_policy -q) && npm -w apps/web run lint && npm test 2>&1 | tail -4
git add tools/ui_policy.py apps/web docs DESIGN.md
git commit -m "test(web): guard the pilot pages and retire two style owners

A source guard keeps the pilot pages on their templates; the two
scoped styles the pilot removed leave STYLE_OWNERS; DESIGN.md and
the component catalog say which pages moved.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 3: Storybook gates**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim-p5-cp5/apps/web
npm run build-storybook >/dev/null
WEBVUE_REQUIRE_STORYBOOK=1 npx playwright test e2e/storybook-visual.spec.ts e2e/storybook-density.spec.ts e2e/storybook-smoke.spec.ts e2e/storybook-shell.spec.ts e2e/storybook-templates.spec.ts e2e/storybook-display-templates.spec.ts --reporter=line 2>&1 | tail -15
git status --short e2e/storybook-visual.spec.ts-snapshots
```

Expected: everything passes with no skipped describe (the `shared-createpanel--form` smoke failure was fixed in Plan 4 Task 9). The snapshot directory is clean: waves 1 and 2 baselined only their own new stories (`shared-chartpanel--empty-with-text`, `shared-pageheader--hidden-title`). Any other diff is unexpected: investigate before `--update-snapshots`, and list any approved family in the CP5 note.

- [ ] **Step 4: Full gates**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim-p5-cp5
npm test 2>&1 | tail -5
npm -w apps/web run lint
python3 -B tools/ui_policy.py && (cd tools && python3 -B -m unittest test_ui_policy -q)
(cd tools && python3 -B -m unittest test_arch_policy test_new_app -q)
python3 -B tools/arch_policy.py --base main && python3 -B tools/git_policy.py --base main
node tools/ui_catalog.mjs --check
git status --short
```

Expected: all exit 0 and a clean tree. (`test_arch_policy` prints "wrote arch_baseline.json" as a side effect; the tree stays clean.)

- [ ] **Step 5: Mock e2e failing-title diff**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim-p5-cp5/apps/web
SCRATCH=$(mktemp -d)
SHARED=/Users/tariq/code/nasq/.worktrees/tasmim/.superpowers/tasmim-shared
PROJECTS_UI_PREVIEW=1 MODULE_UI_PREVIEW=1 MOCK_PORT=4708 node e2e/internal-ui-audit-mock.mjs > "$SCRATCH/mock.log" 2>&1 & MOCK_PID=$!
NUXT_ODOO_URL=http://127.0.0.1:4708 NUXT_ODOO_DB=webvue_ui_mock_only NUXT_PUBLIC_WS_URL=ws://127.0.0.1:4708/websocket npx nuxt dev --port 4308 > "$SCRATCH/nuxt.log" 2>&1 & NUXT_PID=$!
for i in $(seq 1 120); do curl -sf -o /dev/null http://localhost:4308/login && break; sleep 2; done
FORCE_COLOR=0 E2E_BASE_URL=http://localhost:4308 E2E_PROJECT_POPUPS=1 npx playwright test --reporter=line > "$SCRATCH/cp5-e2e.log" 2>&1 || true
awk '/^ +[0-9]+ failed$/{f=1;next} f && /^ +[0-9]+ (flaky|passed|skipped|interrupted|did not run)/{f=0} f' "$SCRATCH/cp5-e2e.log" > "$SHARED/e2e-cp5-failures.txt"
normalize() { python3 -c '
import re, sys
for line in sys.stdin:
    s = re.sub(r"\x1b\[[0-9;]*m", "", line).strip()
    s = re.sub(r"^\[[^\]]*\] › ", "", s)
    s = re.sub(r"^(\S+\.spec\.ts):\d+:\d+ ", r"\1 ", s)
    s = re.sub(r"[─\s]+$", "", s)
    if s:
        print(s[:90])
' | sort -u; }
normalize < "$SHARED/e2e-cp3-failures.txt" > "$SCRATCH/cp3.norm"
normalize < "$SHARED/e2e-cp5-failures.txt" > "$SCRATCH/cp5.norm"
echo "NEW failures:"; comm -13 "$SCRATCH/cp3.norm" "$SCRATCH/cp5.norm"
echo "FIXED since CP3:"; comm -23 "$SCRATCH/cp3.norm" "$SCRATCH/cp5.norm"
echo "Raw counts:"; wc -l < "$SHARED/e2e-cp3-failures.txt"; wc -l < "$SHARED/e2e-cp5-failures.txt"
echo "Per-spec counts (< cp3, > cp5):"
diff <(cut -d' ' -f1 "$SCRATCH/cp3.norm" | sort | uniq -c) <(cut -d' ' -f1 "$SCRATCH/cp5.norm" | sort | uniq -c) || true
grep -E "^ +[0-9]+ (passed|failed|flaky)" "$SCRATCH/cp5-e2e.log"
```

Run Steps 5 and 6 in one shell session (`SCRATCH`, `SHARED` and the process ids are shell variables) and keep the mock stack running for Step 6.

Expected: `NEW failures:` is empty. The normalizer removes line numbers and reporter truncation (titles are cut at 90 characters, so parameterized families that share a prefix collapse), so also compare the raw and per-spec counts. Classify every NEW title:

- **Intended.** A test whose title is unchanged but whose assertion this plan changed on purpose: `shortcuts-tasmim "/ focuses the list search…"` (T4/T5) and `taskBackTargets` (unit, not e2e). Each must pass.
- **Regression.** Fix it in the code, not in the spec.

For a load-sensitive title (Plan 2 and CP3: `project-clarity`), re-run that spec alone; it counts as a flake only if it then passes. Record each classification in the CP5 note.

- [ ] **Step 6: The CP5 image set**

With the mock stack still running, write `$SCRATCH/cp5-shots.cjs`:

```js
const { createRequire } = require('node:module')
const { chromium } = createRequire('/Users/tariq/code/nasq/.worktrees/tasmim-p5-cp5/apps/web/package.json')('@playwright/test')
const out = process.argv[2]
const base = 'http://localhost:4308'
const PAGES = [
  ['projects-cards', '/projects'], ['projects-table', '/projects?view=table'],
  ['tasks-table', '/tasks'], ['tasks-board', '/tasks?view=board'],
  ['project-tasks', '/projects/1/tasks'], ['project-overview', '/projects/1'],
  ['dashboard', '/projects/dashboard'],
]
const SIZES = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } }
;(async () => {
  const browser = await chromium.launch()
  for (const locale of ['ar', 'en']) for (const mode of ['light', 'dark']) for (const [size, viewport] of Object.entries(SIZES)) {
    const context = await browser.newContext({ viewport, locale: 'ar-SA', reducedMotion: 'reduce' })
    const page = await context.newPage()
    if (!(await page.request.post(`${base}/api/auth/login`, { data: { login: 'admin', password: 'admin' } })).ok()) throw new Error('login failed')
    // The user's server-side appearance wins over the cookie, so set both (CP3 note).
    if (!(await page.request.patch(`${base}/api/v1/me/appearance`, { data: { mode, font_size: 'small' } })).ok()) throw new Error('appearance failed')
    await context.addCookies([{ name: 'webvue-appearance', value: encodeURIComponent(JSON.stringify({ mode, fontSize: 'small' })), url: base }])
    for (const [name, path] of PAGES) {
      await page.goto(`${base}${path}`)
      await page.waitForFunction(() => document.querySelector('#__nuxt')?.__vue_app__?.$nuxt?.isHydrating === false)
      if (locale === 'en' && !(await page.evaluate(() => document.documentElement.lang.startsWith('en')))) {
        await page.evaluate(async () => { await document.querySelector('#__nuxt').__vue_app__.$nuxt.$i18n.setLocale('en') })
        await page.locator('html[dir="ltr"]').waitFor()
      }
      await page.waitForLoadState('networkidle')
      await page.evaluate(() => document.fonts.ready)
      await page.screenshot({ path: `${out}/${name}-${locale}-${mode}-${size}.png`, fullPage: true })
    }
    await context.close()
  }
  await browser.close()
})()
```

```bash
mkdir -p /Users/tariq/code/nasq/.worktrees/tasmim/.superpowers/tasmim-shared/cp5
node "$SCRATCH/cp5-shots.cjs" /Users/tariq/code/nasq/.worktrees/tasmim/.superpowers/tasmim-shared/cp5
ls /Users/tariq/code/nasq/.worktrees/tasmim/.superpowers/tasmim-shared/cp5 | wc -l
kill "$NUXT_PID" "$MOCK_PID"; while kill -0 "$NUXT_PID" 2>/dev/null || kill -0 "$MOCK_PID" 2>/dev/null; do sleep 1; done
lsof -ti tcp:4308 | xargs kill 2>/dev/null; true
```

Expected: 56 PNGs (7 pages × ar/en × light/dark × desktop/mobile). If the English locale did not apply on a page (the page is still RTL), re-run that page's shot; do not skip it. Open a few of them to confirm that the dark shots are dark and the mobile shots are 390 wide.

- [ ] **Step 7: Commit baselines (only if Step 3 re-baselined an approved family)**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim-p5-cp5
git status --short apps/web/e2e/storybook-visual.spec.ts-snapshots
# only if non-empty and listed in the CP5 note:
git add apps/web/e2e/storybook-visual.spec.ts-snapshots
git commit -m "test(web): re-baseline visual snapshots after the pilot

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 8: Present CP5 to the owner**

The orchestrator writes `.superpowers/tasmim-shared/cp5/CP5-NOTE.md` (gate results, the `NEW`/`FIXED` lists with classifications, per-spec count diff, the shot list) and sends the `cp5/` shots with it. The note asks the owner to confirm these decisions before Plan 6:

- (a) **The frame keeps the `<h1>`; templates inside it use `hideHeader`** (no new heading on the overview or the task tab).
- (b) **Cards are the default of `/projects`**; `?view=table` is the table; the switch also shows on phones.
- (c) **`C` creates the page's own record** on `/projects`, `/tasks` and the project tab; `J`/`K` work in table views only.
- (d) **The properties panel** holds start date, end date, tasks, milestones and followers; status and manager stay in the frame.
- (e) **Empty states with a hint and the create action stay in the page or table wrapper**, not in `DataTable` (it only takes a title). Plan 6 decides whether `DataTable` should take a description and an action slot.
- (f) **Dashboard loading, failure and empty use the shared states** with the old test ids.

Plan 6 does not start until the owner approves CP5.

---

## Spec coverage (phase 5)

| Spec | Task |
|---|---|
| §10 phase 5: `/projects` on `ListPage` + `DataTable` | 4 |
| §10 phase 5: `/projects/[id]` on `RecordPage` + `PropertiesPanel` | 6 |
| §6 list template, `?view=` kept (`?view=board`) | 4, 5 |
| §6 `DataTable` mobile rows replace the `md:hidden` lists | 4, 5 |
| §6 dashboard template and `ChartPanel` | 1, 2, 7 |
| §6 states (`PageState` facade, specific states where a page wants them) | 4, 5, 6, 7 |
| §5 `J`/`K`, `C` on the page's create button, `/` on the page search | 4, 5 (mock e2e) |
| §6 contracts: routes, headings, test ids, `useHydrated`, inline confirmation | Global Constraints; 2, 4–7 |
| Plan 4 roadmap: `ChartPanel` `emptyText` | 1 |
| Plan 4 roadmap: `DashboardPage` / `TimelineFrame` hide their header inside the project frame | 2 |
| Plan 4 review note: `RecordPage` blank-title fallback | 2 |
| Plan 4 deferred (d): `C` stops falling back to the module's pinned link on these pages | 4, 5 |
| §9 stories, visual baselines, axe | 1, 2, 8 |
| §10 CP5: shots ar/en × light/dark × desktop/390px, failing-title diff, owner decision | 8 |
| §11 DESIGN.md, `components.md`, catalog | 2, 4, 8 |

Not in this plan, on purpose: `MilestoneTable`, `FinanceEntryTable` and every other table (Plan 6); the schedule page on `TimelineFrame` (Plan 6; `hideHeader` is ready); a description and action slot on `DataTable`'s empty state (CP5 decision e); settings pages, the other project sections and the record pages of tasks (Plan 6).

## Roadmap — next

**Plan 6 — Rollout per application** (spec phase 6, shots per app). Parallel agents on `codex/web-tasmim-<app>` sub-branches, each in its own worktree, merged only into `codex/web-tasmim`. Order: PMO (the rest), HR, Meetings, Chat, Settings/Account, Subscription, Vendor. Each application:

- migrates its remaining tables onto `SharedDataTable` (`MilestoneTable`, `FinanceEntryTable`; `DirectoryTable`, `DepartmentTable`; `AuditTable`, `RoleTable`, `UserTable`);
- adopts `SharedListPage`/`SharedRecordPage`/`SharedDashboardPage`/`SharedTimelineFrame`/`SharedConversationLayout` on its pages, using `hideHeader` wherever a frame already owns the heading (the project sections);
- moves its standalone and print pages onto `SharedStandalonePage`;
- ends with its own shot set and e2e title diff.

**Plan 7 — Close-out and merge** (phase 7): remove leftover `webvue-*` classes and scoped styles (`RichText` and Gantt last), merge `main` into the branch, run the full gates and the `reviewer` pass, and merge `--no-ff` into `main` with the owner's authorization.

### Roadmap additions from this plan

- Plan 6 (DataTable): decide whether the empty state takes a description and an action slot, so `TaskTable`'s create action and `ProjectTable`'s hint can leave their wrappers (CP5 decision e).
- Plan 6 (project sections): `schedule.vue` moves onto `TimelineFrame` with `hideHeader`; its header-level create button keeps `project-header-create`.
- Plan 6 (cards): decide whether `ProjectCards` becomes a `DataTable` variant so cards get `J`/`K`.
- Plan 6 (not-found): the overview's not-found block keeps its text because e2e read it; `SharedNotFoundState` could take that text and a back button.
- Plan 7: `ProjectOverviewTasks` and the latest-update block could share a `RecordSection` surface class instead of repeating `rounded-lg bg-default p-4 ring ring-default`.
