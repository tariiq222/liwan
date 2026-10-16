# Phase 1 — Shared design layer `packages/ui` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Nasq's visual identity and presentational building blocks out of `apps/web` into a Nuxt layer `packages/ui`, so a second app (`apps/vendor-admin`, phase 3) can look identical without copying code, while `apps/web` stays visually and behaviourally unchanged.

**Architecture:** `packages/ui` is a Nuxt 4 layer (its own `nuxt.config.ts`, `app/` srcDir, `public/`, `i18n/`) that `apps/web` consumes with `extends`. A unit moves only if it is presentational: no API call, no `useMe`, no customer capability, no app-namespace i18n key. Moves are mechanical (`git mv`, import updates); no behaviour change. Before/after screenshots and the existing test suites prove the customer app did not change.

**Tech Stack:** Nuxt 4 layers, `@nuxt/ui` v4, `@nuxtjs/i18n`, Vitest, Storybook (`@storybook/vue3-vite`, custom config in `apps/web/.storybook`), Playwright on the isolated mock stack, Python policy tools in `tools/`.

**Spec:** [`docs/superpowers/specs/2026-10-15-nasq-vendor-admin-separation-design.md`](../specs/2026-10-15-nasq-vendor-admin-separation-design.md) — section "Shared design layer (`packages/ui`)". Master plan: [`2026-10-15-vendor-admin-separation-master.md`](2026-10-15-vendor-admin-separation-master.md).

## Global Constraints

- Branch `codex/web-ui-layer`, worktree `.worktrees/web-ui-layer` from current `main` (`npm run wt -- new web-ui-layer`). Run Node commands with Node 22 (`export PATH=/opt/homebrew/opt/node@22/bin:$PATH`).
- Commit subjects `type(web): imperative subject` (≤72 chars), one logical change per commit.
- `apps/web` must look and behave exactly as before: no visual diff on the baseline screenshot set, same `npm test` result, same `npm -w apps/web run lint` result, same mock e2e failing-title set as the pre-change baseline.
- `packages/ui` imports nothing from `apps/web`, `apps/vendor-admin`, `apps/control-plane` or `odoo-addons`. Files inside the layer use relative imports (`~`/`@` resolve to the consuming app, not the layer).
- No re-export shims left in `apps/web` for moved files; every importer is updated.
- Storybook stays in `apps/web` as the single catalog; stories stay under `apps/web/stories/**`.
- Nothing customer-specific, vendor-specific or Odoo-specific enters the layer.
- Never edit `tools/arch_baseline.json` by hand; tightening rules is allowed, weakening `tools/arch_layers.json` is not.

## Move list (fixed by reading every file on 2026-10-15; re-check imports before moving)

Moves to `packages/ui/app/` (same relative path under `app/`):

| Kind | Files |
|---|---|
| Styles and theme | `assets/css/{main,tokens,components,shell}.css`, `app.config.ts` |
| Fonts | `apps/web/public/fonts/*` → `packages/ui/public/fonts/` |
| Composables | `composables/useHydrated.ts`, `usePageHeader.ts`, `useEscapeBack.ts`, `useRowNavigation.ts`, `useNavigationFocus.ts`, `calendarDate.ts`, `composables/shortcuts/{keymap,rows}.ts` (+ their `__tests__`) |
| Utils | `utils/{errorState,statusTone,listView,dataTable,sectionTabs,workspacePresentation,formatDate}.ts`, `lib/debouncedFlush.ts` only if a moved file imports it (+ tests) |
| Feedback | all of `components/shared/feedback/*` |
| Data | `ChartPanel, FilterBar, FilterChip, FilterChoice, FilterField, MetricTile, Pagination, RecordNumber, RowActions, StatusBadge, ViewSwitch, DataTable` |
| Form | `DateField, FileField, InlineConfirm, UnsavedChanges, RichText` (RichText needs `utils/sanitize.ts` → moves too) |
| Layout | all of `components/shared/layout/*` |
| Shell | `components/shell/ShellFrame.vue`; `ModuleRail.vue` only if its `sidebarModel` import is type-only (move the `ShellRailItem` type into the layer); otherwise it stays and the spec's fallback is recorded |

Stays in `apps/web`: `PersonPicker`, `TagPicker`, `DescriptionEditor` (uses `tasks.*` keys), `CommentThread`, `CommentComposer`, `AttachmentList`, `Checklist`, `DashboardChart.client.vue`, `components/shared/commerce/*`, `InvoiceLines`, every other `components/shell/*` file, every `composables/nav/*` file, and anything else that fails the presentational rule.

i18n: the moved components read root keys `app.*`, `states.*`, `filterCard.*`, `errors.forbidden`, `errors.notFound`, `brand.name`. These subtrees move from `apps/web/i18n/locales/{ar,en}/common.json` into `packages/ui/i18n/locales/{ar,en}/ui.json` with identical key paths and values (only the keys the layer uses; keys still used only by `apps/web` stay).

## Review Focus

1. A moved file that `apps/web` imported by path (`@/components/shared/...`, `@/composables/useHydrated`) left a stale import that only fails at runtime in a lazy route → `npm -w apps/web run lint` (vue-tsc) and a production `nuxt build` must pass, not just unit tests. Task 3 and Task 6.
2. Auto-imported component names change (`SharedDataTable` must stay `SharedDataTable`) → the layer's `components` config reproduces the `Shared` prefix with `pathPrefix: false`; a test asserts a page still resolves them. Task 3.
3. RTL/dark-mode tokens or fonts silently missing after the move (CSS order or public path) → screenshot comparison ar/en × light/dark × 390/768/1440. Tasks 1 and 6.
4. Storybook can no longer render moved components (custom `.storybook` reads `apps/web` config only) → `storybook build` must succeed and `tools/ui_catalog.mjs --check` pass. Task 5.
5. A duplicated i18n key path between `common.json` and `ui.json` with different values → a test asserts no key path exists in both files. Task 4.

---

### Task 1: Baseline evidence before any move

**Files:**
- Create: `tools/ui_layer_baseline.mjs` (Playwright script, committed; used again in Task 6)
- No product files change.

**Interfaces:**
- Produces: `node tools/ui_layer_baseline.mjs --base-url <url> --out <dir>` writes PNGs named `<route-slug>__<lang>__<theme>__<width>.png` for the route list below, and `node tools/ui_layer_baseline.mjs --compare <dirA> <dirB>` exits 0 when every pair is pixel-identical (or within 0.1% differing pixels, reported per file), 1 otherwise.

- [ ] **Step 1: Start the isolated mock stack on free ports** (never :3000/:8069): from the worktree's `apps/web`, `PROJECTS_UI_PREVIEW=1 MODULE_UI_PREVIEW=1 MOCK_PORT=<mock> node e2e/internal-ui-audit-mock.mjs` and `NUXT_ODOO_URL=http://127.0.0.1:<mock> NUXT_ODOO_DB=nasq_ui_mock_only NUXT_PUBLIC_WS_URL=ws://127.0.0.1:<mock>/websocket npx nuxt dev --port <nuxt>`. Log in with the mock fixture user `admin`/`admin` in the script.
- [ ] **Step 2: Write the script.** Routes: `/projects/dashboard`, `/projects`, `/tasks`, `/my-tasks`, `/meetings`, `/hr`, `/operations`, `/settings`, `/subscription`, `/login` (logged out). For each: `lang` ar and en (switch through the app's language setting or the i18n cookie the app uses — read `apps/web/app` to find it), theme light and dark (the app's appearance mechanism, `useAppearance`), widths 390/768/1440, full-page screenshot after network idle, animations disabled (`reducedMotion: 'reduce'`). Comparison uses `pixelmatch` only if already in the lockfile; otherwise compare raw PNG bytes and report differing files (no new dependency).
- [ ] **Step 3: Capture** to `<worktree>/.superpowers/ui-baseline/before/` (git-ignored scratch). Also record: `npm test` summary, `npm -w apps/web run lint` result, and the mock e2e failing-title set (`E2E_BASE_URL=http://localhost:<nuxt> E2E_PROJECT_POPUPS=1 npx playwright test` from `apps/web`, titles of failures sorted) into `.superpowers/ui-baseline/before/results.txt`.
- [ ] **Step 4: Run the comparator against itself** (`--compare before before`) → exit 0.
- [ ] **Step 5: Commit** the script only: `test(web): add the ui layer screenshot baseline tool`.

---

### Task 2: Scaffold the layer and move identity (styles, theme, fonts)

**Files:**
- Create: `packages/ui/package.json`, `packages/ui/nuxt.config.ts`, `packages/ui/tsconfig.json`
- Move: `apps/web/app/assets/css/{main,tokens,components,shell}.css` → `packages/ui/app/assets/css/`; `apps/web/app/app.config.ts` → `packages/ui/app/app.config.ts`; `apps/web/public/fonts/*` → `packages/ui/public/fonts/`
- Modify: `apps/web/nuxt.config.ts` (`extends`, remove the moved `css` entry), `apps/web/package.json` (dependency `"@nasq/ui": "0.1.0"`), `tools/ui_policy.py` (paths at lines ~86-97, ~505-569), `tools/ui_inventory.py` if it lists these files
- Test: `tools/test_ui_policy.py` (existing, must stay green), new `packages/ui/test/layer.test.ts`

**Interfaces:**
- Produces: workspace package `@nasq/ui` (private, version `0.1.0`), consumed as `extends: ['@nasq/ui']` (or the relative path `'../../packages/ui'` if the package name does not resolve in Nuxt's layer loader — pick one, use it everywhere, say which in the report).

- [ ] **Step 1: Write the failing test** `packages/ui/test/layer.test.ts` (Vitest, Node environment): it reads `packages/ui/nuxt.config.ts` with `defineNuxtConfig` stubbed as identity and asserts `css` contains the absolute path of `app/assets/css/main.css`, that file exists, and `packages/ui/public/fonts/IBMPlexSansArabic-Regular.woff2` exists. Add `"test": "vitest run"` to `packages/ui/package.json` and run `npm -w packages/ui test` → FAIL.
- [ ] **Step 2: Create the layer**

```ts
// packages/ui/nuxt.config.ts
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const here = fileURLToPath(new URL('.', import.meta.url))

export default defineNuxtConfig({
  modules: ['@nuxt/ui'],
  css: [join(here, 'app/assets/css/main.css')],
  ui: { fonts: false, colorMode: false },
})
```

`git mv` the four CSS files, `app.config.ts` and the fonts. In `apps/web/nuxt.config.ts` add `extends: [<layer>]` and delete `css: ['~/assets/css/main.css']`; keep `ui: { fonts: false, colorMode: false }` only where Nuxt needs it once (if the layer's value merges, delete the app copy). Check `main.css` for relative `@import`/`url()` references and fix them so they resolve from the layer.

- [ ] **Step 3: Update policy tools.** In `tools/ui_policy.py` introduce `UI = 'packages/ui/app/'` and point the identity file checks (main/tokens/components/shell css, app.config.ts, and the retired-file list) at `UI`. Keep every rule; only paths change. Same for `tools/ui_inventory.py` if it references them.
- [ ] **Step 4: Verify** `npm -w packages/ui test`, `npm test`, `npm -w apps/web run lint`, and a production build `npm -w apps/web run build` all pass; restart the mock-stack Nuxt and run `node tools/ui_layer_baseline.mjs` into `.superpowers/ui-baseline/after-t2/` then `--compare before after-t2` → exit 0.
- [ ] **Step 5: Commit** `refactor(web): move the visual identity into the ui layer`.

---

### Task 3: Move presentational helpers and components

**Files:**
- Move (with their `__tests__`): the Composables, Utils, Feedback, Data, Form and Layout rows of the Move list → `packages/ui/app/...` same relative paths.
- Modify: `packages/ui/nuxt.config.ts` (components config), `apps/web/nuxt.config.ts` (drop the four `~/components/shared/*` entries that moved; keep entries for folders that still have files in `apps/web`), every importer in `apps/web` (find with `rg -l "components/shared/(feedback|data|form|layout)|composables/(useHydrated|usePageHeader|useEscapeBack|useRowNavigation|useNavigationFocus|calendarDate|shortcuts/(keymap|rows))|utils/(errorState|statusTone|listView|dataTable|sectionTabs|workspacePresentation|formatDate|sanitize)" apps/web`), `apps/web/stories/**` imports, `tools/ui_policy.py` `STORYBOOK_COMPONENTS` and other component paths, `tools/ui_inventory.py` (`CHART_OWNER` stays in web), `docs/design-system/catalog.json` (regenerate with `node tools/ui_catalog.mjs`), `docs/design-system/components.md` paths.
- Test: existing moved tests run from the layer; new `packages/ui/test/components.test.ts`

**Interfaces:**
- Produces: auto-imported names unchanged: `Shared<Name>` for every moved shared component (`SharedDataTable`, `SharedPageState`, `SharedListPage`, …); composables `useHydrated`, `usePageHeader`, `useEscapeBack`, `useRowNavigation`, `useNavigationFocus` auto-imported from the layer.

- [ ] **Step 1: Before moving, check each file's imports** against the presentational rule (no `$fetch`, `useMe`, `useApi`, `/api/`, `@nasq/contracts`, app-namespace i18n keys other than those listed in the i18n row). A file that fails stays in `apps/web`; list it in the report.
- [ ] **Step 2: Write the failing test** `packages/ui/test/components.test.ts`: it globs `packages/ui/app/**/*.{vue,ts}` (excluding tests) and asserts no file contains `from '@/`, `from '~/`, `apps/web`, `$fetch(`, `useMe(`, `/api/`; and that `packages/ui/nuxt.config.ts` registers `app/components/shared/{feedback,data,form,layout}` with `prefix: 'Shared'` and `pathPrefix: false`. Run → FAIL (files not moved yet).
- [ ] **Step 3: Move with `git mv`.** Inside moved files convert `@/…` imports to relative paths. Add to `packages/ui/nuxt.config.ts`:

```ts
  components: ['layout', 'data', 'form', 'feedback'].map((group) => ({
    path: join(here, `app/components/shared/${group}`), prefix: 'Shared', pathPrefix: false, ignore: ['**/__tests__/**'],
  })),
```

In `apps/web` update every importer found by the `rg` above to the new path (relative from the file to `packages/ui/app/...`, or an alias you add once in `apps/web/nuxt.config.ts` `alias: { '#ui': <layer>/app }` — choose one style and use it everywhere). Composables/utils that `apps/web` used through auto-import need no change.

- [ ] **Step 4: Update tooling and catalog** (`ui_policy.py` component paths → `packages/ui/app/components/...` where moved; `node tools/ui_catalog.mjs` to regenerate `catalog.json`; fix `components.md` paths).
- [ ] **Step 5: Verify** `npm -w packages/ui test` (now includes the moved unit tests — make `packages/ui` Vitest resolve Vue SFCs the same way `apps/web` does; copy the minimal Vitest config from `apps/web/vitest.config.ts` and any setup it relies on), `npm test`, `npm -w apps/web run lint`, `npm -w apps/web run build`, screenshot compare `before` vs `after-t3` → exit 0. Add `npm -w packages/ui run test` to the root `test` script right before `npm -w apps/web run test`.
- [ ] **Step 6: Commit** `refactor(web): move presentational components into the ui layer`.

---

### Task 4: Move the layer's i18n strings

**Files:**
- Create: `packages/ui/i18n/locales/{ar,en}/ui.json`
- Modify: `apps/web/i18n/locales/{ar,en}/common.json` (remove the moved subtrees), `packages/ui/nuxt.config.ts` (i18n layer config), `apps/web/i18n/localeFiles.ts` only if it must discover layer files, `apps/web/.storybook/main.ts` i18n plugin (load layer files too)
- Test: `packages/ui/test/i18n.test.ts`

**Interfaces:**
- Produces: every key the layer components use resolves in both locales from `ui.json`; `apps/web` sees the merged messages exactly as before.

- [ ] **Step 1: Find the exact keys** the moved files call: `rg -o "t\('[a-zA-Z.]+'" packages/ui/app | sort -u`. Only keys under `app.`, `states.`, `filterCard.`, `errors.`, `brand.` are allowed; any other namespace means a file was moved wrongly — move it back.
- [ ] **Step 2: Write the failing test** `i18n.test.ts`: for ar and en, every key used under `packages/ui/app` exists in `ui.json`; no dotted key path exists in both `ui.json` and `apps/web/.../common.json`; ar and en `ui.json` have identical key sets. Run → FAIL.
- [ ] **Step 3: Move the subtrees** (only keys the layer uses; if `apps/web` also uses a key, it still moves — the merged messages serve both). Register the layer locales the way `@nuxtjs/i18n` merges layer locale files (read the installed module's layer docs in `node_modules/@nuxtjs/i18n`); keep Arabic default and RTL settings in `apps/web`.
- [ ] **Step 4: Verify** tests, lint, build, screenshot compare `before` vs `after-t4` (Arabic and English text must be identical) → exit 0.
- [ ] **Step 5: Commit** `refactor(web): move shared component strings into the ui layer`.

---

### Task 5: Storybook and the shell template

**Files:**
- Modify: `apps/web/.storybook/main.ts` (and `nuxt-imports.mjs`, `preview.ts` if they read `apps/web` paths) so stories render components, composables, CSS, app config and fonts from the layer
- Move: `apps/web/app/components/shell/ShellFrame.vue` → `packages/ui/app/components/shell/ShellFrame.vue`; `ModuleRail.vue` + the `ShellRailItem` type only if the import is type-only (Move list rule)
- Modify: `packages/ui/nuxt.config.ts` (register `app/components/shell` with the same naming `apps/web` used for shell components), shell importers in `apps/web`
- Test: `npm -w apps/web run build-storybook` and `node tools/ui_catalog.mjs --check`

- [ ] **Step 1:** Run the Storybook build now → expect failure (components moved in Task 3). Record the error.
- [ ] **Step 2:** Teach the Storybook config about the layer: add the layer's component dirs, composables/utils dirs (auto-imports in `nuxt-imports.mjs`), `app.config.ts` path, CSS entry and `public/` (fonts). Keep stories where they are.
- [ ] **Step 3:** Move `ShellFrame` (and `ModuleRail` if allowed); update `apps/web` shell wiring imports. If `ModuleRail` stays, append to the report: "Fallback per spec: ModuleRail stays in apps/web; phase 3 builds its rail from ShellFrame and the moved components."
- [ ] **Step 4: Verify** Storybook build passes, `node tools/ui_catalog.mjs --check` passes, `npm test`, lint, build, screenshot compare `before` vs `after-t5` → exit 0.
- [ ] **Step 5: Commit** `refactor(web): render the ui layer in storybook and move the shell frame`.

---

### Task 6: Architecture rule, docs, and final proof

**Files:**
- Modify: `tools/arch_policy.py` (new check), `tools/test_arch_policy.py` or the existing arch policy tests, `tools/arch_layers.json` only to add `packages/ui` as a known shared UI package if the policy needs it (tightening only), `docs/design-system/README.md` and `components.md` (where components live now), `DESIGN.md` one line under the Storybook row: "Presentational building blocks live in `packages/ui` (Nuxt layer), shared by `apps/web` and `apps/vendor-admin`."
- Test: arch policy unit test

**Interfaces:**
- Produces: `python3 -B tools/arch_policy.py` fails when any file under `packages/ui/` imports from `apps/`, `odoo-addons/`, or uses `@/`/`~/` aliases.

- [ ] **Step 1: Write the failing policy test** with a temporary fixture file importing `apps/web/...` from `packages/ui` → policy reports a violation; with a clean tree → no violation.
- [ ] **Step 2: Implement the check** in `tools/arch_policy.py` following its existing rule style (read how R5 is checked and add the new check next to it under the same rule family or a new id `UI1`; it must not change the totals of existing rules).
- [ ] **Step 3: Final proof.** Restart the mock stack, capture `.superpowers/ui-baseline/after/`, `--compare before after` → exit 0; run `npm test`, `npm -w apps/web run lint`, `npm -w apps/web run build`, Storybook build, mock e2e (`E2E_PROJECT_POPUPS=1`) and diff the failing-title set against `before/results.txt` (must be identical or smaller), `python3 -B tools/git_policy.py --base main`, `python3 -B tools/arch_policy.py --base main`. Put all results in the report.
- [ ] **Step 4: Commit** `build(tools): forbid app imports in the ui layer` and `docs(web): point the design catalog at packages/ui` (two commits).

## After the last task

- Final whole-branch review; the reviewer gets the before/after comparison output and both results files.
- Do not merge; merging needs the owner's authorization and happens before phase 3 starts.
