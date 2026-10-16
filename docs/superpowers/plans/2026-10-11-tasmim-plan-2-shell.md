# Tasmim Plan 2 — Shell

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver phase 2 of the spec — the restyled three-layer shell (48px header with breadcrumb, 64px fixed-midnight module rail with a lime active bar and the WebVue wordmark, 232px context sidebar with sections, counters, `[` collapse and persisted state, one mobile drawer below 768px), with a Storybook story and a geometry test for every shell part — ending at owner checkpoint CP2.

**Architecture:** The shell stays custom (decision and evidence below). One pure model (`composables/nav/sidebarModel.ts`, `composables/nav/breadcrumb.ts`) and one composable (`composables/useShellModel.ts`) derive everything the shell shows from the route, the identity and the manifests; `ModuleRail`, `ContextSidebar`, `MobileNavigation` and `ShellBreadcrumb` become props-only components rendered by two containers (`AppSidebar`, `ShellHeader`) inside a new `ShellFrame`. Applications contribute to the shell only through `app/modules/<app>/manifest.ts`: chat's conversation list arrives through a new typed `sidebarPanel` field and PMO's "my tasks" counter through `contextCounts`. Geometry lives in `assets/css/shell.css`; tokens stay in `tokens.css`. No Odoo, contract or API change.

**Tech Stack:** Nuxt 4, Nuxt UI 4.11.1, Tailwind 4.3, Storybook 10.6, Playwright 1.62, Vitest 4, `@tanstack/vue-query`, Python policy checks in `tools/`.

**Spec:** `docs/superpowers/specs/2026-10-11-webvue-tasmim-design.md` (§2, §3, §5, §6 contracts, §7 items 3–4, §10 phase 2, §13)

## Owner amendments (2026-10-11, binding — override any task text below)

1. Rail expansion control is removed; `data-testid="module-rail-toggle"` goes with it (approved).
2. **The PMO "my tasks" counter is deferred.** Do NOT add `AppContextCounts`, `AppManifest.contextCounts`, `contextCountsFor`, `useShellCounts`, the PMO manifest counter, or any new `GET /api/v1/tasks` request from the shell. Keep the `ContextSidebar` `counts: Record<string, number>` prop and its rendering (it renders nothing for an empty object) and keep its story/test that pass explicit `counts`, so a later plan can feed it. Drop the `/api/v1/tasks` MSW shell handler and the networkidle-for-counters rationale unless another shell request needs it. Global Constraint "The only new request is the PMO counter" becomes "No new request."
3. Sidebar sections infrastructure stays (approved) even though no application declares sections yet.
4. The header breadcrumb is approved; `ui_policy`'s breadcrumb rule flips to "one owner" as Task 5 describes.

## Decision: custom shell, not `UDashboard*`

Spec §5 adopts `UDashboardGroup/Sidebar/Panel/Navbar` only if they keep RTL behaviour and the three-layer layout. They do not; the decision is taken from source, so no spike is needed.

| Evidence (Nuxt UI 4.11.1, `node_modules/@nuxt/ui/dist/…`) | Consequence for WebVue |
|---|---|
| `shared/ui.DCJ9twx8.mjs:2420` `dashboardGroup.base: "fixed inset-0 flex overflow-hidden"`; `:2425` the navbar is `h-(--ui-header-height)` **inside each `DashboardPanel`** | The group is one horizontal row of sidebars and panels; there is no header layer spanning the context sidebar. Our header-over-sidebar frame needs the header outside the group and the group's `fixed inset-0` overridden — a two-layer layout in disguise. |
| `:2509` sidebar root `hidden lg:flex`; `:2514-2515` menu `content/overlay: "lg:hidden"`; `:2546` collapse `hidden lg:flex`; `:2556` toggle `lg:hidden`; `:2457` panel `lg:w-(--width)` | The breakpoint is hard-wired to 1024px; ours is 768px. Moving it needs theme overrides for six components in `app.config.ts`, whose keys `tools/ui_policy.py:444-448` (`ALLOWED_RECIPE_KEYS`) does not allow. |
| `runtime/components/DashboardSidebar.vue:135-167` every `UDashboardSidebar` mounts its own `Menu` (slideover/modal/drawer) | Rail + context sidebar would become two separate mobile drawers; ours is one drawer with modules and sections. |
| `DashboardSidebar.vue:75` `menuProps` defaults to `{ side: "left" }` regardless of direction | RTL needs a per-instance override; our drawer already picks its side from the locale. |
| `DashboardSidebarCollapse.vue:53-60` renders a plain `UButton`, no hydration gate | Conflicts with the `useHydrated()` rule (CLAUDE.md). |
| `runtime/composables/useResizable.js:25` collapse state persisted with `useCookie(key)` | The one good idea. We adopt the **approach** (an SSR-readable cookie) in our own `useContextSidebar`, not the component. |

**`[` shortcut:** Nuxt UI 4.11.1 cannot express `[` in layout-independent mode. `runtime/composables/defineShortcuts.js:194-198` lower-cases the key and passes it to `convertKeyToCode` (`:7-30`), which only maps letters, digits, F-keys and nine named keys, then `:110` compares `e.code !== shortcut.key` — so neither `'['` nor `'bracketleft'` ever equals `'BracketLeft'`. Without `layoutIndependent`, `:118` compares `e.key`, which is «ج» on an Arabic layout. The shell therefore listens for `event.code === 'BracketLeft'` itself (`composables/nav/sidebarShortcut.ts`); Plan 3 owns the general shortcut layer.

**Persistence:** cookie `webvue-context-sidebar` (`open` | `closed`, `path=/`, `SameSite=Lax`, one year) through Nuxt `useCookie`. It is read during SSR, so the server renders the collapsed width and the first paint never jumps; a user preference would need an API change, which this branch excludes. Same pattern as `webvue-appearance` (`composables/useAppearance.ts:17`).

## Global Constraints

- Work only in `/Users/tariq/code/nasq/.worktrees/tasmim` on branch `codex/web-tasmim`; never commit to or push `main`.
- Commit subjects: `type(web): imperative subject`, ≤ 72 chars, `type` ∈ `feat fix refactor perf test docs ci build chore`; one logical change per commit; end every message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `npm -w apps/web run lint` (from the worktree root; never `npx -w`) must be green at **every** commit, together with `npm test`.
- No changes under `odoo-addons/`, `packages/contracts/`, `apps/control-plane/`. The only new request is the PMO counter, which uses the existing `GET /api/v1/tasks`.
- No route or visible-heading changes. `data-testid`s are kept, except `module-rail-toggle`, which is removed with the rail-expansion control (Task 3). New: `shell-breadcrumb`, `vendor-console-badge`. Never rename an e2e test title (the failing-title diff keys on titles).
- R3: nothing under `components/shell/` or `layouts/` imports or tags an application component folder (`project task meetings hr chat`) or `modules/<app>`; Task 2 makes `tools/arch_policy.py` enforce it. Applications contribute to the shell only through `app/modules/<app>/manifest.ts`.
- `tools/arch_baseline.json` only shrinks, and only through `python3 -B tools/arch_policy.py --write-baseline`; `tools/arch_layers.json` is not touched.
- Logical properties only (`inset-inline-*`, `margin-inline-*`, `border-inline-*`, `ms- me- ps- pe- start- end- text-start`). No physical `left/right` in new CSS or classes.
- Interactive shell controls stay disabled until `useHydrated()` is true (context toggle, mobile trigger, appearance, account, search).
- Every user-facing string in `apps/web/i18n/locales/{ar,en}/<owner>.json` with ar/en parity; shell strings are `nav.*` in `common.json`.
- Every shell component ships with a story (with `storyContext(...)`), an entry in `STORYBOOK_COMPONENTS` (`tools/ui_policy.py:37`), a row in `docs/design-system/components.md`, and the catalog regenerated (`node tools/ui_catalog.mjs`) in the same commit — `npm test` runs `ui_catalog.mjs --check` and `ui_policy.py`.
- After changing a story or a cited file, run `python3 -B tools/ui_policy.py --refresh-story-context` to repoint `storyContext` line numbers.
- Shell geometry (px, independent of the font size): header 48px; module rail 64px, full height, always midnight, no expand state; context sidebar 232px, 48px collapsed, 400px for a wide sidebar panel (320px between 768–1100px); below 768px the rail and sidebar are hidden, the header spans the width and the drawer is `min(320px, 100vw − 48px)` (320px at 390px) from the inline-start side; mobile header controls ≥ 44px.
- Content widths keep the `webvue-page-width-*` vocabulary: `list` becomes full width (`max-width: none`, spec §5 "full width for tables/boards/dashboards"); `detail` 68rem and `form` 58rem stay.
- Never use ports 3000 or 8069 or the `odoo19` database; the mock stack uses 4097 (Nuxt) / 4498 (mock API).
- Palette from Plan 1: rail `--webvue-rail` `#13234a` light / `#0d1a38` dark (`rgb(19, 35, 74)` / `rgb(13, 26, 56)`), lime `#c8f031` (`rgb(200, 240, 49)`). Lime appears in the shell only as the rail's active bar and the wordmark dot.

## Review Focus

1. **Arabic keyboard user presses the `[` key** (it types «ج») — expected: the context sidebar toggles; the same key inside a field, with a modifier, or while a menu/dialog is open does nothing. Pinned in Task 4 (`sidebarShortcut.test.ts` + `shell-tasmim.spec.ts` "[ toggles the sidebar…").
2. **A user who collapsed the sidebar reloads or opens a new tab** — expected: the server renders `data-expanded="false"` at 48px before hydration, the toggle is disabled until hydrated, then works on the first click. Pinned in Task 4 (`contextSidebarState.test.ts` + `shell-tasmim.spec.ts` "collapse survives a reload…").
3. **A tenant whose primary is bright magenta or near-white** — expected: the rail stays midnight in both modes and the active bar stays lime. Pinned in Task 3 (`storybook-shell.spec.ts` "rail stays midnight under a bright tenant primary").
4. **English (LTR) after Arabic (RTL)** — expected: rail, sidebar and header mirror; the lime bar is on the rail's inline-start edge (right in ar, left in en); the drawer enters from the inline-start side. Pinned in Task 3 (geometry + lime bar tests, both locales) and Task 6 (drawer test, both locales).
5. **Phone at 390px with large text** — expected: header controls ≥ 44px, no horizontal overflow, the drawer is 320px, the menu trigger waits for hydration and the drawer closes after navigating. Pinned in Task 6 (`storybook-shell.spec.ts` drawer tests + `shell-tasmim.spec.ts` "menu waits for hydration…").

---

### Task 1: Harden the Storybook test harness (Plan 1 deferred items)

Covers the final-review items M2, M3, M4 and the deferred minors for `.storybook/preview.ts:50`, `BrandWordmark` test and `VISUAL_STORIES` (`.superpowers/tasmim-shared/deferred-minors-plan1.txt`).

**Files:**
- Modify: `apps/web/e2e/support/storybookServer.ts` (add `requireStorybook`)
- Modify: `apps/web/e2e/storybook-smoke.spec.ts:13`, `apps/web/e2e/storybook-visual.spec.ts:13`, `apps/web/e2e/storybook-density.spec.ts:9,13-17`
- Modify: `apps/web/e2e/support/visualStories.ts:3-15`
- Modify: `apps/web/.storybook/preview.ts:50`
- Create: `apps/web/app/assets/css/__tests__/tokens.test.ts`
- Modify: `apps/web/app/components/shared/__tests__/BrandWordmark.test.ts`
- Create (generated): `apps/web/e2e/storybook-visual.spec.ts-snapshots/shared-brandwordmark--*-darwin.png`

**Interfaces:**
- Produces: `requireStorybook(): void` (call inside a `test.describe` body; skips when `storybook-static` is missing, unless `WEBVUE_REQUIRE_STORYBOOK=1`, where it registers one failing test). Every later Storybook spec uses it.

- [ ] **Step 1: Write the failing token tests (M2, M3)**

Create `apps/web/app/assets/css/__tests__/tokens.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DARK_SURFACES } from '../../../utils/webvuePalette'

const sheet = (name: string) => readFileSync(resolve(import.meta.dirname, '..', name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/** Bodies of every innermost rule whose selector is exactly `selector`, joined. */
function ruleBodies(css: string, selector: string): string {
  const bodies: string[] = []
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (match[1]!.trim() === selector) bodies.push(match[2]!)
  }
  return bodies.join('\n')
}

function declarations(body: string): Map<string, string> {
  const found = new Map<string, string>()
  for (const declaration of body.split(';')) {
    const colon = declaration.indexOf(':')
    if (colon > 0) found.set(declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim())
  }
  return found
}

const LITERAL = /^#[0-9a-f]{6}$/i

describe('the module rail is fixed WebVue midnight', () => {
  for (const selector of [':root', '.dark']) {
    it(`${selector} declares --webvue-rail and --webvue-rail-deep as literal colours`, () => {
      const found = declarations(ruleBodies(sheet('tokens.css'), selector))
      expect(found.get('--webvue-rail')).toMatch(LITERAL)
      expect(found.get('--webvue-rail-deep')).toMatch(LITERAL)
    })
  }

  it('.webvue-module-rail paints with the rail tokens and nothing tenant-derived', () => {
    const rail = ruleBodies(sheet('shell.css'), '.webvue-module-rail')
    expect(rail).toContain('var(--webvue-rail)')
    expect(rail).toContain('var(--webvue-rail-deep)')
    expect(rail).not.toMatch(/--primary|--brand|--ui-primary|--color-brand/)
  })
})

describe('dark surfaces', () => {
  it('tokens.css .dark matches DARK_SURFACES', () => {
    const found = declarations(ruleBodies(sheet('tokens.css'), '.dark'))
    const expected: Record<string, string> = {
      '--ui-bg': DARK_SURFACES.bg,
      '--ui-bg-muted': DARK_SURFACES.muted,
      '--ui-bg-elevated': DARK_SURFACES.elevated,
      '--ui-bg-accented': DARK_SURFACES.accented,
      '--ui-border': DARK_SURFACES.border,
      '--ui-border-muted': DARK_SURFACES.borderMuted,
      '--ui-border-accented': DARK_SURFACES.borderAccented,
    }
    for (const [token, value] of Object.entries(expected)) expect(found.get(token)?.toLowerCase(), token).toBe(value)
  })
})
```

- [ ] **Step 2: Prove the tests bite, then restore**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim/apps/web
npx vitest run app/assets/css/__tests__/tokens.test.ts
sed -i '' 's/--webvue-rail: #13234a;/--webvue-rail: var(--primary);/' app/assets/css/tokens.css
npx vitest run app/assets/css/__tests__/tokens.test.ts; git checkout app/assets/css/tokens.css
```
Expected: first run PASS (4 tests); the run after `sed` FAILS on `:root declares --webvue-rail…`; `git checkout` restores the file.

- [ ] **Step 3: Extend the BrandWordmark test**

Append inside `describe('BrandWordmark', …)` in `apps/web/app/components/shared/__tests__/BrandWordmark.test.ts`:

```ts
  it('uses highlighted text when not inverted', async () => {
    const root = (await render()).match(/<span class="([^"]*)"/)?.[1] ?? ''
    expect(root).toContain('text-highlighted')
    expect(root).not.toContain('text-white')
  })

  it.each([
    ['sm', 'text-sm', 'size-1.5'],
    ['md', 'text-base', 'size-2'],
    ['lg', 'text-xl', 'size-2.5'],
  ])('sizes the %s wordmark and its dot together', async (size, text, dot) => {
    const html = await render({ size })
    expect(html.match(/<span class="([^"]*)"/)?.[1]).toContain(text)
    expect(html.match(/<span[^>]*data-slot="dot"[^>]*>/)?.[0]).toContain(dot)
  })
```
Run: `npx vitest run app/components/shared/__tests__/BrandWordmark.test.ts` — Expected: PASS (6 tests).

- [ ] **Step 4: Storybook specs fail instead of skip on demand (M4)**

Append to `apps/web/e2e/support/storybookServer.ts`:

```ts
import { test } from '@playwright/test'

/**
 * Call inside a `test.describe` body. Without a Storybook build the describe is
 * skipped, unless WEBVUE_REQUIRE_STORYBOOK=1 (checkpoints and CI), where a missing
 * build is a failure, not a silent skip.
 */
export function requireStorybook(): void {
  if (storybookBuilt) return
  if (process.env.WEBVUE_REQUIRE_STORYBOOK === '1') {
    test('Storybook build is present', () => {
      throw new Error('WEBVUE_REQUIRE_STORYBOOK=1 but apps/web/storybook-static/index.json is missing. Run `npm -w apps/web run build-storybook`.')
    })
    return
  }
  test.skip(true, 'Run `npm -w apps/web run build-storybook` first.')
}
```
(Put the `import` at the top of the file with the other imports.)

In `storybook-smoke.spec.ts:13`, `storybook-visual.spec.ts:13` and `storybook-density.spec.ts:9`, replace the line `test.skip(!built, …)` / `test.skip(!storybookBuilt, …)` with `requireStorybook()` and import it from `./support/storybookServer` (drop the now-unused `storybookBuilt`/`built` import where nothing else uses it).

In `storybook-density.spec.ts`, add the English large row to the matrix (en root is 17px at `large`, `tokens.css` `:root:lang(en)[data-font-size="large"]`):

```ts
  for (const [globals, root] of [
    ['locale:ar;appearance:light;fontSize:small', 14],
    ['locale:en;appearance:light;fontSize:small', 13],
    ['locale:ar;appearance:dark;fontSize:large', 18],
    ['locale:en;appearance:light;fontSize:large', 17],
  ] as const) {
```

- [ ] **Step 5: Small cleanups**

- `apps/web/.storybook/preview.ts:50`: `root.classList.remove('dark', 'cream')` → `root.classList.remove('dark')`.
- `apps/web/e2e/support/visualStories.ts`: add `'shared-brandwordmark--',` after `'foundations-',` and change the comment to: `// Story-id prefixes captured by storybook-visual.spec.ts. Plans append the stories they introduce; shell stories are listed from Tasmim Plan 2.`

- [ ] **Step 6: Run the specs**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim/apps/web
npm run build-storybook
npx playwright test e2e/storybook-visual.spec.ts -g 'shared-brandwordmark' --update-snapshots=missing --reporter=line
npx playwright test e2e/storybook-visual.spec.ts e2e/storybook-density.spec.ts e2e/storybook-smoke.spec.ts --reporter=line
mv storybook-static storybook-static.off
WEBVUE_REQUIRE_STORYBOOK=1 npx playwright test e2e/storybook-density.spec.ts --reporter=line; mv storybook-static.off storybook-static
```
Expected: the `--update-snapshots=missing` run writes 8 `shared-brandwordmark--*` PNGs; the second run passes (density now 8 tests); the third run reports `1 failed` with the "WEBVUE_REQUIRE_STORYBOOK=1 but … missing" message.

- [ ] **Step 7: Gates and commit**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim
npm -w apps/web run lint && npm test 2>&1 | tail -5 && python3 -B tools/ui_policy.py
git add apps/web/e2e apps/web/.storybook/preview.ts apps/web/app/assets/css/__tests__ apps/web/app/components/shared/__tests__/BrandWordmark.test.ts
git commit -m "test(web): harden Storybook gates and pin rail and dark tokens

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: One shell model, props-only sidebars, chat panel through its manifest

Behaviour-preserving refactor (old geometry and styles still apply), plus §7 item 3: `ContextSidebar` stops importing `chat/ConversationList.vue`.

**Files:**
- Modify: `apps/web/app/modules/types.ts:7-83` (add `AppSidebarPanel`, `AppContextLink.section`, `AppManifest.sidebarPanel`; update the header comment)
- Modify: `apps/web/app/modules/surfaces.ts` (add `sidebarPanelFor`)
- Modify: `apps/web/app/modules/chat/manifest.ts` (add `sidebarPanel`)
- Create: `apps/web/app/components/chat/ChatSidebarPanel.vue`
- Modify: `apps/web/app/composables/nav/shellModules.ts:120-128` (`ShellContextLink.section`)
- Create: `apps/web/app/composables/nav/sidebarModel.ts`, `apps/web/app/composables/useShellModel.ts`
- Rewrite: `apps/web/app/components/shell/ContextSidebar.vue`, `apps/web/app/components/shell/MobileNavigation.vue`, `apps/web/app/components/shell/AppSidebar.vue`
- Modify: `apps/web/app/components/shell/ShellHeader.vue` (wire the drawer)
- Modify: `apps/web/app/assets/css/shell.css:272-273,287-290,307,384` (`data-chat` → `data-panel` / `data-panel-width`)
- Modify: `tools/arch_policy.py:478-488` (scan shell and layouts), `tools/test_arch_policy.py` (new test)
- Modify: `docs/design-system/components.md` (chat row: `ChatSidebarPanel.vue`)
- Test: create `apps/web/app/composables/nav/__tests__/sidebarModel.test.ts`; extend `apps/web/app/modules/__tests__/surfaces.test.ts`

**Interfaces:**
- Produces (types.ts):
  ```ts
  export interface AppSidebarPanel {
    module: string
    width: 'default' | 'wide'
    load: () => Promise<{ default: Component }>
  }
  // AppContextLink gains: section?: string        (locale key of its section heading)
  // AppManifest gains:   sidebarPanel?: AppSidebarPanel
  ```
- Produces (`surfaces.ts`): `sidebarPanelFor(module: string | null): AppSidebarPanel | undefined`.
- Produces (`sidebarModel.ts`): `ShellRailItem { id; labelKey; icon: string; to: string; external: boolean }`, `ShellContextSection { id: string; titleKey: string | null; links: ShellContextLink[] }`, `ShellSidebarModel { createLinks; sections; showNav }`, `railModel(modules)`, `groupSections(links)`, `sidebarModel(input)`, `contextLinkTestId(id)`.
- Produces (`useShellModel.ts`): `useShellModel()` → `{ activeModule, contextModule, rail, homePath, contextTitle, contextLabelKey, contextLinks, panel, panelView, motionKey, projectId, project, identity, createTo }` (all `ComputedRef`s except `createTo(link: ShellContextLink): RouteLocationRaw`).
- Produces (components): `ContextSidebar` props `{ title: string; createLinks: ShellContextLink[]; sections: ShellContextSection[]; showNav: boolean; counts: Record<string, number>; expanded: boolean; hydrated: boolean; panel: Component | null; renderPanel: boolean; panelWidth: 'default' | 'wide'; motionKey: string }`, emits `toggle`. `MobileNavigation` props `{ modules: ShellRailItem[]; activeId: string | null; title: string; createLinks: ShellContextLink[]; sections: ShellContextSection[] }` + `v-model:open`.

- [ ] **Step 1: Make arch_policy see the shell (failing first)**

In `tools/test_arch_policy.py`, class `TestCollect`, add:

```python
    def test_shell_and_layout_name_no_application(self):
        self.clean_tree()
        self.write('apps/web/app/components/shell/ContextSidebar.vue',
                   "<script setup>import L from '@/components/hr/List.vue'</script><template><TaskRow /></template>\n")
        self.write('apps/web/app/layouts/default.vue', '<template><ProjectMenu /></template>\n')
        self.write('apps/web/app/components/shell/ShellHeader.vue',
                   "<script setup>import N from '@/components/notifications/NotificationCenter.vue'</script>\n")
        violations, _ = collect(self.root, self.layers)
        self.assertEqual(violations['R3'], {
            'web apps/web/app/components/shell/ContextSidebar.vue': 2,
            'web apps/web/app/layouts/default.vue': 1,
        })
```

In `tools/arch_policy.py`, at the end of `collect()` just before `return v, hard`, add:

```python
    # The foundation shell (layout and shell components) names no application (R3).
    for folder in (web / 'app' / 'components' / 'shell', web / 'app' / 'layouts'):
        for path in sorted(folder.rglob('*')) if folder.is_dir() else []:
            rel = _rel(path, root)
            if path.is_file() and path.suffix in ('.ts', '.vue') and not is_test_path(Path(rel)):
                _put(v['R3'], f'web {rel}', foreign_component_uses(_read(path), '', web_apps, rel))
```

Run:
```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim
(cd tools && python3 -B -m unittest test_arch_policy -q) && python3 -B tools/arch_policy.py; echo "exit=$?"
```
Expected: unit tests pass; `arch_policy.py` FAILS with `R3: web apps/web/app/components/shell/ContextSidebar.vue: 1 found, baseline allows 0` (the chat import). Steps 2–8 remove it; the baseline is never edited.

- [ ] **Step 2: Types and surfaces**

In `apps/web/app/modules/types.ts`:
- First line: `import type { Component } from 'vue'` beside the zod import.
- Replace the header comment with:
  ```ts
  /**
   * Application manifest: the one place an application declares its web surface.
   * Data only: manifests import no components, except the lazy `sidebarPanel.load`
   * (a dynamic import of the application's own panel). Icons are Iconify strings.
   */
  ```
- `AppContextLink` becomes:
  ```ts
  export interface AppContextLink {
    id: string; labelKey: string; icon: AppIcon; to: string; capability: string; pinned?: boolean
    /** Locale key of the sidebar section heading; consecutive links with the same key form one section. */
    section?: string
  }
  ```
- Add before `AppManifest`:
  ```ts
  /**
   * Content an application shows in the context sidebar of its rail module, below its links
   * (chat: the conversation list). Lazily loaded; the component takes no props and reads the route.
   * On desktop no pinned create action shows beside it, and while the sidebar is expanded the
   * module's links give way to it.
   */
  export interface AppSidebarPanel {
    /** Rail module whose sidebar hosts the panel. */
    module: string
    /** 'wide' widens the sidebar to 400px (320px between 768 and 1100px). */
    width: 'default' | 'wide'
    load: () => Promise<{ default: Component }>
  }
  ```
- In `AppManifest`, after `search?: AppSearchProvider[]`: `sidebarPanel?: AppSidebarPanel`.

In `apps/web/app/modules/surfaces.ts`, import `AppSidebarPanel` with the other types and add:

```ts
/** The sidebar panel an application declares for a rail module, if any. */
export function sidebarPanelFor(module: string | null): AppSidebarPanel | undefined {
  if (!module) return undefined
  return activeManifests().find(manifest => manifest.sidebarPanel?.module === module)?.sidebarPanel
}
```

In `apps/web/app/modules/__tests__/surfaces.test.ts`, import `sidebarPanelFor` and add:

```ts
describe('manifest sidebar panels', () => {
  it('gives chat a wide panel and no other module one', () => {
    expect(sidebarPanelFor('chat')?.width).toBe('wide')
    expect(typeof sidebarPanelFor('chat')?.load).toBe('function')
    expect(sidebarPanelFor('projects')).toBeUndefined()
    expect(sidebarPanelFor(null)).toBeUndefined()
  })
  it('finds a panel a newer application registers', () => {
    const panel = { module: 'sales', width: 'default' as const, load: async () => ({ default: {} }) }
    withManifests([...activeManifests(), { ...sales, sidebarPanel: panel }], () => {
      expect(sidebarPanelFor('sales')).toBe(panel)
    })
  })
})
```

- [ ] **Step 3: Chat supplies its panel**

Create `apps/web/app/components/chat/ChatSidebarPanel.vue`:

```vue
<script setup lang="ts">
import ConversationList from '@/components/chat/ConversationList.vue'
import { parseChatListRoute, serializeChatListRoute, type ChatListRoute } from '@/utils/chatState'

// The chat manifest's context-sidebar panel (AppManifest.sidebarPanel): the
// conversation list beside the open thread. The shell renders it without
// naming chat (R3); the panel owns its own list state in the URL.
const route = useRoute()
const router = useRouter()
const routeState = computed(() => parseChatListRoute(route.query))
const selectedId = computed(() => {
  const id = Number(route.path.match(/^\/chat\/(\d+)(?:\/|$)/)?.[1])
  return Number.isSafeInteger(id) && id > 0 ? id : undefined
})

function updateRoute(next: ChatListRoute) {
  void router.replace({ path: route.path, query: serializeChatListRoute(next) })
}
</script>

<template>
  <ConversationList class="min-h-0 flex-1" :route-state="routeState" :selected-id="selectedId" @update:route-state="updateRoute" />
</template>
```

In `apps/web/app/modules/chat/manifest.ts`, after `contextLinks`:

```ts
  sidebarPanel: { module: 'chat', width: 'wide', load: () => import('../../components/chat/ChatSidebarPanel.vue') },
```

In `docs/design-system/components.md`, add `` `apps/web/app/components/chat/ChatSidebarPanel.vue` (لوحة المحادثات في القائمة السياقية عبر `sidebarPanel`) `` to the chat row (find it with `rg -n "chat/ConversationList" docs/design-system/components.md`).

- [ ] **Step 4: The pure sidebar model (failing test first)**

In `apps/web/app/composables/nav/shellModules.ts`, add to `ShellContextLink` (line ~127): `section?: string`.

Create `apps/web/app/composables/nav/__tests__/sidebarModel.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { ShellContextLink } from '../shellModules'
import { contextLinkTestId, groupSections, railModel, sidebarModel } from '../sidebarModel'

const link = (id: string, extra: Partial<ShellContextLink> = {}): ShellContextLink =>
  ({ id, labelKey: `nav.${id}`, icon: 'i-lucide-circle', to: `/${id}`, capability: 'x.y.read', ...extra })

describe('rail model', () => {
  it('keeps rail order and puts settings and the console in the utility slot', () => {
    const rail = railModel([
      { id: 'home', labelKey: 'nav.home', icon: 'i-lucide-house', to: '/projects/dashboard' },
      { id: 'settings', labelKey: 'nav.settings', icon: 'i-lucide-settings', to: '/settings/users' },
      { id: 'management', labelKey: 'nav.management', icon: 'i-lucide-building-2', to: '/vendor/overview' },
      { id: 'vendor', labelKey: 'nav.console', icon: 'i-lucide-wrench', to: '/odoo' },
    ])
    expect(rail.all.map(item => item.id)).toEqual(['home', 'settings', 'management', 'vendor'])
    expect(rail.primary.map(item => item.id)).toEqual(['home', 'management'])
    expect(rail.utility.map(item => item.id)).toEqual(['settings', 'vendor'])
    expect(rail.all.filter(item => item.external).map(item => item.id)).toEqual(['vendor'])
  })
})

describe('sidebar model', () => {
  const projects = [link('projects'), link('new-project', { pinned: true, to: '/projects/new' }), link('tasks')]
  const chat = [link('new-chat', { pinned: true }), link('chat')]

  it('puts pinned create actions first and hides new project on the projects list', () => {
    const onTasks = sidebarModel({ links: projects, moduleLabelKey: 'nav.projects', path: '/tasks', panel: null, surface: 'desktop' })
    expect(onTasks.createLinks.map(item => item.id)).toEqual(['new-project'])
    expect(onTasks.sections.flatMap(section => section.links.map(item => item.id))).toEqual(['projects', 'tasks'])
    expect(sidebarModel({ links: projects, moduleLabelKey: 'nav.projects', path: '/projects', panel: null, surface: 'desktop' }).createLinks).toEqual([])
  })

  it('gives an expanded desktop panel the whole sidebar', () => {
    const model = sidebarModel({ links: chat, moduleLabelKey: 'nav.chat', path: '/chat', panel: { expanded: true }, surface: 'desktop' })
    expect(model).toEqual({ createLinks: [], sections: [], showNav: false })
  })

  it('shows the links but no create action beside a collapsed panel', () => {
    const model = sidebarModel({ links: chat, moduleLabelKey: 'nav.other', path: '/chat', panel: { expanded: false }, surface: 'desktop' })
    expect(model.createLinks).toEqual([])
    expect(model.sections.flatMap(section => section.links.map(item => item.id))).toEqual(['chat'])
    expect(model.showNav).toBe(true)
  })

  it('hides a lone desktop link that only repeats the heading', () => {
    expect(sidebarModel({ links: chat, moduleLabelKey: 'nav.chat', path: '/chat', panel: { expanded: false }, surface: 'desktop' }).showNav).toBe(false)
  })

  it('ignores the panel in the mobile drawer', () => {
    const model = sidebarModel({ links: chat, moduleLabelKey: 'nav.chat', path: '/chat', panel: null, surface: 'mobile' })
    expect(model.createLinks.map(item => item.id)).toEqual(['new-chat'])
    expect(model.showNav).toBe(true)
  })

  it('groups consecutive links by section with unique ids', () => {
    const sections = groupSections([link('a'), link('b', { section: 'nav.s1' }), link('c', { section: 'nav.s1' }), link('d')])
    expect(sections.map(section => [section.titleKey, section.links.map(item => item.id)])).toEqual([[null, ['a']], ['nav.s1', ['b', 'c']], [null, ['d']]])
    expect(new Set(sections.map(section => section.id)).size).toBe(3)
  })

  it('keeps the three legacy Playwright ids', () => {
    expect(contextLinkTestId('users')).toBe('sidebar-settings')
    expect(contextLinkTestId('project-settings')).toBe('settings-projects-tab')
    expect(contextLinkTestId('branding')).toBe('settings-branding-tab')
    expect(contextLinkTestId('tasks')).toBe('context-link-tasks')
  })
})
```
Run: `cd apps/web && npx vitest run app/composables/nav/__tests__/sidebarModel.test.ts` — Expected: FAIL (module missing).

Create `apps/web/app/composables/nav/sidebarModel.ts`:

```ts
// Relative imports: this module is unit-tested directly under plain vitest.
import { hidePinnedNewProject, type ShellContextLink, type ShellModuleDefinition } from './shellModules'

/** One rail entry as the rail and the mobile drawer render it. */
export interface ShellRailItem { id: string; labelKey: string; icon: string; to: string; external: boolean }
/** A run of context links under one optional section heading (a locale key). */
export interface ShellContextSection { id: string; titleKey: string | null; links: ShellContextLink[] }
export interface ShellSidebarModel { createLinks: ShellContextLink[]; sections: ShellContextSection[]; showNav: boolean }

const UTILITY_MODULES: ReadonlySet<string> = new Set(['settings', 'vendor'])

/** Rail entries in rail order; settings and the vendor console sit in the utility slot at the bottom. */
export function railModel(modules: readonly ShellModuleDefinition[]): { all: ShellRailItem[]; primary: ShellRailItem[]; utility: ShellRailItem[] } {
  const all = modules.map(module => ({ id: module.id, labelKey: module.labelKey, icon: module.icon, to: module.to, external: module.id === 'vendor' }))
  return { all, primary: all.filter(item => !UTILITY_MODULES.has(item.id)), utility: all.filter(item => UTILITY_MODULES.has(item.id)) }
}

/** Consecutive links that share a `section` key form one section, in manifest order. */
export function groupSections(links: readonly ShellContextLink[]): ShellContextSection[] {
  const sections: ShellContextSection[] = []
  for (const link of links) {
    const titleKey = link.section ?? null
    const last = sections.at(-1)
    if (last && last.titleKey === titleKey) last.links.push(link)
    else sections.push({ id: `${titleKey ?? 'section'}-${sections.length}`, titleKey, links: [link] })
  }
  return sections
}

/**
 * What the context sidebar (desktop) or the drawer (mobile) lists for the current module:
 * pinned create actions first, then navigation. A module with a sidebar panel shows no create
 * action beside it on desktop, and while the panel is expanded its links give way to the panel.
 */
export function sidebarModel(input: {
  links: readonly ShellContextLink[]
  moduleLabelKey: string | null
  path: string
  /** Set when the module's panel renders (desktop only). */
  panel: { expanded: boolean } | null
  surface: 'desktop' | 'mobile'
}): ShellSidebarModel {
  const ordered = [...input.links.filter(link => link.pinned), ...input.links.filter(link => !link.pinned)]
  const desktopPanel = input.surface === 'desktop' && input.panel !== null
  const visible = desktopPanel && input.panel!.expanded ? ordered.filter(link => link.pinned) : ordered
  const createLinks = desktopPanel
    ? []
    : visible.filter(link => link.pinned && !(link.id === 'new-project' && hidePinnedNewProject(input.path)))
  const navigation = visible.filter(link => !link.pinned)
  const onlyRepeatsHeading = createLinks.length === 0 && navigation.length === 1 && navigation[0]!.labelKey === input.moduleLabelKey
  const showNav = navigation.length > 0 && (input.surface === 'mobile' || !onlyRepeatsHeading)
  return { createLinks, sections: groupSections(navigation), showNav }
}

const LEGACY_TEST_IDS: Readonly<Record<string, string>> = {
  users: 'sidebar-settings',
  'project-settings': 'settings-projects-tab',
  branding: 'settings-branding-tab',
}

/** Playwright hook of a context link; three keep the ids older specs use. */
export function contextLinkTestId(id: string): string {
  return LEGACY_TEST_IDS[id] ?? `context-link-${id}`
}
```
Run the test again — Expected: PASS (8 tests).

- [ ] **Step 5: `useShellModel`**

Create `apps/web/app/composables/useShellModel.ts`:

```ts
import { defineAsyncComponent, type Component } from 'vue'
import type { RouteLocationRaw } from 'vue-router'
import { useShellNavigation } from './useShellNavigation'
import { shellModuleList, visibleShellModules, type ShellContextLink } from './nav/shellModules'
import { contextModuleFor } from './nav/activeRoute'
import { createLinkTo } from './nav/createActions'
import { railModel } from './nav/sidebarModel'
import { sidebarPanelFor } from '../modules/surfaces'
import type { AppSidebarPanel } from '../modules/types'
import { firstAllowedPath } from '../utils/accessPolicy'

// One async wrapper per declared panel, so a route change inside the module never remounts it.
const panelViews = new WeakMap<AppSidebarPanel, Component>()
function panelView(panel: AppSidebarPanel): Component {
  let view = panelViews.get(panel)
  if (!view) {
    view = defineAsyncComponent(panel.load)
    panelViews.set(panel, view)
  }
  return view
}

/** Everything the shell renders, derived from the route, the identity and the manifests. */
export function useShellModel() {
  const { t } = useI18n()
  const route = useRoute()
  const { me } = useMe()
  const identity = useWorkspaceIdentity()
  const { activeModule, module, projectId, project, contextLinks } = useShellNavigation(identity)
  // `home` and `projects` share one projects sidebar (2026-09-11).
  const contextModule = computed(() => contextModuleFor(activeModule.value))
  const definition = computed(() => shellModuleList().find(item => item.id === contextModule.value) ?? module.value)
  const rail = computed(() => railModel(visibleShellModules(identity.value)))
  const homePath = computed(() => firstAllowedPath(me.value))
  const contextTitle = computed(() => definition.value ? t(definition.value.labelKey) : t('app.productName'))
  const contextLabelKey = computed(() => definition.value?.labelKey ?? null)
  const panel = computed(() => sidebarPanelFor(contextModule.value) ?? null)
  const panelComponent = computed(() => panel.value ? panelView(panel.value) : null)
  const motionKey = computed(() => `module:${contextModule.value ?? 'none'}`)

  function createTo(link: ShellContextLink): RouteLocationRaw {
    return createLinkTo(link, { path: route.path, fullPath: route.fullPath, query: route.query, params: route.params })
  }

  return {
    activeModule, contextModule, rail, homePath, contextTitle, contextLabelKey, contextLinks,
    panel, panelView: panelComponent, motionKey, projectId, project, identity, createTo,
  }
}
```

- [ ] **Step 6: Props-only `ContextSidebar` and `MobileNavigation`**

Replace `apps/web/app/components/shell/ContextSidebar.vue` with:

```vue
<script setup lang="ts">
import type { Component } from 'vue'
import type { ShellContextLink } from '@/composables/nav/shellModules'
import { contextLinkTestId, type ShellContextSection } from '@/composables/nav/sidebarModel'

// The context sidebar (Tasmim spec §5). Props only: AppSidebar derives what it
// shows from useShellModel(); an application's panel arrives as `panel`.
const props = defineProps<{
  title: string
  createLinks: ShellContextLink[]
  sections: ShellContextSection[]
  showNav: boolean
  counts: Record<string, number>
  expanded: boolean
  hydrated: boolean
  panel: Component | null
  renderPanel: boolean
  panelWidth: 'default' | 'wide'
  motionKey: string
}>()
const emit = defineEmits<{ toggle: [] }>()
const { t } = useI18n()
const navigationId = `context-navigation-${useId()}`
const countId = (id: string) => `${navigationId}-count-${id}`
const countLabel = (value: number) => (value > 99 ? '99+' : String(value))
</script>

<template>
  <aside
    data-testid="context-sidebar"
    class="webvue-context-sidebar"
    :data-expanded="props.expanded"
    :data-panel="props.panel ? 'true' : undefined"
    :data-panel-width="props.panel ? props.panelWidth : undefined"
    :aria-label="t('nav.context')"
  >
    <Transition name="webvue-context" mode="out-in">
      <div :id="navigationId" :key="props.motionKey" class="webvue-context-sidebar-inner">
        <div class="webvue-context-heading">
          <h2>{{ props.title }}</h2>
          <div v-if="props.createLinks.length" class="webvue-context-create-actions">
            <UTooltip v-for="link in props.createLinks" :key="link.id" :text="t(link.labelKey)">
              <UButton
                :to="link.to"
                color="primary"
                variant="ghost"
                square
                size="sm"
                icon="i-lucide-plus"
                class="webvue-context-create-icon"
                :data-active="link.active"
                :aria-current="link.active ? 'page' : undefined"
                :aria-label="t(link.labelKey)"
                :data-testid="`context-link-${link.id}`"
              />
            </UTooltip>
          </div>
        </div>

        <nav v-if="props.showNav" class="webvue-context-nav" :aria-label="props.title">
          <div v-for="section in props.sections" :key="section.id" class="webvue-context-section">
            <h3 v-if="section.titleKey" class="webvue-context-section-title">{{ t(section.titleKey) }}</h3>
            <div v-for="link in section.links" :key="link.id" class="webvue-context-row">
              <UTooltip :text="t(link.labelKey)" :disabled="props.expanded">
                <UButton
                  :to="link.to"
                  color="neutral"
                  variant="ghost"
                  class="webvue-context-link"
                  :data-active="link.active"
                  :active="!!link.active"
                  :aria-current="link.active ? 'page' : undefined"
                  :aria-label="t(link.labelKey)"
                  :aria-describedby="props.counts[link.id] !== undefined ? countId(link.id) : undefined"
                  :data-testid="contextLinkTestId(link.id)"
                >
                  <template #leading>
                    <UIcon :name="link.icon" class="webvue-shell-icon size-4.5 shrink-0" aria-hidden="true" />
                  </template>
                  <span data-slot="label">{{ t(link.labelKey) }}</span>
                </UButton>
              </UTooltip>
              <span v-if="props.counts[link.id] !== undefined" :id="countId(link.id)" class="webvue-context-count">{{ countLabel(props.counts[link.id]!) }}</span>
            </div>
          </div>
        </nav>

        <div v-if="props.panel && props.renderPanel" v-show="props.expanded" class="webvue-context-panel">
          <component :is="props.panel" />
        </div>

        <div class="webvue-context-footer">
          <UTooltip :text="t(props.expanded ? 'nav.collapseContext' : 'nav.expandContext')" :kbds="['[']">
            <UButton
              type="button"
              color="neutral"
              variant="ghost"
              square
              size="sm"
              class="webvue-context-toggle"
              data-testid="context-sidebar-toggle"
              :disabled="!props.hydrated"
              :aria-expanded="props.expanded"
              :aria-controls="navigationId"
              aria-keyshortcuts="["
              :aria-label="t(props.expanded ? 'nav.collapseContext' : 'nav.expandContext')"
              @click="emit('toggle')"
            >
              <template #leading>
                <UIcon :name="props.expanded ? 'i-lucide-panel-left-close' : 'i-lucide-panel-left-open'" class="webvue-shell-icon size-4.5 shrink-0 rtl:-scale-x-100" aria-hidden="true" />
              </template>
            </UButton>
          </UTooltip>
        </div>
      </div>
    </Transition>
  </aside>
</template>
```

Replace `apps/web/app/components/shell/MobileNavigation.vue` with:

```vue
<script setup lang="ts">
import type { SlideoverProps } from '@nuxt/ui'
import { useMediaQuery } from '@vueuse/core'
import type { RouteLocationRaw } from 'vue-router'
import SidebarCreateAction from '@/components/shell/SidebarCreateAction.vue'
import type { ShellContextLink } from '@/composables/nav/shellModules'
import type { ShellContextSection, ShellRailItem } from '@/composables/nav/sidebarModel'

// The one mobile drawer (< 768px): modules, then the current module's create
// actions and sections. Props only; ShellHeader derives them from useShellModel().
const props = defineProps<{
  modules: ShellRailItem[]
  activeId: string | null
  title: string
  createLinks: ShellContextLink[]
  sections: ShellContextSection[]
}>()
const open = defineModel<boolean>('open', { default: false })
const { t, te, localeProperties } = useI18n()
const route = useRoute()
const router = useRouter()
const hydrated = useHydrated()
const desktop = useMediaQuery('(min-width: 768px)', { ssrWidth: 1024 })
const menuTitle = computed(() => te('nav.navigation') ? t('nav.navigation') : t('nav.modules'))
const openMenuLabel = computed(() => te('nav.openMenu') ? t('nav.openMenu') : t('nav.toggleSidebar'))
const dialogContent = computed<NonNullable<SlideoverProps['content']> & { id: string }>(() => ({ id: 'mobile-navigation' }))

watch(desktop, value => { if (value) open.value = false })
watch(() => route.fullPath, () => { open.value = false })

function closeIfCurrent(to: RouteLocationRaw) {
  if (router.resolve(to).fullPath === route.fullPath) open.value = false
}

function onModuleActivate(item: ShellRailItem) {
  if (item.external || router.resolve(item.to).fullPath === route.fullPath) open.value = false
}
</script>

<template>
  <USlideover
    v-model:open="open"
    :side="localeProperties.dir === 'rtl' ? 'right' : 'left'"
    :title="menuTitle"
    :description="props.title"
    :content="dialogContent"
    :ui="{ content: 'webvue-mobile-menu', overlay: 'webvue-mobile-menu-overlay' }"
  >
    <UButton
      id="mobile-navigation-trigger"
      class="webvue-mobile-menu-trigger"
      type="button"
      color="neutral"
      variant="ghost"
      square
      data-testid="mobile-navigation-trigger"
      aria-controls="mobile-navigation"
      :aria-expanded="open"
      :aria-label="openMenuLabel"
      :disabled="!hydrated"
    >
      <template #leading>
        <UIcon name="i-lucide-menu" class="webvue-shell-icon size-4.5 shrink-0" aria-hidden="true" />
      </template>
    </UButton>
    <template #body>
      <nav :aria-label="t('nav.modules')" class="webvue-mobile-section">
        <UButton
          v-for="item in props.modules"
          :key="item.id"
          :to="item.external ? undefined : item.to"
          :href="item.external ? item.to : undefined"
          :target="item.external ? '_blank' : undefined"
          :rel="item.external ? 'noopener' : undefined"
          color="neutral"
          variant="ghost"
          class="webvue-context-link"
          :data-active="props.activeId === item.id"
          :active="props.activeId === item.id"
          :aria-current="props.activeId === item.id ? 'page' : undefined"
          :aria-label="t(item.labelKey)"
          @click="onModuleActivate(item)"
        >
          <template #leading>
            <UIcon :name="item.icon" class="webvue-shell-icon size-4.5 shrink-0" aria-hidden="true" />
          </template>
          <span data-slot="label">{{ t(item.labelKey) }}</span>
        </UButton>
      </nav>
      <USeparator class="my-4" />
      <h2 class="webvue-mobile-title">{{ props.title }}</h2>
      <div v-if="props.createLinks.length" class="webvue-mobile-section">
        <SidebarCreateAction
          v-for="link in props.createLinks"
          :key="link.id"
          :to="link.to"
          :label="t(link.labelKey)"
          :active="link.active"
          :test-id="`mobile-context-link-${link.id}`"
          @click="closeIfCurrent(link.to)"
        />
      </div>
      <nav v-if="props.sections.length" :aria-label="props.title" class="webvue-mobile-section">
        <template v-for="section in props.sections" :key="section.id">
          <h3 v-if="section.titleKey" class="webvue-context-section-title">{{ t(section.titleKey) }}</h3>
          <UButton
            v-for="link in section.links"
            :key="link.id"
            :to="link.to"
            color="neutral"
            variant="ghost"
            class="webvue-context-link"
            :aria-label="t(link.labelKey)"
            :aria-current="link.active ? 'page' : undefined"
            :data-active="link.active"
            :active="!!link.active"
            :data-testid="`mobile-context-link-${link.id}`"
            @click="closeIfCurrent(link.to)"
          >
            <template #leading>
              <UIcon :name="link.icon" class="webvue-shell-icon size-4.5 shrink-0" aria-hidden="true" />
            </template>
            <span data-slot="label">{{ t(link.labelKey) }}</span>
          </UButton>
        </template>
      </nav>
    </template>
  </USlideover>
</template>
```

- [ ] **Step 7: The two containers**

Replace `apps/web/app/components/shell/AppSidebar.vue` with:

```vue
<script setup lang="ts">
import { useMediaQuery } from '@vueuse/core'
import ModuleRail from './ModuleRail.vue'
import ContextSidebar from './ContextSidebar.vue'
import { useContextSidebar } from '@/composables/useShellNavigation'
import { useShellModel } from '@/composables/useShellModel'
import { sidebarModel } from '@/composables/nav/sidebarModel'

// Desktop navigation: the module rail and the context sidebar, fed by one model.
const route = useRoute()
const { me } = useMe()
const { activeModule, contextTitle, contextLabelKey, contextLinks, panel, panelView, motionKey, projectId, project, createTo } = useShellModel()
const { expanded, hydrated, toggle } = useContextSidebar()
const isDesktop = useMediaQuery('(min-width: 768px)', { ssrWidth: 1024 })
const model = computed(() => sidebarModel({
  links: contextLinks.value,
  moduleLabelKey: contextLabelKey.value,
  path: route.path,
  panel: panel.value && isDesktop.value ? { expanded: expanded.value } : null,
  surface: 'desktop',
}))
const createLinks = computed(() => model.value.createLinks.map(link => ({ ...link, to: createTo(link) })))
const counts: Record<string, number> = {}

// Remember the last readable project section for re-entry (moved from ContextSidebar).
const isProject = computed(() => !!projectId.value && activeModule.value === 'projects')
const { remember } = useProjectWorkspaceMemory()
watch([() => route.fullPath, () => project.data.value, () => me.value, hydrated], () => {
  if (isProject.value && project.data.value?.id === projectId.value && !project.error.value) remember(route.path, route.query)
}, { immediate: true })
</script>

<template>
  <ModuleRail />
  <ContextSidebar
    :title="contextTitle"
    :create-links="createLinks"
    :sections="model.sections"
    :show-nav="model.showNav"
    :counts="counts"
    :expanded="expanded"
    :hydrated="hydrated"
    :panel="panelView"
    :render-panel="isDesktop"
    :panel-width="panel?.width ?? 'default'"
    :motion-key="motionKey"
    @toggle="toggle"
  />
</template>
```

In `apps/web/app/components/shell/ShellHeader.vue`, replace the `<script setup>` with:

```ts
import { firstAllowedPath } from '@/utils/accessPolicy'
import AppearanceMenu from '@/components/shell/AppearanceMenu.vue'
import MobileNavigation from '@/components/shell/MobileNavigation.vue'
import NotificationCenter from '@/components/notifications/NotificationCenter.vue'
import { sidebarModel } from '@/composables/nav/sidebarModel'
import { useShellModel } from '@/composables/useShellModel'

const { t } = useI18n()
const route = useRoute()
const { me } = useMe()
const { branding } = useBranding()
const { can } = useAccess()
const homePath = computed(() => firstAllowedPath(me.value))
const { activeModule, rail, contextTitle, contextLabelKey, contextLinks, createTo } = useShellModel()
const mobileOpen = ref(false)
const mobile = computed(() => sidebarModel({ links: contextLinks.value, moduleLabelKey: contextLabelKey.value, path: route.path, panel: null, surface: 'mobile' }))
const mobileCreateLinks = computed(() => mobile.value.createLinks.map(link => ({ ...link, to: createTo(link) })))
```
and replace `<MobileNavigation />` with:

```vue
      <MobileNavigation
        v-model:open="mobileOpen"
        :modules="rail.all"
        :active-id="activeModule"
        :title="contextTitle"
        :create-links="mobileCreateLinks"
        :sections="mobile.sections"
      />
```

In `apps/web/app/assets/css/shell.css` replace each `[data-chat="true"]` selector: the width rules (`:272`, `:347`) use `[data-panel-width="wide"]`; the main-padding and overflow rules (`:273`, `:287-290`, `:307`, `:384`) use `[data-panel="true"]`. Then confirm: `rg -n 'data-chat' apps/web` prints nothing.

- [ ] **Step 8: Run everything**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim
(cd apps/web && npx vitest run app/composables app/modules)
npm -w apps/web run lint && npm test 2>&1 | tail -5
python3 -B tools/ui_policy.py && (cd tools && python3 -B -m unittest test_ui_policy test_arch_policy -q)
python3 -B tools/arch_policy.py; echo "exit=$?"
rg -n "components/chat|<Chat[A-Z]" apps/web/app/components/shell apps/web/app/layouts
```
Expected: all pass, `arch_policy` exit 0 with no stale entries (baseline unchanged), the `rg` prints nothing.

Then check chat on the mock stack (both processes from `apps/web`, stop them afterwards):
```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim/apps/web
PROJECTS_UI_PREVIEW=1 MODULE_UI_PREVIEW=1 MOCK_PORT=4498 node e2e/internal-ui-audit-mock.mjs &
NUXT_ODOO_URL=http://127.0.0.1:4498 NUXT_ODOO_DB=webvue_ui_mock_only NUXT_PUBLIC_WS_URL=ws://127.0.0.1:4498/websocket npx nuxt dev --port 4097 &
E2E_BASE_URL=http://localhost:4097 npx playwright test e2e/chat-presentation-mocked.spec.ts e2e/internal-pages.spec.ts --reporter=line
```
Expected: no failing title that is absent from `.superpowers/tasmim-shared/e2e-baseline-failures.txt`.

- [ ] **Step 9: Commit**

```bash
git add -A apps/web/app tools/arch_policy.py tools/test_arch_policy.py docs/design-system/components.md
git commit -m "refactor(web): derive the shell from one model and a chat manifest panel

ContextSidebar no longer imports chat/ConversationList; arch_policy now
checks components/shell and layouts for R3.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Frame geometry and the midnight module rail

**Files:**
- Create: `apps/web/app/components/shell/ShellFrame.vue`
- Rewrite: `apps/web/app/components/shell/ModuleRail.vue`; modify `apps/web/app/components/shell/AppSidebar.vue` (rail props)
- Modify: `apps/web/app/layouts/default.vue:1-9,48-58` (frame; drop `data-project-theme` / `data-workspace-theme`)
- Modify: `apps/web/app/utils/workspacePresentation.ts:1` (comment only)
- Modify: `apps/web/app/composables/useShellNavigation.ts:14-21` (delete `useModuleRail`)
- Rewrite: `apps/web/app/assets/css/shell.css:72-401` (frame block); modify `:10-11` (list width) and `:52-62` (coarse-pointer list)
- Modify: `apps/web/app/assets/css/components.css:7,35-38` (drop the rail-expanded and header-start rules)
- Modify: `apps/web/i18n/locales/{ar,en}/common.json` (delete `nav.expandModules`, `nav.collapseModules`)
- Modify: `apps/web/.storybook/nuxt-shims.ts:10,20` (`useHead` no-op, `__getRouter`)
- Modify: `tools/ui_policy.py:37-55` (`STORYBOOK_COMPONENTS` += `shell/ShellFrame.vue`, `shell/ModuleRail.vue`, `shell/AppSidebar.vue`), `:525-526` (`PAGE_WIDTHS` list → `none`); `tools/test_ui_policy.py:406,501` (`100rem` → `none`)
- Create: `apps/web/stories/fixtures/shell.ts`, `apps/web/stories/handlers/shell.ts`, `apps/web/stories/shell/ShellFrame.stories.ts`, `apps/web/stories/shell/ModuleRail.stories.ts`, `apps/web/stories/shell/AppSidebar.stories.ts`
- Modify: `apps/web/stories/shell/SidebarCreateAction.stories.ts:15` (note text 236px → 232px)
- Create: `apps/web/e2e/storybook-shell.spec.ts`
- Modify: `apps/web/e2e/support/visualStories.ts`, `apps/web/e2e/storybook-visual.spec.ts` (mobile shots, `networkidle`, axe on `shell-`)
- Modify (deliberate geometry updates, titles unchanged): `apps/web/e2e/shell-design.spec.ts:24-33,54,62-64,98-113,119,183`, `apps/web/e2e/project-popups.spec.ts:163-169,182,320`, `apps/web/e2e/module-ui-rollout.spec.ts:39`, `apps/web/e2e/project-theme.spec.ts:87`
- Modify: `docs/design-system/components.md` (shell row: `ShellFrame.vue`)

**Theme-attribute removal (spec §7.4), complete list:** `layouts/default.vue:7` (`projectTheme`), `:9` (`useHead` setting `data-project-theme` / `data-workspace-theme`). **No CSS selector depends on either attribute** (`rg -n "data-(project|workspace)-theme" apps/web/app` returns only `default.vue:9`). Their only consumers are e2e assertions: `module-ui-rollout.spec.ts:39` (expects `'true'` → now expects absence), `:111,:115` (already absence), `project-theme.spec.ts:85` (absence, unchanged), `:87` (expects `'true'` → now absence), `chat-presentation-mocked.spec.ts:45` (absence, unchanged). `isWorkspaceThemeRoute` stays: it still drives the motion skip in the layout and `data-workspace-area` in `PageContainer.vue:11`.

**Interfaces:**
- Consumes: `railModel`, `ShellRailItem`, `useShellModel().rail/activeModule/homePath` (Task 2).
- Produces: `ShellFrame` (slots `header`, `sidebar`, default); `ModuleRail` props `{ modules: ShellRailItem[]; utility: ShellRailItem[]; activeId: string | null; homeTo: string }`; CSS custom properties on `.webvue-shell`: `--shell-header-height: 48px`, `--module-rail-width: 64px`, `--context-sidebar-width: 232px` (48px collapsed); classes used by Tasks 4–6 (`.webvue-context-*`, `.webvue-shell-header*`, `.webvue-shell-breadcrumb`, `.webvue-mobile-*`); Storybook ids `shell-shellframe--default`, `shell-shellframe--bright-tenant`, `shell-modulerail--default`, `shell-modulerail--settings-active`, `shell-appsidebar--default`; `__getRouter(): Router | null` in `.storybook/nuxt-shims.ts`; `shellMe`, `shellBranding`, `shellRail` fixtures and `shellHandlers`.

- [ ] **Step 1: Storybook can render the real header**

`apps/web/.storybook/nuxt-shims.ts`: `useBranding()` calls `useHead`, which throws without a head manager (`@unhead/vue` `injectHead`: "useHead() was called without provide context"). Replace line 10 `export { useHead } from '@unhead/vue'` with:

```ts
// Storybook has no head manager; preview.ts applies the <html> attributes and
// brand theme itself, so a component's useHead() is a no-op here.
export function useHead(_input?: unknown, _options?: unknown) { return { patch: () => {}, dispose: () => {} } }
```
and after `export function __setRouter(r: Router) { router = r }` add:

```ts
export function __getRouter(): Router | null { return router }
```

Create `apps/web/stories/fixtures/shell.ts`:

```ts
import { BrandingSchema, MeSchema } from '@webvue/contracts'
import { visibleShellModules } from '../../app/composables/nav/shellModules'
import { railModel } from '../../app/composables/nav/sidebarModel'

// A workspace user who sees every application and the administration module.
export const shellMe = MeSchema.parse({
  id: 7, name: 'سارة القحطاني', login: 'sara', email: 'sara@example.com', lang: 'ar_001', tz: 'Asia/Riyadh',
  role: 'admin', roles: [], access_policy_version: 1, company: { id: 1, name: 'شركة المثال' },
  capabilities: [
    'pmo.projects.read', 'pmo.projects.create', 'pmo.tasks.read', 'pmo.tasks.create', 'pmo.settings.manage',
    'meetings.read', 'meetings.create', 'hr.employees.read', 'hr.departments.read', 'hr.documents.read',
    'access.users.read', 'access.roles.read', 'access.audit.read', 'settings.branding.manage',
  ],
})

export const shellBranding = BrandingSchema.parse({
  name: 'شركة المثال',
  logo_url: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Crect width=%2224%22 height=%2224%22 rx=%226%22 fill=%22teal%22/%3E%3C/svg%3E',
  primary_color: '#13234a',
  font: 'IBM Plex Sans Arabic',
})

export const shellRail = railModel(visibleShellModules(shellMe))
```

Create `apps/web/stories/handlers/shell.ts`:

```ts
import { http, HttpResponse } from 'msw'
import { apiHandlers } from './api'
import { shellBranding, shellMe } from '../fixtures/shell'

/** The shell's own requests: identity, branding, the bell and the my-tasks counter. First match wins. */
export const shellHandlers = [
  http.get('/api/v1/me', () => HttpResponse.json(shellMe)),
  http.get('/api/v1/branding', () => HttpResponse.json(shellBranding)),
  http.get('/api/v1/notifications', () => HttpResponse.json({ items: [], total: 0, unread_count: 0 })),
  http.get('/api/v1/tasks', () => HttpResponse.json({ items: [], total: 7 })),
  ...apiHandlers,
]
```

- [ ] **Step 2: Write the failing geometry, bar and colour spec**

Create `apps/web/e2e/storybook-shell.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test'
import { requireStorybook, startStorybookServer } from './support/storybookServer'

let base = ''
let close: () => Promise<void> = async () => {}
const open = async (page: Page, id: string, globals: string) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(`${base}/iframe.html?id=${id}&viewMode=story&globals=${globals}`)
  await page.locator('#storybook-root').waitFor()
}
const box = async (page: Page, testId: string) => (await page.getByTestId(testId).boundingBox())!
const LOCALES = [['ar', 'rtl'], ['en', 'ltr']] as const

test.describe('Tasmim shell (desktop)', () => {
  requireStorybook()
  test.use({ viewport: { width: 1440, height: 900 } })
  test.beforeAll(async () => { ({ base, close } = await startStorybookServer()) })
  test.afterAll(async () => { await close() })

  for (const [locale, dir] of LOCALES) {
    for (const fontSize of ['small', 'large'] as const) {
      test(`frame is 48/64/232 and mirrors in ${locale} at ${fontSize} text`, async ({ page }) => {
        await open(page, 'shell-shellframe--default', `locale:${locale};appearance:light;fontSize:${fontSize}`)
        await expect(page.locator('html')).toHaveAttribute('dir', dir)
        const header = await box(page, 'shell-header')
        const rail = await box(page, 'module-rail')
        const sidebar = await box(page, 'context-sidebar')
        expect(header.height).toBeCloseTo(48, 0)
        expect(rail.width).toBeCloseTo(64, 0)
        expect(rail.y).toBeCloseTo(0, 0)
        expect(rail.height).toBeCloseTo(900, 0)
        expect(sidebar.width).toBeCloseTo(232, 0)
        expect(sidebar.y).toBeCloseTo(48, 0)
        if (dir === 'rtl') {
          expect(rail.x + rail.width).toBeCloseTo(1440, 0)
          expect(header.x).toBeCloseTo(0, 0)
          expect(header.x + header.width).toBeCloseTo(rail.x, 0)
          expect(sidebar.x + sidebar.width).toBeCloseTo(rail.x, 0)
        } else {
          expect(rail.x).toBeCloseTo(0, 0)
          expect(header.x).toBeCloseTo(64, 0)
          expect(header.x + header.width).toBeCloseTo(1440, 0)
          expect(sidebar.x).toBeCloseTo(64, 0)
        }
        await expect(page.getByTestId('module-rail-toggle')).toHaveCount(0)
      })
    }

    test(`the active module carries a lime bar on the rail's inline-start edge (${locale})`, async ({ page }) => {
      await open(page, 'shell-shellframe--default', `locale:${locale};appearance:dark`)
      const rail = await box(page, 'module-rail')
      const active = page.getByTestId('module-rail').locator('[aria-current="page"]')
      await expect(active).toHaveCount(1)
      const bar = active.locator('[data-slot="indicator"]')
      const barBox = (await bar.boundingBox())!
      expect(barBox.width).toBeCloseTo(3, 0)
      if (dir === 'rtl') expect(barBox.x + barBox.width).toBeCloseTo(rail.x + rail.width, 0)
      else expect(barBox.x).toBeCloseTo(rail.x, 0)
      await expect(bar).toHaveCSS('background-color', 'rgb(200, 240, 49)')
      await expect(page.getByTestId('module-rail').locator('[data-slot="indicator"]')).toHaveCount(1)
    })
  }

  for (const [appearance, midnight] of [['light', 'rgb(19, 35, 74)'], ['dark', 'rgb(13, 26, 56)']] as const) {
    test(`rail stays midnight under a bright tenant primary (${appearance})`, async ({ page }) => {
      await open(page, 'shell-shellframe--bright-tenant', `locale:ar;appearance:${appearance}`)
      // Precondition: the tenant colour really reached the document.
      const primary = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--primary').trim().toLowerCase())
      expect(primary).not.toBe('')
      expect(primary).not.toBe('#13234a')
      const rail = page.getByTestId('module-rail')
      await expect(rail).toHaveCSS('background-color', midnight)
      expect(await rail.evaluate(element => getComputedStyle(element).backgroundImage)).not.toContain('255, 0, 255')
      await expect(rail.locator('[data-slot="indicator"]')).toHaveCSS('background-color', 'rgb(200, 240, 49)')
    })
  }
})
```
Run: `cd apps/web && npm run build-storybook && npx playwright test e2e/storybook-shell.spec.ts --reporter=line` — Expected: FAIL (stories do not exist).

- [ ] **Step 3: `ShellFrame` and the layout**

Create `apps/web/app/components/shell/ShellFrame.vue`:

```vue
<script setup lang="ts">
// The Tasmim application frame (spec 2026-10-11 §5): fixed header, fixed
// midnight module rail, context sidebar and the scrolling workspace. Geometry
// lives in assets/css/shell.css (.webvue-shell custom properties).
defineSlots<{ header?: () => unknown; sidebar?: () => unknown; default?: () => unknown }>()
const { localeProperties } = useI18n()
const dir = computed(() => localeProperties.value.dir ?? 'ltr')
</script>

<template>
  <div data-webvue-shell class="webvue-shell" :data-direction="dir">
    <slot name="header" />
    <slot name="sidebar" />
    <div class="webvue-shell-workspace">
      <slot />
    </div>
  </div>
</template>
```

`apps/web/app/layouts/default.vue`: replace lines 1–9 with

```ts
<script setup lang="ts">
import { isWorkspaceThemeRoute } from '@/utils/workspacePresentation'
const route = useRoute()
const workspaceTheme = computed(() => isWorkspaceThemeRoute(route.path))
```
(the `<html data-project-theme / data-workspace-theme>` toggling is gone, spec §7.4; keep every line from the focus comment onward unchanged) and the template with

```vue
<template>
  <ShellFrame>
    <template #header><ShellHeader /></template>
    <template #sidebar><ShellAppSidebar /></template>
    <main ref="shellMain" tabindex="-1" data-testid="shell-main" class="webvue-shell-main focus:outline-none" :class="{ 'webvue-page-content-motion': pageMotionActive }">
      <slot />
    </main>
  </ShellFrame>
</template>
```

`apps/web/app/utils/workspacePresentation.ts:1` comment becomes: `/** Workspace routes keep a stable frame (no entrance motion, workspace spacing); chat, login and meeting print do not. */`

- [ ] **Step 4: The rail**

Replace `apps/web/app/components/shell/ModuleRail.vue` with:

```vue
<script setup lang="ts">
import BrandWordmark from '@/components/shared/BrandWordmark.vue'
import type { ShellRailItem } from '@/composables/nav/sidebarModel'

// The module rail (spec §3, §5): always WebVue midnight, 64px, icon over a small
// label; the active module carries a lime bar on the rail's inline-start edge.
const props = defineProps<{
  modules: ShellRailItem[]
  utility: ShellRailItem[]
  activeId: string | null
  homeTo: string
}>()
const { t } = useI18n()
const groups = computed(() => [
  { key: 'modules', items: props.modules, label: t('nav.modules'), class: 'webvue-module-rail-links' },
  { key: 'utility', items: props.utility, label: t('nav.settings'), class: 'webvue-module-rail-utility' },
].filter(group => group.items.length))
</script>

<template>
  <aside data-testid="module-rail" class="webvue-module-rail" :aria-label="t('nav.modules')">
    <NuxtLink :to="props.homeTo" class="webvue-module-rail-brand" :aria-label="`${t('app.productName')} — ${t('nav.home')}`">
      <BrandWordmark size="sm" inverted />
    </NuxtLink>
    <nav v-for="group in groups" :key="group.key" :class="group.class" :aria-label="group.label">
      <NuxtLink
        v-for="item in group.items"
        :key="item.id"
        :to="item.to"
        :external="item.external"
        class="webvue-module-rail-link"
        :data-active="item.id === props.activeId"
        :aria-current="item.id === props.activeId ? 'page' : undefined"
        :aria-label="t(item.labelKey)"
        :title="t(item.labelKey)"
      >
        <span v-if="item.id === props.activeId" data-slot="indicator" class="webvue-module-rail-indicator" aria-hidden="true" />
        <UIcon :name="item.icon" class="webvue-shell-icon" aria-hidden="true" />
        <span data-slot="label">{{ t(item.labelKey) }}</span>
      </NuxtLink>
    </nav>
  </aside>
</template>
```

In `AppSidebar.vue`: destructure `rail` and `homePath` from `useShellModel()` too, and render `<ModuleRail :modules="rail.primary" :utility="rail.utility" :active-id="activeModule" :home-to="homePath" />`.

Delete `useModuleRail` (lines 14–21) from `apps/web/app/composables/useShellNavigation.ts`; delete `nav.expandModules` and `nav.collapseModules` from both `common.json` files (`rg -n "expandModules|collapseModules" apps/web` must print nothing).

- [ ] **Step 5: Frame CSS**

In `apps/web/app/assets/css/shell.css`:
- Line 11: `.webvue-page-width-list { max-width: none; }` (spec §5: tables, boards and dashboards use the full width).
- Lines 54–58: drop `.webvue-module-rail-toggle,` from the coarse-pointer selector list.
- Replace everything from line 72 (`/* Approved application frame…`) to the end of the file with:

```css
/* Tasmim application frame (spec 2026-10-11 §5): a 48px neutral header, a
   64px module rail that is always WebVue midnight, a 232px context sidebar that
   collapses to 48px, one drawer below 768px. Geometry is px so the frame does
   not grow with the user's font size; text inside it uses rem. */
.webvue-shell {
  --shell-duration: 150ms;
  --shell-ease: cubic-bezier(.22, 1, .36, 1);
  --shell-header-height: 48px;
  --module-rail-width: 64px;
  --context-sidebar-width: 232px;
  min-height: 100svh;
  background: var(--ui-bg);
}
html[dir="rtl"] body { padding-right: 0 !important; }
@media (min-width: 768px) {
  .webvue-shell:has(.webvue-context-sidebar[data-panel-width="wide"][data-expanded="true"]) { --context-sidebar-width: 400px; }
  .webvue-shell:has(.webvue-context-sidebar[data-expanded="false"]) { --context-sidebar-width: 48px; }
}
@media (min-width: 768px) and (max-width: 1100px) {
  .webvue-shell:has(.webvue-context-sidebar[data-panel-width="wide"][data-expanded="true"]) { --context-sidebar-width: 320px; }
}

/* Header: neutral, from the rail to the inline end. */
.webvue-shell-header {
  position: fixed;
  inset-block-start: 0;
  inset-inline-start: var(--module-rail-width);
  inset-inline-end: 0;
  z-index: 60;
  display: flex;
  height: var(--shell-header-height);
  align-items: center;
  gap: 12px;
  padding-inline: 12px;
  background: var(--ui-bg);
  border-block-end: 1px solid var(--ui-border);
  color: var(--ui-text);
}
.webvue-shell-header-start { display: flex; min-width: 0; flex: 1; align-items: center; gap: 8px; }
.webvue-shell-brand { display: inline-flex; min-width: 0; flex: none; align-items: center; gap: 8px; color: var(--ui-text-highlighted); font-size: .875rem; font-weight: 600; text-decoration: none; }
.webvue-shell-brand-logo, .webvue-shell-brand-mark { width: 24px; height: 24px; flex: none; border-radius: 6px; object-fit: contain; }
.webvue-shell-brand-mark { display: grid; place-items: center; background: var(--ui-bg-elevated); font-size: .75rem; }
.webvue-shell-brand-name { max-width: 12rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.webvue-shell-header-divider { width: 1px; height: 16px; flex: none; background: var(--ui-border); }
.webvue-shell-breadcrumb { min-width: 0; }
.webvue-shell-breadcrumb [data-slot="linkLabel"] { display: block; max-width: 16rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.webvue-shell-header-actions { display: flex; flex: none; align-items: center; gap: 4px; }
.webvue-shell-header .webvue-search-trigger { width: 15rem; min-width: 0; justify-content: space-between; color: var(--ui-text-muted); }
.webvue-shell-header .header-account { display: flex; min-width: 0; align-items: center; gap: 8px; padding-inline: 6px; text-align: start; }
.webvue-shell-header .account-copy { display: grid; min-width: 0; max-width: 10rem; line-height: 1.25; }
.webvue-shell-header .account-name, .webvue-shell-header .account-role { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.webvue-shell-header .account-name { font-size: .8125rem; font-weight: 600; }
.webvue-shell-header .account-role { color: var(--ui-text-muted); font-size: .6875rem; }
.approved-account-menu { z-index: 80; }
.approved-account-menu [data-slot="dropdown-menu-item"] { width: 100%; overflow: hidden; white-space: nowrap; }
.approved-account-menu .webvue-shell-icon { width: 18px; height: 18px; flex: none; }

/* Module rail: always WebVue midnight, never tenant-derived (tokens.css). */
.webvue-module-rail {
  position: fixed;
  inset-block: 0;
  inset-inline-start: 0;
  z-index: 61;
  display: flex;
  width: var(--module-rail-width);
  flex-direction: column;
  background: var(--webvue-rail);
  background-image: linear-gradient(180deg, var(--webvue-rail) 0%, var(--webvue-rail-deep) 100%);
  color: rgb(255 255 255 / 72%);
}
.webvue-module-rail-brand { display: grid; height: var(--shell-header-height); flex: none; place-items: center; color: #fff; text-decoration: none; }
.webvue-module-rail-brand:focus-visible { outline: 2px solid var(--webvue-lime); outline-offset: -4px; }
.webvue-module-rail-links, .webvue-module-rail-utility { display: flex; flex-direction: column; gap: 2px; padding: 8px 4px; }
.webvue-module-rail-links { min-height: 0; flex: 1; overflow-x: hidden; overflow-y: auto; scrollbar-width: none; }
.webvue-module-rail-utility { flex: none; border-block-start: 1px solid rgb(255 255 255 / 12%); }
.webvue-module-rail-link {
  position: relative;
  display: flex;
  min-height: 52px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border-radius: 6px;
  padding: 6px 2px;
  color: inherit;
  text-decoration: none;
  transition: background-color var(--shell-duration) ease, color var(--shell-duration) ease;
}
.webvue-module-rail-link:hover { background: var(--rail-hover); color: #fff; }
.webvue-module-rail-link[data-active="true"] { background: rgb(255 255 255 / 12%); color: #fff; }
.webvue-module-rail-link:focus-visible { outline: 2px solid var(--webvue-lime); outline-offset: -2px; }
.webvue-module-rail-link [data-slot="label"] { max-width: 100%; overflow: hidden; font-size: 11px; font-weight: 500; line-height: 14px; text-align: center; text-overflow: ellipsis; white-space: nowrap; }
.webvue-module-rail-link[data-active="true"] [data-slot="label"] { font-weight: 600; }
/* The bar sits on the rail's own inline-start edge: 4px out of the link, through the nav padding. */
.webvue-module-rail-indicator { position: absolute; inset-block: 12px; inset-inline-start: -4px; width: 3px; border-start-end-radius: 3px; border-end-end-radius: 3px; background: var(--webvue-lime); }
@media (forced-colors: active) {
  .webvue-module-rail-indicator { forced-color-adjust: none; background: Highlight; }
}

/* Context sidebar. */
.webvue-context-sidebar {
  position: fixed;
  inset-block-start: var(--shell-header-height);
  inset-block-end: 0;
  inset-inline-start: var(--module-rail-width);
  z-index: 40;
  display: flex;
  width: var(--context-sidebar-width);
  flex-direction: column;
  overflow: hidden;
  background: var(--context-surface);
  border-inline-end: 1px solid var(--ui-border);
  color: var(--ui-text);
  transition: width var(--shell-duration) var(--shell-ease);
}
.webvue-context-enter-active, .webvue-context-leave-active { transition: opacity 120ms ease; }
.webvue-context-enter-from, .webvue-context-leave-to { opacity: 0; }
.webvue-context-sidebar-inner { display: flex; min-height: 0; flex: 1; flex-direction: column; }
.webvue-context-heading { display: flex; height: 44px; flex: none; align-items: center; gap: 8px; padding-inline: 12px 8px; }
.webvue-context-heading h2 { min-width: 0; flex: 1; margin: 0; overflow: hidden; font-size: .875rem; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.webvue-context-create-actions { display: flex; gap: 2px; }
.webvue-context-create-icon { color: var(--brand-link); }
.webvue-context-nav { display: flex; min-height: 0; flex: 1; flex-direction: column; gap: 12px; overflow-y: auto; padding: 4px 8px 8px; }
.webvue-context-section { display: grid; gap: 1px; }
.webvue-context-section-title { margin: 0; padding: 4px 8px; color: var(--ui-text-muted); font-size: .75rem; font-weight: 500; }
.webvue-context-row { position: relative; display: flex; align-items: center; }
.webvue-context-link {
  position: relative;
  display: flex;
  width: 100%;
  min-height: var(--webvue-control-h);
  align-items: center;
  justify-content: start;
  gap: 8px;
  border-radius: 6px;
  padding-block: 0;
  padding-inline: 8px;
  color: var(--ui-text-muted);
  font-size: .875rem;
  text-align: start;
  text-decoration: none;
  transition: background-color var(--shell-duration) ease, color var(--shell-duration) ease;
}
.webvue-context-link:hover { background: var(--ui-bg-elevated); color: var(--ui-text-highlighted); }
.webvue-context-link[data-active="true"] { background: var(--ui-bg-elevated); color: var(--ui-text-highlighted); font-weight: 500; }
.webvue-context-link[data-active="true"]::before { content: ''; position: absolute; inset-block: 6px; inset-inline-start: 0; width: 2px; border-radius: 2px; background: var(--ui-primary); pointer-events: none; }
.webvue-context-link:focus-visible { outline: 2px solid var(--ring); outline-offset: -2px; }
@media (forced-colors: active) {
  .webvue-context-link[data-active="true"]::before { forced-color-adjust: none; background: Highlight; }
}
.webvue-context-count { position: absolute; inset-inline-end: 8px; color: var(--ui-text-muted); font-size: .75rem; font-variant-numeric: tabular-nums; pointer-events: none; }
.webvue-context-row:has(.webvue-context-count) .webvue-context-link { padding-inline-end: 36px; }
.webvue-context-panel { display: flex; min-height: 0; flex: 1; flex-direction: column; }
.webvue-context-footer { display: flex; flex: none; justify-content: flex-end; padding: 6px 8px; border-block-start: 1px solid var(--ui-border-muted); }
.webvue-context-toggle { color: var(--ui-text-muted); }
@media (min-width: 768px) {
  .webvue-context-sidebar[data-expanded="false"] :is(.webvue-context-heading h2, .webvue-context-create-actions, .webvue-context-section-title, .webvue-context-count) { display: none; }
  .webvue-context-sidebar[data-expanded="false"] .webvue-context-heading { padding-inline: 0; }
  .webvue-context-sidebar[data-expanded="false"] .webvue-context-nav { padding-inline: 8px; }
  .webvue-context-sidebar[data-expanded="false"] .webvue-context-link { justify-content: center; padding-inline: 0; }
  .webvue-context-sidebar[data-expanded="false"] .webvue-context-link [data-slot="label"] { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  .webvue-context-sidebar[data-expanded="false"] .webvue-context-footer { justify-content: center; padding-inline: 0; }
}

/* Chat pages keep their conversation layout beside the wide sidebar panel. */
.webvue-chat-workspace { max-width: none; height: calc(100svh - var(--shell-header-height)); }
.webvue-chat-pane, .webvue-chat-thread { min-height: 0; background: var(--background); }
.webvue-chat-list-toolbar { display: flex; align-items: center; gap: 8px; padding: 10px 12px 6px; }
.webvue-chat-list-search { display: flex; min-width: 0; flex: 1; }
.webvue-chat-list-filters { display: flex; gap: 6px; overflow-x: auto; padding: 0 12px 10px; scrollbar-width: thin; }
.webvue-chat-thread-header { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; border-block-end: 1px solid color-mix(in srgb, var(--border) 65%, transparent); background: var(--card); padding: 8px 12px; }
.webvue-chat-thread-search { flex: 1 1 100%; width: 100%; }
.webvue-chat-scroller { background: color-mix(in srgb, var(--muted) 45%, var(--background)); }
.webvue-chat-day { margin-block: 8px; text-align: center; color: var(--muted-foreground); font-size: .72rem; }
.webvue-chat-bubble { border-radius: 8px 8px 8px 2px; background: var(--card); padding: 6px 10px 4px; box-shadow: 0 1px 0 color-mix(in srgb, var(--foreground) 6%, transparent); }
.webvue-chat-bubble[data-out="true"] { border-radius: 8px 8px 2px 8px; background: var(--brand-soft); color: var(--foreground); }
.webvue-chat-bubble-meta { display: flex; justify-content: flex-end; gap: 6px; margin-block-start: 2px; color: var(--muted-foreground); font-size: 10px; }
.webvue-chat-composer { display: flex; flex-direction: column; gap: 8px; border-block-start: 1px solid color-mix(in srgb, var(--border) 65%, transparent); background: var(--card); padding: 8px 12px 12px; }
.webvue-chat-conversation-link { display: flex; min-height: 72px; align-items: center; gap: 12px; margin-inline: 0; border-radius: 0; padding: 10px 16px; color: var(--foreground); text-align: start; text-decoration: none; }
.webvue-chat-conversation-link:hover { background: color-mix(in srgb, var(--foreground) 6%, var(--context-surface)); }
.webvue-chat-conversation-link:focus-visible { outline: 2px solid var(--ring); outline-offset: -2px; }
.webvue-chat-conversation-link[data-selected="true"] { background: color-mix(in srgb, var(--brand-soft) 80%, var(--context-surface)); }
.webvue-chat-conversation-link[data-selected="true"] .webvue-chat-avatar { background: var(--brand-link); color: var(--brand-soft); }
.webvue-chat-avatar { display: grid; width: 48px; height: 48px; place-items: center; border-radius: 999px; background: var(--muted); font-size: .75rem; font-weight: 600; transition: background-color 150ms ease, color 150ms ease; }
.webvue-chat-avatar-sm { width: 24px; height: 24px; font-size: .6rem; }
.webvue-chat-avatar-badge { position: absolute; inset-inline-end: 0; inset-block-end: 0; display: grid; width: 16px; height: 16px; place-items: center; border-radius: 999px; background: var(--brand-link); color: var(--brand-soft); }
.webvue-chat-list-time { flex: none; color: var(--muted-foreground); font-size: 11px; }
.webvue-chat-msg-actions { opacity: 1; }
@media (hover: hover) and (pointer: fine) {
  .webvue-chat-msg-actions { opacity: 0; }
}
.webvue-chat-row:hover .webvue-chat-msg-actions, .webvue-chat-row:focus-within .webvue-chat-msg-actions { opacity: 1; }

/* Workspace. */
.webvue-shell-workspace { min-height: 100svh; margin-inline-start: calc(var(--module-rail-width) + var(--context-sidebar-width)); padding-block-start: var(--shell-header-height); background: var(--ui-bg); transition: margin-inline-start var(--shell-duration) var(--shell-ease); }
.webvue-shell-main { min-height: calc(100svh - var(--shell-header-height)); min-width: 0; background: var(--ui-bg); padding: 20px 24px 48px; }
.webvue-shell:has(.webvue-context-sidebar[data-panel="true"]) .webvue-shell-main { padding: 0; overflow: hidden; }
.webvue-page-content-motion { animation: webvue-page-content-enter 150ms ease both; }
@keyframes webvue-page-content-enter { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
[data-slot="table-head"] { background: color-mix(in srgb, var(--background) 80%, var(--card)); font-weight: 400; }
[data-slot="table-row"]:last-child { border-block-end: 0; }

@media (max-width: 1100px) and (min-width: 768px) {
  .webvue-shell-brand-name, .webvue-shell-header .account-copy { display: none; }
  .webvue-shell-header .webvue-search-trigger { width: 11rem; }
}

/* Below 768px: no rail or sidebar; the header spans the width and the drawer
   (components.css .webvue-mobile-menu) carries modules and sections. */
@media (max-width: 767px) {
  .webvue-shell { --module-rail-width: 0px; --context-sidebar-width: 0px; }
  .webvue-module-rail, .webvue-context-sidebar { display: none !important; }
  .webvue-shell-header { inset-inline-start: 0; gap: 4px; padding-inline: 4px 8px; }
  .webvue-mobile-menu-trigger { display: inline-flex; flex: none; }
  .webvue-shell-header-divider,
  .webvue-shell-breadcrumb,
  .webvue-shell-brand-name,
  .webvue-shell-header .account-copy,
  .webvue-shell-header .webvue-search-trigger kbd,
  .webvue-shell-header .webvue-search-trigger .webvue-search-trigger-label { display: none; }
  .webvue-shell-header .webvue-search-trigger { width: 44px; padding: 0; justify-content: center; }
  .webvue-shell-header :is(.webvue-search-trigger, .webvue-mobile-menu-trigger, [data-testid="notification-bell"], [data-slot="header-account"], [data-testid="appearance-menu"]) { min-height: 44px; min-width: 44px; }
  .webvue-shell-workspace { margin-inline-start: 0; }
  .webvue-shell-main { padding: 16px 12px max(16px, env(safe-area-inset-bottom)); }
}

@media (prefers-reduced-motion: reduce) {
  .webvue-chat-msg-actions { opacity: 1; }
  .webvue-shell,
  .webvue-shell * {
    animation: none !important;
    transition: none !important;
    scroll-behavior: auto !important;
  }
}
```

In `apps/web/app/assets/css/components.css` delete line 7 (`.webvue-shell-header-start …`, now in shell.css) and lines 35–38 (`.webvue-mobile-menu .webvue-module-rail-link, .webvue-module-rail[data-expanded="true"] …` block; Task 6 rewrites the rest of the drawer rules).

In `tools/ui_policy.py`, `PAGE_WIDTHS`: `(('list', 'none'), ('detail', '68rem'), ('form', '58rem'))`. In `tools/test_ui_policy.py:406` and `:501` replace `max-width: 100rem` / `max-width:100rem` with `max-width: none` / `max-width:none`.

Run: `cd apps/web && npx vitest run app/assets/css/__tests__/tokens.test.ts app/layouts` — Expected: PASS (the rail rule still uses both rail tokens; `shellFocus.test.ts` still passes because the layout script keeps `isWorkspaceThemeRoute`).

- [ ] **Step 6: Stories**

Create `apps/web/stories/shell/ShellFrame.stories.ts`:

```ts
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { useI18n } from 'vue-i18n'
import AppSidebar from '../../app/components/shell/AppSidebar.vue'
import ShellFrame from '../../app/components/shell/ShellFrame.vue'
import ShellHeader from '../../app/components/shell/ShellHeader.vue'
import { createBrandTheme } from '../../app/utils/brandTheme'
import { __getRouter } from '../../.storybook/nuxt-shims'
import { shellHandlers } from '../handlers/shell'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shell/ShellFrame',
  component: ShellFrame,
  parameters: { layout: 'fullscreen', msw: { handlers: { api: shellHandlers } } },
} satisfies Meta<typeof ShellFrame>
export default meta
type Story = StoryObj<typeof meta>

/** Route and sidebar state for one story; loaders run before render. */
const at = (path: string, sidebar: 'open' | 'closed' = 'open') => async () => {
  document.cookie = `webvue-context-sidebar=${sidebar}; path=/`
  await __getRouter()!.replace(path)
  return {}
}

const frame = (before?: () => void) => ({
  components: { AppSidebar, ShellFrame, ShellHeader },
  setup: () => {
    before?.()
    return { t: useI18n().t }
  },
  template: `<ShellFrame>
    <template #header><ShellHeader /></template>
    <template #sidebar><AppSidebar /></template>
    <main class="webvue-shell-main" data-testid="shell-main"><div class="webvue-page-stack webvue-page-width-list"><h1 class="text-xl font-semibold">{{ t('nav.tasks') }}</h1></div></main>
  </ShellFrame>`,
})

export const Default: Story = {
  name: 'الإطار الكامل',
  parameters: storyContext('apps/web/app/layouts/default.vue:1'),
  loaders: [at('/tasks')],
  render: () => frame(),
}

export const BrightTenant: Story = {
  name: 'لون مؤسسة ساطع',
  parameters: storyContext('apps/web/app/layouts/default.vue:1', 'لون المؤسسة لا يغيّر شريط الموديولات (المواصفة §3).'),
  loaders: [at('/tasks')],
  render: (_args, { globals }) => frame(() => {
    const theme = createBrandTheme('#ff00ff', globals.appearance === 'dark' ? 'dark' : 'light')
    for (const [key, value] of Object.entries(theme)) document.documentElement.style.setProperty(key, value)
  }),
}
```

Create `apps/web/stories/shell/ModuleRail.stories.ts`:

```ts
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import ModuleRail from '../../app/components/shell/ModuleRail.vue'
import { shellRail } from '../fixtures/shell'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shell/ModuleRail',
  component: ModuleRail,
  parameters: { layout: 'fullscreen' },
  args: { modules: shellRail.primary, utility: shellRail.utility, activeId: 'projects', homeTo: '/projects/dashboard' },
} satisfies Meta<typeof ModuleRail>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  name: 'المشاريع نشطة',
  parameters: storyContext('apps/web/app/components/shell/AppSidebar.vue:1'),
  render: args => ({ components: { ModuleRail }, setup: () => ({ args }), template: '<div class="webvue-shell"><ModuleRail v-bind="args" /></div>' }),
}

export const SettingsActive: Story = { ...Default, name: 'الإعدادات نشطة', args: { activeId: 'settings' } }
```

Create `apps/web/stories/shell/AppSidebar.stories.ts`:

```ts
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import AppSidebar from '../../app/components/shell/AppSidebar.vue'
import { __getRouter } from '../../.storybook/nuxt-shims'
import { shellHandlers } from '../handlers/shell'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shell/AppSidebar',
  component: AppSidebar,
  parameters: { layout: 'fullscreen', msw: { handlers: { api: shellHandlers } } },
} satisfies Meta<typeof AppSidebar>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  name: 'الشريط والقائمة السياقية',
  parameters: storyContext('apps/web/app/layouts/default.vue:1'),
  loaders: [async () => { document.cookie = 'webvue-context-sidebar=open; path=/'; await __getRouter()!.replace('/projects'); return {} }],
  render: () => ({ components: { AppSidebar }, template: '<div class="webvue-shell min-h-svh"><AppSidebar /></div>' }),
}
```

In `apps/web/stories/shell/SidebarCreateAction.stories.ts:15`, change the note to `` `--context-sidebar-width: 232px` من `apps/web/app/assets/css/shell.css` `` and the wrapper `style="width: 236px"` to `style="width: 232px"`.

Register: `tools/ui_policy.py` `STORYBOOK_COMPONENTS` += `'shell/ShellFrame.vue', 'shell/ModuleRail.vue', 'shell/AppSidebar.vue'`; `docs/design-system/components.md` shell row += `` `apps/web/app/components/shell/ShellFrame.vue` (قصة: `apps/web/stories/shell/ShellFrame.stories.ts`) `` and story paths for `ModuleRail` and `AppSidebar` on the navigation row.

- [ ] **Step 7: Visual coverage for the shell**

`apps/web/e2e/support/visualStories.ts`: append `'shell-shellframe--', 'shell-modulerail--', 'shell-appsidebar--',` to `VISUAL_STORIES`, and add

```ts
// Captured again at 390x844 (spec §9: mobile for shell and templates).
export const VISUAL_MOBILE_STORIES: string[] = ['shell-shellframe--default']
```

`apps/web/e2e/storybook-visual.spec.ts`:
- import `VISUAL_MOBILE_STORIES`;
- after `await page.locator('#storybook-root').waitFor()` in the snapshot test add `await page.waitForLoadState('networkidle')` (MSW-backed shell data and counters settle before the shot);
- after the desktop loop add:

```ts
  for (const story of storybookEntries().filter(entry => entry.type === 'story' && VISUAL_MOBILE_STORIES.some(prefix => entry.id.startsWith(prefix)))) {
    for (const { locale, appearance } of VISUAL_MATRIX) {
      test(`${story.id} ${locale}-${appearance} mobile`, async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 })
        await page.emulateMedia({ reducedMotion: 'reduce' })
        await page.goto(`${base}/iframe.html?id=${story.id}&viewMode=story&globals=locale:${locale};appearance:${appearance}`)
        await page.locator('#storybook-root').waitFor()
        await page.waitForLoadState('networkidle')
        await page.evaluate(() => document.fonts.ready)
        await expect(page).toHaveScreenshot(`${story.id}-${locale}-${appearance}-mobile.png`, { animations: 'disabled', maxDiffPixelRatio: 0.002, threshold: 0.05 })
      })
    }
  }
```
- the axe loop filter becomes `entry.id.startsWith('foundations-') || entry.id.startsWith('shell-')` (spec §9 a11y gate for shell stories).

- [ ] **Step 8: Update the e2e specs that assert the old frame (deliberately)**

`apps/web/e2e/shell-design.spec.ts`:
- `setShellState` (lines 24–33) becomes

```ts
async function setShellState(page: Page, state: { contextExpanded: boolean }) {
  const contextToggle = page.getByTestId('context-sidebar-toggle')
  await expect(contextToggle).toBeEnabled()
  if ((await contextToggle.getAttribute('aria-expanded')) !== String(state.contextExpanded)) await contextToggle.click()
  await expect(contextToggle).toHaveAttribute('aria-expanded', String(state.contextExpanded))
}
```
  and its three calls (`:54`, `:119`, `:183`) pass `{ contextExpanded: true }`.
- `:62-64`: `'48px'`, `'64px'`, `'232px'`.
- `:98-113` (rail/context toggling) becomes

```ts
  // One rail width (Tasmim spec §5); only the context sidebar collapses.
  await expect(page.getByTestId('module-rail-toggle')).toHaveCount(0)
  const contextToggle = page.getByTestId('context-sidebar-toggle')
  await contextToggle.click()
  await expect(context).toHaveCSS('width', '48px')
  await expect(rail).toHaveCSS('width', '64px')
  await contextToggle.click()
  await expect(context).toHaveCSS('width', '232px')
  await expect(rail).toHaveCSS('width', '64px')
  await expect(context).toBeVisible()
```

`apps/web/e2e/project-popups.spec.ts` (find by content, titles unchanged):
- replace `await expect(rail).toHaveAttribute('data-expanded', 'false')` with `await expect(rail).toHaveCSS('width', '64px')`;
- `.toBe(64)` (collapsed sidebar width) → `.toBe(48)`;
- delete the three lines `await page.getByTestId('module-rail-toggle').click()` / `await expect(rail).toHaveAttribute('data-expanded', 'true')` / `await page.getByTestId('module-rail-toggle').click()` in that test and insert `await expect(page.getByTestId('module-rail-toggle')).toHaveCount(0)`;
- `.toBe(244)` → `.toBe(232)`;
- in "side sheet respects reduced motion and follows the expanded module rail", delete `await page.getByTestId('module-rail-toggle').click()`.

`apps/web/e2e/module-ui-rollout.spec.ts:39` → `await expect(page.locator('html')).not.toHaveAttribute('data-workspace-theme')`.
`apps/web/e2e/project-theme.spec.ts:87` → `await expect(page.locator('html')).not.toHaveAttribute('data-project-theme')`.

Then: `rg -n "module-rail-toggle|data-expanded', 'true'\)|toHaveAttribute\('data-(project|workspace)-theme', 'true'\)" apps/web/e2e` — Expected: only the `toHaveCount(0)` assertions.

- [ ] **Step 9: Run**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim
python3 -B tools/ui_policy.py --refresh-story-context && node tools/ui_catalog.mjs
npm -w apps/web run lint && npm test 2>&1 | tail -5
python3 -B tools/ui_policy.py && (cd tools && python3 -B -m unittest test_ui_policy -q) && python3 -B tools/arch_policy.py
cd apps/web && npm run build-storybook
npx playwright test e2e/storybook-shell.spec.ts e2e/storybook-smoke.spec.ts --reporter=line
npx playwright test e2e/storybook-visual.spec.ts -g 'shell-shellframe|shell-modulerail|shell-appsidebar' --update-snapshots=missing --reporter=line
WEBVUE_REQUIRE_STORYBOOK=1 npx playwright test e2e/storybook-visual.spec.ts -g 'shell-|axe' --reporter=line
```
Expected: `storybook-shell.spec.ts` passes (8 geometry + 2 bar + 2 colour tests); smoke passes for the new stories (a console error from an unhandled request means a missing handler in `stories/handlers/shell.ts` — add it, do not silence the smoke test); the snapshot run writes the new shell PNGs (desktop and `-mobile`); the last run passes including `shell-* has no serious axe violations`. Snapshots of `shell-sidebarcreateaction--` may differ (sidebar CSS changed) — leave them for the CP2 re-baseline (Task 8) and note them in the commit body.

- [ ] **Step 10: Commit**

```bash
git add -A apps/web tools/ui_policy.py tools/test_ui_policy.py docs/design-system
git commit -m "feat(web): rebuild the shell frame with a fixed midnight rail

48px header, 64px rail with the WebVue wordmark and a lime active bar,
232px context sidebar, full-width lists. Drops the rail expand state
and the html theme attributes (spec 7.4).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Context sidebar — sections, counters, `[` and persisted collapse

> **Owner amendment 2 applies:** skip every counter-source step in this task (`AppContextCounts`, `contextCountsFor`, `useShellCounts`, PMO manifest `contextCounts`, the `/api/v1/tasks` call and its surfaces test). `AppSidebar` passes `counts` as `{}`. The `counts` prop rendering and its story/spec with explicit counts stay.

**Files:**
- Create: `apps/web/app/composables/nav/contextSidebarState.ts`, `apps/web/app/composables/nav/sidebarShortcut.ts`, `apps/web/app/composables/useShellCounts.ts`
- Modify: `apps/web/app/composables/useShellNavigation.ts` (`useContextSidebar` on a cookie)
- Modify: `apps/web/app/components/shell/AppSidebar.vue` (counts, shortcut)
- Modify: `apps/web/app/modules/types.ts` (`AppContextCounts`, `AppManifest.contextCounts`), `apps/web/app/modules/surfaces.ts` (`contextCountsFor`), `apps/web/app/modules/pmo/manifest.ts` (PMO counter)
- Create: `apps/web/stories/shell/ContextSidebar.stories.ts`; modify `apps/web/stories/shell/ShellFrame.stories.ts` (`Collapsed`), `apps/web/stories/fixtures/shell.ts`
- Modify: `apps/web/e2e/storybook-shell.spec.ts`, `apps/web/e2e/support/visualStories.ts`; create `apps/web/e2e/shell-tasmim.spec.ts`
- Modify: `tools/ui_policy.py` (`STORYBOOK_COMPONENTS` += `shell/ContextSidebar.vue`), `docs/design-system/components.md`
- Test: create `apps/web/app/composables/nav/__tests__/contextSidebarState.test.ts`, `apps/web/app/composables/nav/__tests__/sidebarShortcut.test.ts`; extend `apps/web/app/modules/__tests__/surfaces.test.ts`

**Interfaces:**
- Produces: `CONTEXT_SIDEBAR_COOKIE = 'webvue-context-sidebar'`, `type ContextSidebarCookie = 'open' | 'closed'`, `contextSidebarState(cookie: Ref<ContextSidebarCookie | null | undefined>, hydrated: Readonly<Ref<boolean>>) → { expanded: ComputedRef<boolean>; hydrated; toggle(): void }`; `isSidebarToggleShortcut(event: SidebarShortcutEvent, overlayOpen: boolean): boolean`; `AppContextCounts { module: string; capability: string; queryKey: readonly unknown[]; load(api: AppSearchApi): Promise<Record<string, number>> }`; `contextCountsFor(module: string | null): AppContextCounts | undefined`; `useShellCounts(module: ComputedRef<string | null>, identity: ComputedRef<AccessIdentity>): ComputedRef<Record<string, number>>`. Story ids `shell-contextsidebar--projects`, `shell-contextsidebar--with-sections`, `shell-contextsidebar--collapsed`, `shell-shellframe--collapsed`.

- [ ] **Step 1: Failing unit tests**

`apps/web/app/composables/nav/__tests__/contextSidebarState.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { contextSidebarState, type ContextSidebarCookie } from '../contextSidebarState'

describe('context sidebar state', () => {
  it.each([[undefined, true], [null, true], ['open', true], ['closed', false], ['garbage', true]] as const)('cookie %s is expanded: %s', (value, expanded) => {
    const state = contextSidebarState(ref(value as ContextSidebarCookie | null | undefined), ref(true))
    expect(state.expanded.value).toBe(expanded)
  })

  it('ignores a toggle before hydration and persists every toggle after it', () => {
    const cookie = ref<ContextSidebarCookie | null | undefined>('open')
    const hydrated = ref(false)
    const state = contextSidebarState(cookie, hydrated)
    state.toggle()
    expect(cookie.value).toBe('open')
    hydrated.value = true
    state.toggle()
    expect(cookie.value).toBe('closed')
    expect(state.expanded.value).toBe(false)
    state.toggle()
    expect(cookie.value).toBe('open')
  })
})
```

`apps/web/app/composables/nav/__tests__/sidebarShortcut.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { isSidebarToggleShortcut, type SidebarShortcutEvent } from '../sidebarShortcut'

const press: SidebarShortcutEvent = {
  code: 'BracketLeft', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false,
  repeat: false, isComposing: false, defaultPrevented: false, target: { tagName: 'BODY' },
}

describe('[ toggles the context sidebar', () => {
  it('matches the physical key whatever the layout types («[» or «ج»)', () => {
    expect(isSidebarToggleShortcut(press, false)).toBe(true)
  })

  it.each([
    ['another key', { code: 'BracketRight' }],
    ['Cmd', { metaKey: true }],
    ['Ctrl', { ctrlKey: true }],
    ['Alt', { altKey: true }],
    ['Shift', { shiftKey: true }],
    ['auto-repeat', { repeat: true }],
    ['IME composition', { isComposing: true }],
    ['an already handled key', { defaultPrevented: true }],
    ['typing in an input', { target: { tagName: 'INPUT' } }],
    ['typing in a textarea', { target: { tagName: 'TEXTAREA' } }],
    ['typing in rich text', { target: { tagName: 'DIV', isContentEditable: true } }],
  ] as const)('ignores %s', (_label, patch) => {
    expect(isSidebarToggleShortcut({ ...press, ...patch }, false)).toBe(false)
  })

  it('ignores the key while a menu or dialog owns the keyboard', () => {
    expect(isSidebarToggleShortcut(press, true)).toBe(false)
  })
})
```

In `apps/web/app/modules/__tests__/surfaces.test.ts`, import `contextCountsFor` and add:

```ts
describe('manifest context counts', () => {
  it('counts my open tasks for the projects sidebar', async () => {
    const counts = contextCountsFor('projects')
    expect(counts?.capability).toBe('pmo.tasks.read')
    const api = (async (url: string, options: { query?: Record<string, unknown> }) => {
      expect(url).toBe('/api/v1/tasks')
      expect(options.query).toMatchObject({ filter: 'mine', closed: 0, limit: 1 })
      return { items: [], total: 12 }
    }) as AppSearchApi
    await expect(counts!.load(api)).resolves.toEqual({ tasks: 12 })
    expect(contextCountsFor('meetings')).toBeUndefined()
    expect(contextCountsFor(null)).toBeUndefined()
  })
})
```
Run: `cd apps/web && npx vitest run app/composables/nav app/modules` — Expected: FAIL (modules and `contextCountsFor` missing).

- [ ] **Step 2: State, shortcut, counts**

`apps/web/app/composables/nav/contextSidebarState.ts`:

```ts
import { computed, type Ref } from 'vue'

export type ContextSidebarCookie = 'open' | 'closed'
/** Read during SSR, so the server renders the collapsed width and the first paint never jumps. */
export const CONTEXT_SIDEBAR_COOKIE = 'webvue-context-sidebar'

/** Expanded unless the cookie says `closed`; a toggle before hydration is ignored (useHydrated contract). */
export function contextSidebarState(cookie: Ref<ContextSidebarCookie | null | undefined>, hydrated: Readonly<Ref<boolean>>) {
  const expanded = computed(() => cookie.value !== 'closed')
  function toggle() {
    if (!hydrated.value) return
    cookie.value = expanded.value ? 'closed' : 'open'
  }
  return { expanded, hydrated, toggle }
}
```

`apps/web/app/composables/nav/sidebarShortcut.ts`:

```ts
import { isEditableKeyTarget } from '../useEscapeBack'

export interface SidebarShortcutEvent {
  code: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean
  repeat: boolean; isComposing: boolean; defaultPrevented: boolean; target: unknown
}

/**
 * `[` collapses or expands the context sidebar (Tasmim spec §5). Matched by physical key
 * (`event.code`), so it also works on an Arabic layout where that key types «ج». Nuxt UI 4.11.1
 * `defineShortcuts` cannot express this key in layout-independent mode (its convertKeyToCode
 * maps only letters, digits, F-keys and nine named keys), so the shell listens for it directly.
 */
export function isSidebarToggleShortcut(event: SidebarShortcutEvent, overlayOpen: boolean): boolean {
  if (event.code !== 'BracketLeft') return false
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false
  if (event.repeat || event.isComposing || event.defaultPrevented || overlayOpen) return false
  return !isEditableKeyTarget(event.target)
}
```

`apps/web/app/composables/useShellNavigation.ts` — add the import and replace `useContextSidebar`:

```ts
import { CONTEXT_SIDEBAR_COOKIE, contextSidebarState, type ContextSidebarCookie } from './nav/contextSidebarState'

export function useContextSidebar() {
  const cookie = useCookie<ContextSidebarCookie | null>(CONTEXT_SIDEBAR_COOKIE, {
    default: () => 'open',
    path: '/',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365,
  })
  return contextSidebarState(cookie, useHydrated())
}
```

`apps/web/app/modules/types.ts`, before `AppManifest`:

```ts
/**
 * Small counters beside an application's context links, fetched after hydration only
 * (so server and first client render match). Keys of the result are context-link ids.
 */
export interface AppContextCounts {
  /** Rail module whose sidebar shows the counts. */
  module: string
  /** Fetched only when the identity can reach this capability. */
  capability: string
  queryKey: readonly unknown[]
  load: (api: AppSearchApi) => Promise<Record<string, number>>
}
```
and in `AppManifest` after `sidebarPanel?`: `contextCounts?: AppContextCounts`.

`apps/web/app/modules/surfaces.ts`:

```ts
/** The context counters an application declares for a rail module, if any. */
export function contextCountsFor(module: string | null): AppContextCounts | undefined {
  if (!module) return undefined
  return activeManifests().find(manifest => manifest.contextCounts?.module === module)?.contextCounts
}
```

`apps/web/app/modules/pmo/manifest.ts`: import `TaskListSchema` beside `TaskNotificationKindSchema`, and after `contextLinks` add

```ts
  // «مهامي» shows my open tasks, the same set /tasks opens with (filter=mine, closed=0).
  // The key sits under ['tasks'], so task mutations that invalidate the task family refresh it.
  contextCounts: {
    module: 'projects',
    capability: 'pmo.tasks.read',
    queryKey: ['tasks', 'count', 'mine-open'],
    async load(api) {
      const page = await api('/api/v1/tasks', { query: { filter: 'mine', closed: 0, limit: 1, offset: 0 }, schema: TaskListSchema })
      return { tasks: page.total }
    },
  },
```

`apps/web/app/composables/useShellCounts.ts`:

```ts
import { useQuery } from '@tanstack/vue-query'
import { computed, type ComputedRef } from 'vue'
import { contextCountsFor } from '../modules/surfaces'
import { canReach, type AccessIdentity } from '../utils/accessPolicy'

/** Counters beside context links (manifest `contextCounts`); empty until hydrated and loaded. */
export function useShellCounts(module: ComputedRef<string | null>, identity: ComputedRef<AccessIdentity>): ComputedRef<Record<string, number>> {
  const { $api } = useApi()
  const hydrated = useHydrated()
  const source = computed(() => contextCountsFor(module.value))
  const query = useQuery({
    queryKey: computed(() => [...(source.value?.queryKey ?? ['shell', 'counts', 'none'])] as unknown[]),
    queryFn: () => source.value!.load($api),
    enabled: computed(() => hydrated.value && !!source.value && canReach(identity.value, source.value.capability)),
    staleTime: 60_000,
  })
  return computed(() => (source.value && query.data.value ? query.data.value : {}))
}
```

`apps/web/app/components/shell/AppSidebar.vue`:
- add imports `import { useEventListener } from '@vueuse/core'` (merge with the `useMediaQuery` import), `import { useShellCounts } from '@/composables/useShellCounts'`, `import { isSidebarToggleShortcut } from '@/composables/nav/sidebarShortcut'`, `import { overlayOwnsEscape } from '@/composables/useEscapeBack'`;
- destructure `contextModule` and `identity` from `useShellModel()` as well;
- replace `const counts: Record<string, number> = {}` with

```ts
const counts = useShellCounts(contextModule, identity)
// `[` (by physical key) collapses or expands the sidebar on desktop; never while typing or in a menu/dialog.
useEventListener('keydown', (event: KeyboardEvent) => {
  if (!isDesktop.value || !isSidebarToggleShortcut(event, overlayOwnsEscape(document))) return
  event.preventDefault()
  toggle()
})
```

Run: `npx vitest run app/composables app/modules && cd ../.. && npm -w apps/web run lint` — Expected: PASS.

- [ ] **Step 3: Stories**

Append to `apps/web/stories/fixtures/shell.ts`:

```ts
import type { ShellContextLink } from '../../app/composables/nav/shellModules'
import { contextLinksForModule } from '../../app/composables/nav/shellModules'
import { groupSections, sidebarModel } from '../../app/composables/nav/sidebarModel'

const projectLinks: ShellContextLink[] = contextLinksForModule('projects', shellMe, '/tasks').map(link => ({ ...link, active: link.id === 'tasks' }))
export const projectsSidebar = sidebarModel({ links: projectLinks, moduleLabelKey: 'nav.projects', path: '/tasks', panel: null, surface: 'desktop' })

// Story-only grouping to show section headings; no module ships sections yet (DESIGN.md §3).
const settingsLinks: ShellContextLink[] = contextLinksForModule('settings', shellMe, '/settings/users')
  .map(link => ({ ...link, active: link.id === 'users', section: link.id === 'branding' ? 'settings.branding.title' : 'nav.systemAdministration' }))
export const sectionedSidebar = { createLinks: [] as ShellContextLink[], sections: groupSections(settingsLinks), showNav: true }
```
(Move the new imports to the top of the file.)

Create `apps/web/stories/shell/ContextSidebar.stories.ts`:

```ts
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { useI18n } from 'vue-i18n'
import ContextSidebar from '../../app/components/shell/ContextSidebar.vue'
import { projectsSidebar, sectionedSidebar } from '../fixtures/shell'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shell/ContextSidebar',
  component: ContextSidebar,
  parameters: { layout: 'fullscreen' },
  args: {
    title: '', createLinks: projectsSidebar.createLinks, sections: projectsSidebar.sections, showNav: true,
    counts: { tasks: 7 }, expanded: true, hydrated: true, panel: null, renderPanel: false, panelWidth: 'default', motionKey: 'module:projects',
  },
} satisfies Meta<typeof ContextSidebar>
export default meta
type Story = StoryObj<typeof meta>

const render = (titleKey: string) => (args: Story['args']) => ({
  components: { ContextSidebar },
  setup: () => ({ args, t: useI18n().t }),
  template: `<div class="webvue-shell min-h-svh"><ContextSidebar v-bind="args" :title="t('${titleKey}')" /></div>`,
})

export const Projects: Story = { name: 'المشاريع مع عدّاد', parameters: storyContext('apps/web/app/components/shell/AppSidebar.vue:1'), render: render('nav.projects') }
export const WithSections: Story = {
  name: 'أقسام بعناوين',
  parameters: storyContext('apps/web/app/components/shell/AppSidebar.vue:1'),
  args: { createLinks: sectionedSidebar.createLinks, sections: sectionedSidebar.sections, counts: {} },
  render: render('nav.settings'),
}
export const Collapsed: Story = { ...Projects, name: 'مطوية', args: { expanded: false } }
```

Add to `apps/web/stories/shell/ShellFrame.stories.ts`:

```ts
export const Collapsed: Story = {
  name: 'القائمة مطوية',
  parameters: storyContext('apps/web/app/layouts/default.vue:1'),
  loaders: [at('/tasks', 'closed')],
  render: () => frame(),
}
```

Register `shell/ContextSidebar.vue` in `STORYBOOK_COMPONENTS`; add its story path to the components.md navigation row; append `'shell-contextsidebar--'` to `VISUAL_STORIES`.

- [ ] **Step 4: Storybook and mock e2e tests**

Append inside `test.describe('Tasmim shell (desktop)', …)` in `apps/web/e2e/storybook-shell.spec.ts`:

```ts
  for (const [locale, dir] of LOCALES) {
    test(`a collapsed sidebar is 48px icons with hidden labels (${locale})`, async ({ page }) => {
      await open(page, 'shell-shellframe--collapsed', `locale:${locale};appearance:light`)
      const sidebar = page.getByTestId('context-sidebar')
      await expect(sidebar).toHaveAttribute('data-expanded', 'false')
      expect((await box(page, 'context-sidebar')).width).toBeCloseTo(48, 0)
      await expect(page.getByTestId('context-sidebar-toggle')).toHaveAttribute('aria-expanded', 'false')
      await expect(page.getByTestId('context-link-tasks')).toHaveAccessibleName(locale === 'ar' ? 'مهامي' : 'My tasks')
      const main = (await box(page, 'shell-main'))
      if (dir === 'rtl') expect(main.x + main.width).toBeCloseTo(1440 - 64 - 48, 0)
      else expect(main.x).toBeCloseTo(64 + 48, 0)
    })
  }

  test('counters sit beside the link without changing its name', async ({ page }) => {
    await open(page, 'shell-contextsidebar--projects', 'locale:ar;appearance:light')
    const link = page.getByTestId('context-link-tasks')
    await expect(link).toHaveAccessibleName('مهامي')
    const counter = page.locator(`[id="${await link.getAttribute('aria-describedby')}"]`)
    await expect(counter).toHaveText('7')
    await expect(page.locator('.webvue-context-section-title')).toHaveCount(0)
  })

  test('section headings render when links declare them', async ({ page }) => {
    await open(page, 'shell-contextsidebar--with-sections', 'locale:ar;appearance:light')
    await expect(page.locator('.webvue-context-section-title')).toHaveText(['إدارة النظام', 'هوية الجهة'])
  })
```
(If `settings.branding.title` in `ar/settings.json` is not «هوية الجهة», use its actual value: `python3 -c "import json;print(json.load(open('apps/web/i18n/locales/ar/settings.json'))['branding']['title'])"`.)

Create `apps/web/e2e/shell-tasmim.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test'

// Runs against the isolated mock stack (Nuxt 4097 + mock API 4498), which signs every request in.
async function beforeHydration(page: Page, path: string) {
  let resume!: () => void
  const gate = new Promise<void>(resolve => { resume = resolve })
  await page.route('**/_nuxt/**', async route => {
    if (route.request().resourceType() === 'script') await gate
    await route.continue()
  })
  await page.goto(path, { waitUntil: 'commit' })
  return resume
}

test.describe('Tasmim context sidebar', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('collapse survives a reload and is server-rendered before hydration', async ({ page, context }) => {
    await context.clearCookies({ name: 'webvue-context-sidebar' })
    await page.goto('/tasks')
    const sidebar = page.getByTestId('context-sidebar')
    const toggle = page.getByTestId('context-sidebar-toggle')
    await expect(toggle).toBeEnabled()
    await expect(sidebar).toHaveAttribute('data-expanded', 'true')
    await toggle.click()
    await expect(sidebar).toHaveAttribute('data-expanded', 'false')
    await expect.poll(async () => (await sidebar.boundingBox())!.width).toBe(48)
    expect((await context.cookies()).find(cookie => cookie.name === 'webvue-context-sidebar')?.value).toBe('closed')

    const hydrate = await beforeHydration(page, '/tasks')
    await expect(sidebar).toHaveAttribute('data-expanded', 'false')
    await expect(toggle).toBeDisabled()
    hydrate()
    await expect(toggle).toBeEnabled()
    await toggle.click()
    await expect(sidebar).toHaveAttribute('data-expanded', 'true')
    await expect.poll(async () => (await sidebar.boundingBox())!.width).toBe(232)
  })

  test('[ toggles the sidebar by physical key, also on an Arabic layout, but not while typing', async ({ page }) => {
    await page.goto('/tasks')
    const sidebar = page.getByTestId('context-sidebar')
    await expect(page.getByTestId('context-sidebar-toggle')).toBeEnabled()
    const start = (await sidebar.getAttribute('data-expanded'))!
    const flipped = start === 'true' ? 'false' : 'true'
    await page.keyboard.press('BracketLeft')
    await expect(sidebar).toHaveAttribute('data-expanded', flipped)
    // Arabic (101) layout: the same physical key types «ج».
    await page.evaluate(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ج', code: 'BracketLeft', bubbles: true })))
    await expect(sidebar).toHaveAttribute('data-expanded', start)
    await page.evaluate(() => {
      const input = document.createElement('input')
      document.body.append(input)
      input.focus()
      input.dispatchEvent(new KeyboardEvent('keydown', { key: '[', code: 'BracketLeft', bubbles: true }))
      input.remove()
    })
    await expect(sidebar).toHaveAttribute('data-expanded', start)
  })

  test('my tasks shows its open count after hydration', async ({ page }) => {
    await page.goto('/projects')
    const link = page.getByTestId('context-link-tasks')
    await expect(link).toHaveAttribute('aria-describedby', /-count-tasks$/)
    await expect(link).toHaveAccessibleName('مهامي')
    await expect(page.locator(`[id="${await link.getAttribute('aria-describedby')}"]`)).toHaveText(/^\d+\+?$/)
  })
})
```

- [ ] **Step 5: Run**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim
python3 -B tools/ui_policy.py --refresh-story-context && node tools/ui_catalog.mjs
npm -w apps/web run lint && npm test 2>&1 | tail -5 && python3 -B tools/ui_policy.py && python3 -B tools/arch_policy.py
cd apps/web && npm run build-storybook
npx playwright test e2e/storybook-shell.spec.ts e2e/storybook-smoke.spec.ts --reporter=line
npx playwright test e2e/storybook-visual.spec.ts -g 'shell-contextsidebar|shell-shellframe--collapsed' --update-snapshots=missing --reporter=line
```
Then start the mock stack as in Task 2 Step 8 and run `E2E_BASE_URL=http://localhost:4097 npx playwright test e2e/shell-tasmim.spec.ts --reporter=line`.
Expected: all pass. If the reload test sees `data-expanded="true"` before hydration, the cookie is not reaching SSR — check that `useContextSidebar` is called in `AppSidebar` setup (not in `onMounted`); do not weaken the assertion.

- [ ] **Step 6: Commit**

```bash
git add -A apps/web tools/ui_policy.py docs/design-system
git commit -m "feat(web): add sidebar sections, counters, [ and persisted collapse

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Header — breadcrumb, search trigger, bell, menus, console badge

**Files:**
- Modify: `apps/web/app/composables/nav/shellModules.ts:159-163` (extract `moduleContextLinks`)
- Create: `apps/web/app/composables/nav/breadcrumb.ts`, `apps/web/app/components/shell/ShellBreadcrumb.vue`
- Modify: `apps/web/app/composables/usePageHeader.ts` (add `usePageHeaderTitle`)
- Rewrite: `apps/web/app/components/shell/ShellHeader.vue`
- Modify: `apps/web/i18n/locales/{ar,en}/common.json` (`nav.breadcrumb`, `nav.consoleBadge`)
- Modify: `tools/ui_policy.py:546-558` (breadcrumb rule), `tools/test_ui_policy.py` (new test), `STORYBOOK_COMPONENTS` += `shell/ShellHeader.vue`, `shell/ShellBreadcrumb.vue`, `shell/AppearanceMenu.vue`, `shell/AppAccountMenu.vue`, `shell/GlobalSearch.vue`
- Create: `apps/web/stories/shell/{ShellHeader,ShellBreadcrumb,AppearanceMenu,AppAccountMenu,GlobalSearch}.stories.ts`; modify `ShellFrame.stories.ts` (`Console`)
- Modify: `apps/web/e2e/storybook-shell.spec.ts`, `apps/web/e2e/support/visualStories.ts`, `docs/design-system/components.md`
- Test: create `apps/web/app/composables/nav/__tests__/breadcrumb.test.ts`; extend `apps/web/app/composables/__tests__/usePageHeader.test.ts`

**Interfaces:**
- Produces: `moduleContextLinks(module: ShellModule, path?: string): ShellContextLink[]` (unfiltered); `ShellCrumb { label: string; to?: string }`; `shellBreadcrumb(input: { path: string; pageTitle?: string | null; t: (key: string) => string }): ShellCrumb[]`; `usePageHeaderTitle(): ComputedRef<string | null>`; `ShellBreadcrumb` props `{ items: ShellCrumb[] }`; testids `shell-breadcrumb`, `vendor-console-badge`; story `shell-shellframe--console`.

- [ ] **Step 1: The breadcrumb rule changes owner (failing test first)**

DESIGN.md forbade a shell breadcrumb; spec §5 requires one. The policy flips from "no breadcrumb in the shell" to "only the shell builds a breadcrumb". In `tools/test_ui_policy.py` add (any `TestCase` that already uses `policy.*` helpers):

```python
    def test_breadcrumb_is_owned_by_the_shell(self):
        owner = APP + 'components/shell/ShellBreadcrumb.vue'
        page = APP + 'pages/tasks.vue'
        trail = '<template><UBreadcrumb :items="items" /></template>'
        self.assertEqual(policy.breadcrumb_errors({owner: trail}), [])
        self.assertEqual(policy.breadcrumb_errors({page: trail}),
                         [page + ': the breadcrumb belongs to shell/ShellBreadcrumb.vue (DESIGN.md)'])
        self.assertEqual(policy.breadcrumb_errors({page: '<!-- <UBreadcrumb /> -->'}), [])
```
Run `(cd tools && python3 -B -m unittest test_ui_policy -q)` — Expected: FAIL.

Replace `tools/ui_policy.py:546-558` (comment, `BREADCRUMB`, `BREADCRUMB_SCOPE`, `breadcrumb_errors`) with:

```python
# The shell owns the one breadcrumb (Tasmim spec 2026-10-11 §5, DESIGN.md §3);
# a page or another component never builds its own trail.
BREADCRUMB_OWNER = COMPONENTS + 'shell/ShellBreadcrumb.vue'
BREADCRUMB_TAG = re.compile(r'<UBreadcrumb\b')


def breadcrumb_errors(current: dict[str, str]) -> list[str]:
    return [path + ': the breadcrumb belongs to shell/ShellBreadcrumb.vue (DESIGN.md)'
            for path, source in sorted(current.items())
            if path.startswith((PAGES, LAYOUTS, COMPONENTS)) and path.endswith('.vue') and path != BREADCRUMB_OWNER
            and BREADCRUMB_TAG.search(COMMENTS.sub('', source))]
```
Re-run — Expected: PASS.

- [ ] **Step 2: The trail model (failing test first)**

In `apps/web/app/composables/nav/shellModules.ts` replace `contextLinksForModule` with:

```ts
/** A module's context links before capability filtering (the breadcrumb names the page the user is on). */
export function moduleContextLinks(module: ShellModule, path?: string): ShellContextLink[] {
  const owner = activeManifests().find(manifest => manifest.rail.some(entry => entry.id === module))
  return owner ? owner.contextLinks?.(path) ?? [] : foundationContextLinks[module] ?? []
}

export function contextLinksForModule(module: ShellModule, identity: AccessIdentity, path?: string): ShellContextLink[] {
  return moduleContextLinks(module, path).filter(link => canReach(identity, link.capability, typeof link.to === 'string' ? link.to : undefined))
}
```

`apps/web/app/composables/nav/__tests__/breadcrumb.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { shellBreadcrumb } from '../breadcrumb'

const t = (key: string) => key

describe('shell breadcrumb', () => {
  it.each([
    ['/tasks', null, [{ label: 'nav.projects', to: '/projects' }, { label: 'nav.tasks' }]],
    ['/projects', null, [{ label: 'nav.projects' }]],
    ['/projects/5', 'الملخص', [{ label: 'nav.projects', to: '/projects' }, { label: 'الملخص' }]],
    ['/settings/roles', null, [{ label: 'nav.settings', to: '/settings/users' }, { label: 'nav.roles' }]],
    ['/meetings/calendar', null, [{ label: 'nav.meetings', to: '/meetings' }, { label: 'nav.meetingCalendar' }]],
    ['/vendor/overview', null, [{ label: 'nav.management' }]],
    ['/notifications', 'الإشعارات', [{ label: 'الإشعارات' }]],
    ['/notifications', null, []],
  ] as const)('%s (page title %s)', (path, pageTitle, expected) => {
    expect(shellBreadcrumb({ path, pageTitle, t })).toEqual(expected)
  })

  it('never repeats the last label and never links the current page', () => {
    const crumbs = shellBreadcrumb({ path: '/tasks', pageTitle: 'nav.tasks', t })
    expect(crumbs.at(-1)).toEqual({ label: 'nav.tasks' })
    expect(crumbs.filter(crumb => crumb.label === 'nav.tasks')).toHaveLength(1)
  })
})
```
(If `/meetings/calendar`'s context link label key differs, read it from `apps/web/app/modules/meetings/manifest.ts` and use that key; the expectation shape stays.)
Run — Expected: FAIL (module missing).

`apps/web/app/composables/nav/breadcrumb.ts`:

```ts
// Relative imports: unit-tested directly under plain vitest.
import { activeShellModule, contextModuleFor } from './activeRoute'
import { moduleContextLinks, shellModuleList } from './shellModules'
import { isNavPathActive } from '../../utils/accessPolicy'

export interface ShellCrumb { label: string; to?: string }

const target = (to: unknown): string => (typeof to === 'string' ? to : (to as { path?: string } | null)?.path ?? '')

/**
 * The header trail (Tasmim spec §5): rail module › active context section › page title.
 * Repeated labels and repeated targets collapse; the last crumb is the current page and
 * carries no link.
 */
export function shellBreadcrumb(input: { path: string; pageTitle?: string | null; t: (key: string) => string }): ShellCrumb[] {
  const crumbs: ShellCrumb[] = []
  const push = (crumb: ShellCrumb) => {
    const last = crumbs.at(-1)
    if (last && (last.label === crumb.label || (crumb.to && last.to === crumb.to))) return
    crumbs.push(crumb)
  }
  const module = activeShellModule(input.path)
  const definition = module ? shellModuleList().find(item => item.id === module) : undefined
  if (definition) push({ label: input.t(definition.labelKey), to: definition.to })
  const contextModule = contextModuleFor(module)
  if (contextModule) {
    const section = moduleContextLinks(contextModule, input.path)
      .filter(link => !link.pinned && isNavPathActive(input.path, target(link.to)))
      .sort((a, b) => target(b.to).length - target(a.to).length)[0]
    if (section) push({ label: input.t(section.labelKey), to: target(section.to) || undefined })
  }
  const title = input.pageTitle?.trim()
  if (title) push({ label: title })
  if (crumbs.length) crumbs[crumbs.length - 1] = { label: crumbs.at(-1)!.label }
  return crumbs
}
```
Re-run — Expected: PASS.

- [ ] **Step 3: Page title reader**

In `apps/web/app/composables/usePageHeader.ts` add `computed` to the `vue` import and:

```ts
/** The title the current route's page header registered, for the shell breadcrumb; null until one registers. */
export function usePageHeaderTitle() {
  const route = useRoute()
  const state = usePageHeaderState()
  return computed(() => (state.value && state.value.route === route.path ? state.value.title : null))
}
```
In `apps/web/app/composables/__tests__/usePageHeader.test.ts` import `usePageHeaderTitle` and add:

```ts
  it('reads the registered title for the current route only', () => {
    const route = reactive({ path: '/tasks' })
    const pageState = ref<{ owner: string; route: string; title: string } | null>({ owner: 'x', route: '/tasks', title: 'مهامي' })
    vi.stubGlobal('useRoute', () => route)
    vi.stubGlobal('useState', () => pageState)
    const title = usePageHeaderTitle()
    expect(title.value).toBe('مهامي')
    route.path = '/projects'
    expect(title.value).toBeNull()
  })
```

- [ ] **Step 4: `ShellBreadcrumb` and the header**

`apps/web/app/components/shell/ShellBreadcrumb.vue`:

```vue
<script setup lang="ts">
import type { ShellCrumb } from '@/composables/nav/breadcrumb'

// The one breadcrumb (ui_policy breadcrumb_errors): module › section › page.
const props = defineProps<{ items: ShellCrumb[] }>()
const { t } = useI18n()
const items = computed(() => props.items.map(item => ({ label: item.label, to: item.to })))
</script>

<template>
  <UBreadcrumb v-if="items.length" :items="items" :aria-label="t('nav.breadcrumb')" data-testid="shell-breadcrumb" class="webvue-shell-breadcrumb" />
</template>
```

Replace `apps/web/app/components/shell/ShellHeader.vue` with:

```vue
<script setup lang="ts">
import AppAccountMenu from '@/components/shell/AppAccountMenu.vue'
import AppearanceMenu from '@/components/shell/AppearanceMenu.vue'
import GlobalSearch from '@/components/shell/GlobalSearch.vue'
import MobileNavigation from '@/components/shell/MobileNavigation.vue'
import ShellBreadcrumb from '@/components/shell/ShellBreadcrumb.vue'
import NotificationCenter from '@/components/notifications/NotificationCenter.vue'
import { shellBreadcrumb } from '@/composables/nav/breadcrumb'
import { sidebarModel } from '@/composables/nav/sidebarModel'
import { useShellModel } from '@/composables/useShellModel'

// The 48px neutral header (spec §5): tenant mark, breadcrumb, the ⌘K search
// trigger (palette in Plan 3), appearance, bell, account; a console badge on /vendor/*.
const { t } = useI18n()
const route = useRoute()
const { branding } = useBranding()
const { can } = useAccess()
const pageTitle = usePageHeaderTitle()
const { activeModule, rail, homePath, contextTitle, contextLabelKey, contextLinks, createTo } = useShellModel()
const brandName = computed(() => branding.value?.name ?? t('app.productName'))
const crumbs = computed(() => shellBreadcrumb({ path: route.path, pageTitle: pageTitle.value, t }))
const isConsole = computed(() => activeModule.value === 'management')
const mobileOpen = ref(false)
const mobile = computed(() => sidebarModel({ links: contextLinks.value, moduleLabelKey: contextLabelKey.value, path: route.path, panel: null, surface: 'mobile' }))
const mobileCreateLinks = computed(() => mobile.value.createLinks.map(link => ({ ...link, to: createTo(link) })))
</script>

<template>
  <header data-testid="shell-header" class="webvue-shell-header" :aria-label="t('nav.header')">
    <div class="webvue-shell-header-start">
      <MobileNavigation
        v-model:open="mobileOpen"
        :modules="rail.all"
        :active-id="activeModule"
        :title="contextTitle"
        :create-links="mobileCreateLinks"
        :sections="mobile.sections"
      />
      <NuxtLink :to="homePath" class="webvue-shell-brand" :aria-label="`${brandName} — ${t('nav.home')}`">
        <img v-if="branding?.logo_url" :src="branding.logo_url" :alt="brandName" class="webvue-shell-brand-logo">
        <span v-else class="webvue-shell-brand-mark" aria-hidden="true">{{ brandName.slice(0, 1) }}</span>
        <span class="webvue-shell-brand-name">{{ brandName }}</span>
      </NuxtLink>
      <span v-if="crumbs.length" class="webvue-shell-header-divider" aria-hidden="true" />
      <ShellBreadcrumb :items="crumbs" />
      <UBadge v-if="isConsole" color="neutral" variant="subtle" size="sm" data-testid="vendor-console-badge">{{ t('nav.consoleBadge') }}</UBadge>
    </div>
    <div class="webvue-shell-header-actions">
      <GlobalSearch />
      <AppearanceMenu />
      <NotificationCenter v-if="can('webvue.notifications')" />
      <AppAccountMenu />
    </div>
  </header>
</template>
```
(`homePath` from `useShellModel()` is `firstAllowedPath(me)`, as before. `.webvue-shell-brand` and its aria-label keep `branding.spec.ts:197,274-275` valid.)

Locales — `ar/common.json` `nav`: `"breadcrumb": "مسار الصفحة"`, `"consoleBadge": "وحدة إدارة ويب فيو"`; `en/common.json` `nav`: `"breadcrumb": "Breadcrumb"`, `"consoleBadge": "WebVue console"`.

- [ ] **Step 5: Stories**

Each story uses `parameters: { msw: { handlers: { api: shellHandlers } } }` and cites `apps/web/app/components/shell/ShellHeader.vue:1` (or `apps/web/app/layouts/default.vue:1` for `ShellHeader`).

`apps/web/stories/shell/ShellHeader.stories.ts`:

```ts
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import ShellHeader from '../../app/components/shell/ShellHeader.vue'
import { __getRouter } from '../../.storybook/nuxt-shims'
import { shellHandlers } from '../handlers/shell'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shell/ShellHeader',
  component: ShellHeader,
  parameters: { layout: 'fullscreen', msw: { handlers: { api: shellHandlers } } },
} satisfies Meta<typeof ShellHeader>
export default meta
type Story = StoryObj<typeof meta>

const at = (path: string) => async () => { await __getRouter()!.replace(path); return {} }
const render = () => ({ components: { ShellHeader }, template: '<div class="webvue-shell" style="min-height: 64px"><ShellHeader /></div>' })

export const Default: Story = { name: 'مهامي', parameters: storyContext('apps/web/app/layouts/default.vue:1'), loaders: [at('/tasks')], render }
export const Console: Story = { name: 'وحدة إدارة ويب فيو', parameters: storyContext('apps/web/app/layouts/default.vue:1'), loaders: [at('/vendor/overview')], render }
```

`apps/web/stories/shell/ShellBreadcrumb.stories.ts`:

```ts
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import ShellBreadcrumb from '../../app/components/shell/ShellBreadcrumb.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shell/ShellBreadcrumb',
  component: ShellBreadcrumb,
  args: { items: [{ label: 'المشاريع', to: '/projects' }, { label: 'مشروع البوابة', to: '/projects/1' }, { label: 'المهام' }] },
} satisfies Meta<typeof ShellBreadcrumb>
export default meta
type Story = StoryObj<typeof meta>

export const Trail: Story = { name: 'ثلاثة مستويات', parameters: storyContext('apps/web/app/components/shell/ShellHeader.vue:1') }
export const Single: Story = { name: 'مستوى واحد', parameters: storyContext('apps/web/app/components/shell/ShellHeader.vue:1'), args: { items: [{ label: 'الإعدادات' }] } }
```

`AppearanceMenu.stories.ts`, `AppAccountMenu.stories.ts`, `GlobalSearch.stories.ts` follow one pattern (shown for `AppearanceMenu`; replace the name, title and component for the other two — titles `Shell/AppAccountMenu`, `Shell/GlobalSearch`, story names `الحساب` and `زر البحث`):

```ts
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import AppearanceMenu from '../../app/components/shell/AppearanceMenu.vue'
import { shellHandlers } from '../handlers/shell'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shell/AppearanceMenu',
  component: AppearanceMenu,
  parameters: { msw: { handlers: { api: shellHandlers } } },
} satisfies Meta<typeof AppearanceMenu>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  name: 'زر المظهر',
  parameters: storyContext('apps/web/app/components/shell/ShellHeader.vue:1'),
  render: () => ({ components: { AppearanceMenu }, template: '<div class="webvue-shell-header-actions"><AppearanceMenu /></div>' }),
}
```

Add `Console` to `ShellFrame.stories.ts`: `export const Console: Story = { name: 'وحدة إدارة ويب فيو', parameters: storyContext('apps/web/app/layouts/default.vue:1'), loaders: [at('/vendor/overview')], render: () => frame() }`.

Register the five components in `STORYBOOK_COMPONENTS`, add `ShellBreadcrumb.vue` (new file) and the story paths to `components.md`, append `'shell-shellheader--', 'shell-shellbreadcrumb--', 'shell-appearancemenu--', 'shell-appaccountmenu--', 'shell-globalsearch--'` to `VISUAL_STORIES`.

- [ ] **Step 6: Storybook tests**

Append inside the desktop describe of `storybook-shell.spec.ts`:

```ts
  for (const [locale, module, current] of [['ar', 'المشاريع', 'مهامي'], ['en', 'Projects', 'My tasks']] as const) {
    test(`breadcrumb names the module and the current section (${locale})`, async ({ page }) => {
      await open(page, 'shell-shellframe--default', `locale:${locale};appearance:light`)
      const trail = page.getByTestId('shell-breadcrumb')
      await expect(trail).toHaveAccessibleName(locale === 'ar' ? 'مسار الصفحة' : 'Breadcrumb')
      await expect(trail.getByRole('link', { name: module, exact: true })).toHaveAttribute('href', '/projects')
      await expect(trail.locator('[aria-current="page"]')).toHaveText(current)
      await expect(page.getByTestId('vendor-console-badge')).toHaveCount(0)
      await expect(page.getByTestId('shell-header').locator('h1')).toHaveCount(0)
    })
  }

  test('the vendor console shows its badge', async ({ page }) => {
    await open(page, 'shell-shellframe--console', 'locale:ar;appearance:light')
    await expect(page.getByTestId('vendor-console-badge')).toHaveText('وحدة إدارة ويب فيو')
  })

  test('header controls wait for nothing in Storybook and keep the 32px control height', async ({ page }) => {
    await open(page, 'shell-shellframe--default', 'locale:ar;appearance:light')
    const search = page.getByRole('button', { name: 'بحث', exact: true })
    await expect(search).toBeEnabled()
    expect((await search.boundingBox())!.height).toBeCloseTo(32, 0)
  })
```

- [ ] **Step 7: Run and commit**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim
python3 -B tools/ui_policy.py --refresh-story-context && node tools/ui_catalog.mjs
npm -w apps/web run lint && npm test 2>&1 | tail -5
python3 -B tools/ui_policy.py && (cd tools && python3 -B -m unittest test_ui_policy -q) && python3 -B tools/arch_policy.py
cd apps/web && npm run build-storybook
npx playwright test e2e/storybook-shell.spec.ts e2e/storybook-smoke.spec.ts --reporter=line
npx playwright test e2e/storybook-visual.spec.ts -g 'shell-' --update-snapshots=missing --reporter=line
WEBVUE_REQUIRE_STORYBOOK=1 npx playwright test e2e/storybook-visual.spec.ts -g 'axe' --reporter=line
cd ../.. && git add -A apps/web tools/ui_policy.py tools/test_ui_policy.py docs/design-system
git commit -m "feat(web): add the shell breadcrumb and the 48px header

The breadcrumb policy now names its one owner, shell/ShellBreadcrumb.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Expected: all pass; axe reports no serious/critical violation for any `shell-` story.

---

### Task 6: Mobile drawer

**Files:**
- Modify: `apps/web/app/assets/css/components.css:3-6,40-63` (drawer rules)
- Create: `apps/web/stories/shell/MobileNavigation.stories.ts`; modify `apps/web/stories/fixtures/shell.ts`
- Modify: `apps/web/e2e/storybook-shell.spec.ts`, `apps/web/e2e/shell-tasmim.spec.ts`, `apps/web/e2e/support/visualStories.ts`
- Modify: `tools/ui_policy.py` (`STORYBOOK_COMPONENTS` += `shell/MobileNavigation.vue`), `docs/design-system/components.md`

**Interfaces:**
- Consumes: `MobileNavigation` props and `v-model:open` (Task 2), `shellRail`, `projectsSidebar` fixtures.
- Produces: story `shell-mobilenavigation--open`; CSS `.webvue-mobile-menu` (width `min(320px, calc(100vw - 48px))`), `.webvue-mobile-section`, `.webvue-mobile-title`.

- [ ] **Step 1: Failing drawer tests**

Append to `apps/web/e2e/storybook-shell.spec.ts`:

```ts
test.describe('Tasmim shell (390px)', () => {
  requireStorybook()
  test.use({ viewport: { width: 390, height: 844 } })
  test.beforeAll(async () => { ({ base, close } = await startStorybookServer()) })
  test.afterAll(async () => { await close() })

  for (const [locale, dir] of LOCALES) {
    for (const fontSize of ['small', 'large'] as const) {
      test(`drawer opens from the inline-start side at 390px (${locale}, ${fontSize})`, async ({ page }) => {
        await open(page, 'shell-shellframe--default', `locale:${locale};appearance:light;fontSize:${fontSize}`)
        await expect(page.getByTestId('module-rail')).toBeHidden()
        await expect(page.getByTestId('context-sidebar')).toBeHidden()
        const header = await box(page, 'shell-header')
        expect(header.x).toBeCloseTo(0, 0)
        expect(header.width).toBeCloseTo(390, 0)
        expect(header.height).toBeCloseTo(48, 0)
        for (const control of await page.getByTestId('shell-header').getByRole('button').all()) {
          const area = (await control.boundingBox())!
          expect(area.height).toBeGreaterThanOrEqual(44)
          expect(area.x + area.width).toBeLessThanOrEqual(390)
        }
        const trigger = page.getByTestId('mobile-navigation-trigger')
        await expect(trigger).toBeEnabled()
        await trigger.click()
        const drawer = page.locator('#mobile-navigation')
        await expect(drawer).toBeVisible()
        const area = (await drawer.boundingBox())!
        expect(area.width).toBeCloseTo(320, 0)
        if (dir === 'rtl') expect(area.x + area.width).toBeCloseTo(390, 0)
        else expect(area.x).toBeCloseTo(0, 0)
        await expect(drawer.getByTestId('mobile-context-link-tasks')).toHaveAttribute('aria-current', 'page')
        for (const link of await drawer.getByRole('link').all()) expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44)
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      })
    }
  }
})
```

Append to `apps/web/e2e/shell-tasmim.spec.ts`:

```ts
test.describe('Tasmim mobile drawer', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('menu waits for hydration, opens from the inline-start side and closes after navigation', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const hydrate = await beforeHydration(page, '/tasks')
    const trigger = page.getByTestId('mobile-navigation-trigger')
    await expect(trigger).toBeVisible()
    await expect(trigger).toBeDisabled()
    hydrate()
    await expect(trigger).toBeEnabled()
    await trigger.click()
    const drawer = page.locator('#mobile-navigation')
    await expect(drawer).toBeVisible()
    const area = (await drawer.boundingBox())!
    expect(Math.abs(area.x + area.width - 390)).toBeLessThanOrEqual(1)
    await drawer.getByRole('link', { name: 'المشاريع', exact: true }).click()
    await expect(page).toHaveURL(/\/projects$/)
    await expect(drawer).toBeHidden()
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  })
})
```
Run the Storybook spec — Expected: FAIL (drawer width is the old `min(22rem, …)`, links below 44px).

- [ ] **Step 2: Drawer CSS**

In `apps/web/app/assets/css/components.css` replace the lines from `.webvue-mobile-menu-trigger { display: none; }` through `.webvue-mobile-menu-overlay { z-index: 65; }` (top of the file) with:

```css
.webvue-mobile-menu-trigger { display: none; }
/* The one mobile drawer (Tasmim spec §5): 320px at a 390px phone, from the inline-start side. */
.webvue-mobile-menu { width: min(320px, calc(100vw - 48px)); max-width: none; z-index: 70; }
.webvue-mobile-menu-overlay { z-index: 65; }
.webvue-mobile-section { display: grid; gap: 2px; }
.webvue-mobile-title { margin-block: 0 8px; font-size: .875rem; font-weight: 600; }
.webvue-mobile-menu .webvue-context-link { width: 100%; min-height: 44px; }
.webvue-mobile-menu .webvue-context-section-title { margin-block-start: 8px; }
```
and delete the old drawer rules that follow (`.webvue-mobile-menu .webvue-context-link, .webvue-mobile-menu .webvue-module-rail-link { width: 100%; }`, the `@media (max-width: 767px)` block's `.webvue-mobile-menu .webvue-context-link, .webvue-mobile-menu .webvue-module-rail-link { min-height: 44px; }` line — keep its `[data-slot="body"]` safe-area line — and the whole `/* The mobile list renders visible labels… */ .webvue-mobile-menu .webvue-module-rail-link [data-slot="label"] { … }` block). Then `rg -n "webvue-module-rail" apps/web/app/assets/css/components.css` prints nothing.

- [ ] **Step 3: Story**

Append to `apps/web/stories/fixtures/shell.ts`:

```ts
export const mobileDrawer = {
  modules: shellRail.all,
  activeId: 'projects',
  createLinks: projectsSidebar.createLinks,
  sections: projectsSidebar.sections,
}
```

`apps/web/stories/shell/MobileNavigation.stories.ts`:

```ts
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import MobileNavigation from '../../app/components/shell/MobileNavigation.vue'
import { mobileDrawer } from '../fixtures/shell'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shell/MobileNavigation',
  component: MobileNavigation,
  parameters: { layout: 'fullscreen' },
  args: { ...mobileDrawer, title: '' },
} satisfies Meta<typeof MobileNavigation>
export default meta
type Story = StoryObj<typeof meta>

export const Open: Story = {
  name: 'القائمة مفتوحة',
  parameters: storyContext('apps/web/app/components/shell/ShellHeader.vue:1'),
  render: args => ({
    components: { MobileNavigation },
    setup: () => ({ args, open: ref(true), t: useI18n().t }),
    template: '<div class="webvue-shell min-h-svh"><MobileNavigation v-bind="args" v-model:open="open" :title="t(\'nav.projects\')" /></div>',
  }),
}
```
Register `shell/MobileNavigation.vue` in `STORYBOOK_COMPONENTS`, add the story path in `components.md`; `VISUAL_STORIES` += `'shell-mobilenavigation--'`; `VISUAL_MOBILE_STORIES` += `'shell-mobilenavigation--open'`.

- [ ] **Step 4: Run and commit**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim
python3 -B tools/ui_policy.py --refresh-story-context && node tools/ui_catalog.mjs
npm -w apps/web run lint && npm test 2>&1 | tail -5 && python3 -B tools/ui_policy.py
cd apps/web && npm run build-storybook
npx playwright test e2e/storybook-shell.spec.ts e2e/storybook-smoke.spec.ts --reporter=line
npx playwright test e2e/storybook-visual.spec.ts -g 'shell-mobilenavigation' --update-snapshots=missing --reporter=line
```
Mock stack (Task 2 Step 8): `E2E_BASE_URL=http://localhost:4097 npx playwright test e2e/shell-tasmim.spec.ts e2e/shell-design.spec.ts e2e/internal-pages.spec.ts --reporter=line` — Expected: `shell-tasmim.spec.ts` passes; other failures only if listed in the baseline file.

```bash
cd ../.. && git add -A apps/web tools/ui_policy.py docs/design-system
git commit -m "feat(web): restyle the mobile drawer for the Tasmim shell

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Document the shell

**Files:**
- Modify: `DESIGN.md:51` (geometry paragraph), `DESIGN.md:109-145` (§3 «الغلاف والتنقل»)
- Modify: `docs/design-system/components.md:26-27` (shell and navigation rows), `docs/design-system/nuxt-ui-reference.md` (dashboard note)
- Regenerate: `docs/design-system/catalog.json`

**Interfaces:** documentation only.

- [ ] **Step 1: DESIGN.md (Arabic, the file's voice)**

Line 51 becomes:

> هندسة الغلاف (`shell.css`، خطة «تصميم» 2): هيدر محايد بارتفاع `48px`، شريط موديولات بعرض `64px` بالأزرق الليلي الثابت، قائمة سياقية بعرض `232px` (`48px` مطوية، و`400px` لِلوحة جانبية عريضة مثل المحادثات)، والمقاسات بالبكسل فلا تكبر مع حجم الخط. المحتوى: القوائم والجداول واللوحات بعرض كامل (`webvue-page-width-list`)، والتفاصيل `68rem` والنماذج `58rem`. نقطة الجوال `768px`؛ تحتها درج واحد بعرض `min(320px, 100vw − 48px)`.

Replace §3 bullets (lines 113–118) with:

> - هيدر ثابت `48px` محايد: علامة الجهة (شعارها واسمها، رابط للرئيسية)، مسار الصفحة (الموديول › القسم › عنوان الصفحة؛ آخر عنصر بلا رابط)، زر البحث مع `⌘K`، زر المظهر، الإشعارات، الحساب. على `/vendor/*` شارة «وحدة إدارة ويب فيو». مسار الصفحة يملكه `shell/ShellBreadcrumb.vue` وحده؛ لا تبني صفحة مسارًا خاصًا (`ui_policy`).
> - شريط الموديولات على بداية القراءة بعرض ثابت `64px`، أزرق ليلي في الوضعين ولا يتبع لون المؤسسة؛ في أعلاه علامة «ويب فيو» النصية. كل موديول أيقونة فوق تسمية صغيرة، والنشط طبقة بيضاء شفافة مع شريط ليموني على حافة بداية الشريط. لا توسيع للشريط. الإعدادات ووحدة التحكم في خانة الأدوات أسفله.
> - قائمة سياقية بجانب الشريط من `useShellModel()` و`sidebarModel()`: إجراءات الإنشاء المثبتة في رأسها، ثم الروابط، ويجوز تقسيمها إلى أقسام بعناوين صغيرة (`section` في رابط الـmanifest) وعدّادات صغيرة بجانب الرابط (`contextCounts`؛ تُجلب بعد الترطيب). تُطوى إلى أيقونات بزر أسفلها أو بالمفتاح `[` (بالمفتاح الفعلي، فيعمل على لوحة المفاتيح العربية، ولا يعمل أثناء الكتابة أو مع قائمة مفتوحة)، وتُحفظ الحالة في كوكي `webvue-context-sidebar` فيرسمها الخادم من أول إطار.
> - التطبيق يضيف إلى الغلاف عبر `app/modules/<app>/manifest.ts` فقط: `sidebarPanel` لمحتوى القائمة (المحادثات)، و`contextCounts` للعدّادات. الغلاف لا يستورد مكونات تطبيق (R3، يفحصه `arch_policy`).
> - الجوال تحت 768px: هيدر بعرض الشاشة وأزرار `44px`، و☰ يفتح درجًا واحدًا من جهة بداية القراءة فيه الموديولات ثم إجراءات الإنشاء والأقسام؛ يغلق بعد التنقل أو Escape، ولا يتجاوز حماية المسودة.
> - H1 واحد للصفحة داخل المحتوى؛ مسار الصفحة في الهيدر لا يكرره كسطر سياق فوق العنوان. صفحات التفاصيل/الإنشاء/التعديل تملك زر رجوع يحفظ الفلاتر و`hash`.
> - مؤشر التنقل النشط في القائمة: خط عمودي على بداية القراءة بلون المؤسسة؛ في الشريط: خط ليموني.
> - مكونات `UDashboard*` غير مستخدمة للغلاف: نقطة توقفها ثابتة على `1024px`، ولكل شريط جانبي درج جوال خاص، ولا طبقة هيدر تعلو القائمة السياقية (الأدلة في `docs/superpowers/plans/2026-10-11-tasmim-plan-2-shell.md`).

In «القائمة السياقية» (line ~136) keep the module lists; change the projects sentence «قائمة مسطحة بلا مجموعات» to «قائمة مسطحة بلا أقسام، مع عدّاد للمهام المفتوحة بجانب «مهامي»». In «المحادثات» replace «ثلاثة أعمدة على سطح المكتب. تحتفظ بعرضها الخاص.» with «لوحة المحادثات تأتي من `sidebarPanel` في manifest المحادثات، بعرض `400px` على سطح المكتب».

- [ ] **Step 2: Components and reference**

`docs/design-system/components.md` rows 26–27:

| الغلاف | `apps/web/app/components/shell/ShellFrame.vue` (قصة: `apps/web/stories/shell/ShellFrame.stories.ts`), `apps/web/app/components/shell/ShellHeader.vue` (قصة: `apps/web/stories/shell/ShellHeader.stories.ts`), `apps/web/app/components/shell/ShellBreadcrumb.vue` (قصة: `apps/web/stories/shell/ShellBreadcrumb.stories.ts`), `apps/web/app/components/shell/AppAccountMenu.vue` (قصة: `apps/web/stories/shell/AppAccountMenu.stories.ts`), `apps/web/app/components/shell/GlobalSearch.vue` (قصة: `apps/web/stories/shell/GlobalSearch.stories.ts`) | إطار ثلاثي الطبقات؛ هيدر 48px بمسار الصفحة والبحث والحساب؛ UBreadcrumb/UBadge |
| التنقل | `apps/web/app/components/shell/AppSidebar.vue` (قصة: `apps/web/stories/shell/AppSidebar.stories.ts`), `apps/web/app/components/shell/ModuleRail.vue` (قصة: `apps/web/stories/shell/ModuleRail.stories.ts`), `apps/web/app/components/shell/ContextSidebar.vue` (قصة: `apps/web/stories/shell/ContextSidebar.stories.ts`), `apps/web/app/components/shell/SidebarCreateAction.vue` (قصة: `apps/web/stories/shell/SidebarCreateAction.stories.ts`), `apps/web/app/components/shell/MobileNavigation.vue` (قصة: `apps/web/stories/shell/MobileNavigation.stories.ts`) | شريط 64px ثابت، قائمة 232px بأقسام وعدّادات و`[`، درج جوال واحد؛ USlideover/UButton/UTooltip |

Keep `AppearanceMenu.vue` on the settings row and add its story path there. In `docs/design-system/nuxt-ui-reference.md`, under its dashboard/layout components section (find with `rg -n -i "dashboard" docs/design-system/nuxt-ui-reference.md`; if none, append a short "الغلاف" paragraph), state that the shell is custom and why (the three reasons from DESIGN.md §3) and that the context-sidebar collapse uses the same cookie approach as `useResizable`.

- [ ] **Step 3: Check and commit**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim
node tools/ui_catalog.mjs && python3 -B tools/ui_policy.py && npm test 2>&1 | tail -3
rg -n "64px|76px|236px|1780px|breadcrumb\) في الـlayout" DESIGN.md
git add DESIGN.md docs/design-system
git commit -m "docs(web): document the Tasmim shell in DESIGN.md

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Expected: policy and tests pass; the `rg` prints only the new `64px` rail mentions (no `76px`, `236px`, `1780px`, and no "no breadcrumb" rule).

---

### Task 8: Checkpoint CP2 — baselines, full gates, e2e diff, owner shots

**Files:**
- Regenerate: `apps/web/e2e/storybook-visual.spec.ts-snapshots/*`
- Create (not committed): `.superpowers/tasmim-shared/cp2/*.png`, `.superpowers/tasmim-shared/e2e-cp2-failures.txt`

- [ ] **Step 1: Re-baseline the visual snapshots**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim/apps/web
npm run build-storybook
npx playwright test e2e/storybook-visual.spec.ts --reporter=line 2>&1 | tail -15   # expected: diffs only in shell-* and shell-adjacent stories
npx playwright test e2e/storybook-visual.spec.ts --update-snapshots --reporter=line
WEBVUE_REQUIRE_STORYBOOK=1 npx playwright test e2e/storybook-visual.spec.ts e2e/storybook-density.spec.ts e2e/storybook-smoke.spec.ts e2e/storybook-shell.spec.ts --reporter=line
```
Expected: the last run passes with no skipped describe. A diff outside `shell-`, `shared-brandwordmark-` and `shell-sidebarcreateaction-` is a regression to investigate before re-baselining — report it, do not re-baseline it blindly.

- [ ] **Step 2: Full gates**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim
npm test 2>&1 | tail -5
npm -w apps/web run lint
python3 -B tools/ui_policy.py && (cd tools && python3 -B -m unittest test_ui_policy -q)
python3 -B tools/arch_policy.py --base main && python3 -B tools/git_policy.py --base main
```
Expected: all exit 0.

- [ ] **Step 3: Mock e2e failing-title diff**

Start the mock stack as in Task 2 Step 8, then:

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim/apps/web
SCRATCH=$(mktemp -d)
FORCE_COLOR=0 E2E_BASE_URL=http://localhost:4097 E2E_PROJECT_POPUPS=1 npx playwright test --reporter=line > "$SCRATCH/cp2-e2e.log" 2>&1 || true
# The failing titles: the summary block between "N failed" and the next count line.
awk '/^ +[0-9]+ failed$/{f=1;next} f && /^ +[0-9]+ (flaky|passed|skipped|interrupted|did not run)/{f=0} f' "$SCRATCH/cp2-e2e.log" > ../../.superpowers/tasmim-shared/e2e-cp2-failures.txt
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
normalize < ../../.superpowers/tasmim-shared/e2e-baseline-failures.txt > "$SCRATCH/baseline.norm"
normalize < ../../.superpowers/tasmim-shared/e2e-cp2-failures.txt > "$SCRATCH/cp2.norm"
echo "NEW failures:"; comm -13 "$SCRATCH/baseline.norm" "$SCRATCH/cp2.norm"
echo "FIXED since baseline:"; comm -23 "$SCRATCH/baseline.norm" "$SCRATCH/cp2.norm"
```
Expected: `NEW failures:` is empty. Line numbers and reporter truncation are normalized away (titles cut at 90 characters; parameterized families that share a 90-character prefix collapse, so also compare the raw counts with `wc -l`). A new failure caused by the shell is fixed in the shell, not in the spec, unless the spec asserted the old 64/76/236 geometry, the rail expand control or the `html` theme attributes — those are updated in Task 3 Step 8 and must be listed in the CP2 note. Stop both background processes afterwards.

- [ ] **Step 4: CP2 image set**

With the mock stack still running, write `$SCRATCH/cp2-shots.cjs` and run it:

```js
const { createRequire } = require('node:module')
const { chromium } = createRequire('/Users/tariq/code/nasq/.worktrees/tasmim/apps/web/package.json')('@playwright/test')
const out = process.argv[2]
const base = 'http://localhost:4097'
;(async () => {
  const browser = await chromium.launch()
  for (const locale of ['ar', 'en']) for (const mode of ['light', 'dark']) for (const [width, height, tag] of [[1440, 900, 'desktop'], [390, 844, 'mobile']]) {
    const context = await browser.newContext({ viewport: { width, height }, locale: 'ar-SA', reducedMotion: 'reduce' })
    await context.addCookies([{ name: 'webvue-appearance', value: encodeURIComponent(JSON.stringify({ mode, fontSize: 'small' })), url: base }])
    const page = await context.newPage()
    await page.goto(`${base}/tasks`)
    await page.locator(tag === 'mobile' ? '[data-testid="mobile-navigation-trigger"]:not([disabled])' : '[data-testid="context-sidebar-toggle"]:not([disabled])').waitFor()
    if (locale === 'en') {
      await page.evaluate(async () => { await document.querySelector('#__nuxt').__vue_app__.$nuxt.$i18n.setLocale('en') })
      await page.locator('html[dir="ltr"]').waitFor()
    }
    await page.waitForLoadState('networkidle')
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: `${out}/shell-${locale}-${mode}-${tag}.png` })
    if (tag === 'mobile') {
      await page.getByTestId('mobile-navigation-trigger').click()
      await page.locator('#mobile-navigation').waitFor()
      await page.screenshot({ path: `${out}/shell-${locale}-${mode}-${tag}-drawer.png` })
    }
    await context.close()
  }
  await browser.close()
})()
```

```bash
mkdir -p ../../.superpowers/tasmim-shared/cp2
node "$SCRATCH/cp2-shots.cjs" /Users/tariq/code/nasq/.worktrees/tasmim/.superpowers/tasmim-shared/cp2
cp e2e/storybook-visual.spec.ts-snapshots/shell-shellframe--*.png ../../.superpowers/tasmim-shared/cp2/
ls ../../.superpowers/tasmim-shared/cp2 | wc -l
```
Expected: 12 app shots (ar/en × light/dark × desktop/mobile, plus 4 drawer shots) and the Storybook `shell-shellframe--*` set (desktop and mobile, both locales and modes). Stop both background processes.

- [ ] **Step 5: Commit the baselines**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim
git add apps/web/e2e/storybook-visual.spec.ts-snapshots
git commit -m "test(web): re-baseline visual snapshots on the Tasmim shell

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Present CP2 to the owner**

The orchestrator sends the `cp2/` shots with a short note: the geometry (48/64/232, 48 collapsed, 320 drawer), the removed rail-expand control, the full-width list pages, the PMO "my tasks" counter, the breadcrumb trail, and the `NEW failures` / `FIXED` lists. Decisions to confirm at CP2: (a) removing the rail expand state, (b) counters adopted only for «مهامي», (c) no module uses sections yet. Plan 3 does not start until the owner approves CP2.

---

## Spec coverage (phase 2)

| Spec | Task |
|---|---|
| §5 header 48px: breadcrumb, `⌘K` trigger, bell, account; console badge on `/vendor/*` | 3 (geometry), 5 |
| §5 rail 64px fixed midnight, icon + small label, lime bar; §3 rail never tenant-tinted; wordmark (§2) | 3 |
| §5 sidebar 232px, sections with counters, `[`, persisted | 3 (geometry), 4 |
| §5 content widths | 3 |
| §5 mobile 768px drawer, tables scroll inside their region | 3, 6 |
| §5 `UDashboard*` prototype vs custom | Decision section (no spike) |
| §6 contracts: `useHydrated`, testids, headings, no stacked dialogs | 2–6 (hydration tests in 4 and 6) |
| §7.3 `ContextSidebar` without `chat/ConversationList` | 2 |
| §7.4 drop `data-project-theme` / `data-workspace-theme` | 3 |
| §9 visual snapshots incl. mobile for shell; a11y on shell stories | 1, 3–6, 8 |
| §10 CP2 shots ar/en × light/dark | 8 |
| §13 Playwright selectors | Global Constraints; 3 Step 8 |

## Roadmap — next

**Plan 3 — Command palette and shortcuts** (spec §5, phase 3, CP3): rebuild `shell/GlobalSearch.vue` on `UCommandPalette` (Go to / Search / Actions) reusing `useAppSearch`; add the optional `commands` field to manifests with capability gating; move the shell's shortcuts — including this plan's `[` listener (`composables/nav/sidebarShortcut.ts`) and today's `⌘K` handler (`GlobalSearch.vue:26-31`, which matches `event.key` and so misses Arabic layouts) — onto one layout-independent layer, extending or wrapping `defineShortcuts` where Nuxt UI 4.11.1 cannot express a key; `?` help dialog; tooltips show shortcuts.
