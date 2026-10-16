# Tasmim Plan 4 — Page templates and states

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver phase 4 of the spec. Build the eight shared page templates and the five shared states in `apps/web/app/components/shared/`, merge the duplicated badges, filter card, invoice lines, route tabs and settings shell into shared components, and close the Plan 3 / CP2 carry-overs (`J`/`K` in `DataTable`, `C` on the page's own create button, a stronger dark-mode primary button, focus after a blocked palette navigation). Pages do not move onto the templates yet (Plans 5 and 6). The plan ends at owner checkpoint CP4.

**Architecture:** Every template and state is a small SFC under `components/shared/`, auto-imported as `Shared<Name>`, with a Storybook story (`a11y.test = 'error'`), desktop and mobile visual baselines and, where it holds logic, a Vitest test. Shared components never import an application folder (R3): application data reaches them as already-translated, already-formatted props (badge `tone`/`label`, invoice `cells`, tab `items`). The application tone and label maps stay in the application's own `composables/` or `utils/` files. `SharedPageState` keeps its exact props and `retry` event and becomes a facade over the new states, so its 138 call sites do not change. No Odoo, contract, API or route change.

**Tech Stack:** Nuxt 4.6, Nuxt UI 4.11.1 (`UTable`, `UBadge`, `UAlert`, `USkeleton`, `UButton`, `USlideover`, `UPagination`), Tailwind 4.3, Storybook 10.6 with `@storybook/addon-a11y`, Playwright 1.62 with `@axe-core/playwright`, Vitest 4 (no DOM: SSR string rendering through `@vue/compiler-sfc` + `@vue/server-renderer`, as the existing `components/shared/__tests__` do), Python policy checks in `tools/`.

**Spec:** `docs/superpowers/specs/2026-10-11-webvue-tasmim-design.md` (§6 page templates and states, §9 tooling, §10 phase 4 / CP4, §11 documentation, §12 verification, §13 risks)

## Owner rulings (2026-10-13, binding — override any task text below)

1. **Build, do not migrate.** Plan 4 builds the shared templates, states and merges, each with a story, unit tests where there is logic, axe at `error` on the new template stories, and desktop + mobile visual baselines for the templates. Moving pages onto the templates is Plan 5 (pilot `/projects` and `/projects/[id]`) and Plan 6 (rollout per application). The only migrations in this plan are the contained ones that are the point of a merge:
   - (a) `SharedPageState` becomes a thin facade over the new states. Props and emits are unchanged; its 112 files / 138 call sites are not touched.
   - (b) One `shared/StatusBadge.vue`. The application tone maps stay in their application files. The 8 badge components are replaced at their call sites and deleted; their stories become `StatusBadge` stories. The visual re-baselines this causes are listed in Task 2.
   - (c) `FilterCard` folds into `FilterBar`; one file remains.
   - (d) The two `InvoiceLines` become one `shared/InvoiceLines.vue` that covers both renderings, with money formatted by the caller. `shared/` imports no vendor or subscription util.
   - (e) `ProjectWorkspaceTabs` and `ProjectGovernanceTabs` render through one `shared/RouteTabs.vue`.
   - (f) `settings/SettingsLayout.vue` moves to `shared/SettingsPage.vue`. Its 19 call sites are renamed mechanically and its global `<style>` is kept.
2. The seven `*Table.vue` migrations onto `DataTable` are deferred to Plans 5 and 6.
3. The dark-mode primary button is made more prominent (CP2 owner amendment 4). The midnight `#13234a` stays the light-mode default primary, lime `#c8f031` stays an accent, and the tenant `primary_color` override keeps working (Task 13).
4. When the unsaved-draft guard blocks a navigation started from the palette, focus returns to the palette trigger instead of `<body>` (Plan 3 deferred item; Task 14).
5. The pre-existing `shared-createpanel--form` smoke failure is fixed with the Form template (Task 9). Cause, checked on 2026-10-13: the story renders, but `USlideover` teleports the dialog to `<body>`, so `#storybook-root` holds only `<!---->` and the smoke check `#storybook-root > *` finds no child. No console or page error is raised.

## Global Constraints

- Work only in `/Users/tariq/code/nasq/.worktrees/tasmim` on branch `codex/web-tasmim`. Never commit to or push `main`. Never push at all.
- Commit subjects: `type(web|tools): imperative subject`, ≤ 72 chars, with `type` ∈ `feat fix refactor perf test docs ci build chore`. One logical change per commit. End every message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `npm -w apps/web run lint` (from the worktree root; never `npx -w`) and `npm test` must be green at **every** commit.
- No changes under `odoo-addons/`, `packages/contracts/`, `packages/commercial-contracts/` or `apps/control-plane/`. No new API endpoint, request, route or visible heading.
- Existing `data-testid`s, `data-slot`s and `data-state`s are kept (for example `project-status`, `deadline-badge`, `hr-access-badge`, `settings-layout`, `project-tab-*`, `governance-tab-*`, `invoice-line`, `not-official`). Never rename an e2e test title: the failing-title diff keys on titles. Where a merge changes the DOM an e2e assertion reads, update the assertion in place and list it in the commit body.
- R3: nothing under `components/shared/`, `components/shell/` or `layouts/` imports or tags an application component folder (`project task meetings hr chat access vendor subscription settings`) or an application util (`utils/vendor*`, `utils/subscription*`, `composables/taskState`, `composables/projectStatus`). Application data reaches shared components as props. `python3 -B tools/arch_policy.py` must stay at exit 0, and `tools/arch_baseline.json` only shrinks, only through `--write-baseline`. `tools/arch_layers.json` is not touched.
- Logical properties only (`ms- me- ps- pe- start- end- text-start`, `inset-inline-*`). Direction icons flip with `rtl:-scale-x-100` (or the existing `ltr:rotate-180` for the back arrow).
- `useHydrated()`: every new interactive control (retry, clear, select, view switch, prev/today/next) stays disabled until hydrated.
- One keyboard layer: rows use the Plan 3 contract (`data-shortcut-row`, `useRowNavigation`), the list search `data-shortcut-search`, the page create `data-shortcut-create`. No `defineShortcuts`, no `event.key === '<letter>'` in new code.
- Overlays: no new `UModal`, `USlideover` or `UDrawer`. DESIGN.md's three exceptions (search, bell, unsaved draft) stay three; `SharedCreatePanel` stays the route-backed `/new` panel.
- i18n: every new string goes in `apps/web/i18n/locales/{ar,en}/common.json` under the new `states.*` namespace (or an existing `errors.*` / `app.*` key is reused), with ar/en parity. Application labels reuse the application's existing keys.
- **Stories.** Every new shared component ships `apps/web/stories/shared/<Name>.stories.ts` using `storyContext(...)` (`'unused'` while no page uses it), `parameters.a11y.test = 'error'`, an entry in `STORYBOOK_COMPONENTS` (`tools/ui_policy.py`), its story-id prefix in `VISUAL_STORIES` and `VISUAL_AXE_STORIES` (`apps/web/e2e/support/visualStories.ts`), and a row in `docs/design-system/components.md` (the policy requires the exact path of every new `components/**/*.vue`). Template stories whose layout changes on mobile also go in `VISUAL_MOBILE_STORIES`. Run `node tools/ui_catalog.mjs` in the same commit as any story or prop change. After editing a cited file, run `python3 -B tools/ui_policy.py --refresh-story-context`.
- **Tests without a DOM.** The web suite has no jsdom or `@vue/test-utils`. Component tests compile the SFC and render it to a string with `renderShared` (Task 1, `app/components/shared/__tests__/helpers/renderShared.ts`); composable tests use the fake-document pattern of `app/composables/__tests__/useEscapeBack.test.ts`. Prefer a pure function in `app/utils/` for logic and test it directly.
- **Visual baselines.** A diff in a family the task did not intend to change is a defect: investigate before `--update-snapshots`. Each task lists the families it re-baselines; `git status --short apps/web/e2e/storybook-visual.spec.ts-snapshots` must show only those.
- **Ports and processes.** Never use ports 3000/8069 or the `odoo19` database. The mock stack is Nuxt 4097 plus mock API 4498. Start background processes with `& PID=$!` and wait on that PID (`while kill -0 "$PID" 2>/dev/null; do sleep 1; done`). Never use `pgrep -f`. If `npx nuxt dev` leaves a child on 4097 after `kill`, stop it by port: `lsof -ti tcp:4097 | xargs kill`. The Storybook specs start their own server on a random port.
- Tasks run sequentially. A test the plan asks for is never weakened to pass. If a step's expected output differs, report it instead of editing the expectation. Anti-loop: the same check failing twice with the same cause stops the task and is reported.

## Review Focus

1. **An error that is not the expected shape.** A page gets `{ statusCode: 404 }` (Nuxt `createError`), a bare `Error('Failed to fetch')` with no status, a string, or a 409. Expected: 404 shows the not-found state with no retry, the network error and the string show the generic error with a working retry, 409 shows the conflict message with retry; nothing renders blank. Pinned in Task 1 (`PageState.test.ts` "maps every error shape to one state").
2. **A status the client does not know yet.** The server starts sending a new task state or subscription state before the web build knows it. Expected: a neutral badge whose label is the raw value, never a crash or an empty badge. Pinned in Task 2 (`statusBadges.test.ts` "an unknown value falls back to a neutral badge that shows the value").
3. **A filter panel opened, then left by keyboard.** A user opens the filter fields with the trigger and presses Esc inside a field. Expected: the panel closes and focus returns to the trigger; `/` still focuses the visible search because exactly one `data-shortcut-search` wrapper exists. Pinned in Task 3 (`FilterBar.test.ts` "keeps one search marker in both modes" and "Esc in the panel closes it and returns focus to the trigger").
4. **J / K on a phone.** On a 390px screen the desktop table rows are `display: none` and the mobile rows are visible (and the reverse at 1440px). Expected: `J` moves only between the rows the user can see, and skips `inert` rows. Pinned in Task 6 (writer B: `rows.test.ts` "navigableRows skips hidden and inert rows" and `storybook-templates.spec.ts` "J and K move only between visible DataTable rows on mobile").
5. **A tenant colour in dark mode.** A tenant picks a very dark primary (`#000000`, `#4c0519`) or a very light one (`#facc15`, `#ffffff`). Expected: the dark-mode solid primary button keeps text ≥ 4.5:1 and its surface ≥ 3:1 against the page, and the light-mode default stays `#13234a`. Pinned in Task 13 (writer D: `brandTheme.test.ts` "keeps the dark solid primary readable and visible for sampled tenant primaries").

---


## Orchestrator amendments (2026-10-13, binding — override task text below)

The plan was written by four writers in parallel from one interface contract. These amendments reconcile their notes.

1. **Execution model (owner directive).** Tasks run on parallel sub-branches `codex/web-tasmim-p4-<slug>`, each in its own worktree `.worktrees/tasmim-p4-<slug>` with its own `node_modules`, and each with its own mock ports (Nuxt `41x1`, mock `45x1`, assigned in the brief). The Global Constraints line "work only in `.worktrees/tasmim` on `codex/web-tasmim`" applies to the orchestrator's merges, not to task agents. The orchestrator verifies each branch, reviews it, and merges it with `--no-ff` into `codex/web-tasmim`. Shared append-only files (`STORYBOOK_COMPONENTS`, `visualStories.ts`, `common.json`, `components.md`, `catalog.json`) are reconciled at merge time. Waves:
   - Wave 1: T1, T13, T14.
   - Wave 2, after T1 is merged: T2–T6 and T8–T12.
   - Wave 3: T7 (needs T6), then T15 and T16.
2. **Badge policy (Task 15).** The rule rejects every `*Badge.vue` under `components/`, not only `*StatusBadge.vue` and `*StateBadge.vue`, except `shared/StatusBadge.vue`. With the narrower rule, `hr/AccessBadge`, `task/DeadlineBadge` and `vendor/LifecycleBadge` could come back unnoticed.
3. **Contract additions, accepted.**
   - `DataTable` gains `caption?: string`.
   - `RecordPage` gains `emits { retry: [] }`.
   - `RouteTabs` renders `data-testid = item.key`, so callers keep `project-tab-*` and `governance-tab-*`.
   - `ListPage`'s default slot receives `{ view }`.
   - Rows get `data-shortcut-row` in the DOM after render, because UTable has no row-attribute API.
   - The `CreatePanel` accessible-name fix is in scope (Task 9).
4. **`rowTo` link column.** The link goes on the first column. Plans 5–6 order columns with the record name first, or pass their own link cell.
5. **Owner decisions taken by the orchestrator (owner said «تصرف» for all checkpoints).**
   - `PageState` shows no retry for 403 and 404; retrying cannot help there.
   - The two `InvoiceLines` callers keep their own paid-quantity rule for now. Reconciling them with the control-plane unit (amount / quantity, matching the vendor reading) is logged for Plan 6 (Subscription).
6. **Behaviour specs.** Tasks 6–9 own `e2e/storybook-templates.spec.ts`. Tasks 10–12 own `e2e/storybook-display-templates.spec.ts`. If a wave-2 merge brings both, keep both files.

### Task 1: The five states, and `PageState` as their facade

**Files:**
- Create: `apps/web/app/utils/errorState.ts`, `apps/web/app/utils/__tests__/errorState.test.ts`
- Create: `apps/web/app/components/shared/LoadingSkeleton.vue`, `ErrorState.vue`, `ForbiddenState.vue`, `NotFoundState.vue`
- Create: `apps/web/app/components/shared/__tests__/helpers/renderShared.ts`, `apps/web/app/components/shared/__tests__/states.test.ts`, `apps/web/app/components/shared/__tests__/PageState.test.ts`
- Rewrite: `apps/web/app/components/shared/PageState.vue` (15 lines today)
- Modify: `apps/web/i18n/locales/ar/common.json`, `apps/web/i18n/locales/en/common.json` (new top-level `states`)
- Create: `apps/web/stories/shared/LoadingSkeleton.stories.ts`, `ErrorState.stories.ts`, `ForbiddenState.stories.ts`, `NotFoundState.stories.ts`
- Modify: `tools/ui_policy.py:37-56` (`STORYBOOK_COMPONENTS` gains the four states)
- Modify: `apps/web/e2e/support/visualStories.ts` (four prefixes; new `VISUAL_AXE_STORIES`), `apps/web/e2e/storybook-visual.spec.ts` (axe loop reads `VISUAL_AXE_STORIES`)
- Modify: `docs/design-system/components.md` (new section after `## الغلاف والتنقل`'s table, before `## المشاريع والمهام`, line 31)
- Regenerate: `docs/design-system/catalog.json`; new PNGs `shared-{loadingskeleton,errorstate,forbiddenstate,notfoundstate}--*`; intended re-baseline `shared-pagestate--*`

**Interfaces:**
- Produces in `app/utils/errorState.ts`:
  - `type ErrorStateKind = 'forbidden' | 'notFound' | 'conflict' | 'generic'`
  - `errorStateKind(error: unknown): ErrorStateKind` — reads `status`, then `statusCode`; 403/404/409, anything else `generic`.
- Produces (fixed by the contract):
  - `SharedLoadingSkeleton` `{ variant?: 'rows' | 'record' | 'cards' = 'rows'; count?: number = 3 }`, root `role="status"`, `aria-label=$t('app.loading')`, `data-slot="loading-skeleton"`, `data-variant`.
  - `SharedErrorState` `{ error?: unknown; title?: string }`, emits `retry`; title is `title` ?? `errors.conflict` for 409 ?? `errors.generic`; `role="alert"`, `data-slot="error-state"`; the retry button (`app.retry`) waits for hydration.
  - `SharedForbiddenState` `{ description?: string }`; title `errors.forbidden`; `data-slot="forbidden-state"`.
  - `SharedNotFoundState` `{ backTo?: RouteLocationRaw; backLabel?: string }`; title `errors.notFound`; a back link (`backLabel` ?? `app.back`) only with `backTo`; `data-slot="not-found-state"`.
  - `SharedEmptyState` unchanged.
  - `SharedPageState` unchanged API; loading → `LoadingSkeleton`, error 403 → `ForbiddenState`, 404 → `NotFoundState`, other errors → `ErrorState` (`@retry` re-emitted), empty → `EmptyState` (`title = emptyText ?? $t('app.noResults')`), else the default slot.
  - `renderShared(name: string, props?: Record<string, unknown>, slots?: Record<string, () => VNode | VNode[]>, options?: SharedRenderOptions): Promise<string>` and `loadShared(name, options)`, with `SharedRenderOptions = { hydrated?: boolean; messages?: Record<string, string>; globals?: Record<string, unknown>; modules?: Record<string, unknown>; stubs?: Record<string, Component> }`. Later tasks reuse it.
  - i18n keys: `states.forbiddenHint`, `states.notFoundHint` (the line under each title).
  - `VISUAL_AXE_STORIES: string[]` in `visualStories.ts` (story-id prefixes that get the page-level axe pass; later tasks append).

- [ ] **Step 1: The error classifier (failing test first)**

Create `apps/web/app/utils/__tests__/errorState.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { errorStateKind } from '../errorState'

describe('errorStateKind', () => {
  it.each([
    [{ status: 403 }, 'forbidden'],
    [{ statusCode: 403 }, 'forbidden'],
    [{ status: 404 }, 'notFound'],
    [{ statusCode: 404 }, 'notFound'],
    [{ status: 409 }, 'conflict'],
    [{ status: 500 }, 'generic'],
    [{ status: 422, code: 'invalid' }, 'generic'],
    [new Error('Failed to fetch'), 'generic'],
    ['boom', 'generic'],
    [{}, 'generic'],
  ] as const)('%o is %s', (error, kind) => {
    expect(errorStateKind(error)).toBe(kind)
  })

  it('prefers status over statusCode, as PageState always did', () => {
    expect(errorStateKind({ status: 409, statusCode: 404 })).toBe('conflict')
  })
})
```

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim/apps/web && npx vitest run app/utils/__tests__/errorState.test.ts
```

Expected: FAIL, `Failed to resolve import "../errorState"`.

Create `apps/web/app/utils/errorState.ts`:

```ts
/** Which shared state a failed load shows (Tasmim spec §6). `ApiError` carries `status`, Nuxt's `createError` `statusCode`. */
export type ErrorStateKind = 'forbidden' | 'notFound' | 'conflict' | 'generic'

export function errorStateKind(error: unknown): ErrorStateKind {
  const value = (typeof error === 'object' && error !== null ? error : {}) as { status?: unknown; statusCode?: unknown }
  const status = value.status ?? value.statusCode
  return status === 403 ? 'forbidden' : status === 404 ? 'notFound' : status === 409 ? 'conflict' : 'generic'
}
```

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim/apps/web && npx vitest run app/utils/__tests__/errorState.test.ts
```

Expected: PASS (12 tests).

- [ ] **Step 2: The shared render helper**

Create `apps/web/app/components/shared/__tests__/helpers/renderShared.ts`:

```ts
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileScript, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import ts from 'typescript'
import * as Vue from 'vue'

const sharedRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

export interface SharedRenderOptions {
  hydrated?: boolean
  /** Translations by key; a missing key renders as the key itself. `{name}` params are filled. */
  messages?: Record<string, string>
  /** Further Nuxt auto-imports the component calls (useRoute, useRouter, …). */
  globals?: Record<string, unknown>
  /** Modules the component imports, by specifier (for example '@/utils/errorState'). */
  modules?: Record<string, unknown>
  /** Component stubs by tag, over the defaults below. */
  stubs?: Record<string, Vue.Component>
}

export function fakeT(messages: Record<string, string> = {}) {
  return (key: string, params: Record<string, unknown> = {}) =>
    (messages[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`))
}

const passthrough = (tag: string) => Vue.defineComponent({
  inheritAttrs: false,
  setup(_, { attrs, slots }) { return () => Vue.h(tag, attrs, slots.default?.()) },
})

/** Default stand-ins for the Nuxt UI primitives the shared components render. */
export const DEFAULT_STUBS: Record<string, Vue.Component> = {
  UButton: Vue.defineComponent({
    inheritAttrs: false,
    setup(_, { attrs, slots }) {
      return () => attrs.to
        ? Vue.h('a', { ...attrs, href: typeof attrs.to === 'string' ? attrs.to : '#' }, slots.default?.())
        : Vue.h('button', attrs, slots.default?.())
    },
  }),
  UAlert: Vue.defineComponent({
    inheritAttrs: false,
    props: { title: String, description: String },
    setup(props, { attrs, slots }) {
      return () => Vue.h('div', attrs, [Vue.h('p', props.title), props.description ? Vue.h('p', props.description) : null, slots.actions?.()])
    },
  }),
  UBadge: passthrough('span'),
  UIcon: passthrough('span'),
  USkeleton: passthrough('div'),
  UCard: Vue.defineComponent({
    inheritAttrs: false,
    setup(_, { attrs, slots }) { return () => Vue.h('section', attrs, [slots.header?.(), slots.default?.(), slots.footer?.()]) },
  }),
  NuxtLink: passthrough('a'),
}

/** Compiles apps/web/app/components/shared/<name>.vue with Nuxt's auto-imports stubbed, as the sibling tests do. */
export function loadShared(name: string, options: SharedRenderOptions = {}): Vue.Component {
  const filename = resolve(sharedRoot, `${name}.vue`)
  const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor
  const compiled = compileScript(descriptor, { id: `shared-${name}`, inlineTemplate: true }).content
  const code = ts.transpileModule(compiled, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText
  const exports: { default?: Vue.Component } = {}
  const require = (specifier: string): unknown => {
    if (specifier === 'vue') return Vue
    if (options.modules && specifier in options.modules) return options.modules[specifier]
    const sibling = specifier.match(/^(?:\.\/|@\/components\/shared\/)([\w.]+)\.vue$/)
    if (sibling) return { __esModule: true, default: loadShared(sibling[1]!, options) }
    throw new Error(`${name}.vue imports ${specifier}; pass it in options.modules`)
  }
  const t = fakeT(options.messages)
  const autoImports: Record<string, unknown> = {
    ref: Vue.ref, computed: Vue.computed, watch: Vue.watch, shallowRef: Vue.shallowRef, nextTick: Vue.nextTick,
    toRef: Vue.toRef, useId: Vue.useId, useSlots: Vue.useSlots, onMounted: Vue.onMounted, onBeforeUnmount: Vue.onBeforeUnmount,
    useI18n: () => ({ t, locale: Vue.ref('ar'), localeProperties: Vue.ref({ dir: 'rtl' }) }),
    useHydrated: () => Vue.ref(options.hydrated ?? true),
    ...options.globals,
  }
  new Function('require', 'exports', ...Object.keys(autoImports), code)(require, exports, ...Object.values(autoImports))
  return exports.default!
}

export async function renderShared(
  name: string,
  props: Record<string, unknown> = {},
  slots: Record<string, () => Vue.VNode | Vue.VNode[]> = {},
  options: SharedRenderOptions = {},
): Promise<string> {
  const app = Vue.createSSRApp({ render: () => Vue.h(loadShared(name, options), props, slots) })
  app.config.globalProperties.$t = fakeT(options.messages)
  for (const [tag, component] of Object.entries({ ...DEFAULT_STUBS, ...options.stubs })) app.component(tag, component)
  return renderToString(app)
}
```

- [ ] **Step 3: The four states (failing tests first)**

Create `apps/web/app/components/shared/__tests__/states.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import * as errorState from '../../../utils/errorState'
import { renderShared } from './helpers/renderShared'

const modules = { '@/utils/errorState': errorState }

describe('LoadingSkeleton', () => {
  it('announces one loading status with three rows by default', async () => {
    const html = await renderShared('LoadingSkeleton')
    expect(html).toContain('role="status"')
    expect(html).toContain('aria-label="app.loading"')
    expect(html).toContain('data-slot="loading-skeleton"')
    expect(html).toContain('data-variant="rows"')
    expect(html.match(/<div class="h-12"/g)).toHaveLength(3)
  })

  it.each(['record', 'cards'] as const)('renders the %s variant', async variant => {
    const html = await renderShared('LoadingSkeleton', { variant, count: 4 })
    expect(html).toContain(`data-variant="${variant}"`)
    expect(html.match(/role="status"/g)).toHaveLength(1)
  })
})

describe('ErrorState', () => {
  it.each([
    [{ status: 500 }, 'errors.generic'],
    [{ status: 409 }, 'errors.conflict'],
    [undefined, 'errors.generic'],
  ])('titles %o as %s and offers a retry', async (error, title) => {
    const html = await renderShared('ErrorState', { error }, {}, { modules })
    expect(html).toContain('role="alert"')
    expect(html).toContain('data-slot="error-state"')
    expect(html).toContain(title)
    expect(html).toMatch(/<button[^>]*>app\.retry<\/button>/)
  })

  it('takes an explicit title over the mapped one', async () => {
    expect(await renderShared('ErrorState', { error: { status: 409 }, title: 'Custom' }, {}, { modules })).toContain('Custom')
  })

  it('keeps retry disabled until hydration', async () => {
    const html = await renderShared('ErrorState', {}, {}, { modules, hydrated: false })
    expect(html).toMatch(/<button[^>]*disabled[^>]*>app\.retry/)
  })
})

describe('ForbiddenState and NotFoundState', () => {
  it('names the missing permission, with an optional explanation', async () => {
    const html = await renderShared('ForbiddenState', { description: 'Ask an admin' })
    expect(html).toContain('data-slot="forbidden-state"')
    expect(html).toContain('errors.forbidden')
    expect(html).toContain('Ask an admin')
    expect(html).not.toContain('<button')
  })

  it('shows the not-found title and a back link only when there is a target', async () => {
    const bare = await renderShared('NotFoundState')
    expect(bare).toContain('data-slot="not-found-state"')
    expect(bare).toContain('errors.notFound')
    expect(bare).not.toContain('<a')
    const linked = await renderShared('NotFoundState', { backTo: '/projects', backLabel: 'Projects' })
    expect(linked).toMatch(/<a[^>]*href="\/projects"[^>]*>.*Projects/s)
  })
})
```

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim/apps/web && npx vitest run app/components/shared/__tests__/states.test.ts
```

Expected: FAIL, `ENOENT … LoadingSkeleton.vue`.

Create `apps/web/app/components/shared/LoadingSkeleton.vue`:

```vue
<script setup lang="ts">
// The one loading placeholder (Tasmim spec §6): rows for lists, a header with a
// properties column for records, a grid of tiles for dashboards. Announced once.
const props = withDefaults(defineProps<{ variant?: 'rows' | 'record' | 'cards'; count?: number }>(), { variant: 'rows', count: 3 })
const { t } = useI18n()
</script>

<template>
  <div role="status" :aria-label="t('app.loading')" data-slot="loading-skeleton" :data-variant="props.variant" class="py-8">
    <div v-if="props.variant === 'rows'" class="space-y-3">
      <USkeleton v-for="n in props.count" :key="n" class="h-12" />
    </div>
    <div v-else-if="props.variant === 'record'" class="grid gap-6 lg:grid-cols-3">
      <div class="space-y-3 lg:col-span-2">
        <USkeleton class="h-7 w-1/2" />
        <USkeleton class="h-4 w-3/4" />
        <USkeleton v-for="n in props.count" :key="n" class="h-24" />
      </div>
      <div class="space-y-3">
        <USkeleton v-for="n in 4" :key="n" class="h-6" />
      </div>
    </div>
    <div v-else class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <USkeleton v-for="n in props.count" :key="n" class="h-24" />
    </div>
  </div>
</template>
```

Create `apps/web/app/components/shared/ErrorState.vue`:

```vue
<script setup lang="ts">
import { errorStateKind } from '@/utils/errorState'

// A failed load (Tasmim spec §6): what went wrong and one way forward.
const props = defineProps<{ error?: unknown; title?: string }>()
defineEmits<{ retry: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const heading = computed(() => props.title ?? t(errorStateKind(props.error) === 'conflict' ? 'errors.conflict' : 'errors.generic'))
</script>

<template>
  <UAlert role="alert" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="heading" data-slot="error-state">
    <template #actions>
      <UButton color="neutral" variant="outline" :disabled="!hydrated" @click="$emit('retry')">{{ t('app.retry') }}</UButton>
    </template>
  </UAlert>
</template>
```

Create `apps/web/app/components/shared/ForbiddenState.vue`:

```vue
<script setup lang="ts">
// The caller lacks the capability (403). There is nothing to retry; the line under the title says what to do.
const props = defineProps<{ description?: string }>()
const { t } = useI18n()
</script>

<template>
  <div role="alert" data-slot="forbidden-state" class="flex flex-col items-center gap-3 rounded-lg border border-dashed border-default px-6 py-10 text-center">
    <UIcon name="i-lucide-lock" class="size-6 text-muted" aria-hidden="true" />
    <p class="font-medium text-highlighted">{{ t('errors.forbidden') }}</p>
    <p class="max-w-prose text-sm text-muted">{{ props.description ?? t('states.forbiddenHint') }}</p>
  </div>
</template>
```

Create `apps/web/app/components/shared/NotFoundState.vue`:

```vue
<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'

// The record is gone or hidden (404). The back link names where it leads, like SharedPageHeader's.
const props = defineProps<{ backTo?: RouteLocationRaw; backLabel?: string }>()
const { t } = useI18n()
</script>

<template>
  <div role="alert" data-slot="not-found-state" class="flex flex-col items-center gap-3 rounded-lg border border-dashed border-default px-6 py-10 text-center">
    <UIcon name="i-lucide-search-x" class="size-6 text-muted" aria-hidden="true" />
    <p class="font-medium text-highlighted">{{ t('errors.notFound') }}</p>
    <p class="max-w-prose text-sm text-muted">{{ t('states.notFoundHint') }}</p>
    <UButton v-if="props.backTo" :to="props.backTo" color="neutral" variant="outline">
      <UIcon name="i-lucide-arrow-right" aria-hidden="true" class="size-4.5 ltr:rotate-180" />{{ props.backLabel ?? t('app.back') }}
    </UButton>
  </div>
</template>
```

Add a top-level `states` object to `apps/web/i18n/locales/ar/common.json`:

```json
"states": {
  "forbiddenHint": "اطلب الصلاحية من مسؤول النظام إن كنت تحتاج هذه الصفحة.",
  "notFoundHint": "ربما حُذف السجل أو تغيّر رابطه."
}
```

and to `apps/web/i18n/locales/en/common.json`:

```json
"states": {
  "forbiddenHint": "Ask your system administrator for access if you need this page.",
  "notFoundHint": "The record may have been deleted, or its link changed."
}
```

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim/apps/web && npx vitest run app/components/shared/__tests__/states.test.ts
```

Expected: PASS (10 tests).

- [ ] **Step 4: `PageState` becomes the facade (failing test first)**

Create `apps/web/app/components/shared/__tests__/PageState.test.ts`:

```ts
import { h } from 'vue'
import { describe, expect, it } from 'vitest'
import * as errorState from '../../../utils/errorState'
import { renderShared } from './helpers/renderShared'

const render = (props: Record<string, unknown>) =>
  renderShared('PageState', props, { default: () => h('p', 'CONTENT') }, { modules: { '@/utils/errorState': errorState } })

describe('PageState facade', () => {
  it('shows the loading skeleton before anything else', async () => {
    const html = await render({ loading: true, error: { status: 500 }, empty: true })
    expect(html).toContain('data-slot="loading-skeleton"')
    expect(html).not.toContain('CONTENT')
  })

  it('maps every error shape to one state', async () => {
    const cases: [unknown, string, boolean][] = [
      [{ status: 403 }, 'forbidden-state', false],
      [{ statusCode: 404 }, 'not-found-state', false],
      [{ status: 409 }, 'error-state', true],
      [new Error('Failed to fetch'), 'error-state', true],
      ['boom', 'error-state', true],
    ]
    for (const [error, slot, retry] of cases) {
      const html = await render({ error })
      expect(html, String(slot)).toContain(`data-slot="${slot}"`)
      expect(html.includes('app.retry'), `${slot} retry`).toBe(retry)
      expect(html).not.toContain('CONTENT')
    }
    expect(await render({ error: { status: 409 } })).toContain('errors.conflict')
  })

  it('shows the empty state with the caller text or the default', async () => {
    expect(await render({ empty: true, emptyText: 'No projects' })).toContain('No projects')
    expect(await render({ empty: true })).toContain('app.noResults')
  })

  it('renders its content when nothing else applies', async () => {
    expect(await render({})).toContain('CONTENT')
  })
})
```

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim/apps/web && npx vitest run app/components/shared/__tests__/PageState.test.ts
```

Expected: FAIL in "maps every error shape" (no `data-slot="forbidden-state"`) and in the loading case (no `data-slot="loading-skeleton"`).

Replace `apps/web/app/components/shared/PageState.vue`:

```vue
<script setup lang="ts">
import { errorStateKind } from '@/utils/errorState'
import EmptyState from './EmptyState.vue'
import ErrorState from './ErrorState.vue'
import ForbiddenState from './ForbiddenState.vue'
import LoadingSkeleton from './LoadingSkeleton.vue'
import NotFoundState from './NotFoundState.vue'

// A thin facade over the shared states (Tasmim spec §6). The props and the retry
// event its call sites use do not change; each branch is one shared state.
const props = defineProps<{ loading?: boolean; error?: unknown; empty?: boolean; emptyText?: string }>()
defineEmits<{ retry: [] }>()
const { t } = useI18n()
const kind = computed(() => errorStateKind(props.error))
</script>

<template>
  <LoadingSkeleton v-if="loading" />
  <ForbiddenState v-else-if="error && kind === 'forbidden'" />
  <NotFoundState v-else-if="error && kind === 'notFound'" />
  <ErrorState v-else-if="error" :error="error" @retry="$emit('retry')" />
  <EmptyState v-else-if="empty" :title="emptyText ?? t('app.noResults')" />
  <slot v-else />
</template>
```

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim/apps/web && npx vitest run app/components/shared
```

Expected: every shared test passes, including the existing `composition.test.ts` and `headerBackRule.ssr.test.ts`.

- [ ] **Step 5: Stories, policy list, visual and axe lists, catalog row**

Create `apps/web/stories/shared/LoadingSkeleton.stories.ts`:

```ts
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import LoadingSkeleton from '../../app/components/shared/LoadingSkeleton.vue'
import PageContainer from '../../app/components/shared/PageContainer.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/LoadingSkeleton',
  component: LoadingSkeleton,
  parameters: { layout: 'fullscreen', a11y: { test: 'error' }, ...storyContext('apps/web/app/components/shared/PageState.vue:18', 'حالة التحميل الوحيدة: صفوف للقوائم، وسجل بعمود خصائص، وبطاقات للوحات.') },
  args: { variant: 'rows', count: 3 },
  render: args => ({
    components: { LoadingSkeleton, PageContainer },
    setup: () => ({ args }),
    template: '<main class="webvue-shell-main"><PageContainer width="list"><LoadingSkeleton v-bind="args" /></PageContainer></main>',
  }),
} satisfies Meta<typeof LoadingSkeleton>
export default meta
type Story = StoryObj<typeof meta>

export const Rows: Story = { name: 'صفوف قائمة' }
export const Record: Story = { name: 'سجل', args: { variant: 'record' } }
export const Cards: Story = { name: 'بطاقات لوحة', args: { variant: 'cards', count: 4 } }
```

Create `apps/web/stories/shared/ErrorState.stories.ts`:

```ts
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { fn } from 'storybook/test'
import ErrorState from '../../app/components/shared/ErrorState.vue'
import PageContainer from '../../app/components/shared/PageContainer.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/ErrorState',
  component: ErrorState,
  parameters: { layout: 'fullscreen', a11y: { test: 'error' }, ...storyContext('apps/web/app/components/shared/PageState.vue:21') },
  args: { error: { status: 500 }, onRetry: fn() },
  render: args => ({
    components: { ErrorState, PageContainer },
    setup: () => ({ args }),
    template: '<main class="webvue-shell-main"><PageContainer width="list"><ErrorState v-bind="args" /></PageContainer></main>',
  }),
} satisfies Meta<typeof ErrorState>
export default meta
type Story = StoryObj<typeof meta>

export const Generic: Story = { name: 'خطأ عام' }
export const Conflict: Story = { name: 'تعارض 409', args: { error: { status: 409 } } }
```

Create `apps/web/stories/shared/ForbiddenState.stories.ts`:

```ts
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import ForbiddenState from '../../app/components/shared/ForbiddenState.vue'
import PageContainer from '../../app/components/shared/PageContainer.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/ForbiddenState',
  component: ForbiddenState,
  parameters: { layout: 'fullscreen', a11y: { test: 'error' }, ...storyContext('apps/web/app/components/shared/PageState.vue:19') },
  render: args => ({
    components: { ForbiddenState, PageContainer },
    setup: () => ({ args }),
    template: '<main class="webvue-shell-main"><PageContainer width="detail"><ForbiddenState v-bind="args" /></PageContainer></main>',
  }),
} satisfies Meta<typeof ForbiddenState>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { name: 'بلا صلاحية' }
```

Create `apps/web/stories/shared/NotFoundState.stories.ts`:

```ts
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { useI18n } from 'vue-i18n'
import NotFoundState from '../../app/components/shared/NotFoundState.vue'
import PageContainer from '../../app/components/shared/PageContainer.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/NotFoundState',
  component: NotFoundState,
  parameters: { layout: 'fullscreen', a11y: { test: 'error' }, ...storyContext('apps/web/app/components/shared/PageState.vue:20') },
} satisfies Meta<typeof NotFoundState>
export default meta
type Story = StoryObj<typeof meta>

export const WithBack: Story = {
  name: 'مع رابط الرجوع',
  render: () => ({
    components: { NotFoundState, PageContainer },
    setup: () => ({ t: useI18n().t }),
    template: '<main class="webvue-shell-main"><PageContainer width="detail"><NotFoundState back-to="/projects" :back-label="t(\'nav.projects\')" /></PageContainer></main>',
  }),
}
export const Bare: Story = {
  name: 'بلا رابط',
  render: () => ({
    components: { NotFoundState, PageContainer },
    template: '<main class="webvue-shell-main"><PageContainer width="detail"><NotFoundState /></PageContainer></main>',
  }),
}
```

In `tools/ui_policy.py`, inside `STORYBOOK_COMPONENTS`, add after `'shared/PageHeader.vue', 'shared/PageState.vue', 'shared/PageContainer.vue', 'shared/UnsavedChanges.vue',` the line:

```python
    'shared/LoadingSkeleton.vue', 'shared/ErrorState.vue', 'shared/ForbiddenState.vue', 'shared/NotFoundState.vue',
```

In `apps/web/e2e/support/visualStories.ts`, add after `'shared-emptystate--',`:

```ts
  'shared-loadingskeleton--',
  'shared-errorstate--',
  'shared-forbiddenstate--',
  'shared-notfoundstate--',
```

and after the `VISUAL_DIALOG_STORIES` line:

```ts
// Story-id prefixes that get the page-level axe pass at serious/critical (spec §9: templates at `error`). Plans append.
export const VISUAL_AXE_STORIES: string[] = [
  'foundations-',
  'shell-',
  'shared-loadingskeleton--',
  'shared-errorstate--',
  'shared-forbiddenstate--',
  'shared-notfoundstate--',
  'shared-emptystate--',
  'shared-pagestate--',
]
```

In `apps/web/e2e/storybook-visual.spec.ts`, import `VISUAL_AXE_STORIES` with the others and replace the last loop's filter

```ts
  for (const story of stories.filter(entry => entry.id.startsWith('foundations-') || entry.id.startsWith('shell-'))) {
```

with

```ts
  for (const story of stories.filter(entry => VISUAL_AXE_STORIES.some(prefix => entry.id.startsWith(prefix)))) {
```

(`stories` already holds only `VISUAL_STORIES` entries, so every axe prefix must also be a visual prefix; `shared-emptystate--` and `shared-pagestate--` already are.)

In `docs/design-system/components.md`, insert before `## المشاريع والمهام`:

```markdown
## القوالب والحالات — Tasmim الخطة 4

قوالب الصفحات والحالات المشتركة (المواصفة §6). كلها تحت `apps/web/app/components/shared/` ولكل منها قصة بفحص إمكانية الوصول عند `error`.

| المكوّن | القصة | مكونات الأساس المستخدمة فعليًا |
| --- | --- | --- |
| `apps/web/app/components/shared/LoadingSkeleton.vue` | `apps/web/stories/shared/LoadingSkeleton.stories.ts` | `USkeleton`؛ صفوف، سجل، بطاقات |
| `apps/web/app/components/shared/ErrorState.vue` | `apps/web/stories/shared/ErrorState.stories.ts` | `UAlert`، `UButton` (إعادة المحاولة بعد الترطيب) |
| `apps/web/app/components/shared/ForbiddenState.vue` | `apps/web/stories/shared/ForbiddenState.stories.ts` | `UIcon`؛ 403 بلا إعادة محاولة |
| `apps/web/app/components/shared/NotFoundState.vue` | `apps/web/stories/shared/NotFoundState.stories.ts` | `UIcon`، `UButton` رابط رجوع اختياري؛ 404 |
```

Also, in the «البحث والفلاتر والحالة» row (line 14), append to the PageState entry text `(واجهة رقيقة فوق LoadingSkeleton وErrorState وForbiddenState وNotFoundState وEmptyState)` after `(قصة: \`apps/web/stories/shared/PageState.stories.ts\`)`.

- [ ] **Step 6: Run everything and baseline**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim
python3 -B tools/ui_policy.py --refresh-story-context && node tools/ui_catalog.mjs
npm -w apps/web run lint && npm test 2>&1 | tail -3 && python3 -B tools/ui_policy.py && python3 -B tools/arch_policy.py
cd apps/web && npm run build-storybook >/dev/null
npx playwright test e2e/storybook-visual.spec.ts -g 'shared-(loadingskeleton|errorstate|forbiddenstate|notfoundstate)' --update-snapshots=missing --reporter=line
WEBVUE_REQUIRE_STORYBOOK=1 npx playwright test e2e/storybook-visual.spec.ts -g 'shared-(loadingskeleton|errorstate|forbiddenstate|notfoundstate|pagestate|emptystate)' --reporter=line 2>&1 | tail -15
```

Expected: lint, tests and both policies pass. 28 new PNGs are written (7 stories × 4). The second run passes every new screenshot and every axe test, and fails only `shared-pagestate--` screenshots: the error, forbidden, not-found and empty stories change on purpose (alert → dedicated state; dashed paragraph → `EmptyState`). `shared-pagestate--loading-*` and `--content-*` must not change. If an axe test fails, fix the component, not the list. Re-baseline exactly that family:

```bash
WEBVUE_REQUIRE_STORYBOOK=1 npx playwright test e2e/storybook-visual.spec.ts -g 'shared-pagestate--' --update-snapshots --reporter=line | tail -3
git status --short e2e/storybook-visual.spec.ts-snapshots | grep -v -E 'shared-(pagestate|loadingskeleton|errorstate|forbiddenstate|notfoundstate)--' ; echo "unexpected=$?"
WEBVUE_REQUIRE_STORYBOOK=1 npx playwright test e2e/storybook-smoke.spec.ts -g 'shared-(pagestate|loadingskeleton|errorstate|forbiddenstate|notfoundstate)' --reporter=line | tail -3
```

Expected: the `grep -v` prints nothing (`unexpected=1`), and the smoke tests pass.

- [ ] **Step 7: Commit**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim
git add apps/web tools/ui_policy.py docs/design-system
git commit -m "feat(web): add the shared states and make PageState their facade

LoadingSkeleton, ErrorState, ForbiddenState and NotFoundState join
EmptyState. PageState keeps its props and retry event; 403 and 404 now
show their own state without a retry. Re-baselines shared-pagestate--*.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: One `StatusBadge` for the eight badge components

The eight badges are all `UBadge` with a colour from `STATUS_COLOR` and a translated label. They become one presentational `shared/StatusBadge.vue` that takes a `tone` and an already-translated `label`. Each application keeps its map in its own file and returns `{ tone, labelKey }`; the call site translates.

| Old component | Call sites (verified 2026-10-13) | Map / helper (stays in the app file) |
|---|---|---|
| `project/ProjectStatusBadge.vue` | `pages/projects/[id].vue:73`, `project/ProjectTable.vue:85`, `project/ProjectCards.vue:62`, `project/ProjectOverview.vue:82`, `project/ProjectUpdateList.vue:67`, `project/dashboard/ProjectDashboardRecentProjects.vue:62,77` | `composables/projectStatus.ts` `projectStatusBadge` |
| `task/StateBadge.vue` | `task/StateMenu.vue:34,38`, `task/SubtaskList.vue:46`, `task/DependencyPicker.vue:62` | `composables/taskState.ts` `taskStateBadge` |
| `task/DeadlineBadge.vue` | `task/TaskCard.vue:88`, `task/TaskTable.vue:215`, `task/TaskDetailPanel.vue:247` | `composables/taskState.ts` `deadlineTone` + existing `deadlineLabel` |
| `access/AccessStateBadge.vue` | `pages/settings/users/[userId]/index.vue:42`, `access/users/UserTable.vue:36,50`, `access/roles/RoleTable.vue:43,57` | new `utils/accessStateBadge.ts` `accessStateBadge` |
| `hr/AccessBadge.vue` | `hr/DirectoryTable.vue:226`, `hr/EmployeeCard.vue:51` | new `utils/hrAccessBadge.ts` `hrAccessBadge` |
| `subscription/StateBadge.vue` | `pages/subscription/status.vue:36`, `pages/subscription/index.vue:38` | `utils/subscription.ts` `subscriptionStateBadge` |
| `vendor/LifecycleBadge.vue` | `pages/vendor/bundles/index.vue:40`, `bundles/[id].vue:29,36`, `pages/vendor/plans/index.vue:34`, `plans/[id].vue:49` | `utils/vendorCommercial.ts` `lifecycleBadge` |
| `vendor/OrderStateBadge.vue` (two badges) | `vendor/SubscriptionSummary.vue:27` | `utils/vendorSubscriptions.ts` `orderPaymentBadge`, `orderFulfillmentBadge` |

Re-run `rg -n "<(ProjectStatusBadge|StateBadge|DeadlineBadge|AccessStateBadge|AccessBadge|SubscriptionStateBadge|VendorLifecycleBadge|VendorOrderStateBadge)\b" apps/web/app` before Step 4; the list must match the table (24 tags in 21 files).

**Files:**
- Create: `apps/web/app/components/shared/StatusBadge.vue`, `apps/web/app/utils/statusBadge.ts`, `apps/web/app/utils/accessStateBadge.ts`, `apps/web/app/utils/hrAccessBadge.ts`
- Create: `apps/web/app/utils/__tests__/statusBadges.test.ts`, `apps/web/app/components/shared/__tests__/StatusBadge.test.ts`
- Modify: `apps/web/app/utils/statusTone.ts` (owns `StatusTone`), `apps/web/app/composables/taskState.ts:16` (`StateTone` aliases it), `apps/web/app/composables/projectStatus.ts`, `apps/web/app/utils/subscription.ts`, `apps/web/app/utils/vendorCommercial.ts`, `apps/web/app/utils/vendorSubscriptions.ts`
- Modify: the 21 call-site files in the table above
- Delete: the 8 components and their stories `apps/web/stories/{project/ProjectStatusBadge,task/StateBadge,task/DeadlineBadge,access/AccessStateBadge,hr/AccessBadge,subscription/StateBadge,vendor/LifecycleBadge,vendor/OrderStateBadge}.stories.ts`
- Create: `apps/web/stories/shared/StatusBadge.stories.ts`; Modify: `apps/web/stories/Overview.mdx:24-28,88-92`
- Modify tests that stub the old names: `app/components/task/__tests__/StateMenu.test.ts:58-75`, `app/components/task/__tests__/draftPersistence.test.ts:204`, `app/pages/__tests__/uiReviewNavigationForms.test.ts:65`, `app/pages/vendor/__tests__/commercial-pages.test.ts:85`
- Modify: `tools/ui_policy.py:37-56` (drop the 8, add `shared/StatusBadge.vue`), `docs/design-system/components.md` (rows at `:35`, `:44`, `:58`, `:60`, `:84`, `:86`, `:95` lose the deleted paths; new row in the Task 1 section)
- Modify: `apps/web/e2e/support/visualStories.ts` (`'task-statebadge--'` → `'shared-statusbadge--'`)
- Delete PNGs `task-statebadge--*`; new PNGs `shared-statusbadge--*`; regenerate `docs/design-system/catalog.json`

**Interfaces:**
- Produces:
  - `type StatusTone = 'neutral' | 'info' | 'warning' | 'success' | 'destructive'` in `utils/statusTone.ts`; `STATUS_COLOR` unchanged; `composables/taskState.ts` keeps `export type StateTone = StatusTone`.
  - `SharedStatusBadge` props (contract): `{ tone: StateTone; label: string; variant?: 'subtle' | 'outline' = 'subtle'; icon?: string }`. Renders `UBadge` with `:color="STATUS_COLOR[tone]"`, `data-tone`.
  - `utils/statusBadge.ts`: `interface StatusBadgeEntry { tone: StatusTone; labelKey: string }`, `statusBadgeEntry<K extends string>(map: Readonly<Record<K, StatusBadgeEntry>>, value: string | null | undefined): StatusBadgeEntry` — an unknown or empty value returns `{ tone: 'neutral', labelKey: '' }`; callers then show the raw value (Review Focus 2) through `badgeLabel(entry, value, t)`. Also `badgeLabel(entry: StatusBadgeEntry, value: string | null | undefined, t: (key: string) => string): string`.
  - App helpers, each returning `StatusBadgeEntry`: `projectStatusBadge(status: ProjectStatus | null)`, `taskStateBadge(state: TaskState)`, `accessStateBadge(row: { active: boolean; protected?: boolean; readOnly?: boolean })`, `hrAccessBadge(access: HrEmployee['access'])`, `subscriptionStateBadge(state: SubscriptionDisplayState)`, `lifecycleBadge(view: { status: string; available?: boolean })`, `orderPaymentBadge(order: Pick<Order, 'payment_state' | 'fulfillment_state'>)`, `orderFulfillmentBadge(order: Pick<Order, 'fulfillment_state'>)`; plus `deadlineTone(daysRemaining: number | null, isClosed: boolean): StatusTone` (label stays `deadlineLabel`).

- [ ] **Step 1: The shared tone type and the maps (failing tests first)**

Create `apps/web/app/utils/__tests__/statusBadges.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { projectStatusBadge } from '../../composables/projectStatus'
import { deadlineTone, taskStateBadge } from '../../composables/taskState'
import { accessStateBadge } from '../accessStateBadge'
import { hrAccessBadge } from '../hrAccessBadge'
import { badgeLabel, statusBadgeEntry } from '../statusBadge'
import { subscriptionStateBadge } from '../subscription'
import { lifecycleBadge } from '../vendorCommercial'
import { orderFulfillmentBadge, orderPaymentBadge } from '../vendorSubscriptions'

const t = (key: string) => `t:${key}`

describe('status badge maps keep the colours and labels the old components had', () => {
  it.each([
    [projectStatusBadge('on_track'), 'success', 'projects.status.on_track'],
    [projectStatusBadge('off_track'), 'destructive', 'projects.status.off_track'],
    [taskStateBadge('changes_requested'), 'warning', 'tasks.state.changes_requested'],
    [taskStateBadge('cancelled'), 'destructive', 'tasks.state.cancelled'],
    [accessStateBadge({ active: true, protected: true }), 'success', 'access.protected'],
    [accessStateBadge({ active: false, readOnly: true }), 'neutral', 'access.readOnly'],
    [accessStateBadge({ active: false }), 'neutral', 'access.disabled'],
    [hrAccessBadge(null), 'neutral', 'hr.directory.access.noAccount'],
    [hrAccessBadge({ user_id: 9, login: 'm', role: 'employee', active: false }), 'neutral', 'hr.directory.access.stopped'],
    [hrAccessBadge({ user_id: 2, login: 'a', role: 'admin', active: true }), 'neutral', 'hr.directory.access.admin'],
    [subscriptionStateBadge('failed'), 'destructive', 'subscription.state.failed'],
    [subscriptionStateBadge('awaiting_payment'), 'warning', 'subscription.state.awaitingPayment'],
    [lifecycleBadge({ status: 'published', available: false }), 'warning', 'vendor.pricing.status.withdrawn'],
    [lifecycleBadge({ status: 'validated' }), 'info', 'vendor.pricing.status.validated'],
    [orderPaymentBadge({ payment_state: 'paid', fulfillment_state: 'applied' }), 'success', 'vendor.customers.payment.paid'],
    [orderPaymentBadge({ payment_state: 'paid', fulfillment_state: 'needs_intervention' }), 'destructive', 'vendor.customers.payment.paid'],
    [orderFulfillmentBadge({ fulfillment_state: 'queued' }), 'neutral', 'vendor.customers.fulfillment.queued'],
  ] as const)('%o', (entry, tone, labelKey) => {
    expect(entry).toEqual({ tone, labelKey })
  })

  it('labels a project without a status as unset', () => {
    expect(projectStatusBadge(null).tone).toBe('neutral')
    expect(projectStatusBadge(null).labelKey).toMatch(/^projects\.status\./)
  })

  it.each([
    [null, false, 'neutral'], [-3, false, 'destructive'], [0, false, 'warning'], [2, false, 'warning'], [3, false, 'neutral'], [-3, true, 'neutral'],
  ] as const)('a deadline %s days away (closed: %s) is %s', (days, closed, tone) => {
    expect(deadlineTone(days, closed)).toBe(tone)
  })

  it('an unknown value falls back to a neutral badge that shows the value', () => {
    const map = { done: { tone: 'success', labelKey: 'tasks.state.done' } } as const
    const unknown = statusBadgeEntry(map, 'archived_by_server')
    expect(unknown).toEqual({ tone: 'neutral', labelKey: '' })
    expect(badgeLabel(unknown, 'archived_by_server', t)).toBe('archived_by_server')
    expect(badgeLabel(statusBadgeEntry(map, 'done'), 'done', t)).toBe('t:tasks.state.done')
    expect(badgeLabel(statusBadgeEntry(map, null), null, t)).toBe('—')
    expect(taskStateBadge('new_server_state' as never)).toEqual({ tone: 'neutral', labelKey: '' })
  })
})
```

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim/apps/web && npx vitest run app/utils/__tests__/statusBadges.test.ts
```

Expected: FAIL, `Failed to resolve import "../accessStateBadge"`.

Replace `apps/web/app/utils/statusTone.ts`:

```ts
/** The five semantic tones every status badge uses (Tasmim spec §3: status colours are fixed). */
export type StatusTone = 'neutral' | 'info' | 'warning' | 'success' | 'destructive'

export const STATUS_COLOR = {
  neutral: 'neutral', info: 'info', warning: 'warning', success: 'success', destructive: 'error',
} as const satisfies Record<StatusTone, 'neutral' | 'info' | 'warning' | 'success' | 'error'>
```

In `apps/web/app/composables/taskState.ts`, replace line 16 (`export type StateTone = …`) with:

```ts
import type { StatusTone } from '@/utils/statusTone'
import { statusBadgeEntry, type StatusBadgeEntry } from '@/utils/statusBadge'

export type StateTone = StatusTone
```

(move the two `import` lines to the top of the file with the other imports), and append:

```ts
const TASK_STATE_BADGES = Object.fromEntries(
  (Object.keys(STATE_TONE) as TaskState[]).map(state => [state, { tone: STATE_TONE[state], labelKey: STATE_LABEL_KEY[state] }]),
) as Record<TaskState, StatusBadgeEntry>

/** The badge for a task state; an unknown state from a newer server is neutral and shows its raw value. */
export function taskStateBadge(state: TaskState): StatusBadgeEntry {
  return statusBadgeEntry(TASK_STATE_BADGES, state)
}

/** A closed task is never urgent; otherwise overdue is destructive and the next two days warn. */
export function deadlineTone(daysRemaining: number | null, isClosed: boolean): StatusTone {
  if (isClosed || daysRemaining === null) return 'neutral'
  if (daysRemaining < 0) return 'destructive'
  return daysRemaining <= 2 ? 'warning' : 'neutral'
}
```

Create `apps/web/app/utils/statusBadge.ts`:

```ts
import type { StatusTone } from './statusTone'

/** What an application map returns for one value; the call site translates `labelKey` for SharedStatusBadge. */
export interface StatusBadgeEntry { tone: StatusTone; labelKey: string }

/** The entry for `value`, or a neutral one with no key when the map does not know it (a newer server's value). */
export function statusBadgeEntry<K extends string>(map: Readonly<Record<K, StatusBadgeEntry>>, value: string | null | undefined): StatusBadgeEntry {
  return value && Object.hasOwn(map, value) ? map[value as K] : { tone: 'neutral', labelKey: '' }
}

/** The label to show: the translation, else the raw value, else an em dash. */
export function badgeLabel(entry: StatusBadgeEntry, value: string | null | undefined, t: (key: string) => string): string {
  return entry.labelKey ? t(entry.labelKey) : value || '—'
}
```

In `apps/web/app/composables/projectStatus.ts`, add the import `import { statusBadgeEntry, type StatusBadgeEntry } from '@/utils/statusBadge'` and append:

```ts
/** The project status badge; no status yet reads as unset. */
export function projectStatusBadge(status: ProjectStatus | null): StatusBadgeEntry {
  if (!status) return { tone: 'neutral', labelKey: PROJECT_STATUS_UNSET_KEY }
  return statusBadgeEntry(
    Object.fromEntries(Object.entries(PROJECT_STATUS_TONE).map(([key, tone]) => [key, { tone, labelKey: projectStatusLabelKey(key as ProjectStatus) }])) as Record<ProjectStatus, StatusBadgeEntry>,
    status,
  )
}
```

(`projectStatus.ts` is a "pure helpers, no Nuxt imports" file; `@/utils/statusBadge` is pure TS, so it stays pure. If vitest cannot resolve `@/` from this file, use `'../utils/statusBadge'`, as `composables/shortcuts/rows.ts` does.)

Create `apps/web/app/utils/accessStateBadge.ts`:

```ts
import type { StatusBadgeEntry } from './statusBadge'

/** Users and roles: the label says protected / read-only / active / disabled; the colour only says active. */
export function accessStateBadge(row: { active: boolean; protected?: boolean; readOnly?: boolean }): StatusBadgeEntry {
  const labelKey = row.protected ? 'access.protected' : row.readOnly ? 'access.readOnly' : row.active ? 'access.active' : 'access.disabled'
  return { tone: row.active ? 'success' : 'neutral', labelKey }
}
```

Create `apps/web/app/utils/hrAccessBadge.ts`:

```ts
import type { HrEmployee } from '@webvue/contracts'
import type { StatusBadgeEntry } from './statusBadge'

/** The directory's account column: neutral outline, labelled by account state and role. */
export function hrAccessBadge(access: HrEmployee['access']): StatusBadgeEntry {
  if (!access) return { tone: 'neutral', labelKey: 'hr.directory.access.noAccount' }
  if (!access.active) return { tone: 'neutral', labelKey: 'hr.directory.access.stopped' }
  return { tone: 'neutral', labelKey: `hr.directory.access.${access.role}` }
}
```

In `apps/web/app/utils/subscription.ts`, add `import { statusBadgeEntry, type StatusBadgeEntry } from './statusBadge'` and, after `DISPLAY_STATE_COLORS`:

```ts
const DISPLAY_STATE_TONES: Record<SubscriptionDisplayState, StatusBadgeEntry['tone']> = {
  awaiting_payment: 'warning', activating: 'info', active: 'success', failed: 'destructive', inactive: 'neutral',
}

export function subscriptionStateBadge(state: SubscriptionDisplayState): StatusBadgeEntry {
  return statusBadgeEntry(
    Object.fromEntries((Object.keys(DISPLAY_STATE_TONES) as SubscriptionDisplayState[]).map(key => [key, { tone: DISPLAY_STATE_TONES[key], labelKey: DISPLAY_STATE_KEYS[key] }])) as Record<SubscriptionDisplayState, StatusBadgeEntry>,
    state,
  )
}
```

In `apps/web/app/utils/vendorCommercial.ts`, add `import type { StatusBadgeEntry } from './statusBadge'` and after `lifecycleStatus`:

```ts
const LIFECYCLE_TONE = { draft: 'neutral', validated: 'info', published: 'success', withdrawn: 'warning' } as const satisfies Record<LifecycleStatus, StatusBadgeEntry['tone']>

export function lifecycleBadge(view: { status: string; available?: boolean }): StatusBadgeEntry {
  const state = lifecycleStatus({ status: view.status, available: view.available ?? true })
  return { tone: LIFECYCLE_TONE[state], labelKey: `vendor.pricing.status.${state}` }
}
```

In `apps/web/app/utils/vendorSubscriptions.ts`, add `import type { StatusBadgeEntry } from './statusBadge'` and after `orderBadgeColor`:

```ts
const ORDER_TONE = { error: 'destructive', success: 'success', warning: 'warning', info: 'info' } as const

/** The payment badge's colour reads both states (orderBadgeColor); its label is the payment state. */
export function orderPaymentBadge(order: Pick<Order, 'payment_state' | 'fulfillment_state'>): StatusBadgeEntry {
  return { tone: ORDER_TONE[orderBadgeColor(order)], labelKey: `vendor.customers.payment.${order.payment_state}` }
}

export function orderFulfillmentBadge(order: Pick<Order, 'fulfillment_state'>): StatusBadgeEntry {
  return { tone: 'neutral', labelKey: `vendor.customers.fulfillment.${order.fulfillment_state}` }
}
```

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim/apps/web && npx vitest run app/utils/__tests__/statusBadges.test.ts app/utils/__tests__/statusTone.test.ts
```

Expected: PASS.

- [ ] **Step 2: The component (failing test first)**

Create `apps/web/app/components/shared/__tests__/StatusBadge.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import * as statusTone from '../../../utils/statusTone'
import { renderShared } from './helpers/renderShared'

const render = (props: Record<string, unknown>) => renderShared('StatusBadge', props, {}, { modules: { '@/utils/statusTone': statusTone } })

describe('StatusBadge', () => {
  it.each([['destructive', 'error'], ['success', 'success'], ['neutral', 'neutral']] as const)('maps %s to the %s colour', async (tone, color) => {
    const html = await render({ tone, label: 'Label' })
    expect(html).toContain(`color="${color}"`)
    expect(html).toContain(`data-tone="${tone}"`)
    expect(html).toContain('variant="subtle"')
    expect(html).toContain('>Label<')
  })

  it('takes the outline variant and a decorative icon', async () => {
    const html = await render({ tone: 'neutral', label: 'L', variant: 'outline', icon: 'i-lucide-user' })
    expect(html).toContain('variant="outline"')
    expect(html).toContain('icon="i-lucide-user"')
  })

  it('passes test ids and data attributes through to the badge', async () => {
    const html = await renderShared('StatusBadge', { tone: 'info', label: 'L', 'data-testid': 'project-status' }, {}, { modules: { '@/utils/statusTone': statusTone } })
    expect(html).toContain('data-testid="project-status"')
  })
})
```

Run it (`npx vitest run app/components/shared/__tests__/StatusBadge.test.ts`); expected FAIL (`ENOENT … StatusBadge.vue`).

Create `apps/web/app/components/shared/StatusBadge.vue`:

```vue
<script setup lang="ts">
import { STATUS_COLOR, type StatusTone } from '@/utils/statusTone'

// The one status badge (Tasmim spec §6): a fixed semantic tone and a translated label.
// Applications keep their own maps (projectStatusBadge, taskStateBadge, …) and translate at the call site.
const props = withDefaults(defineProps<{ tone: StatusTone; label: string; variant?: 'subtle' | 'outline'; icon?: string }>(), { variant: 'subtle' })
</script>

<template>
  <UBadge :color="STATUS_COLOR[props.tone]" :variant="props.variant" :icon="props.icon" :data-tone="props.tone">{{ props.label }}</UBadge>
</template>
```

Run the test again; expected PASS (5 tests).

- [ ] **Step 3: Replace the call sites**

Every call site becomes `SharedStatusBadge` (auto-imported). Remove the old component's `import` line where there is one, and import the helper instead. Keep every `data-testid` / `data-slot` / `data-state` / `class` the old badge carried, on the new tag. The edits, in full:

- `pages/projects/[id].vue:73`, `project/ProjectCards.vue:62` (keep `class="shrink-0"`), `project/ProjectOverview.vue:82` (`latestUpdate.status`), `project/ProjectUpdateList.vue:67` (`u.status`), `project/ProjectTable.vue:85` (`row.original.status`), `project/dashboard/ProjectDashboardRecentProjects.vue:62,77` (`row.original.project.status`, `row.project.status`). Pattern, shown for `[id].vue`:

  ```vue
  <SharedStatusBadge v-bind="projectBadge(project.status)" data-testid="project-status" />
  ```

  with, in each file's script: `import { projectStatusBadge } from '@/composables/projectStatus'` and `const projectBadge = (status: ProjectStatus | null) => { const entry = projectStatusBadge(status); return { tone: entry.tone, label: badgeLabel(entry, status, t) } }` plus `import { badgeLabel } from '@/utils/statusBadge'` and the file's existing `const { t } = useI18n()` (add it where missing) and `import type { ProjectStatus } from '@webvue/contracts'`.

- `task/StateMenu.vue:34,38`, `task/SubtaskList.vue:46`, `task/DependencyPicker.vue:62`: `<SharedStatusBadge v-bind="stateBadge(task.state)" />` (use each line's existing expression in place of `task.state`), with `const stateBadge = (state: TaskState) => { const entry = taskStateBadge(state); return { tone: entry.tone, label: badgeLabel(entry, state, t) } }`.
- `task/TaskCard.vue:88`, `task/TaskDetailPanel.vue:247`, `task/TaskTable.vue:215` (keep `class="shrink-0"`):

  ```vue
  <SharedStatusBadge data-testid="deadline-badge" :tone="deadlineTone(task.days_remaining, task.is_closed)" :label="deadlineLabel(task.days_remaining, t)" />
  ```

  importing `deadlineLabel, deadlineTone` from `@/composables/taskState`.
- `access/users/UserTable.vue:36,50`, `access/roles/RoleTable.vue:43,57`, `pages/settings/users/[userId]/index.vue:42`: `<SharedStatusBadge :tone="accessStateBadge(x).tone" :label="t(accessStateBadge(x).labelKey)" />` where `x` is the object literal the old tag received, for example `{ active: row.original.active, protected: row.original.protected }`; import `accessStateBadge` from `@/utils/accessStateBadge`.
- `hr/DirectoryTable.vue:226`, `hr/EmployeeCard.vue:51`: `<SharedStatusBadge variant="outline" data-testid="hr-access-badge" :tone="hrAccessBadge(employee.access).tone" :label="t(hrAccessBadge(employee.access).labelKey)" />` (use the line's own employee expression); import from `@/utils/hrAccessBadge`.
- `pages/subscription/status.vue:36`, `pages/subscription/index.vue:38`: `<SharedStatusBadge v-if="display" data-slot="subscription-state" :data-state="display" :tone="subscriptionStateBadge(display).tone" :label="t(subscriptionStateBadge(display).labelKey)" />`.
- `pages/vendor/bundles/index.vue:40`, `bundles/[id].vue:29,36`, `pages/vendor/plans/index.vue:34`, `plans/[id].vue:49`: `<SharedStatusBadge data-slot="lifecycle-badge" :tone="lifecycleBadge(v).tone" :label="t(lifecycleBadge(v).labelKey)" />` where `v` is the line's object (`b`, `p`, `view`, `item`).
- `vendor/SubscriptionSummary.vue:27`:

  ```vue
  <span class="inline-flex flex-wrap items-center gap-1.5" data-slot="order-state-badge">
    <SharedStatusBadge :tone="orderPaymentBadge(subscription.pending_order).tone" :label="t(orderPaymentBadge(subscription.pending_order).labelKey)" />
    <SharedStatusBadge variant="outline" :tone="orderFulfillmentBadge(subscription.pending_order).tone" :label="t(orderFulfillmentBadge(subscription.pending_order).labelKey)" />
  </span>
  ```

Delete the 8 component files and the 8 story files listed under **Files**. Update the four tests:

- `StateMenu.test.ts`: register `app.component('SharedStatusBadge', defineComponent({ props: { tone: String, label: String }, setup(props) { return () => h('span', { 'data-tone': props.tone }, props.label) } }))` in place of `StateBadge`, and return `stateBadge: (state: string) => ({ tone: 'info', label: state })` from the test's `setup`.
- `draftPersistence.test.ts:204`: `DeadlineBadge: passthrough` → `SharedStatusBadge: passthrough`; return `deadlineTone: () => 'neutral', deadlineLabel: () => ''` from the detail `setup` (next to `t`).
- `uiReviewNavigationForms.test.ts:65`: `ProjectStatusBadge: {}` → `projectStatusBadge: () => ({ tone: 'neutral', labelKey: '' }), badgeLabel: () => ''`.
- `commercial-pages.test.ts:85`: drop `'LifecycleBadge.vue'` from the component list; add `` read('app/utils/vendorCommercial.ts') `` to `files` so its `vendor.pricing.status.*` template key is still checked (if the test's key regex only matches `t('…')` literals, the list change is all that is needed — say so in the commit body).

- [ ] **Step 4: Story, Overview, policy, visual list, catalog**

Create `apps/web/stories/shared/StatusBadge.stories.ts`:

```ts
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { ProjectStatusSchema, TaskStateSchema } from '@webvue/contracts'
import { useI18n } from 'vue-i18n'
import StatusBadge from '../../app/components/shared/StatusBadge.vue'
import { projectStatusBadge } from '../../app/composables/projectStatus'
import { deadlineLabel, deadlineTone, taskStateBadge } from '../../app/composables/taskState'
import { accessStateBadge } from '../../app/utils/accessStateBadge'
import { hrAccessBadge } from '../../app/utils/hrAccessBadge'
import { subscriptionStateBadge } from '../../app/utils/subscription'
import { lifecycleBadge } from '../../app/utils/vendorCommercial'
import { orderFulfillmentBadge, orderPaymentBadge } from '../../app/utils/vendorSubscriptions'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/StatusBadge',
  component: StatusBadge,
  parameters: { a11y: { test: 'error' } },
  args: { tone: 'info', label: '' },
} satisfies Meta<typeof StatusBadge>
export default meta
type Story = StoryObj<typeof meta>

const row = (template: string, data: () => Record<string, unknown>): Story['render'] => () => ({
  components: { StatusBadge },
  setup: () => ({ t: useI18n().t, ...data() }),
  template: `<div class="flex flex-wrap items-center gap-2" style="max-width: 640px">${template}</div>`,
})

export const ProjectStatus: Story = {
  name: 'حالة المشروع',
  parameters: storyContext('apps/web/app/components/project/ProjectTable.vue:85'),
  render: row('<StatusBadge v-for="s in statuses" :key="String(s)" :tone="projectStatusBadge(s).tone" :label="t(projectStatusBadge(s).labelKey)" />', () => ({ statuses: [...ProjectStatusSchema.options, null], projectStatusBadge })),
}
export const TaskState: Story = {
  name: 'حالة المهمة',
  parameters: storyContext('apps/web/app/components/task/StateMenu.vue:34'),
  render: row('<StatusBadge v-for="s in states" :key="s" :tone="taskStateBadge(s).tone" :label="t(taskStateBadge(s).labelKey)" />', () => ({ states: TaskStateSchema.options, taskStateBadge })),
}
export const Deadline: Story = {
  name: 'موعد المهمة',
  parameters: storyContext('apps/web/app/components/task/TaskCard.vue:88'),
  render: row('<StatusBadge v-for="(c, i) in cases" :key="i" :tone="deadlineTone(c[0], c[1])" :label="deadlineLabel(c[0], t)" />', () => ({ cases: [[-3, false], [0, false], [1, false], [10, false], [-3, true], [null, false]], deadlineTone, deadlineLabel })),
}
export const AccessState: Story = {
  name: 'حالة الوصول',
  parameters: storyContext('apps/web/app/components/access/users/UserTable.vue:50'),
  render: row('<StatusBadge v-for="(r, i) in rows" :key="i" :tone="accessStateBadge(r).tone" :label="t(accessStateBadge(r).labelKey)" />', () => ({ rows: [{ active: true }, { active: false }, { active: true, protected: true }, { active: true, readOnly: true }], accessStateBadge })),
}
export const HrAccess: Story = {
  name: 'حساب الموظف',
  parameters: storyContext('apps/web/app/components/hr/DirectoryTable.vue:226'),
  render: row('<StatusBadge v-for="(a, i) in accesses" :key="i" variant="outline" :tone="hrAccessBadge(a).tone" :label="t(hrAccessBadge(a).labelKey)" />', () => ({
    accesses: [null, { user_id: 7, login: 'sara', role: 'employee', active: true }, { user_id: 2, login: 'admin', role: 'admin', active: true }, { user_id: 9, login: 'm', role: 'employee', active: false }],
    hrAccessBadge,
  })),
}
export const SubscriptionState: Story = {
  name: 'حالة الاشتراك',
  parameters: storyContext('apps/web/app/pages/subscription/index.vue:38'),
  render: row('<StatusBadge v-for="s in states" :key="s" :tone="subscriptionStateBadge(s).tone" :label="t(subscriptionStateBadge(s).labelKey)" />', () => ({ states: ['awaiting_payment', 'activating', 'active', 'failed', 'inactive'], subscriptionStateBadge })),
}
export const Lifecycle: Story = {
  name: 'دورة حياة الحزمة',
  parameters: storyContext('apps/web/app/pages/vendor/bundles/index.vue:40'),
  render: row('<StatusBadge v-for="(v, i) in views" :key="i" :tone="lifecycleBadge(v).tone" :label="t(lifecycleBadge(v).labelKey)" />', () => ({ views: [{ status: 'draft' }, { status: 'validated' }, { status: 'published', available: true }, { status: 'published', available: false }], lifecycleBadge })),
}
export const OrderState: Story = {
  name: 'حالة الطلب',
  parameters: storyContext('apps/web/app/components/vendor/SubscriptionSummary.vue:27'),
  render: row('<template v-for="(o, i) in orders" :key="i"><StatusBadge :tone="orderPaymentBadge(o).tone" :label="t(orderPaymentBadge(o).labelKey)" /><StatusBadge variant="outline" :tone="orderFulfillmentBadge(o).tone" :label="t(orderFulfillmentBadge(o).labelKey)" /></template>', () => ({
    orders: [{ payment_state: 'awaiting_payment', fulfillment_state: 'not_started' }, { payment_state: 'paid', fulfillment_state: 'applied' }, { payment_state: 'paid', fulfillment_state: 'needs_intervention' }],
    orderPaymentBadge, orderFulfillmentBadge,
  })),
}
```

In `apps/web/stories/Overview.mdx`, replace lines 24-28 with `import * as StatusBadge from './shared/StatusBadge.stories'` and lines 88-92 with:

```mdx
<Canvas of={StatusBadge.ProjectStatus} />
<Canvas of={StatusBadge.TaskState} />
<Canvas of={StatusBadge.Deadline} />
<Canvas of={StatusBadge.AccessState} />
<Canvas of={StatusBadge.HrAccess} />
```

In `tools/ui_policy.py` `STORYBOOK_COMPONENTS`, delete `'project/ProjectStatusBadge.vue', 'task/StateBadge.vue', 'task/DeadlineBadge.vue', 'access/AccessStateBadge.vue',`, `'hr/AccessBadge.vue',`, `'vendor/LifecycleBadge.vue',`, `'subscription/StateBadge.vue',`, `'vendor/OrderStateBadge.vue',` and add `'shared/StatusBadge.vue',` after the Task 1 states line.

In `visualStories.ts`, replace `'task-statebadge--',` with `'shared-statusbadge--',` and add `'shared-statusbadge--',` to `VISUAL_AXE_STORIES`.

In `components.md`, delete the eight paths (with their «قصة» notes) from the rows at `:35`, `:44`, `:58`, `:60`, and delete rows `:84`, `:86`, `:95`; add to the Task 1 section:

```markdown
| `apps/web/app/components/shared/StatusBadge.vue` | `apps/web/stories/shared/StatusBadge.stories.ts` | `UBadge` بلون `STATUS_COLOR`؛ الخرائط تبقى في ملفات التطبيقات (`projectStatusBadge`، `taskStateBadge`، `deadlineTone`، `accessStateBadge`، `hrAccessBadge`، `subscriptionStateBadge`، `lifecycleBadge`، `orderPaymentBadge`/`orderFulfillmentBadge`) |
```

- [ ] **Step 5: Run, re-baseline, check e2e**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim
rg -n "ProjectStatusBadge|AccessStateBadge|DeadlineBadge|LifecycleBadge|OrderStateBadge|<StateBadge|AccessBadge\b|SubscriptionStateBadge" apps/web/app apps/web/stories tools/ui_policy.py docs/design-system/components.md
python3 -B tools/ui_policy.py --refresh-story-context && node tools/ui_catalog.mjs
npm -w apps/web run lint && npm test 2>&1 | tail -3 && python3 -B tools/ui_policy.py && python3 -B tools/arch_policy.py
cd apps/web && rm -f e2e/storybook-visual.spec.ts-snapshots/task-statebadge--* && npm run build-storybook >/dev/null
npx playwright test e2e/storybook-visual.spec.ts -g 'shared-statusbadge' --update-snapshots=missing --reporter=line | tail -3
WEBVUE_REQUIRE_STORYBOOK=1 npx playwright test e2e/storybook-visual.spec.ts e2e/storybook-smoke.spec.ts --reporter=line 2>&1 | tail -12
```

Expected: the `rg` prints nothing. Lint, tests and policies pass. 32 `shared-statusbadge--*` PNGs are written (8 stories × 4) and their axe test passes. The full visual and smoke runs pass except the known `shared-createpanel--form` smoke failure (fixed in Task 9). Any other visual diff is a regression: the badges keep their colours and labels.

Then, on the mock stack (start it exactly as Task 16's Step 3 does), run the specs that read these badges:

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim/apps/web
E2E_BASE_URL=http://localhost:4097 npx playwright test e2e/projects.spec.ts e2e/detail.spec.ts --reporter=line 2>&1 | tail -8
```

Expected: no failing title outside `.superpowers/tasmim-shared/e2e-cp3-failures.txt` (`project-status` and `deadline-badge` test ids are on the new tags). Stop both processes by PID.

- [ ] **Step 6: Commit**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim
git add -A apps/web tools/ui_policy.py docs/design-system
git commit -m "refactor(web): merge the eight status badges into StatusBadge

Applications keep their tone maps and translate at the call site. An
unknown value shows its raw text on a neutral badge. task-statebadge--*
baselines move to shared-statusbadge--*.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `FilterCard` folds into `FilterBar`

`FilterCard` has one user, `FilterBar`. The card markup moves into `FilterBar.vue` unchanged, so the `shared-filterbar--*` baselines must not move.

**Files:**
- Rewrite: `apps/web/app/components/shared/FilterBar.vue` (65 lines today; absorbs `FilterCard.vue`'s 46)
- Delete: `apps/web/app/components/shared/FilterCard.vue`, `apps/web/app/components/shared/__tests__/FilterCard.test.ts`
- Create: `apps/web/app/components/shared/__tests__/FilterBar.test.ts`
- Modify: `apps/web/app/components/shared/__tests__/helpers/filterComponents.ts:18` (drop the `FilterCard.vue` branch)
- Modify: `docs/design-system/components.md:14` (drop `apps/web/app/components/shared/FilterCard.vue`)

**Interfaces:**
- Consumes: nothing new.
- Produces: `SharedFilterBar` with today's props `{ inline?, title?, activeCount = 0, clearLabel?, disabled = false, defaultOpen = false }`, emit `clear`, slots `search default view actions active`. One `data-shortcut-search` wrapper in either mode. Card mode keeps `data-slot` `filter-root`, `search`, `filter-fields`, `controls`, `view`, `filter-actions`, `active-row`; inline mode keeps `inline-filter-bar`.

- [ ] **Step 1: Move the card tests onto `FilterBar` (they must fail first)**

Create `apps/web/app/components/shared/__tests__/FilterBar.test.ts` with the eleven cases of `FilterCard.test.ts`, each card case now rendering `FilterBar` without `inline`, plus three new cases:

```ts
import { describe, expect, it } from 'vitest'
import { h } from 'vue'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderFilter } from './helpers/filterComponents'

const field = () => h('input', { value: 'Project A' })

describe('FilterBar', () => {
  it('keeps inline project tools visible once without a collapsed card', async () => {
    const html = await renderFilter('FilterBar', { inline: true, activeCount: 1 }, {
      search: () => h('input', { 'aria-label': 'Task search' }),
      default: () => h('button', 'Task states'),
      view: () => h('button', 'Timeline'),
      actions: () => h('button', 'New task'),
      active: () => h('span', 'Selected state'),
    })
    expect(html).not.toContain('aria-expanded')
    expect(html).toContain('aria-label="Clear filters"')
    for (const text of ['Task search', 'Task states', 'Timeline', 'New task', 'Selected state']) expect(html.split(text)).toHaveLength(2)
  })
  it('disables the inline clear action until hydration', async () => {
    expect(await renderFilter('FilterBar', { inline: true, activeCount: 1 }, {}, false)).toMatch(/<button\b[^>]*disabled/)
  })
  it('renders a collapsed accessible region with localized default labels and a separate clear action', async () => {
    const html = await renderFilter('FilterBar', { activeCount: 2 }, { default: field })
    expect(html).toContain('Search and filters')
    expect(html).toContain('aria-expanded="false"')
    const id = html.match(/aria-controls="([^"]+)"/)?.[1]
    expect(id).toBeTruthy()
    expect(html).toContain(`id="${id}"`)
    expect(html).toContain('Clear filters')
    expect(html.match(/<button\b/g)).toHaveLength(2)
  })
  it('allows an explicit expanded presentation', async () => {
    expect(await renderFilter('FilterBar', { defaultOpen: true }, { default: () => h('select') })).toContain('aria-expanded="true"')
  })
  it('keeps active summary and actions visible outside the collapsed fields', async () => {
    const html = await renderFilter('FilterBar', { activeCount: 1 }, { default: field, active: () => h('span', 'Project A selected'), actions: () => h('button', 'Board view') })
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('Project A selected')
    expect(html).toContain('Board view')
  })
  it('does not show a clear action when there are no active filters', async () => {
    expect(await renderFilter('FilterBar', { activeCount: 0 }, { default: field })).not.toContain('Clear filters')
  })
  it('disables interaction before hydration and when explicitly disabled', async () => {
    for (const [props, hydrated] of [[{ activeCount: 1 }, false], [{ activeCount: 1, disabled: true }, true]] as const) {
      const html = await renderFilter('FilterBar', props, { default: () => h('select') }, hydrated)
      expect(html.match(/<button\b[^>]*disabled/g)).toHaveLength(2)
    }
  })
  it('keeps the search visible while extra fields stay behind the trigger', async () => {
    const html = await renderFilter('FilterBar', {}, { search: () => h('input', { 'aria-label': 'Visible search' }), default: () => h('select', [h('option', 'All states')]) })
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('data-slot="search"')
    expect(html).toContain('All states')
  })
  it('hides the filter trigger when only search is given', async () => {
    expect(await renderFilter('FilterBar', {}, { search: () => h('input', { 'aria-label': 'Only search' }) })).not.toContain('aria-expanded')
  })
  it('renders one card with every slot in its place', async () => {
    const html = await renderFilter('FilterBar', { activeCount: 1 }, {
      search: () => h('input', { 'aria-label': 'Search' }), default: () => h('select', [h('option', 'All states')]),
      view: () => h('button', 'Board'), active: () => h('span', 'Done'),
    })
    expect(html.match(/data-slot="filter-root"/g)).toHaveLength(1)
    for (const slot of ['search', 'controls', 'view', 'active-row', 'filter-fields']) expect(html).toContain(`data-slot="${slot}"`)
  })
  it('keeps one search marker in both modes', async () => {
    for (const inline of [true, false]) {
      const html = await renderFilter('FilterBar', { inline }, { search: () => h('input'), default: () => h('select') })
      expect(html.match(/data-shortcut-search/g), `inline=${inline}`).toHaveLength(1)
    }
  })
  it('Esc in the panel closes it and returns focus to the trigger', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../FilterBar.vue'), 'utf8')
    expect(source).toMatch(/data-slot="filter-fields"[^>]*@keydown\.esc\.stop="close"/)
    expect(source).toMatch(/function close\(\) \{\s*expanded\.value = false\s*trigger\.value\?\.\$el\?\.focus\(\)/)
  })
  it('is the only filter shell: FilterCard is gone', () => {
    expect(() => readFileSync(resolve(import.meta.dirname, '../FilterCard.vue'))).toThrow()
  })
})
```

(The Esc case reads the source because this suite has no DOM; the real keyboard path is already covered by the `shared-filterbar--filters-open` story and `e2e/project-clarity.spec.ts`.)

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim/apps/web && npx vitest run app/components/shared/__tests__/FilterBar.test.ts
```

Expected: FAIL in "Esc in the panel…" (the handler lives in `FilterCard.vue`) and "is the only filter shell"; the rest pass through today's wrapper.

- [ ] **Step 2: One file**

Replace `apps/web/app/components/shared/FilterBar.vue`:

```vue
<template>
  <div v-if="props.inline" class="min-w-0 space-y-2" data-slot="inline-filter-bar">
    <div class="flex min-w-0 flex-wrap items-center gap-2">
      <div v-if="$slots.search" data-shortcut-search class="min-w-48 flex-1 *:w-full"><slot name="search" /></div>
      <slot />
      <slot name="view" />
      <slot name="actions" />
      <UButton v-if="activeCount > 0" type="button" color="error" variant="ghost" square icon="i-lucide-trash-2" :aria-label="resolvedClearLabel" :disabled="isDisabled" @click="$emit('clear')"></UButton>
    </div>
    <div v-if="activeCount > 0 && $slots.active" class="flex flex-wrap items-center gap-2"><slot name="active" /></div>
  </div>
  <div v-else data-slot="filter-root" class="min-w-0 space-y-2">
    <div class="flex flex-wrap items-center gap-2">
      <div v-if="$slots.search" data-slot="search" data-shortcut-search class="min-w-48 flex-1 *:w-full">
        <slot name="search" />
      </div>
      <UButton v-if="$slots.default" ref="trigger" type="button" color="neutral" :variant="expanded ? 'soft' : 'outline'" square icon="i-lucide-list-filter" :aria-label="resolvedTitle" :title="resolvedTitle" :aria-expanded="expanded" :aria-controls="contentId" :disabled="isDisabled" @click="expanded = !expanded" />
      <UBadge v-if="activeCount > 0" color="primary">{{ activeCount }}</UBadge>
      <UButton v-if="activeCount > 0" type="button" color="error" variant="ghost" square icon="i-lucide-trash-2" :aria-label="resolvedClearLabel" :title="resolvedClearLabel" :disabled="isDisabled" @click="$emit('clear')" />
      <div v-if="$slots.view" data-slot="view" class="ms-auto flex flex-wrap items-center gap-2"><slot name="view" /></div>
      <div v-if="$slots.actions" data-slot="filter-actions" class="flex shrink-0 flex-wrap items-center gap-2"><slot name="actions" /></div>
    </div>
    <div v-if="$slots.default" v-show="expanded" :id="contentId" class="rounded-lg ring ring-default bg-default p-4" data-slot="filter-fields" :aria-label="resolvedTitle" role="region" :aria-busy="isDisabled" @keydown.esc.stop="close">
      <div data-slot="controls" class="flex min-w-0 flex-wrap items-start gap-x-6 gap-y-3"><slot /></div>
    </div>
    <div v-if="activeCount > 0 && $slots.active" data-slot="active-row" class="flex flex-wrap items-center gap-2 text-xs text-muted"><slot name="active" /></div>
  </div>
</template>

<script setup lang="ts">
// The one list toolbar (DESIGN.md §6): a visible search, then a trigger that shows the
// filter fields under the bar (Esc closes them and returns focus), a count and a clear
// action. `inline` lays every control in one row for embedded toolbars.
const props = withDefaults(defineProps<{
  inline?: boolean
  title?: string
  activeCount?: number
  clearLabel?: string
  disabled?: boolean
  defaultOpen?: boolean
}>(), {
  activeCount: 0,
  disabled: false,
  defaultOpen: false,
})
defineEmits<{ clear: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const expanded = ref(props.defaultOpen)
const trigger = ref<{ $el?: HTMLElement } | null>(null)
function close() {
  expanded.value = false
  trigger.value?.$el?.focus()
}
const contentId = `filter-card-${useId()}`
const activeCount = computed(() => Math.max(0, props.activeCount ?? 0))
const isDisabled = computed(() => props.disabled || !hydrated.value)
const resolvedTitle = computed(() => props.title || t('filterCard.title'))
const resolvedClearLabel = computed(() => props.clearLabel || t('filterCard.clear'))
</script>
```

The card mode used to put `view` and `actions` inside the card's `#actions` slot, which rendered after the clear button in the same row: the order above is the same, so the DOM order and the baselines do not change. `filterCard.*` locale keys stay.

Delete `FilterCard.vue` and `FilterCard.test.ts`. In `helpers/filterComponents.ts`, delete line 18 (the `FilterCard.vue` branch); `require` now only resolves `vue`.

- [ ] **Step 3: Run**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim
rg -n "FilterCard" apps/web/app apps/web/stories docs/design-system/components.md
(cd apps/web && npx vitest run app/components/shared)
npm -w apps/web run lint && npm test 2>&1 | tail -3 && python3 -B tools/ui_policy.py
cd apps/web && npm run build-storybook >/dev/null
WEBVUE_REQUIRE_STORYBOOK=1 npx playwright test e2e/storybook-visual.spec.ts -g 'shared-filterbar' --reporter=line | tail -3
```

Expected: `rg` prints nothing after the `components.md` edit (the class prefix `filter-card-` in `contentId` is an id, not the component). All tests pass, and the 16 `shared-filterbar--*` screenshots match with no update.

- [ ] **Step 4: Commit**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim
git add -A apps/web docs/design-system
git commit -m "refactor(web): fold FilterCard into FilterBar

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: One `InvoiceLines`

The subscription and vendor invoices show the same lines two ways: a list with a "not official" notice and totals, and a table with a kind badge. One shared component draws both from view rows the caller builds; it formats nothing and imports no application util (R3).

**Quantities stay as they are.** The two callers count paid quantity differently today (subscription: `quantity − free_quantity`; vendor `lineQuantities`: `quantity`). This task keeps each caller's own computation, so no number a customer or vendor sees changes. Which one is right is an owner decision listed for CP4 (Task 16).

**Files:**
- Create: `apps/web/app/utils/invoiceLines.ts` (the `InvoiceLineView` type only), `apps/web/app/components/shared/InvoiceLines.vue`, `apps/web/app/components/shared/__tests__/InvoiceLines.test.ts`
- Modify: `apps/web/app/utils/subscription.ts` (add `subscriptionInvoiceView`), `apps/web/app/utils/vendorSubscriptions.ts` (add `vendorInvoiceLineViews`), with cases in `apps/web/app/utils/__tests__/subscription.test.ts` and `apps/web/app/utils/__tests__/vendorSubscriptions.test.ts` (create the first if missing)
- Modify: `apps/web/app/pages/subscription/invoices/[id].vue:15`, `apps/web/app/pages/vendor/invoices/[id].vue:39`
- Delete: `apps/web/app/components/subscription/InvoiceLines.vue`, `apps/web/app/components/vendor/InvoiceLines.vue`, `apps/web/stories/subscription/InvoiceLines.stories.ts`, `apps/web/stories/vendor/InvoiceLines.stories.ts`
- Create: `apps/web/stories/shared/InvoiceLines.stories.ts`
- Modify: `apps/web/i18n/locales/{ar,en}/common.json` (`states.invoice.*`)
- Modify tests: `apps/web/app/pages/vendor/__tests__/commercial-customers.test.ts:40` (`VendorInvoiceLines` → `SharedInvoiceLines`), `apps/web/app/pages/__tests__/subscriptionJourney.test.ts:56` (read the page instead of the deleted component)
- Modify: `tools/ui_policy.py` `STORYBOOK_COMPONENTS` (drop `'subscription/InvoiceLines.vue'`, `'vendor/InvoiceLines.vue'`; add `'shared/InvoiceLines.vue'`), `apps/web/e2e/support/visualStories.ts` (`'shared-invoicelines--'` in `VISUAL_STORIES` and `VISUAL_AXE_STORIES`), `docs/design-system/components.md` (delete rows `:83` and `:94`; add a row)

**Interfaces:**
- Produces (contract):
  - `type InvoiceLineView = { id: string | number; description: string; kind?: { label: string; tone: StateTone }; cells: { key: string; label: string; value: string }[]; amount: string }` in `app/utils/invoiceLines.ts`.
  - `SharedInvoiceLines` props `{ lines: InvoiceLineView[]; totals?: { label: string; value: string }[]; notice?: string; layout?: 'table' | 'list' = 'table' }`. Root `data-slot="invoice-lines"`; each line `data-testid="invoice-line"`; the notice `data-testid="not-official"`; the last total is the grand total (bold). Table headers: `states.invoice.description`, each cell's `label` (from the first line), `states.invoice.amount`.
  - `subscriptionInvoiceView(invoice: Invoice, t: (key: string) => string, locale: string): { lines: InvoiceLineView[]; totals: { label: string; value: string }[]; notice: string }`.
  - `vendorInvoiceLineViews(lines: Invoice['lines'], t: (key: string) => string, locale: string): InvoiceLineView[]`.

- [ ] **Step 1: The two view builders (failing tests first)**

Append to `apps/web/app/utils/__tests__/vendorSubscriptions.test.ts` (add the imports to its import list):

```ts
describe('vendorInvoiceLineViews', () => {
  const t = (key: string) => `t:${key}`
  const line = { key: 'l1', kind: 'branch', timing: 'now', description: 'Branches', quantity: 3, free_quantity: 1,
    unit_amount: sar(10000), amount: sar(30000), period_start: '2026-10-01', period_end: '2026-10-31', source_revision_id: 'r' } as Invoice['lines'][number]

  it('keeps the vendor table columns and quantities, with money formatted', () => {
    const [view] = vendorInvoiceLineViews([line], t, 'en')
    expect(view!.id).toBe('l1')
    expect(view!.kind).toEqual({ label: 't:vendor.invoices.lineKind.branch', tone: 'neutral' })
    expect(view!.cells.map(c => [c.key, c.value])).toEqual([
      ['free', '1'], ['paid', '3'], ['unit', formatVendorMoney(sar(10000), 'en')], ['period', '2026-10-01 → 2026-10-31'],
    ])
    expect(view!.cells.map(c => c.label)).toEqual(['t:vendor.invoices.line.free', 't:vendor.invoices.line.paid', 't:vendor.invoices.line.unit', 't:vendor.invoices.line.period'])
    expect(view!.amount).toBe(formatVendorMoney(sar(30000), 'en'))
  })

  it('shows not-available, never 0, when a line has no free quantity', () => {
    const [view] = vendorInvoiceLineViews([{ ...line, free_quantity: undefined }], t, 'en')
    expect(view!.cells[0]!.value).toBe('t:app.notAvailable')
  })
})
```

Create or extend `apps/web/app/utils/__tests__/subscription.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { Invoice } from '@webvue/commercial-contracts'
import { formatSubscriptionMoney, subscriptionInvoiceView } from '../subscription'

const money = (minor: number) => ({ currency: 'SAR', exponent: 2, minor })
const t = (key: string) => `t:${key}`
const invoice = {
  lines: [
    { key: 'a', kind: 'base', timing: 'now', description: 'Base', quantity: 5, free_quantity: 2, unit_amount: money(100), amount: money(300), period_start: '2026-10-01', period_end: '2026-10-31', source_revision_id: 'r' },
    { key: 'b', kind: 'discount', timing: 'now', description: 'Discount', quantity: 1, unit_amount: money(-50), amount: money(-50), period_start: '2026-10-01', period_end: '2026-10-31', source_revision_id: 'r' },
  ],
  subtotal: money(250), tax: money(38), total: money(288),
} as unknown as Invoice

describe('subscriptionInvoiceView', () => {
  it('keeps the list rendering: quantity, free and paid counts, then the amount', () => {
    const view = subscriptionInvoiceView(invoice, t, 'ar')
    expect(view.notice).toBe('t:subscription.invoices.notOfficial')
    expect(view.lines[0]!.cells.map(c => [c.key, c.value])).toEqual([['quantity', '× 5'], ['free', '2'], ['paid', '3']])
    expect(view.lines[1]!.cells.map(c => c.key)).toEqual(['quantity'])
    expect(view.lines[1]!.amount).toBe(formatSubscriptionMoney(money(-50), 'ar'))
  })

  it('ends with subtotal, tax and total in that order', () => {
    expect(subscriptionInvoiceView(invoice, t, 'ar').totals.map(row => row.label)).toEqual([
      't:subscription.invoices.subtotal', 't:subscription.invoices.tax', 't:subscription.invoices.total',
    ])
  })
})
```

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim/apps/web && npx vitest run app/utils/__tests__/subscription.test.ts app/utils/__tests__/vendorSubscriptions.test.ts
```

Expected: FAIL, `subscriptionInvoiceView is not a function` / `vendorInvoiceLineViews is not defined`.

Create `apps/web/app/utils/invoiceLines.ts`:

```ts
import type { StatusTone } from './statusTone'

/** One invoice line as SharedInvoiceLines draws it: every label translated and every amount formatted by the caller. */
export interface InvoiceLineView {
  id: string | number
  description: string
  kind?: { label: string; tone: StatusTone }
  cells: { key: string; label: string; value: string }[]
  amount: string
}
```

Append to `apps/web/app/utils/subscription.ts` (with `import type { InvoiceLineView } from './invoiceLines'` and `import type { Invoice } from '@webvue/commercial-contracts'` if not already imported):

```ts
/** The customer invoice: list lines (× quantity · free · paid), the "not official" notice and the totals. */
export function subscriptionInvoiceView(invoice: Invoice, t: (key: string) => string, locale: string) {
  const money = (value: Invoice['total']) => formatSubscriptionMoney(value, locale)
  const lines: InvoiceLineView[] = invoice.lines.map(line => ({
    id: line.key,
    description: line.description,
    cells: [
      { key: 'quantity', label: t('subscription.invoices.quantity'), value: `× ${line.quantity}` },
      ...(line.free_quantity === undefined ? [] : [
        { key: 'free', label: t('subscription.invoices.free'), value: String(line.free_quantity) },
        { key: 'paid', label: t('subscription.invoices.paidQty'), value: String(line.quantity - line.free_quantity) },
      ]),
    ],
    amount: money(line.amount),
  }))
  return {
    lines,
    notice: t('subscription.invoices.notOfficial'),
    totals: [
      { label: t('subscription.invoices.subtotal'), value: money(invoice.subtotal) },
      { label: t('subscription.invoices.tax'), value: money(invoice.tax) },
      { label: t('subscription.invoices.total'), value: money(invoice.total) },
    ],
  }
}
```

`subscription.invoices.quantity` is a new key: add `"quantity": "الكمية"` to `ar/subscription.json` and `"quantity": "Quantity"` to `en/subscription.json` under `invoices` (the list layout hides labels visually but keeps them for screen readers; Step 2).

Append to `apps/web/app/utils/vendorSubscriptions.ts` (with `import type { InvoiceLineView } from './invoiceLines'` and `import { formatVendorMoney } from './vendorCommercial'` if not already imported):

```ts
/** The vendor invoice table: kind badge, free / paid / unit / period cells and the amount. */
export function vendorInvoiceLineViews(lines: Invoice['lines'], t: (key: string) => string, locale: string): InvoiceLineView[] {
  return lines.map(line => {
    const q = lineQuantities(line)
    return {
      id: line.key,
      description: line.description,
      kind: { label: t(`vendor.invoices.lineKind.${line.kind}`), tone: 'neutral' },
      cells: [
        { key: 'free', label: t('vendor.invoices.line.free'), value: q.free === null ? t('app.notAvailable') : String(q.free) },
        { key: 'paid', label: t('vendor.invoices.line.paid'), value: String(q.paid) },
        { key: 'unit', label: t('vendor.invoices.line.unit'), value: formatVendorMoney(line.unit_amount, locale) },
        { key: 'period', label: t('vendor.invoices.line.period'), value: `${line.period_start} → ${line.period_end}` },
      ],
      amount: formatVendorMoney(line.amount, locale),
    }
  })
}
```

Run the two test files again; expected PASS.

- [ ] **Step 2: The component (failing test first)**

Create `apps/web/app/components/shared/__tests__/InvoiceLines.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import * as statusTone from '../../../utils/statusTone'
import { renderShared } from './helpers/renderShared'

const lines = [
  { id: 'a', description: 'Base', kind: { label: 'Base fee', tone: 'neutral' }, cells: [{ key: 'free', label: 'Free', value: '2' }, { key: 'period', label: 'Period', value: '2026-10-01 → 2026-10-31' }], amount: 'SAR 3.00' },
  { id: 'b', description: 'Discount', cells: [{ key: 'free', label: 'Free', value: '—' }, { key: 'period', label: 'Period', value: '2026-10-01 → 2026-10-31' }], amount: '-SAR 0.50' },
]
const render = (props: Record<string, unknown>) => renderShared('InvoiceLines', props, {}, { modules: { '@/utils/statusTone': statusTone } })

describe('InvoiceLines', () => {
  it('draws a table: description, the cell columns from the first line, then the amount', async () => {
    const html = await render({ lines })
    expect(html).toContain('data-slot="invoice-lines"')
    expect(html.match(/<th\b/g)).toHaveLength(4)
    expect(html.indexOf('states.invoice.description')).toBeLessThan(html.indexOf('>Free<'))
    expect(html.indexOf('>Period<')).toBeLessThan(html.indexOf('states.invoice.amount'))
    expect(html.match(/data-testid="invoice-line"/g)).toHaveLength(2)
    expect(html).toContain('Base fee')
    expect(html).toContain('-SAR 0.50')
  })

  it('isolates money and periods left-to-right inside RTL text', async () => {
    const html = await render({ lines })
    expect(html).toMatch(/<bdi dir="ltr"[^>]*>SAR 3\.00<\/bdi>/)
    expect(html).toMatch(/<bdi dir="ltr"[^>]*>2026-10-01 → 2026-10-31<\/bdi>/)
  })

  it('draws a list with the notice and the totals, the last one bold', async () => {
    const html = await render({ lines, layout: 'list', notice: 'Not an official tax invoice', totals: [{ label: 'Subtotal', value: 'SAR 2.50' }, { label: 'Total', value: 'SAR 2.88' }] })
    expect(html).not.toContain('<table')
    expect(html).toContain('data-testid="not-official"')
    expect(html.match(/<dt\b/g)).toHaveLength(2)
    expect(html).toMatch(/<dt class="[^"]*font-semibold[^"]*">Total<\/dt>/)
  })

  it('draws nothing but the header for an invoice without lines', async () => {
    const html = await render({ lines: [] })
    expect(html).not.toContain('invoice-line')
    expect(html.match(/<th\b/g)).toHaveLength(2)
  })
})
```


Run it; expected FAIL (`ENOENT … InvoiceLines.vue`).

Add to `apps/web/i18n/locales/ar/common.json` `states`: `"invoice": { "description": "الوصف", "amount": "المبلغ", "lines": "بنود الفاتورة", "totals": "الإجماليات" }`; to `en/common.json` `states`: `"invoice": { "description": "Description", "amount": "Amount", "lines": "Invoice lines", "totals": "Totals" }`.

Create `apps/web/app/components/shared/InvoiceLines.vue`:

```vue
<script setup lang="ts">
import type { InvoiceLineView } from '@/utils/invoiceLines'
import StatusBadge from './StatusBadge.vue'

// Invoice lines for the customer and the vendor (Tasmim spec §6 merge). The caller
// translates every label and formats every amount; this draws a table or a list.
const props = withDefaults(defineProps<{
  lines: InvoiceLineView[]
  totals?: { label: string; value: string }[]
  notice?: string
  layout?: 'table' | 'list'
}>(), { layout: 'table' })
const { t } = useI18n()
const columns = computed(() => props.lines[0]?.cells.map(cell => ({ key: cell.key, label: cell.label })) ?? [])
</script>

<template>
  <div class="space-y-4" data-slot="invoice-lines">
    <p v-if="props.notice" class="text-sm font-medium text-warning" data-testid="not-official">{{ props.notice }}</p>
    <div v-if="props.layout === 'table'" class="overflow-x-auto">
      <table class="w-full text-sm">
        <caption class="sr-only">{{ t('states.invoice.lines') }}</caption>
        <thead class="text-muted">
          <tr>
            <th scope="col" class="py-2 pe-3 text-start font-medium">{{ t('states.invoice.description') }}</th>
            <th v-for="column in columns" :key="column.key" scope="col" class="px-3 py-2 text-start font-medium">{{ column.label }}</th>
            <th scope="col" class="ps-3 py-2 text-start font-medium">{{ t('states.invoice.amount') }}</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-default">
          <tr v-for="line in props.lines" :key="line.id" data-testid="invoice-line">
            <td class="py-2 pe-3">{{ line.description }} <StatusBadge v-if="line.kind" :tone="line.kind.tone" :label="line.kind.label" /></td>
            <td v-for="cell in line.cells" :key="cell.key" class="px-3 py-2 tabular-nums"><bdi dir="ltr">{{ cell.value }}</bdi></td>
            <td class="ps-3 py-2 font-medium tabular-nums"><bdi dir="ltr">{{ line.amount }}</bdi></td>
          </tr>
        </tbody>
      </table>
    </div>
    <ul v-else class="divide-y divide-default rounded-lg ring ring-default" :aria-label="t('states.invoice.lines')">
      <li v-for="line in props.lines" :key="line.id" class="flex items-center justify-between gap-3 p-3" data-testid="invoice-line">
        <span class="min-w-0">
          {{ line.description }}
          <StatusBadge v-if="line.kind" class="ms-2" :tone="line.kind.tone" :label="line.kind.label" />
          <span v-if="line.cells.length" class="ms-2 text-xs text-muted tabular-nums">
            <template v-for="(cell, index) in line.cells" :key="cell.key"><template v-if="index"> · </template><span class="sr-only">{{ cell.label }} </span><bdi dir="ltr">{{ cell.value }}</bdi></template>
          </span>
        </span>
        <span class="font-medium tabular-nums"><bdi dir="ltr">{{ line.amount }}</bdi></span>
      </li>
    </ul>
    <dl v-if="props.totals?.length" class="space-y-2 rounded-lg bg-elevated p-3" :aria-label="t('states.invoice.totals')">
      <div v-for="(row, index) in props.totals" :key="row.label" class="flex justify-between gap-3">
        <dt :class="index === props.totals.length - 1 ? 'font-semibold' : 'text-muted'">{{ row.label }}</dt>
        <dd :class="['tabular-nums', index === props.totals.length - 1 && 'font-semibold']"><bdi dir="ltr">{{ row.value }}</bdi></dd>
      </div>
    </dl>
  </div>
</template>
```

The list's free/paid labels were visible words before («مجاني»/«مدفوع» after the numbers); now the label is a screen-reader prefix and the separators stay. If the owner wants the words visible, that is a CP4 note, not a change here.

Run `npx vitest run app/components/shared/__tests__/InvoiceLines.test.ts`; expected PASS. If the `StatusBadge` sibling load needs `@/utils/statusTone`, it is already in `modules`.

- [ ] **Step 3: Callers, story, cleanup**

In `apps/web/app/pages/subscription/invoices/[id].vue:15`, replace `<SubscriptionInvoiceLines v-if="data" :invoice="data" />` with `<SharedInvoiceLines v-if="view" layout="list" v-bind="view" />` and add to its script:

```ts
import { subscriptionInvoiceView } from '@/utils/subscription'
const { t, locale } = useI18n()   // reuse the existing call if the page already has one
const view = computed(() => data.value ? subscriptionInvoiceView(data.value, t, locale.value) : null)
```

In `apps/web/app/pages/vendor/invoices/[id].vue:39`, replace `<VendorInvoiceLines :lines="data.lines" />` with `<SharedInvoiceLines :lines="vendorInvoiceLineViews(data.lines, t, locale)" />`, importing `vendorInvoiceLineViews` from `@/utils/vendorSubscriptions` and taking `locale` from the page's `useI18n()`.

Delete the two old components and their stories. Update the tests: in `commercial-customers.test.ts:40` replace `'VendorInvoiceLines'` with `'SharedInvoiceLines'`; in `subscriptionJourney.test.ts:56` replace `read('app/components/subscription/InvoiceLines.vue')` with `read('app/utils/subscription.ts')` (it still contains `subscription.invoices.notOfficial`).

Create `apps/web/stories/shared/InvoiceLines.stories.ts`:

```ts
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { useI18n } from 'vue-i18n'
import InvoiceLines from '../../app/components/shared/InvoiceLines.vue'
import { subscriptionInvoiceView } from '../../app/utils/subscription'
import { vendorInvoiceLineViews } from '../../app/utils/vendorSubscriptions'
import { invoice as customerInvoice } from '../subscription/fixtures'
import { invoice as vendorInvoice } from '../vendor/subscriptionFixtures'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/InvoiceLines',
  component: InvoiceLines,
  parameters: { layout: 'padded', a11y: { test: 'error' } },
  args: { lines: [] },
} satisfies Meta<typeof InvoiceLines>
export default meta
type Story = StoryObj<typeof meta>

export const CustomerList: Story = {
  name: 'فاتورة العميل (قائمة وإجماليات)',
  parameters: storyContext('apps/web/app/pages/subscription/invoices/[id].vue:15'),
  render: () => ({
    components: { InvoiceLines },
    setup() {
      const { t, locale } = useI18n()
      return { view: subscriptionInvoiceView(customerInvoice, t, locale.value) }
    },
    template: '<div class="max-w-2xl"><InvoiceLines layout="list" v-bind="view" /></div>',
  }),
}
export const VendorTable: Story = {
  name: 'فاتورة المورّد (جدول)',
  parameters: storyContext('apps/web/app/pages/vendor/invoices/[id].vue:39'),
  render: () => ({
    components: { InvoiceLines },
    setup() {
      const { t, locale } = useI18n()
      return { lines: vendorInvoiceLineViews(vendorInvoice.lines, t, locale.value) }
    },
    template: '<UCard class="max-w-4xl"><InvoiceLines :lines="lines" /></UCard>',
  }),
}
```

Apply the `tools/ui_policy.py`, `visualStories.ts` and `components.md` edits listed under **Files**; the new row:

```markdown
| `apps/web/app/components/shared/InvoiceLines.vue` | `apps/web/stories/shared/InvoiceLines.stories.ts` | جدول أو قائمة لبنود الفاتورة مع إشعار وإجماليات اختيارية؛ `SharedStatusBadge` لنوع البند؛ المبالغ ينسّقها المستدعي (`subscriptionInvoiceView`، `vendorInvoiceLineViews`) |
```

- [ ] **Step 4: Run and commit**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim
rg -n "SubscriptionInvoiceLines|VendorInvoiceLines|subscription/InvoiceLines|vendor/InvoiceLines" apps/web/app apps/web/stories tools docs/design-system/components.md
python3 -B tools/ui_policy.py --refresh-story-context && node tools/ui_catalog.mjs
npm -w apps/web run lint && npm test 2>&1 | tail -3 && python3 -B tools/ui_policy.py && python3 -B tools/arch_policy.py
cd apps/web && npm run build-storybook >/dev/null
npx playwright test e2e/storybook-visual.spec.ts -g 'shared-invoicelines' --update-snapshots=missing --reporter=line | tail -3
WEBVUE_REQUIRE_STORYBOOK=1 npx playwright test e2e/storybook-visual.spec.ts e2e/storybook-smoke.spec.ts -g 'invoicelines' --reporter=line | tail -3
cd ../.. && git add -A apps/web tools/ui_policy.py docs/design-system
git commit -m "refactor(web): merge the two InvoiceLines into one shared component

Callers build translated, formatted rows (subscriptionInvoiceView,
vendorInvoiceLineViews); each keeps its own paid-quantity rule.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: `rg` prints nothing; all checks pass; 8 `shared-invoicelines--*` PNGs and their axe test pass. `arch_policy` exits 0: `shared/InvoiceLines.vue` imports only `@/utils/invoiceLines` and `./StatusBadge.vue`.

---

### Task 5: `RouteTabs` for the project tabs, and `SettingsPage` moves to `shared/`

Two small, mechanical moves into `shared/`.

**Files:**
- Create: `apps/web/app/components/shared/RouteTabs.vue`, `apps/web/app/components/shared/__tests__/RouteTabs.test.ts`, `apps/web/stories/shared/RouteTabs.stories.ts`
- Modify: `apps/web/app/components/project/workspace/ProjectWorkspaceTabs.vue:25-46`, `apps/web/app/components/project/workspace/ProjectGovernanceTabs.vue:14-34`
- Move: `apps/web/app/components/settings/SettingsLayout.vue` → `apps/web/app/components/shared/SettingsPage.vue` (`git mv`, content unchanged); `apps/web/stories/settings/SettingsLayout.stories.ts` → `apps/web/stories/shared/SettingsPage.stories.ts`
- Modify (mechanical `<SettingsLayout` → `<SharedSettingsPage`, `</SettingsLayout>` → `</SharedSettingsPage>`): the 19 pages `pages/projects/settings.vue`, `pages/projects/settings/catalogs/[resource]/[referenceId]/edit.vue`, `pages/projects/settings/catalogs/[resource]/index.vue`, `pages/settings/access-log/[eventId].vue`, `pages/settings/access-log/index.vue`, `pages/settings/branding.vue`, `pages/settings/roles/[roleId]/edit.vue`, `pages/settings/roles/[roleId]/index.vue`, `pages/settings/roles/index.vue`, `pages/settings/users/[userId]/access.vue`, `pages/settings/users/[userId]/index.vue`, `pages/settings/users/[userId]/security.vue`, `pages/settings/users/index.vue`, `pages/subscription/branches.vue`, `pages/subscription/change.vue`, `pages/subscription/index.vue`, `pages/subscription/invoices/[id].vue`, `pages/subscription/invoices/index.vue`, `pages/subscription/status.vue`
- Modify stories that import `SettingsLayout`: `apps/web/stories/shared/PageState.stories.ts`, `FormSection.stories.ts`, `UnsavedChanges.stories.ts`, `apps/web/stories/Overview.mdx:12,67`
- Modify: `tools/ui_policy.py` (`STORYBOOK_COMPONENTS`: `'settings/SettingsLayout.vue'` → `'shared/SettingsPage.vue'`, add `'shared/RouteTabs.vue'`; `PAGE_SHELLS:504` `'SettingsLayout'` → `'SharedSettingsPage'`; `STYLE_OWNERS:590` `COMPONENTS + 'settings/SettingsLayout.vue'` → `COMPONENTS + 'shared/SettingsPage.vue'`), `tools/test_ui_policy.py` (any literal `SettingsLayout`)
- Modify: `apps/web/e2e/support/visualStories.ts` (`'shared-routetabs--'` in `VISUAL_STORIES`, `VISUAL_AXE_STORIES` and `VISUAL_MOBILE_STORIES` as `'shared-routetabs--workspace'`; `'shared-settingspage--'` in `VISUAL_STORIES` and `VISUAL_AXE_STORIES`)
- Modify: `docs/design-system/components.md:29` (the «مساحة المشروع» row names RouteTabs), `:61` (the settings row path), rows in the Task 1 section

**Interfaces:**
- Produces (contract):
  - `SharedRouteTabs` props `{ items: { key: string; label: string; to: RouteLocationRaw; active: boolean; icon?: string }[]; ariaLabel: string }`. Renders `<nav :aria-label>` of `UButton` links with `routeTabsStripClass` / `routeTabClass` (`utils/sectionTabs.ts`), `aria-current="page"` and `data-active` on the active item, and `data-testid` = `item.key`. Callers therefore pass `key: \`project-tab-${id}\`` to keep today's test ids. Root attributes (`data-testid`, `class`) fall through.
  - `SharedSettingsPage` props `{ width?: 'list' | 'detail' | 'form' = 'list' }`, `data-testid="settings-layout"` and the global `.webvue-settings-*` style, both unchanged.

- [ ] **Step 1: `RouteTabs` (failing test first)**

Create `apps/web/app/components/shared/__tests__/RouteTabs.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import * as sectionTabs from '../../../utils/sectionTabs'
import { renderShared } from './helpers/renderShared'

const items = [
  { key: 'project-tab-overview', label: 'Overview', to: '/projects/1', active: false, icon: 'i-lucide-house' },
  { key: 'project-tab-tasks', label: 'Tasks', to: '/projects/1/tasks', active: true },
]
const render = (props: Record<string, unknown>, attrs: Record<string, unknown> = {}) =>
  renderShared('RouteTabs', { ...props, ...attrs }, {}, { modules: { '@/utils/sectionTabs': sectionTabs } })

describe('RouteTabs', () => {
  it('renders a named nav of links with the current one marked once', async () => {
    const html = await render({ items, ariaLabel: 'Project sections' })
    expect(html).toMatch(/<nav[^>]*aria-label="Project sections"/)
    expect(html.match(/<a\b/g)).toHaveLength(2)
    expect(html.match(/aria-current="page"/g)).toHaveLength(1)
    expect(html).toMatch(/<a[^>]*href="\/projects\/1\/tasks"[^>]*aria-current="page"|<a[^>]*aria-current="page"[^>]*href="\/projects\/1\/tasks"/)
  })

  it('keeps each item key as its test id and the root attributes', async () => {
    const html = await render({ items, ariaLabel: 'x' }, { 'data-testid': 'project-workspace-tabs' })
    expect(html).toContain('data-testid="project-workspace-tabs"')
    expect(html).toContain('data-testid="project-tab-overview"')
    expect(html).toContain('data-testid="project-tab-tasks"')
  })

  it('renders an icon only when the item has one, and nothing for no items', async () => {
    expect((await render({ items, ariaLabel: 'x' })).match(/i-lucide-house/g)).toHaveLength(1)
    expect(await render({ items: [], ariaLabel: 'x' })).not.toContain('<nav')
  })
})
```

Run it; expected FAIL (`ENOENT … RouteTabs.vue`).

Create `apps/web/app/components/shared/RouteTabs.vue`:

```vue
<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import { routeTabClass, routeTabsStripClass } from '@/utils/sectionTabs'

// Route-backed tabs (DESIGN.md §6): links in a strip with one straight underline under
// the current item. The caller decides which item is active and names each by `key`,
// which is also its test id.
const props = defineProps<{
  items: { key: string; label: string; to: RouteLocationRaw; active: boolean; icon?: string }[]
  ariaLabel: string
}>()
</script>

<template>
  <nav v-if="props.items.length" :class="routeTabsStripClass" :aria-label="props.ariaLabel">
    <UButton
      v-for="item in props.items"
      :key="item.key"
      color="neutral"
      variant="ghost"
      :class="routeTabClass"
      :to="item.to"
      :aria-current="item.active ? 'page' : undefined"
      :data-active="item.active"
      :data-testid="item.key"
    >
      <UIcon v-if="item.icon" :name="item.icon" aria-hidden="true" class="size-4" />
      <span>{{ item.label }}</span>
    </UButton>
  </nav>
</template>
```

Run the test again; expected PASS.

In `ProjectWorkspaceTabs.vue`, remove the `routeTabClass, routeTabsStripClass` import, add

```ts
const items = computed(() => sections.value.map(section => ({
  key: `project-tab-${section.id}`, label: t(section.labelKey), to: section.to, active: current.value === section.id, icon: section.icon,
})))
```

and replace the template with:

```vue
<template>
  <SharedRouteTabs :items="items" :aria-label="t('projects.workspace.tabsLabel')" data-testid="project-workspace-tabs" />
</template>
```

In `ProjectGovernanceTabs.vue`, the same with `key: \`governance-tab-${section.id}\``, `activeGovernanceSection`, `t('projects.workspace.subtabsLabel')` and `data-testid="project-governance-tabs"`. (Today the governance strip renders even with no sections; `governanceSections` always returns its definitions, so the `v-if` in `RouteTabs` changes nothing.)

Create `apps/web/stories/shared/RouteTabs.stories.ts`:

```ts
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import RouteTabs from '../../app/components/shared/RouteTabs.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/RouteTabs',
  component: RouteTabs,
  parameters: { layout: 'padded', a11y: { test: 'error' }, ...storyContext('apps/web/app/components/project/workspace/ProjectWorkspaceTabs.vue:27') },
  args: {
    ariaLabel: 'أقسام المشروع',
    items: [
      { key: 'project-tab-overview', label: 'نظرة عامة', to: '/projects/1', active: false, icon: 'i-lucide-layout-dashboard' },
      { key: 'project-tab-tasks', label: 'المهام', to: '/projects/1/tasks', active: true, icon: 'i-lucide-list-checks' },
      { key: 'project-tab-schedule', label: 'الجدول الزمني', to: '/projects/1/schedule', active: false, icon: 'i-lucide-calendar-range' },
      { key: 'project-tab-governance', label: 'الحوكمة', to: '/projects/1/governance', active: false, icon: 'i-lucide-shield-check' },
      { key: 'project-tab-finance', label: 'المالية', to: '/projects/1/finance', active: false, icon: 'i-lucide-wallet' },
    ],
  },
} satisfies Meta<typeof RouteTabs>
export default meta
type Story = StoryObj<typeof meta>

export const Workspace: Story = { name: 'أقسام المشروع' }
```

(The story's labels are literal sample data, like the `MetricTile` story's; the real labels come from `projects.workspace.*` through the caller.)

Keep `stories/project/ProjectWorkspaceTabs.stories.ts` and `ProjectGovernanceTabs.stories.ts`: those components stay, now as thin callers.

- [ ] **Step 2: `SettingsPage` (mechanical move)**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim
git mv apps/web/app/components/settings/SettingsLayout.vue apps/web/app/components/shared/SettingsPage.vue
git mv apps/web/stories/settings/SettingsLayout.stories.ts apps/web/stories/shared/SettingsPage.stories.ts
rg -l "<SettingsLayout\b" apps/web/app/pages | xargs sed -i '' -e 's/<SettingsLayout\b/<SharedSettingsPage/g' -e 's#</SettingsLayout>#</SharedSettingsPage>#g'
rg -c "SharedSettingsPage" apps/web/app/pages | wc -l
```

Expected: `19`. (BSD `sed` has no `\b`; if the first expression matches nothing, rerun with `-e 's/<SettingsLayout\([ >]\)/<SharedSettingsPage\1/g'`, then repeat the count.)

In `SettingsPage.vue`, change only the comment line inside `<style>` from `/* Settings route navigation belongs to the shell. */` to `/* The settings page shell (moved from settings/SettingsLayout.vue); route navigation belongs to the shell. */`. Class names, `data-testid="settings-layout"` and every rule stay.

In `apps/web/stories/shared/SettingsPage.stories.ts`: import `SettingsPage from '../../app/components/shared/SettingsPage.vue'`, title `'Shared/SettingsPage'`, `component: SettingsPage`, `parameters: { layout: 'fullscreen', a11y: { test: 'error' } }`, and rename `SettingsLayout` to `SettingsPage` in `components` and the template. In `PageState.stories.ts`, `FormSection.stories.ts` and `UnsavedChanges.stories.ts`, change the import to `import SettingsPage from '../../app/components/shared/SettingsPage.vue'` and every `SettingsLayout` identifier and tag to `SettingsPage`. In `Overview.mdx:12`, `import * as SettingsPage from './shared/SettingsPage.stories'`, and `:67` `<Canvas of={SettingsPage.FormPage} />`.

Apply the `tools/ui_policy.py` edits from **Files** and update any `SettingsLayout` literal in `tools/test_ui_policy.py` to the new name (`rg -n SettingsLayout tools`).

Rows for the Task 1 section of `components.md`:

```markdown
| `apps/web/app/components/shared/RouteTabs.vue` | `apps/web/stories/shared/RouteTabs.stories.ts` | `UButton` روابط، `UIcon`؛ `routeTabsStripClass`/`routeTabClass`، و`aria-current="page"` للقسم الحالي |
| `apps/web/app/components/shared/SettingsPage.vue` | `apps/web/stories/shared/SettingsPage.stories.ts` | `SharedPageContainer` وأنماط `.webvue-settings-*` العامة (نُقل من `settings/SettingsLayout.vue`) |
```

and change line 61's `apps/web/app/components/settings/SettingsLayout.vue` (قصة: `apps/web/stories/settings/SettingsLayout.stories.ts`) to the new paths, and line 29's tab row to add `، عبر \`apps/web/app/components/shared/RouteTabs.vue\``.

- [ ] **Step 3: Run**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim
rg -n "SettingsLayout" apps/web/app apps/web/stories tools docs/design-system/components.md DESIGN.md
python3 -B tools/ui_policy.py --refresh-story-context && node tools/ui_catalog.mjs
npm -w apps/web run lint && npm test 2>&1 | tail -3 && python3 -B tools/ui_policy.py && python3 -B tools/arch_policy.py
cd apps/web && npm run build-storybook >/dev/null
npx playwright test e2e/storybook-visual.spec.ts -g 'shared-(routetabs|settingspage)' --update-snapshots=missing --reporter=line | tail -3
WEBVUE_REQUIRE_STORYBOOK=1 npx playwright test e2e/storybook-visual.spec.ts e2e/storybook-smoke.spec.ts --reporter=line 2>&1 | tail -8
```

Expected: `rg` prints only the history note in `SettingsPage.vue`'s style comment (`DESIGN.md` has no mention; Task 15 documents the template). All checks pass; new `shared-routetabs--workspace-*` (4 desktop + 4 mobile) and `shared-settingspage--*` (12) PNGs are written and pass axe; every other baseline, including `shared-pagestate--*`, `shared-formsection--*` and `shared-filterbar--*`, matches without an update (the stories render the same DOM under a new name). Smoke fails only on the known `shared-createpanel--form`.

Then on the mock stack (start it as Task 16 Step 3 does):

```bash
E2E_BASE_URL=http://localhost:4097 npx playwright test e2e/settings-navigation-mocked.spec.ts e2e/settings-layout.spec.ts e2e/project-workspace-continuity.spec.ts e2e/project-popups.spec.ts --reporter=line 2>&1 | tail -8
```

Expected: no failing title outside `.superpowers/tasmim-shared/e2e-cp3-failures.txt` (`settings-layout`, `project-tab-*` and `governance-tab-*` test ids are unchanged). Stop both processes by PID.

- [ ] **Step 4: Commit (two commits: one logical change each)**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim
git add apps/web/app/components/shared/RouteTabs.vue apps/web/app/components/shared/__tests__/RouteTabs.test.ts apps/web/stories/shared/RouteTabs.stories.ts apps/web/app/components/project/workspace
git commit -m "refactor(web): render the project tab strips through RouteTabs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git add -A apps/web tools docs/design-system
git commit -m "refactor(web): move SettingsLayout to shared/SettingsPage

The 19 settings and subscription pages are renamed mechanically; the
settings-layout test id and the global settings styles are kept.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Before the first commit, check that the `RouteTabs` commit alone passes `npm test`: `ui_policy` requires `shared/RouteTabs.vue` in `STORYBOOK_COMPONENTS` and `components.md`. If the policy fails on the partial commit, stage the `RouteTabs` line of `tools/ui_policy.py`, its `visualStories.ts` lines, its `components.md` row and its baselines with the first commit (`git add -p`), and the rest with the second.

### Task 6: `DataTable`, and J / K that skip rows the user cannot see

Plan 3 shipped the J / K contract (`data-shortcut-row` + `useRowNavigation`) with a demo story only. This task hardens it and wires it into the list table. It has two commits:

1. Row navigation hardening. J / K skip hidden and inert rows. The composable gets tests, including clamping at the list ends, `G` then `J` and an open overlay. The one-list-per-page rule is written down.
2. `SharedDataTable`.

Why the hardening comes first: the HR and project lists render a desktop `UTable` (`hidden md:block`) and a mobile list (`md:hidden`) at the same time (`components/hr/DirectoryTable.vue:201` and `:218`, `components/project/ProjectTable.vue:54` and `:97`). `DataTable` does the same. Today `useRowNavigation.ts:18` collects every marked row, so on a phone `J` would focus a `display: none` table row.

UTable facts this task relies on (`node_modules/@nuxt/ui/dist/runtime/components/Table.vue`; Nuxt UI is hoisted to the repository root, and `apps/web/node_modules` is empty):

- **Row attributes are fixed.** `:316-322` renders every body `<tr>` with only `data-selected`, `data-selectable`, `data-expanded`, `data-pinned`, `data-slot="tr"`, and `role="button"` / `tabindex="0"` when `onSelect` is set. Callers style a row only through `meta.class.tr` / `meta.style.tr` (`:327-330`). There is no way to pass `data-shortcut-row`. `DataTable` therefore marks the rendered rows after each mount or update, with the same vnode-hook patch `shell/GlobalSearch.vue:76-87,168-169` uses.
- **No `@select`.** `onSelect` turns the row into `role="button"` (`:321`). A row that also holds a link or checkbox is then a nested interactive control (axe `nested-interactive`, serious). `DataTable` never passes `onSelect`. Instead, mouse clicks on a row background are delegated (see `clickedRowIndex`). The keyboard path is the row's link, which Enter clicks through `useRowNavigation`.
- **Selection.** `defineModel("rowSelection")` (`:135`) holds a `Record<rowId, boolean>`. `getRowId` (`:63`) sets the ids. `DataTable` maps its `selected` keys to and from that record.

**Files:**
- Modify: `apps/web/app/composables/shortcuts/rows.ts` (add `navigableRows`)
- Modify: `apps/web/app/composables/shortcuts/__tests__/rows.test.ts`
- Modify: `apps/web/app/composables/useRowNavigation.ts:1-39`
- Create: `apps/web/app/composables/__tests__/useRowNavigation.test.ts`
- Create: `apps/web/app/utils/dataTable.ts`, `apps/web/app/utils/__tests__/dataTable.test.ts`
- Create: `apps/web/app/components/shared/DataTable.vue`, `apps/web/app/components/shared/__tests__/DataTable.test.ts`
- Create: `apps/web/stories/shared/DataTable.stories.ts`
- Create: `apps/web/e2e/storybook-templates.spec.ts` (Tasks 7–9 append to it)
- Modify: `apps/web/i18n/locales/ar/common.json`, `apps/web/i18n/locales/en/common.json` (`states.*`)
- Modify: `tools/ui_policy.py` (`STORYBOOK_COMPONENTS`), `apps/web/e2e/support/visualStories.ts`, `docs/design-system/components.md`
- Regenerate: `docs/design-system/catalog.json`; 24 new PNGs `shared-datatable--*`

**Interfaces:**
- Consumes:
  - `ROW_SELECTOR` (`composables/shortcuts/keymap.ts:56`), and `rowMove` and `nextRowIndex` (`composables/shortcuts/rows.ts`).
  - `useShellShortcuts(handlers)` (`composables/useShellShortcuts.ts:14`), used in the test only.
  - `SharedPageState` (Task 1 facade: `loading → LoadingSkeleton`, `403/404/other → states`, `empty → EmptyState`) and `SharedPagination` (`{ page; pages; disabled? }`, `update:page`).
  - `SharedFilterBar` (Task 3: one file; its search wrapper carries `data-shortcut-search`).
  - `renderShared` / `SharedRenderOptions` (Task 1, `components/shared/__tests__/helpers/renderShared.ts`).
  - `errorStateKind` (Task 1, `utils/errorState.ts`).
  - `VISUAL_AXE_STORIES` (Task 1).
- Produces in `composables/shortcuts/rows.ts`: `navigableRows<T extends { getClientRects(): { length: number }; closest(selectors: string): unknown }>(rows: readonly T[]): T[]`. It keeps rows that render client rects and are not inside `[inert]` or `[aria-hidden="true"]`, in document order.
- Produces `useRowNavigation(container)`. The signature is unchanged; it now moves only between `navigableRows`.
- Produces in `utils/dataTable.ts`:
  - `type RowKey<T> = keyof T | ((row: T) => string | number)`
  - `dataRowKey<T>(row: T, key: RowKey<T>): string | number` (throws `TypeError` on a non-string, non-number key)
  - `rowSelectionState(selected: readonly (string | number)[]): Record<string, boolean>`
  - `selectedFromRowSelection<T>(state: Record<string, boolean>, rows: readonly T[], key: RowKey<T>, previous: readonly (string | number)[]): (string | number)[]` (keys from other pages are kept)
  - `TABLE_BODY_ROWS = 'tbody > tr[data-slot="tr"]'`
  - `markTableRows(root: ParentNode): void` (sets `data-shortcut-row`, `data-row-index` and, when absent, `tabindex="-1"`)
  - `clickedRowIndex(target: unknown): number | null`
- Produces `SharedDataTable`, with the contract API:
  - props: `{ rows: T[]; columns: TableColumn<T>[]; loading?; error?; emptyText?; rowKey: keyof T | ((row: T) => string | number); rowTo?: (row: T) => RouteLocationRaw; page?; pages?; selectable?; selected?: (string | number)[] }`, plus one additive optional `caption?: string`, an sr-only table caption and the mobile list's `aria-label`;
  - emits: `update:page`, `update:selected`, `retry`;
  - slots: `filters`, `bulk` (`{ selected, clear }`), `mobile-row` (`{ row }`), and `#<column>-cell` passed through to `UTable`.
- Contract details later tasks and Plans 5 and 6 rely on:
  - **Primary link.** With `rowTo`, the first column's cell renders a link to `rowTo(row)`, unless the caller passes that column's `#<column>-cell`; that slot must then render the link itself.
  - **Mouse.** A click on a row's background opens `rowTo(row)`. A click on a link, button, checkbox or menu inside the row does not.
  - **Rows.** Body rows and mobile rows carry `data-shortcut-row`, `data-row-index` and `tabindex="-1"`.
  - **One `DataTable` per page.**
- i18n keys: `states.selectAll`, `states.selectRow`, `states.selectedCount` (`{count}`), `states.clearSelection`, `states.bulkActions`.

- [ ] **Step 1: Failing tests for the visible-row filter and the composable**

Append to `apps/web/app/composables/shortcuts/__tests__/rows.test.ts`. Extend the import on line 3 to `import { navigableRows, nextRowIndex, rowMove } from '../rows'`.

```ts
describe('which rows J and K reach', () => {
  const row = (name: string, patch: { rects?: number; inside?: string } = {}) => ({
    name,
    getClientRects: () => ({ length: patch.rects ?? 1 }),
    closest: (selectors: string) => (patch.inside && selectors.split(',').map(part => part.trim()).includes(patch.inside) ? {} : null),
  })

  it('navigableRows skips hidden and inert rows', () => {
    const rows = [
      row('desktop row under display:none', { rects: 0 }),
      row('a'),
      row('inert', { inside: '[inert]' }),
      row('aria-hidden', { inside: '[aria-hidden="true"]' }),
      row('b'),
    ]
    expect(navigableRows(rows).map(entry => entry.name)).toEqual(['a', 'b'])
  })

  it('returns nothing when every row is hidden', () => {
    expect(navigableRows([row('x', { rects: 0 })])).toEqual([])
  })
})
```

Create `apps/web/app/composables/__tests__/useRowNavigation.test.ts`:

```ts
import * as Vue from 'vue'
import { defineComponent, h, nextTick, ref, type App } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHostNode, hostRenderer, type HostNode } from '../../__tests__/helpers/hostRenderer'
import { useHydrated } from '../useHydrated'
import { useRowNavigation } from '../useRowNavigation'
import { useShellShortcuts } from '../useShellShortcuts'

// The composables reach for Nuxt auto-imports; the real ones are wired here (as useEscapeBack.test.ts does).
const globals = globalThis as Record<string, unknown>
globals.ref = Vue.ref
globals.onMounted = Vue.onMounted
globals.useHydrated = useHydrated
// usePalette keeps its state in Nuxt's useState; one plain ref per key stands in for it.
const states = new Map<string, Vue.Ref<unknown>>()
globals.useState = (key: string, init: () => unknown) => {
  if (!states.has(key)) states.set(key, ref(init()))
  return states.get(key)
}

type Listener = (event: unknown) => void
function eventTarget() {
  const listeners = new Set<Listener>()
  return {
    listeners,
    addEventListener(type: string, listener: Listener) { if (type === 'keydown') listeners.add(listener) },
    removeEventListener(type: string, listener: Listener) { if (type === 'keydown') listeners.delete(listener) },
  }
}
let win: ReturnType<typeof eventTarget>
let doc: ReturnType<typeof eventTarget> & { activeElement: unknown; overlayOpen: boolean; querySelector: (selectors: string) => unknown }

interface FakeKey {
  key: string; code: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean
  repeat: boolean; isComposing: boolean; keyCode: number; timeStamp: number; target: unknown
  defaultPrevented: boolean; preventDefault: () => void
}
function key(name: string, code: string, timeStamp = 0, patch: Partial<FakeKey> = {}): FakeKey {
  const event: FakeKey = {
    key: name, code, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, repeat: false, isComposing: false,
    keyCode: 0, timeStamp, target: { tagName: 'BODY', closest: () => null }, defaultPrevented: false,
    preventDefault() { event.defaultPrevented = true },
    ...patch,
  }
  return event
}
/** A keydown as the browser delivers it: the shell's window capture listener first, then the document. */
function press(event: FakeKey) {
  for (const listener of [...win.listeners]) listener(event)
  for (const listener of [...doc.listeners]) listener(event)
  return event
}

function makeRow(name: string, patch: { visible?: boolean; inert?: boolean } = {}) {
  const row = {
    name,
    visible: patch.visible ?? true,
    inert: patch.inert ?? false,
    link: { click: vi.fn() },
    focus: vi.fn(() => { doc.activeElement = row }),
    scrollIntoView: vi.fn(),
    getClientRects: () => ({ length: row.visible ? 1 : 0 }),
    closest: (selectors: string) => (row.inert && selectors.includes('[inert]') ? {} : null),
    contains: (node: unknown) => node === row,
    querySelector: (selectors: string) => (selectors === 'a[href]' ? row.link : null),
  }
  return row
}
type FakeRow = ReturnType<typeof makeRow>

const apps: App<HostNode>[] = []
async function mount(rows: FakeRow[], options: { shell?: boolean } = {}) {
  const container = ref({ querySelectorAll: () => rows } as unknown as HTMLElement)
  const app = hostRenderer.createApp(defineComponent({
    setup() {
      // ShellHeader's handlers: the go handler always uses the key, even when no item has that letter.
      if (options.shell) useShellShortcuts({ go: () => true })
      useRowNavigation(container)
      return () => h('div')
    },
  }))
  app.mount(createHostNode())
  apps.push(app)
  await nextTick()
}

beforeEach(() => {
  states.clear()
  win = eventTarget()
  doc = Object.assign(eventTarget(), {
    activeElement: { tagName: 'BODY' } as unknown,
    overlayOpen: false,
    querySelector(selectors: string) { return doc.overlayOpen && selectors.includes('data-dismissable-layer') ? {} : null },
  })
  globals.window = win
  globals.document = doc
})
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount()
  delete globals.window
  delete globals.document
})

describe('useRowNavigation', () => {
  it('J and K move focus and clamp at both ends of the list', async () => {
    const [a, b, c] = [makeRow('a'), makeRow('b'), makeRow('c')]
    await mount([a!, b!, c!])
    press(key('j', 'KeyJ'))
    expect(doc.activeElement).toBe(a)
    press(key('j', 'KeyJ'))
    press(key('j', 'KeyJ'))
    expect(doc.activeElement).toBe(c)
    const atEnd = press(key('j', 'KeyJ'))
    expect(doc.activeElement, 'J on the last row stays on it').toBe(c)
    expect(atEnd.defaultPrevented).toBe(true)
    press(key('k', 'KeyK'))
    press(key('k', 'KeyK'))
    press(key('k', 'KeyK'))
    expect(doc.activeElement, 'K on the first row stays on it').toBe(a)
  })

  it('J skips rows the user cannot see or reach', async () => {
    const hidden = makeRow('desktop row on a phone', { visible: false })
    const inert = makeRow('inert', { inert: true })
    const [a, b] = [makeRow('a'), makeRow('b')]
    await mount([hidden, a!, inert, b!])
    press(key('j', 'KeyJ'))
    expect(doc.activeElement).toBe(a)
    press(key('j', 'KeyJ'))
    expect(doc.activeElement).toBe(b)
    expect(hidden.focus).not.toHaveBeenCalled()
    expect(inert.focus).not.toHaveBeenCalled()
  })

  it('G then J does not move: the shell takes the J and the rows skip it', async () => {
    const a = makeRow('a')
    await mount([a, makeRow('b')], { shell: true })
    press(key('g', 'KeyG', 0))
    const j = press(key('j', 'KeyJ', 200))
    expect(j.defaultPrevented, 'the shell used the letter after G').toBe(true)
    expect(a.focus).not.toHaveBeenCalled()
    // Once the chord is over, J moves again.
    press(key('j', 'KeyJ', 5000))
    expect(doc.activeElement).toBe(a)
  })

  it('an open menu or dialog blocks J and K', async () => {
    const a = makeRow('a')
    await mount([a])
    doc.overlayOpen = true
    const j = press(key('j', 'KeyJ'))
    expect(a.focus).not.toHaveBeenCalled()
    expect(j.defaultPrevented).toBe(false)
  })

  it('Enter on a focused row opens its link, but not with a modifier', async () => {
    const a = makeRow('a')
    await mount([a])
    press(key('j', 'KeyJ'))
    press(key('Enter', 'Enter', 0, { metaKey: true }))
    expect(a.link.click).not.toHaveBeenCalled()
    press(key('Enter', 'Enter'))
    expect(a.link.click).toHaveBeenCalledTimes(1)
  })
})
```

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim/apps/web && npx vitest run app/composables/shortcuts/__tests__/rows.test.ts app/composables/__tests__/useRowNavigation.test.ts
```

Expected: FAIL. `rows.test.ts` fails with `navigableRows is not a function`. In `useRowNavigation.test.ts`, "J skips rows the user cannot see or reach" fails: the hidden row is focused first. The other four pass already: they pin behaviour that the next step must keep.

- [ ] **Step 2: Implement the filter and use it**

Append to `apps/web/app/composables/shortcuts/rows.ts`:

```ts
/** A subtree the user cannot reach: an inert region or one hidden from assistive technology. */
const UNREACHABLE_ROW = '[inert], [aria-hidden="true"]'

/**
 * The rows J / K may move between, in document order. A row under `display: none` has no client
 * rects. SharedDataTable renders its desktop table and its mobile list together and hides one with
 * CSS, so this filter is what keeps J on the rows the user can see.
 */
export function navigableRows<T extends { getClientRects(): { length: number }; closest(selectors: string): unknown }>(rows: readonly T[]): T[] {
  return rows.filter(row => row.getClientRects().length > 0 && !row.closest(UNREACHABLE_ROW))
}
```

Replace `apps/web/app/composables/useRowNavigation.ts` with:

```ts
import { useEventListener } from '@vueuse/core'
import type { Ref } from 'vue'
import { ROW_SELECTOR } from './shortcuts/keymap'
import { navigableRows, nextRowIndex, rowMove } from './shortcuts/rows'
import { overlayOwnsEscape } from './useEscapeBack'

/**
 * J / K move focus between the rows `container` marked with `data-shortcut-row` (each focusable)
 * that the user can see and reach, and Enter on a focused row opens its first link. A list opts in
 * by calling this with its container; SharedDataTable wires it, the shell does not. The shell
 * listener runs first (window, capture) and default-prevents a key it used, including the letter
 * after a pending `G`, so this skips it.
 *
 * One list per page: this listens on the document, so two containers on one page would both answer
 * J / K. A page shows one SharedDataTable; any second list on that page is a plain table.
 */
export function useRowNavigation(container: Readonly<Ref<HTMLElement | null>>) {
  const hydrated = useHydrated()
  useEventListener(() => (typeof document === 'undefined' ? null : document), 'keydown', (event: KeyboardEvent) => {
    const root = container.value
    if (!root || event.defaultPrevented) return
    const rows = navigableRows(Array.from(root.querySelectorAll<HTMLElement>(ROW_SELECTOR)))
    const focused = document.activeElement
    const current = rows.findIndex(row => row === focused || (focused !== null && row.contains(focused)))
    const move = rowMove(event, { hydrated: hydrated.value, overlayOpen: overlayOwnsEscape(document) })
    if (move) {
      const next = nextRowIndex(current, rows.length, move)
      if (next < 0) return
      event.preventDefault()
      rows[next]!.focus()
      rows[next]!.scrollIntoView({ block: 'nearest' })
      return
    }
    if (event.key === 'Enter' && !event.repeat && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey
      && current >= 0 && rows[current] === focused) {
      const link = rows[current]!.querySelector<HTMLElement>('a[href]')
      if (link) {
        event.preventDefault()
        link.click()
      }
    }
  })
}
```

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim/apps/web && npx vitest run app/composables/shortcuts/__tests__/rows.test.ts app/composables/__tests__/useRowNavigation.test.ts
```

Expected: PASS, 20 tests in `rows.test.ts` and 5 in `useRowNavigation.test.ts`.

- [ ] **Step 3: Run the row checks and commit the hardening**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim
python3 -B tools/ui_policy.py --refresh-story-context && node tools/ui_catalog.mjs
npm -w apps/web run lint && npm test 2>&1 | tail -3 && python3 -B tools/ui_policy.py
cd apps/web && npm run build-storybook >/dev/null
WEBVUE_REQUIRE_STORYBOOK=1 npx playwright test e2e/storybook-shell.spec.ts -g 'row navigation' --reporter=line | tail -3
```

Expected: everything passes. The Plan 3 demo story test passes unchanged (its rows are all visible).

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim
git add apps/web/app/composables docs/design-system/catalog.json
git commit -m "fix(web): skip hidden and inert rows in J and K navigation

A list that renders a desktop table and a mobile list together hides
one with CSS; J and K now move only between rows the user can see.
Tests pin clamping, G then J, an open overlay and Enter.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Failing tests for the table helpers**

Create `apps/web/app/utils/__tests__/dataTable.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { clickedRowIndex, dataRowKey, markTableRows, rowSelectionState, selectedFromRowSelection, TABLE_BODY_ROWS } from '../dataTable'

interface Row { id: number; code: string; name: string }
const rows: Row[] = [{ id: 1, code: 'a', name: 'One' }, { id: 2, code: 'b', name: 'Two' }, { id: 3, code: 'c', name: 'Three' }]

describe('dataRowKey', () => {
  it('reads a field or calls a function', () => {
    expect(dataRowKey(rows[0]!, 'id')).toBe(1)
    expect(dataRowKey(rows[0]!, row => `p-${row.code}`)).toBe('p-a')
  })

  it('refuses a key that is not a string or a number', () => {
    expect(() => dataRowKey({ id: { nested: true } }, 'id')).toThrow(TypeError)
  })
})

describe('selection mapping', () => {
  it('builds the UTable row selection from the selected keys', () => {
    expect(rowSelectionState([1, 'b'])).toEqual({ 1: true, b: true })
    expect(rowSelectionState([])).toEqual({})
  })

  it('keeps keys from other pages and follows the table for this page, keeping the key type', () => {
    expect(selectedFromRowSelection({ 2: true, 3: true, 1: false }, rows, 'id', [9, 1])).toEqual([9, 2, 3])
    expect(selectedFromRowSelection({}, rows, 'id', [9, 1])).toEqual([9])
  })
})

describe('markTableRows', () => {
  function tr(tabindex?: string) {
    const attributes = new Map<string, string>(tabindex === undefined ? [] : [['tabindex', tabindex]])
    return {
      attributes,
      setAttribute: (name: string, value: string) => attributes.set(name, value),
      hasAttribute: (name: string) => attributes.has(name),
    }
  }

  it('marks every body row for J / K, numbers it, and makes it focusable without stealing a tab stop', () => {
    const plain = tr()
    const focusable = tr('0')
    let asked = ''
    markTableRows({ querySelectorAll: (selectors: string) => { asked = selectors; return [plain, focusable] } } as unknown as ParentNode)
    expect(asked).toBe(TABLE_BODY_ROWS)
    expect(Object.fromEntries(plain.attributes)).toEqual({ 'data-shortcut-row': '', 'data-row-index': '0', tabindex: '-1' })
    expect(focusable.attributes.get('tabindex')).toBe('0')
    expect(focusable.attributes.get('data-row-index')).toBe('1')
  })
})

describe('clickedRowIndex', () => {
  const target = (inside: Record<string, unknown>) => ({
    closest: (selectors: string) => Object.entries(inside).find(([key]) => selectors.split(',').map(part => part.trim()).includes(key))?.[1] ?? null,
  })
  const row = (index: string | null) => ({ getAttribute: (name: string) => (name === 'data-row-index' ? index : null) })

  it('returns the row a background click landed on', () => {
    expect(clickedRowIndex(target({ '[data-shortcut-row]': row('2') }))).toBe(2)
  })

  it('ignores clicks on a control inside the row, outside any row, or on an unnumbered row', () => {
    expect(clickedRowIndex(target({ a: {}, '[data-shortcut-row]': row('2') }))).toBeNull()
    expect(clickedRowIndex(target({ '[role="checkbox"]': {}, '[data-shortcut-row]': row('0') }))).toBeNull()
    expect(clickedRowIndex(target({}))).toBeNull()
    expect(clickedRowIndex(target({ '[data-shortcut-row]': row(null) }))).toBeNull()
    expect(clickedRowIndex(null)).toBeNull()
  })
})
```

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim/apps/web && npx vitest run app/utils/__tests__/dataTable.test.ts
```

Expected: FAIL, `Failed to resolve import "../dataTable"`.

- [ ] **Step 5: Implement the helpers**

Create `apps/web/app/utils/dataTable.ts`:

```ts
// Relative import: this module is unit-tested directly under plain vitest.
import { ROW_SELECTOR } from '../composables/shortcuts/keymap'

/** How SharedDataTable names a row: a field holding its id, or a function of the row. */
export type RowKey<T> = keyof T | ((row: T) => string | number)

export function dataRowKey<T>(row: T, key: RowKey<T>): string | number {
  const value = typeof key === 'function' ? key(row) : row[key]
  if (typeof value === 'string' || typeof value === 'number') return value
  throw new TypeError(`DataTable rowKey must give a string or a number, got ${typeof value}`)
}

/** UTable's row selection (row ids as strings, Table.vue:135) for the selected keys. */
export function rowSelectionState(selected: readonly (string | number)[]): Record<string, boolean> {
  return Object.fromEntries(selected.map(key => [String(key), true]))
}

/**
 * The selected keys after UTable changed its row selection. Keys selected on other pages stay
 * selected; this page's rows follow the table, in row order, with their original key type.
 */
export function selectedFromRowSelection<T>(
  state: Record<string, boolean>,
  rows: readonly T[],
  key: RowKey<T>,
  previous: readonly (string | number)[],
): (string | number)[] {
  const pageKeys = rows.map(row => dataRowKey(row, key))
  const onPage = new Set(pageKeys.map(String))
  return [...previous.filter(selected => !onPage.has(String(selected))), ...pageKeys.filter(pageKey => state[String(pageKey)])]
}

/** UTable's body rows. UTable sets their attributes itself and takes none from the caller (Table.vue:316-322). */
export const TABLE_BODY_ROWS = 'tbody > tr[data-slot="tr"]'

/**
 * Gives UTable's rendered body rows the J / K contract after each render: `data-shortcut-row`, a
 * `data-row-index` for clicks, and `tabindex="-1"`, so a row can take focus without adding a tab stop.
 */
export function markTableRows(root: ParentNode): void {
  Array.from(root.querySelectorAll<HTMLElement>(TABLE_BODY_ROWS)).forEach((row, index) => {
    row.setAttribute('data-shortcut-row', '')
    row.setAttribute('data-row-index', String(index))
    if (!row.hasAttribute('tabindex')) row.setAttribute('tabindex', '-1')
  })
}

/** A control inside a row keeps its own click: a link, a checkbox, a menu, a field. */
const ROW_CONTROL = 'a, button, input, select, textarea, label, [role="checkbox"], [role="combobox"], [role="menuitem"]'

/** The index of the row a background click landed on, or null for a click on a control, outside a row, or on an unnumbered row. */
export function clickedRowIndex(target: unknown): number | null {
  if (!target || typeof (target as { closest?: unknown }).closest !== 'function') return null
  const element = target as Element
  if (element.closest(ROW_CONTROL)) return null
  const raw = element.closest(ROW_SELECTOR)?.getAttribute('data-row-index')
  if (raw === null || raw === undefined) return null
  const index = Number(raw)
  return Number.isInteger(index) && index >= 0 ? index : null
}
```

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim/apps/web && npx vitest run app/utils/__tests__/dataTable.test.ts
```

Expected: PASS (7 tests).

- [ ] **Step 6: Failing component test**

Create `apps/web/app/components/shared/__tests__/DataTable.test.ts`:

```ts
import * as Vue from 'vue'
import { h, type VNode } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import * as dataTable from '../../../utils/dataTable'
import * as errorState from '../../../utils/errorState'
import { renderShared, type SharedRenderOptions } from './helpers/renderShared'

interface Row { id: number; name: string; manager: string }
interface Column { id?: string; accessorKey?: string; header?: string }
const rows: Row[] = [{ id: 1, name: 'Alpha', manager: 'Sara' }, { id: 2, name: 'Portal', manager: 'Omar' }]
const columns: Column[] = [{ accessorKey: 'name', header: 'Name' }, { accessorKey: 'manager', header: 'Manager' }]
const slot = <P>(render: (props: P) => VNode) => render as (...args: unknown[]) => VNode

// UTable stand-in: the cell and header slot API (`<id>-cell` / `<id>-header`) the component relies on.
const TableStub = Vue.defineComponent({
  inheritAttrs: false,
  props: { data: { type: Array, default: () => [] }, columns: { type: Array, default: () => [] }, caption: String },
  setup(props, { slots }) {
    const table = { getIsSomePageRowsSelected: () => false, getIsAllPageRowsSelected: () => false, toggleAllPageRowsSelected: () => {} }
    const id = (column: Column) => column.id ?? column.accessorKey!
    return () => h('table', [
      props.caption ? h('caption', props.caption) : null,
      h('thead', h('tr', (props.columns as Column[]).map(column => h('th', slots[`${id(column)}-header`]?.({ table }) ?? column.header ?? '')))),
      h('tbody', (props.data as Record<string, unknown>[]).map(original => h('tr', { 'data-slot': 'tr' }, (props.columns as Column[]).map(column => {
        const row = { original, getValue: (key: string) => original[key], getIsSelected: () => false, toggleSelected: () => {} }
        return h('td', slots[`${id(column)}-cell`]?.({ row }) ?? String(original[id(column)] ?? ''))
      })))),
    ])
  },
})
const CheckboxStub = Vue.defineComponent({
  inheritAttrs: false,
  props: { modelValue: { type: null, default: false }, disabled: Boolean },
  setup(props, { attrs }) {
    return () => h('button', { role: 'checkbox', 'aria-label': attrs['aria-label'], 'aria-checked': String(props.modelValue), disabled: props.disabled || undefined })
  },
})
const LinkStub = Vue.defineComponent({
  props: { to: { type: [String, Object], required: true } },
  setup(props, { slots }) { return () => h('a', { href: typeof props.to === 'string' ? props.to : '#' }, slots.default?.()) },
})

const options = (patch: SharedRenderOptions = {}): SharedRenderOptions => ({
  modules: {
    '@/composables/useRowNavigation': { useRowNavigation: () => {} },
    '@/utils/dataTable': dataTable,
    '@/utils/errorState': errorState,
  },
  globals: { navigateTo: vi.fn() },
  stubs: { UTable: TableStub, UCheckbox: CheckboxStub, NuxtLink: LinkStub, UPagination: Vue.defineComponent({ setup: () => () => h('nav') }) },
  ...patch,
})
const render = (props: Record<string, unknown>, slots: Record<string, (...args: unknown[]) => VNode> = {}, patch?: SharedRenderOptions) =>
  renderShared('DataTable', { rows, columns, rowKey: 'id', ...props }, slots, options(patch))

describe('SharedDataTable', () => {
  it('renders filters, the table, marked mobile rows and pagination', async () => {
    const html = await render({ page: 1, pages: 3, caption: 'Projects' }, {
      filters: () => h('input', { 'aria-label': 'Search' }),
      'mobile-row': slot<{ row: Row }>(({ row }) => h('span', `mobile:${row.name}`)),
    })
    expect(html).toContain('data-slot="data-table-filters"')
    expect(html).toContain('<caption>Projects</caption>')
    expect(html).toContain('hidden md:block')
    expect(html.match(/<li[^>]*data-shortcut-row[^>]*>/g)).toHaveLength(2)
    expect(html).toMatch(/<li[^>]*data-row-index="1"[^>]*tabindex="-1"/)
    expect(html).toContain('mobile:Portal')
    expect(html).toContain('data-testid="shared-pagination"')
  })

  it('shows the table on every width when there is no mobile row slot', async () => {
    const html = await render({})
    expect(html).not.toContain('hidden md:block')
    expect(html).not.toContain('<li')
  })

  it('links the first column to rowTo unless the caller renders that cell', async () => {
    const linked = await render({ rowTo: (row: Row) => `/projects/${row.id}` })
    expect(linked).toMatch(/<a href="\/projects\/2"[^>]*>Portal<\/a>/)
    const custom = await render({ rowTo: (row: Row) => `/projects/${row.id}` }, {
      'name-cell': slot<{ row: { original: Row } }>(({ row }) => h('strong', `custom:${row.original.name}`)),
    })
    expect(custom).toContain('custom:Portal')
    expect(custom).not.toContain('href="/projects/2"')
  })

  it('shows the bulk bar only while rows are selected', async () => {
    const bulk = { bulk: slot<{ selected: (string | number)[] }>(({ selected }) => h('span', `bulk:${selected.join(',')}`)) }
    const selected = await render({ selectable: true, selected: [2] }, bulk)
    expect(selected).toContain('role="toolbar"')
    expect(selected).toContain('aria-label="states.bulkActions"')
    expect(selected).toContain('states.selectedCount')
    expect(selected).toContain('bulk:2')
    expect(selected).toContain('states.clearSelection')
    expect(await render({ selectable: true, selected: [] }, bulk)).not.toContain('role="toolbar"')
  })

  it('adds a select column whose checkboxes are labelled and wait for hydration', async () => {
    const html = await render({ selectable: true }, {}, { hydrated: false })
    expect(html).toMatch(/<button role="checkbox" aria-label="states.selectAll"[^>]*disabled/)
    expect(html.match(/aria-label="states.selectRow"/g)).toHaveLength(2)
  })

  it('hands loading, errors and empty lists to the shared states and keeps the filters', async () => {
    const filters = { filters: () => h('input', { 'aria-label': 'Search' }) }
    const loading = await render({ loading: true, rows: [] }, filters)
    expect(loading).toContain('data-slot="loading-skeleton"')
    expect(loading).toContain('aria-label="Search"')
    expect(await render({ error: { status: 403 } })).toContain('data-slot="forbidden-state"')
    expect(await render({ rows: [], emptyText: 'No projects yet' })).toContain('No projects yet')
  })
})
```

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim/apps/web && npx vitest run app/components/shared/__tests__/DataTable.test.ts
```

Expected: FAIL, `ENOENT … DataTable.vue`.

- [ ] **Step 7: The component and its strings**

Create `apps/web/app/components/shared/DataTable.vue`:

```vue
<script setup lang="ts" generic="T extends object">
import type { TableColumn } from '@nuxt/ui'
import type { RouteLocationRaw } from 'vue-router'
import { useRowNavigation } from '@/composables/useRowNavigation'
import { clickedRowIndex, dataRowKey, markTableRows, rowSelectionState, selectedFromRowSelection } from '@/utils/dataTable'
import PageState from './PageState.vue'
import Pagination from './Pagination.vue'

/*
 * The list template's table (Tasmim spec §6, template 1): filters, a bulk bar, UTable on wide
 * screens, the caller's mobile rows on phones, the shared states and pagination. Rows follow the
 * J / K contract (data-shortcut-row + useRowNavigation), which reads keys on the document: one
 * DataTable per page.
 */
const props = withDefaults(defineProps<{
  rows: T[]
  columns: TableColumn<T>[]
  loading?: boolean
  error?: unknown
  emptyText?: string
  rowKey: keyof T | ((row: T) => string | number)
  rowTo?: (row: T) => RouteLocationRaw
  page?: number
  pages?: number
  selectable?: boolean
  selected?: (string | number)[]
  /** The table's accessible name (sr-only caption) and the mobile list's label. */
  caption?: string
}>(), {
  loading: false,
  selectable: false,
  selected: () => [],
})
const emit = defineEmits<{ 'update:page': [page: number]; 'update:selected': [keys: (string | number)[]]; retry: [] }>()
const slots = useSlots()
const { t } = useI18n()
const hydrated = useHydrated()
const body = ref<HTMLElement | null>(null)
const tableHost = ref<HTMLElement | null>(null)
useRowNavigation(body)

const tableColumns = computed<TableColumn<T>[]>(() => props.selectable
  ? [{ id: 'select', enableSorting: false, enableHiding: false }, ...props.columns]
  : props.columns)
const rowId = (row: T) => String(dataRowKey(row, props.rowKey))
const rowSelection = computed({
  get: () => rowSelectionState(props.selected),
  set: (state: Record<string, boolean>) => emit('update:selected', selectedFromRowSelection(state, props.rows, props.rowKey, props.selected)),
})
const rowClass = computed(() => [
  'outline-none focus-visible:bg-elevated/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary',
  props.rowTo ? 'cursor-pointer' : '',
].join(' '))

// With rowTo, the first column links to the record, unless the caller renders that cell (it then renders the link).
const primaryColumn = computed(() => {
  const column = props.columns[0] as { id?: string; accessorKey?: string } | undefined
  return column?.id ?? column?.accessorKey
})
const linkSlot = computed(() => props.rowTo && primaryColumn.value && !slots[`${primaryColumn.value}-cell`] ? `${primaryColumn.value}-cell` : null)
function cellSlotNames() {
  return Object.keys(slots).filter(name => name.endsWith('-cell'))
}

// UTable takes no row attributes (Table.vue:316-322), so its rendered rows are marked after each patch.
function markRows() {
  void nextTick(() => { if (tableHost.value) markTableRows(tableHost.value) })
}

function onClick(event: MouseEvent) {
  if (!hydrated.value || !props.rowTo || event.defaultPrevented || event.button !== 0) return
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  const index = clickedRowIndex(event.target)
  const row = index === null ? undefined : props.rows[index]
  if (row) void navigateTo(props.rowTo(row))
}

function clear() {
  emit('update:selected', [])
}
</script>

<template>
  <div data-slot="data-table" class="grid min-w-0 gap-3">
    <div v-if="$slots.filters" data-slot="data-table-filters" class="min-w-0"><slot name="filters" /></div>
    <div
      v-if="props.selectable && props.selected.length > 0 && $slots.bulk"
      role="toolbar"
      data-slot="data-table-bulk"
      :aria-label="t('states.bulkActions')"
      class="flex flex-wrap items-center gap-2 rounded-lg bg-elevated px-3 py-2 ring ring-default"
    >
      <span class="text-sm font-medium text-highlighted tabular-nums">{{ t('states.selectedCount', { count: props.selected.length }) }}</span>
      <slot name="bulk" :selected="props.selected" :clear="clear" />
      <UButton type="button" color="neutral" variant="ghost" size="sm" class="ms-auto" :disabled="!hydrated" @click="clear">{{ t('states.clearSelection') }}</UButton>
    </div>
    <PageState :loading="props.loading" :error="props.error" :empty="props.rows.length === 0" :empty-text="props.emptyText" @retry="emit('retry')">
      <div ref="body" data-slot="data-table-body" class="min-w-0" @click="onClick">
        <div class="overflow-hidden rounded-lg bg-default ring ring-default" :class="{ 'hidden md:block': $slots['mobile-row'] }">
          <div ref="tableHost" class="overflow-x-auto">
            <UTable
              v-model:row-selection="rowSelection"
              :data="props.rows"
              :columns="tableColumns"
              :get-row-id="rowId"
              :caption="props.caption"
              :ui="{ caption: 'sr-only', tr: rowClass }"
              @vue:mounted="markRows"
              @vue:updated="markRows"
            >
              <template v-if="props.selectable" #select-header="{ table }">
                <UCheckbox
                  :model-value="table.getIsSomePageRowsSelected() ? 'indeterminate' : table.getIsAllPageRowsSelected()"
                  :aria-label="t('states.selectAll')"
                  :disabled="!hydrated"
                  @update:model-value="(value: boolean | 'indeterminate') => table.toggleAllPageRowsSelected(value === true)"
                />
              </template>
              <template v-if="props.selectable" #select-cell="{ row }">
                <UCheckbox
                  :model-value="row.getIsSelected()"
                  :aria-label="t('states.selectRow')"
                  :disabled="!hydrated"
                  @update:model-value="(value: boolean | 'indeterminate') => row.toggleSelected(value === true)"
                />
              </template>
              <template v-if="linkSlot" #[linkSlot]="{ row }">
                <NuxtLink
                  :to="props.rowTo!(row.original)"
                  class="rounded font-medium text-highlighted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >{{ row.getValue(primaryColumn!) }}</NuxtLink>
              </template>
              <template v-for="name in cellSlotNames()" :key="name" #[name]="cell">
                <slot :name="name" v-bind="cell" />
              </template>
            </UTable>
          </div>
        </div>
        <ul
          v-if="$slots['mobile-row']"
          class="divide-y divide-default overflow-hidden rounded-lg bg-default ring ring-default md:hidden"
          :aria-label="props.caption"
        >
          <li
            v-for="(row, index) in props.rows"
            :key="rowId(row)"
            data-shortcut-row
            :data-row-index="index"
            tabindex="-1"
            class="p-4 outline-none focus-visible:bg-elevated/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
            :class="{ 'cursor-pointer': props.rowTo }"
          >
            <slot name="mobile-row" :row="row" />
          </li>
        </ul>
      </div>
    </PageState>
    <Pagination
      v-if="props.page !== undefined && props.pages !== undefined"
      :page="props.page"
      :pages="props.pages"
      :disabled="props.loading"
      @update:page="value => emit('update:page', value)"
    />
  </div>
</template>
```

Add to the `states` object in `apps/web/i18n/locales/ar/common.json`, after its last key:

```json
"selectAll": "تحديد كل الصفوف",
"selectRow": "تحديد الصف",
"selectedCount": "المحدد: {count}",
"clearSelection": "إلغاء التحديد",
"bulkActions": "إجراءات على الصفوف المحددة"
```

and to `apps/web/i18n/locales/en/common.json`:

```json
"selectAll": "Select all rows",
"selectRow": "Select row",
"selectedCount": "Selected: {count}",
"clearSelection": "Clear selection",
"bulkActions": "Actions on selected rows"
```

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim/apps/web && npx vitest run app/components/shared/__tests__/DataTable.test.ts app/utils/__tests__/dataTable.test.ts
```

Expected: PASS (6 + 7 tests).

- [ ] **Step 8: Story, policy list, visual lists, catalog row**

Create `apps/web/stories/shared/DataTable.stories.ts`:

```ts
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import type { TableColumn } from '@nuxt/ui'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import DataTable from '../../app/components/shared/DataTable.vue'
import FilterBar from '../../app/components/shared/FilterBar.vue'
import PageContainer from '../../app/components/shared/PageContainer.vue'
import { people, projectRefs } from '../fixtures/pmo'
import { storyContext } from '../support/context'

interface Row { id: number; name: string; manager: string }
const rows: Row[] = projectRefs.map((project, index) => ({ ...project, manager: people[index % people.length]!.name }))

const meta = {
  title: 'Shared/DataTable',
  component: DataTable,
  parameters: {
    layout: 'fullscreen',
    a11y: { test: 'error' },
    ...storyContext('unused', 'قالب القائمة: الفلاتر وشريط التحديد والجدول وصفوف الجوال والحالات والترقيم. J وK تتنقلان بين الصفوف الظاهرة فقط، وEnter يفتح الصف.'),
  },
} satisfies Meta<typeof DataTable>
export default meta
type Story = StoryObj

const table = (state: { rows?: Row[]; loading?: boolean; error?: unknown; selectable?: boolean; selected?: number[] } = {}) => ({
  components: { DataTable, FilterBar, PageContainer },
  setup() {
    const { t } = useI18n()
    const selected = ref<(string | number)[]>(state.selected ?? [])
    const columns = computed<TableColumn<Row>[]>(() => [
      { accessorKey: 'name', header: t('projects.columns.name') },
      { accessorKey: 'manager', header: t('projects.columns.manager') },
    ])
    return { t, columns, selected, rows: state.rows ?? rows, loading: state.loading ?? false, error: state.error, selectable: state.selectable ?? false, rowTo: (row: Row) => `/projects/${row.id}` }
  },
  template: `<main class="webvue-shell-main"><PageContainer width="list">
    <DataTable v-model:selected="selected" :rows="rows" :columns="columns" row-key="id" :row-to="rowTo" :caption="t('projects.title')"
      :loading="loading" :error="error" :selectable="selectable" :page="1" :pages="3" :empty-text="t('projects.empty')">
      <template #filters>
        <FilterBar inline><template #search><UInput icon="i-lucide-search" :placeholder="t('projects.filters.search')" :aria-label="t('projects.filters.search')" /></template></FilterBar>
      </template>
      <template #bulk="{ clear }">
        <UButton color="neutral" variant="outline" size="sm" icon="i-lucide-archive" @click="clear">{{ t('projects.menu.archive') }}</UButton>
      </template>
      <template #mobile-row="{ row }">
        <ULink :to="rowTo(row)" class="font-medium text-highlighted">{{ row.name }}</ULink>
        <p class="mt-1 text-sm text-muted">{{ row.manager }}</p>
      </template>
    </DataTable>
    <p class="sr-only" data-testid="story-route">{{ $route.fullPath }}</p>
  </PageContainer></main>`,
})

export const Default: Story = { name: 'جدول بروابط الصفوف', render: () => table() }
export const Selectable: Story = { name: 'تحديد وشريط إجراءات', render: () => table({ selectable: true, selected: [2] }) }
export const Loading: Story = { name: 'تحميل', render: () => table({ rows: [], loading: true }) }
export const Empty: Story = { name: 'فارغ', render: () => table({ rows: [] }) }
export const ErrorState: Story = { name: 'خطأ', render: () => table({ rows: [], error: { status: 500 } }) }
```

In `tools/ui_policy.py`, in `STORYBOOK_COMPONENTS`, add this line after `'shared/CreatePanel.vue',`:

```python
    'shared/DataTable.vue',
```

In `apps/web/e2e/support/visualStories.ts`, make three edits:

- In `VISUAL_STORIES`, add `'shared-datatable--',` before `'shell-sidebarcreateaction--',`.
- At the end of `VISUAL_AXE_STORIES`, add `'shared-datatable--',`.
- Change `VISUAL_MOBILE_STORIES` to:

```ts
export const VISUAL_MOBILE_STORIES: string[] = ['shell-shellframe--default', 'shell-shellframe--console', 'shell-mobilenavigation--open', 'shared-datatable--default']
```

In `docs/design-system/components.md`, append this row to the end of the table under `## القوالب والحالات — Tasmim الخطة 4` (Task 1 created it):

```markdown
| `apps/web/app/components/shared/DataTable.vue` | `apps/web/stories/shared/DataTable.stories.ts` | `UTable` (تحديد الصفوف عبر `row-selection`)، `UCheckbox`، `UButton`، `NuxtLink`، `SharedPageState`، `SharedPagination`؛ صفوف `data-shortcut-row` مع `useRowNavigation` — جدول واحد في الصفحة |
```

Create `apps/web/e2e/storybook-templates.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test'
import { requireStorybook, startStorybookServer } from './support/storybookServer'

// Behaviour of the Plan 4 page templates in their stories. Screenshots and axe live in storybook-visual.spec.ts.
let base = ''
let close: () => Promise<void> = async () => {}
const open = async (page: Page, id: string, globals = 'locale:ar;appearance:light') => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(`${base}/iframe.html?id=${id}&viewMode=story&globals=${globals}`)
  await page.locator('#storybook-root').waitFor()
}
const route = (page: Page) => page.getByTestId('story-route')

test.describe('Tasmim page templates', () => {
  requireStorybook()
  test.beforeAll(async () => { ({ base, close } = await startStorybookServer()) })
  test.afterAll(async () => { await close() })

  test('J and K move between DataTable rows on desktop, clamp at the ends, and Enter opens the row', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await open(page, 'shared-datatable--default')
    const rows = page.locator('tbody tr[data-shortcut-row]')
    await expect(rows).toHaveCount(3)
    await page.keyboard.press('j')
    await expect(rows.nth(0)).toBeFocused()
    await page.keyboard.press('k')
    await expect(rows.nth(0)).toBeFocused()
    for (let i = 0; i < 4; i++) await page.keyboard.press('j')
    await expect(rows.nth(2)).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(route(page)).toHaveText('/projects/3')
  })

  test('J and K move only between visible DataTable rows on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await open(page, 'shared-datatable--default')
    const items = page.locator('li[data-shortcut-row]')
    await expect(page.locator('tbody tr[data-shortcut-row]')).toHaveCount(3)
    await page.keyboard.press('j')
    await expect(items.nth(0)).toBeFocused()
    await page.keyboard.press('j')
    await expect(items.nth(1)).toBeFocused()
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest('table')))).toBe(false)
    await page.keyboard.press('Enter')
    await expect(route(page)).toHaveText('/projects/2')
  })

  test('a click on a row background opens it; a click on its checkbox only selects it', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await open(page, 'shared-datatable--selectable')
    await expect(page.getByRole('toolbar')).toContainText('1')
    await page.getByRole('checkbox', { name: 'تحديد الصف' }).nth(0).click()
    await expect(page.getByRole('toolbar')).toContainText('2')
    await expect(route(page)).toHaveText('/')
    await page.getByRole('button', { name: 'إلغاء التحديد' }).click()
    await expect(page.getByRole('toolbar')).toHaveCount(0)
    await page.locator('tbody tr[data-shortcut-row]').nth(1).locator('td').last().click()
    await expect(route(page)).toHaveText('/projects/2')
  })
})
```

- [ ] **Step 9: Run, baseline and commit**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim
python3 -B tools/ui_policy.py --refresh-story-context && node tools/ui_catalog.mjs
npm -w apps/web run lint && npm test 2>&1 | tail -3 && python3 -B tools/ui_policy.py && python3 -B tools/arch_policy.py
cd apps/web && npm run build-storybook >/dev/null
npx playwright test e2e/storybook-visual.spec.ts -g 'shared-datatable' --update-snapshots=missing --reporter=line | tail -3
WEBVUE_REQUIRE_STORYBOOK=1 npx playwright test e2e/storybook-visual.spec.ts e2e/storybook-smoke.spec.ts e2e/storybook-templates.spec.ts -g 'shared-datatable|DataTable' --reporter=line | tail -5
git status --short e2e/storybook-visual.spec.ts-snapshots | grep -v 'shared-datatable--' ; echo "unexpected=$?"
```

Expected:

- Lint, `npm test` and both policies pass.
- 24 PNGs are written: 5 stories × 4, plus `shared-datatable--default` × 4 mobile.
- The second run passes:
  - every `shared-datatable` screenshot;
  - the axe test "shared-datatable--… has no serious axe violations" for each story;
  - 5 smoke tests;
  - the 3 template tests.
- The `grep -v` prints nothing (`unexpected=1`).

If axe reports `nested-interactive` or `aria-allowed-role`, check that no `@select` reached `UTable`. Do not drop the story from `VISUAL_AXE_STORIES`.

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim
git add apps/web tools/ui_policy.py docs/design-system
git commit -m "feat(web): add the shared DataTable list template

UTable on wide screens, caller mobile rows on phones, the shared states,
a bulk bar and pagination. Rows are marked for J and K after render,
the first column links to rowTo, and row background clicks open it.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: `ListPage` and `ViewSwitch`, with `?view=` from the route

The list template puts four things in one frame: the heading, the page's own create button, the filters, and a list/board switch. The switch reads and writes the route query `view`, as `/tasks` does today: `pages/tasks.vue:18-26` reads `route.query.view === 'board'`, and choosing the table removes the key. `TaskToolbar.vue:129-137` draws the switch as an icon group with `aria-pressed`. `ViewSwitch` is that group as a shared component. The first option is the default view, so its URL carries no `view`, and `/tasks` and `/tasks?view=board` stay the two URLs.

`C` presses the page's own create button. `ListPage` marks it `data-shortcut-create`, and `clickPageCreate` (`composables/shortcuts/targets.ts:28-33`) clicks the first visible, enabled marked control before the shell falls back to the module's create link. `/` focuses the search that the caller's `SharedFilterBar` wraps in `data-shortcut-search` (Task 3).

**Files:**
- Create: `apps/web/app/utils/listView.ts`, `apps/web/app/utils/__tests__/listView.test.ts`
- Create: `apps/web/app/components/shared/ViewSwitch.vue`, `apps/web/app/components/shared/ListPage.vue`
- Create: `apps/web/app/components/shared/__tests__/ListPage.test.ts`
- Create: `apps/web/stories/shared/ViewSwitch.stories.ts`, `apps/web/stories/shared/ListPage.stories.ts`
- Modify: `apps/web/e2e/storybook-templates.spec.ts` (Task 6) — three tests
- Modify: `apps/web/i18n/locales/{ar,en}/common.json` (`states.view`)
- Modify: `tools/ui_policy.py` (`STORYBOOK_COMPONENTS`), `apps/web/e2e/support/visualStories.ts`, `docs/design-system/components.md`
- Regenerate: `docs/design-system/catalog.json`; 20 new PNGs `shared-listpage--*`, `shared-viewswitch--*`

**Interfaces:**
- Consumes:
  - `SharedPageContainer` (`width`) and `SharedPageHeader` (`title`, `description`, `#actions`).
  - `SharedDataTable` (Task 6) and `SharedFilterBar` (Task 3), in the story only.
  - `CREATE_TARGET` / `SEARCH_TARGET` and `clickPageCreate` (`composables/shortcuts/targets.ts`), through the shell.
  - `renderShared` (Task 1).
- Produces in `utils/listView.ts`:
  - `interface ListViewOption { value: string; label: string; icon: string }`
  - `currentListView(query: unknown, options: readonly Pick<ListViewOption, 'value'>[]): string`: the option the query names, else the first option, else `''`.
  - `listViewQuery(query: LocationQuery, value: string, options: readonly Pick<ListViewOption, 'value'>[]): LocationQueryRaw`: every other key is kept, and `view` is left out for the first option.
- Produces `SharedViewSwitch`:
  - props `{ modelValue: string; options: ListViewOption[] }`, emit `update:modelValue`;
  - a `role="group"` named `states.view`, holding icon-only `UButton`s with `aria-label`, `aria-pressed` and `data-view`, disabled until hydration.
- Produces `SharedListPage`:
  - props `{ title: string; description?: string; createTo?: RouteLocationRaw; createLabel?: string; views?: ListViewOption[] }`;
  - slots `actions`, `filters`, `default`. The default slot receives `{ view }`, the current view value, or `undefined` without `views`. This slot prop is additive to the contract.
  - The create button is `UButton` with `data-shortcut-create`, `aria-keyshortcuts="c"`, `icon="i-lucide-plus"`, label `createLabel ?? $t('app.create')`, disabled until hydration.
  - `ViewSwitch` writes with `router.replace`, so a view change adds no history entry, as `pages/tasks.vue:25` does.
- i18n key: `states.view`.

- [ ] **Step 1: The query helpers (failing test first)**

Create `apps/web/app/utils/__tests__/listView.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { currentListView, listViewQuery } from '../listView'

const views = [{ value: 'table' }, { value: 'board' }]

describe('currentListView', () => {
  it.each([
    ['board', 'board'],
    [undefined, 'table'],
    ['gantt', 'table'],
    [['board', 'table'], 'board'],
    [null, 'table'],
  ] as const)('the query %o shows %s', (query, view) => {
    expect(currentListView(query, views)).toBe(view)
  })

  it('has no view without options', () => {
    expect(currentListView('board', [])).toBe('')
  })
})

describe('listViewQuery', () => {
  it('writes a non-default view and drops the key for the default, keeping every other key', () => {
    expect(listViewQuery({ q: 'alpha', offset: '25' }, 'board', views)).toEqual({ q: 'alpha', offset: '25', view: 'board' })
    expect(listViewQuery({ q: 'alpha', view: 'board' }, 'table', views)).toEqual({ q: 'alpha', view: undefined })
  })
})
```

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim/apps/web && npx vitest run app/utils/__tests__/listView.test.ts
```

Expected: FAIL, `Failed to resolve import "../listView"`.

Create `apps/web/app/utils/listView.ts`:

```ts
import type { LocationQuery, LocationQueryRaw } from 'vue-router'

/** One choice of SharedViewSwitch: the `?view=` value, its translated label and its icon. */
export interface ListViewOption { value: string; label: string; icon: string }

/** The view the route asks for; the first option when the query names none or one this list does not offer. */
export function currentListView(query: unknown, options: readonly Pick<ListViewOption, 'value'>[]): string {
  const asked = Array.isArray(query) ? query[0] : query
  return options.find(option => option.value === asked)?.value ?? options[0]?.value ?? ''
}

/** The query after choosing a view. The first option is the default, so its URL has no `view` key (`/tasks` vs `/tasks?view=board`). */
export function listViewQuery(query: LocationQuery, value: string, options: readonly Pick<ListViewOption, 'value'>[]): LocationQueryRaw {
  return { ...query, view: value === options[0]?.value ? undefined : value }
}
```

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim/apps/web && npx vitest run app/utils/__tests__/listView.test.ts
```

Expected: PASS (7 tests).

- [ ] **Step 2: Failing component tests**

Create `apps/web/app/components/shared/__tests__/ListPage.test.ts`:

```ts
import * as Vue from 'vue'
import { h, type VNode } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import * as listView from '../../../utils/listView'
import * as workspacePresentation from '../../../utils/workspacePresentation'
import { renderShared, type SharedRenderOptions } from './helpers/renderShared'

const views = [
  { value: 'table', label: 'Table view', icon: 'i-lucide-list' },
  { value: 'board', label: 'Board view', icon: 'i-lucide-layout-grid' },
]
const slot = <P>(render: (props: P) => VNode) => render as (...args: unknown[]) => VNode
const TooltipStub = Vue.defineComponent({ setup: (_, { slots }) => () => h('span', slots.default?.()) })

function options(query: Record<string, string> = {}, patch: SharedRenderOptions = {}): SharedRenderOptions {
  return {
    modules: { '@/utils/listView': listView, '@/utils/workspacePresentation': workspacePresentation },
    globals: {
      useRoute: () => ({ path: '/tasks', query }),
      useRouter: () => ({ replace: vi.fn() }),
      usePageHeader: () => undefined,
      useEscapeBack: () => undefined,
      useProjectFrameHeading: () => Vue.ref(false),
    },
    stubs: { UTooltip: TooltipStub },
    ...patch,
  }
}
const showView = { default: slot<{ view?: string }>(({ view }) => h('p', `view:${view}`)) }

describe('SharedListPage', () => {
  it('marks its create button for C and keeps it disabled until hydration', async () => {
    const props = { title: 'Tasks', createTo: '/tasks/new', createLabel: 'Create task' }
    const html = await renderShared('ListPage', props, {}, options())
    expect(html).toContain('<h1')
    expect(html).toMatch(/<a[^>]*data-shortcut-create[^>]*aria-keyshortcuts="c"[^>]*href="\/tasks\/new"[^>]*>Create task<\/a>/)
    expect(html).not.toMatch(/<a[^>]*data-shortcut-create[^>]*disabled/)
    const early = await renderShared('ListPage', props, {}, options({}, { hydrated: false }))
    expect(early).toMatch(/<a[^>]*data-shortcut-create[^>]*disabled/)
  })

  it('renders no create button without createTo, and keeps the caller actions', async () => {
    const html = await renderShared('ListPage', { title: 'Tasks' }, { actions: () => h('button', 'Archived') }, options())
    expect(html).not.toContain('data-shortcut-create')
    expect(html).toContain('Archived')
  })

  it('reads the view from the route query and hands it to the list', async () => {
    const html = await renderShared('ListPage', { title: 'Tasks', views }, showView, options({ view: 'board' }))
    expect(html).toContain('view:board')
    expect(html).toMatch(/<button[^>]*aria-label="Board view"[^>]*aria-pressed="true"/)
    expect(html).toMatch(/<button[^>]*aria-label="Table view"[^>]*aria-pressed="false"/)
  })

  it('falls back to the first view for a query value the list does not offer', async () => {
    expect(await renderShared('ListPage', { title: 'Tasks', views }, showView, options({ view: 'gantt' }))).toContain('view:table')
  })

  it('renders no switch and no view without views', async () => {
    const html = await renderShared('ListPage', { title: 'Tasks' }, showView, options({ view: 'board' }))
    expect(html).toContain('view:undefined')
    expect(html).not.toContain('role="group"')
  })
})

describe('SharedViewSwitch', () => {
  it('labels each icon-only option, marks the current one and waits for hydration', async () => {
    const html = await renderShared('ViewSwitch', { modelValue: 'table', options: views }, {}, { hydrated: false, stubs: { UTooltip: TooltipStub } })
    expect(html).toContain('role="group"')
    expect(html).toContain('aria-label="states.view"')
    expect(html).toMatch(/<button[^>]*aria-label="Table view"[^>]*aria-pressed="true"[^>]*disabled[^>]*data-view="table"/)
    expect(html).toMatch(/<button[^>]*aria-label="Board view"[^>]*aria-pressed="false"[^>]*disabled[^>]*data-view="board"/)
  })
})
```

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim/apps/web && npx vitest run app/components/shared/__tests__/ListPage.test.ts
```

Expected: FAIL, `ENOENT … ListPage.vue`.

- [ ] **Step 3: The two components and the string**

Create `apps/web/app/components/shared/ViewSwitch.vue`:

```vue
<script setup lang="ts">
import type { ListViewOption } from '@/utils/listView'

// The list / board switch (Tasmim spec §6). SharedListPage binds it to the route query `view`.
const props = defineProps<{ modelValue: string; options: ListViewOption[] }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const { t } = useI18n()
const hydrated = useHydrated()
</script>

<template>
  <div role="group" data-slot="view-switch" class="inline-flex items-center gap-0.5 rounded-md bg-elevated/40 p-0.5 ring ring-default" :aria-label="t('states.view')">
    <UTooltip v-for="option in props.options" :key="option.value" :text="option.label">
      <UButton
        type="button"
        color="neutral"
        square
        size="sm"
        :variant="option.value === props.modelValue ? 'soft' : 'ghost'"
        :icon="option.icon"
        :aria-label="option.label"
        :aria-pressed="option.value === props.modelValue"
        :disabled="!hydrated"
        :data-view="option.value"
        @click="emit('update:modelValue', option.value)"
      />
    </UTooltip>
  </div>
</template>
```

Create `apps/web/app/components/shared/ListPage.vue`. Keep the line layout, because `ViewSwitch.stories.ts` cites line 51:

```vue
<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import { currentListView, listViewQuery, type ListViewOption } from '@/utils/listView'
import PageContainer from './PageContainer.vue'
import PageHeader from './PageHeader.vue'
import ViewSwitch from './ViewSwitch.vue'

/*
 * The list template (Tasmim spec §6, template 1): heading, the page's own create button, filters,
 * a view switch bound to the route query `view`, and the list. The create button carries
 * data-shortcut-create, so `C` presses it; the search inside the caller's SharedFilterBar carries
 * data-shortcut-search, so `/` focuses it. On a ListPage, filters go in its #filters slot, not in
 * the DataTable's own.
 */
const props = defineProps<{
  title: string
  description?: string
  createTo?: RouteLocationRaw
  createLabel?: string
  views?: ListViewOption[]
}>()
const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const hydrated = useHydrated()
const view = computed(() => (props.views?.length ? currentListView(route.query.view, props.views) : undefined))

function setView(value: string) {
  if (!props.views?.length || value === view.value) return
  void router.replace({ query: listViewQuery(route.query, value, props.views) })
}
</script>

<template>
  <PageContainer width="list" data-template="list">
    <PageHeader :title="props.title" :description="props.description">
      <template v-if="props.createTo || $slots.actions" #actions>
        <UButton
          v-if="props.createTo"
          :to="props.createTo"
          icon="i-lucide-plus"
          data-shortcut-create
          aria-keyshortcuts="c"
          :disabled="!hydrated"
        >{{ props.createLabel ?? t('app.create') }}</UButton>
        <slot name="actions" />
      </template>
    </PageHeader>
    <div v-if="$slots.filters || view" data-slot="list-page-toolbar" class="flex min-w-0 flex-wrap items-start gap-3">
      <div v-if="$slots.filters" class="min-w-0 flex-1"><slot name="filters" /></div>
      <ViewSwitch v-if="view && props.views" class="ms-auto" :model-value="view" :options="props.views" @update:model-value="setView" />
    </div>
    <slot :view="view" />
  </PageContainer>
</template>
```

Add to the `states` object in `apps/web/i18n/locales/ar/common.json`: `"view": "طريقة العرض"`. Add to the one in `en/common.json`: `"view": "View"`.

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim/apps/web && npx vitest run app/components/shared/__tests__/ListPage.test.ts app/utils/__tests__/listView.test.ts
```

Expected: PASS (6 + 7 tests).

- [ ] **Step 4: Stories, policy list, visual lists, catalog rows**

Create `apps/web/stories/shared/ViewSwitch.stories.ts`:

```ts
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import ViewSwitch from '../../app/components/shared/ViewSwitch.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/ViewSwitch',
  component: ViewSwitch,
  parameters: { layout: 'padded', a11y: { test: 'error' }, ...storyContext('apps/web/app/components/shared/ListPage.vue:51', 'مبدّل القائمة واللوحة؛ تربطه `SharedListPage` بمعامل `?view=` في الرابط.') },
} satisfies Meta<typeof ViewSwitch>
export default meta
type Story = StoryObj

export const Default: Story = {
  name: 'جدول ولوحة',
  render: () => ({
    components: { ViewSwitch },
    setup() {
      const { t } = useI18n()
      const view = ref('table')
      const options = computed(() => [
        { value: 'table', label: t('projects.filters.tableView'), icon: 'i-lucide-list' },
        { value: 'board', label: t('projects.filters.boardView'), icon: 'i-lucide-layout-grid' },
      ])
      return { view, options }
    },
    template: '<ViewSwitch v-model="view" :options="options" />',
  }),
}
```

Create `apps/web/stories/shared/ListPage.stories.ts`:

```ts
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import type { TableColumn } from '@nuxt/ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import AppSidebar from '../../app/components/shell/AppSidebar.vue'
import ShellFrame from '../../app/components/shell/ShellFrame.vue'
import ShellHeader from '../../app/components/shell/ShellHeader.vue'
import DataTable from '../../app/components/shared/DataTable.vue'
import FilterBar from '../../app/components/shared/FilterBar.vue'
import ListPage from '../../app/components/shared/ListPage.vue'
import { __getRouter, useCookie } from '../../.storybook/nuxt-shims'
import { shellHandlers } from '../handlers/shell'
import { people, projectRefs } from '../fixtures/pmo'
import { storyContext } from '../support/context'

interface Row { id: number; name: string; manager: string }
const rows: Row[] = projectRefs.map((project, index) => ({ ...project, manager: people[index % people.length]!.name }))

const meta = {
  title: 'Shared/ListPage',
  component: ListPage,
  parameters: {
    layout: 'fullscreen',
    a11y: { test: 'error' },
    msw: { handlers: { api: shellHandlers } },
    ...storyContext('unused', 'قالب القائمة: العنوان وزر الإنشاء الخاص بالصفحة (`C`) والفلاتر (`/`) ومبدّل العرض المرتبط بـ `?view=`.'),
  },
} satisfies Meta<typeof ListPage>
export default meta
type Story = StoryObj

/** The route a story starts on; loaders run before render. */
const at = (path: string) => async () => {
  await __getRouter()!.replace(path)
  return {}
}

const page = {
  components: { DataTable, FilterBar, ListPage },
  setup() {
    const { t } = useI18n()
    const views = computed(() => [
      { value: 'table', label: t('projects.filters.tableView'), icon: 'i-lucide-list' },
      { value: 'board', label: t('projects.filters.boardView'), icon: 'i-lucide-layout-grid' },
    ])
    const columns = computed<TableColumn<Row>[]>(() => [
      { accessorKey: 'name', header: t('projects.columns.name') },
      { accessorKey: 'manager', header: t('projects.columns.manager') },
    ])
    return { t, views, columns, rows, rowTo: (row: Row) => `/projects/${row.id}`, createTo: { path: '/projects/new', query: { from: 'list-page' } } }
  },
  template: `<ListPage :title="t('projects.title')" :description="t('projects.description')" :create-to="createTo" :create-label="t('nav.newProject')" :views="views">
    <template #actions><UButton color="neutral" variant="outline">{{ t('projects.filters.archived') }}</UButton></template>
    <template #filters>
      <FilterBar inline><template #search><UInput icon="i-lucide-search" :placeholder="t('projects.filters.search')" :aria-label="t('projects.filters.search')" /></template></FilterBar>
    </template>
    <template #default="{ view }">
      <DataTable v-if="view === 'table'" :rows="rows" :columns="columns" row-key="id" :row-to="rowTo" :caption="t('projects.title')">
        <template #mobile-row="{ row }">
          <ULink :to="rowTo(row)" class="font-medium text-highlighted">{{ row.name }}</ULink>
          <p class="mt-1 text-sm text-muted">{{ row.manager }}</p>
        </template>
      </DataTable>
      <ul v-else class="grid gap-3 sm:grid-cols-3" :aria-label="t('projects.filters.boardView')">
        <li v-for="row in rows" :key="row.id" class="rounded-lg bg-default p-4 ring ring-default">
          <p class="font-medium text-highlighted">{{ row.name }}</p>
          <p class="mt-1 text-sm text-muted">{{ row.manager }}</p>
        </li>
      </ul>
    </template>
  </ListPage>
  <p class="sr-only" data-testid="story-route">{{ $route.fullPath }}</p>`,
}

export const Default: Story = {
  name: 'قائمة بجدول',
  loaders: [at('/projects')],
  render: () => ({ components: { Page: page }, template: '<main class="webvue-shell-main"><Page /></main>' }),
}

export const Board: Story = {
  name: 'رابط ?view=board',
  loaders: [at('/projects?view=board')],
  render: () => ({ components: { Page: page }, template: '<main class="webvue-shell-main"><Page /></main>' }),
}

export const InShell: Story = {
  name: 'داخل الإطار (C و /)',
  loaders: [at('/projects')],
  render: () => ({
    components: { AppSidebar, Page: page, ShellFrame, ShellHeader },
    setup: () => { useCookie<'open' | 'closed'>('webvue-context-sidebar').value = 'open' },
    template: `<ShellFrame>
      <template #header><ShellHeader /></template>
      <template #sidebar><AppSidebar /></template>
      <main class="webvue-shell-main" data-testid="shell-main"><Page /></main>
    </ShellFrame>`,
  }),
}
```

In `tools/ui_policy.py`, in `STORYBOOK_COMPONENTS`, extend the line Task 6 added, `'shared/DataTable.vue',`, to:

```python
    'shared/DataTable.vue', 'shared/ListPage.vue', 'shared/ViewSwitch.vue',
```

In `apps/web/e2e/support/visualStories.ts`, make three edits:

- In `VISUAL_STORIES`, add `'shared-listpage--',` and `'shared-viewswitch--',` after `'shared-datatable--',`.
- Append the same two prefixes to `VISUAL_AXE_STORIES`.
- Append `'shared-listpage--default'` to `VISUAL_MOBILE_STORIES`.

In `docs/design-system/components.md`, append to the `## القوالب والحالات — Tasmim الخطة 4` table:

```markdown
| `apps/web/app/components/shared/ListPage.vue` | `apps/web/stories/shared/ListPage.stories.ts` | `SharedPageContainer`، `SharedPageHeader`، `UButton` (زر الإنشاء `data-shortcut-create`)، `SharedViewSwitch` المرتبط بـ `?view=` |
| `apps/web/app/components/shared/ViewSwitch.vue` | `apps/web/stories/shared/ViewSwitch.stories.ts` | `UButton` بأيقونة و`aria-pressed`، `UTooltip`؛ لا يعمل قبل الترطيب |
```

Append inside the `test.describe('Tasmim page templates', …)` block of `apps/web/e2e/storybook-templates.spec.ts`:

```ts
  test('the view switch writes ?view= and the default view leaves no query', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await open(page, 'shared-listpage--default')
    const table = page.getByRole('button', { name: 'عرض الجدول' })
    const board = page.getByRole('button', { name: 'عرض اللوحة' })
    await expect(board).toBeEnabled()
    await expect(table).toHaveAttribute('aria-pressed', 'true')
    await board.click()
    await expect(route(page)).toHaveText('/projects?view=board')
    await expect(board).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('table')).toHaveCount(0)
    await table.click()
    await expect(route(page)).toHaveText('/projects')
    await expect(page.locator('table')).toHaveCount(1)
  })

  test('a ?view=board link opens the board', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await open(page, 'shared-listpage--board')
    await expect(page.getByRole('button', { name: 'عرض اللوحة' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('table')).toHaveCount(0)
  })

  test('C presses the list page create button and / focuses its search', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await open(page, 'shared-listpage--in-shell')
    await expect(page.getByTestId('global-search-trigger')).toBeEnabled()
    await expect(page.locator('[data-shortcut-create]')).toHaveCount(1)
    await page.getByRole('heading', { level: 1 }).click()
    await page.keyboard.press('/')
    await expect(page.locator('[data-shortcut-search] input')).toBeFocused()
    await page.getByRole('heading', { level: 1 }).click()
    await page.keyboard.press('c')
    await expect(route(page)).toHaveText('/projects/new?from=list-page')
  })
```

- [ ] **Step 5: Run, baseline and commit**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim
python3 -B tools/ui_policy.py --refresh-story-context && node tools/ui_catalog.mjs
npm -w apps/web run lint && npm test 2>&1 | tail -3 && python3 -B tools/ui_policy.py && python3 -B tools/arch_policy.py
cd apps/web && npm run build-storybook >/dev/null
npx playwright test e2e/storybook-visual.spec.ts -g 'shared-(listpage|viewswitch)' --update-snapshots=missing --reporter=line | tail -3
WEBVUE_REQUIRE_STORYBOOK=1 npx playwright test e2e/storybook-visual.spec.ts e2e/storybook-smoke.spec.ts e2e/storybook-templates.spec.ts -g 'shared-(listpage|viewswitch)|view switch|view=board|C presses' --reporter=line | tail -5
git status --short e2e/storybook-visual.spec.ts-snapshots | grep -v -E 'shared-(listpage|viewswitch)--' ; echo "unexpected=$?"
```

Expected:

- Lint, `npm test` and both policies pass.
- 20 PNGs are written: `shared-listpage--` 3 stories × 4, plus `shared-listpage--default` × 4 mobile, plus `shared-viewswitch--default` × 4.
- The second run passes every screenshot, 4 axe tests (one per story), 4 smoke tests and the 3 template tests.
- The `grep -v` prints nothing (`unexpected=1`).

If "C presses…" lands on another URL, the shell fell back to the module's create link. That means `clickPageCreate` found no usable `[data-shortcut-create]`. Check that the button is not still disabled; do not change the expected URL.

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim
git add apps/web tools/ui_policy.py docs/design-system
git commit -m "feat(web): add ListPage and a route-driven ViewSwitch

The list template holds the page's own create button (data-shortcut-
create, so C presses it), the filters and a list/board switch that
reads and writes ?view=, with the first view as the bare URL.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: `RecordPage`, `PropertiesPanel`, `PropertyRow` and `RecordSection`

The record template (spec §6, template 2) has a header with a back link and actions, optional tabs (`SharedRouteTabs`, Task 5), a main column of sections and a properties column. On wide screens the properties sit at the inline end. On phones they stack after the main column, so the DOM, reading and focus order stay one order.

Today, record pages build this by hand. `pages/settings/access-log/[eventId].vue:28-34` writes a `<dl>` of `div > dt + dd`. `components/task/TaskDetails.vue:42` uses its own `lg:grid-cols-[11rem_minmax(0,1fr)]` row. Empty values are a bare `—` that a screen reader reads as "dash". `PropertyRow` keeps the visible em dash, hides it from assistive technology and speaks `states.noValue` instead.

`RecordPage` adds an optional `retry` event to the contract. The contract gives it an `error` prop, and `SharedPageState`'s `ErrorState` offers a retry, but without an emit the page could not answer it.

**Files:**
- Create: `apps/web/app/components/shared/RecordPage.vue`, `PropertiesPanel.vue`, `PropertyRow.vue`, `RecordSection.vue`
- Create: `apps/web/app/components/shared/__tests__/RecordPage.test.ts`
- Create: `apps/web/stories/shared/RecordPage.stories.ts`, `PropertiesPanel.stories.ts`, `PropertyRow.stories.ts`, `RecordSection.stories.ts`
- Modify: `apps/web/e2e/storybook-templates.spec.ts` — two tests
- Modify: `apps/web/i18n/locales/{ar,en}/common.json` (`states.noValue`, `states.properties`)
- Modify: `tools/ui_policy.py`, `apps/web/e2e/support/visualStories.ts`, `docs/design-system/components.md`
- Regenerate: `docs/design-system/catalog.json`; 36 new PNGs `shared-{recordpage,propertiespanel,propertyrow,recordsection}--*`

**Interfaces:**
- Consumes:
  - `SharedPageContainer` (`width="detail"`) and `SharedPageHeader` (`title`, `description`, `backTo`, `backLabel`, `#title`, `#actions`).
  - `SharedLoadingSkeleton` (`variant="record"`) and `SharedPageState` (`error` → Forbidden / NotFound / ErrorState, `retry`), both from Task 1.
  - `SharedRouteTabs` (`{ items: { key; label; to; active; icon? }[]; ariaLabel }`, Task 5), in the story only.
  - `renderShared` (Task 1).
- Produces `SharedRecordPage`:
  - props `{ title: string; description?: string; backTo?: RouteLocationRaw; backLabel?: string; loading?: boolean; error?: unknown }`;
  - emits `{ retry: [] }` (additive);
  - slots `actions`, `default` (main), `aside` (properties), `tabs`.
  - While `loading`, it shows `LoadingSkeleton variant="record"`. With an `error`, it shows `PageState`. Actions, tabs and aside are hidden in both cases.
  - An empty `title` while loading renders an `USkeleton` and the sr-only `app.loading` inside the `<h1>`.
  - The aside is an `<aside>` landmark named `states.properties`.
- Produces `SharedPropertiesPanel`: props `{ title?: string }`, default slot, renders `<section aria-labelledby>` with an `<h2>` and a `<dl>`.
- Produces `SharedPropertyRow`:
  - props `{ label: string; value?: string | number | null }`, default slot;
  - renders `div > dt + dd`;
  - `null`, `undefined` and blank strings show `<span aria-hidden="true">—</span><span class="sr-only">{{ $t('states.noValue') }}</span>`; `0` is shown.
- Produces `SharedRecordSection`: props `{ title: string; description?: string; id?: string }`, slots `default`, `actions`; renders `<section :id aria-labelledby>` with an `<h2 id="<id>-title">`.
- i18n keys: `states.noValue`, `states.properties`.

- [ ] **Step 1: Failing tests**

Create `apps/web/app/components/shared/__tests__/RecordPage.test.ts`:

```ts
import * as Vue from 'vue'
import { h } from 'vue'
import { describe, expect, it } from 'vitest'
import * as errorState from '../../../utils/errorState'
import * as workspacePresentation from '../../../utils/workspacePresentation'
import { renderShared, type SharedRenderOptions } from './helpers/renderShared'

const options: SharedRenderOptions = {
  modules: { '@/utils/errorState': errorState, '@/utils/workspacePresentation': workspacePresentation },
  globals: {
    useRoute: () => ({ path: '/projects/1', query: {} }),
    usePageHeader: () => undefined,
    useEscapeBack: () => undefined,
    useProjectFrameHeading: () => Vue.ref(false),
  },
}
// SSR marks slot and fragment boundaries with comments; the assertions read the markup without them.
const clean = (html: string) => html.replace(/<!--[\s\S]*?-->/g, '')
const record = {
  actions: () => h('button', 'Edit'),
  tabs: () => h('nav', { 'aria-label': 'Sections' }, 'TABS'),
  default: () => h('p', 'MAIN'),
  aside: () => h('p', 'PROPERTIES'),
}

describe('SharedRecordPage', () => {
  it('renders the header, tabs, main column and properties aside in reading order', async () => {
    const html = await renderShared('RecordPage', { title: 'Alpha', backTo: '/projects', backLabel: 'Projects' }, record, options)
    expect(clean(html)).toMatch(/<h1[^>]*>Alpha<\/h1>/)
    expect(html).toContain('href="/projects"')
    expect(html).toContain('Edit')
    expect(html).toContain('data-slot="record-tabs"')
    expect(html).toMatch(/<aside[^>]*aria-label="states.properties"/)
    expect(html).toContain('lg:grid-cols-[minmax(0,1fr)_20rem]')
    expect(html.indexOf('TABS')).toBeLessThan(html.indexOf('MAIN'))
    expect(html.indexOf('MAIN')).toBeLessThan(html.indexOf('PROPERTIES'))
  })

  it('gives the main column the full width when there is no aside', async () => {
    const html = await renderShared('RecordPage', { title: 'Alpha' }, { default: () => h('p', 'MAIN') }, options)
    expect(html).not.toContain('<aside')
    expect(html).not.toContain('lg:grid-cols-')
  })

  it('shows the record skeleton while loading, with no actions, tabs or aside, and a heading placeholder', async () => {
    const html = await renderShared('RecordPage', { title: '', loading: true }, record, options)
    expect(html).toContain('data-variant="record"')
    for (const hidden of ['Edit', 'TABS', 'MAIN', 'PROPERTIES']) expect(html).not.toContain(hidden)
    expect(html).toMatch(/<h1[^>]*>.*app\.loading.*<\/h1>/s)
  })

  it('hands errors to the shared states', async () => {
    expect(await renderShared('RecordPage', { title: 'Alpha', error: { status: 404 } }, record, options)).toContain('data-slot="not-found-state"')
    const failed = await renderShared('RecordPage', { title: 'Alpha', error: { status: 500 } }, record, options)
    expect(failed).toContain('data-slot="error-state"')
    expect(failed).not.toContain('MAIN')
  })
})

describe('SharedPropertiesPanel and SharedPropertyRow', () => {
  it('renders a titled description list', async () => {
    const html = await renderShared('PropertiesPanel', { title: 'Properties' }, { default: () => h('div', 'ROW') })
    expect(html).toMatch(/<section[^>]*aria-labelledby="([^"]+)"[^>]*>.*<h2 id="\1"[^>]*>Properties<\/h2>/s)
    expect(html).toMatch(/<dl[^>]*>.*ROW.*<\/dl>/s)
  })

  it('shows the value, keeps zero, and speaks an empty value instead of a dash', async () => {
    expect(clean(await renderShared('PropertyRow', { label: 'Manager', value: 'Sara' }))).toMatch(/<dt[^>]*>Manager<\/dt><dd[^>]*>Sara<\/dd>/)
    expect(clean(await renderShared('PropertyRow', { label: 'Tasks', value: 0 }))).toMatch(/<dd[^>]*>0<\/dd>/)
    for (const value of [null, undefined, '', '  ']) {
      const html = clean(await renderShared('PropertyRow', { label: 'End date', value }))
      expect(html).toContain('<span aria-hidden="true">—</span><span class="sr-only">states.noValue</span>')
    }
  })

  it('lets the default slot replace the value', async () => {
    const html = await renderShared('PropertyRow', { label: 'Status' }, { default: () => h('span', 'On track') })
    expect(html).toContain('On track')
    expect(html).not.toContain('states.noValue')
  })
})

describe('SharedRecordSection', () => {
  it('names the section by its heading and keeps the actions beside it', async () => {
    const html = await renderShared('RecordSection', { title: 'Milestones', description: 'Dates that matter', id: 'milestones' }, {
      default: () => h('p', 'BODY'),
      actions: () => h('button', 'Add'),
    })
    expect(html).toMatch(/<section[^>]*id="milestones"[^>]*aria-labelledby="milestones-title"/)
    expect(html).toMatch(/<h2 id="milestones-title"[^>]*>Milestones<\/h2>/)
    expect(html).toContain('Dates that matter')
    expect(html.indexOf('Add')).toBeLessThan(html.indexOf('BODY'))
  })

  it('makes its own heading id when none is given', async () => {
    const html = await renderShared('RecordSection', { title: 'Notes' })
    const [, id] = html.match(/aria-labelledby="([^"]+)"/) ?? []
    expect(id).toBeTruthy()
    expect(html).toContain(`<h2 id="${id}"`)
  })
})
```

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim/apps/web && npx vitest run app/components/shared/__tests__/RecordPage.test.ts
```

Expected: FAIL, `ENOENT … RecordPage.vue`.

- [ ] **Step 2: The four components and their strings**

Create `apps/web/app/components/shared/RecordPage.vue`:

```vue
<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import LoadingSkeleton from './LoadingSkeleton.vue'
import PageContainer from './PageContainer.vue'
import PageHeader from './PageHeader.vue'
import PageState from './PageState.vue'

/*
 * The record template (Tasmim spec §6, template 2): header with back link and actions, optional
 * tabs, the main column and a properties aside. The aside sits at the inline end on wide screens
 * and after the main column on phones, so reading and focus order stay the DOM order.
 */
const props = defineProps<{
  title: string
  description?: string
  backTo?: RouteLocationRaw
  backLabel?: string
  loading?: boolean
  error?: unknown
}>()
defineEmits<{ retry: [] }>()
const { t } = useI18n()
const ready = computed(() => !props.loading && !props.error)
</script>

<template>
  <PageContainer width="detail" data-template="record">
    <PageHeader :title="props.title" :description="props.description" :back-to="props.backTo" :back-label="props.backLabel">
      <template v-if="props.loading && !props.title" #title>
        <USkeleton class="inline-block h-6 w-48 align-middle" /><span class="sr-only">{{ t('app.loading') }}</span>
      </template>
      <template v-if="ready && $slots.actions" #actions><slot name="actions" /></template>
    </PageHeader>
    <div v-if="ready && $slots.tabs" data-slot="record-tabs"><slot name="tabs" /></div>
    <LoadingSkeleton v-if="props.loading" variant="record" />
    <PageState v-else-if="props.error" :error="props.error" @retry="$emit('retry')" />
    <div v-else data-slot="record-body" class="grid gap-6" :class="{ 'lg:grid-cols-[minmax(0,1fr)_20rem]': $slots.aside }">
      <div data-slot="record-main" class="min-w-0 space-y-6"><slot /></div>
      <aside v-if="$slots.aside" data-slot="record-aside" class="min-w-0 space-y-4 lg:sticky lg:top-4 lg:self-start" :aria-label="t('states.properties')">
        <slot name="aside" />
      </aside>
    </div>
  </PageContainer>
</template>
```

Create `apps/web/app/components/shared/PropertiesPanel.vue`:

```vue
<script setup lang="ts">
// The record's properties (Tasmim spec §6): one description list of SharedPropertyRow.
const props = defineProps<{ title?: string }>()
const headingId = useId()
</script>

<template>
  <section data-slot="properties-panel" class="rounded-lg bg-default px-4 py-3 ring ring-default" :aria-labelledby="props.title ? headingId : undefined">
    <h2 v-if="props.title" :id="headingId" class="text-sm font-semibold text-highlighted">{{ props.title }}</h2>
    <dl class="divide-y divide-default"><slot /></dl>
  </section>
</template>
```

Create `apps/web/app/components/shared/PropertyRow.vue`:

```vue
<script setup lang="ts">
// One property: a term and its value. An empty value keeps the visual dash but is spoken as "no value".
const props = defineProps<{ label: string; value?: string | number | null }>()
const slots = useSlots()
const { t } = useI18n()
const empty = computed(() => !slots.default && (props.value === null || props.value === undefined || String(props.value).trim() === ''))
</script>

<template>
  <div data-slot="property-row" class="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] items-baseline gap-3 py-2.5 text-sm">
    <dt class="text-muted">{{ props.label }}</dt>
    <dd class="min-w-0 break-words text-highlighted"><slot><template v-if="empty"><span aria-hidden="true">—</span><span class="sr-only">{{ t('states.noValue') }}</span></template><template v-else>{{ props.value }}</template></slot></dd>
  </div>
</template>
```

Create `apps/web/app/components/shared/RecordSection.vue`:

```vue
<script setup lang="ts">
// A titled block of a record's main column; `id` makes it a link target (`#milestones`).
const props = defineProps<{ title: string; description?: string; id?: string }>()
const generated = useId()
const headingId = computed(() => `${props.id ?? generated}-title`)
</script>

<template>
  <section :id="props.id" data-slot="record-section" class="space-y-3" :aria-labelledby="headingId">
    <header class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0">
        <h2 :id="headingId" class="text-base font-semibold text-highlighted">{{ props.title }}</h2>
        <p v-if="props.description" class="mt-1 text-sm text-muted">{{ props.description }}</p>
      </div>
      <div v-if="$slots.actions" class="flex shrink-0 flex-wrap items-center gap-2"><slot name="actions" /></div>
    </header>
    <slot />
  </section>
</template>
```

Add to the `states` object in `apps/web/i18n/locales/ar/common.json`:

```json
"noValue": "لا قيمة",
"properties": "الخصائص"
```

and to `en/common.json`:

```json
"noValue": "No value",
"properties": "Properties"
```

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim/apps/web && npx vitest run app/components/shared/__tests__/RecordPage.test.ts
```

Expected: PASS (9 tests).

- [ ] **Step 3: Stories, policy list, visual lists, catalog rows**

Create `apps/web/stories/shared/RecordPage.stories.ts`:

```ts
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import PropertiesPanel from '../../app/components/shared/PropertiesPanel.vue'
import PropertyRow from '../../app/components/shared/PropertyRow.vue'
import RecordPage from '../../app/components/shared/RecordPage.vue'
import RecordSection from '../../app/components/shared/RecordSection.vue'
import RouteTabs from '../../app/components/shared/RouteTabs.vue'
import { project } from '../fixtures/pmo'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/RecordPage',
  component: RecordPage,
  parameters: {
    layout: 'fullscreen',
    a11y: { test: 'error' },
    ...storyContext('unused', 'قالب السجل: الرأس مع الرجوع والإجراءات، والتبويبات، والعمود الرئيسي، وعمود الخصائص في نهاية السطر (وتحت المحتوى على الجوال).'),
  },
} satisfies Meta<typeof RecordPage>
export default meta
type Story = StoryObj

const record = (state: { loading?: boolean; error?: unknown } = {}) => ({
  components: { PropertiesPanel, PropertyRow, RecordPage, RecordSection, RouteTabs },
  setup() {
    const { t } = useI18n()
    const tabs = computed(() => [
      { key: 'overview', label: t('projects.tabs.overview'), to: '/projects/1', active: true },
      { key: 'milestones', label: t('projects.tabs.milestones'), to: '/projects/1/milestones', active: false },
    ])
    return { t, tabs, project, loading: state.loading ?? false, error: state.error }
  },
  template: `<main class="webvue-shell-main">
    <RecordPage :title="loading ? '' : project.name" :description="t('projects.description')" back-to="/projects" :back-label="t('projects.backToProjects')" :loading="loading" :error="error">
      <template #actions><UButton color="neutral" variant="outline" icon="i-lucide-pencil">{{ t('app.edit') }}</UButton></template>
      <template #tabs><RouteTabs :items="tabs" :aria-label="t('projects.title')" /></template>
      <RecordSection id="overview" :title="t('projects.tabs.overview')" :description="t('projects.description')">
        <p class="text-sm text-default">{{ project.name }}</p>
      </RecordSection>
      <RecordSection id="milestones" :title="t('projects.tabs.milestones')">
        <template #actions><UButton color="neutral" variant="ghost" size="sm" icon="i-lucide-plus">{{ t('app.create') }}</UButton></template>
        <p class="text-sm text-muted">{{ t('app.noResults') }}</p>
      </RecordSection>
      <template #aside>
        <PropertiesPanel :title="t('states.properties')">
          <PropertyRow :label="t('projects.columns.manager')" :value="project.manager?.name" />
          <PropertyRow :label="t('projects.columns.status')" :value="t('projects.status.' + project.status)" />
          <PropertyRow :label="t('projects.columns.progress')" :value="project.progress + '%'" />
          <PropertyRow :label="t('projects.columns.dateEnd')" :value="null" />
        </PropertiesPanel>
      </template>
    </RecordPage>
  </main>`,
})

export const Default: Story = { name: 'سجل مع خصائص', render: () => record() }
export const Loading: Story = { name: 'تحميل', render: () => record({ loading: true }) }
export const NotFound: Story = { name: 'غير موجود', render: () => record({ error: { status: 404 } }) }
export const ErrorState: Story = { name: 'خطأ', render: () => record({ error: { status: 500 } }) }
```

Create `apps/web/stories/shared/PropertiesPanel.stories.ts`:

```ts
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { useI18n } from 'vue-i18n'
import PropertiesPanel from '../../app/components/shared/PropertiesPanel.vue'
import PropertyRow from '../../app/components/shared/PropertyRow.vue'
import { project } from '../fixtures/pmo'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/PropertiesPanel',
  component: PropertiesPanel,
  parameters: { layout: 'padded', a11y: { test: 'error' }, ...storyContext('unused', 'عمود خصائص السجل: قائمة وصف واحدة من `SharedPropertyRow`.') },
} satisfies Meta<typeof PropertiesPanel>
export default meta
type Story = StoryObj

export const Default: Story = {
  name: 'خصائص مشروع',
  render: () => ({
    components: { PropertiesPanel, PropertyRow },
    setup: () => ({ t: useI18n().t, project }),
    template: `<div class="max-w-xs"><PropertiesPanel :title="t('states.properties')">
      <PropertyRow :label="t('projects.columns.manager')" :value="project.manager?.name" />
      <PropertyRow :label="t('projects.columns.progress')" :value="project.progress + '%'" />
      <PropertyRow :label="t('projects.columns.dateEnd')" :value="null" />
    </PropertiesPanel></div>`,
  }),
}
```

Create `apps/web/stories/shared/PropertyRow.stories.ts`:

```ts
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { useI18n } from 'vue-i18n'
import PropertyRow from '../../app/components/shared/PropertyRow.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/PropertyRow',
  component: PropertyRow,
  parameters: { layout: 'padded', a11y: { test: 'error' }, ...storyContext('unused', 'خاصية واحدة؛ القيمة الفارغة تُعرض «—» وتُقرأ «لا قيمة».') },
} satisfies Meta<typeof PropertyRow>
export default meta
type Story = StoryObj

const row = (value: string | null) => ({
  components: { PropertyRow },
  setup: () => ({ t: useI18n().t, value }),
  template: `<dl class="max-w-xs"><PropertyRow :label="t('projects.columns.manager')" :value="value" /></dl>`,
})

export const WithValue: Story = { name: 'بقيمة', render: () => row('سارة القحطاني') }
export const Empty: Story = { name: 'فارغة', render: () => row(null) }
```

Create `apps/web/stories/shared/RecordSection.stories.ts`:

```ts
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { useI18n } from 'vue-i18n'
import RecordSection from '../../app/components/shared/RecordSection.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/RecordSection',
  component: RecordSection,
  parameters: { layout: 'padded', a11y: { test: 'error' }, ...storyContext('unused', 'قسم بعنوان في العمود الرئيسي للسجل، مع إجراءاته بجانب العنوان.') },
} satisfies Meta<typeof RecordSection>
export default meta
type Story = StoryObj

export const WithActions: Story = {
  name: 'قسم بإجراء',
  render: () => ({
    components: { RecordSection },
    setup: () => ({ t: useI18n().t }),
    template: `<div class="max-w-2xl"><RecordSection id="milestones" :title="t('projects.tabs.milestones')" :description="t('projects.description')">
      <template #actions><UButton color="neutral" variant="ghost" size="sm" icon="i-lucide-plus">{{ t('app.create') }}</UButton></template>
      <p class="text-sm text-muted">{{ t('app.noResults') }}</p>
    </RecordSection></div>`,
  }),
}
```

In `tools/ui_policy.py`, extend the `STORYBOOK_COMPONENTS` line from Task 7 to:

```python
    'shared/DataTable.vue', 'shared/ListPage.vue', 'shared/ViewSwitch.vue',
    'shared/RecordPage.vue', 'shared/PropertiesPanel.vue', 'shared/PropertyRow.vue', 'shared/RecordSection.vue',
```

In `apps/web/e2e/support/visualStories.ts`, make three edits:

- In `VISUAL_STORIES`, add after `'shared-viewswitch--',`:

```ts
  'shared-recordpage--',
  'shared-propertiespanel--',
  'shared-propertyrow--',
  'shared-recordsection--',
```

- Append the same four prefixes to `VISUAL_AXE_STORIES`.
- Append `'shared-recordpage--default'` to `VISUAL_MOBILE_STORIES`.

In `docs/design-system/components.md`, append to the `## القوالب والحالات — Tasmim الخطة 4` table:

```markdown
| `apps/web/app/components/shared/RecordPage.vue` | `apps/web/stories/shared/RecordPage.stories.ts` | `SharedPageContainer` (`detail`)، `SharedPageHeader`، `SharedLoadingSkeleton` (`record`)، `SharedPageState`، `USkeleton`؛ `<aside>` الخصائص في نهاية السطر |
| `apps/web/app/components/shared/PropertiesPanel.vue` | `apps/web/stories/shared/PropertiesPanel.stories.ts` | `<section>` بعنوان و`<dl>` |
| `apps/web/app/components/shared/PropertyRow.vue` | `apps/web/stories/shared/PropertyRow.stories.ts` | `dt`/`dd`؛ القيمة الفارغة «—» مخفية عن قارئ الشاشة مع `states.noValue` |
| `apps/web/app/components/shared/RecordSection.vue` | `apps/web/stories/shared/RecordSection.stories.ts` | `<section aria-labelledby>` بعنوان `h2` وإجراءات |
```

Append inside the `test.describe('Tasmim page templates', …)` block of `apps/web/e2e/storybook-templates.spec.ts`:

```ts
  test('RecordPage puts the properties at the inline end on desktop and after the main column on mobile', async ({ page }) => {
    for (const [locale, dir] of [['ar', 'rtl'], ['en', 'ltr']] as const) {
      await page.setViewportSize({ width: 1440, height: 900 })
      await open(page, 'shared-recordpage--default', `locale:${locale};appearance:light`)
      const main = (await page.locator('[data-slot="record-main"]').boundingBox())!
      const aside = (await page.getByRole('complementary').boundingBox())!
      if (dir === 'rtl') expect(aside.x + aside.width).toBeLessThanOrEqual(main.x + 1)
      else expect(aside.x).toBeGreaterThanOrEqual(main.x + main.width - 1)
      await page.setViewportSize({ width: 390, height: 844 })
      const stackedMain = (await page.locator('[data-slot="record-main"]').boundingBox())!
      const stackedAside = (await page.getByRole('complementary').boundingBox())!
      expect(stackedAside.y).toBeGreaterThanOrEqual(stackedMain.y + stackedMain.height - 1)
    }
  })

  test('PropertyRow shows a dash for an empty value and names it for screen readers', async ({ page }) => {
    await open(page, 'shared-propertyrow--empty')
    const value = page.locator('dd')
    await expect(value).toHaveText(/—\s*لا قيمة/)
    await expect(value.locator('[aria-hidden="true"]')).toHaveText('—')
  })
```

- [ ] **Step 4: Run, baseline and commit**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim
python3 -B tools/ui_policy.py --refresh-story-context && node tools/ui_catalog.mjs
npm -w apps/web run lint && npm test 2>&1 | tail -3 && python3 -B tools/ui_policy.py && python3 -B tools/arch_policy.py
cd apps/web && npm run build-storybook >/dev/null
npx playwright test e2e/storybook-visual.spec.ts -g 'shared-(recordpage|propertiespanel|propertyrow|recordsection)' --update-snapshots=missing --reporter=line | tail -3
WEBVUE_REQUIRE_STORYBOOK=1 npx playwright test e2e/storybook-visual.spec.ts e2e/storybook-smoke.spec.ts e2e/storybook-templates.spec.ts -g 'shared-(recordpage|propertiespanel|propertyrow|recordsection)|RecordPage|PropertyRow' --reporter=line | tail -5
git status --short e2e/storybook-visual.spec.ts-snapshots | grep -v -E 'shared-(recordpage|propertiespanel|propertyrow|recordsection)--' ; echo "unexpected=$?"
```

Expected:

- Lint, `npm test` and both policies pass.
- 36 PNGs are written: `shared-recordpage--` 4 stories × 4, plus `shared-recordpage--default` × 4 mobile, plus 4 `propertiespanel`, 8 `propertyrow` and 4 `recordsection`.
- The second run passes every screenshot, 8 axe tests (one per story), 8 smoke tests and the 2 template tests.
- The `grep -v` prints nothing (`unexpected=1`).

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim
git add apps/web tools/ui_policy.py docs/design-system
git commit -m "feat(web): add the record template components

RecordPage frames the header, tabs, main column and a properties aside
at the inline end; PropertiesPanel and PropertyRow make one <dl> whose
empty values are spoken; RecordSection names itself by its heading.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The Form template, the `CreatePanel` smoke fix and a named panel dialog

The Form template is made of existing parts: `SharedCreatePanel` (the route-backed `/new` panel), `SharedFormSection` and `SharedUnsavedChanges`. This task adds no component. It does three things:

1. Fixes the known `shared-createpanel--form` smoke failure.
2. Fixes an accessibility defect in the panel that the investigation found.
3. Adds one composed story that shows the three parts working together.

**Cause of the smoke failure (checked 2026-10-13 against the built Storybook).** The story renders. `CreatePanel.vue:30-38` wraps everything in `USlideover`, whose `DialogPortal` teleports to `<body>` (`node_modules/@nuxt/ui/dist/runtime/components/Slideover.vue:73`, `portal` default `true` at `:26`). After render:

- `#storybook-root` holds only `<!---->`;
- the dialog is a direct child of `<body>` with `role="dialog"` and `data-state="open"`;
- no page or console error is raised.

`e2e/storybook-smoke.spec.ts:29` waits for `#storybook-root > *` and finds nothing. The failure snapshot shows the dialog with its heading, fields and buttons fully painted.

**The fix.** The smoke check also accepts an open dialog that is a direct child of `<body>`. This does not weaken the check for any other story:

- each combo is a fresh `page.goto`;
- a story whose root renders an element still matches `#storybook-root > *` first, in document order;
- a story that paints neither a root child nor a dialog still fails.

Giving the story a non-teleported root (`portal: false`) was rejected. It would test a panel the app never renders. Wrapping the panel in a page backdrop was also rejected: the app's `/new` routes render the panel alone.

**The accessibility defect.** The same snapshot lists the dialog with no name (`- dialog:`). Here is why:

- `CreatePanel` overrides `USlideover`'s `#header` slot to render its own `<h1>`;
- that override removes Nuxt UI's `DialogTitle` (`Slideover.vue:106-112`);
- the `VisuallyHidden` fallback title renders only when no `title` prop is given (`:88-89`);
- yet reka still sets `aria-labelledby` to the missing title id (`reka-ui/dist/Dialog/DialogContentImpl.js:84-85`).

reka merges `$attrs` after its own attributes (`:86`). So `CreatePanel` passes `aria-labelledby` (its `<h1>` id) and `aria-describedby` through `USlideover`'s `content` prop. `UnsavedChanges.vue:67` already uses that prop for `UModal`. `reka-ui` cannot be imported directly (`tools/ui_policy.py:208`). The dialog axe pass this task adds (`VISUAL_DIALOG_STORIES`) would otherwise fail on `aria-dialog-name`.

**Files:**
- Modify: `apps/web/e2e/storybook-smoke.spec.ts:26-29`
- Modify: `apps/web/app/components/shared/CreatePanel.vue:13-16,30-44`
- Modify: `apps/web/app/components/shared/__tests__/CreatePanel.test.ts:74-80` (bindings) plus one test
- Modify: `apps/web/stories/shared/CreatePanel.stories.ts` (`a11y.test = 'error'`, new `FormTemplate` story)
- Modify: `apps/web/e2e/support/visualStories.ts` (`VISUAL_DIALOG_STORIES`)
- Modify: `apps/web/e2e/storybook-templates.spec.ts` (Task 6) — three tests
- Regenerate: `docs/design-system/catalog.json`; 8 new PNGs `shared-createpanel--{form,form-template}-*-dialog.png`

**Interfaces:**
- Consumes:
  - `SharedCreatePanel` (`{ title; backTo; description?; width? }`, slots `default` and `footer`);
  - `SharedFormSection` (`{ title?; description?; panel? }`);
  - `SharedUnsavedChanges` (`{ dirty; guardRouteUpdates?; ignoreQueryKeys? }`, dialog `data-testid="unsaved-changes-dialog"`);
  - `VISUAL_DIALOG_STORIES` (`e2e/support/visualStories.ts`).
- Produces:
  - **`SharedCreatePanel`**: its props and slots are unchanged. Its dialog is now named by the `<h1>` and described by the line under it. The `<h1>` keeps its text and level.
  - **The Form template contract.** A `/new` or edit route is a `CreatePanel`. Inside it sits one `UForm` with `UnsavedChanges :dirty` as its first child, then one `FormSection` per group of fields, then the footer actions in the panel's `#footer`. Closing the panel (×, Esc, overlay click) navigates to `backTo`, and the draft guard answers that navigation. Task 15 documents the template from this story.
  - **Smoke rule.** The smoke paint signal is `#storybook-root > *`, or an open `role="dialog"` that is a direct child of `<body>`.

- [ ] **Step 1: Reproduce the smoke failure**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim/apps/web && npm run build-storybook >/dev/null
WEBVUE_REQUIRE_STORYBOOK=1 npx playwright test e2e/storybook-smoke.spec.ts -g 'shared-createpanel--form' --reporter=line | tail -12
```

Expected: FAIL, `locator('#storybook-root').locator(':scope > *').first()` … `element(s) not found`. The error context lists a `dialog` with the heading «مهمة جديدة», two textboxes and the buttons «إلغاء» and «إنشاء».

- [ ] **Step 2: Fix the smoke check**

In `apps/web/e2e/storybook-smoke.spec.ts`, replace lines 26-29:

```ts
        // `toBeEmpty()` checks text content, so icon-only or skeleton-only stories
        // (no visible text, real DOM) would be misreported as empty; a rendered
        // child element is the right signal that the story actually painted.
        await expect(page.locator('#storybook-root').locator(':scope > *').first()).toBeVisible({ timeout: 10_000 })
```

with:

```ts
        // `toBeEmpty()` checks text content, so icon-only or skeleton-only stories
        // (no visible text, real DOM) would be misreported as empty; a rendered
        // child element is the right signal that the story actually painted.
        // A route-backed panel (SharedCreatePanel's USlideover) teleports its dialog
        // to <body>, leaving only a comment in the root; that open dialog is then the
        // painted element. Every other story still needs an element in its root.
        await expect(page.locator('#storybook-root > *, body > [role="dialog"][data-state="open"]').first()).toBeVisible({ timeout: 10_000 })
```

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim/apps/web
WEBVUE_REQUIRE_STORYBOOK=1 npx playwright test e2e/storybook-smoke.spec.ts --reporter=line | tail -3
```

Expected: every smoke test passes, `shared-createpanel--form` included.

- [ ] **Step 3: Failing test for the dialog name**

In `apps/web/app/components/shared/__tests__/CreatePanel.test.ts`, add `useId: Vue.useId,` to `bindings` in `loadCreatePanel()`, on the line `computed: Vue.computed, ref: Vue.ref, watch: Vue.watch,`. Then append inside `describe('SharedCreatePanel', …)`:

```ts
  it('names its dialog by the h1 and describes it by the line under it', async () => {
    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/tasks', component: { template: '<div/>' } },
        { path: '/tasks/new', component: { template: '<div/>' } },
      ],
    })
    await router.push('/tasks/new')
    await router.isReady()

    const CreatePanel = loadCreatePanel()
    let content: Record<string, unknown> | undefined
    const app = renderer.createApp(defineComponent({
      render: () => h(CreatePanel, { title: 'مهمة جديدة', description: 'تُضاف إلى المشروع', backTo: '/tasks' }),
    }))
    app.component('UButton', defineComponent({
      inheritAttrs: false,
      setup(_, { attrs }) { return () => h('button', attrs) },
    }))
    app.component('USlideover', defineComponent({
      inheritAttrs: false,
      props: { open: Boolean, title: String, description: String, side: String, dismissible: Boolean, ui: Object, content: Object },
      emits: ['update:open'],
      setup(props, { slots }) {
        return () => {
          content = props.content as Record<string, unknown> | undefined
          return h('div', { role: 'dialog' }, [slots.header?.({ close: () => undefined }), slots.body?.()])
        }
      },
    }))
    const host = createHostNode()
    app.mount(host)
    mountedApps.push(app)

    const heading = findNode(host, node => node.type === 'h1')
    const description = findNode(host, node => node.type === 'p')
    expect(heading?.props.id).toBeTruthy()
    expect(content?.['aria-labelledby']).toBe(heading!.props.id)
    expect(description?.props.id).toBeTruthy()
    expect(content?.['aria-describedby']).toBe(description!.props.id)
  })
```

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim/apps/web && npx vitest run app/components/shared/__tests__/CreatePanel.test.ts
```

Expected: FAIL in the new test, `expected undefined to be truthy` (the `<h1>` has no id). The two existing tests pass.

- [ ] **Step 4: Name the dialog**

In `apps/web/app/components/shared/CreatePanel.vue`, add a type import after line 2:

```ts
import type { SlideoverProps } from '@nuxt/ui'
```

After `usePageHeader(() => props.title, () => props.description)`, add:

```ts
// The #header slot below replaces USlideover's DialogTitle, so reka's aria-labelledby would point at
// nothing and the dialog would have no name. reka merges these content attributes after its own.
const titleId = useId()
const descriptionId = useId()
const dialogContent = computed<NonNullable<SlideoverProps['content']> & { 'aria-labelledby': string; 'aria-describedby'?: string }>(() => ({
  'aria-labelledby': titleId,
  'aria-describedby': props.description ? descriptionId : undefined,
}))
```

In the template, make three changes:

- add `:content="dialogContent"` to `<USlideover>`, after `dismissible`;
- change `<h1 class="text-highlighted font-semibold text-lg">` to `<h1 :id="titleId" class="text-highlighted font-semibold text-lg">`;
- change `<p v-if="description" class="mt-1 text-muted text-sm">` to `<p v-if="description" :id="descriptionId" class="mt-1 text-muted text-sm">`.

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim/apps/web && npx vitest run app/components/shared/__tests__/CreatePanel.test.ts
```

Expected: PASS (3 tests).

Append inside the `test.describe('Tasmim page templates', …)` block of `apps/web/e2e/storybook-templates.spec.ts`:

```ts
  test('the create panel dialog is named by its heading', async ({ page }) => {
    await open(page, 'shared-createpanel--form')
    await expect(page.getByRole('dialog', { name: 'مهمة جديدة' })).toBeVisible()
  })
```

Add `'shared-createpanel--'` to `VISUAL_DIALOG_STORIES` in `apps/web/e2e/support/visualStories.ts`:

```ts
export const VISUAL_DIALOG_STORIES: string[] = ['shell-globalsearch--palette-', 'shared-createpanel--']
```

In `apps/web/stories/shared/CreatePanel.stories.ts`, change the meta `parameters` to `{ layout: 'fullscreen', a11y: { test: 'error' } }`.

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim
node tools/ui_catalog.mjs
npm -w apps/web run lint && npm test 2>&1 | tail -3 && python3 -B tools/ui_policy.py
cd apps/web && npm run build-storybook >/dev/null
npx playwright test e2e/storybook-visual.spec.ts -g 'shared-createpanel' --update-snapshots=missing --reporter=line | tail -3
WEBVUE_REQUIRE_STORYBOOK=1 npx playwright test e2e/storybook-visual.spec.ts e2e/storybook-smoke.spec.ts e2e/storybook-templates.spec.ts -g 'shared-createpanel|create panel dialog' --reporter=line | tail -5
```

Expected:

- Everything passes.
- 4 `shared-createpanel--form-*-dialog.png` files are written.
- The dialog axe test "shared-createpanel--form dialog has no serious axe violations" passes. If it reports `aria-dialog-name`, the `content` binding is not reaching `DialogContent`: check `Slideover.vue:81` (`v-bind="contentProps"`). If it reports anything else, fix the component; do not drop the story from the list.

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim
git add apps/web docs/design-system/catalog.json
git commit -m "fix(web): name the create panel dialog and fix its smoke check

The header slot replaced USlideover's DialogTitle, leaving the dialog
unnamed; the h1 now labels it. The smoke check accepts an open dialog
teleported to body, which is how shared-createpanel--form paints.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: The composed Form story (failing test first)**

Append inside the `test.describe('Tasmim page templates', …)` block of `apps/web/e2e/storybook-templates.spec.ts`:

```ts
  test('the Form template asks before closing a dirty draft and stays when told to', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await open(page, 'shared-createpanel--form-template')
    const panel = page.getByRole('dialog', { name: 'مهمة جديدة' })
    const name = panel.getByRole('textbox', { name: /عنوان المهمة/ })
    await expect(name).toBeEnabled()
    await name.fill('تقرير الربع')
    await panel.getByRole('button', { name: 'إغلاق' }).click()
    const guard = page.getByTestId('unsaved-changes-dialog')
    await expect(guard).toBeVisible()
    await guard.getByRole('button', { name: 'البقاء في الصفحة' }).click()
    await expect(guard).toBeHidden()
    await expect(panel).toBeVisible()
    await expect(name).toHaveValue('تقرير الربع')
  })

  test('a clean Form template closes without asking', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await open(page, 'shared-createpanel--form-template')
    const panel = page.getByRole('dialog', { name: 'مهمة جديدة' })
    await expect(panel).toBeVisible()
    await panel.getByRole('button', { name: 'إغلاق' }).click()
    await expect(page.getByTestId('unsaved-changes-dialog')).toHaveCount(0)
    await expect(panel).toHaveCount(0)
  })
```

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim/apps/web
WEBVUE_REQUIRE_STORYBOOK=1 npx playwright test e2e/storybook-templates.spec.ts -g 'Form template' --reporter=line | tail -5
```

Expected: FAIL in both tests. No story `shared-createpanel--form-template` exists yet, so the dialog never appears.

Add to `apps/web/stories/shared/CreatePanel.stories.ts`. Replace the import block with:

```ts
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { computed, defineComponent, onMounted, reactive } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import CreatePanel from '../../app/components/shared/CreatePanel.vue'
import FormSection from '../../app/components/shared/FormSection.vue'
import UnsavedChanges from '../../app/components/shared/UnsavedChanges.vue'
import { storyContext } from '../support/context'
```

and append:

```ts
// The Form template (Tasmim spec §6, template 3): the route-backed panel, one UForm whose first child is
// the draft guard, a FormSection per group, the actions in #footer. The panel lives on a route so that
// closing it navigates and SharedUnsavedChanges answers that navigation, as on the app's /new routes.
export const FormTemplate: Story = {
  name: 'قالب النموذج',
  parameters: storyContext('apps/web/app/pages/settings/users/new.vue:102', 'قالب النموذج: لوحة الإنشاء المرتبطة بالمسار، وأقسام النموذج، وحماية المسودة عند الإغلاق.'),
  render: () => ({
    setup() {
      const router = useRouter()
      const { t } = useI18n()
      const Form = defineComponent({
        components: { CreatePanel, FormSection, UnsavedChanges },
        setup() {
          const state = reactive({ name: '', project: '' })
          const dirty = computed(() => Object.values(state).some(value => value.trim() !== ''))
          return { t, state, dirty }
        },
        template: `<CreatePanel :title="t('tasks.new')" back-to="/tasks">
          <UForm :state="state" class="webvue-form grid gap-6">
            <UnsavedChanges :dirty="dirty" />
            <FormSection>
              <UFormField :label="t('tasks.newTitle')" name="name" required>
                <UInput v-model="state.name" class="w-full" />
              </UFormField>
            </FormSection>
            <FormSection :title="t('tasks.detail.sectionOrganization')">
              <UFormField :label="t('tasks.project')" name="project" required>
                <UInput v-model="state.project" class="w-full" />
              </UFormField>
            </FormSection>
          </UForm>
          <template #footer>
            <div class="flex w-full flex-wrap justify-end gap-2">
              <UButton color="neutral" variant="outline" type="button">{{ t('app.cancel') }}</UButton>
              <UButton type="button">{{ t('app.create') }}</UButton>
            </div>
          </template>
        </CreatePanel>`,
      })
      if (router.hasRoute('story-form-template')) router.removeRoute('story-form-template')
      router.addRoute({ name: 'story-form-template', path: '/__story/form-template', component: Form })
      onMounted(() => router.push('/__story/form-template'))
      return {}
    },
    template: '<RouterView />',
  }),
}
```

`VISUAL_DIALOG_STORIES` already holds the `'shared-createpanel--'` prefix, so the new story gets its dialog screenshots and axe pass with no list change.

- [ ] **Step 6: Run, baseline and commit**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim
python3 -B tools/ui_policy.py --refresh-story-context && node tools/ui_catalog.mjs
npm -w apps/web run lint && npm test 2>&1 | tail -3 && python3 -B tools/ui_policy.py && python3 -B tools/arch_policy.py
cd apps/web && npm run build-storybook >/dev/null
npx playwright test e2e/storybook-visual.spec.ts -g 'shared-createpanel--form-template' --update-snapshots=missing --reporter=line | tail -3
WEBVUE_REQUIRE_STORYBOOK=1 npx playwright test e2e/storybook-visual.spec.ts e2e/storybook-smoke.spec.ts e2e/storybook-templates.spec.ts -g 'shared-createpanel|Form template|create panel dialog' --reporter=line | tail -5
WEBVUE_REQUIRE_STORYBOOK=1 npx playwright test e2e/storybook-smoke.spec.ts -g 'shared-unsavedchanges|shared-formsection' --reporter=line | tail -3
git status --short e2e/storybook-visual.spec.ts-snapshots | grep -v 'shared-createpanel--' ; echo "unexpected=$?"
```

Expected:

- Lint, `npm test` and both policies pass.
- 4 `shared-createpanel--form-template-*-dialog.png` files are written.
- The second run passes:
  - 8 dialog screenshots;
  - 2 dialog axe tests;
  - 2 smoke tests;
  - the 4 template tests: the named-dialog test plus the three Form tests.
- The `UnsavedChanges` and `FormSection` smoke tests still pass.
- The `grep -v` prints nothing (`unexpected=1`).

If the dirty-draft test closes the panel without the guard, `UnsavedChanges` is not inside the route component. Its `onBeforeRouteLeave` only runs under the matched `RouterView` record. Keep it inside `Form`; do not weaken the test.

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim
git add apps/web docs/design-system/catalog.json
git commit -m "feat(web): add the composed Form template story

CreatePanel on a route, one UForm with the draft guard first, a
FormSection per group and the actions in the footer. Closing a dirty
draft asks first; closing a clean one leaves.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---


### Task 10: `DashboardPage` and `ChartPanel`

The dashboard template is taken from the two dashboards that exist today. `pages/projects/dashboard.vue:108-182` stacks the page header, a filter bar, `ProjectDashboardMetrics` (`components/project/dashboard/ProjectDashboardMetrics.vue:19`, a `grid gap-3 sm:grid-cols-2 xl:grid-cols-4` of `SharedMetricTile`) and `ProjectDashboardCharts`. The charts sit in a container-query grid (`ProjectDashboardCharts.vue:49-50`, `:136-150`) of `DashboardChartPanel` cards (`DashboardChartPanel.vue:24-38`: `UCard`, `h2` title, description, then a skeleton, the chart, or an empty line). `pages/vendor/overview.vue:20-25` repeats the metric row by hand. `pages/index.vue` only redirects (`:1-8`), so it adds nothing to the template.

`ChartPanel` is the generic card: it draws no chart, and the chart goes in its default slot. `DashboardPage` is page header + metric row + chart grid. The grid uses a Tailwind container query (`@container` / `@min-[768px]:`, as `pages/meetings/calendar.vue:153,175` already does), not a scoped `<style>`, so `STYLE_OWNERS` (`tools/ui_policy.py:589-597`) does not grow. `DashboardChartPanel` and `ProjectDashboardCharts` are not touched; the project dashboard moves onto the template in Plan 5.

**Files:**
- Create: `apps/web/app/components/shared/ChartPanel.vue`, `apps/web/app/components/shared/DashboardPage.vue`
- Create: `apps/web/app/components/shared/__tests__/DashboardPage.test.ts`
- Create: `apps/web/stories/shared/ChartPanel.stories.ts`, `apps/web/stories/shared/DashboardPage.stories.ts`
- Create: `apps/web/e2e/storybook-display-templates.spec.ts` (Tasks 11 and 12 append to it)
- Modify: `apps/web/i18n/locales/ar/common.json`, `apps/web/i18n/locales/en/common.json` (two `states.*` keys)
- Modify: `tools/ui_policy.py` (`STORYBOOK_COMPONENTS`, one line before the closing `))`, today `:57`)
- Modify: `apps/web/e2e/support/visualStories.ts` (`VISUAL_STORIES`, `VISUAL_MOBILE_STORIES`, `VISUAL_AXE_STORIES`)
- Modify: `docs/design-system/components.md` (two rows in the Task 1 section «القوالب والحالات — Tasmim الخطة 4»)
- Regenerate: `docs/design-system/catalog.json`; new PNGs `shared-chartpanel--*`, `shared-dashboardpage--*`

**Interfaces:**
- Consumes: `renderShared` / `SharedRenderOptions` (Task 1, `app/components/shared/__tests__/helpers/renderShared.ts`); the `states.*` namespace (Task 1); `VISUAL_AXE_STORIES` (Task 1); `SharedPageContainer`, `SharedPageHeader` (slot `actions`), `SharedMetricTile`, `SharedDashboardChart` (unchanged).
- Produces:
  - `SharedChartPanel`: props `{ title: string; description?: string; loading?: boolean; empty?: boolean }`, slots `default` (the chart), `actions`. Root is `<section data-template="chart-panel" aria-labelledby=<its h2 id>>`; `aria-busy="true"` while loading. `loading` wins over `empty`. A panel spans both grid columns with `class="@min-[768px]:col-span-2"`.
  - `SharedDashboardPage`: props `{ title: string; description?: string }`, slots `actions`, `metrics`, `default`. Regions: `data-template="dashboard-page"` (root), `"dashboard-metrics"` (a `<section aria-label=states.metrics>`, rendered only with a `metrics` slot), `"dashboard-charts"` (the grid).
  - i18n: `states.metrics`, `states.chartEmpty`.
  - `apps/web/e2e/storybook-display-templates.spec.ts` with the helpers `open(page, id, globals)` and `boxOf(locator)`, which Tasks 11 and 12 reuse.

- [ ] **Step 1: Failing tests**

Create `apps/web/app/components/shared/__tests__/DashboardPage.test.ts`:

```ts
import { defineComponent, h } from 'vue'
import { describe, expect, it } from 'vitest'
import { renderShared } from './helpers/renderShared'

// The page frame components are auto-imported in the app; here they are plain elements
// so the test reads only what DashboardPage itself renders.
const stubs = {
  SharedPageContainer: defineComponent({
    inheritAttrs: false,
    props: { width: String },
    setup(props, { attrs, slots }) { return () => h('div', { ...attrs, 'data-layout-width': props.width }, slots.default?.()) },
  }),
  SharedPageHeader: defineComponent({
    props: { title: String, description: String },
    setup(props, { slots }) {
      return () => h('header', [h('h1', props.title), props.description ? h('p', props.description) : null, slots.actions ? h('div', { 'data-actions': '' }, slots.actions()) : null])
    },
  }),
}
const chart = () => h('svg', { 'data-chart': '' })

describe('SharedChartPanel', () => {
  it('is a section named by its own heading, with the description and the chart', async () => {
    const html = await renderShared('ChartPanel', { title: 'Status', description: 'By state' }, { default: chart })
    const id = html.match(/<h2 id="([^"]+)"/)?.[1]
    expect(id).toBeTruthy()
    expect(html.startsWith('<section')).toBe(true)
    expect(html).toContain(`aria-labelledby="${id}"`)
    expect(html).toContain('data-template="chart-panel"')
    expect(html).toContain('By state')
    expect(html).toContain('data-chart')
    expect(html).not.toContain('aria-busy')
  })

  it('shows a labelled loading placeholder instead of the chart', async () => {
    const html = await renderShared('ChartPanel', { title: 'Status', loading: true }, { default: chart })
    expect(html).toContain('role="status"')
    expect(html).toContain('aria-label="app.loading"')
    expect(html).toContain('aria-busy="true"')
    expect(html).not.toContain('data-chart')
  })

  it('shows one empty line instead of an empty chart, and loading wins over empty', async () => {
    const empty = await renderShared('ChartPanel', { title: 'Status', empty: true }, { default: chart })
    expect(empty).toContain('states.chartEmpty')
    expect(empty).not.toContain('data-chart')
    const both = await renderShared('ChartPanel', { title: 'Status', empty: true, loading: true }, { default: chart })
    expect(both).toContain('role="status"')
    expect(both).not.toContain('states.chartEmpty')
  })

  it('puts actions in the header and draws no actions box without them', async () => {
    const withActions = await renderShared('ChartPanel', { title: 'Finance' }, { default: chart, actions: () => h('select', { 'aria-label': 'Currency' }) })
    expect(withActions.indexOf('aria-label="Currency"')).toBeLessThan(withActions.indexOf('data-chart'))
    const bare = await renderShared('ChartPanel', { title: 'Finance' }, { default: chart })
    expect(bare).not.toContain('data-template="chart-panel-actions"')
  })
})

describe('SharedDashboardPage', () => {
  it('renders header, labelled metric row and chart grid in that order', async () => {
    const html = await renderShared('DashboardPage', { title: 'Projects dashboard', description: 'All projects' }, {
      actions: () => h('button', 'Export'),
      metrics: () => [h('div', { 'data-metric': '' }, '4'), h('div', { 'data-metric': '' }, '2')],
      default: () => h('section', { 'data-chart-panel': '' }),
    }, { stubs })
    expect(html).toContain('data-template="dashboard-page"')
    expect(html).toContain('data-layout-width="list"')
    expect(html).toContain('<h1>Projects dashboard</h1>')
    // Slot content renders inside SSR fragment markers (<!--[-->…<!--]-->).
    expect(html).toMatch(/<div data-actions="">(?:<!--\[-->)?<button>Export<\/button>/)
    expect(html).toContain('aria-label="states.metrics"')
    const order = ['<h1>', 'data-template="dashboard-metrics"', 'data-template="dashboard-charts"', 'data-chart-panel']
    const positions = order.map(marker => html.indexOf(marker))
    expect(positions.every(position => position >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
    expect(html).toContain('@min-[768px]:grid-cols-2')
  })

  it('omits the metric row and the actions when their slots are not given', async () => {
    const html = await renderShared('DashboardPage', { title: 'Overview' }, { default: () => h('section', { 'data-chart-panel': '' }) }, { stubs })
    expect(html).not.toContain('dashboard-metrics')
    expect(html).not.toContain('data-actions')
    expect(html).toContain('data-chart-panel')
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim/apps/web && npx vitest run app/components/shared/__tests__/DashboardPage.test.ts
```

Expected: FAIL, 6 tests, each with `ENOENT: no such file or directory, open '…/components/shared/ChartPanel.vue'` (or `DashboardPage.vue`).

- [ ] **Step 3: The two strings**

In `apps/web/i18n/locales/ar/common.json`, add at the end of the `states` object (after Task 1's `notFoundHint`):

```json
    "metrics": "المؤشرات الرئيسية",
    "chartEmpty": "لا توجد بيانات كافية لرسم هذا المخطط."
```

In `apps/web/i18n/locales/en/common.json`, at the same place:

```json
    "metrics": "Key figures",
    "chartEmpty": "There is not enough data to draw this chart."
```

(Add the comma after the previous last key in each file.)

- [ ] **Step 4: `ChartPanel.vue`**

Create `apps/web/app/components/shared/ChartPanel.vue`:

```vue
<script setup lang="ts">
// One chart on a dashboard (Tasmim Plan 4): a titled card whose body is the chart in
// the default slot, a loading placeholder, or one empty line. It draws no chart itself,
// so SharedDashboardChart or any other figure goes in the slot; `actions` sits at the
// header's inline end (a currency or period select). In SharedDashboardPage a wide
// chart spans both columns with class="@min-[768px]:col-span-2".
const props = withDefaults(defineProps<{
  title: string
  description?: string
  loading?: boolean
  empty?: boolean
}>(), {
  loading: false,
  empty: false,
})
const { t } = useI18n()
const titleId = useId()
</script>

<template>
  <UCard as="section" data-template="chart-panel" class="min-w-0 overflow-hidden" :aria-labelledby="titleId" :aria-busy="props.loading || undefined">
    <template #header>
      <div class="flex w-full flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <h2 :id="titleId" class="text-lg font-semibold leading-6 text-highlighted">{{ props.title }}</h2>
          <p v-if="props.description" class="mt-1 text-sm leading-6 text-muted">{{ props.description }}</p>
        </div>
        <div v-if="$slots.actions" data-template="chart-panel-actions" class="flex shrink-0 items-center gap-2">
          <slot name="actions" />
        </div>
      </div>
    </template>
    <div v-if="props.loading" role="status" :aria-label="t('app.loading')" class="grid min-h-56 place-items-center">
      <USkeleton class="h-44 w-full" />
    </div>
    <p v-else-if="props.empty" class="flex min-h-56 items-center justify-center text-center text-sm text-muted">{{ t('states.chartEmpty') }}</p>
    <div v-else class="min-w-0">
      <slot />
    </div>
  </UCard>
</template>
```

- [ ] **Step 5: `DashboardPage.vue`**

Create `apps/web/app/components/shared/DashboardPage.vue`:

```vue
<script setup lang="ts">
// The dashboard template (Tasmim Plan 4): the page header and its actions, a row of
// SharedMetricTile in `metrics`, then the SharedChartPanel grid. The grid goes two-up
// when its own width reaches 768px: a container query, so a wide context sidebar
// narrows it the way a phone does. Filters, loading and errors stay with the page.
const props = defineProps<{
  title: string
  description?: string
}>()
const { t } = useI18n()
</script>

<template>
  <SharedPageContainer width="list" data-template="dashboard-page">
    <SharedPageHeader :title="props.title" :description="props.description">
      <template v-if="$slots.actions" #actions>
        <slot name="actions" />
      </template>
    </SharedPageHeader>
    <section v-if="$slots.metrics" :aria-label="t('states.metrics')" data-template="dashboard-metrics" class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <slot name="metrics" />
    </section>
    <div class="@container min-w-0">
      <div data-template="dashboard-charts" class="grid min-w-0 gap-5 @min-[768px]:grid-cols-2">
        <slot />
      </div>
    </div>
  </SharedPageContainer>
</template>
```

- [ ] **Step 6: Run the tests to see them pass**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim/apps/web && npx vitest run app/components/shared/__tests__/DashboardPage.test.ts
```

Expected: PASS (6 tests).

- [ ] **Step 7: Stories**

Create `apps/web/stories/shared/ChartPanel.stories.ts`:

```ts
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import ChartPanel from '../../app/components/shared/ChartPanel.vue'
import DashboardChart from '../../app/components/shared/DashboardChart.client.vue'
import { dashboardCharts } from '../fixtures/projectReports'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/ChartPanel',
  component: ChartPanel,
  parameters: {
    layout: 'padded',
    a11y: { test: 'error' },
    ...storyContext('unused', 'بطاقة مخطط واحدة في لوحة: عنوان ووصف وإجراء اختياري، ثم المخطط أو هيكل التحميل أو سطر «لا بيانات». لا ترسم مخططًا بنفسها.'),
  },
  args: { title: '', loading: false, empty: false },
  render: args => ({
    components: { ChartPanel, DashboardChart },
    setup() {
      const { t } = useI18n()
      return { args, t, chart: computed(() => dashboardCharts(t).status) }
    },
    template: `<div class="max-w-xl">
      <ChartPanel v-bind="args" :title="t('projects.dashboard.charts.statusTitle')" :description="t('projects.dashboard.charts.statusDescription')">
        <DashboardChart :chart="chart" variant="pie" :accessible-label="t('projects.dashboard.charts.statusTitle')" />
      </ChartPanel>
    </div>`,
  }),
} satisfies Meta<typeof ChartPanel>
export default meta
type Story = StoryObj<typeof meta>

export const Chart: Story = { name: 'مخطط' }
export const Loading: Story = { name: 'تحميل', args: { loading: true } }
export const Empty: Story = { name: 'لا بيانات', args: { empty: true } }
export const WithActions: Story = {
  name: 'مع إجراء في الترويسة',
  render: () => ({
    components: { ChartPanel, DashboardChart },
    setup() {
      const { t } = useI18n()
      const currency = ref('SAR')
      const currencies = [{ value: 'SAR', label: 'ريال سعودي (ر.س)' }, { value: 'USD', label: 'US Dollar ($)' }]
      return { t, currency, currencies, chart: computed(() => dashboardCharts(t).finance) }
    },
    template: `<div class="max-w-3xl">
      <ChartPanel :title="t('projects.dashboard.charts.financeTitle')" :description="t('projects.dashboard.charts.financeDescription')">
        <template #actions>
          <USelect v-model="currency" :items="currencies" :aria-label="t('projects.dashboard.charts.currency')" class="w-44" />
        </template>
        <DashboardChart :chart="chart" height="360px" :accessible-label="t('projects.dashboard.charts.financeTitle')" />
      </ChartPanel>
    </div>`,
  }),
}
```

Create `apps/web/stories/shared/DashboardPage.stories.ts`:

```ts
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import ChartPanel from '../../app/components/shared/ChartPanel.vue'
import DashboardChart from '../../app/components/shared/DashboardChart.client.vue'
import DashboardPage from '../../app/components/shared/DashboardPage.vue'
import MetricTile from '../../app/components/shared/MetricTile.vue'
import { dashboardCharts } from '../fixtures/projectReports'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/DashboardPage',
  component: DashboardPage,
  parameters: {
    layout: 'fullscreen',
    a11y: { test: 'error' },
    ...storyContext('unused', 'قالب اللوحة: ترويسة الصفحة وإجراءاتها، صف مؤشرات، ثم شبكة مخططات تصير عمودين متى بلغ عرضها 768px. المخطط العريض يأخذ `@min-[768px]:col-span-2`.'),
  },
  args: { title: '' },
} satisfies Meta<typeof DashboardPage>
export default meta
type Story = StoryObj<typeof meta>

// `states` puts the first chart in loading and the second in its empty line.
const page = (states: boolean): Story['render'] => () => ({
  components: { ChartPanel, DashboardChart, DashboardPage, MetricTile },
  setup() {
    const { t } = useI18n()
    return { t, states, charts: computed(() => dashboardCharts(t)) }
  },
  template: `<main class="webvue-shell-main">
    <DashboardPage :title="t('projects.dashboard.title')">
      <template #actions>
        <UButton color="neutral" variant="outline" to="/projects" :label="t('projects.dashboard.allProjects')" />
      </template>
      <template #metrics>
        <MetricTile icon="i-lucide-folder-kanban" :label="t('projects.dashboard.metrics.projects')" :value="4" />
        <MetricTile icon="i-lucide-activity" :label="t('projects.dashboard.metrics.active')" :value="3" />
        <MetricTile icon="i-lucide-list-checks" :label="t('projects.dashboard.metrics.taskProgress')" :value="62" unit="%" value-dir="ltr" />
        <MetricTile icon="i-lucide-wallet" :label="t('projects.dashboard.metrics.budgeted')" :value="2" />
      </template>
      <ChartPanel :title="t('projects.dashboard.charts.statusTitle')" :loading="states">
        <DashboardChart :chart="charts.status" variant="pie" :accessible-label="t('projects.dashboard.charts.statusTitle')" />
      </ChartPanel>
      <ChartPanel :title="t('projects.dashboard.charts.taskTitle')" :empty="states">
        <DashboardChart :chart="charts.tasks" variant="donut-text" :accessible-label="t('projects.dashboard.charts.taskTitle')" />
      </ChartPanel>
      <ChartPanel class="@min-[768px]:col-span-2" :title="t('projects.dashboard.charts.projectProgressTitle')">
        <DashboardChart :chart="charts.projectProgress" height="360px" :accessible-label="t('projects.dashboard.charts.projectProgressTitle')" />
      </ChartPanel>
    </DashboardPage>
  </main>`,
})

export const Default: Story = { name: 'لوحة كاملة', render: page(false) }
export const ChartStates: Story = { name: 'مخطط يُحمَّل وآخر بلا بيانات', render: page(true) }
```

- [ ] **Step 8: Lists, docs and the behaviour spec**

In `tools/ui_policy.py`, add one line just before the closing `))` of `STORYBOOK_COMPONENTS` (today `:57`; earlier tasks may have moved it):

```python
    'shared/ChartPanel.vue', 'shared/DashboardPage.vue',
```

In `apps/web/e2e/support/visualStories.ts`:
- add `'shared-chartpanel--',` and `'shared-dashboardpage--',` before the closing `]` of `VISUAL_STORIES`;
- add `'shared-dashboardpage--default'` to `VISUAL_MOBILE_STORIES` (the grid drops to one column and the metric row to one tile per line);
- add `'shared-chartpanel--',` and `'shared-dashboardpage--',` before the closing `]` of `VISUAL_AXE_STORIES`.

In `docs/design-system/components.md`, append to the table of the Task 1 section «القوالب والحالات — Tasmim الخطة 4»:

```markdown
| `apps/web/app/components/shared/ChartPanel.vue` | `apps/web/stories/shared/ChartPanel.stories.ts` | `UCard` (`as="section"`)، `USkeleton`؛ المخطط في الخانة الافتراضية، وإجراء في الترويسة |
| `apps/web/app/components/shared/DashboardPage.vue` | `apps/web/stories/shared/DashboardPage.stories.ts` | `SharedPageContainer`، `SharedPageHeader`؛ صف `SharedMetricTile` ثم شبكة `SharedChartPanel` باستعلام حاوية |
```

Create `apps/web/e2e/storybook-display-templates.spec.ts`:

```ts
import { expect, test, type Locator, type Page } from '@playwright/test'
import { requireStorybook, startStorybookServer } from './support/storybookServer'

// Behaviour of the Plan 4 display templates on their stories: dashboard (Task 10),
// timeline and conversation (Task 11), standalone and print (Task 12).
let base = ''
let close: () => Promise<void> = async () => {}
const open = async (page: Page, id: string, globals: string) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(`${base}/iframe.html?id=${id}&viewMode=story&globals=${globals}`)
  await page.locator('#storybook-root').waitFor()
}
const boxOf = async (locator: Locator) => (await locator.boundingBox())!

test.describe('Tasmim dashboard template', () => {
  requireStorybook()
  test.beforeAll(async () => { ({ base, close } = await startStorybookServer()) })
  test.afterAll(async () => { await close() })

  test('charts sit two-up on a wide screen, the wide chart spans both, and all stack on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await open(page, 'shared-dashboardpage--default', 'locale:ar;appearance:light')
    const panels = page.locator('[data-template="chart-panel"]')
    await expect(panels).toHaveCount(3)
    const [first, second, wide] = [await boxOf(panels.nth(0)), await boxOf(panels.nth(1)), await boxOf(panels.nth(2))]
    expect(first.y).toBeCloseTo(second.y, 0)
    expect(wide.y).toBeGreaterThan(first.y + first.height)
    expect(wide.width).toBeGreaterThan(first.width + second.width)
    // RTL: the first chart is on the inline-start (right) side.
    expect(first.x).toBeGreaterThan(second.x)

    await page.setViewportSize({ width: 390, height: 844 })
    const narrow = [await boxOf(panels.nth(0)), await boxOf(panels.nth(1))]
    expect(narrow[1]!.y).toBeGreaterThan(narrow[0]!.y + narrow[0]!.height)
    expect(narrow[0]!.width).toBeCloseTo(narrow[1]!.width, 0)
  })

  test('a chart panel is a region named by its heading', async ({ page }) => {
    await open(page, 'shared-chartpanel--with-actions', 'locale:en;appearance:light')
    const region = page.getByRole('region', { name: 'Planned versus actual' })
    await expect(region).toBeVisible()
    await expect(region.getByRole('combobox')).toBeEnabled()
  })
})
```

(`Planned versus actual` is `projects.dashboard.charts.financeTitle` in `apps/web/i18n/locales/en/projects.json`, checked 2026-10-13.)

- [ ] **Step 9: Gates and baselines**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim
node tools/ui_catalog.mjs
npm -w apps/web run lint && npm test 2>&1 | tail -3 && python3 -B tools/ui_policy.py && python3 -B tools/arch_policy.py
cd apps/web && npm run build-storybook >/dev/null
npx playwright test e2e/storybook-display-templates.spec.ts -g 'dashboard template' --reporter=line
npx playwright test e2e/storybook-visual.spec.ts -g 'shared-(chartpanel|dashboardpage)' --update-snapshots=missing --reporter=line
WEBVUE_REQUIRE_STORYBOOK=1 npx playwright test e2e/storybook-visual.spec.ts -g 'shared-(chartpanel|dashboardpage)' --repeat-each=2 --reporter=line 2>&1 | tail -5
WEBVUE_REQUIRE_STORYBOOK=1 npx playwright test e2e/storybook-smoke.spec.ts -g 'shared-(chartpanel|dashboardpage)' --reporter=line | tail -3
git status --short e2e/storybook-visual.spec.ts-snapshots | grep -v -E 'shared-(chartpanel|dashboardpage)--' ; echo "unexpected=$?"
```

Expected: lint, `npm test` (the 6 new tests included), `ui_policy` and `arch_policy` pass. The behaviour spec passes (2 tests). 28 PNGs are written: 6 stories × 4 plus `shared-dashboardpage--default` × 4 mobile. The `--repeat-each=2` run passes every screenshot twice and the six axe tests (one per story); this proves the unovis charts render deterministically under reduced motion. If a chart screenshot differs between the two runs, stop and report it; do not raise the thresholds. The smoke tests pass, and `grep -v` prints nothing (`unexpected=1`).

- [ ] **Step 10: Commit**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim
git add apps/web/app/components/shared/ChartPanel.vue apps/web/app/components/shared/DashboardPage.vue \
  apps/web/app/components/shared/__tests__/DashboardPage.test.ts apps/web/stories/shared/ChartPanel.stories.ts \
  apps/web/stories/shared/DashboardPage.stories.ts apps/web/e2e/storybook-display-templates.spec.ts \
  apps/web/e2e/support/visualStories.ts apps/web/e2e/storybook-visual.spec.ts-snapshots \
  apps/web/i18n/locales/ar/common.json apps/web/i18n/locales/en/common.json \
  tools/ui_policy.py docs/design-system/components.md docs/design-system/catalog.json
git commit -m "feat(web): add the DashboardPage and ChartPanel templates

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: `TimelineFrame` and `ConversationLayout`

**TimelineFrame.** Two toolbars exist today:
- `pages/meetings/calendar.vue:134-145`: previous / month label / today / next. The label is `aria-live="polite"` and the group is labelled by the month. The chevrons use `rtl:rotate-180` (`:137`, `:142`), and the buttons borrow `projects.previousPage` / `projects.nextPage`, which is an application key used across applications.
- `pages/projects/[id]/schedule.vue:56-62`: a week / month switch. It is a `<nav>` of two `aria-pressed` buttons, and the scale lives in the `?scale=` query (`:21-24`). `components/project/schedule/ScheduleGantt.vue:79-82` repeats the switch inside the card when it is not `embedded`.

The template is one toolbar for both:
- previous / range / today / next, and the scale switch only when `scales` is given;
- the scale switch is a `role="group"` (a set of toggles is not navigation);
- the chevrons flip with `rtl:-scale-x-100` (Global Constraints);
- the labels come from `states.*`.

The parent owns the range and the scale; the frame only emits. Plan 5 moves the schedule page onto the frame and decides whether the project-overlay case (`schedule.vue:46`, header hidden) needs a prop.

**ConversationLayout.** It is taken from `components/chat/ChatWorkspace.vue`, and it keeps that file's split exactly:
- From 768px (`:21` `useMediaQuery('(min-width: 768px)', { ssrWidth: 1024 })`, `:33-34`), the conversation list is not on the page. It is the chat manifest's context-sidebar panel (`modules/chat/manifest.ts:18` `sidebarPanel`, rendered by `components/chat/ChatSidebarPanel.vue`). The page shows only the thread, or the "select a conversation" empty state.
- Below 768px, the list fills the page until a conversation is selected. The thread then replaces it, and its header carries the back link (`ChatWorkspace.vue:80-87`).

The template adds two things:
- the `info` region (today `/chat/[id]/info` is a separate page): an aside at the inline end on desktop, which replaces the thread on a phone;
- the full-height frame (`assets/css/shell.css:240` `.webvue-chat-workspace`), with a Tailwind arbitrary height instead of a chat class.

Chat's own visuals (`webvue-chat-thread-header`, `webvue-chat-composer`, …) stay in the slot content that Plan 6 passes in. The template names no application (R3).

**Files:**
- Create: `apps/web/app/components/shared/TimelineFrame.vue`, `apps/web/app/components/shared/ConversationLayout.vue`
- Create: `apps/web/app/components/shared/__tests__/TimelineFrame.test.ts`, `apps/web/app/components/shared/__tests__/ConversationLayout.test.ts`
- Create: `apps/web/stories/shared/TimelineFrame.stories.ts`, `apps/web/stories/shared/ConversationLayout.stories.ts`
- Modify: `apps/web/i18n/locales/{ar,en}/common.json` (six `states.*` keys)
- Modify: `tools/ui_policy.py` (`STORYBOOK_COMPONENTS`), `apps/web/e2e/support/visualStories.ts`, `docs/design-system/components.md`
- Modify: `apps/web/e2e/storybook-display-templates.spec.ts` (two describes)
- Regenerate: `docs/design-system/catalog.json`; new PNGs `shared-timelineframe--*`, `shared-conversationlayout--*`

**Interfaces:**
- Consumes: `renderShared`, `SharedRenderOptions.modules` / `.stubs` / `.hydrated` (Task 1); `open`, `boxOf` in `storybook-display-templates.spec.ts` (Task 10); `SharedPageContainer`, `SharedPageHeader`, `SharedEmptyState` (unchanged).
- Produces:
  - `SharedTimelineFrame`: props `{ title: string; rangeLabel: string; scale?: string; scales?: { value: string; label: string }[] }`, emits `{ prev: []; next: []; today: []; 'update:scale': [string] }` (works with `v-model:scale`; choosing the current scale emits nothing), slots `default`, `actions`. testids `timeline-prev`, `timeline-today`, `timeline-next`, `timeline-range`, `timeline-scale`. Every button is disabled until hydrated.
  - `SharedConversationLayout`: props `{ hasSelection: boolean; infoOpen?: boolean }`, slots `list`, `header`, `thread`, `composer`, `info`, `empty`. Regions: `data-template="conversation-layout"` plus `conversation-list`, `conversation-thread`, `conversation-header`, `conversation-messages`, `conversation-composer`, `conversation-empty`, `conversation-info` (an `<aside aria-label=states.details>`).
  - i18n: `states.previous`, `states.next`, `states.today`, `states.period`, `states.scale`, `states.details`.

- [ ] **Step 1: Failing tests**

Create `apps/web/app/components/shared/__tests__/TimelineFrame.test.ts`:

```ts
import { defineComponent, h } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { renderShared } from './helpers/renderShared'

// A button stand-in that keeps each click handler, keyed by testid, aria-label or label,
// so an emit can be fired without a DOM.
const clicks = new Map<string, () => void>()
const UButton = defineComponent({
  inheritAttrs: false,
  props: { label: String, variant: String, disabled: Boolean },
  setup(props, { attrs, slots }) {
    const key = String(attrs['data-testid'] ?? attrs['aria-label'] ?? props.label)
    if (typeof attrs.onClick === 'function') clicks.set(key, attrs.onClick as () => void)
    return () => h('button', { ...attrs, 'data-variant': props.variant, disabled: props.disabled || undefined }, slots.default?.() ?? props.label)
  },
})
const stubs = {
  UButton,
  SharedPageContainer: defineComponent({ inheritAttrs: false, setup(_, { attrs, slots }) { return () => h('div', attrs, slots.default?.()) } }),
  SharedPageHeader: defineComponent({
    props: { title: String },
    setup(props, { slots }) { return () => h('header', [h('h1', props.title), slots.actions ? h('div', { 'data-actions': '' }, slots.actions()) : null]) },
  }),
}
const SCALES = [{ value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }]
const render = (props: Record<string, unknown>, hydrated = true) => {
  clicks.clear()
  return renderShared('TimelineFrame', { title: 'Calendar', rangeLabel: 'October 2026', ...props }, { default: () => h('div', { 'data-body': '' }) }, { stubs, hydrated })
}

describe('SharedTimelineFrame', () => {
  it('orders previous, the live range, today and next, then the body', async () => {
    const html = await render({})
    const order = ['<h1>Calendar</h1>', 'timeline-prev', 'timeline-range', 'timeline-today', 'timeline-next', 'data-body']
    const positions = order.map(marker => html.indexOf(marker))
    expect(positions.every(position => position >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
    expect(html).toMatch(/aria-live="polite"[^>]*>October 2026</)
    expect(html).toContain('aria-label="states.previous"')
    expect(html).toContain('aria-label="states.next"')
    expect(html).toContain('states.today')
    expect(html).toContain('aria-label="states.period"')
  })

  it('points both chevrons along the reading direction and mirrors them in RTL', async () => {
    const html = await render({})
    expect(html).toMatch(/timeline-prev[\s\S]*?i-lucide-chevron-left/)
    expect(html).toMatch(/timeline-next[\s\S]*?i-lucide-chevron-right/)
    expect(html.match(/rtl:-scale-x-100/g)).toHaveLength(2)
    expect(html).not.toContain('rotate-180')
  })

  it('emits prev, today and next', async () => {
    const onPrev = vi.fn()
    const onToday = vi.fn()
    const onNext = vi.fn()
    await render({ onPrev, onToday, onNext })
    clicks.get('timeline-prev')!()
    clicks.get('timeline-today')!()
    clicks.get('timeline-next')!()
    expect([onPrev, onToday, onNext].map(spy => spy.mock.calls.length)).toEqual([1, 1, 1])
  })

  it('shows the scale switch only with scales, marks the current one and emits only a change', async () => {
    expect(await render({})).not.toContain('timeline-scale')
    const onScale = vi.fn()
    const html = await render({ scales: SCALES, scale: 'week', 'onUpdate:scale': onScale })
    expect(html).toContain('role="group" aria-label="states.scale"')
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1)
    expect(html).toMatch(/aria-pressed="true"[^>]*data-variant="soft"[^>]*>Week</)
    clicks.get('Week')!()
    expect(onScale).not.toHaveBeenCalled()
    clicks.get('Month')!()
    expect(onScale).toHaveBeenCalledWith('month')
  })

  it('keeps every control disabled until hydrated', async () => {
    const html = await render({ scales: SCALES, scale: 'week' }, false)
    const buttons = html.match(/<button[^>]*>/g) ?? []
    expect(buttons).toHaveLength(5)
    expect(buttons.every(tag => / disabled/.test(tag))).toBe(true)
  })
})
```

Create `apps/web/app/components/shared/__tests__/ConversationLayout.test.ts`:

```ts
import { defineComponent, h, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { renderShared } from './helpers/renderShared'

const stubs = {
  SharedPageContainer: defineComponent({ inheritAttrs: false, setup(_, { attrs, slots }) { return () => h('div', attrs, slots.default?.()) } }),
}
const slots = {
  list: () => h('ul', { 'data-list': '' }),
  header: () => h('div', { 'data-header': '' }),
  thread: () => h('div', { 'data-thread': '' }),
  composer: () => h('div', { 'data-composer': '' }),
  info: () => h('div', { 'data-info': '' }),
  empty: () => h('p', { 'data-empty': '' }),
}
const render = (desktop: boolean, props: Record<string, unknown>) => renderShared('ConversationLayout', props, slots, {
  stubs,
  modules: { '@vueuse/core': { useMediaQuery: () => ref(desktop) } },
})
const shown = (html: string) => Object.keys(slots).filter(name => html.includes(`data-${name}=""`))

describe('SharedConversationLayout', () => {
  it.each([
    ['desktop, nothing selected: the list is the sidebar panel, the page shows empty', true, { hasSelection: false }, ['empty']],
    ['desktop, selected', true, { hasSelection: true }, ['header', 'thread', 'composer']],
    ['desktop, selected with info: info beside the thread', true, { hasSelection: true, infoOpen: true }, ['header', 'thread', 'composer', 'info']],
    ['phone, nothing selected: the list fills the page', false, { hasSelection: false }, ['list']],
    ['phone, selected: the thread replaces the list', false, { hasSelection: true }, ['header', 'thread', 'composer']],
    ['phone, selected with info: info replaces the thread', false, { hasSelection: true, infoOpen: true }, ['info']],
    ['info without a selection is ignored', true, { hasSelection: false, infoOpen: true }, ['empty']],
  ] as const)('%s', async (_label, desktop, props, expected) => {
    expect(shown(await render(desktop, props))).toEqual(expected)
  })

  it('stacks header, messages and composer, and puts info in a labelled aside at the inline end', async () => {
    const html = await render(true, { hasSelection: true, infoOpen: true })
    const order = ['data-header', 'data-thread', 'data-composer', 'data-template="conversation-info"']
    const positions = order.map(marker => html.indexOf(marker))
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
    expect(html).toMatch(/<aside[^>]*aria-label="states.details"/)
    expect(html).toContain('md:border-s')
    expect(html).not.toMatch(/\b(?:border-l|border-r|ml-|mr-)/)
  })

  it('fills the height under the shell header', async () => {
    const html = await render(true, { hasSelection: false })
    expect(html).toContain('h-[calc(100svh_-_var(--shell-header-height,0px))]')
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim/apps/web && npx vitest run app/components/shared/__tests__/TimelineFrame.test.ts app/components/shared/__tests__/ConversationLayout.test.ts
```

Expected: FAIL, 14 tests, each with `ENOENT … TimelineFrame.vue` or `ENOENT … ConversationLayout.vue`.

- [ ] **Step 3: The six strings**

In `apps/web/i18n/locales/ar/common.json`, add at the end of `states`:

```json
    "previous": "السابق",
    "next": "التالي",
    "today": "اليوم",
    "period": "التنقل بين الفترات",
    "scale": "مقياس العرض",
    "details": "التفاصيل"
```

In `apps/web/i18n/locales/en/common.json`:

```json
    "previous": "Previous",
    "next": "Next",
    "today": "Today",
    "period": "Move between periods",
    "scale": "Scale",
    "details": "Details"
```

- [ ] **Step 4: `TimelineFrame.vue`**

Create `apps/web/app/components/shared/TimelineFrame.vue`:

```vue
<script setup lang="ts">
// The timeline template (Tasmim Plan 4) for calendars and schedules: the page header
// and its actions, one toolbar (previous / range / today / next, and a scale switch
// when `scales` is given), then the timeline in the default slot. The parent owns the
// range and the scale (keep the scale in the URL query) and this only emits. The
// chevrons point along the reading direction, so they mirror in RTL.
const props = defineProps<{
  title: string
  rangeLabel: string
  scale?: string
  scales?: { value: string; label: string }[]
}>()
const emit = defineEmits<{ prev: []; next: []; today: []; 'update:scale': [string] }>()
const { t } = useI18n()
const hydrated = useHydrated()

function pick(value: string) {
  if (value !== props.scale) emit('update:scale', value)
}
</script>

<template>
  <SharedPageContainer width="list" data-template="timeline-frame">
    <SharedPageHeader :title="props.title">
      <template v-if="$slots.actions" #actions>
        <slot name="actions" />
      </template>
    </SharedPageHeader>
    <div data-template="timeline-toolbar" class="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-default p-3 ring ring-default">
      <div class="flex items-center gap-2" role="group" :aria-label="t('states.period')">
        <UButton type="button" color="neutral" variant="ghost" square data-testid="timeline-prev" :disabled="!hydrated" :aria-label="t('states.previous')" @click="emit('prev')">
          <UIcon name="i-lucide-chevron-left" class="size-4.5 rtl:-scale-x-100" aria-hidden="true" />
        </UButton>
        <span data-testid="timeline-range" aria-live="polite" class="min-w-40 text-center text-sm font-medium text-highlighted">{{ props.rangeLabel }}</span>
        <UButton type="button" color="neutral" variant="outline" size="sm" data-testid="timeline-today" :disabled="!hydrated" :label="t('states.today')" @click="emit('today')" />
        <UButton type="button" color="neutral" variant="ghost" square data-testid="timeline-next" :disabled="!hydrated" :aria-label="t('states.next')" @click="emit('next')">
          <UIcon name="i-lucide-chevron-right" class="size-4.5 rtl:-scale-x-100" aria-hidden="true" />
        </UButton>
      </div>
      <div v-if="props.scales?.length" role="group" :aria-label="t('states.scale')" data-testid="timeline-scale" class="inline-flex items-center gap-0.5 rounded-md bg-default p-0.5 ring ring-default">
        <UButton
          v-for="option in props.scales"
          :key="option.value"
          type="button"
          color="neutral"
          size="sm"
          :aria-pressed="option.value === props.scale"
          :variant="option.value === props.scale ? 'soft' : 'ghost'"
          :disabled="!hydrated"
          :label="option.label"
          @click="pick(option.value)"
        />
      </div>
    </div>
    <div data-template="timeline-body" class="min-w-0">
      <slot />
    </div>
  </SharedPageContainer>
</template>
```

(The `aria-pressed` attribute comes before `variant` on purpose: the scale test reads `aria-pressed="true" … data-variant="soft"` in that order.)

- [ ] **Step 5: `ConversationLayout.vue`**

Create `apps/web/app/components/shared/ConversationLayout.vue`:

```vue
<script setup lang="ts">
import { useMediaQuery } from '@vueuse/core'

// The conversation template (Tasmim Plan 4), taken from chat/ChatWorkspace.vue.
// From 768px the conversation list is the application's context-sidebar panel
// (AppManifest.sidebarPanel), so this renders only the thread column (`header`,
// `thread`, `composer`) and, with `infoOpen`, the `info` aside at the inline end;
// with nothing selected it shows `empty`. Below 768px the `list` fills the page until
// a conversation is selected; the thread then replaces it (its header carries the back
// link to the list), and an open info panel replaces the thread.
const props = withDefaults(defineProps<{
  hasSelection: boolean
  infoOpen?: boolean
}>(), {
  infoOpen: false,
})
const { t } = useI18n()
const isDesktop = useMediaQuery('(min-width: 768px)', { ssrWidth: 1024 })
const showInfo = computed(() => props.hasSelection && props.infoOpen)
const showList = computed(() => !isDesktop.value && !props.hasSelection)
const showThread = computed(() => isDesktop.value || (props.hasSelection && !showInfo.value))
</script>

<template>
  <SharedPageContainer width="list" data-template="conversation-layout" class="flex h-[calc(100svh_-_var(--shell-header-height,0px))] min-h-0 flex-col">
    <div class="flex min-h-0 flex-1 overflow-hidden bg-default">
      <div v-if="showList" data-template="conversation-list" class="flex min-h-0 min-w-0 flex-1 flex-col">
        <slot name="list" />
      </div>
      <section v-if="showThread" data-template="conversation-thread" class="flex min-h-0 min-w-0 flex-1 flex-col">
        <template v-if="props.hasSelection">
          <div v-if="$slots.header" data-template="conversation-header" class="shrink-0">
            <slot name="header" />
          </div>
          <div data-template="conversation-messages" class="flex min-h-0 flex-1 flex-col">
            <slot name="thread" />
          </div>
          <div v-if="$slots.composer" data-template="conversation-composer" class="shrink-0">
            <slot name="composer" />
          </div>
        </template>
        <div v-else data-template="conversation-empty" class="grid flex-1 place-items-center p-6">
          <slot name="empty" />
        </div>
      </section>
      <aside v-if="showInfo" data-template="conversation-info" :aria-label="t('states.details')" class="flex min-h-0 flex-col overflow-y-auto bg-default max-md:flex-1 md:w-80 md:shrink-0 md:border-s md:border-default">
        <slot name="info" />
      </aside>
    </div>
  </SharedPageContainer>
</template>
```

- [ ] **Step 6: Run the tests to see them pass**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim/apps/web && npx vitest run app/components/shared/__tests__/TimelineFrame.test.ts app/components/shared/__tests__/ConversationLayout.test.ts
```

Expected: PASS (14 tests).

- [ ] **Step 7: Stories**

Create `apps/web/stories/shared/TimelineFrame.stories.ts`:

```ts
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import TimelineFrame from '../../app/components/shared/TimelineFrame.vue'
import { storyContext } from '../support/context'

// A fixed "today" keeps the range label, and so the screenshots, stable.
const TODAY = new Date(2026, 9, 5)
const DAY = 24 * 60 * 60 * 1000

const meta = {
  title: 'Shared/TimelineFrame',
  component: TimelineFrame,
  parameters: {
    layout: 'fullscreen',
    a11y: { test: 'error' },
    ...storyContext('unused', 'قالب الخط الزمني للتقويم والجدول: السابق / الفترة / اليوم / التالي، ومقياس عرض اختياري. الصفحة تملك الفترة والمقياس، والإطار يرسل الأحداث فقط. السهمان ينعكسان في العربية.'),
  },
  args: { title: '', rangeLabel: '' },
} satisfies Meta<typeof TimelineFrame>
export default meta
type Story = StoryObj<typeof meta>

export const Calendar: Story = {
  name: 'تقويم شهري',
  render: () => ({
    components: { TimelineFrame },
    setup() {
      const { t, locale } = useI18n()
      const cursor = ref(new Date(TODAY.getFullYear(), TODAY.getMonth(), 1))
      const rangeLabel = computed(() => new Intl.DateTimeFormat(locale.value, { month: 'long', year: 'numeric', calendar: 'gregory' }).format(cursor.value))
      const shift = (delta: number) => { cursor.value = new Date(cursor.value.getFullYear(), cursor.value.getMonth() + delta, 1) }
      const today = () => { cursor.value = new Date(TODAY.getFullYear(), TODAY.getMonth(), 1) }
      return { t, rangeLabel, shift, today }
    },
    template: `<main class="webvue-shell-main">
      <TimelineFrame :title="t('nav.meetingCalendar')" :range-label="rangeLabel" @prev="shift(-1)" @next="shift(1)" @today="today">
        <template #actions><UButton icon="i-lucide-plus" :label="t('meetingsUi.new')" /></template>
        <div class="rounded-lg bg-default p-6 text-sm text-muted ring ring-default">{{ t('meetingsUi.empty') }}</div>
      </TimelineFrame>
    </main>`,
  }),
}

export const Schedule: Story = {
  name: 'جدول بمقياس أسبوعي وشهري',
  render: () => ({
    components: { TimelineFrame },
    setup() {
      const { t, locale } = useI18n()
      const scale = ref('week')
      const start = ref(new Date(TODAY))
      const scales = computed(() => [{ value: 'week', label: t('projects.schedule.week') }, { value: 'month', label: t('projects.schedule.month') }])
      const rangeLabel = computed(() => scale.value === 'month'
        ? new Intl.DateTimeFormat(locale.value, { month: 'long', year: 'numeric', calendar: 'gregory' }).format(start.value)
        : new Intl.DateTimeFormat(locale.value, { day: 'numeric', month: 'short', year: 'numeric', calendar: 'gregory' }).formatRange(start.value, new Date(start.value.getTime() + 6 * DAY)))
      const shift = (delta: number) => {
        const value = start.value
        start.value = scale.value === 'month' ? new Date(value.getFullYear(), value.getMonth() + delta, 1) : new Date(value.getTime() + delta * 7 * DAY)
      }
      return { t, scale, scales, rangeLabel, shift, today: () => { start.value = new Date(TODAY) } }
    },
    template: `<main class="webvue-shell-main">
      <TimelineFrame v-model:scale="scale" :title="t('projects.schedule.title')" :range-label="rangeLabel" :scales="scales" @prev="shift(-1)" @next="shift(1)" @today="today">
        <template #actions><UButton icon="i-lucide-plus" :label="t('tasks.new')" /></template>
        <div class="rounded-lg bg-default p-6 text-sm text-muted ring ring-default">{{ t('projects.schedule.empty') }}</div>
      </TimelineFrame>
    </main>`,
  }),
}
```

Create `apps/web/stories/shared/ConversationLayout.stories.ts`:

```ts
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { useI18n } from 'vue-i18n'
import ConversationLayout from '../../app/components/shared/ConversationLayout.vue'
import EmptyState from '../../app/components/shared/EmptyState.vue'
import { storyContext } from '../support/context'

const PEOPLE = ['سارة القحطاني', 'فريق المشاريع', 'خالد العتيبي']

const meta = {
  title: 'Shared/ConversationLayout',
  component: ConversationLayout,
  parameters: {
    layout: 'fullscreen',
    a11y: { test: 'error' },
    ...storyContext('unused', 'قالب المحادثة: من 768px تكون القائمة لوحة الشريط السياقي ويعرض القالب المحادثة فقط؛ تحتها تملأ القائمة الصفحة حتى تُختار محادثة. لوحة المعلومات جانبية على الحاسوب وتحل محل المحادثة على الهاتف.'),
  },
  args: { hasSelection: true, infoOpen: false },
  render: args => ({
    components: { ConversationLayout, EmptyState },
    setup: () => ({ args, t: useI18n().t, people: PEOPLE }),
    template: `<ConversationLayout v-bind="args">
      <template #list>
        <h1 class="px-4 pt-4 text-lg font-semibold text-highlighted">{{ t('chat.title') }}</h1>
        <ul class="grid divide-y divide-default" :aria-label="t('chat.title')">
          <li v-for="name in people" :key="name" class="p-4 text-sm text-highlighted">{{ name }}</li>
        </ul>
      </template>
      <template #header>
        <div class="flex items-center gap-3 border-b border-default bg-default px-3 py-2">
          <h1 class="truncate text-lg font-semibold text-highlighted">{{ people[0] }}</h1>
        </div>
      </template>
      <template #thread>
        <div class="flex-1 overflow-y-auto bg-muted p-4">
          <p class="max-w-sm rounded-lg bg-default p-3 text-sm text-default">صباح الخير، أرفقت مسودة الخطة.</p>
        </div>
      </template>
      <template #composer>
        <div class="border-t border-default bg-default p-3">
          <UInput class="w-full" :placeholder="t('chat.composerPlaceholder')" :aria-label="t('chat.composerPlaceholder')" />
        </div>
      </template>
      <template #info>
        <div class="grid gap-2 p-4">
          <h2 class="font-semibold text-highlighted">{{ t('chat.info') }}</h2>
          <p class="text-sm text-muted">{{ people[0] }}</p>
        </div>
      </template>
      <template #empty>
        <h1 class="sr-only">{{ t('chat.title') }}</h1>
        <EmptyState :title="t('chat.select')" :description="t('chat.description')" />
      </template>
    </ConversationLayout>`,
  }),
} satisfies Meta<typeof ConversationLayout>
export default meta
type Story = StoryObj<typeof meta>

export const Selected: Story = { name: 'محادثة مختارة' }
export const NothingSelected: Story = { name: 'لا محادثة مختارة', args: { hasSelection: false } }
export const Info: Story = { name: 'مع لوحة المعلومات', args: { infoOpen: true } }
```

- [ ] **Step 8: Lists, docs and the behaviour spec**

`tools/ui_policy.py`, one line before the closing `))` of `STORYBOOK_COMPONENTS`:

```python
    'shared/TimelineFrame.vue', 'shared/ConversationLayout.vue',
```

`apps/web/e2e/support/visualStories.ts`:
- `VISUAL_STORIES`: add `'shared-timelineframe--',` and `'shared-conversationlayout--',`;
- `VISUAL_MOBILE_STORIES`: add `'shared-timelineframe--'` (the toolbar wraps) and `'shared-conversationlayout--'` (list, thread and info replace one another);
- `VISUAL_AXE_STORIES`: add `'shared-timelineframe--',` and `'shared-conversationlayout--',`.

`docs/design-system/components.md`, two rows appended to the Task 1 section table:

```markdown
| `apps/web/app/components/shared/TimelineFrame.vue` | `apps/web/stories/shared/TimelineFrame.stories.ts` | `SharedPageContainer`، `SharedPageHeader`، `UButton`، `UIcon`؛ السابق/اليوم/التالي ومقياس اختياري، والسهمان ينعكسان بـ `rtl:-scale-x-100` |
| `apps/web/app/components/shared/ConversationLayout.vue` | `apps/web/stories/shared/ConversationLayout.stories.ts` | `SharedPageContainer`، `useMediaQuery`؛ القائمة في الشريط السياقي من 768px، ولوحة معلومات في `aside` |
```

Append to `apps/web/e2e/storybook-display-templates.spec.ts`:

```ts
test.describe('Tasmim timeline template', () => {
  requireStorybook()
  test.use({ viewport: { width: 1280, height: 800 } })
  test.beforeAll(async () => { ({ base, close } = await startStorybookServer()) })
  test.afterAll(async () => { await close() })

  for (const [locale, dir] of [['ar', 'rtl'], ['en', 'ltr']] as const) {
    test(`previous sits at the inline start and both chevrons point outward (${locale})`, async ({ page }) => {
      await open(page, 'shared-timelineframe--calendar', `locale:${locale};appearance:light`)
      const prev = page.getByTestId('timeline-prev')
      const next = page.getByTestId('timeline-next')
      await expect(prev).toBeEnabled()
      const [p, n] = [await boxOf(prev), await boxOf(next)]
      if (dir === 'rtl') expect(p.x).toBeGreaterThan(n.x)
      else expect(p.x).toBeLessThan(n.x)
      const scaleOf = (button: typeof prev) => button.locator('[class*="-scale-x-100"]').evaluate(element => getComputedStyle(element).scale)
      for (const button of [prev, next]) {
        const scale = await scaleOf(button)
        if (dir === 'rtl') expect(scale.startsWith('-1')).toBe(true)
        else expect(scale).toBe('none')
      }
    })
  }

  test('previous, next and today move the announced range', async ({ page }) => {
    await open(page, 'shared-timelineframe--calendar', 'locale:en;appearance:light')
    const range = page.getByTestId('timeline-range')
    await expect(range).toHaveText('October 2026')
    await expect(range).toHaveAttribute('aria-live', 'polite')
    await page.getByTestId('timeline-next').click()
    await expect(range).toHaveText('November 2026')
    await page.getByTestId('timeline-prev').click()
    await page.getByTestId('timeline-prev').click()
    await expect(range).toHaveText('September 2026')
    await page.getByTestId('timeline-today').click()
    await expect(range).toHaveText('October 2026')
  })

  test('the scale switch is a group of pressed toggles', async ({ page }) => {
    await open(page, 'shared-timelineframe--schedule', 'locale:en;appearance:light')
    const group = page.getByRole('group', { name: 'Scale' })
    const month = group.getByRole('button', { name: 'Month' })
    await expect(group.getByRole('button', { pressed: true })).toHaveCount(1)
    await month.click()
    await expect(month).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('timeline-range')).toHaveText('October 2026')
  })
})

test.describe('Tasmim conversation template', () => {
  requireStorybook()
  test.beforeAll(async () => { ({ base, close } = await startStorybookServer()) })
  test.afterAll(async () => { await close() })

  test('desktop shows the thread or the empty state, never the list; info sits at the inline end', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await open(page, 'shared-conversationlayout--nothing-selected', 'locale:ar;appearance:light')
    await expect(page.locator('[data-template="conversation-empty"]')).toBeVisible()
    await expect(page.locator('[data-template="conversation-list"]')).toHaveCount(0)
    await open(page, 'shared-conversationlayout--info', 'locale:ar;appearance:light')
    const thread = await boxOf(page.locator('[data-template="conversation-thread"]'))
    const info = await boxOf(page.getByRole('complementary', { name: 'التفاصيل' }))
    expect(info.width).toBeLessThan(thread.width)
    expect(info.x).toBeLessThan(thread.x)
    const composer = await boxOf(page.locator('[data-template="conversation-composer"]'))
    expect(composer.y + composer.height).toBeCloseTo(900, 0)
  })

  test('a phone shows the list, then the thread, then info, one at a time', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await open(page, 'shared-conversationlayout--nothing-selected', 'locale:ar;appearance:light')
    await expect(page.locator('[data-template="conversation-list"]')).toBeVisible()
    await expect(page.locator('[data-template="conversation-thread"]')).toHaveCount(0)
    await open(page, 'shared-conversationlayout--selected', 'locale:ar;appearance:light')
    await expect(page.locator('[data-template="conversation-thread"]')).toBeVisible()
    await expect(page.locator('[data-template="conversation-list"]')).toHaveCount(0)
    await open(page, 'shared-conversationlayout--info', 'locale:ar;appearance:light')
    await expect(page.locator('[data-template="conversation-info"]')).toBeVisible()
    await expect(page.locator('[data-template="conversation-thread"]')).toHaveCount(0)
  })
})
```

(`Month` is `projects.schedule.month` in `apps/web/i18n/locales/en/projects.json`, checked 2026-10-13. Switching to the month scale keeps the range at `October 2026` because the story's week starts on 5 October.)

- [ ] **Step 9: Gates and baselines**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim
node tools/ui_catalog.mjs
npm -w apps/web run lint && npm test 2>&1 | tail -3 && python3 -B tools/ui_policy.py && python3 -B tools/arch_policy.py
cd apps/web && npm run build-storybook >/dev/null
npx playwright test e2e/storybook-display-templates.spec.ts -g 'timeline template|conversation template' --reporter=line
npx playwright test e2e/storybook-visual.spec.ts -g 'shared-(timelineframe|conversationlayout)' --update-snapshots=missing --reporter=line
WEBVUE_REQUIRE_STORYBOOK=1 npx playwright test e2e/storybook-visual.spec.ts -g 'shared-(timelineframe|conversationlayout)' --reporter=line 2>&1 | tail -5
WEBVUE_REQUIRE_STORYBOOK=1 npx playwright test e2e/storybook-smoke.spec.ts -g 'shared-(timelineframe|conversationlayout)' --reporter=line | tail -3
git status --short e2e/storybook-visual.spec.ts-snapshots | grep -v -E 'shared-(timelineframe|conversationlayout)--' ; echo "unexpected=$?"
```

Expected: lint, `npm test` (14 new tests), both policies pass. The behaviour spec passes 6 tests. 40 PNGs are written: 5 stories × 4, plus the same 5 × 4 at 390×844. The second run passes all screenshots and the five axe tests (one per story). The smoke tests pass, and `unexpected=1`.

- [ ] **Step 10: Commit**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim
git add apps/web/app/components/shared/TimelineFrame.vue apps/web/app/components/shared/ConversationLayout.vue \
  apps/web/app/components/shared/__tests__/TimelineFrame.test.ts apps/web/app/components/shared/__tests__/ConversationLayout.test.ts \
  apps/web/stories/shared/TimelineFrame.stories.ts apps/web/stories/shared/ConversationLayout.stories.ts \
  apps/web/e2e/storybook-display-templates.spec.ts apps/web/e2e/support/visualStories.ts apps/web/e2e/storybook-visual.spec.ts-snapshots \
  apps/web/i18n/locales/ar/common.json apps/web/i18n/locales/en/common.json \
  tools/ui_policy.py docs/design-system/components.md docs/design-system/catalog.json
git commit -m "feat(web): add the TimelineFrame and ConversationLayout templates

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: `StandalonePage` with `card` and `print` variants, and the print sheet

**Card pages.** Three pages are built by hand today:
- `pages/login.vue:77-78`: `<main class="… min-h-svh grid place-items-center bg-default p-4">` around a `UCard`. Its scoped style (`:114-122`) adds 2.5rem padding from 768px.
- `pages/invite/accept.vue:38-39`: the same, with `max-w-md`.
- `app/error.vue:32-33`: the same, without a card.

**Print pages.** Two pages print by hand, each with a scoped `@media print` that hides `body *` by `visibility` and positions its own scope absolutely:
- `pages/meetings/[id]/print.vue:99-116`, scope `.meeting-print-page`;
- `pages/projects/[id]/charter.vue:106-123`, scope `.project-charter-print-scope` (`:86`).

Neither page removes the shell's offsets, and neither forces black on white, so a print from dark mode is light text on white paper.

**The template.** `variant="card"` is the page's `<main>`. `variant="print"` is an `<article class="webvue-print">` that sits inside the shell's `<main>` on screen. The print rules go in `assets/css/components.css`, a `THEME_OWNERS` file (`tools/ui_policy.py:63-70`):
- In print, the shell header, module rail, context sidebar and mobile trigger are dropped, and the workspace loses their offsets. This holds on every page, because paper never needs app chrome.
- `.webvue-print` resets the Nuxt UI tokens, and the `tokens.css:59-75` aliases (which `:root` resolves once), to black on white. Every utility inside then follows, in either appearance.
- `.webvue-print-hide` (the footer actions) is not printed.

The two print pages move onto the variant in Plan 6, which can then delete their scoped blocks and shrink `STYLE_OWNERS`.

**Files:**
- Create: `apps/web/app/components/shared/StandalonePage.vue`
- Create: `apps/web/app/components/shared/__tests__/StandalonePage.test.ts`, `apps/web/app/assets/css/__tests__/print.test.ts`
- Modify: `apps/web/app/assets/css/components.css` (append the print block after `:106`)
- Create: `apps/web/stories/shared/StandalonePage.stories.ts`
- Modify: `tools/ui_policy.py` (`STORYBOOK_COMPONENTS`), `apps/web/e2e/support/visualStories.ts`, `docs/design-system/components.md`
- Modify: `apps/web/e2e/storybook-display-templates.spec.ts` (one describe)
- Regenerate: `docs/design-system/catalog.json`; new PNGs `shared-standalonepage--*`

**Interfaces:**
- Consumes: `renderShared` (Task 1); `open`, `boxOf` (Task 10); `ShellFrame`, `ShellHeader`, `AppSidebar` and `shellHandlers` for the in-shell story (unchanged).
- Produces:
  - `SharedStandalonePage`: props `{ variant?: 'card' | 'print' (default 'card'); title?: string }`, slots `default`, `footer`.
    - `card` renders `<main data-template="standalone-page" data-variant="card">` with a centred `UCard`. `title` is its `h1`, and `footer` is the card footer.
    - `print` renders `<article class="webvue-print" data-template="standalone-page" data-variant="print">`. `title` is its `h1`, and `footer` is a `<footer class="webvue-print-hide">`.
  - CSS contract (`components.css`, `@media print`):
    - `.webvue-print` prints black on white;
    - `.webvue-print-hide` is not printed;
    - the shell chrome is never printed.
  - No new strings.

- [ ] **Step 1: Failing tests**

Create `apps/web/app/components/shared/__tests__/StandalonePage.test.ts`:

```ts
import { h } from 'vue'
import { describe, expect, it } from 'vitest'
import { renderShared } from './helpers/renderShared'

const body = { default: () => h('form', { 'data-body': '' }), footer: () => h('button', 'Print') }

describe('SharedStandalonePage', () => {
  it('card is the page main with a centred card, its title as h1 and the footer in the card', async () => {
    const html = await renderShared('StandalonePage', { title: 'Sign in' }, body)
    expect(html.startsWith('<main')).toBe(true)
    expect(html).toContain('data-variant="card"')
    expect(html).toContain('min-h-svh')
    expect(html).toMatch(/<h1[^>]*>Sign in<\/h1>/)
    expect(html.indexOf('data-body')).toBeLessThan(html.indexOf('>Print<'))
    expect(html).not.toContain('webvue-print')
  })

  it('print is an article inside the shell main, black-on-white class, footer not printed', async () => {
    const html = await renderShared('StandalonePage', { variant: 'print', title: 'Minutes' }, body)
    expect(html.startsWith('<article')).toBe(true)
    expect(html).not.toContain('<main')
    expect(html).toMatch(/class="webvue-print[ "]/)
    expect(html).toContain('data-variant="print"')
    expect(html).toMatch(/<h1[^>]*>Minutes<\/h1>/)
    expect(html).toMatch(/<footer class="webvue-print-hide[^"]*">(?:<!--\[-->)?<button>Print<\/button>/)
  })

  it('renders no heading and no footer when they are not given', async () => {
    for (const variant of ['card', 'print']) {
      const html = await renderShared('StandalonePage', { variant }, { default: () => h('p', 'x') })
      expect(html, variant).not.toContain('<h1')
      expect(html, variant).not.toContain('<footer')
    }
  })
})
```

Create `apps/web/app/assets/css/__tests__/print.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(import.meta.dirname, '..', 'components.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/** The body of the `@media print { … }` block, brace-matched. */
function printBlock(source: string): string {
  const start = source.indexOf('@media print')
  if (start < 0) return ''
  const open = source.indexOf('{', start)
  let depth = 0
  for (let index = open; index < source.length; index++) {
    if (source[index] === '{') depth++
    else if (source[index] === '}' && --depth === 0) return source.slice(open + 1, index)
  }
  return ''
}

/** Declarations of every rule in `block` whose selector list names `selector`. */
function declarations(block: string, selector: string): Map<string, string> {
  const found = new Map<string, string>()
  for (const match of block.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!match[1]!.split(',').map(part => part.trim()).includes(selector)) continue
    for (const declaration of match[2]!.split(';')) {
      const colon = declaration.indexOf(':')
      if (colon > 0) found.set(declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim())
    }
  }
  return found
}

const print = printBlock(css)

describe('the print sheet', () => {
  it('never prints the shell chrome or a .webvue-print-hide element', () => {
    for (const selector of ['.webvue-shell-header', '.webvue-module-rail', '.webvue-context-sidebar', '.webvue-mobile-menu-trigger', '.webvue-print-hide']) {
      expect(declarations(print, selector).get('display'), selector).toBe('none !important')
    }
    expect(declarations(print, '.webvue-shell-workspace').get('margin-inline-start')).toBe('0 !important')
    expect(declarations(print, '.webvue-shell-workspace').get('padding-block-start')).toBe('0 !important')
  })

  it('prints a .webvue-print page black on white through the tokens and their aliases', () => {
    const page = declarations(print, '.webvue-print')
    for (const token of ['--ui-bg', '--ui-bg-muted', '--ui-bg-elevated', '--ui-bg-accented', '--background', '--card', '--muted']) {
      expect(page.get(token), token).toBe('#fff')
    }
    for (const token of ['--ui-text', '--ui-text-highlighted', '--ui-text-muted', '--ui-text-toned', '--ui-text-dimmed', '--ui-border', '--ui-border-muted', '--ui-border-accented', '--foreground', '--muted-foreground', '--border']) {
      expect(page.get(token), token).toBe('#000')
    }
    expect(page.get('color')).toBe('#000')
    expect(page.get('background')).toBe('#fff')
  })

  it('uses logical properties only', () => {
    expect(print).not.toMatch(/(?:margin|padding|border)-(?:left|right)\b|(?:^|[\s;{])(?:left|right)\s*:/)
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim/apps/web && npx vitest run app/components/shared/__tests__/StandalonePage.test.ts app/assets/css/__tests__/print.test.ts
```

Expected: FAIL. The three StandalonePage tests fail with `ENOENT … StandalonePage.vue`. In the print sheet, the first two tests fail (`expected undefined to be 'none !important'`, then `'#fff'`), and "uses logical properties only" passes on the empty block.

- [ ] **Step 3: `StandalonePage.vue`**

Create `apps/web/app/components/shared/StandalonePage.vue`:

```vue
<script setup lang="ts">
// A page outside the shell's chrome (Tasmim Plan 4). `card` centres one card on the page
// surface (sign-in, invitations, the error page) and is the page's <main>. `print` is a
// document that sits in the shell's <main> on screen and prints black on white without
// the shell (assets/css/components.css, @media print); its `footer` (print and back
// actions) is not printed.
const props = withDefaults(defineProps<{
  variant?: 'card' | 'print'
  title?: string
}>(), {
  variant: 'card',
})
</script>

<template>
  <main v-if="props.variant === 'card'" data-template="standalone-page" data-variant="card" class="grid min-h-svh place-items-center bg-default p-4 md:p-10">
    <UCard class="w-full max-w-md">
      <template v-if="props.title" #header>
        <h1 class="text-center text-2xl font-semibold text-highlighted">{{ props.title }}</h1>
      </template>
      <slot />
      <template v-if="$slots.footer" #footer>
        <slot name="footer" />
      </template>
    </UCard>
  </main>
  <article v-else class="webvue-print webvue-page-width-detail grid min-w-0 gap-6" data-template="standalone-page" data-variant="print">
    <h1 v-if="props.title" class="text-2xl font-semibold text-highlighted">{{ props.title }}</h1>
    <slot />
    <footer v-if="$slots.footer" class="webvue-print-hide flex flex-wrap items-center justify-end gap-2">
      <slot name="footer" />
    </footer>
  </article>
</template>
```

(`class` comes first on the `<article>` so the test's `class="webvue-print` match holds.)

- [ ] **Step 4: The print sheet**

Append to `apps/web/app/assets/css/components.css` (after `:106`):

```css
/* Print (Tasmim Plan 4). Paper never carries the app chrome: the header, the module
   rail, the context sidebar, the mobile trigger and anything marked .webvue-print-hide are
   dropped, and the workspace loses their offsets. A print page (SharedStandalonePage
   variant="print", .webvue-print) is black on white in either appearance: it resets the
   Nuxt UI tokens and the tokens.css aliases (resolved once on :root), so every utility
   inside follows. */
@media print {
  .webvue-shell-header,
  .webvue-module-rail,
  .webvue-context-sidebar,
  .webvue-mobile-menu-trigger,
  .webvue-print-hide { display: none !important; }
  .webvue-shell-workspace { min-height: 0; margin-inline-start: 0 !important; padding-block-start: 0 !important; }
  .webvue-shell-main { min-height: 0; padding: 0 !important; overflow: visible !important; }
  :root:has(.webvue-print),
  :root:has(.webvue-print) :is(body, .webvue-shell, .webvue-shell-workspace, .webvue-shell-main) {
    background: #fff !important;
    color-scheme: light;
  }
  .webvue-print {
    --ui-bg: #fff;
    --ui-bg-muted: #fff;
    --ui-bg-elevated: #fff;
    --ui-bg-accented: #fff;
    --ui-text: #000;
    --ui-text-highlighted: #000;
    --ui-text-muted: #000;
    --ui-text-toned: #000;
    --ui-text-dimmed: #000;
    --ui-border: #000;
    --ui-border-muted: #000;
    --ui-border-accented: #000;
    --background: #fff;
    --card: #fff;
    --muted: #fff;
    --foreground: #000;
    --muted-foreground: #000;
    --border: #000;
    max-width: none;
    background: #fff;
    color: #000;
  }
  .webvue-print * { box-shadow: none !important; }
}
```

- [ ] **Step 5: Run the tests to see them pass**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim/apps/web && npx vitest run app/components/shared/__tests__/StandalonePage.test.ts app/assets/css/__tests__
```

Expected: PASS (3 StandalonePage tests, 3 print-sheet tests, and the existing `tokens.test.ts` unchanged).

- [ ] **Step 6: Stories**

Create `apps/web/stories/shared/StandalonePage.stories.ts`:

```ts
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { useI18n } from 'vue-i18n'
import AppSidebar from '../../app/components/shell/AppSidebar.vue'
import ShellFrame from '../../app/components/shell/ShellFrame.vue'
import ShellHeader from '../../app/components/shell/ShellHeader.vue'
import StandalonePage from '../../app/components/shared/StandalonePage.vue'
import { __getRouter } from '../../.storybook/nuxt-shims'
import { shellHandlers } from '../handlers/shell'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/StandalonePage',
  component: StandalonePage,
  parameters: {
    layout: 'fullscreen',
    a11y: { test: 'error' },
    ...storyContext('unused', 'صفحة خارج إطار التطبيق: `card` بطاقة في وسط الصفحة (الدخول، الدعوة، صفحة الخطأ)، و`print` وثيقة تُطبع أسود على أبيض بلا إطار التطبيق، وتذييلها لا يُطبع.'),
  },
  args: { variant: 'card' },
} satisfies Meta<typeof StandalonePage>
export default meta
type Story = StoryObj<typeof meta>

const DOCUMENT = `
  <dl class="grid gap-3 sm:grid-cols-2">
    <div class="grid gap-1 rounded-lg p-3 ring ring-default"><dt class="text-xs text-muted">{{ t('meetingMinutesForm.date') }}</dt><dd dir="ltr" class="text-highlighted">2026-10-05</dd></div>
    <div class="grid gap-1 rounded-lg p-3 ring ring-default"><dt class="text-xs text-muted">{{ t('meetingMinutesForm.chairperson') }}</dt><dd class="text-highlighted">سارة القحطاني</dd></div>
  </dl>
  <p class="text-sm leading-7 text-default">اطّلع المجتمعون على خطة الربع الرابع، واتفقوا على مراجعة الميزانية قبل نهاية الشهر وتوزيع المهام على الفرق.</p>
  <template #footer>
    <UButton color="neutral" variant="outline" :label="t('app.back')" />
    <UButton icon="i-lucide-printer" :label="t('meetingMinutesForm.print')" />
  </template>`

export const Card: Story = {
  name: 'بطاقة',
  render: () => ({
    components: { StandalonePage },
    setup: () => ({ t: useI18n().t }),
    template: `<StandalonePage :title="t('auth.signIn')">
      <form class="grid gap-4" @submit.prevent>
        <UFormField :label="t('auth.username')" name="login"><UInput id="story-login" class="w-full" dir="ltr" autocomplete="username" /></UFormField>
        <UFormField :label="t('auth.password')" name="password"><UInput id="story-password" type="password" class="w-full" dir="ltr" autocomplete="current-password" /></UFormField>
        <UButton type="submit" class="w-full justify-center" :label="t('auth.signIn')" />
      </form>
    </StandalonePage>`,
  }),
}

export const Print: Story = {
  name: 'وثيقة للطباعة',
  render: () => ({
    components: { StandalonePage },
    setup: () => ({ t: useI18n().t }),
    template: `<main class="webvue-shell-main"><StandalonePage variant="print" :title="t('meetingMinutesForm.documentTitle')">${DOCUMENT}</StandalonePage></main>`,
  }),
}

export const PrintInShell: Story = {
  name: 'وثيقة للطباعة داخل الإطار',
  parameters: { msw: { handlers: { api: shellHandlers } } },
  loaders: [async () => { await __getRouter()!.replace('/tasks'); return {} }],
  render: () => ({
    components: { AppSidebar, ShellFrame, ShellHeader, StandalonePage },
    setup: () => ({ t: useI18n().t }),
    template: `<ShellFrame>
      <template #header><ShellHeader /></template>
      <template #sidebar><AppSidebar /></template>
      <main class="webvue-shell-main" data-testid="shell-main"><StandalonePage variant="print" :title="t('meetingMinutesForm.documentTitle')">${DOCUMENT}</StandalonePage></main>
    </ShellFrame>`,
  }),
}
```

- [ ] **Step 7: Lists, docs and the print check**

`tools/ui_policy.py`, one line before the closing `))` of `STORYBOOK_COMPONENTS`:

```python
    'shared/StandalonePage.vue',
```

`apps/web/e2e/support/visualStories.ts`:
- `VISUAL_STORIES`: add `'shared-standalonepage--',`;
- `VISUAL_MOBILE_STORIES`: add `'shared-standalonepage--card'` (the page padding drops from 2.5rem to 1rem; sign-in is phone-critical);
- `VISUAL_AXE_STORIES`: add `'shared-standalonepage--',`.

`docs/design-system/components.md`, one row appended to the Task 1 section table:

```markdown
| `apps/web/app/components/shared/StandalonePage.vue` | `apps/web/stories/shared/StandalonePage.stories.ts` | `UCard`؛ `card` هي `<main>` الصفحة، و`print` وثيقة `.webvue-print` تُطبع أسود على أبيض بلا إطار التطبيق (`assets/css/components.css`) |
```

Append to `apps/web/e2e/storybook-display-templates.spec.ts`:

```ts
test.describe('Tasmim standalone page and print sheet', () => {
  requireStorybook()
  test.use({ viewport: { width: 1440, height: 900 } })
  test.beforeAll(async () => { ({ base, close } = await startStorybookServer()) })
  test.afterAll(async () => { await close() })

  for (const appearance of ['light', 'dark'] as const) {
    test(`print drops the shell and prints the page black on white (${appearance})`, async ({ page }) => {
      await open(page, 'shared-standalonepage--print-in-shell', `locale:ar;appearance:${appearance}`)
      const sheet = page.locator('.webvue-print')
      await expect(page.getByTestId('shell-header')).toBeVisible()
      await expect(page.getByTestId('module-rail')).toBeVisible()
      if (appearance === 'dark') await expect(sheet).not.toHaveCSS('color', 'rgb(0, 0, 0)')

      await page.emulateMedia({ media: 'print' })
      for (const id of ['shell-header', 'module-rail', 'context-sidebar']) await expect(page.getByTestId(id)).toBeHidden()
      await expect(sheet.locator('.webvue-print-hide')).toBeHidden()
      await expect(sheet).toHaveCSS('color', 'rgb(0, 0, 0)')
      await expect(sheet).toHaveCSS('background-color', 'rgb(255, 255, 255)')
      await expect(sheet.getByRole('heading', { level: 1 })).toHaveCSS('color', 'rgb(0, 0, 0)')
      await expect(sheet.locator('dt').first()).toHaveCSS('color', 'rgb(0, 0, 0)')
      for (const target of [page.locator('body'), page.getByTestId('shell-main')]) {
        await expect(target).toHaveCSS('background-color', 'rgb(255, 255, 255)')
      }
      const main = await boxOf(page.getByTestId('shell-main'))
      expect(main.x).toBeCloseTo(0, 0)
      expect(main.y).toBeCloseTo(0, 0)
      expect(main.width).toBeGreaterThan(1400)
    })
  }

  test('the card variant is the page main and centres its card', async ({ page }) => {
    await open(page, 'shared-standalonepage--card', 'locale:ar;appearance:light')
    await expect(page.getByRole('main')).toHaveCount(1)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    const card = await boxOf(page.locator('[data-template="standalone-page"] form'))
    expect(card.x + card.width / 2).toBeCloseTo(720, -1)
  })
})
```

- [ ] **Step 8: Gates and baselines**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim
node tools/ui_catalog.mjs
npm -w apps/web run lint && npm test 2>&1 | tail -3 && python3 -B tools/ui_policy.py && python3 -B tools/arch_policy.py
cd apps/web && npm run build-storybook >/dev/null
npx playwright test e2e/storybook-display-templates.spec.ts -g 'standalone page' --reporter=line
npx playwright test e2e/storybook-visual.spec.ts -g 'shared-standalonepage' --update-snapshots=missing --reporter=line
WEBVUE_REQUIRE_STORYBOOK=1 npx playwright test e2e/storybook-visual.spec.ts -g 'shared-standalonepage|shell-shellframe' --reporter=line 2>&1 | tail -5
WEBVUE_REQUIRE_STORYBOOK=1 npx playwright test e2e/storybook-smoke.spec.ts -g 'shared-standalonepage' --reporter=line | tail -3
git status --short e2e/storybook-visual.spec.ts-snapshots | grep -v -E 'shared-standalonepage--' ; echo "unexpected=$?"
```

Expected:
- Lint, `npm test` (6 new tests) and both policies pass.
- The print spec passes 3 tests.
- 16 PNGs are written: 3 stories × 4, plus `--card` × 4 on mobile.
- The second run passes all of them, the three axe tests (one per story), and the unchanged `shell-shellframe--*` screenshots. The print block applies only to print media, so screen baselines must not move.
- The smoke tests pass, and the `grep -v` check prints `unexpected=1`.

- [ ] **Step 9: Commit**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim
git add apps/web/app/components/shared/StandalonePage.vue apps/web/app/components/shared/__tests__/StandalonePage.test.ts \
  apps/web/app/assets/css/components.css apps/web/app/assets/css/__tests__/print.test.ts \
  apps/web/stories/shared/StandalonePage.stories.ts apps/web/e2e/storybook-display-templates.spec.ts \
  apps/web/e2e/support/visualStories.ts apps/web/e2e/storybook-visual.spec.ts-snapshots \
  tools/ui_policy.py docs/design-system/components.md docs/design-system/catalog.json
git commit -m "feat(web): add StandalonePage and a black-on-white print sheet

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 13: A prominent dark-mode primary button (CP2 owner amendment 4)

**Why it looks weak today.** Nuxt UI paints the solid primary button `bg-primary text-inverted` (`.nuxt/ui/button.ts:125`). In dark mode `--ui-primary` is `--ui-color-primary-400` (`node_modules/@nuxt/ui/dist/runtime/plugins/colors.js:34-36`), which is `--color-brand-400` = `var(--brand-link)` (`tokens.css:146`). `createBrandTheme` (`brandTheme.ts:168`) derives `--brand-link` by mixing the primary toward white until it reaches 4.5:1 on every dark surface. For the default midnight that gives `#a1a7b7`: 7.8:1 against `#0a1124`, but its HSL saturation falls from 0.59 to 0.13, so the button reads as a grey, almost disabled control (CP2 `projects-ar-dark-desktop.png`, «مشروع جديد»). The problem is chroma, not contrast.

**Change.** A new derived step, `--primary-solid`, used only by the dark solid primary button:

- Keep the primary's hue. Keep its saturation, raised to at least 0.55 unless the colour is near-neutral (saturation < 0.12, for example black or `#18181b`).
- Take the darkest HSL lightness at which the colour reaches at least 3:1 against the page surfaces `#0a1124`, `#0f182f` and `#15203b`, and the label (black or white, whichever reads better) reaches at least 4.5:1.
- A tenant colour that already meets both rules keeps its own value.
- Hover and pressed reuse the existing `interaction()` helper.

For midnight the result is `#3c66cd` with a white label: 5.28:1 for the label and 3.05:1 against the page (3.55:1 on `#0a1124`).

`--brand-link` (links, text-primary, focus outline, `outline-primary/25`) is not changed. The light-mode button is not changed either, because the recipe applies only under `dark:`. Lime is never chosen, because the derivation starts from the tenant hue. A tenant who picks lime keeps lime: their choice is not changed (DESIGN.md §2).

Values checked with the real `brandTheme.ts` on 2026-10-13. Each row gives: solid / label → label ratio, lowest page ratio.

| Primary | Dark solid | Label ratio | Lowest page ratio |
|---|---|---|---|
| `#13234a` | `#3c66cd` / `#ffffff` | 5.28 | 3.05 |
| `#000000` | `#6b6b6b` / `#ffffff` | 5.33 | 3.03 |
| `#4c0519` | `#d30e45` / `#ffffff` | 5.36 | 3.01 |
| `#0055ff` | `#0a5cff` / `#ffffff` | 5.27 | 3.06 |
| `#e11d48` | `#e11d48` (kept) / `#ffffff` | 4.70 | 3.43 |
| `#0f766e` | `#11887f` / `#000000` | 4.85 | 3.73 |
| `#facc15` | `#facc15` (kept) / `#000000` | 13.71 | 10.53 |
| `#ffffff` | `#ffffff` (kept) / `#000000` | 21.00 | 16.13 |

**Files:**
- Modify: `apps/web/app/utils/brandTheme.ts` (new `darkSolid` after `interaction`, `:150-161`; `createBrandTheme` `:163-199` gains `solid` and four keys)
- Modify: `apps/web/app/app.config.ts:10` (button `compoundVariants` gains the dark solid entry)
- Modify: `apps/web/app/assets/css/tokens.css` (`:root` after `:34`; `.dark` after `:136`)
- Modify: `DESIGN.md:61`, `DESIGN.md:74`
- Test: `apps/web/app/utils/__tests__/brandTheme.test.ts` (key list `:183-232`; a new test in `describe('WebVue palette in the brand engine')`, before `:260`)
- Test: `apps/web/app/assets/css/__tests__/tokens.test.ts` (new `describe` at the end, after `:59`)
- Re-baseline: `apps/web/e2e/storybook-visual.spec.ts-snapshots/*` (the intended list in Step 6 only)
- Create (not committed): `.superpowers/tasmim-shared/cp4/primary-before/*.png`

**Interfaces:**
- Consumes: `DARK_SURFACES`, `contrastRatio` (`utils/webvuePalette.ts`); the private `interaction`, `foregroundFor`, `hexToHsl` and `hslToHex` in `brandTheme.ts`.
- Produces:
  - `darkSolid(hex: string): string` (exported from `utils/brandTheme.ts`);
  - `createBrandTheme(input, mode)` also returns `--primary-solid`, `--primary-solid-foreground`, `--primary-solid-hover` and `--primary-solid-hover-foreground`, in both modes. In light mode they are `interaction(--brand-link)` and are not read by any recipe.
  - The button recipe paints the solid primary button in dark mode from these four tokens. `tokens.css` declares the same keys, with the default-midnight values under `.dark`, for pages rendered before branding loads.

- [ ] **Step 1: Save the "before" images for CP4**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim
mkdir -p .superpowers/tasmim-shared/cp4/primary-before
cp apps/web/e2e/storybook-visual.spec.ts-snapshots/shared-pageheader--with-actions-*-dark-darwin.png \
   apps/web/e2e/storybook-visual.spec.ts-snapshots/foundations-density--controls-*-dark-darwin.png \
   .superpowers/tasmim-shared/cp4/primary-before/
cp .superpowers/tasmim-shared/cp2/projects-ar-dark-desktop.png .superpowers/tasmim-shared/cp4/primary-before/projects-ar-dark-desktop.png
cp .superpowers/tasmim-shared/cp2/projects-en-dark-desktop.png .superpowers/tasmim-shared/cp4/primary-before/projects-en-dark-desktop.png
ls .superpowers/tasmim-shared/cp4/primary-before | wc -l
```

Expected: `6`. `.superpowers/` is not committed.

- [ ] **Step 2: Write the failing tests**

In `apps/web/app/utils/__tests__/brandTheme.test.ts`, change the import on line 3 to:

```ts
import { contrastRatio, DARK_SURFACES } from '../webvuePalette'
```

In the expected key list of `'returns only the primary-derived CSS custom properties'` (`:183`), insert after `'--primary-soft-foreground',` (`:205`):

```ts
      '--primary-solid',
      '--primary-solid-foreground',
      '--primary-solid-hover',
      '--primary-solid-hover-foreground',
```

Inside `describe('WebVue palette in the brand engine', …)`, before its closing `})` on line 260, add:

```ts
  // Owner amendment 4 (CP2): the dark solid primary must stand out from the page, not read as a grey control.
  const PAGE_SURFACES = [DARK_SURFACES.bg, DARK_SURFACES.muted, DARK_SURFACES.elevated]
  const SAMPLED_PRIMARIES = [DEFAULT_PRIMARY, '#000000', '#4c0519', '#18181b', '#0055ff', '#e11d48', '#7c3aed', '#0f766e', '#a855f7', '#facc15', '#ffffff', '#c8f031']
  function saturation(hex: string): number {
    const [r, g, b] = [1, 3, 5].map(index => Number.parseInt(hex.slice(index, index + 2), 16) / 255) as [number, number, number]
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const l = (max + min) / 2
    return max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1))
  }

  it('keeps the dark solid primary readable and visible for sampled tenant primaries', () => {
    for (const primary of SAMPLED_PRIMARIES) {
      const theme = createBrandTheme(primary, 'dark')
      const solid = theme['--primary-solid']!
      expect(contrastRatio(solid, theme['--primary-solid-foreground']!), `${primary} label`).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(theme['--primary-solid-hover']!, theme['--primary-solid-hover-foreground']!), `${primary} hover label`).toBeGreaterThanOrEqual(4.5)
      for (const surface of PAGE_SURFACES) {
        expect(contrastRatio(solid, surface), `${primary} on ${surface}`).toBeGreaterThanOrEqual(3)
      }
      // A chromatic brand keeps visible colour instead of greying out like --brand-link.
      if (saturation(primary) >= 0.12) expect(saturation(solid), `${primary} saturation`).toBeGreaterThanOrEqual(0.5)
      // The tenant choice itself is never rewritten.
      expect(theme['--primary']).toBe(primary)
    }
  })

  it('derives the default dark solid from midnight, never lime, and keeps light mode on midnight', () => {
    const dark = createBrandTheme(DEFAULT_PRIMARY, 'dark')
    expect(dark['--primary-solid']).toBe('#3c66cd')
    expect(dark['--primary-solid-foreground']).toBe('#ffffff')
    expect(dark['--primary-solid']).not.toBe('#c8f031')
    // Links, text-primary and focus keep the lighter text tone.
    expect(dark['--brand-link']).toBe('#a1a7b7')
    const light = createBrandTheme(DEFAULT_PRIMARY, 'light')
    expect(light['--primary']).toBe('#13234a')
    expect(light['--brand-link']).toBe('#13234a')
  })

  it('keeps a tenant colour that already passes as its own dark solid', () => {
    for (const primary of ['#e11d48', '#facc15', '#ffffff']) {
      expect(createBrandTheme(primary, 'dark')['--primary-solid']).toBe(primary)
    }
  })
```

At the end of `apps/web/app/assets/css/__tests__/tokens.test.ts`, add the import `import { createBrandTheme, DEFAULT_PRIMARY } from '../../../utils/brandTheme'` next to the existing `webvuePalette` import on line 4, and this block:

```ts
describe('dark solid primary defaults', () => {
  it('tokens.css .dark matches createBrandTheme for the default midnight', () => {
    const found = declarations(ruleBodies(sheet('tokens.css'), '.dark'))
    const theme = createBrandTheme(DEFAULT_PRIMARY, 'dark')
    for (const token of ['--primary-solid', '--primary-solid-foreground', '--primary-solid-hover', '--primary-solid-hover-foreground']) {
      expect(found.get(token)?.toLowerCase(), token).toBe(theme[token])
    }
  })
})
```

- [ ] **Step 3: Run them and see them fail**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim/apps/web && npx vitest run app/utils/__tests__/brandTheme.test.ts app/assets/css/__tests__/tokens.test.ts 2>&1 | tail -15
```

Expected: FAIL in five tests: the key list, the three new brand-engine tests (`--primary-solid` is `undefined`) and `dark solid primary defaults`. Every existing test passes.

- [ ] **Step 4: Derive `--primary-solid`**

In `apps/web/app/utils/brandTheme.ts`, after `interaction()` (ends on line 161), insert:

```ts
// The dark-mode solid primary button (owner amendment 4, CP2). --brand-link mixes the
// primary toward white until it reads as text on every dark surface, which turns a deep
// brand grey (#13234a -> #a1a7b7). The button keeps the hue instead, holds saturation at
// 0.55 or more (near-neutral brands stay neutral), and takes the darkest lightness that
// stands 3:1 off the page surfaces under a 4.5:1 label. A colour that already passes is kept.
const SOLID_PAGE_SURFACES = [DARK_SURFACES.bg, DARK_SURFACES.muted, DARK_SURFACES.elevated]

function solidReadable(candidate: string): boolean {
  return SOLID_PAGE_SURFACES.every(surface => contrastRatio(candidate, surface) >= 3)
    && contrastRatio(candidate, foregroundFor(candidate)) >= 4.5
}

export function darkSolid(hex: string): string {
  if (solidReadable(hex)) return hex
  const { h, s, l } = hexToHsl(hex)
  const saturation = s < 0.12 ? s : Math.max(s, 0.55)
  for (let step = Math.round(Math.max(l, 0.3) * 100); step <= 100; step += 1) {
    const candidate = hslToHex(h, saturation, step / 100)
    if (solidReadable(candidate)) return candidate
  }
  return '#ffffff'
}
```

In `createBrandTheme`, after `const ring = contrastTone(primary.hex, 3, mode)` (line 169), add:

```ts
  // Read only by the dark solid button recipe (app.config.ts); light keeps the stock button.
  const solid = interaction(mode === 'dark' ? darkSolid(primary.hex) : link)
```

In the returned object, after `'--primary-soft-foreground': foregroundFor(soft),` (line 186), add:

```ts
    '--primary-solid': solid.hex,
    '--primary-solid-foreground': solid.foreground,
    '--primary-solid-hover': solid.hover,
    '--primary-solid-hover-foreground': solid.hoverForeground,
```

- [ ] **Step 5: Tokens and the button recipe**

In `apps/web/app/assets/css/tokens.css`, after `--primary-soft-foreground: var(--ui-text);` (line 34), add:

```css
  /* Solid primary button in dark mode (brandTheme.ts darkSolid); light keeps the stock button. */
  --primary-solid: var(--brand-link);
  --primary-solid-foreground: #fff;
  --primary-solid-hover: var(--primary-hover);
  --primary-solid-hover-foreground: var(--primary-hover-foreground);
```

In the `.dark` block, after `--rail-hover: #1a2a52;` (line 136), add:

```css
  /* Default-midnight dark solid primary; brandTheme.ts overwrites it from the company colour. */
  --primary-solid: #3c66cd;
  --primary-solid-foreground: #ffffff;
  --primary-solid-hover: #3154a8;
  --primary-solid-hover-foreground: #ffffff;
```

In `apps/web/app/app.config.ts`, replace line 10 with:

```ts
    // The 32px control floor applies to the default (md) size only; xs/sm stay compact.
    // Dark mode: the solid primary paints from --primary-solid (brandTheme.ts darkSolid), not the
    // greyed --brand-link that text-primary and focus keep (owner amendment 4, CP2).
    button: { slots: { base: 'rounded-md transition-colors duration-150 motion-reduce:transition-none' }, variants: { size: { md: { base: 'min-h-(--webvue-control-h)' } } }, compoundVariants: [{ size: 'md', square: true, class: 'min-w-(--webvue-control-h)' }, { color: 'primary', variant: 'solid', class: 'dark:bg-(--primary-solid) dark:text-(--primary-solid-foreground) dark:hover:bg-(--primary-solid-hover) dark:hover:text-(--primary-solid-hover-foreground) dark:active:bg-(--primary-solid-hover) dark:active:text-(--primary-solid-hover-foreground) dark:disabled:bg-(--primary-solid) dark:aria-disabled:bg-(--primary-solid)' }] },
```

The existing comment on line 9 is replaced by the first comment line above, so the file gains two comment lines. `color` and `variant` are omitted on the default button, but tailwind-variants matches compound variants against `defaultVariants` (`primary`/`solid`), so a bare `<UButton>` is covered. `ui_policy.theme_errors` keys only the four-space `button:` line, which is unchanged.

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim/apps/web && npx vitest run app/utils/__tests__/brandTheme.test.ts app/assets/css/__tests__/tokens.test.ts app/composables/__tests__/useBranding.test.ts 2>&1 | tail -5
```

Expected: all pass.

- [ ] **Step 6: DESIGN.md**

On `DESIGN.md:61`, replace «أزرار الأساسي الممتلئة تعبئة هادئة بلا تدرج لامع، مع زوج نص مرور/ضغط مولَّد.» with:

> أزرار الأساسي الممتلئة تعبئة هادئة بلا تدرج لامع، مع زوج نص مرور/ضغط مولَّد. في الوضع الداكن يُرسم الزر من `--primary-solid`: نفس درجة لون العميل بتشبع لا يقل عن 0.55، وأغمق إضاءة تحقق 3:1 مع أسطح الصفحة و4.5:1 للنص. لون يحقق ذلك أصلًا يبقى كما هو.

On `DESIGN.md:74`, replace the row with:

> | الإجراء الرئيسي | `--ui-primary` فاتحًا، و`--primary-solid` داكنًا | حفظ، إنشاء، منح — أساسي ممتلئ واحد لكل منطقة |

- [ ] **Step 7: Visual re-baselines (intended list)**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim
npm -w apps/web run lint && npm test 2>&1 | tail -3
cd apps/web && npm run build-storybook >/dev/null
WEBVUE_REQUIRE_STORYBOOK=1 npx playwright test e2e/storybook-visual.spec.ts --reporter=line 2>&1 | grep -E '^\s+[0-9]+\) ' | sed -E 's/.*› //' | sort
```

Expected: only the following tests fail. Every failing title ends in `-dark` or `-dark mobile`, except the `foundations-colors--brand-*` light shots, which gain four token rows.

| Family | Why it changes |
|---|---|
| `foundations-density--controls-{ar,en}-dark` | «حفظ», «صغير», «متوسط» and the `+` icon button are solid primary |
| `foundations-colors--brand-{ar,en}-{light,dark}` | four new `--primary-solid*` rows in the Brand token table (light rows show the light values) |
| `shared-pageheader--with-actions-{ar,en}-dark` | the «مهمة جديدة» create button |
| `shared-emptystate--in-task-table-{ar,en}-dark` | the size-sm action button |
| Plan 4 template families with a default `UButton` in their story: `shared-listpage--*-dark` (create), `shared-createpanel--*-dark` and the Task 9 form story (save), `shared-recordpage--*-dark` (actions), `shared-dashboardpage--*-dark`, `shared-standalonepage--*-dark`, plus their `-dark mobile` shots where listed in `VISUAL_MOBILE_STORIES` | the primary action in each template |

The template row is conditional: a family enters the list only if `rg -n "<UButton(?![^>]*color=)[^>]*>" apps/web/stories/shared/<Name>.stories.ts apps/web/app/components/shared/<Name>.vue` (run with `rg -P`) finds a default-colour `UButton`. Any other failing title is a defect: investigate before updating. A light-mode diff outside `foundations-colors--brand-*` means the recipe leaked out of `dark:`.

Then re-baseline exactly those families. For example, for the four fixed families:

```bash
WEBVUE_REQUIRE_STORYBOOK=1 npx playwright test e2e/storybook-visual.spec.ts --update-snapshots --reporter=line \
  -g '(foundations-density--controls|shared-pageheader--with-actions|shared-emptystate--in-task-table) (ar|en)-dark|foundations-colors--brand' | tail -3
```

Repeat with `-g '<family> (ar|en)-dark'` for each template family in the list. Then:

```bash
git status --short e2e/storybook-visual.spec.ts-snapshots | grep -v -E '(foundations-density--controls|shared-pageheader--with-actions|shared-emptystate--in-task-table|shared-(listpage|createpanel|recordpage|dashboardpage|standalonepage)--[a-z0-9-]+)-(ar|en)-dark(-mobile)?-darwin\.png|foundations-colors--brand-' ; echo "unexpected=$?"
WEBVUE_REQUIRE_STORYBOOK=1 npx playwright test e2e/storybook-visual.spec.ts --reporter=line 2>&1 | tail -3
```

Expected: `unexpected=1` (nothing outside the list), and the full visual run then passes, including every axe test.

- [ ] **Step 8: Commit**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim
git add apps/web/app/utils/brandTheme.ts apps/web/app/utils/__tests__/brandTheme.test.ts apps/web/app/app.config.ts \
  apps/web/app/assets/css/tokens.css apps/web/app/assets/css/__tests__/tokens.test.ts DESIGN.md apps/web/e2e/storybook-visual.spec.ts-snapshots
git commit -m "feat(web): give the dark solid primary button its own tone

Dark --ui-primary is --brand-link, which greys a deep brand out
(#13234a -> #a1a7b7). --primary-solid keeps the hue, holds saturation
and is the darkest tone at 3:1 on the page with a 4.5:1 label; it is
read only by the dark solid button. Re-baselines the dark shots of
foundations-density--controls, shared-pageheader--with-actions,
shared-emptystate--in-task-table, the template primary actions, and
foundations-colors--brand (new token rows).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Palette focus after a blocked navigation

**The bug.** These are the steps, with Plan 3's code:

1. A palette Go to option is a link. Enter clicks it, `toItem().onSelect` (`GlobalSearch.vue:56-61`) records `leavingFor`/`leavingFrom` and closes the palette, and the link's click starts `router.push`.
2. The unsaved-draft guard (`UnsavedChanges.vue:27-32`) blocks the push. It stores `document.activeElement` as `returnFocus`, which is the palette input, and opens its dialog.
3. When the palette finishes closing, `onCloseAutoFocus` (`:48-51`) sees `leavingFor !== leavingFrom` and prevents reka's restore. It expects `<main>` to take focus after a route change that never happens.
4. «البقاء في الصفحة» closes the draft dialog. `restoreFocus` (`:52-54`) finds the palette input disconnected, so focus falls to `<body>`.

**Fix.**

- **Hand-off.** A one-shot hand-off, `composables/useNavigationFocus.ts`. When the palette starts a link navigation it offers its trigger. The draft guard takes the offer before falling back to `document.activeElement`.
- **The palette watches the result.** It reads its own navigation's result through `router.afterEach(to, from, failure)`. Vue Router calls `afterEach` with the failure for aborted navigations; see `node_modules/vue-router/dist/vue-router.global.js:2562-2579`, where `triggerAfterEach(toLocation, from, failure)` runs on both branches. When a guard blocks the palette's navigation (`NavigationFailureType.aborted`), the palette:
  - clears `leavingFor`, so a palette that is still closing lets reka restore the trigger;
  - if the palette has already closed and nothing else holds focus, focuses the trigger itself.
- **No change for other results.** A completed navigation still focuses `<main>`. A superseded navigation (`cancelled`) leaves focus to the navigation that replaced it. A repeat of the current page (`duplicated`) is already handled by `shouldRestoreTriggerFocus`.

**Files:**
- Create: `apps/web/app/composables/useNavigationFocus.ts`
- Create: `apps/web/app/composables/__tests__/useNavigationFocus.test.ts`
- Modify: `apps/web/app/composables/usePalette.ts` (new export after `:49`)
- Modify: `apps/web/app/composables/__tests__/usePalette.test.ts` (new `describe` after `:16`)
- Modify: `apps/web/app/components/shell/GlobalSearch.vue` (`:10`, `:37-69`)
- Modify: `apps/web/app/components/shared/UnsavedChanges.vue` (`:1-3` import, `:29`)
- Test: `apps/web/e2e/shortcuts-tasmim.spec.ts` (new test before the closing `})` on `:135`)

**Interfaces:**
- Consumes: `shouldRestoreTriggerFocus` (`usePalette.ts:47`), the `data-testid="global-search-trigger"` button, and Vue Router's `afterEach`, `isNavigationFailure` and `NavigationFailureType`.
- Produces:
  - `offerNavigationFocus(target: () => HTMLElement | null): void`, `takeNavigationFocus(): HTMLElement | null` (one-shot; returns only a connected element) and `clearNavigationFocus(): void` in `composables/useNavigationFocus.ts`;
  - `paletteNavigationBlocked(failure: unknown): boolean` in `composables/usePalette.ts` (true only for `NavigationFailureType.aborted`).

- [ ] **Step 1: Write the failing unit tests**

Create `apps/web/app/composables/__tests__/useNavigationFocus.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest'
import { clearNavigationFocus, offerNavigationFocus, takeNavigationFocus } from '../useNavigationFocus'

const element = (isConnected = true) => ({ isConnected }) as unknown as HTMLElement

afterEach(() => clearNavigationFocus())

describe('navigation focus hand-off', () => {
  it('hands the offered element over once', () => {
    const trigger = element()
    offerNavigationFocus(() => trigger)
    expect(takeNavigationFocus()).toBe(trigger)
    expect(takeNavigationFocus()).toBeNull()
  })

  it('resolves the target when it is taken, not when it is offered', () => {
    let current: HTMLElement | null = null
    offerNavigationFocus(() => current)
    current = element()
    expect(takeNavigationFocus()).toBe(current)
  })

  it('never hands over a disconnected element', () => {
    offerNavigationFocus(() => element(false))
    expect(takeNavigationFocus()).toBeNull()
  })

  it('drops an offer that is cleared before anyone takes it', () => {
    offerNavigationFocus(() => element())
    clearNavigationFocus()
    expect(takeNavigationFocus()).toBeNull()
  })
})
```

Append to `apps/web/app/composables/__tests__/usePalette.test.ts`. Change line 2 to import `paletteNavigationBlocked` as well, and add `import { createMemoryHistory, createRouter, type NavigationFailure } from 'vue-router'` below it:

```ts
describe('paletteNavigationBlocked', () => {
  const component = { render: () => null }
  async function router(block: boolean) {
    const instance = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/a', component }, { path: '/b', component, beforeEnter: () => !block }],
    })
    await instance.push('/a')
    return instance
  }

  it('is true when a guard blocks the navigation, and afterEach receives that failure', async () => {
    const instance = await router(true)
    let seen: NavigationFailure | void = undefined
    instance.afterEach((_to, _from, failure) => { seen = failure })
    const result = await instance.push('/b')
    expect(paletteNavigationBlocked(result)).toBe(true)
    expect(paletteNavigationBlocked(seen)).toBe(true)
  })

  it('is false for a completed navigation and for a repeat of the current page', async () => {
    const instance = await router(false)
    expect(paletteNavigationBlocked(await instance.push('/b'))).toBe(false)
    expect(paletteNavigationBlocked(await instance.push('/b'))).toBe(false)
    expect(paletteNavigationBlocked(undefined)).toBe(false)
  })
})
```

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim/apps/web && npx vitest run app/composables/__tests__/useNavigationFocus.test.ts app/composables/__tests__/usePalette.test.ts 2>&1 | tail -8
```

Expected: FAIL. `useNavigationFocus` cannot be resolved, and `paletteNavigationBlocked` is not a function. The three existing `shouldRestoreTriggerFocus` tests pass.

- [ ] **Step 2: The hand-off and the predicate**

Create `apps/web/app/composables/useNavigationFocus.ts`:

```ts
// A one-shot hand-off for focus after a blocked navigation. An overlay that starts a
// navigation and closes before its result (the command palette) offers the element focus
// should return to; the unsaved-draft guard takes it when it blocks that navigation,
// because the element focused while the guard runs (the palette input) is gone by the
// time the user answers. Offers are made only from client event handlers.
let offered: (() => HTMLElement | null) | null = null

export function offerNavigationFocus(target: () => HTMLElement | null): void {
  offered = target
}

export function takeNavigationFocus(): HTMLElement | null {
  const target = offered?.() ?? null
  offered = null
  return target?.isConnected ? target : null
}

export function clearNavigationFocus(): void {
  offered = null
}
```

In `apps/web/app/composables/usePalette.ts`, add `import { isNavigationFailure, NavigationFailureType } from 'vue-router'` after line 1, and append after line 49:

```ts

/**
 * Whether a navigation the palette started was stopped by a guard (the unsaved-draft guard, or
 * middleware returning false). The page did not change, so nothing will focus <main>; the palette
 * returns focus to its trigger. A superseded (`cancelled`) navigation leaves focus to its successor.
 */
export function paletteNavigationBlocked(failure: unknown): boolean {
  return isNavigationFailure(failure, NavigationFailureType.aborted)
}
```

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim/apps/web && npx vitest run app/composables/__tests__/useNavigationFocus.test.ts app/composables/__tests__/usePalette.test.ts 2>&1 | tail -4
```

Expected: 9 tests pass.

- [ ] **Step 3: Wire the palette and the draft guard**

In `GlobalSearch.vue`, change line 10 to:

```ts
import { paletteNavigationBlocked, shouldRestoreTriggerFocus, usePalette } from '@/composables/usePalette'
import { clearNavigationFocus, offerNavigationFocus } from '@/composables/useNavigationFocus'
```

Replace lines 37-69 (from the `// A link selection that leaves the page…` comment through the end of `toItem`) with:

```ts
// A link selection that leaves the page hands focus to the layout, which focuses <main>
// after the route changes; otherwise reka returns focus to the trigger or to the element
// that had it when ⌘K was pressed. The destination is compared with the page the palette was
// opened on, not with the route at close time: the navigation has usually finished by then, and
// restoring focus would then pull it back from <main> to the trigger.
// When a guard blocks that navigation (an unsaved draft), the page does not change: the trigger
// is handed to the draft guard for after its dialog, and focus goes back to it (Tasmim Plan 4).
let leavingFor: string | null = null
let leavingFrom = ''
let paletteNavigation = false
let closedWithoutRestore = false
const router = useRouter()
const triggerElement = () => document.querySelector<HTMLElement>('[data-testid="global-search-trigger"]')
function pathOf(to: PaletteItem['to']): string | null {
  if (typeof to === 'string') return to.split(/[?#]/, 1)[0] ?? to
  return to && typeof to === 'object' && 'path' in to && typeof to.path === 'string' ? to.path : null
}
function onCloseAutoFocus(event: Event) {
  closedWithoutRestore = !shouldRestoreTriggerFocus(leavingFor, leavingFrom)
  if (closedWithoutRestore) event.preventDefault()
  leavingFor = null
}
const stopAfterEach = router.afterEach((_to, _from, failure) => {
  const fromPalette = paletteNavigation
  paletteNavigation = false
  clearNavigationFocus()
  if (!fromPalette || !paletteNavigationBlocked(failure)) return
  // Still closing: reka restores the trigger. Already closed: restore it, unless a dialog (the draft guard) holds focus.
  leavingFor = null
  if (closedWithoutRestore && document.activeElement === document.body) triggerElement()?.focus({ preventScroll: true })
})
onBeforeUnmount(stopAfterEach)
function toItem(item: PaletteItem): CommandPaletteItem {
  const { action, ...rest } = item
  return {
    ...rest,
    onSelect(event: Event) {
      if (!action) {
        leavingFor = item.external ? null : pathOf(item.to)
        leavingFrom = route.path
        closedWithoutRestore = false
        if (leavingFor !== null) {
          paletteNavigation = true
          offerNavigationFocus(triggerElement)
        }
        close()
        return
      }
      event.preventDefault()
      if (action.kind === 'shortcuts') view.value = 'shortcuts'
      else if (action.kind === 'retry') sectionFor(action.section)?.refetch()
      else if (action.kind === 'load-more') sectionFor(action.section)?.fetchNext()
    },
  }
}
```

In `apps/web/app/components/shared/UnsavedChanges.vue`, add after line 3:

```ts
import { takeNavigationFocus } from '@/composables/useNavigationFocus'
```

Change line 29 (line 30 after the import) to:

```ts
  // An overlay that started this navigation and is closing (the palette) hands over where focus belongs.
  if (import.meta.client) returnFocus = takeNavigationFocus() ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
```

`UnsavedChanges.test.ts` strips imports and rewrites `import.meta.client` to `false` (`:84-85`). The new call sits behind that condition, so the harness never evaluates it and needs no new binding.

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim
npm -w apps/web run lint && (cd apps/web && npx vitest run app/components/shared/__tests__/UnsavedChanges.test.ts app/composables/__tests__ 2>&1 | tail -4)
python3 -B tools/ui_policy.py | tail -1 && python3 -B tools/arch_policy.py
```

Expected: lint exit 0, all tests pass, and both policies pass. The new composable exports names no other file owns (`auto_import_errors`).

- [ ] **Step 4: The e2e test**

In `apps/web/e2e/shortcuts-tasmim.spec.ts`, before the closing `})` of the describe (line 135), add:

```ts
  test('a palette navigation the draft guard blocks returns focus to the palette trigger', async ({ page }) => {
    await hydrated(page, '/settings/roles/new')
    const name = page.locator('#name-ar')
    await name.fill('دور مسودة')
    await page.keyboard.press('ControlOrMeta+k')
    await dialog(page).getByRole('textbox').fill('المشاريع')
    await expect(dialog(page).getByRole('option', { name: 'المشاريع', exact: true })).toBeVisible()
    await page.keyboard.press('Enter')
    const guard = page.getByTestId('unsaved-changes-dialog')
    await expect(guard).toBeVisible()
    await expect(dialog(page)).toBeHidden()
    await guard.getByRole('button', { name: 'البقاء في الصفحة', exact: true }).click()
    await expect(guard).toBeHidden()
    await expect(page).toHaveURL(/\/settings\/roles\/new$/)
    await expect(page.getByTestId('global-search-trigger')).toBeFocused()
    await expect(name).toHaveValue('دور مسودة')
  })
```

Run it on the mock stack (same commands as Plan 3 Task 9 Step 3):

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim/apps/web
SCRATCH=$(mktemp -d)
PROJECTS_UI_PREVIEW=1 MODULE_UI_PREVIEW=1 MOCK_PORT=4498 node e2e/internal-ui-audit-mock.mjs > "$SCRATCH/mock.log" 2>&1 & MOCK_PID=$!
NUXT_ODOO_URL=http://127.0.0.1:4498 NUXT_ODOO_DB=webvue_ui_mock_only NUXT_PUBLIC_WS_URL=ws://127.0.0.1:4498/websocket npx nuxt dev --port 4097 > "$SCRATCH/nuxt.log" 2>&1 & NUXT_PID=$!
for i in $(seq 1 120); do curl -sf -o /dev/null http://localhost:4097/login && break; sleep 2; done
E2E_BASE_URL=http://localhost:4097 npx playwright test e2e/shortcuts-tasmim.spec.ts --reporter=line 2>&1 | tail -4
kill "$NUXT_PID" "$MOCK_PID"; while kill -0 "$NUXT_PID" 2>/dev/null || kill -0 "$MOCK_PID" 2>/dev/null; do sleep 1; done
lsof -ti tcp:4097 | xargs kill 2>/dev/null; true
```

Expected: 8 passed (the seven Plan 3 tests and the new one), including the existing "Enter on a Go to option navigates and focus lands on the page", which proves that the unblocked path still focuses `<main>`.

To prove that the test pins the bug, stash only the two source edits, re-run the new test, and confirm it fails on `toBeFocused` (focus is on `<body>`). Then restore the edits:

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim
git stash push -m t14-proof -- apps/web/app/components/shell/GlobalSearch.vue apps/web/app/components/shared/UnsavedChanges.vue
SHA=$(git stash list --format='%H %gs' | awk '/t14-proof/{print $1; exit}')
# restart the mock stack as above, then:
(cd apps/web && E2E_BASE_URL=http://localhost:4097 npx playwright test e2e/shortcuts-tasmim.spec.ts -g 'draft guard blocks' --reporter=line 2>&1 | tail -4)
git stash apply "$SHA" && git stash drop "$(git stash list --format='%gd %gs' | awk '/t14-proof/{print $1; exit}')"
```

Expected: `1 failed` with `toBeFocused` before `apply`. After `apply`, `git diff --stat` again shows both files.

- [ ] **Step 5: Commit**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim
npm test 2>&1 | tail -3
git add apps/web/app/composables/useNavigationFocus.ts apps/web/app/composables/__tests__/useNavigationFocus.test.ts \
  apps/web/app/composables/usePalette.ts apps/web/app/composables/__tests__/usePalette.test.ts \
  apps/web/app/components/shell/GlobalSearch.vue apps/web/app/components/shared/UnsavedChanges.vue apps/web/e2e/shortcuts-tasmim.spec.ts
git commit -m "fix(web): return focus to the palette trigger after a blocked jump

The draft guard stored the palette input as its return target, which is
gone when the user stays. The palette now hands its trigger to the guard
and, on an aborted navigation (router.afterEach failure), restores it.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Policy rules and the templates documentation

**Files:**
- Modify: `tools/ui_policy.py` (new block after `toolbar_errors`, `:724-730`; `check()` gains one line after `:829`)
- Test: `tools/test_ui_policy.py` (new tests in `StaticGateTest`, before the `if __name__` line at the end of the file)
- Modify: `DESIGN.md` (`:230`, a new subsection between `:230` and `:232`, `:233`, `:247`)
- Modify: `docs/design-system/components.md` (the `## القوالب والحالات — Tasmim الخطة 4` section that Task 1 created: intro line, completeness)
- Modify: `docs/design-system/nuxt-ui-reference.md` (`## الوصفات` `:51`; new `## القوالب والحالات` section at the end, after `:105`)
- Regenerate: `docs/design-system/catalog.json`

**Interfaces:**
- Consumes: `STORYBOOK_COMPONENTS` as Tasks 1-12 left it, which includes every shared template and state. `whole_tree`, `COMMENTS`, `COMPONENTS` and `APP` in `ui_policy.py`.
- Produces:
  - `CONTRACT_TEMPLATES: tuple[str, ...]`, `STATUS_BADGE_OWNER`, `FILTER_CARD_FILE` and `template_errors(current: dict[str, str]) -> list[str]` in `tools/ui_policy.py`;
  - the DESIGN.md section «القوالب والحالات» that Plans 5 and 6 cite.

- [ ] **Step 1: Write the failing policy tests**

In `tools/test_ui_policy.py`, inside `class StaticGateTest`, add before the `if __name__ == '__main__':` line:

```python
    # --- templates and merges (Tasmim Plan 4) ----------------------------------

    def test_a_per_app_status_badge_is_reported_and_the_shared_one_is_not(self):
        for path in ("task/StateBadge.vue", "project/ProjectStatusBadge.vue", "vendor/OrderStateBadge.vue",
                     "access/AccessStateBadge.vue", "meetings/StatusBadge.vue"):
            errors = policy.template_errors({self.COMPONENTS + path: "<template><UBadge /></template>"})
            self.assertTrue(any("StatusBadge" in error for error in errors), path)
        self.assertEqual(policy.template_errors({
            policy.STATUS_BADGE_OWNER: "<template><UBadge /></template>",
            self.COMPONENTS + "task/taskStateTone.ts": "export const TONES = {}",
        }), [])

    def test_filter_card_file_and_tag_are_reported(self):
        self.assertTrue(policy.template_errors({policy.FILTER_CARD_FILE: "<template><div /></template>"}))
        for markup in ("<FilterCard />", "<SharedFilterCard :active-count='1' />", "<shared-filter-card />",
                       "<LazySharedFilterCard />"):
            self.assertTrue(policy.template_errors({self.PAGES + "x.vue": f"<template>{markup}</template>"}), markup)
        for markup in ("<SharedFilterBar /><!-- FilterCard folded in here -->",
                       "<SharedFilterBar :content-id=\"'filter-card-' + id\" />"):
            self.assertEqual(policy.template_errors({self.PAGES + "x.vue": f"<template>{markup}</template>"}), [], markup)

    def test_every_contract_template_must_be_listed_in_storybook(self):
        whole = self.whole()
        missing = policy.CONTRACT_TEMPLATES[0]
        with patch("ui_policy.STORYBOOK_COMPONENTS", policy.CONTRACT_TEMPLATES[1:]):
            self.assertEqual(policy.template_errors(whole),
                             [missing + ": contract template must be listed in STORYBOOK_COMPONENTS"])
        with patch("ui_policy.STORYBOOK_COMPONENTS", policy.CONTRACT_TEMPLATES):
            self.assertEqual(policy.template_errors(whole), [])
        # A partial snapshot says nothing about the list.
        with patch("ui_policy.STORYBOOK_COMPONENTS", ()):
            self.assertEqual(policy.template_errors({self.PAGES + "x.vue": "<template />"}), [])

    def test_the_real_list_names_every_contract_template(self):
        self.assertEqual([path for path in policy.CONTRACT_TEMPLATES if path not in policy.STORYBOOK_COMPONENTS], [])
```

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim/tools && python3 -B -m unittest test_ui_policy -q 2>&1 | tail -4
```

Expected: `FAILED (errors=4)`, each with `AttributeError: module 'ui_policy' has no attribute 'template_errors'` (or `CONTRACT_TEMPLATES`).

- [ ] **Step 2: The rules**

In `tools/ui_policy.py`, after `toolbar_errors` (ends on line 730), insert:

```python


# Tasmim Plan 4 (spec §6): one StatusBadge driven by application tone maps, FilterCard
# folded into FilterBar, and every contract template and state kept in Storybook.
STATUS_BADGE_OWNER = COMPONENTS + 'shared/StatusBadge.vue'
STATUS_BADGE_FILE = re.compile(r'(?:Status|State)Badge\.vue$')
FILTER_CARD_FILE = COMPONENTS + 'shared/FilterCard.vue'
FILTER_CARD_TAG = re.compile(r'<(?:Lazy)?(?:Shared)?FilterCard\b|<(?:lazy-)?(?:shared-)?filter-card\b')
CONTRACT_TEMPLATES: tuple[str, ...] = tuple(COMPONENTS + 'shared/' + name + '.vue' for name in (
    'LoadingSkeleton', 'ErrorState', 'ForbiddenState', 'NotFoundState', 'EmptyState', 'PageState',
    'StatusBadge', 'FilterBar', 'InvoiceLines', 'RouteTabs', 'SettingsPage',
    'DataTable', 'ViewSwitch', 'ListPage', 'RecordPage', 'PropertiesPanel', 'PropertyRow', 'RecordSection',
    'CreatePanel', 'FormSection', 'UnsavedChanges',
    'DashboardPage', 'ChartPanel', 'TimelineFrame', 'ConversationLayout', 'StandalonePage',
))


def template_errors(current: dict[str, str]) -> list[str]:
    errors = [path + ': one StatusBadge (shared/StatusBadge.vue) with an application tone map; no per-app status badge'
              for path in sorted(current)
              if path.startswith(COMPONENTS) and STATUS_BADGE_FILE.search(path) and path != STATUS_BADGE_OWNER]
    if FILTER_CARD_FILE in current:
        errors.append(FILTER_CARD_FILE + ': FilterCard is folded into FilterBar')
    errors.extend(path + ': FilterCard is folded into FilterBar; use SharedFilterBar'
                  for path, source in sorted(current.items())
                  if path.startswith(APP) and path.endswith('.vue') and FILTER_CARD_TAG.search(COMMENTS.sub('', source)))
    if whole_tree(current):
        listed = set(STORYBOOK_COMPONENTS)
        errors.extend(path + ': contract template must be listed in STORYBOOK_COMPONENTS'
                      for path in CONTRACT_TEMPLATES if path not in listed)
    return errors
```

`STORYBOOK_COMPONENTS` is read when the function is called, so the tests' `patch` applies. A partial snapshot, such as `UiPolicyTest`, which patches the list to `()`, skips the listing rule, as `toolbar_errors` does.

In `check()`, after `errors.extend(toolbar_errors(current))` (line 829), add:

```python
    errors.extend(template_errors(current))
```

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim
(cd tools && python3 -B -m unittest test_ui_policy -q 2>&1 | tail -2)
python3 -B tools/ui_policy.py | tail -1
```

Expected: the unit tests report `OK`, and the policy prints `PASS: …`. Tasks 2 and 3 already deleted the badge files and `FilterCard`, and Tasks 1-12 listed every template. If the policy reports a template, that task left out its `STORYBOOK_COMPONENTS` entry: report it, do not drop the name from `CONTRACT_TEMPLATES`.

- [ ] **Step 3: DESIGN.md (Arabic, in the file's voice)**

On line 230, replace «قوالب: قائمة، تفاصيل، نموذج، لوحة/جدول زمني، ملخص.» with «قوالب: ثمانية، وخمس حالات، مفصّلة في «القوالب والحالات» أدناه.» Keep the rest of the paragraph.

Insert after line 230, before the bullet list on line 232:

> ### القوالب والحالات
>
> كل صفحة تُبنى من قالب واحد من الثمانية، ومن المكونات المشتركة تحت `components/shared/`. لكل قالب قصة في Storybook يُفحص فيها الوصول عند مستوى `error`، ولقطات بالعربية والإنجليزية في الوضعين. انتقال الصفحات إلى القوالب يبدأ في الخطة 5 بالمشاريع، ثم في الخطة 6 لكل تطبيق.
>
> | القالب | المكونات | الصفحات |
> |---|---|---|
> | قائمة | `SharedListPage` و`SharedDataTable` و`SharedViewSwitch` | المشاريع، المهام، الموظفون، الأقسام، المستندات، الاجتماعات، السلاسل، القوالب، الأدوار، المستخدمون، سجل الوصول، الفواتير، قوائم الإدارة |
> | سجل | `SharedRecordPage` و`SharedPropertiesPanel` و`SharedPropertyRow` و`SharedRecordSection` | المشروع، المهمة، الموظف، القسم، الاجتماع، السلسلة، الدور، المستخدم، سجلات الإدارة |
> | نموذج | `SharedCreatePanel` لمسارات `/new`، و`SharedFormSection` و`SharedUnsavedChanges`. صفحات التعديل تستخدم الأقسام نفسها | كل مسار `new` و`edit` |
> | لوحة | `SharedDashboardPage` (شبكة `SharedMetricTile`) و`SharedChartPanel` | الرئيسية، لوحة المشاريع، المالية، نظرة الإدارة، التقارير |
> | جدول زمني | `SharedTimelineFrame` حول التقويم أو Gantt | تقويم الاجتماعات، جدول المشروع |
> | محادثة | `SharedConversationLayout` | المحادثات، تعليقات المهمة |
> | إعدادات | `SharedSettingsPage` | `/settings/*`، `/account`، إعدادات المشروع وكتالوجاته |
> | صفحة مستقلة | `SharedStandalonePage`، ونسخة `print` بطباعة أسود على أبيض | الدخول، الدعوة، الخطأ، صفحات الطباعة |
>
> - **القائمة.**
>   - `SharedListPage` يضع العنوان وزر الإنشاء وشريط الفلاتر. الزر موسوم `data-shortcut-create` فيعمل عليه `C`، والبحث موسوم `data-shortcut-search` فيعمل عليه `/`.
>   - `?view=` يحفظ العرض المختار (`SharedViewSwitch`)، ومنه `?view=board` للوحة المهام.
>   - `SharedDataTable` يجمع `FilterBar` و`UTable` والترقيم وصفوف الجوال وشريط التحديد الجماعي. صفوفه موسومة `data-shortcut-row` فيعمل `J` و`K` و`Enter`، ويُتخطى منها المخفي و`inert`.
> - **السجل.** العنوان والإجراءات أولًا، ثم التبويبات إن وُجدت، ثم المحتوى وبجانبه لوحة الخصائص. `SharedPropertyRow` يعرض «—» للقيمة الفارغة، ومعها نص لقارئ الشاشة.
> - **التبويبات ذات المسار** تُبنى بـ`SharedRouteTabs`، وهي روابط بخط سفلي مستقيم.
> - **الحالات.** `SharedPageState` واجهة واحدة لها:
>   - التحميل: `SharedLoadingSkeleton` (صفوف أو سجل أو بطاقات)؛
>   - الخطأ: `SharedErrorState`، وفيه «إعادة المحاولة»، و409 تعرض رسالة التعارض؛
>   - 403: `SharedForbiddenState` بلا إعادة محاولة؛
>   - 404: `SharedNotFoundState`، مع رابط رجوع اختياري؛
>   - الفراغ: `SharedEmptyState`.
>
>   لا تُكتب حالة يدوية في الصفحة.
> - **الحالة.** الحالة شارة واحدة هي `SharedStatusBadge` بنبرة (`tone`) ونص جاهزين. خريطة النبرة والنص تبقى في مجلد التطبيق. القيمة التي لا تعرفها الواجهة بعد تظهر شارة محايدة بنصها الخام. لا تُنشأ شارة حالة خاصة بتطبيق، ويمنع ذلك `ui_policy`.
> - **بنود الفاتورة.** `SharedInvoiceLines` يعرض البنود بمبالغ نسّقها المستدعي، فلا يستورد `shared/` أداة من تطبيق.
> - **الصفحة المستقلة.** `SharedStandalonePage` بطاقة في وسط الصفحة بلا غلاف. نسخة `print` تطبع أسود على أبيض (`webvue-print`).
> - **إضافة قالب.** القالب الجديد يُضاف إلى `CONTRACT_TEMPLATES` و`STORYBOOK_COMPONENTS` معًا، وإلا يرفضه `ui_policy`.

On line 233 (line numbers after the insertion: search for the text), replace «التنفيذ المشترك: `FilterBar` / `FilterCard`.» with «التنفيذ المشترك: `SharedFilterBar` (دُمج فيه `FilterCard`).»

Replace the line that starts «- الفراغ والتحميل والخطأ:» (line 247 before the insertion) with:

> - الفراغ والتحميل والخطأ والصلاحية: `SharedPageState` أو إحدى حالاته مباشرة (`SharedLoadingSkeleton`، `SharedErrorState`، `SharedForbiddenState`، `SharedNotFoundState`، `SharedEmptyState`)؛ لا فقرة «لا توجد بيانات» يدوية.

- [ ] **Step 4: components.md and the Nuxt UI reference**

In `docs/design-system/components.md`, Task 1 created the section `## القوالب والحالات — Tasmim الخطة 4`, and Tasks 1-12 each added their own row. Under the section's intro line, add:

> الشرح والقواعد في [DESIGN.md «القوالب والحالات»](../../DESIGN.md). القائمة الملزمة في `CONTRACT_TEMPLATES` (`tools/ui_policy.py`).

Check that every contract template has a row, and that no row names a deleted file:

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim
python3 -B -c "
import sys; sys.path.insert(0, 'tools'); import ui_policy as p
text = open('docs/design-system/components.md', encoding='utf-8').read()
print('missing rows:', [t for t in p.CONTRACT_TEMPLATES if t not in text])
"
rg -n "FilterCard\.vue|StatusBadge\.vue|StateBadge\.vue|AccessBadge\.vue|DeadlineBadge\.vue|LifecycleBadge\.vue|SettingsLayout\.vue|(subscription|vendor)/InvoiceLines\.vue" docs/design-system/components.md | grep -v "shared/StatusBadge.vue"
```

Expected: `missing rows: []`, and the `rg` pipeline prints nothing. Add any missing row in the Task 1 table format, and remove any stale path.

In `docs/design-system/nuxt-ui-reference.md`, replace the paragraph under `## الوصفات` (line 51) with:

> لا وصفات مخصصة إلا المعتمدة في DESIGN.md «وصفات الثيم المعتمدة»: `app.config.ts` يضبط `colors` والوصفات المذكورة وطبقات z، و`components.css` قواعد الغلاف فقط. الاستثناء اللوني الوحيد: الزر الأساسي الممتلئ في الوضع الداكن يُرسم من `--primary-solid` عبر `compoundVariants` لـ`button`. المكوّنات تُستخدم بوصفاتها الأصلية كما في Figma «Nuxt UI v4 (Community)»، والأسطح المسطّحة بأدوات المكتبة (`rounded-lg ring ring-default bg-default`).

Append at the end of the file:

> ## القوالب والحالات
>
> القوالب مكونات مركبة رقيقة فوق Nuxt UI، ولا تُغيّر وصفات المكتبة:
>
> - `SharedDataTable` فوق `UTable` و`UPagination` و`UCheckbox`. الأعمدة `TableColumn<T>` كما هي، وخانات `#<column>-cell` تمر إلى `UTable`.
> - `SharedViewSwitch` مجموعة `UButton`.
> - الحالات: `USkeleton`، و`UAlert` للخطأ، و`UIcon` و`UButton`.
> - `SharedStatusBadge` فوق `UBadge`، ولونها من `STATUS_COLOR` (`utils/statusTone.ts`).
> - `SharedRouteTabs` روابط `ULink`، لا `UTabs`، لأن التبويب هنا مسار.
> - لا قالب يضيف `UModal` أو `USlideover` أو `UDrawer`. `SharedCreatePanel` يبقى لوحة `/new` الوحيدة.
>
> الخصائص والخانات والأحداث في `catalog.json` المولّد.

- [ ] **Step 5: Check and commit**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim
node tools/ui_catalog.mjs && node tools/ui_catalog.mjs --check
python3 -B tools/ui_policy.py | tail -1 && (cd tools && python3 -B -m unittest test_ui_policy -q 2>&1 | tail -1)
npm test 2>&1 | tail -3
rg -n "FilterCard\`|لوحة/جدول زمني، ملخص" DESIGN.md
git add tools/ui_policy.py tools/test_ui_policy.py DESIGN.md docs/design-system
git commit -m "docs(web): document the templates and states and guard the merges

ui_policy rejects a per-app *StatusBadge/*StateBadge, any FilterCard,
and a contract template missing from STORYBOOK_COMPONENTS. DESIGN.md
gains «القوالب والحالات»; components.md, nuxt-ui-reference and the
catalog follow.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: the catalog check prints `… components, up to date`, the policy and tests pass, and the `rg` prints nothing.

---

### Task 16: Checkpoint CP4 — full gates, e2e diff, template shots

**Files:**
- Regenerate (only if Step 1 shows intended diffs): `apps/web/e2e/storybook-visual.spec.ts-snapshots/*`
- Create (not committed): `.superpowers/tasmim-shared/cp4/*.png`, `.superpowers/tasmim-shared/cp4/primary-after/*.png`, `.superpowers/tasmim-shared/cp4/CP4-NOTE.md`, `.superpowers/tasmim-shared/e2e-cp4-failures.txt`

**Interfaces:** checkpoint only. It consumes every task's baselines, `VISUAL_STORIES`, `VISUAL_MOBILE_STORIES`, `VISUAL_AXE_STORIES`, and Task 13's `cp4/primary-before/`.

- [ ] **Step 1: Storybook gates**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim/apps/web
npm run build-storybook >/dev/null
SPECS="e2e/storybook-visual.spec.ts e2e/storybook-density.spec.ts e2e/storybook-smoke.spec.ts e2e/storybook-shell.spec.ts"
[ -f e2e/storybook-templates.spec.ts ] && SPECS="$SPECS e2e/storybook-templates.spec.ts"
WEBVUE_REQUIRE_STORYBOOK=1 npx playwright test $SPECS --reporter=line 2>&1 | tail -15
```

Expected: everything passes, with no failure and no skipped describe. Unlike CP3, there is no allowed exception: Task 9 fixed `shared-createpanel--form`, so the smoke run is fully green. Any visual diff is unexpected, because Tasks 1-13 baselined their own families. Investigate it before running `--update-snapshots`, and list any re-baselined family in the CP4 note.

- [ ] **Step 2: Full gates**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim
npm test 2>&1 | tail -5
npm -w apps/web run lint
python3 -B tools/ui_policy.py && (cd tools && python3 -B -m unittest test_ui_policy -q)
(cd tools && python3 -B -m unittest test_arch_policy test_new_app -q)
python3 -B tools/arch_policy.py --base main && python3 -B tools/git_policy.py --base main
node tools/ui_catalog.mjs --check
git status --short
```

Expected: every command exits 0, and `git status` shows a clean tree. `test_arch_policy` prints "wrote arch_baseline.json" as a side effect of its tests, while the tree stays clean (CP3 note).

- [ ] **Step 3: Mock e2e failing-title diff against CP3**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim/apps/web
SCRATCH=$(mktemp -d)
PROJECTS_UI_PREVIEW=1 MODULE_UI_PREVIEW=1 MOCK_PORT=4498 node e2e/internal-ui-audit-mock.mjs > "$SCRATCH/mock.log" 2>&1 & MOCK_PID=$!
NUXT_ODOO_URL=http://127.0.0.1:4498 NUXT_ODOO_DB=webvue_ui_mock_only NUXT_PUBLIC_WS_URL=ws://127.0.0.1:4498/websocket npx nuxt dev --port 4097 > "$SCRATCH/nuxt.log" 2>&1 & NUXT_PID=$!
for i in $(seq 1 120); do curl -sf -o /dev/null http://localhost:4097/login && break; sleep 2; done
FORCE_COLOR=0 E2E_BASE_URL=http://localhost:4097 E2E_PROJECT_POPUPS=1 npx playwright test --reporter=line > "$SCRATCH/cp4-e2e.log" 2>&1 || true
awk '/^ +[0-9]+ failed$/{f=1;next} f && /^ +[0-9]+ (flaky|passed|skipped|interrupted|did not run)/{f=0} f' "$SCRATCH/cp4-e2e.log" > ../../.superpowers/tasmim-shared/e2e-cp4-failures.txt
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
normalize < ../../.superpowers/tasmim-shared/e2e-cp3-failures.txt > "$SCRATCH/cp3.norm"
normalize < ../../.superpowers/tasmim-shared/e2e-cp4-failures.txt > "$SCRATCH/cp4.norm"
echo "NEW failures:"; comm -13 "$SCRATCH/cp3.norm" "$SCRATCH/cp4.norm"
echo "FIXED since CP3:"; comm -23 "$SCRATCH/cp3.norm" "$SCRATCH/cp4.norm"
echo "Raw counts:"; wc -l < ../../.superpowers/tasmim-shared/e2e-cp3-failures.txt; wc -l < ../../.superpowers/tasmim-shared/e2e-cp4-failures.txt
echo "Per-spec counts (< cp3, > cp4):"
diff <(cut -d' ' -f1 "$SCRATCH/cp3.norm" | sort | uniq -c) <(cut -d' ' -f1 "$SCRATCH/cp4.norm" | sort | uniq -c) || true
grep -E "^ +[0-9]+ (passed|failed|flaky)" "$SCRATCH/cp4-e2e.log"
```

Keep the mock stack running for Step 4.

Expected: `NEW failures:` is empty. `shared-createpanel--form` now appears under `FIXED since CP3:`, because the CP3 file carried it. As at CP3, the normalizer cuts titles at 90 characters, so compare the raw and per-spec counts too.

Classify every NEW title as one of three kinds:

- **Intended.** The title is unchanged but a Plan 4 task changed its assertion on purpose, and named it in the commit body. Examples: the badge DOM in Task 2, the PageState facade in Task 1, the RouteTabs markup in Task 5. Each must pass. If one fails, treat it as a regression.
- **New test.** "a palette navigation the draft guard blocks returns focus to the palette trigger" (Task 14) and any Plan 4 template spec must pass, because they are not in the CP3 file.
- **Regression.** Fix it in the component, not in the spec.

The load-sensitive families named in the CP3 note (`project-clarity`, `nuxt-project-visual`) are re-run alone. A title counts as a flake only if it then passes. For `project-clarity`, CP3 already proved that it fails identically without the plan's commits. Record each classification in the CP4 note.

- [ ] **Step 4: CP4 image set**

**Template shots from Storybook.** These are the visual baselines themselves, captured from the story iframes over ar/en × light/dark (+ mobile):

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim/apps/web
OUT=../../.superpowers/tasmim-shared/cp4; mkdir -p "$OUT/primary-after"
FAMILIES="loadingskeleton errorstate forbiddenstate notfoundstate emptystate pagestate statusbadge filterbar invoicelines routetabs settingspage datatable viewswitch listpage recordpage propertiespanel propertyrow recordsection createpanel formsection dashboardpage chartpanel timelineframe conversationlayout standalonepage"
for f in $FAMILIES; do
  n=$(ls e2e/storybook-visual.spec.ts-snapshots | grep -c "^shared-$f--")
  echo "$f $n"; cp e2e/storybook-visual.spec.ts-snapshots/shared-$f--*.png "$OUT/" 2>/dev/null
done
cp e2e/storybook-visual.spec.ts-snapshots/shared-pageheader--with-actions-*-dark-darwin.png \
   e2e/storybook-visual.spec.ts-snapshots/foundations-density--controls-*-dark-darwin.png "$OUT/primary-after/"
```

Expected: every family prints a count that is a multiple of 4 and at least 4 (ar/en × light/dark per story, plus 4 more per mobile story). A family with `0` was never added to `VISUAL_STORIES`: report it, do not skip it.

**The dark primary button in the app.** The script follows `cp3-shots.cjs` with the two fixes from the CP3 note: log in with `POST /api/auth/login`, then send `PATCH /api/v1/me/appearance`, because the user's server-side appearance overrides the `webvue-appearance` cookie. Write it to `$SCRATCH/cp4-shots.cjs`:

```js
const { createRequire } = require('node:module')
const { chromium } = createRequire('/Users/tariq/code/nasq/.worktrees/tasmim/apps/web/package.json')('@playwright/test')
const out = process.argv[2]
const base = 'http://localhost:4097'
;(async () => {
  const browser = await chromium.launch()
  for (const locale of ['ar', 'en']) for (const mode of ['dark', 'light']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ar-SA', reducedMotion: 'reduce' })
    const page = await context.newPage()
    if (!(await page.request.post(`${base}/api/auth/login`, { data: { login: 'admin', password: 'admin' } })).ok()) throw new Error('login failed')
    if (!(await page.request.patch(`${base}/api/v1/me/appearance`, { data: { mode, font_size: 'small' } })).ok()) throw new Error('appearance failed')
    await context.addCookies([{ name: 'webvue-appearance', value: encodeURIComponent(JSON.stringify({ mode, fontSize: 'small' })), url: base }])
    await page.goto(`${base}/projects`)
    await page.locator('[data-testid="global-search-trigger"]:not([disabled])').waitFor()
    if (locale === 'en') {
      await page.evaluate(async () => { await document.querySelector('#__nuxt').__vue_app__.$nuxt.$i18n.setLocale('en') })
      await page.locator('html[dir="ltr"]').waitFor()
    }
    await page.waitForLoadState('networkidle')
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: `${out}/projects-${locale}-${mode}-desktop.png` })
    await context.close()
  }
  await browser.close()
})()
```

```bash
node "$SCRATCH/cp4-shots.cjs" /Users/tariq/code/nasq/.worktrees/tasmim/.superpowers/tasmim-shared/cp4/primary-after
curl -sf -X PATCH -H 'content-type: application/json' -d '{"mode":"light","font_size":"small"}' http://localhost:4097/api/v1/me/appearance -o /dev/null || true
ls ../../.superpowers/tasmim-shared/cp4/primary-before ../../.superpowers/tasmim-shared/cp4/primary-after
kill "$NUXT_PID" "$MOCK_PID"; while kill -0 "$NUXT_PID" 2>/dev/null || kill -0 "$MOCK_PID" 2>/dev/null; do sleep 1; done
lsof -ti tcp:4097 | xargs kill 2>/dev/null; true
```

Expected:

- `primary-before/` holds 6 files from Task 13.
- `primary-after/` holds 8 files: the 4 Storybook dark shots and 4 app shots (`projects-{ar,en}-{dark,light}-desktop.png`).
- The light app shots show that the light primary is unchanged; compare them with CP2 `projects-{ar,en}-light-desktop.png`.

- [ ] **Step 5: Commit baselines (only if Step 1 re-baselined an approved family)**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim
git status --short apps/web/e2e/storybook-visual.spec.ts-snapshots
# only if non-empty and listed in the CP4 note:
git add apps/web/e2e/storybook-visual.spec.ts-snapshots
git commit -m "test(web): re-baseline visual snapshots at checkpoint CP4

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Present CP4 to the owner**

Write `.superpowers/tasmim-shared/cp4/CP4-NOTE.md` in the CP3 note's shape:

- the HEAD;
- the gate results, with counts;
- the NEW/FIXED tables with their classification, and the per-spec count diff;
- the file list of `cp4/`.

The orchestrator then sends the note, the template shots, and the dark primary before/after pairs. The note asks the owner to confirm these decisions:

- (a) **The dark primary button.** The proposed rule: keep the tenant hue, hold saturation ≥ 0.55, and take the darkest tone at 3:1 on the page with a 4.5:1 label; a colour that already passes is kept. Midnight becomes `#3c66cd` with a white label. Links, focus and `text-primary` keep the lighter `--brand-link` (`#a1a7b7`). The sidebar's pinned create link still uses `--primary-fill` (`#7d869b` in dark), so the owner also decides whether it should follow the button in Plan 5.
- (b) **The eight templates and five states as built,** reviewed in Storybook (ar/en × light/dark, mobile for templates). Their prop and slot APIs become binding for Plans 5 and 6.
- (c) **`SharedPageState` and retry.** The facade no longer offers retry on 403 and 404 (`ForbiddenState`, `NotFoundState`). Before, every error showed «إعادة المحاولة».
- (d) **`InvoiceLines` paid quantity.** The two callers count it differently: subscription uses `quantity - free_quantity`, vendor uses `quantity`. Both are kept as their callers format them. The owner decides whether they should agree.
- (e) **One `StatusBadge`.** Application tone maps, with an unknown status shown as a neutral badge with its raw value.
- (f) **Focus after a blocked palette jump.** Focus returns to the palette trigger after «البقاء في الصفحة».
- (g) **Policy.** No per-app status badge, no `FilterCard`, and every template in Storybook; enforced by `ui_policy`.

Plan 5 does not start until the owner approves CP4.

---

## Spec coverage (phase 4)

| Spec | Task |
|---|---|
| §6 shared components in `components/shared/`, each with a story, `STORYBOOK_COMPONENTS` and `components.md` | Global Constraints; every task 1-12; enforced in 15 (`CONTRACT_TEMPLATES`) |
| §6 template 1 List: `ListPage`, `DataTable` (FilterBar + UTable + Pagination + mobile rows + bulk bar), list/board switch | 6 (DataTable, row navigation), 7 (ListPage, ViewSwitch `?view=`) |
| §6 template 2 Record: `RecordPage`, `PropertiesPanel`, `PropertyRow`, `RecordSection` | 8 |
| §6 template 3 Form: `CreatePanel`, `FormSection`, `UnsavedChanges` | 9 (composed Form story, smoke fix) |
| §6 template 4 Dashboard: `DashboardPage` + `ChartPanel` | 10 |
| §6 template 5 Timeline: `TimelineFrame` | 11 |
| §6 template 6 Conversation: `ConversationLayout` | 11 |
| §6 template 7 Settings: `SettingsPage` moved from `settings/SettingsLayout.vue` | 5 |
| §6 template 8 Standalone: `StandalonePage` | 12 |
| §6 states `LoadingSkeleton`, `EmptyState`, `ErrorState`, `ForbiddenState`, `NotFoundState`; `PageState` as facade | 1 |
| §6 merge: eight status badges → `StatusBadge`, app maps in app folders | 2; guarded in 15 |
| §6 merge: `FilterCard` → `FilterBar` | 3; guarded in 15 |
| §6 merge: vendor + subscription `InvoiceLines` → one | 4 |
| §6 merge: `ProjectWorkspaceTabs`/`ProjectGovernanceTabs` → one tab helper | 5 (`RouteTabs`) |
| §6 merge: seven `*Table.vue` → `DataTable` | Deferred by owner ruling 2: Plan 5 (`ProjectTable`, `TaskTable`) and Plan 6 (the rest) |
| §6 print: black-on-white stylesheet under `StandalonePage` | 12 (`webvue-print`); the pages adopt it in Plan 6 |
| §6 contracts that do not move (routes, URL filters, `?view=board`, inline confirmation, no stacked dialogs, overlay exceptions, `useHydrated()`, testids, headings) | Global Constraints; 7 (`?view=`), 9 (draft guard), 14 (focus after the draft guard), 16 (e2e title diff) |
| §9 visual snapshots ar/en × light/dark, mobile for templates | each template task (`VISUAL_STORIES`, `VISUAL_MOBILE_STORIES`); 13 (intended dark re-baselines); 16 |
| §9 a11y: addon at `error` per template; axe on template pages | each template task (`a11y.test = 'error'`); 1 (`VISUAL_AXE_STORIES`), 16 |
| §9 colour checks reuse the `brandTheme.ts` contrast engine for sampled tenant primaries | 13 (`brandTheme.test.ts`, `tokens.test.ts`) |
| §10 phase 4 / CP4 Storybook review | 16 |
| §11 `DESIGN.md`, `components.md`, `nuxt-ui-reference.md`, `catalog.json` | 13 (§2 colour), 15; rows added per task 1-12 |
| §11 `tools/ui_policy.py` rules and `STORYBOOK_COMPONENTS` | 15 (rules); 1-12 (list entries) |
| §11 new user-facing strings in owning locale files (states) | 1 (`states.*` in `common.json`, ar/en parity) |
| §12 per-phase gates and e2e failing-title diff | every task's check step; 16 |
| §13 "Tenant colours with poor contrast" (derived steps adjusted, chosen value never changed) | 13 (`--primary` kept; `--primary-solid` derived) |
| Plan 3 carry-over: `useRowNavigation` + `data-shortcut-row` in lists | 6 |
| Plan 3 carry-over: `data-shortcut-search` / `data-shortcut-create` on the page | 7 |
| Plan 3 carry-over: `shared-createpanel--form` smoke failure | 9; proven green in 16 Step 1 |
| Plan 3 deferred: focus when the draft guard blocks a palette navigation | 14 |
| CP2 owner amendment 4 (dark primary button) | 13 |

Not in this plan, on purpose:

- Moving any page onto a template, which is Plans 5 and 6.
- The seven `*Table.vue` migrations (owner ruling 2).
- The `PageState` call-site moves.
- The print pages adopting `StandalonePage`.
- The sidebar's pinned create link following `--primary-solid`, which is a CP4 decision (a).

## Roadmap — next

**Plan 5 — Pilot: `/projects` and `/projects/[id]`** (spec §10 phase 5, CP5, decisive). The first real pages move onto the templates:

- `ProjectTable` and `TaskTable` migrate onto `SharedDataTable`, inside `SharedListPage` with `SharedViewSwitch` (`?view=board` kept). The page's create button carries `data-shortcut-create`, so `C` stops falling back to the module's pinned link.
- The project record moves onto `SharedRecordPage` with `SharedPropertiesPanel`/`SharedPropertyRow`. The project tabs render through `SharedRouteTabs`, and their sections through `SharedRecordSection`.
- The project pages' states move from `PageState` to the specific states where a page wants them.
- Every route, URL filter, heading and `data-testid` is kept.
- The plan carries CP4's decisions, including (a) on the pinned create link.
- **CP5:** shots of both pages in ar/en × light/dark and at desktop and mobile, the e2e title diff against CP4, and a live walk-through. The owner confirms or adjusts the direction before any rollout.

**Plan 6 — Rollout per application** (phase 6, shots per app). Parallel agents work on `codex/web-tasmim-<app>` sub-branches, each in its own worktree, merged only into `codex/web-tasmim`. The order is PMO (the rest), HR, Meetings, Chat, Settings/Account, Subscription, Vendor. Each application:

- migrates its remaining tables onto `SharedDataTable`: `MilestoneTable`, `FinanceEntryTable` (PMO); `DirectoryTable`, `DepartmentTable` (HR); `AuditTable`, `RoleTable`, `UserTable` (Settings/access);
- moves its `PageState` call sites to the specific states where useful;
- adopts `SharedListPage`/`SharedRecordPage`/`SharedDashboardPage`/`SharedTimelineFrame`/`SharedConversationLayout` on its pages;
- moves its standalone and print pages (login, invite, error, `meetings/[id]/print`, the charter print view) onto `SharedStandalonePage` and its `print` variant.

Each application ends with its own shot set and e2e title diff.

**Plan 7 — Close-out and merge** (phase 7):

- Remove the leftover `webvue-*` classes, scoped styles and inline styles (`RichText` and Gantt last).
- Merge `main` into the branch.
- Run the full gates: `npm test`, lint, `ui_policy`, `arch_policy --base main`, `git_policy --base main`, the Storybook and mock e2e diffs.
- Run the `reviewer` pass.
- The owner authorizes the `--no-ff` merge into `main`.

### Roadmap additions from the plan writers

- Plan 5:
  - `ChartPanel` gains `emptyText` (or an `empty` slot) so `DashboardChartPanel`'s per-chart texts can move onto it.
  - `TimelineFrame` and `DashboardPage` gain a way to hide their `PageHeader` inside the project frame (`schedule.vue:46`).
- Plan 6 (Chat): decide whether `/chat/[id]/info` becomes the `ConversationLayout` info panel. Put `data-testid="chat-thread"` on the slot content.
- Plan 6 (print pages): drop the duplicate h1 when `meetings/[id]/print` adopts `StandalonePage print`. Remove the scoped print blocks in the charter and meeting print pages once they adopt the shared print sheet.
