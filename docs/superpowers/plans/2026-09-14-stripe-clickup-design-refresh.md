# Stripe/ClickUp Design Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `apps/web` to Stripe geometry (8px radius, 32px controls, hairline borders, dense tables) with ClickUp status pills, bind geometry to tokens so one edit changes the system, and make Storybook the mandatory component source for every agent.

**Architecture:** Phase 1 changes only the theme owners (`tokens.css`, `components.css`, `shell.css`, `app.config.ts`) plus policy docs, so 97 hardcoded `rounded-*` usages and all Nuxt UI controls follow automatically. Phase 2 rebuilds the six reused building blocks with their stories. Phase 3 re-lays the list template (`/projects`, `/tasks`) and the record template (`/projects/:id`, `/tasks/:id`) as two-column Stripe records.

**Tech Stack:** Nuxt 4, Nuxt UI 4 (Tailwind v4 `@theme`), Storybook 10 (`@storybook/vue3-vite`), vitest, Playwright, `tools/ui_policy.py`.

**Spec:** `docs/superpowers/specs/2026-09-14-stripe-clickup-design-refresh-design.md`

## Global Constraints

- Work in worktree `codex/design-refresh` from current `main`; `npm ci --ignore-scripts`; never touch :3000/:8069/`odoo19`.
- Arabic default, RTL-first; logical Tailwind props only (`ms-`, `me-`, `ps-`, `pe-`, `start-`, `end-`, `text-start`).
- All strings via `t()`; no new locale keys unless a task lists them.
- Nuxt UI is the only component library; no second theme file; theme owners are exactly `main.css`, `tokens.css`, `components.css`, `shell.css`, `brandTheme.ts`, `app.config.ts`.
- Status/priority colours are fixed semantic tokens, never derived from `--primary`. Text contrast ≥ 4.5:1 in light, cream, dark.
- Routes, query filters, permissions, draft protection, Escape/back rule unchanged.
- Every reused component keeps/gets a story in `apps/web/stories/**` and is listed in `STORYBOOK_COMPONENTS` (`tools/ui_policy.py`).
- Do not commit/merge/push unless the user authorizes it; the plan's "Commit" steps are local commits on the task branch only (user pre-authorized local commits on the worktree branch by "ابدأ لا تتوقف حتى تخلص كل شيء" — pushes still need explicit approval).
- Checks per phase: `python3 -B tools/ui_policy.py`, `npm test`, `npx -w apps/web vue-tsc --noEmit`, `npx -w apps/web vue-tsc --noEmit -p .storybook/tsconfig.json`, Storybook screenshots via Playwright.

---

## Phase 1 — Theme layer bound to tokens

### Task 1: Worktree and baseline screenshots

**Files:**
- Create: worktree `/Users/tariq/code/nasq/.claude/worktrees/design-refresh` (branch `codex/design-refresh`)
- Create: `/private/tmp/.../scratchpad/before/*.png`

- [ ] **Step 1: Create worktree from main**
```bash
cd /Users/tariq/code/nasq && git fetch origin && git worktree add .claude/worktrees/design-refresh -b codex/design-refresh main
cd .claude/worktrees/design-refresh && npm ci --ignore-scripts
```
- [ ] **Step 2: Start Storybook on a free port and capture the baseline**
```bash
cd apps/web && npx nuxt prepare && npx storybook dev -p 6016 --no-open   # background
node scripts/story-shots.mjs 6016 before   # script created in Task 2 step 0 (below)
```
Expected: PNGs for `foundations-shape--radius-and-elevation`, `nuxt-ui-actions--button-ranks`, `nuxt-ui-fields--text-inputs`, `nuxt-ui-surfaces--card`, `nuxt-ui-surfaces--table`, `shared-filterbar--filters-open`, `shared-pageheader--with-actions`, `task-taskcard--project-board`.

### Task 2: Geometry tokens (radius, hover surface, state/priority tokens)

**Files:**
- Modify: `apps/web/app/assets/css/tokens.css`
- Create: `apps/web/scripts/story-shots.mjs` (dev helper, gitignored via `apps/web/.gitignore`? No — keep it in repo, it is a review tool)
- Test: `apps/web/app/assets/__tests__/tokens.test.ts` (new)

**Interfaces:**
- Produces CSS custom properties: `--radius-sm/md/lg/xl/2xl` (4/6/8/10/12px), `--nasq-radius: 8px`, `--ui-radius: 6px` (single definition), `--nasq-surface-hover`, `--state-in-progress|changes-requested|approved|waiting|done|cancelled`, `--priority-urgent|high|normal|low`, each with `-soft` companion computed via `color-mix`.

- [ ] **Step 1: Write the failing test**
```ts
// apps/web/app/assets/__tests__/tokens.test.ts
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(import.meta.dirname, '../css/tokens.css'), 'utf8')

describe('geometry tokens', () => {
  it('overrides the Tailwind radius scale so rounded-* classes follow the system', () => {
    expect(css).toMatch(/@theme\s*\{[^}]*--radius-lg:\s*8px/s)
    expect(css).toMatch(/--radius-md:\s*6px/)
    expect(css).toMatch(/--radius-xl:\s*10px/)
    expect(css).toMatch(/--nasq-radius:\s*8px/)
  })
  it('defines --ui-radius exactly once', () => {
    expect(css.match(/--ui-radius:/g)?.length).toBe(1)
    expect(css).toMatch(/--ui-radius:\s*6px/)
  })
  it('exposes a hover surface and fixed state/priority tokens in all three modes', () => {
    for (const block of ['--nasq-surface-hover', '--state-in-progress', '--state-done', '--priority-urgent']) {
      expect(css.match(new RegExp(`${block}:`, 'g'))?.length).toBeGreaterThanOrEqual(3)
    }
    expect(css).not.toMatch(/--state-[a-z-]+:\s*var\(--primary/)
  })
})
```
- [ ] **Step 2: Run it** — `npx -w apps/web vitest run app/assets/__tests__/tokens.test.ts` → FAIL.
- [ ] **Step 3: Implement in `tokens.css`**
  - In the existing `@theme { … }` block add:
    ```css
    --radius-sm: 4px; --radius-md: 6px; --radius-lg: 8px; --radius-xl: 10px; --radius-2xl: 12px;
    ```
  - `:root`: `--nasq-radius: 8px;` `--ui-radius: 6px;` (delete the later `--ui-radius: .4rem;` line), add `--nasq-surface-hover: #f1f3f9;`
  - `:root` state/priority (light):
    ```css
    --state-in-progress: #1d4ed8; --state-changes-requested: #c2410c; --state-approved: #6d28d9;
    --state-waiting: #6b7280; --state-done: #15803d; --state-cancelled: #374151;
    --priority-urgent: #b91c1c; --priority-high: #c2410c; --priority-normal: #1d4ed8; --priority-low: #6b7280;
    ```
  - `:root.cream`: `--nasq-surface-hover: #f3eee4;` same state hexes (contrast checked on `#fffdf8`).
  - `.dark`: `--nasq-surface-hover: #202531;` and lighter state hexes:
    ```css
    --state-in-progress: #93c5fd; --state-changes-requested: #fdba74; --state-approved: #c4b5fd;
    --state-waiting: #9ca3af; --state-done: #86efac; --state-cancelled: #d1d5db;
    --priority-urgent: #fca5a5; --priority-high: #fdba74; --priority-normal: #93c5fd; --priority-low: #9ca3af;
    ```
  - Add to `@theme inline`: `--color-state-*` and `--color-priority-*` mirrors so `text-state-done` etc. work.
- [ ] **Step 4: Run test** → PASS. Run `npx -w apps/web vue-tsc --noEmit` (no change expected).
- [ ] **Step 5: Commit** — `git commit -m "feat(theme): bind radius scale, hover surface and fixed state tokens"`

### Task 3: Control density and surface recipes

**Files:**
- Modify: `apps/web/app/app.config.ts`
- Modify: `apps/web/app/assets/css/components.css`
- Modify: `apps/web/app/assets/css/shell.css:33,83` (page padding), `:3` (stack gap)
- Test: `apps/web/app/assets/__tests__/recipes.test.ts` (new)

**Interfaces:**
- Produces CSS classes: `.nasq-ui-status-pill` (+ `[data-tone]` / `--pill` custom property), `.nasq-ui-label`, `.nasq-ui-num`, `.nasq-ui-row-actions`, `.nasq-ui-table` (row hover), unchanged names `.nasq-ui-record-surface`, `.nasq-ui-icon-button`, `.nasq-ui-filter-row`, `.nasq-ui-segment`.

- [ ] **Step 1: Failing test**
```ts
// apps/web/app/assets/__tests__/recipes.test.ts
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
const css = readFileSync(resolve(import.meta.dirname, '../css/components.css'), 'utf8')
const shell = readFileSync(resolve(import.meta.dirname, '../css/shell.css'), 'utf8')
const config = readFileSync(resolve(import.meta.dirname, '../../app.config.ts'), 'utf8')

describe('Stripe density recipes', () => {
  it('controls are 32px and use the md radius', () => {
    expect(config).toMatch(/button:[\s\S]*base: 'min-h-8 rounded-md font-medium'/)
    expect(config).toMatch(/input: \{ slots: \{ base: 'nasq-ui-field min-h-8 rounded-md' \} \}/)
    expect(css).toMatch(/\.nasq-ui-icon-button \{[^}]*width: 2rem;[^}]*height: 2rem;/)
  })
  it('record surfaces are hairline, not shadowed; cards drop the 14px radius', () => {
    expect(css).toMatch(/\.nasq-ui-record-surface \{[^}]*border: 1px solid var\(--ui-border\)/)
    expect(css).not.toMatch(/\.nasq-ui-record-surface \{[^}]*box-shadow: var\(--elevation-1\)/)
    expect(config).toMatch(/card: \{ slots: \{ root: 'rounded-lg border border-default'/)
  })
  it('tables are 40px rows with hover and 12px muted heads', () => {
    expect(config).toMatch(/th: 'text-start text-xs font-medium text-muted px-3 py-2/)
    expect(config).toMatch(/td: 'text-start px-3 py-2 text-default/)
    expect(config).toMatch(/tr: 'hover:bg-\[var\(--nasq-surface-hover\)\]/)
  })
  it('ships the status pill, label, numeric and row-actions recipes', () => {
    for (const cls of ['.nasq-ui-status-pill', '.nasq-ui-label', '.nasq-ui-num', '.nasq-ui-row-actions']) expect(css).toContain(cls)
    expect(css).toMatch(/\.nasq-ui-status-pill \{[^}]*height: 22px/)
  })
  it('page padding is 20/24/40 and the stack gap is 1.25rem', () => {
    expect(shell).toMatch(/\.nasq-shell-main \{[^}]*padding: 20px 24px 40px/)
    expect(shell).toMatch(/\.nasq-page-stack \{[^}]*gap: 1\.25rem/)
  })
})
```
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**
  - `app.config.ts`: `button.slots.base = 'min-h-8 rounded-md font-medium'`; input/inputNumber/select/selectMenu base `'nasq-ui-field min-h-8 rounded-md'`; textarea `'nasq-ui-field rounded-md leading-relaxed'`; calendar cellTrigger `'rounded-md m-0'`; `card.slots.root = 'rounded-lg border border-default'`, header `'nasq-ui-card-header px-4 py-3'`, body `'p-4'`, footer `'px-4 py-3'`; table th/td/tr as in the test (`tr: 'hover:bg-[var(--nasq-surface-hover)] data-[selected=true]:nasq-ui-selected transition-colors'`); badge base `'font-medium rounded-md'`; modal `rounded-xl` stays.
  - `components.css`:
    ```css
    .nasq-ui-icon-button { width: 2rem; height: 2rem; min-width: 2rem; min-height: 2rem; padding: 0; flex-shrink: 0; justify-content: center; }
    .nasq-ui-record-surface { border: 1px solid var(--ui-border); border-radius: var(--radius-lg); background: var(--ui-bg); }
    .nasq-ui-filter-row { min-width: 0; border-block-start: 1px solid var(--ui-border); padding: 0.75rem 0 0.25rem; }
    .nasq-ui-card-header { background: var(--ui-bg-muted); border-block-end: 1px solid var(--ui-border); }
    .nasq-ui-table-head { background: var(--ui-bg-muted); }
    .nasq-ui-table-head th { border-block-end: 1px solid var(--ui-border); }
    .nasq-ui-label { font-size: var(--text-xs); font-weight: 500; color: var(--ui-text-muted); line-height: 1.4; }
    .nasq-ui-num { font-variant-numeric: tabular-nums; }
    .nasq-ui-row-actions { display: inline-flex; gap: 0.25rem; opacity: 0; transition: opacity 120ms ease; }
    tr:hover .nasq-ui-row-actions, tr:focus-within .nasq-ui-row-actions, .nasq-ui-row-actions:focus-within { opacity: 1; }
    @media (hover: none), (max-width: 767px) { .nasq-ui-row-actions { opacity: 1; } }
    .nasq-ui-status-pill { display: inline-flex; align-items: center; gap: 0.375rem; height: 22px; padding-inline: 0.5rem; border-radius: var(--radius-md); font-size: var(--text-xs); font-weight: 500; line-height: 1; white-space: nowrap; color: var(--pill, var(--ui-text-muted)); background: color-mix(in srgb, var(--pill, var(--ui-text-muted)) 12%, var(--card)); border: 1px solid color-mix(in srgb, var(--pill, var(--ui-text-muted)) 24%, var(--border)); }
    .nasq-ui-status-pill::before { content: ''; width: 6px; height: 6px; border-radius: 999px; background: currentColor; flex: none; }
    .nasq-ui-status-pill[data-tone='in_progress'] { --pill: var(--state-in-progress); }
    … one line per task state, project status (on_track→done, at_risk→changes-requested, off_track→cancelled? no: off_track→priority-urgent red, on_hold→waiting, done→done), priority (urgent/high/normal/low), deadline (overdue→priority-urgent, soon→changes-requested, neutral→waiting), access states reuse success/waiting/cancelled.
    .nasq-ui-metric-icon { … border-radius: var(--radius-md); }
    ```
    Replace `.nasq-ui-tab-strip .nasq-ui-tab` radius `0.5rem 0.5rem 0 0` with `var(--radius-md) var(--radius-md) 0 0`, `.nasq-ui-segment` radius `var(--radius-md)`, `.nasq-status-callout-danger` radius `var(--radius-lg)`. Keep `.nasq-elevation-*` helper classes (menus use them).
  - `shell.css`: `.nasq-page-stack { … gap: 1.25rem; }`, `.nasq-shell-main { … padding: 20px 24px 40px; }` (desktop rule at line 33; mobile rule unchanged), `.nasq-shell-main` drop `box-shadow: var(--content-shadow)` → `border-inline-start: 1px solid var(--border)`.
- [ ] **Step 4: Run** tests + `npm test` (fix any design test that asserted `p-[18px]`, `nasq-elevation-1` on cards, or `rounded-[14px]` — update expectations to the new classes in the same commit).
- [ ] **Step 5: Commit** — `feat(theme): 32px controls, hairline surfaces, dense tables, status pill recipe`

### Task 4: Badges use the pill recipe

**Files:**
- Modify: `apps/web/app/utils/statusTone.ts`, `apps/web/app/components/task/StateBadge.vue`, `apps/web/app/components/project/ProjectStatusBadge.vue`, `apps/web/app/components/task/DeadlineBadge.vue`, `apps/web/app/components/task/PrioritySelect.vue` (trigger shows pill), `apps/web/app/components/access/AccessStateBadge.vue`, `apps/web/app/components/hr/AccessBadge.vue`
- Modify stories: `stories/task/StateBadge.stories.ts`, `stories/project/ProjectStatusBadge.stories.ts`, `stories/task/DeadlineBadge.stories.ts`, `stories/access/AccessStateBadge.stories.ts`, `stories/hr/AccessBadge.stories.ts`
- Test: `apps/web/app/components/task/__tests__/statusPill.test.ts` (new)

**Interfaces:**
- Produces in `statusTone.ts`: `export type PillTone = TaskState | ProjectStatus | 'urgent' | 'high' | 'normal' | 'low' | 'overdue' | 'soon' | 'neutral' | 'granted' | 'disabled' | 'pending'` and `export const PRIORITY_TONE: Record<'0'|'1'|'2'|'3', PillTone> = { '0': 'low', '1': 'normal', '2': 'high', '3': 'urgent' }`. Consumers render `<span class="nasq-ui-status-pill" :data-tone="tone">label</span>`; keep every existing `data-testid`.

- [ ] **Step 1: Failing test** (mount `StateBadge` with `state: 'done'` via `@vue/test-utils` and existing i18n helper in `components/shared/__tests__/helpers`; assert `.nasq-ui-status-pill[data-tone="done"]` exists and text is `t('tasks.state.done')`; same for `ProjectStatusBadge` `at_risk` and `DeadlineBadge` with `daysRemaining: -3` → `data-tone="overdue"`).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** — each badge template becomes the span above; `DeadlineBadge` tone: closed/null → `neutral`, `<0` → `overdue`, `<=2` → `soon`, else `neutral`. `STATUS_COLOR` stays for callers not migrated (alerts, milestones).
- [ ] **Step 4: Run** the new test, `npm test`, `vue-tsc`. Update stories to show all tones in one grid (`render` loops over tones) in all three themes via the existing globals toolbar.
- [ ] **Step 5: Commit** — `feat(badges): ClickUp status pills with fixed semantic tones`

### Task 5: Policy docs and Storybook-as-source rule

**Files:**
- Modify: `DESIGN.md` (§ابدأ هنا table row, §1 tokens paragraph, §2 table + new row, §6 bullets), `CLAUDE.md` (Frontend and machine rules: add bullet), `AGENTS.md` (واجهة العميل section: add sentence), `.claude/agents/frontend-theme.md`, `docs/design-system/components.md` (line 7), `docs/design-system/nuxt-ui-reference.md` (Storybook section line 43)
- Modify: `tools/ui_policy.py` comment at line 68 ("dev-time viewer") → "mandatory component catalog".
- Modify stories: `stories/foundations/Shape.stories.ts` (`rounded-[14px]` → `rounded-lg`), `stories/nuxt-ui/Surfaces.stories.ts` description.

- [ ] **Step 1:** Write the exact text:
  - DESIGN.md table row: `| رؤية المكونات المتكررة والتوكنات حيّة | Storybook: \`npm -w apps/web run storybook\`. **فهرس المكونات الملزم لكل وكيل**: اللبنة تؤخذ من Storybook، والقرار الشكلي لهذا الملف. مكوّن بلا قصة ليس لبنة معتمدة |`
  - DESIGN.md §1 tokens paragraph: radius `8px` (controls `6px`), shadows only for floating layers (`--elevation-2..4`), page padding `20px 24px 40px`, hover surface `#f1f3f9`.
  - DESIGN.md §2 new row: `| الحالة والأولوية | \`--state-*\` / \`--priority-*\` ثابتة | شارة \`nasq-ui-status-pill\` بنقطة ولون خفيف؛ لا ترث لون المؤسسة |`
  - DESIGN.md §6 bullets: controls 32px, tables 40px rows + hover + row actions on hover/focus (always visible on touch), labels 12px 500, tabular numbers, cards hairline no shadow.
  - CLAUDE.md bullet under "Frontend and machine rules": `- Storybook (\`npm -w apps/web run storybook\`) is the mandatory component catalog: reuse the story component; a shared component ships with its story and is listed in \`STORYBOOK_COMPONENTS\` before a second page uses it.`
  - AGENTS.md sentence after DESIGN.md link: `مكوّنات الواجهة تؤخذ من Storybook (\`apps/web/stories/**\`)؛ لا لبنة بلا قصة.`
  - frontend-theme.md: `Take every building block from Storybook (\`apps/web/stories/**\`); a component without a story is not an approved building block.`
- [ ] **Step 2:** `python3 -B tools/ui_policy.py` → PASS.
- [ ] **Step 3: Commit** — `docs: Storybook is the mandatory component source; record Stripe geometry in DESIGN.md`

### Task 6: Phase 1 verification

- [ ] `npm test`, `npx -w apps/web vue-tsc --noEmit`, `npx -w apps/web vue-tsc --noEmit -p .storybook/tsconfig.json`, `python3 -B tools/ui_policy.py`.
- [ ] `node scripts/story-shots.mjs 6016 after` and view before/after for the 8 stories; fix any regression (overlays radius, calendar cells, segment).
- [ ] Commit fixes.

## Phase 2 — Shared building blocks

### Task 7: PageHeader (40px row)

**Files:** Modify `components/shared/PageHeader.vue`, `stories/shared/PageHeader.stories.ts`; test `components/shared/__tests__/headerBackRule.ssr.test.ts` must still pass.
- [ ] Failing test in `components/shared/__tests__/composition.test.ts`: PageHeader source contains `min-h-10` on `[data-slot="page-header"]`, `gap-2` in the actions slot, `text-xl font-semibold` heading, description `text-sm text-muted` without `leading-6`.
- [ ] Implement: header `class="flex min-h-10 flex-wrap items-center justify-between gap-3"`; back button becomes `size="sm" variant="ghost"` icon-only with visible label at ≥md; actions `gap-2`.
- [ ] Run tests; update story (`WithActions` shows 1 solid + 1 outline); commit `feat(shared): compact page header`.

### Task 8: FilterBar / FilterCard as a single toolbar

**Files:** Modify `components/shared/FilterCard.vue`, `components/shared/FilterBar.vue`, `components/shared/FilterChip.vue`, `components/shared/FilterField.vue`; stories `stories/shared/FilterBar.stories.ts`; tests `components/shared/__tests__/FilterCard.test.ts`.
- [ ] Failing test additions: filter trigger is a labelled outline button `label = t('filterCard.title')` with `UBadge` count inside (not a separate badge sibling); open row has class `nasq-ui-filter-row` and no `rounded`/`border` other than top border; active chips render inline in the first row (`data-slot="active-row"` inside the toolbar row).
- [ ] Implement: `FilterCard` first row: `[search 280px max] [filters ▾ (count)] [chips…] [clear] … ms-auto [#actions]`; chips `size="xs" color="neutral" variant="outline"`; search `UInput` given `class="w-full max-w-[280px]"` by the card (wrapper `data-slot="search"`).
- [ ] Run `FilterCard.test.ts`, `npm test`; update stories (`InPageToolbar`, `WithActiveFilters`, `FiltersOpen`); commit `feat(shared): Stripe toolbar filter bar`.

### Task 9: Table recipe with row actions and sticky number column

**Files:** Modify `app.config.ts` (`table.slots.th/td` add `first:sticky first:start-0 first:bg-inherit`), `components/project/ProjectTable.vue`, `components/task/TaskTable.vue`; story `stories/nuxt-ui/Surfaces.stories.ts` Table shows pills + `nasq-ui-row-actions`.
- [ ] Failing test in `components/task/__tests__/taskListDesign.test.ts`: TaskTable source contains `nasq-ui-row-actions` and `nasq-ui-num`; ProjectTable (new `components/project/__tests__/projectListDesign.test.ts`) contains `ProjectStatusBadge` and `nasq-ui-row-actions`.
- [ ] Implement: last column cell wraps open/menu buttons in `<div class="nasq-ui-row-actions">`; numeric/date cells add `nasq-ui-num`; status cells use the pill badges.
- [ ] Run; commit `feat(tables): dense rows, hover actions, tabular numbers`.

### Task 10: TaskCard (ClickUp)

**Files:** Modify `components/task/TaskCard.vue`, `stories/task/TaskCard.stories.ts`; test `components/task/__tests__/TaskCard.test.ts` (new, mount with fixture from `stories/fixtures/pmo` — allowed because tests may import stories fixtures? No: app tests must not import Storybook files per `ui_policy.py:227` — copy a minimal task literal into the test).
- [ ] Failing test: root has `data-priority` attribute equal to `task.priority`; menu button has class `nasq-ui-row-actions`; card root is a `div.nasq-ui-record-surface` (not `UCard`), no `nasq-elevation`.
- [ ] Implement: `<div class="nasq-ui-record-surface task-card" :data-priority="task.priority">`; `.task-card[data-priority='3']::before { inset-inline-start: 0; width: 3px; background: var(--priority-urgent) }` (`'2'` → high) in `components.css` under a `.nasq-ui-task-card` recipe (keep CSS in the theme owner, not scoped); title `text-sm font-medium line-clamp-2`; one meta row: `DeadlineBadge` pill + `StateBadge`? (no — board columns are stages; keep deadline + priority flag) + avatars `size-5`; menu `variant="ghost" size="xs"` inside `nasq-ui-row-actions`, visible on hover/focus-within and always on touch.
- [ ] Run; commit `feat(tasks): ClickUp-style task card`.

### Task 11: Phase 2 verification — same gates as Task 6 plus stories `PageHeader`, `FilterBar`, `Surfaces/Table`, `TaskCard` screenshots.

## Phase 3 — Page templates

### Task 12: List template — `/projects`

**Files:** Modify `pages/projects/index.vue`, `components/project/ProjectTable.vue`, `components/project/ProjectCards.vue`; test `components/project/__tests__/projectListDesign.test.ts`.
- [ ] Failing test: page order is `SharedPageHeader` → `FilterBar` → one `nasq-ui-record-surface` wrapper containing the table/cards and the pager (`data-testid="projects-pager"` inside the surface); result count moves into the toolbar end (`data-testid="projects-result-count"` inside `#view` slot).
- [ ] Implement per spec 3أ; pager becomes `flex items-center justify-between border-t border-default px-3 py-2 text-xs text-muted` inside the surface; no floating buttons.
- [ ] Run `npm test`, e2e smoke `cd apps/web && npx playwright test e2e/projects*.spec.ts` if present; commit `feat(projects): Stripe list template`.

### Task 13: List template — `/tasks`

**Files:** Modify `pages/tasks.vue`, `components/task/TaskToolbar.vue`, `components/task/TaskTable.vue`, `components/task/TaskBoard.vue`; test `components/task/__tests__/taskListDesign.test.ts`.
- [ ] Failing test updates: board column `w-70` with a pill heading (`nasq-ui-status-pill` in column header) and count; board wrapper `nasq-ui-record-surface p-3`; toolbar uses `FilterBar` inline row.
- [ ] Implement; keep `?view`/`?tab` handling untouched.
- [ ] Run; commit `feat(tasks): dense list and ClickUp board columns`.

### Task 14: Record template — `/tasks/:id` two columns

**Files:** Modify `components/task/TaskDetailPanel.vue`, `components/task/TaskDetails.vue` (properties list extracted to new `components/task/TaskProperties.vue`), `components/task/TaskDetailPage.vue`; add `stories/task/TaskProperties.stories.ts`; add `TaskProperties.vue` to `STORYBOOK_COMPONENTS`; test `components/task/__tests__/taskChromeDesign.test.ts`.
- [ ] Failing test: `TaskDetailPanel` contains `data-testid="task-detail-grid"` with class `nasq-record-grid`; `shell.css` defines `.nasq-record-grid { grid-template-columns: minmax(0,1fr) 300px }` at `min-width: 1024px` and `.nasq-record-aside` with `border-inline-start`.
- [ ] Implement: `TaskProperties.vue` renders a `<dl>` of `nasq-ui-label` / value pairs (state via `StateMenu`, deadline via `DateField`, priority via `PrioritySelect`, tags via `TagPicker`, assignees, project link); under 1024px it renders inside a `<details open>` above content. Move scoped `.task-context-row` rules into `shell.css` under `.nasq-record-*` names; delete the scoped block.
- [ ] Run `taskChromeDesign`, `taskDetailBack`, `npm test`; commit `feat(tasks): two-column record with properties aside`.

### Task 15: Record template — `/projects/:id` overview

**Files:** Modify `components/project/ProjectOverview.vue`, `pages/projects/[id]/index.vue`; test `components/project/__tests__/projectOverviewDesign.test.ts` (new).
- [ ] Failing test: overview uses `nasq-record-grid`; metric cards use `nasq-ui-record-surface p-4` with `nasq-ui-num` values; the milestones card is in `nasq-record-aside` together with a properties `<dl>` (status pill, manager, dates, record number, meetings link); no scoped `<style>` block remains (`expect(src).not.toContain('<style')`).
- [ ] Implement; container queries move to `shell.css` `.nasq-record-*`.
- [ ] Run; commit `feat(projects): two-column overview record`.

### Task 16: Final verification and report

- [ ] All gates: `python3 -B tools/ui_policy.py`, `npm test`, `npx -w apps/web vue-tsc --noEmit`, storybook tsconfig check, `npm -w apps/web run build-storybook` + `npx playwright test e2e/storybook-smoke.spec.ts`.
- [ ] Mock-stack visual pass (memory `isolated-ui-mock-stack`): `/projects`, `/tasks`, `/tasks/:id`, `/projects/:id` at 390/768/1440 in light/cream/dark, ar + en; save PNGs to scratchpad and review.
- [ ] Report changed files, command evidence, residual risk. Do not merge/push without authorization.
