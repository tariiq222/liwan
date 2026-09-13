# Storybook for Reused Building Blocks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Storybook in `apps/web` that renders the real design tokens, Nuxt UI recipes, and the 30 reused building-block components inside their real usage contexts, with one overview page, so editing component code updates Storybook and the app together. Components used only once are out of scope (user decision, spec §1).

**Architecture:** `@storybook/vue3-vite` without the Nuxt runtime. Auto-imports and component registrations are generated from `.nuxt/imports.d.ts` and `.nuxt/components.d.ts`; the Nuxt runtime APIs that app code calls are served by one shim module, and a scan fails the production build when app code calls an unshimmed API. The global decorator reuses the app's own `htmlAttrsFor` and `createBrandTheme`. `tools/ui_policy.py` forbids copies and enforces usage-context references and coverage.

**Tech Stack:** Storybook 10.6.0 (`storybook`, `@storybook/vue3-vite`, `@storybook/addon-docs`), `msw` 2.15.0 + `msw-storybook-addon` 3.0.0, `@vitejs/plugin-vue` 6.0.8, Nuxt 4.5.2, `@nuxt/ui` 4.11.1, vue-i18n, `@tanstack/vue-query`, Zod contracts from `@nasq/contracts`, Vitest, Playwright, Python `unittest`.

**Spec:** `docs/superpowers/specs/2026-09-13-storybook-foundation-design.md`

**Spike reference (read-only, do not merge):** branch `codex/storybook-spike-b`, commit `f164a58`, worktree `/Users/tariq/code/nasq-storybook-spike-b`.

## Global Constraints

- Work only in the worktree `/Users/tariq/code/nasq-storybook` (branch `codex/storybook`). Never touch `/Users/tariq/code/nasq`, ports 3000/8069, or the `odoo19` database. Do not push.
- Install with `npm ci --ignore-scripts` / `npm install --ignore-scripts`; never edit `~/.npmrc`.
- No `.vue` files under `apps/web/stories/` or `apps/web/.storybook/`. Stories import components from their real path under `apps/web/app/components/**`.
- Theme comes only from `apps/web/app/assets/css/main.css`, `apps/web/app/app.config.ts`, `apps/web/app/utils/brandTheme.ts`. Token lists are read from `tokens.css` and `getComputedStyle`, never hand-written.
- Fixture data for wire shapes is parsed through Zod schemas from `@nasq/contracts`. Fixtures are test data, never imported by `apps/web/app`.
- Every component story is wrapped in the real usage context it cites with `storyContext('<repo path>:<line>')`. A component with more than one distinct context gets one story per context, named after the context. An unused component uses `storyContext('unused')` and no wrapper. Token pages and Nuxt UI recipe galleries are exempt.
- Do not invent widths such as `max-w-xs`. Page-level context is `<main class="nasq-shell-main">` from `apps/web/app/layouts/default.vue:53`. A context that only exists below 768px (`md:hidden`) uses a 375px phone-width wrapper and says so. When a parent's geometry comes from scoped CSS, prefer another real context built from utility classes; if none exists, copy only the layout declarations inline and name the source.
- Storybook package versions are pinned exactly (no `^`).
- App behaviour must not change. The only app-code edits are the extractions in Task 1 (`htmlAttrsFor`) and Task 10 (`projectChartLabels`), each covered by a unit test.
- Scope is exactly the 30 components listed in spec §1 and in Task 11's `STORYBOOK_COMPONENTS`; do not add stories for components used once.
- Arabic (`ar`, rtl) is the default Storybook locale; logical Tailwind properties only (`ms-`, `me-`, `ps-`, `pe-`, `start-`, `end-`, `text-start`).
- Checks that must stay green after every task: `npm test` (repo root), `python3 -B tools/ui_policy.py`.

## File Structure

```
apps/web/
  app/utils/appearance.ts                       + htmlAttrsFor()                       (Task 1)
  app/app.vue                                   uses htmlAttrsFor()                    (Task 1)
  app/utils/projectChartData.ts                 + projectChartLabels()                 (Task 10)
  app/components/project/dashboard/ProjectDashboardCharts.vue  uses projectChartLabels() (Task 10)
  package.json                                  devDependencies + scripts              (Task 2)
  .storybook/
    main.ts               framework, aliases, i18n virtual module, Nuxt UI vite plugin, strict shim report (Task 2)
    nuxt-imports.mjs      generated auto-imports/components + runtime API usage report (Task 2)
    nuxt-shims.ts         Nuxt runtime API stand-ins                                  (Task 2)
    preview.ts            plugins, MSW, toolbar globals, document decorator            (Task 2)
    virtual.d.ts          types for virtual:nasq-i18n                                  (Task 2)
    tsconfig.json         type-check scope for .storybook + stories                    (Task 2)
    public/mockServiceWorker.js                                                        (Task 2)
  stories/
    support/context.ts    storyContext() helper                                        (Task 2)
    shared/RecordNumber.stories.ts                                                     (Task 2)
    foundations/tokens.ts, foundations/__tests__/tokens.test.ts, foundations/TokenTable.ts (Task 4)
    foundations/{Colors,Typography,Shape}.stories.ts                                   (Task 4)
    nuxt-ui/{Actions,Fields,Overlays,Surfaces}.stories.ts                              (Task 5)
    shared/{PageContainer,PageHeader,FormSection,PageState,EmptyState}.stories.ts, settings/SettingsLayout.stories.ts (Task 6)
    shared/{DateField,FileField,UnsavedChanges,FilterBar}.stories.ts, project/ProjectFieldHelp.stories.ts, task/DescriptionEditor.stories.ts (Task 7)
    project/ProjectStatusBadge, task/{StateBadge,DeadlineBadge}, access/AccessStateBadge, hr/AccessBadge, chat/ChatAttachment, shell/SidebarCreateAction (.stories.ts) (Task 8)
    fixtures/pmo.ts, fixtures/__tests__/pmo.test.ts, handlers/api.ts                   (Task 9)
    task/{PrioritySelect,StateMenu,TagPicker}, project/ProjectMenu, meetings/{MeetingProjectFilter,MeetingPeopleFields} (.stories.ts) (Task 9)
    fixtures/projectReports.ts, task/TaskCard, project/DashboardChartPanel, shared/DashboardChart, charts/ChartContainer (.stories.ts) (Task 10)
    Overview.mdx                                                                       (Task 11)
  e2e/storybook-smoke.spec.ts                                                          (Task 11)
tools/ui_policy.py, tools/test_ui_policy.py                                            (Tasks 2, 3, 11)
.gitignore                                                                             (Task 2)
DESIGN.md, docs/design-system/nuxt-ui-reference.md, docs/design-system/components.md   (Task 11)
```

---

### Task 1: Extract `htmlAttrsFor` so the app and Storybook share one `<html>` rule

**Files:**
- Modify: `apps/web/app/utils/appearance.ts`
- Modify: `apps/web/app/app.vue:7-17`
- Test: `apps/web/app/utils/__tests__/appearance.test.ts`

**Interfaces:**
- Produces: `htmlAttrsFor(input: HtmlAttrsInput): HtmlAttrs` and the types `HtmlAttrsInput = { mode: AppearanceMode; fontSize: FontSize; lang?: string; dir?: string }`, `HtmlAttrs = { class: '' | 'dark' | 'cream'; 'data-font-size': FontSize; lang?: string; dir?: string }` exported from `apps/web/app/utils/appearance.ts`. Task 2's decorator imports them.

- [ ] **Step 1: Prepare the worktree**

```bash
cd /Users/tariq/code/nasq-storybook
npm ci --ignore-scripts
npx -w apps/web nuxt prepare
```

Expected: install finishes; `apps/web/.nuxt/imports.d.ts` exists.

- [ ] **Step 2: Write the failing test** — append to `apps/web/app/utils/__tests__/appearance.test.ts` and change its import line to `import { htmlAttrsFor, normalizeAppearance } from '../appearance'`:

```ts
describe('document attributes for an appearance', () => {
  it.each([
    ['light', ''],
    ['dark', 'dark'],
    ['cream', 'cream'],
  ] as const)('maps %s mode to the html class %j', (mode, expected) => {
    expect(htmlAttrsFor({ mode, fontSize: 'small' }).class).toBe(expected)
  })

  it('carries font size, lang and dir through unchanged', () => {
    expect(htmlAttrsFor({ mode: 'dark', fontSize: 'large', lang: 'ar-SA', dir: 'rtl' })).toEqual({
      class: 'dark',
      'data-font-size': 'large',
      lang: 'ar-SA',
      dir: 'rtl',
    })
  })
})
```

- [ ] **Step 3: Run it and see it fail**

Run: `npx -w apps/web vitest run app/utils/__tests__/appearance.test.ts`
Expected: FAIL — `htmlAttrsFor` is not exported.

- [ ] **Step 4: Implement** — append to `apps/web/app/utils/appearance.ts`:

```ts
export interface HtmlAttrsInput {
  mode: AppearanceMode
  fontSize: FontSize
  lang?: string
  dir?: string
}

export interface HtmlAttrs {
  class: '' | 'dark' | 'cream'
  'data-font-size': FontSize
  lang?: string
  dir?: string
}

export function htmlAttrsFor({ mode, fontSize, lang, dir }: HtmlAttrsInput): HtmlAttrs {
  return {
    class: mode === 'dark' ? 'dark' : mode === 'cream' ? 'cream' : '',
    'data-font-size': fontSize,
    lang,
    dir,
  }
}
```

- [ ] **Step 5: Use it in `apps/web/app/app.vue`** — replace the `useHead` call (lines 11-18) with:

```ts
useHead(() => ({
  htmlAttrs: htmlAttrsFor({
    mode: mode.value,
    fontSize: fontSize.value,
    lang: i18nHead.value.htmlAttrs?.lang,
    dir: i18nHead.value.htmlAttrs?.dir,
  }),
}))
```

and add `import { htmlAttrsFor } from '@/utils/appearance'` below the `@nuxt/ui/locale` import. Keep the existing comment above `useLocaleHead`.

- [ ] **Step 6: Run tests and the type check**

Run: `npx -w apps/web vitest run app/utils/__tests__/appearance.test.ts && npx -w apps/web vue-tsc --noEmit`
Expected: PASS; no type errors.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/utils/appearance.ts apps/web/app/utils/__tests__/appearance.test.ts apps/web/app/app.vue
git commit -m "refactor(web): share the html appearance attributes as one function

Storybook's decorator needs the same class, font-size, lang and dir rule as
app.vue; one function keeps the two from drifting.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Storybook scaffold, reviewed tooling, and the first real story

**Files:**
- Modify: `apps/web/package.json` (scripts, devDependencies), `package-lock.json`
- Modify: `tools/ui_policy.py:166-168`, `tools/test_ui_policy.py`
- Modify: `.gitignore`
- Create: `apps/web/.storybook/main.ts`, `nuxt-imports.mjs`, `nuxt-shims.ts`, `preview.ts`, `virtual.d.ts`, `tsconfig.json`, `public/mockServiceWorker.js`
- Create: `apps/web/stories/support/context.ts`, `apps/web/stories/shared/RecordNumber.stories.ts`

**Interfaces:**
- Consumes: `htmlAttrsFor`, `AppearanceMode`, `FontSize` (Task 1); `createBrandTheme(input: string, mode?: AppearanceMode): Record<string, string>` and `DEFAULT_PRIMARY` from `apps/web/app/utils/brandTheme.ts`.
- Produces:
  - `storyContext(ref: string, note?: string): { nasqContext: string; docs: { description: { story: string } } }` from `apps/web/stories/support/context.ts`. Every later story uses it as `parameters: storyContext('…')` or `parameters: { ...storyContext('…'), … }`.
  - Storybook globals `locale: 'ar' | 'en'`, `appearance: 'light' | 'dark' | 'cream'`, `fontSize: 'small' | 'medium' | 'large'`, `primary: string` (URL form `globals=locale:en;appearance:dark`).
  - npm scripts `storybook` (dev, port 6006) and `build-storybook` (output `apps/web/storybook-static`).
  - `REVIEWED_STORYBOOK_TOOLING` set in `tools/ui_policy.py`.

- [ ] **Step 1: Write the failing policy tests** — add to `class UiPolicyTest` in `tools/test_ui_policy.py`:

```python
    STORYBOOK_TOOLING = ("storybook", "@storybook/vue3-vite", "@storybook/addon-docs", "msw", "msw-storybook-addon", "@vitejs/plugin-vue", "vite")

    def with_dev_dependencies(self, names):
        manifest = json.loads(self.current[MANIFEST])
        manifest["devDependencies"] = {name: "1.0.0" for name in names}
        return {MANIFEST: json.dumps(manifest)}

    def test_reviewed_storybook_tooling_passes(self):
        self.assertEqual(self.errors(self.with_dev_dependencies(self.STORYBOOK_TOOLING)), [])

    def test_unreviewed_storybook_addon_still_needs_review(self):
        self.assertEqual(
            self.errors(self.with_dev_dependencies(["@storybook/addon-a11y"])),
            ["dependency needs review: @storybook/addon-a11y"],
        )
```

- [ ] **Step 2: Run them and see the first fail**

Run: `cd tools && python3 -B -m unittest test_ui_policy.UiPolicyTest.test_reviewed_storybook_tooling_passes test_ui_policy.UiPolicyTest.test_unreviewed_storybook_addon_still_needs_review; cd ..`
Expected: `test_reviewed_storybook_tooling_passes` FAILS with `dependency needs review: …`.

- [ ] **Step 3: Allow the reviewed tooling** — in `tools/ui_policy.py` add below `RETIRED_PACKAGES`:

```python
# Storybook renders the real components for review; it is a dev-time viewer,
# not a second UI library, so it cannot become the drift this guard catches.
REVIEWED_STORYBOOK_TOOLING = {
    'storybook', '@storybook/vue3-vite', '@storybook/addon-docs',
    'msw', 'msw-storybook-addon', '@vitejs/plugin-vue', 'vite',
}
```

and change the `allowed = …` expression in `check()` to:

```python
    allowed = dependencies(baseline) | REVIEWED_STORYBOOK_TOOLING | {
        '@nuxt/ui', '@iconify-json/lucide', '@internationalized/date', '@nuxt/schema',
    }
```

Run: `python3 -B -m unittest discover -s tools -p test_ui_policy.py`
Expected: PASS (all tests).

- [ ] **Step 4: Install the pinned tooling**

```bash
npm install --ignore-scripts -w apps/web --save-dev --save-exact storybook@10.6.0 @storybook/vue3-vite@10.6.0 @storybook/addon-docs@10.6.0 msw@2.15.0 msw-storybook-addon@3.0.0 @vitejs/plugin-vue@6.0.8
npx -w apps/web msw init .storybook/public --no-save
```

Expected: `apps/web/package.json` devDependencies list the six packages without `^`; `apps/web/.storybook/public/mockServiceWorker.js` exists.

- [ ] **Step 5: Align Vite with the app build**

The app builds with Vite 8.2.2 (`node_modules/@nuxt/vite-builder/node_modules/vite`); the top-level `vite` is 7.3.6 (from vitest).

```bash
npm install --ignore-scripts -w apps/web --save-dev --save-exact vite@8.2.2
npm ls vite
npm -w apps/web run test
```

Expected: `npm ls vite` shows `vite@8.2.2` at the top level, and the web unit tests PASS. If the unit tests fail because of the Vite change, run `npm uninstall --ignore-scripts -w apps/web vite`, confirm the tests pass again, and write down in the Task 2 commit body: "Storybook stays on Vite 7.3.6; the app builds with 8.2.2" — Task 9 copies that line into the technical reference.

- [ ] **Step 6: Scripts and ignore rules** — in `apps/web/package.json` `scripts` add:

```json
    "storybook": "nuxt prepare && storybook dev -p 6006 --no-open",
    "build-storybook": "nuxt prepare && storybook build -o storybook-static"
```

Append to `.gitignore`:

```
# Storybook static build
apps/web/storybook-static/
```

- [ ] **Step 7: Bring over the generated-import module** — copy it from the spike, then make the scan ignore comments (the spike reported `createError` from a comment as a false positive):

```bash
git show f164a58:apps/web/.storybook/nuxt-imports.mjs > apps/web/.storybook/nuxt-imports.mjs
git show f164a58:apps/web/.storybook/nuxt-shims.ts > apps/web/.storybook/nuxt-shims.ts
```

In `apps/web/.storybook/nuxt-imports.mjs` replace

```js
  const texts = src.map(f => readFileSync(f, 'utf8'))
```

with

```js
  // Comments mention APIs without calling them; scan code only.
  const stripComments = text => text.replace(/<!--[\s\S]*?-->|\/\*[\s\S]*?\*\/|(^|[^:\\])\/\/[^\n]*/g, '$1')
  const texts = src.map(f => stripComments(readFileSync(f, 'utf8')))
```

- [ ] **Step 8: Write `apps/web/.storybook/main.ts`**

```ts
import type { StorybookConfig } from '@storybook/vue3-vite'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'
import { buildNuxtImports } from './nuxt-imports.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const webRoot = resolve(here, '..')

// nuxt.config.ts and app.config.ts are read as-is; their define* helpers are identity functions.
const configGlobals = globalThis as { defineNuxtConfig?: (c: unknown) => unknown; defineAppConfig?: (c: unknown) => unknown }
configGlobals.defineNuxtConfig ??= c => c
configGlobals.defineAppConfig ??= c => c

type LocaleConfig = { code: string; language: string; dir: 'rtl' | 'ltr'; files: string[] }

function i18nMessages(locales: LocaleConfig[]): Plugin {
  const id = 'virtual:nasq-i18n'
  return {
    name: 'nasq:i18n-messages',
    resolveId: source => (source === id ? `\0${id}` : undefined),
    load(source) {
      if (source !== `\0${id}`) return
      const imports: string[] = []
      const table: string[] = []
      locales.forEach((locale, li) => {
        const parts = locale.files.map((file, fi) => {
          const name = `m${li}_${fi}`
          imports.push(`import ${name} from ${JSON.stringify(join(webRoot, 'i18n/locales', file))}`)
          return name
        })
        table.push(`${JSON.stringify(locale.code)}: merge(${parts.join(', ')})`)
      })
      return `${imports.join('\n')}
function merge(...parts) { const out = {}; const deep = (t, s) => { for (const [k, v] of Object.entries(s)) { if (v && typeof v === 'object' && !Array.isArray(v)) deep(t[k] ??= {}, v); else t[k] = v } }; parts.forEach(p => deep(out, p)); return out }
export const locales = ${JSON.stringify(locales.map(({ code, language, dir }) => ({ code, language, dir })))}
export default { ${table.join(', ')} }`
    },
  }
}

const config: StorybookConfig = {
  stories: ['../stories/**/*.mdx', '../stories/**/*.stories.ts'],
  addons: ['@storybook/addon-docs', 'msw-storybook-addon'],
  framework: { name: '@storybook/vue3-vite', options: {} },
  staticDirs: ['../public', './public'],
  async viteFinal(viteConfig, { configType }) {
    const { mergeConfig } = await import('vite')
    const { default: nuxtConfig } = await import('../nuxt.config.ts') as { default: { ui: object; icon?: { clientBundle?: object }; i18n: { locales: LocaleConfig[] } } }
    const { default: appConfig } = await import('../app/app.config.ts') as { default: { ui: object } }
    const ui = (await import('@nuxt/ui/vite')).default
    const vue = (await import('@vitejs/plugin-vue')).default
    const { imports, components, report } = await buildNuxtImports()

    if (report.missing.length) {
      const message = `[nasq-storybook] app code calls Nuxt runtime APIs without a shim in .storybook/nuxt-shims.ts: ${report.missing.join(', ')}`
      if (configType === 'PRODUCTION') throw new Error(message)
      console.warn(message)
    }

    return mergeConfig(viteConfig, {
      resolve: { alias: { '~': join(webRoot, 'app'), '@': join(webRoot, 'app') } },
      define: { 'import.meta.server': 'false', 'import.meta.client': 'true', 'import.meta.dev': 'true' },
      plugins: [
        vue(),
        i18nMessages(nuxtConfig.i18n.locales),
        ui({
          ...nuxtConfig.ui,
          ui: appConfig.ui,
          icon: { clientBundle: nuxtConfig.icon?.clientBundle },
          dts: false,
          autoImport: { imports, dts: false, vueTemplate: true },
          components: {
            dts: false,
            dirs: [],
            resolvers: [(name: string) => (components as Record<string, { name: string; from: string }>)[name]],
          },
        }),
      ],
    })
  },
}

export default config
```

- [ ] **Step 9: Write `apps/web/.storybook/virtual.d.ts`**

```ts
declare module 'virtual:nasq-i18n' {
  export const locales: { code: string; language: string; dir: 'rtl' | 'ltr' }[]
  const messages: Record<string, Record<string, unknown>>
  export default messages
}
```

- [ ] **Step 10: Write `apps/web/.storybook/preview.ts`**

Keep the MSW loader import exactly as the spike proved it (`mswLoader` from `msw-storybook-addon/csf3`, called as `mswLoader()`).

```ts
import '../app/assets/css/main.css'
import type { Preview } from '@storybook/vue3-vite'
import { setup } from '@storybook/vue3-vite'
import { h } from 'vue'
import ui from '@nuxt/ui/vue-plugin'
import UApp from '@nuxt/ui/components/App.vue'
import { ar, en } from '@nuxt/ui/locale'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { mswLoader } from 'msw-storybook-addon/csf3'
import messages, { locales } from 'virtual:nasq-i18n'
import { useAppearance } from '../app/composables/useAppearance'
import { htmlAttrsFor, type AppearanceMode, type FontSize } from '../app/utils/appearance'
import { createBrandTheme, DEFAULT_PRIMARY } from '../app/utils/brandTheme'
import { __setRouter } from './nuxt-shims'

const i18n = createI18n({ legacy: false, locale: 'ar', fallbackLocale: 'ar', messages })
const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:path(.*)*', component: { render: () => null } }] })
__setRouter(router)
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 5_000 } } })
let brandKeys: string[] = []

setup((app) => {
  app.use(router)
  app.use(i18n)
  app.use(VueQueryPlugin, { queryClient })
  app.use(ui)
})

// Same attributes app.vue and useBranding put on <html>, applied once per render.
function applyDocument(locale: string, mode: AppearanceMode, fontSize: FontSize, primary: string) {
  const root = document.documentElement
  const current = locales.find(entry => entry.code === locale) ?? locales[0]!
  const attrs = htmlAttrsFor({ mode, fontSize, lang: current.language, dir: current.dir })
  root.classList.remove('dark', 'cream')
  if (attrs.class) root.classList.add(attrs.class)
  root.setAttribute('data-font-size', attrs['data-font-size'])
  if (attrs.lang) root.lang = attrs.lang
  if (attrs.dir) root.dir = attrs.dir
  brandKeys.forEach(key => root.style.removeProperty(key))
  const theme = createBrandTheme(primary, mode)
  brandKeys = Object.keys(theme)
  for (const [key, value] of Object.entries(theme)) root.style.setProperty(key, value)
}

const preview: Preview = {
  loaders: [mswLoader(), async () => { queryClient.clear(); return {} }],
  globalTypes: {
    locale: {
      description: 'Language and direction',
      toolbar: { title: 'Locale', icon: 'globe', dynamicTitle: true, items: [{ value: 'ar', title: 'العربية (rtl)' }, { value: 'en', title: 'English (ltr)' }] },
    },
    appearance: {
      description: 'Appearance mode',
      toolbar: { title: 'Appearance', icon: 'mirror', dynamicTitle: true, items: ['light', 'dark', 'cream'] },
    },
    fontSize: {
      description: 'Font size',
      toolbar: { title: 'Font size', icon: 'paragraph', dynamicTitle: true, items: ['small', 'medium', 'large'] },
    },
    primary: {
      description: 'Brand primary colour (createBrandTheme input)',
      toolbar: {
        title: 'Brand', icon: 'paintbrush', dynamicTitle: true,
        items: [
          { value: DEFAULT_PRIMARY, title: 'Default' },
          { value: '#2563eb', title: 'Blue' },
          { value: '#0f766e', title: 'Teal' },
          { value: '#b45309', title: 'Amber' },
        ],
      },
    },
  },
  initialGlobals: { locale: 'ar', appearance: 'light', fontSize: 'small', primary: DEFAULT_PRIMARY },
  decorators: [
    (story, context) => {
      const locale = context.globals.locale === 'en' ? 'en' : 'ar'
      const mode = (context.globals.appearance ?? 'light') as AppearanceMode
      const fontSize = (context.globals.fontSize ?? 'small') as FontSize
      const primary = String(context.globals.primary ?? DEFAULT_PRIMARY)
      return {
        setup() {
          // Write shared state only when it differs; writing on every render loops on docs pages.
          const appearance = useAppearance()
          if (appearance.mode.value !== mode) appearance.setMode(mode)
          if (appearance.fontSize.value !== fontSize) appearance.setFontSize(fontSize)
          if (i18n.global.locale.value !== locale) i18n.global.locale.value = locale
          applyDocument(locale, mode, fontSize, primary)
          return () => h(UApp, { locale: locale === 'en' ? en : ar }, () => h(story()))
        },
      }
    },
  ],
  parameters: { layout: 'padded', msw: { handlers: {} } },
}

export default preview
```

- [ ] **Step 11: Write `apps/web/.storybook/tsconfig.json`**

```json
{
  "extends": "../.nuxt/tsconfig.app.json",
  "compilerOptions": { "allowArbitraryExtensions": true, "noEmit": true },
  "include": ["./**/*.ts", "../stories/**/*.ts", "../.nuxt/nuxt.d.ts"]
}
```

- [ ] **Step 12: Write `apps/web/stories/support/context.ts`**

```ts
// Every component story cites the real parent it copies, so its size matches the app.
export function storyContext(ref: string, note?: string) {
  const source = ref === 'unused' ? 'غير مستخدم حاليًا' : `السياق: \`${ref}\``
  return { nasqContext: ref, docs: { description: { story: note ? `${note}\n\n${source}` : source } } }
}
```

- [ ] **Step 13: Write the first story `apps/web/stories/shared/RecordNumber.stories.ts`**

Contexts: table cell at `apps/web/app/pages/projects/[id]/stakeholders/index.vue:107` (inside `section.nasq-ui-record-surface > div.min-w-0.overflow-x-auto`), and the phone card at `…/stakeholders/index.vue:149` (`md:hidden`, so below 768px; the wrapper is a 375px phone width).

```ts
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import RecordNumber from '../../app/components/shared/RecordNumber.vue'
import { storyContext } from '../support/context'

const rows = [{ id: 1042, name: 'وزارة التخطيط' }, { id: 7, name: 'فريق الجودة' }]

const meta = {
  title: 'Shared/RecordNumber',
  component: RecordNumber,
  args: { value: 1042 },
} satisfies Meta<typeof RecordNumber>
export default meta
type Story = StoryObj<typeof meta>

export const InTableCell: Story = {
  name: 'داخل خلية جدول',
  parameters: storyContext('apps/web/app/pages/projects/[id]/stakeholders/index.vue:107'),
  render: () => ({
    components: { RecordNumber },
    setup() {
      const { t } = useI18n()
      const columns = computed(() => [{ accessorKey: 'id', header: '#' }, { accessorKey: 'name', header: t('projects.governance.stakeholders') }])
      return { rows, columns }
    },
    template: `<section class="nasq-ui-record-surface"><div class="min-w-0 overflow-x-auto"><UTable :data="rows" :columns="columns"><template #id-cell="{ row }"><RecordNumber :value="row.original.id" /></template></UTable></div></section>`,
  }),
}

export const InMobileCard: Story = {
  name: 'داخل بطاقة الجوال',
  parameters: storyContext('apps/web/app/pages/projects/[id]/stakeholders/index.vue:149', 'تظهر البطاقة تحت 768px (md:hidden)، فالغلاف بعرض شاشة جوال 375px.'),
  render: args => ({
    components: { RecordNumber },
    setup: () => ({ args }),
    template: `<ul class="grid gap-3 p-3" style="width: 375px"><li><UCard><div class="space-y-3"><div class="flex items-start justify-between gap-3"><div class="min-w-0 space-y-1"><RecordNumber v-bind="args" /><span class="block font-medium">وزارة التخطيط</span></div></div></div></UCard></li></ul>`,
  }),
}

export const EmptyValue: Story = { ...InMobileCard, name: 'بدون رقم', args: { value: null } }
```

- [ ] **Step 14: Build and type-check**

```bash
npm -w apps/web run build-storybook
npx -w apps/web vue-tsc --noEmit -p .storybook/tsconfig.json 2>&1 | grep -E '\.storybook/|stories/' || echo "no Storybook type errors"
```

Expected: build succeeds with no `[nasq-storybook] app code calls Nuxt runtime APIs without a shim` error; the grep prints `no Storybook type errors`. If a Storybook file has a type error, fix that file (not app code).

- [ ] **Step 15: See it in the browser**

Run `npm -w apps/web run storybook -- -p 6108` in the background, open `http://localhost:6108/?path=/story/shared-recordnumber--in-table-cell`, switch Locale to English and Appearance to dark, and take a screenshot. Expected: the number renders ltr inside the real table surface in both locales; no red errors in the browser console. Stop the server.

- [ ] **Step 16: Full checks and commit**

Run: `npm test` (repo root). Expected: PASS.

```bash
git add .gitignore package-lock.json apps/web/package.json apps/web/.storybook apps/web/stories tools/ui_policy.py tools/test_ui_policy.py
git commit -m "feat(web): add Storybook over the real components and theme

Generated Nuxt imports, one shim module whose coverage fails the build, and a
decorator that reuses the app's html and brand theme functions.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Policy rules — no copies, real usage contexts, coverage list

**Files:**
- Modify: `tools/ui_policy.py`
- Test: `tools/test_ui_policy.py`

**Interfaces:**
- Consumes: `storyContext('<file>:<line>' | 'unused')` literal form (Task 2).
- Produces: `story_errors(current) -> list[str]`, `story_warnings(current) -> list[str]`, and `STORYBOOK_COMPONENTS: tuple[str, ...] = ()` in `tools/ui_policy.py`. Task 11 fills it with the 30 component paths.

- [ ] **Step 1: Write the failing tests** — in `tools/test_ui_policy.py` change the import to `from ui_policy import check, main, story_errors, story_warnings`, add these constants below `RETIRED_RENDERER`:

```python
STORY = "apps/web/stories/shared/Example.stories.ts"
USAGE_PAGE = APP + "pages/example.vue"
```

and add to `class UiPolicyTest`:

```python
    def story(self, context="storyContext('apps/web/app/pages/example.vue:2')", target="../../app/components/shared/Example.vue"):
        return (
            "import Example from '" + target + "'\n"
            "import { storyContext } from '../support/context'\n"
            "export default { component: Example }\n"
            "export const InPage = { parameters: " + context + " }\n"
        )

    def story_snapshot(self, **changes):
        snapshot = {
            COMPONENT: "<template><p /></template>",
            USAGE_PAGE: "<template>\n  <SharedExample />\n</template>",
            STORY: self.story(),
        }
        snapshot.update(changes)
        return snapshot

    def test_story_with_real_context_passes(self):
        self.assertEqual(story_errors(self.story_snapshot()), [])

    def test_vue_file_in_stories_fails(self):
        errors = story_errors(self.story_snapshot(**{"apps/web/stories/shared/Copy.vue": "<template><p /></template>"}))
        self.assertEqual(errors, ["apps/web/stories/shared/Copy.vue: Storybook renders real components; no .vue files in stories"])

    def test_story_importing_component_outside_components_fails(self):
        errors = story_errors(self.story_snapshot(**{STORY: self.story(target="../../app/pages/example.vue")}))
        self.assertIn(STORY + ": stories import components only from apps/web/app/components", errors)

    def test_app_importing_story_fails(self):
        errors = story_errors(self.story_snapshot(**{PAGE: "<script setup>\nimport x from '../../stories/support/context'\n</script>"}))
        self.assertEqual(errors, [PAGE + ": app code must not import Storybook files"])

    def test_story_without_context_fails(self):
        errors = story_errors(self.story_snapshot(**{STORY: self.story(context="{}")}))
        self.assertEqual(errors, [STORY + ": story needs storyContext(<file:line> or unused)"])

    def test_context_that_does_not_use_component_fails(self):
        errors = story_errors(self.story_snapshot(**{USAGE_PAGE: "<template><p /></template>"}))
        self.assertEqual(errors, [f"{STORY}: storyContext apps/web/app/pages/example.vue:2 does not point at a real usage of {COMPONENT}"])

    def test_unused_context_passes(self):
        self.assertEqual(story_errors(self.story_snapshot(**{STORY: self.story(context="storyContext('unused')")})), [])

    def test_shifted_context_line_warns_without_failing(self):
        snapshot = self.story_snapshot(**{USAGE_PAGE: "<template>\n  <p />\n  <SharedExample />\n</template>"})
        self.assertEqual(story_errors(snapshot), [])
        self.assertEqual(story_warnings(snapshot), [f"{STORY}: update storyContext apps/web/app/pages/example.vue:2; that line no longer uses the component"])

    def test_coverage_requires_a_story_when_enabled(self):
        snapshot = self.story_snapshot()
        del snapshot[STORY]
        with patch("ui_policy.STORYBOOK_COMPONENTS", (COMPONENT,)):
            self.assertEqual(story_errors(snapshot), [COMPONENT + ": component needs a story"])
            self.assertEqual(story_errors(self.story_snapshot()), [])

    def test_coverage_list_entry_must_exist(self):
        missing = APP + "components/shared/Missing.vue"
        with patch("ui_policy.STORYBOOK_COMPONENTS", (missing,)):
            self.assertEqual(story_errors(self.story_snapshot()), [missing + ": listed Storybook component does not exist"])

    def test_check_reports_story_errors(self):
        changes = {"apps/web/stories/shared/Copy.vue": "<template><p /></template>"}
        self.assertIn("apps/web/stories/shared/Copy.vue: Storybook renders real components; no .vue files in stories", self.errors(changes))
```

- [ ] **Step 2: Run and see them fail**

Run: `python3 -B -m unittest discover -s tools -p test_ui_policy.py`
Expected: FAIL — `ImportError: cannot import name 'story_errors'`.

- [ ] **Step 3: Implement** — in `tools/ui_policy.py`:

Below `CATALOG = …` add:

```python
STORIES = 'apps/web/stories/'
STORYBOOK = 'apps/web/.storybook/'
STORY_ROOTS = (STORIES, STORYBOOK)
STORY_SUFFIXES = {'.vue', '.ts', '.mjs', '.mdx'}
COMPONENTS = APP + 'components/'
# Reused building blocks that must each be the meta component of a story (filled in Task 11).
STORYBOOK_COMPONENTS: tuple[str, ...] = ()
STORY_CONTEXT = re.compile(r'''\bstoryContext\(\s*(['"])([^'"]+)\1''')
META_COMPONENT = re.compile(r'\bcomponent:\s*(\w+)')
DEFAULT_VUE_IMPORT = re.compile(r'''^\s*import\s+(\w+)\s+from\s+(['"])([^'"]+\.vue)\2''', re.M)
```

Change `SCOPE` to:

```python
SCOPE = (*(root.rstrip('/') for root in SOURCE_ROOTS), *(root.rstrip('/') for root in STORY_ROOTS), *MANIFESTS, CATALOG)
```

Below `source_file` add:

```python
def story_file(path: str) -> bool:
    return (path.startswith(STORY_ROOTS) and Path(path).suffix in STORY_SUFFIXES
            and '/__tests__/' not in path and not re.search(r'\.(test|spec)\.', path))


def resolve_specifier(path: str, specifier: str) -> str | None:
    if specifier.startswith(('@/', '~/')):
        return APP + specifier[2:]
    if specifier.startswith('.'):
        return posixpath.normpath(posixpath.join(posixpath.dirname(path), specifier))
    return None


def component_names(component: str) -> set[str]:
    relative = component[len(COMPONENTS):]
    stem = relative.rsplit('/', 1)[-1].removesuffix('.vue').removesuffix('.client')
    prefix = ''.join(part[:1].upper() + part[1:] for part in relative.split('/')[:-1])
    return {stem, prefix + stem}


def mentions(text: str, names: set[str]) -> bool:
    return any(re.search(rf'(?<![\w-]){re.escape(name)}(?![\w-])', text) for name in names)


def story_component(path: str, source: str) -> str | None:
    meta = META_COMPONENT.search(source)
    if not meta:
        return None
    for match in DEFAULT_VUE_IMPORT.finditer(source):
        if match.group(1) == meta.group(1):
            return resolve_specifier(path, match.group(3))
    return None


def story_errors(current: dict[str, str]) -> list[str]:
    errors = []
    covered = set()
    for path, source in sorted(current.items()):
        if source_file(path) and path.startswith(APP):
            for match in IMPORTS.finditer(COMMENTS.sub('', source)):
                target = resolve_specifier(path, match.group(2))
                if target and target.startswith(('apps/web/stories', 'apps/web/.storybook')):
                    errors.append(path + ': app code must not import Storybook files')
                    break
        if not story_file(path):
            continue
        if path.endswith('.vue'):
            errors.append(path + ': Storybook renders real components; no .vue files in stories')
            continue
        for match in IMPORTS.finditer(source):
            target = resolve_specifier(path, match.group(2))
            if target and target.endswith('.vue') and not target.startswith(COMPONENTS):
                errors.append(path + ': stories import components only from apps/web/app/components')
                break
        component = story_component(path, source)
        if not component or not component.startswith(COMPONENTS):
            continue
        covered.add(component)
        refs = [match.group(2) for match in STORY_CONTEXT.finditer(source)]
        if not refs:
            errors.append(path + ': story needs storyContext(<file:line> or unused)')
        for ref in refs:
            if ref == 'unused':
                continue
            file, _, line = ref.rpartition(':')
            if not line.isdigit() or file not in current or not mentions(current[file], component_names(component)):
                errors.append(f'{path}: storyContext {ref} does not point at a real usage of {component}')
    for component in STORYBOOK_COMPONENTS:
        if component not in current:
            errors.append(component + ': listed Storybook component does not exist')
        elif component not in covered:
            errors.append(component + ': component needs a story')
    return errors


def story_warnings(current: dict[str, str]) -> list[str]:
    warnings = []
    for path, source in sorted(current.items()):
        if not story_file(path) or path.endswith('.vue'):
            continue
        component = story_component(path, source)
        if not component or not component.startswith(COMPONENTS):
            continue
        for match in STORY_CONTEXT.finditer(source):
            file, _, line = match.group(2).rpartition(':')
            if file not in current or not line.isdigit():
                continue
            lines = current[file].splitlines()
            number = int(line)
            if not 1 <= number <= len(lines) or not mentions(lines[number - 1], component_names(component)):
                warnings.append(f'{path}: update storyContext {match.group(2)}; that line no longer uses the component')
    return warnings
```

At the end of `check()` before `return errors` add `errors.extend(story_errors(current))`.

In `snapshot()` and `current_snapshot()` change both filters `source_file(…) or … in (*MANIFESTS, CATALOG)` to also accept `story_file(…)`:
- `snapshot()`: `and (source_file(entry.name) or story_file(entry.name) or entry.name in (*MANIFESTS, CATALOG))`
- `current_snapshot()`: `if not (source_file(path) or story_file(path) or path in (*MANIFESTS, CATALOG)):`

In `main()`, after `errors = check(current, baseline, head)` add `warnings = story_warnings(current)`, and before `if errors:` add:

```python
    for warning in warnings:
        sys.stdout.write('WARN: ' + warning + '\n')
```

(`warnings` must be assigned inside the `try` block next to `errors`.)

- [ ] **Step 4: Run tests and the real policy**

Run: `python3 -B -m unittest discover -s tools -p test_ui_policy.py && python3 -B tools/ui_policy.py`
Expected: all tests PASS; policy prints `PASS` (RecordNumber's two contexts are real usages; no warnings).

- [ ] **Step 5: Commit**

```bash
git add tools/ui_policy.py tools/test_ui_policy.py
git commit -m "feat(tools): gate Storybook stories on real components and usage contexts

The retired design-preview drifted because it copied components; the policy
now rejects copies, requires a cited real parent, and can require coverage.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Token foundations read from `tokens.css`

**Files:**
- Create: `apps/web/stories/foundations/tokens.ts`, `apps/web/stories/foundations/__tests__/tokens.test.ts`, `apps/web/stories/foundations/TokenTable.ts`
- Create: `apps/web/stories/foundations/Colors.stories.ts`, `Typography.stories.ts`, `Shape.stories.ts`

**Interfaces:**
- Consumes: globals from Task 2.
- Produces: `parseTokenNames(css: string): string[]`, `groupTokens(names: string[]): { prefix: string; names: string[] }[]`, `isColorToken(name: string): boolean`, component `TokenTable` (props `names: string[]`, `swatch?: 'color' | 'radius' | 'shadow' | 'none'`). Story exports used by Task 9: `Colors.Surfaces`, `Colors.Brand`, `Colors.Status`, `Colors.Shell`, `Typography.Scale`, `Shape.RadiusAndElevation`, `Shape.Layers`.

- [ ] **Step 1: Write the failing test** `apps/web/stories/foundations/__tests__/tokens.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { groupTokens, isColorToken, parseTokenNames } from '../tokens'

const css = `@theme { --text-xs: 0.85rem; }
:root {
  /* --commented-out: red; */
  --nasq-surface: #fff;
  --ui-bg: var(--nasq-surface);
  --nasq-radius: 14px;
}
.dark { --nasq-surface: #111; --status-danger: #f00; }`

describe('token names from tokens.css', () => {
  it('lists each declared custom property once, in source order, ignoring comments and usages', () => {
    expect(parseTokenNames(css)).toEqual(['--text-xs', '--nasq-surface', '--ui-bg', '--nasq-radius', '--status-danger'])
  })

  it('groups by the first name segment', () => {
    expect(groupTokens(parseTokenNames(css))).toEqual([
      { prefix: 'nasq', names: ['--nasq-surface', '--nasq-radius'] },
      { prefix: 'status', names: ['--status-danger'] },
      { prefix: 'text', names: ['--text-xs'] },
      { prefix: 'ui', names: ['--ui-bg'] },
    ])
  })

  it.each([
    ['--nasq-surface', true],
    ['--status-danger-soft', true],
    ['--nasq-radius', false],
    ['--elevation-2', false],
    ['--nasq-ui-z-menu', false],
    ['--text-xs', false],
    ['--font-sans', false],
    ['--shell-header-height', false],
  ])('%s is a colour token: %s', (name, expected) => {
    expect(isColorToken(name)).toBe(expected)
  })
})
```

- [ ] **Step 2: Run and see it fail**

Run: `npx -w apps/web vitest run stories/foundations/__tests__/tokens.test.ts`
Expected: FAIL — cannot resolve `../tokens`.

- [ ] **Step 3: Implement** `apps/web/stories/foundations/tokens.ts`

```ts
const DECLARATION = /(--[a-z0-9-]+)\s*:/gi
const NOT_COLOR = /(radius|width|height|size|shadow|elevation|-z-|^--text-|^--font|spacing|duration|ease|gap|offset|opacity)/

export function parseTokenNames(css: string): string[] {
  const code = css.replace(/\/\*[\s\S]*?\*\//g, '')
  return [...new Set([...code.matchAll(DECLARATION)].map(match => match[1]!))]
}

export function groupTokens(names: string[]): { prefix: string; names: string[] }[] {
  const groups = new Map<string, string[]>()
  for (const name of names) {
    const prefix = name.slice(2).split('-')[0]!
    groups.set(prefix, [...(groups.get(prefix) ?? []), name])
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([prefix, list]) => ({ prefix, names: list }))
}

export function isColorToken(name: string): boolean {
  return !NOT_COLOR.test(name)
}
```

Run: `npx -w apps/web vitest run stories/foundations/__tests__/tokens.test.ts`
Expected: PASS.

- [ ] **Step 4: Write `apps/web/stories/foundations/TokenTable.ts`**

```ts
import { defineComponent, h, nextTick, onMounted, ref, type PropType } from 'vue'

// Values are read from the live document, so the table follows the toolbar's mode and brand.
export const TokenTable = defineComponent({
  name: 'TokenTable',
  props: {
    names: { type: Array as PropType<string[]>, required: true },
    swatch: { type: String as PropType<'color' | 'radius' | 'shadow' | 'none'>, default: 'none' },
  },
  setup(props) {
    const values = ref<Record<string, string>>({})
    onMounted(async () => {
      await nextTick()
      requestAnimationFrame(() => {
        const style = getComputedStyle(document.documentElement)
        values.value = Object.fromEntries(props.names.map(name => [name, style.getPropertyValue(name).trim()]))
      })
    })
    const preview = (name: string) => {
      if (props.swatch === 'color') return h('span', { class: 'inline-block size-6 rounded border border-default', style: { background: `var(${name})` } })
      if (props.swatch === 'radius') return h('span', { class: 'inline-block size-8 border border-default bg-elevated', style: { borderRadius: `var(${name})` } })
      if (props.swatch === 'shadow') return h('span', { class: 'inline-block size-8 rounded bg-default', style: { boxShadow: `var(${name})` } })
      return null
    }
    return () => h('table', { class: 'w-full text-start text-sm' }, [
      h('tbody', props.names.map(name => h('tr', { key: name, class: 'border-t border-default' }, [
        h('td', { class: 'p-2' }, preview(name)),
        h('td', { class: 'p-2 font-mono text-xs', dir: 'ltr' }, name),
        h('td', { class: 'p-2 font-mono text-xs text-muted', dir: 'ltr' }, values.value[name] ?? ''),
      ]))),
    ])
  },
})
```

- [ ] **Step 5: Write `apps/web/stories/foundations/Colors.stories.ts`**

`key` includes the globals so a toolbar change re-reads computed values.

```ts
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import tokensCss from '../../app/assets/css/tokens.css?raw'
import { TokenTable } from './TokenTable'
import { groupTokens, isColorToken, parseTokenNames } from './tokens'

const groups = groupTokens(parseTokenNames(tokensCss))
const colorNames = (...prefixes: string[]) => groups
  .filter(group => prefixes.includes(group.prefix))
  .flatMap(group => group.names)
  .filter(isColorToken)

const table = (names: string[]): StoryObj => ({
  render: (_args, { globals }) => ({
    components: { TokenTable },
    setup: () => ({ names, key: JSON.stringify(globals) }),
    template: '<TokenTable :key="key" :names="names" swatch="color" />',
  }),
})

export default { title: 'Foundations/Colors' } satisfies Meta
export const Surfaces: StoryObj = { ...table(colorNames('nasq', 'ui', 'background', 'foreground', 'muted', 'popover', 'border', 'color')), name: 'الأسطح والنص والحدود' }
export const Brand: StoryObj = { ...table(colorNames('primary', 'chart')), name: 'لون الهوية والرسوم' }
export const Status: StoryObj = { ...table(colorNames('status')), name: 'الحالات' }
export const Shell: StoryObj = { ...table(colorNames('sidebar', 'shell', 'project', 'rail', 'context')), name: 'الغلاف' }
```

- [ ] **Step 6: Write `apps/web/stories/foundations/Typography.stories.ts`**

```ts
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import tokensCss from '../../app/assets/css/tokens.css?raw'
import { TokenTable } from './TokenTable'
import { parseTokenNames } from './tokens'

const sizes = parseTokenNames(tokensCss).filter(name => name.startsWith('--text-'))
const classes = ['text-xs', 'text-sm', 'text-base', 'text-lg', 'text-xl']

export default { title: 'Foundations/Typography' } satisfies Meta

export const Scale: StoryObj = {
  name: 'الخط والأحجام',
  render: (_args, { globals }) => ({
    components: { TokenTable },
    setup: () => ({ names: ['--font-sans', ...sizes], classes, key: JSON.stringify(globals) }),
    template: `<div class="space-y-6"><div class="space-y-3"><p v-for="size in classes" :key="size" :class="size" class="text-highlighted"><span class="font-mono text-xs text-muted" dir="ltr">{{ size }}</span> نَسَق لإدارة المشاريع — Nasq 0123</p></div><TokenTable :key="key" :names="names" /></div>`,
  }),
}
```

- [ ] **Step 7: Write `apps/web/stories/foundations/Shape.stories.ts`**

```ts
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import componentsCss from '../../app/assets/css/components.css?raw'
import tokensCss from '../../app/assets/css/tokens.css?raw'
import { TokenTable } from './TokenTable'
import { parseTokenNames } from './tokens'

const names = [...new Set([...parseTokenNames(tokensCss), ...parseTokenNames(componentsCss)])]
const radius = names.filter(name => name.includes('radius'))
const elevation = names.filter(name => name.startsWith('--elevation-'))
const layers = names.filter(name => name.includes('-z-'))
const elevationClasses = [1, 2, 3, 4].map(level => `nasq-elevation-${level}`)

export default { title: 'Foundations/Shape' } satisfies Meta

export const RadiusAndElevation: StoryObj = {
  name: 'الزوايا والظلال',
  render: (_args, { globals }) => ({
    components: { TokenTable },
    setup: () => ({ radius, elevation, elevationClasses, key: JSON.stringify(globals) }),
    template: `<div class="space-y-6"><div class="flex flex-wrap gap-6"><div v-for="level in elevationClasses" :key="level" :class="level" class="grid size-28 place-items-center rounded-[14px] bg-default text-xs"><span dir="ltr">{{ level }}</span></div></div><TokenTable :key="key + 'r'" :names="radius" swatch="radius" /><TokenTable :key="key + 'e'" :names="elevation" swatch="shadow" /></div>`,
  }),
}

export const Layers: StoryObj = {
  name: 'طبقات العرض',
  render: (_args, { globals }) => ({
    components: { TokenTable },
    setup: () => ({ layers, key: JSON.stringify(globals) }),
    template: '<TokenTable :key="key" :names="layers" />',
  }),
}
```

- [ ] **Step 8: Verify**

Run: `npm -w apps/web run build-storybook && python3 -B tools/ui_policy.py`
Expected: build succeeds; policy PASS. Then run `npm -w apps/web run storybook -- -p 6108`, open `Foundations/Colors → Brand`, switch Brand to Teal and Appearance to dark; screenshot. Expected: swatches and values change with the toolbar; `Surfaces`, `Status`, `Shell` each list at least one token (if a group is empty, adjust that story's prefix list to the prefixes `groupTokens` actually returns — print them with `console.log(groups.map(g => g.prefix))` once, then remove the log). Stop the server.

- [ ] **Step 9: Commit**

```bash
git add apps/web/stories/foundations
git commit -m "feat(web): show design tokens in Storybook from tokens.css itself

Token names are parsed from the stylesheet and values read from the live
document, so the pages follow mode and brand without a second list.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Nuxt UI recipe galleries from `app.config.ts`

**Files:**
- Create: `apps/web/stories/nuxt-ui/Actions.stories.ts`, `Fields.stories.ts`, `Overlays.stories.ts`, `Surfaces.stories.ts`

**Interfaces:**
- Consumes: Nuxt UI components registered globally by `@nuxt/ui/vue-plugin` (Task 2).
- Produces: story exports used by Task 9: `Actions.ButtonRanks`, `Actions.BadgesAndProgress`, `Fields.TextInputs`, `Fields.Selects`, `Fields.Calendar`, `Overlays.Menus`, `Overlays.Sheets`, `Surfaces.Card`, `Surfaces.Table`.

These galleries are exempt from the context rule (spec §6): they show the 16 recipes configured in `apps/web/app/app.config.ts` — button, badge, progress, input, inputNumber, textarea, select, selectMenu, calendar, dropdownMenu, tooltip, popover, slideover, modal, card, table.

- [ ] **Step 1: Write `apps/web/stories/nuxt-ui/Actions.stories.ts`**

```ts
import type { Meta, StoryObj } from '@storybook/vue3-vite'

export default {
  title: 'Nuxt UI/Actions',
  parameters: { docs: { description: { component: 'وصفات `button` و`badge` و`progress` من `apps/web/app/app.config.ts`. الرتب: أساسي واحد solid، محايد outline للإلغاء والرجوع، ghost ثالثي، error للحذف.' } } },
} satisfies Meta

export const ButtonRanks: StoryObj = {
  name: 'رتب الأزرار',
  render: () => ({
    template: `<div class="space-y-4">
      <div class="flex flex-wrap items-center gap-3">
        <UButton icon="i-lucide-plus">{{ $t('tasks.new') }}</UButton>
        <UButton color="neutral" variant="outline">{{ $t('app.cancel') }}</UButton>
        <UButton color="neutral" variant="ghost">{{ $t('app.back') }}</UButton>
        <UButton color="primary" variant="outline">{{ $t('app.save') }}</UButton>
        <UButton color="error" variant="ghost" square icon="i-lucide-trash-2" :aria-label="$t('filterCard.clear')" />
        <UButton color="neutral" variant="outline" square icon="i-lucide-list-filter" :aria-label="$t('filterCard.title')" />
      </div>
      <div class="flex flex-wrap items-center gap-3">
        <UButton disabled>{{ $t('app.save') }}</UButton>
        <UButton loading>{{ $t('app.save') }}</UButton>
        <UButton size="sm" color="secondary" variant="outline">{{ $t('app.retry') }}</UButton>
      </div>
    </div>`,
  }),
}

export const BadgesAndProgress: StoryObj = {
  name: 'الشارات والتقدم',
  render: () => ({
    template: `<div class="space-y-4">
      <div class="flex flex-wrap items-center gap-2">
        <UBadge>{{ $t('projects.status.on_track') }}</UBadge>
        <UBadge color="neutral" variant="subtle">{{ $t('projects.status.on_hold') }}</UBadge>
        <UBadge color="warning" variant="subtle">{{ $t('projects.status.at_risk') }}</UBadge>
        <UBadge color="error" variant="subtle">{{ $t('projects.status.off_track') }}</UBadge>
        <UBadge color="success" variant="subtle">{{ $t('projects.status.done') }}</UBadge>
        <UBadge color="secondary">3</UBadge>
      </div>
      <UProgress :model-value="45" />
      <UProgress :model-value="100" color="success" />
    </div>`,
  }),
}
```

- [ ] **Step 2: Write `apps/web/stories/nuxt-ui/Fields.stories.ts`**

```ts
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { ref } from 'vue'
import { ProjectStatusSchema } from '@nasq/contracts'

export default {
  title: 'Nuxt UI/Fields',
  parameters: { docs: { description: { component: 'وصفات `input` و`inputNumber` و`textarea` و`select` و`selectMenu` و`calendar` (فئة `nasq-ui-field`).' } } },
} satisfies Meta

export const TextInputs: StoryObj = {
  name: 'حقول النص',
  render: () => ({
    setup: () => ({ name: ref(''), count: ref(3), body: ref('') }),
    template: `<div class="nasq-form-grid">
      <UFormField :label="$t('meetingsUi.title')" name="name" required><UInput v-model="name" class="w-full" /></UFormField>
      <UFormField :label="$t('meetingsUi.title')" name="invalid" :error="$t('meetingsUx.errors.required')"><UInput class="w-full" aria-invalid="true" /></UFormField>
      <UFormField label="#" name="count"><UInputNumber v-model="count" class="w-full" /></UFormField>
      <UFormField :label="$t('projects.filters.search')" name="search"><UInput class="w-full" icon="i-lucide-search" disabled /></UFormField>
      <UFormField class="sm:col-span-2" :label="$t('meetingsUi.title')" name="body"><UTextarea v-model="body" class="w-full" :rows="3" /></UFormField>
    </div>`,
  }),
}

export const Selects: StoryObj = {
  name: 'القوائم المنسدلة',
  render: () => ({
    setup() {
      const items = ProjectStatusSchema.options
      return { items, status: ref('on_track'), statuses: ref<string[]>(['at_risk']) }
    },
    template: `<div class="nasq-form-grid">
      <UFormField :label="$t('projects.filters.allStatuses')" name="status"><USelect v-model="status" :items="items.map(value => ({ value, label: $t('projects.status.' + value) }))" class="w-full" /></UFormField>
      <UFormField :label="$t('projects.filters.allStatuses')" name="statuses"><USelectMenu v-model="statuses" multiple value-key="value" :items="items.map(value => ({ value, label: $t('projects.status.' + value) }))" class="w-full" /></UFormField>
    </div>`,
  }),
}

export const Calendar: StoryObj = {
  name: 'التقويم',
  render: () => ({ template: '<UCalendar class="w-fit" />' }),
}
```

- [ ] **Step 3: Write `apps/web/stories/nuxt-ui/Overlays.stories.ts`**

Overlays stay closed on load (an open modal would cover the docs page); open them by clicking.

```ts
import type { Meta, StoryObj } from '@storybook/vue3-vite'

export default {
  title: 'Nuxt UI/Overlays',
  parameters: { docs: { description: { component: 'وصفات `dropdownMenu` و`tooltip` و`popover` و`slideover` و`modal` وطبقاتها `--nasq-ui-z-menu` و`--nasq-ui-z-sheet`.' } } },
} satisfies Meta

export const Menus: StoryObj = {
  name: 'القوائم والتلميحات',
  render: () => ({
    template: `<div class="flex flex-wrap items-center gap-3">
      <UDropdownMenu :items="[{ label: $t('app.save') }, { label: $t('app.cancel') }, { label: $t('filterCard.clear'), color: 'error' }]">
        <UButton color="neutral" variant="outline" trailing-icon="i-lucide-chevron-down">{{ $t('filterCard.title') }}</UButton>
      </UDropdownMenu>
      <UTooltip :text="$t('app.back')"><UButton color="neutral" variant="ghost" square icon="i-lucide-info" :aria-label="$t('app.back')" /></UTooltip>
      <UPopover><UButton color="neutral" variant="outline">{{ $t('app.search') }}</UButton><template #content><div class="nasq-ui-filter-content"><UInput icon="i-lucide-search" class="w-full" /></div></template></UPopover>
    </div>`,
  }),
}

export const Sheets: StoryObj = {
  name: 'اللوحات والنوافذ',
  render: () => ({
    template: `<div class="flex flex-wrap items-center gap-3">
      <USlideover :title="$t('filterCard.title')"><UButton color="neutral" variant="outline">USlideover</UButton><template #body><p class="text-sm text-muted">{{ $t('app.noResults') }}</p></template></USlideover>
      <UModal :title="$t('app.unsavedChangesTitle')" :description="$t('app.unsavedChanges')"><UButton color="neutral" variant="outline">UModal</UButton><template #footer><div class="flex w-full justify-end gap-2"><UButton color="neutral" variant="outline">{{ $t('app.stay') }}</UButton><UButton>{{ $t('app.discardAndLeave') }}</UButton></div></template></UModal>
    </div>`,
  }),
}
```

- [ ] **Step 4: Write `apps/web/stories/nuxt-ui/Surfaces.stories.ts`**

```ts
import type { Meta, StoryObj } from '@storybook/vue3-vite'

export default {
  title: 'Nuxt UI/Surfaces',
  parameters: { docs: { description: { component: 'وصفات `card` (زاوية 14px و`nasq-elevation-1`) و`table` (`nasq-ui-table-head`).' } } },
} satisfies Meta

export const Card: StoryObj = {
  name: 'البطاقة',
  render: () => ({
    template: `<UCard>
      <template #header><h2 class="text-lg font-semibold text-highlighted">{{ $t('projects.dashboard.charts.statusTitle') }}</h2></template>
      <p class="text-sm text-muted">{{ $t('projects.dashboard.charts.noStatusData') }}</p>
      <template #footer><div class="flex justify-end gap-2"><UButton color="neutral" variant="outline">{{ $t('app.cancel') }}</UButton><UButton>{{ $t('app.save') }}</UButton></div></template>
    </UCard>`,
  }),
}

export const Table: StoryObj = {
  name: 'الجدول',
  render: () => ({
    setup: () => ({
      data: [{ id: 1, name: 'مشروع ألفا', status: 'on_track' }, { id: 2, name: 'تطوير البوابة', status: 'at_risk' }],
      columns: [{ accessorKey: 'id', header: '#' }, { accessorKey: 'name', header: 'Name' }, { accessorKey: 'status', header: 'Status' }],
    }),
    template: '<div class="nasq-ui-record-surface"><UTable :data="data" :columns="columns" /></div>',
  }),
}
```

- [ ] **Step 5: Verify**

Run: `npm -w apps/web run build-storybook && python3 -B tools/ui_policy.py`
Expected: build succeeds, policy PASS. In the dev server (`-p 6108`) open each gallery in ar/light and en/dark, open the dropdown, popover, slideover and modal once each; confirm no console errors. If a translation key renders as its raw key path, replace it with a key that exists in `apps/web/i18n/locales/ar/*.json` (search with `grep -rn '"<leaf>"' apps/web/i18n/locales/ar`). Screenshot `Actions → ButtonRanks`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/stories/nuxt-ui
git commit -m "feat(web): add Nuxt UI recipe galleries for the app.config recipes

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Page structure and state building blocks

**Files:**
- Create: `apps/web/stories/shared/PageContainer.stories.ts`, `PageHeader.stories.ts`, `FormSection.stories.ts`, `PageState.stories.ts`, `EmptyState.stories.ts`
- Create: `apps/web/stories/settings/SettingsLayout.stories.ts`

**Interfaces:**
- Consumes: `storyContext` (Task 2); real components `apps/web/app/components/shared/{PageContainer,PageHeader,FormSection,PageState,EmptyState}.vue`, `apps/web/app/components/settings/SettingsLayout.vue`.
- Produces (for Task 11): `PageContainer.List`, `PageHeader.WithActions`, `FormSection.InForm`, `FormSection.Panel`, `SettingsLayout.FormPage`, `PageState.ErrorState`, `PageState.Empty`, `EmptyState.InTaskTable`.

- [ ] **Step 1: Write `apps/web/stories/shared/PageContainer.stories.ts`**

```ts
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { useI18n } from 'vue-i18n'
import PageContainer from '../../app/components/shared/PageContainer.vue'
import PageHeader from '../../app/components/shared/PageHeader.vue'
import PageState from '../../app/components/shared/PageState.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/PageContainer',
  component: PageContainer,
  parameters: { layout: 'fullscreen' },
  argTypes: { width: { control: 'inline-radio', options: ['list', 'detail', 'form'] } },
} satisfies Meta<typeof PageContainer>
export default meta
type Story = StoryObj<typeof meta>

const page: Story['render'] = args => ({
  components: { PageContainer, PageHeader, PageState },
  setup: () => ({ args, t: useI18n().t }),
  template: `<main class="nasq-shell-main"><PageContainer v-bind="args"><PageHeader :title="t('tasks.title')" :description="t('tasks.description')" /><PageState :empty="true" /></PageContainer></main>`,
})

export const List: Story = { name: 'صفحة قائمة', args: { width: 'list' }, parameters: storyContext('apps/web/app/pages/tasks.vue:47', 'داخل `main.nasq-shell-main` من `apps/web/app/layouts/default.vue:53`.'), render: page }
export const Detail: Story = { name: 'صفحة تفاصيل', args: { width: 'detail' }, parameters: storyContext('apps/web/app/pages/meetings/[id]/print.vue:59'), render: page }
export const Form: Story = { name: 'صفحة نموذج', args: { width: 'form' }, parameters: storyContext('apps/web/app/pages/account.vue:9'), render: page }
```

- [ ] **Step 2: Write `apps/web/stories/shared/PageHeader.stories.ts`**

```ts
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { useI18n } from 'vue-i18n'
import PageContainer from '../../app/components/shared/PageContainer.vue'
import PageHeader from '../../app/components/shared/PageHeader.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/PageHeader',
  component: PageHeader,
  parameters: { layout: 'fullscreen' },
  args: { title: '' },
} satisfies Meta<typeof PageHeader>
export default meta
type Story = StoryObj<typeof meta>

export const WithActions: Story = {
  name: 'مع إجراءات الصفحة',
  parameters: storyContext('apps/web/app/pages/tasks.vue:48'),
  render: () => ({
    components: { PageContainer, PageHeader },
    setup: () => ({ t: useI18n().t }),
    template: `<main class="nasq-shell-main"><PageContainer width="list"><PageHeader :title="t('tasks.title')" :description="t('tasks.description')"><template #actions><UButton icon="i-lucide-plus">{{ t('tasks.new') }}</UButton><UButton color="neutral" variant="outline">{{ t('taskLifecycle.archivedTasks') }}</UButton></template></PageHeader></PageContainer></main>`,
  }),
}

export const WithBack: Story = {
  name: 'مع زر الرجوع',
  parameters: storyContext('apps/web/app/pages/search.vue:39'),
  render: () => ({
    components: { PageContainer, PageHeader },
    setup: () => ({ t: useI18n().t }),
    template: `<main class="nasq-shell-main"><PageContainer width="form"><PageHeader :title="t('app.search')" back-to="/tasks" /></PageContainer></main>`,
  }),
}

export const TitleAndDescription: Story = {
  name: 'عنوان ووصف',
  parameters: storyContext('apps/web/app/pages/account.vue:10'),
  render: () => ({
    components: { PageContainer, PageHeader },
    setup: () => ({ t: useI18n().t }),
    template: `<main class="nasq-shell-main"><PageContainer width="form"><PageHeader :title="t('account.title')" :description="t('account.description')" /></PageContainer></main>`,
  }),
}
```

- [ ] **Step 3: Write `apps/web/stories/shared/FormSection.stories.ts`**

```ts
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { useI18n } from 'vue-i18n'
import SettingsLayout from '../../app/components/settings/SettingsLayout.vue'
import FormSection from '../../app/components/shared/FormSection.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/FormSection',
  component: FormSection,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof FormSection>
export default meta
type Story = StoryObj<typeof meta>

export const InForm: Story = {
  name: 'قسم داخل نموذج',
  parameters: storyContext('apps/web/app/pages/settings/users/new.vue:113'),
  render: () => ({
    components: { SettingsLayout, FormSection },
    setup: () => ({ t: useI18n().t }),
    template: `<main class="nasq-shell-main"><SettingsLayout width="form"><UForm :state="{}" class="nasq-form"><FormSection :title="t('access.users.employee')" class="space-y-4"><UFormField :label="t('access.users.employee')" name="employee-search"><UInput class="w-full" icon="i-lucide-search" /></UFormField></FormSection></UForm></SettingsLayout></main>`,
  }),
}

export const Panel: Story = {
  name: 'لوحة إعدادات',
  parameters: storyContext('apps/web/app/components/settings/AppearanceForm.vue:12', 'داخل `div.nasq-settings-cards` من `apps/web/app/pages/settings/appearance.vue:11`.'),
  render: () => ({
    components: { SettingsLayout, FormSection },
    setup: () => ({ t: useI18n().t, modes: ['light', 'cream', 'dark'] }),
    template: `<main class="nasq-shell-main"><SettingsLayout width="form"><div class="nasq-settings-cards"><FormSection panel class="nasq-ui-record-surface" :title="t('settings.appearance.mode')" :description="t('settings.appearance.modeHint')"><URadioGroup model-value="light" variant="card" orientation="horizontal" indicator="hidden" :items="modes.map(value => ({ value, label: t('settings.appearance.' + value) }))" :ui="{ fieldset: 'grid grid-cols-1 sm:grid-cols-3' }" /></FormSection></div></SettingsLayout></main>`,
  }),
}
```

- [ ] **Step 4: Write `apps/web/stories/settings/SettingsLayout.stories.ts`**

```ts
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { useI18n } from 'vue-i18n'
import SettingsLayout from '../../app/components/settings/SettingsLayout.vue'
import PageHeader from '../../app/components/shared/PageHeader.vue'
import PageState from '../../app/components/shared/PageState.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Settings/SettingsLayout',
  component: SettingsLayout,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof SettingsLayout>
export default meta
type Story = StoryObj<typeof meta>

const layout = (width: 'list' | 'detail' | 'form', title: string): Story['render'] => () => ({
  components: { SettingsLayout, PageHeader, PageState },
  setup: () => ({ t: useI18n().t, width, title }),
  template: `<main class="nasq-shell-main"><SettingsLayout :width="width"><PageHeader :title="t(title)" /><PageState :empty="true" /></SettingsLayout></main>`,
})

export const FormPage: Story = { name: 'صفحة إعداد بنموذج', parameters: storyContext('apps/web/app/pages/settings/appearance.vue:9'), render: layout('form', 'settings.appearance.title') }
export const ListPage: Story = { name: 'صفحة إعداد بقائمة', parameters: storyContext('apps/web/app/pages/settings/access-log/index.vue:48'), render: layout('list', 'access.audit.title') }
export const DetailPage: Story = { name: 'صفحة إعداد بتفاصيل', parameters: storyContext('apps/web/app/pages/settings/access-log/[eventId].vue:20'), render: layout('detail', 'access.audit.title') }
```

If `access.audit.title` renders as a raw key, replace it in both stories with the title key used by `apps/web/app/pages/settings/access-log/index.vue` (`grep -n "PageHeader" apps/web/app/pages/settings/access-log/index.vue`).

- [ ] **Step 5: Write `apps/web/stories/shared/PageState.stories.ts`**

```ts
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import SettingsLayout from '../../app/components/settings/SettingsLayout.vue'
import PageState from '../../app/components/shared/PageState.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/PageState',
  component: PageState,
  parameters: { layout: 'fullscreen', ...storyContext('apps/web/app/pages/settings/access-log/index.vue:76') },
  args: { loading: false, empty: false, error: undefined, emptyText: undefined },
  render: args => ({
    components: { SettingsLayout, PageState },
    setup: () => ({ args }),
    template: `<main class="nasq-shell-main"><SettingsLayout width="list"><div id="results" class="nasq-settings-anchor"><PageState v-bind="args"><div class="nasq-ui-record-surface p-5 text-sm">{{ $t('app.noResults') }}</div></PageState></div></SettingsLayout></main>`,
  }),
} satisfies Meta<typeof PageState>
export default meta
type Story = StoryObj<typeof meta>

export const Loading: Story = { name: 'تحميل', args: { loading: true } }
export const ErrorState: Story = { name: 'خطأ عام', args: { error: { status: 500 } } }
export const Forbidden: Story = { name: 'غير مصرح', args: { error: { status: 403 } } }
export const NotFound: Story = { name: 'غير موجود', args: { error: { status: 404 } } }
export const Empty: Story = { name: 'فارغ', args: { empty: true } }
export const Content: Story = { name: 'المحتوى' }
```

- [ ] **Step 6: Write `apps/web/stories/shared/EmptyState.stories.ts`**

```ts
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import EmptyState from '../../app/components/shared/EmptyState.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/EmptyState',
  component: EmptyState,
  args: { title: '' },
} satisfies Meta<typeof EmptyState>
export default meta
type Story = StoryObj<typeof meta>

export const InTaskTable: Story = {
  name: 'داخل جدول المهام',
  parameters: storyContext('apps/web/app/components/task/TaskTable.vue:165'),
  render: () => ({
    components: { EmptyState },
    template: `<div class="space-y-2"><div class="nasq-ui-record-surface"><div class="overflow-x-auto"><EmptyState :title="$t('tasks.empty.title')"><template #action><UButton size="sm">{{ $t('tasks.empty.action') }}</UButton></template></EmptyState></div></div></div>`,
  }),
}

export const InTaskListMobile: Story = {
  name: 'داخل قائمة المهام على الجوال',
  parameters: storyContext('apps/web/app/components/task/TaskTable.vue:194', 'يظهر تحت 768px (md:hidden)، فالغلاف بعرض شاشة جوال 375px.'),
  render: () => ({
    components: { EmptyState },
    template: `<div class="nasq-ui-record-surface" style="width: 375px"><div class="divide-y divide-default"><div class="p-6 text-center"><EmptyState :title="$t('tasks.empty.closedTitle')" /></div></div></div>`,
  }),
}
```

- [ ] **Step 7: Verify**

Run: `npm -w apps/web run build-storybook && python3 -B tools/ui_policy.py`
Expected: build succeeds; policy PASS with no `WARN:` lines.

In the dev server (`npm -w apps/web run storybook -- -p 6108`): `PageHeader → WithBack` in ar and en — the back arrow points right in rtl and left in ltr (`ltr:rotate-180`); `PageContainer` stories cap at 100rem / 68rem / 58rem; `SettingsLayout` stories render the header and empty state at the three widths. Screenshot `PageState → ErrorState` in dark mode. Stop the server.

- [ ] **Step 8: Commit**

```bash
git add apps/web/stories/shared apps/web/stories/settings
git commit -m "feat(web): add page structure and state stories in their real parents

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Field, filter, help and editor building blocks

**Files:**
- Create: `apps/web/stories/shared/DateField.stories.ts`, `FileField.stories.ts`, `UnsavedChanges.stories.ts`, `FilterBar.stories.ts`
- Create: `apps/web/stories/project/ProjectFieldHelp.stories.ts`, `apps/web/stories/task/DescriptionEditor.stories.ts`

**Interfaces:**
- Consumes: `storyContext`; real components `DateField`, `FileField`, `UnsavedChanges`, `FilterBar`, `FormSection`, `PageContainer`, `SettingsLayout`, `project/ProjectFieldHelp`, `task/DescriptionEditor`; `ProjectStatusSchema` from `@nasq/contracts`.
- Produces (for Task 11): `DateField.InFormField`, `FileField.InMeetingAttachments`, `UnsavedChanges.CleanForm`, `FilterBar.InPageToolbar`, `ProjectFieldHelp.BesideFieldLabel`, `DescriptionEditor.WithContent`.

`shared/FilterCard` is not a building block (used only inside `FilterBar`), so it has no story; its look is covered by the `FilterBar` stories.

- [ ] **Step 1: Write `apps/web/stories/shared/DateField.stories.ts`**

```ts
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import DateField from '../../app/components/shared/DateField.vue'
import FilterBar from '../../app/components/shared/FilterBar.vue'
import FormSection from '../../app/components/shared/FormSection.vue'
import PageContainer from '../../app/components/shared/PageContainer.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/DateField',
  component: DateField,
  parameters: { layout: 'fullscreen' },
  args: { modelValue: null, disabled: false, minValue: null, maxValue: null },
} satisfies Meta<typeof DateField>
export default meta
type Story = StoryObj<typeof meta>

const inForm = (error?: string): Story['render'] => args => ({
  components: { DateField, FormSection, PageContainer },
  setup() {
    const { t } = useI18n()
    return { args, t, value: ref(args.modelValue), error: error ? t(error) : undefined }
  },
  template: `<main class="nasq-shell-main"><PageContainer width="form"><form class="space-y-8"><FormSection :title="t('meetingsUi.sectionSchedule')"><div class="nasq-form-grid"><UFormField :label="t('meetingsUi.date')" name="date" required :error="error"><DateField id="meeting-date" v-model="value" class="w-full" :disabled="args.disabled" :min-value="args.minValue" :max-value="args.maxValue" :aria-invalid="!!error" aria-required="true" /></UFormField></div></FormSection></form></PageContainer></main>`,
})

const formContext = storyContext('apps/web/app/pages/meetings/new.vue:149')

export const InFormField: Story = { name: 'داخل حقل نموذج', parameters: formContext, render: inForm() }
export const WithValue: Story = { name: 'بقيمة', parameters: formContext, args: { modelValue: '2026-09-13' }, render: inForm() }
export const Invalid: Story = { name: 'خطأ تحقق', parameters: formContext, render: inForm('meetingsUx.errors.required') }
export const Disabled: Story = { name: 'معطّل', parameters: formContext, args: { disabled: true }, render: inForm() }

export const InFilterPopover: Story = {
  name: 'داخل نافذة الفلاتر',
  parameters: storyContext('apps/web/app/pages/meetings/index.vue:247', 'نافذة الفلاتر مفتوحة عبر `default-open` في `FilterBar`.'),
  render: () => ({
    components: { DateField, FilterBar, PageContainer },
    setup: () => ({ t: useI18n().t, from: ref<string | null>(null) }),
    template: `<main class="nasq-shell-main"><PageContainer width="list"><FilterBar class="w-full" :default-open="true"><div class="grid min-w-0 content-start gap-1"><label for="meeting-date-from" class="text-sm font-medium text-highlighted">{{ t('meetingsFilters.fromDateLabel') }}</label><DateField id="meeting-date-from" v-model="from" class="w-full" /></div></FilterBar></PageContainer></main>`,
  }),
}
```

- [ ] **Step 2: Write `apps/web/stories/shared/FileField.stories.ts`**

```ts
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { useI18n } from 'vue-i18n'
import FileField from '../../app/components/shared/FileField.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/FileField',
  component: FileField,
  args: { disabled: false },
} satisfies Meta<typeof FileField>
export default meta
type Story = StoryObj<typeof meta>

export const InMeetingAttachments: Story = {
  name: 'داخل مرفقات الاجتماع',
  parameters: storyContext('apps/web/app/pages/meetings/[id].vue:621', 'الغلاف `.meeting-upload` مُعرَّف scoped في نفس الملف: grid، min-width: 0، gap: 8px.'),
  render: args => ({
    components: { FileField },
    setup: () => ({ args, t: useI18n().t }),
    template: `<div style="display: grid; min-width: 0; gap: 8px"><label for="meeting-attachment-upload" class="text-sm font-medium text-highlighted">{{ t('meetingsUi.uploadAttachment') }}</label><FileField id="meeting-attachment-upload" class="w-full" :disabled="args.disabled" /><p class="text-xs text-muted-foreground">{{ t('meetingsUi.attachmentHelp') }}</p></div>`,
  }),
}

export const InDocumentCard: Story = {
  name: 'داخل بطاقة مرفقات مستند',
  parameters: storyContext('apps/web/app/pages/hr/departments/[departmentId]/documents/[documentId]/edit.vue:96'),
  render: args => ({
    components: { FileField },
    setup: () => ({ args, t: useI18n().t }),
    template: `<UCard class="nasq-ui-record-surface" :ui="{ header: 'nasq-ui-card-header' }"><template #header><h2 class="text-lg font-semibold text-highlighted">{{ t('hr.docs.attachments') }}</h2></template><div class="space-y-3"><UFormField :label="t('hr.docs.upload')" name="hr-doc-upload"><FileField id="hr-doc-upload" class="w-full" :disabled="args.disabled" /></UFormField></div></UCard>`,
  }),
}

export const Disabled: Story = { ...InMeetingAttachments, name: 'معطّل', args: { disabled: true } }
```

- [ ] **Step 3: Write `apps/web/stories/shared/UnsavedChanges.stories.ts`**

The guard only works inside a routed view, so the story mounts the form as a route and navigates away with a button; the `play` step proves the real dialog opens.

```ts
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { defineComponent, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { expect, userEvent, within } from 'storybook/test'
import SettingsLayout from '../../app/components/settings/SettingsLayout.vue'
import FormSection from '../../app/components/shared/FormSection.vue'
import UnsavedChanges from '../../app/components/shared/UnsavedChanges.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/UnsavedChanges',
  component: UnsavedChanges,
  parameters: { layout: 'fullscreen' },
  args: { dirty: true },
} satisfies Meta<typeof UnsavedChanges>
export default meta
type Story = StoryObj<typeof meta>

export const GuardsLeavingDirtyForm: Story = {
  name: 'داخل نموذج عند مغادرة الصفحة',
  parameters: storyContext('apps/web/app/pages/settings/users/new.vue:112'),
  render: args => ({
    components: { SettingsLayout },
    setup() {
      const router = useRouter()
      const { t } = useI18n()
      const Form = defineComponent({
        components: { FormSection, UnsavedChanges },
        setup: () => ({ args, t }),
        template: `<UForm :state="{}" class="nasq-form"><UnsavedChanges :dirty="args.dirty" /><FormSection :title="t('access.users.employee')" class="space-y-4"><UFormField :label="t('access.users.employee')" name="employee-search"><UInput class="w-full" /></UFormField></FormSection></UForm>`,
      })
      if (router.hasRoute('story-unsaved-form')) router.removeRoute('story-unsaved-form')
      router.addRoute({ name: 'story-unsaved-form', path: '/__story/unsaved-form', component: Form })
      onMounted(() => router.push('/__story/unsaved-form'))
      return { t, leave: () => router.push('/__story/elsewhere') }
    },
    template: `<main class="nasq-shell-main"><SettingsLayout width="form"><RouterView /><div><UButton color="neutral" variant="outline" data-testid="leave" @click="leave">{{ t('app.back') }}</UButton></div></SettingsLayout></main>`,
  }),
  play: async ({ canvasElement, args }) => {
    const leave = await within(canvasElement).findByTestId('leave')
    await userEvent.click(leave)
    if (args.dirty) await expect(await within(document.body).findByTestId('unsaved-changes-dialog')).toBeVisible()
  },
}

export const CleanForm: Story = { ...GuardsLeavingDirtyForm, name: 'نموذج بلا تعديلات', args: { dirty: false } }
```

- [ ] **Step 4: Write `apps/web/stories/shared/FilterBar.stories.ts`**

The `inline` variant is not used by any page today (`TaskToolbar` passes `inline` only when `embedded && !collapsible`, and both usages are collapsible), so it gets no story.

```ts
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { fn } from 'storybook/test'
import { ProjectStatusSchema } from '@nasq/contracts'
import FilterBar from '../../app/components/shared/FilterBar.vue'
import PageContainer from '../../app/components/shared/PageContainer.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/FilterBar',
  component: FilterBar,
  parameters: { layout: 'fullscreen', ...storyContext('apps/web/app/pages/projects/index.vue:214') },
  args: { activeCount: 0, disabled: false, defaultOpen: false, onClear: fn() },
  render: args => ({
    components: { FilterBar, PageContainer },
    setup() {
      const { t } = useI18n()
      const status = ref('all')
      const items = computed(() => [{ value: 'all', label: t('projects.filters.allStatuses') }, ...ProjectStatusSchema.options.map(value => ({ value, label: t(`projects.status.${value}`) }))])
      return { args, t, status, items, search: ref('') }
    },
    template: `<main class="nasq-shell-main"><PageContainer width="list"><div class="w-full min-w-0" data-testid="projects-toolbar"><FilterBar class="w-full" v-bind="args"><template #search><UInput v-model="search" :placeholder="t('projects.filters.search')" :aria-label="t('projects.filters.search')" icon="i-lucide-search" class="w-full min-w-52" /></template><template #default><USelect v-model="status" :items="items" class="w-40" /></template><template #active><UBadge color="neutral" variant="subtle">{{ t('projects.status.at_risk') }}</UBadge></template></FilterBar></div></PageContainer></main>`,
  }),
} satisfies Meta<typeof FilterBar>
export default meta
type Story = StoryObj<typeof meta>

export const InPageToolbar: Story = { name: 'شريط أدوات صفحة' }
export const WithActiveFilters: Story = { name: 'مع فلاتر نشطة', args: { activeCount: 2 } }
export const FiltersOpen: Story = { name: 'نافذة الفلاتر مفتوحة', args: { defaultOpen: true } }
export const Disabled: Story = { name: 'معطّل', args: { disabled: true, activeCount: 1 } }
```

- [ ] **Step 5: Write `apps/web/stories/project/ProjectFieldHelp.stories.ts`**

```ts
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { useI18n } from 'vue-i18n'
import ProjectFieldHelp from '../../app/components/project/ProjectFieldHelp.vue'
import PageContainer from '../../app/components/shared/PageContainer.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Project/ProjectFieldHelp',
  component: ProjectFieldHelp,
  parameters: { layout: 'fullscreen' },
  args: { label: '', text: '' },
} satisfies Meta<typeof ProjectFieldHelp>
export default meta
type Story = StoryObj<typeof meta>

export const BesideFieldLabel: Story = {
  name: 'بجانب عنوان الحقل',
  parameters: storyContext('apps/web/app/components/project/ProjectCharterFields.vue:167', 'اضغط أيقونة ⓘ لفتح التلميح.'),
  render: args => ({
    components: { ProjectFieldHelp, PageContainer },
    setup() {
      const { t } = useI18n()
      return { t, label: args.label || t('projects.charter.fields.name'), text: args.text || t('projects.charter.help.name') }
    },
    template: `<main class="nasq-shell-main"><PageContainer width="form"><div class="grid gap-6"><div class="grid gap-2"><div class="flex items-center gap-1"><label for="charter-name" class="flex items-center gap-2 text-sm font-medium leading-none">{{ t('projects.charter.fields.name') }}</label><ProjectFieldHelp :label="label" :text="text" /></div><UInput id="charter-name" class="w-full" /></div></div></PageContainer></main>`,
  }),
}
```

- [ ] **Step 6: Write `apps/web/stories/task/DescriptionEditor.stories.ts`**

```ts
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { useI18n } from 'vue-i18n'
import { fn } from 'storybook/test'
import DescriptionEditor from '../../app/components/task/DescriptionEditor.vue'
import FormSection from '../../app/components/shared/FormSection.vue'
import PageContainer from '../../app/components/shared/PageContainer.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Task/DescriptionEditor',
  component: DescriptionEditor,
  parameters: { layout: 'fullscreen' },
  args: { modelValue: '', taskId: 0, readonly: false, onDraft: fn(), 'onUpdate:modelValue': fn() },
  render: args => ({
    components: { DescriptionEditor, FormSection, PageContainer },
    setup: () => ({ args, t: useI18n().t }),
    template: `<main class="nasq-shell-main"><PageContainer width="form"><form class="space-y-8"><FormSection :title="t('meetingsUi.agenda')"><DescriptionEditor v-bind="args" :aria-label="t('meetingsUx.agendaLabel')" /></FormSection></form></PageContainer></main>`,
  }),
} satisfies Meta<typeof DescriptionEditor>
export default meta
type Story = StoryObj<typeof meta>

export const InFormSection: Story = { name: 'داخل قسم نموذج', parameters: storyContext('apps/web/app/pages/meetings/new.vue:173') }
export const WithContent: Story = {
  name: 'بمحتوى منسق',
  parameters: storyContext('apps/web/app/pages/meetings/new.vue:173'),
  args: { modelValue: '<p>جدول أعمال <strong>الاجتماع الشهري</strong></p><ul><li>مراجعة المخاطر</li><li>اعتماد الميزانية</li></ul><p><a href="https://example.com">رابط المرجع</a></p>' },
}
export const Readonly: Story = {
  name: 'للقراءة فقط',
  parameters: storyContext('apps/web/app/pages/meetings/[id]/minutes.vue:116'),
  args: { readonly: true, modelValue: '<p>محضر معتمد لا يمكن تعديله.</p>' },
}
```

- [ ] **Step 7: Verify**

Run: `npm -w apps/web run build-storybook && python3 -B tools/ui_policy.py`
Expected: build succeeds; policy PASS, no `WARN:` lines.

In the dev server (`-p 6108`):
1. `DateField → InFormField` in ar: label «اختر التاريخ», enabled after mount, calendar opens, field fills its grid column. Switch to dark and look at the calendar's weekday header. If the weekday names are unreadable, compare against the running app on the isolated mock stack (`apps/web/e2e/internal-ui-audit-mock.mjs`) at `/meetings/new` in dark mode, and record the result for Task 11's report. Do not change calendar styles in this plan.
2. `UnsavedChanges → GuardsLeavingDirtyForm`: the Interactions panel is green; the dialog shows «البقاء» and «تجاهل والمغادرة».
3. `DescriptionEditor → WithContent`: toolbar buttons toggle bold/list; `Readonly` shows no toolbar.
4. `ProjectFieldHelp → BesideFieldLabel`: clicking ⓘ opens the tooltip text.
Screenshot items 1 and 3.

- [ ] **Step 8: Commit**

```bash
git add apps/web/stories/shared apps/web/stories/project apps/web/stories/task
git commit -m "feat(web): add field, filter, help and editor stories in their real parents

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Badges, attachment link and sidebar create action

**Files:**
- Create: `apps/web/stories/project/ProjectStatusBadge.stories.ts`, `apps/web/stories/task/StateBadge.stories.ts`, `apps/web/stories/task/DeadlineBadge.stories.ts`, `apps/web/stories/access/AccessStateBadge.stories.ts`, `apps/web/stories/hr/AccessBadge.stories.ts`, `apps/web/stories/chat/ChatAttachment.stories.ts`, `apps/web/stories/shell/SidebarCreateAction.stories.ts`

**Interfaces:**
- Consumes: `storyContext`; `ProjectStatusSchema`, `TaskStateSchema`, `HrEmployeeAccessSchema`, `ChatAttachmentSchema` from `@nasq/contracts`.
- Produces (for Task 11): `ProjectStatusBadge.InOverviewRow`, `StateBadge.AllStates`, `DeadlineBadge.AllDeadlines`, `AccessStateBadge.InMobileCard`, `AccessBadge.AllAccess`, `ChatAttachment.InConversationInfo`, `SidebarCreateAction.InContextSidebar`.

None of these call the API.

- [ ] **Step 1: Write `apps/web/stories/project/ProjectStatusBadge.stories.ts`**

```ts
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { ProjectStatusSchema } from '@nasq/contracts'
import ProjectStatusBadge from '../../app/components/project/ProjectStatusBadge.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Project/ProjectStatusBadge',
  component: ProjectStatusBadge,
  args: { status: 'on_track' },
  argTypes: { status: { control: 'select', options: [...ProjectStatusSchema.options, null] } },
} satisfies Meta<typeof ProjectStatusBadge>
export default meta
type Story = StoryObj<typeof meta>

export const InOverviewRow: Story = {
  name: 'في سطر ملخص المشروع',
  parameters: storyContext('apps/web/app/components/project/ProjectOverview.vue:50'),
  render: args => ({
    components: { ProjectStatusBadge },
    setup: () => ({ args, statuses: [...ProjectStatusSchema.options, null] }),
    template: `<div class="space-y-3"><div class="flex flex-wrap items-center gap-3 text-sm"><ProjectStatusBadge v-bind="args" /><span class="text-muted">2026-09-01 — 2026-12-31</span></div><div class="flex flex-wrap items-center gap-3 text-sm"><ProjectStatusBadge v-for="status in statuses" :key="String(status)" :status="status" /></div></div>`,
  }),
}

export const InTableCell: Story = {
  name: 'في خلية جدول المشاريع',
  parameters: storyContext('apps/web/app/components/project/ProjectTable.vue:85'),
  render: () => ({
    components: { ProjectStatusBadge },
    setup: () => ({
      data: ProjectStatusSchema.options.map((status, index) => ({ id: index + 1, name: `مشروع ${index + 1}`, status })),
      columns: [{ accessorKey: 'name', header: '' }, { accessorKey: 'status', header: '' }],
    }),
    template: `<div class="nasq-ui-record-surface"><UTable :data="data" :columns="columns"><template #status-cell="{ row }"><ProjectStatusBadge :status="row.original.status" /></template></UTable></div>`,
  }),
}
```

- [ ] **Step 2: Write `apps/web/stories/task/StateBadge.stories.ts`**

```ts
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { TaskStateSchema } from '@nasq/contracts'
import StateBadge from '../../app/components/task/StateBadge.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Task/StateBadge',
  component: StateBadge,
  args: { state: 'in_progress' },
  argTypes: { state: { control: 'select', options: TaskStateSchema.options } },
  parameters: storyContext('apps/web/app/components/task/StateMenu.vue:34', 'يظهر للمهمة بلا انتقالات متاحة داخل صف المهمة `div.flex.flex-wrap.items-center.gap-2` من `apps/web/app/components/task/TaskTable.vue:231`.'),
} satisfies Meta<typeof StateBadge>
export default meta
type Story = StoryObj<typeof meta>

export const InTaskRow: Story = {
  name: 'في صف المهمة',
  render: args => ({ components: { StateBadge }, setup: () => ({ args }), template: '<div class="flex flex-wrap items-center gap-2"><StateBadge v-bind="args" /></div>' }),
}

export const AllStates: Story = {
  name: 'كل الحالات',
  render: () => ({ components: { StateBadge }, setup: () => ({ states: TaskStateSchema.options }), template: '<div class="flex flex-wrap items-center gap-2"><StateBadge v-for="state in states" :key="state" :state="state" /></div>' }),
}
```

- [ ] **Step 3: Write `apps/web/stories/task/DeadlineBadge.stories.ts`**

```ts
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import DeadlineBadge from '../../app/components/task/DeadlineBadge.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Task/DeadlineBadge',
  component: DeadlineBadge,
  args: { deadline: '2026-09-15', daysRemaining: 2, isClosed: false },
  parameters: storyContext('apps/web/app/components/task/TaskCard.vue:88'),
} satisfies Meta<typeof DeadlineBadge>
export default meta
type Story = StoryObj<typeof meta>

export const OnTaskCard: Story = {
  name: 'على بطاقة المهمة',
  render: args => ({ components: { DeadlineBadge }, setup: () => ({ args }), template: '<div class="flex items-center gap-2"><DeadlineBadge v-bind="args" /></div>' }),
}

export const AllDeadlines: Story = {
  name: 'كل حالات الموعد',
  render: () => ({
    components: { DeadlineBadge },
    setup: () => ({
      cases: [
        { deadline: '2026-09-10', daysRemaining: -3, isClosed: false },
        { deadline: '2026-09-13', daysRemaining: 0, isClosed: false },
        { deadline: '2026-09-14', daysRemaining: 1, isClosed: false },
        { deadline: '2026-09-23', daysRemaining: 10, isClosed: false },
        { deadline: '2026-09-10', daysRemaining: -3, isClosed: true },
        { deadline: null, daysRemaining: null, isClosed: false },
      ],
    }),
    template: '<div class="flex flex-wrap items-center gap-2"><DeadlineBadge v-for="(item, index) in cases" :key="index" v-bind="item" /></div>',
  }),
}
```

- [ ] **Step 4: Write `apps/web/stories/access/AccessStateBadge.stories.ts`**

```ts
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import AccessStateBadge from '../../app/components/access/AccessStateBadge.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Access/AccessStateBadge',
  component: AccessStateBadge,
  args: { active: true, protected: false, readOnly: false },
} satisfies Meta<typeof AccessStateBadge>
export default meta
type Story = StoryObj<typeof meta>

const cases = [
  { name: 'Admin', active: true, protected: true },
  { name: 'سارة القحطاني', active: true, protected: false },
  { name: 'محمد العتيبي', active: false, protected: false },
]

export const InTableCell: Story = {
  name: 'في خلية جدول المستخدمين',
  parameters: storyContext('apps/web/app/components/access/users/UserTable.vue:34'),
  render: () => ({
    components: { AccessStateBadge },
    setup: () => ({ data: cases, columns: [{ accessorKey: 'name', header: '' }, { accessorKey: 'active', header: '' }] }),
    template: `<div class="min-w-0 space-y-2"><UCard class="nasq-ui-record-surface overflow-hidden" :ui="{ body: 'p-0' }"><div class="overflow-x-auto"><UTable :data="data" :columns="columns"><template #active-cell="{ row }"><AccessStateBadge :active="row.original.active" :protected="row.original.protected" /></template></UTable></div></UCard></div>`,
  }),
}

export const InMobileCard: Story = {
  name: 'في بطاقة الجوال',
  parameters: storyContext('apps/web/app/components/access/users/UserTable.vue:50', 'يظهر تحت 768px (md:hidden)، فالغلاف بعرض شاشة جوال 375px.'),
  render: args => ({
    components: { AccessStateBadge },
    setup: () => ({ args }),
    template: `<ul class="space-y-2" style="width: 375px"><li class="nasq-ui-record-surface p-4"><div class="flex items-start justify-between gap-3"><div class="min-w-0"><bdi class="block text-xs text-muted">#7</bdi><p class="font-medium">سارة القحطاني</p></div><AccessStateBadge v-bind="args" /></div></li></ul>`,
  }),
}

export const ReadOnly: Story = { ...InMobileCard, name: 'للقراءة فقط', args: { active: true, readOnly: true } }
```

- [ ] **Step 5: Write `apps/web/stories/hr/AccessBadge.stories.ts`**

```ts
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { HrEmployeeAccessSchema } from '@nasq/contracts'
import AccessBadge from '../../app/components/hr/AccessBadge.vue'
import { storyContext } from '../support/context'

const accesses = [
  null,
  HrEmployeeAccessSchema.parse({ user_id: 7, login: 'sara', role: 'employee', active: true }),
  HrEmployeeAccessSchema.parse({ user_id: 2, login: 'admin', role: 'admin', active: true }),
  HrEmployeeAccessSchema.parse({ user_id: 9, login: 'mohammed', role: 'employee', active: false }),
]

const meta = {
  title: 'HR/AccessBadge',
  component: AccessBadge,
  args: { access: accesses[1]! },
  parameters: storyContext('apps/web/app/components/hr/DirectoryTable.vue:190', 'بطاقة الدليل على الجوال تحت 768px، فالغلاف بعرض 375px.'),
} satisfies Meta<typeof AccessBadge>
export default meta
type Story = StoryObj<typeof meta>

export const InDirectoryCard: Story = {
  name: 'في بطاقة الدليل',
  render: args => ({
    components: { AccessBadge },
    setup: () => ({ args }),
    template: `<ul style="width: 375px"><li class="nasq-ui-record-surface p-4"><div class="flex items-start justify-between gap-3"><div class="min-w-0"><bdi class="block text-xs text-muted">#7</bdi><span class="font-medium">سارة القحطاني</span></div><AccessBadge v-bind="args" /></div></li></ul>`,
  }),
}

export const AllAccess: Story = {
  name: 'كل حالات الحساب',
  render: () => ({ components: { AccessBadge }, setup: () => ({ accesses }), template: '<div class="flex flex-wrap items-center gap-2"><AccessBadge v-for="(access, index) in accesses" :key="index" :access="access" /></div>' }),
}
```

- [ ] **Step 6: Write `apps/web/stories/chat/ChatAttachment.stories.ts`**

```ts
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { ChatAttachmentSchema } from '@nasq/contracts'
import ChatAttachment from '../../app/components/chat/ChatAttachment.vue'
import FormSection from '../../app/components/shared/FormSection.vue'
import { storyContext } from '../support/context'

const attachments = ChatAttachmentSchema.array().parse([
  { id: 31, name: 'محضر-الاجتماع.pdf', mimetype: 'application/pdf', url: '/web/content/31' },
  { id: 32, name: 'خطة-المشروع-النهائية-بعد-المراجعة.xlsx', mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', url: '/web/content/32' },
])

const meta = {
  title: 'Chat/ChatAttachment',
  component: ChatAttachment,
  args: { attachment: attachments[0]! },
} satisfies Meta<typeof ChatAttachment>
export default meta
type Story = StoryObj<typeof meta>

export const InMessage: Story = {
  name: 'داخل رسالة',
  parameters: storyContext('apps/web/app/components/chat/MessageHistory.vue:305'),
  render: () => ({
    components: { ChatAttachment },
    setup: () => ({ attachments }),
    template: '<div class="mt-2 flex flex-col gap-1"><ChatAttachment v-for="attachment in attachments" :key="attachment.id" :attachment="attachment" /></div>',
  }),
}

export const InConversationInfo: Story = {
  name: 'في معلومات المحادثة',
  parameters: storyContext('apps/web/app/pages/chat/[id]/info.vue:125'),
  render: () => ({
    components: { ChatAttachment, FormSection },
    setup: () => ({ attachments }),
    template: `<FormSection :title="$t('chat.attachments')"><div class="flex flex-col gap-2"><ChatAttachment v-for="attachment in attachments" :key="attachment.id" :attachment="attachment" /></div></FormSection>`,
  }),
}
```

- [ ] **Step 7: Write `apps/web/stories/shell/SidebarCreateAction.stories.ts`**

```ts
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import SidebarCreateAction from '../../app/components/shell/SidebarCreateAction.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shell/SidebarCreateAction',
  component: SidebarCreateAction,
  args: { to: '/tasks/new', label: '', active: false },
} satisfies Meta<typeof SidebarCreateAction>
export default meta
type Story = StoryObj<typeof meta>

export const InContextSidebar: Story = {
  name: 'في الشريط الجانبي',
  parameters: storyContext('apps/web/app/components/shell/ContextSidebar.vue:110', 'عرض الشريط `--context-sidebar-width: 236px` من `apps/web/app/assets/css/shell.css:75`.'),
  render: args => ({
    components: { SidebarCreateAction },
    setup: () => ({ args }),
    template: `<div style="width: 236px"><div class="nasq-context-create-actions"><SidebarCreateAction :to="args.to" :label="args.label || $t('tasks.new')" :active="args.active" /><SidebarCreateAction to="/meetings/new" :label="$t('meetingsUi.new')" /></div></div>`,
  }),
}

export const Active: Story = { ...InContextSidebar, name: 'نشط', args: { to: '/tasks/new', label: '', active: true } }
```

- [ ] **Step 8: Verify**

Run: `npm -w apps/web run build-storybook && python3 -B tools/ui_policy.py`
Expected: build succeeds; policy PASS, no `WARN:` lines. If a translation key renders raw (for example `chat.attachments` or `meetingsUi.new`), use the key the cited parent file uses (open the cited line). In the dev server open `StateBadge → AllStates`, `DeadlineBadge → AllDeadlines` and `AccessBadge → AllAccess` in light and dark; screenshot all three.

- [ ] **Step 9: Commit**

```bash
git add apps/web/stories/project apps/web/stories/task apps/web/stories/access apps/web/stories/hr apps/web/stories/chat apps/web/stories/shell
git commit -m "feat(web): add badge, attachment and sidebar action stories

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: API-backed pickers and menus with MSW

**Files:**
- Create: `apps/web/stories/fixtures/pmo.ts`, `apps/web/stories/fixtures/__tests__/pmo.test.ts`, `apps/web/stories/handlers/api.ts`
- Modify: `apps/web/.storybook/preview.ts` (default MSW handlers)
- Create: `apps/web/stories/task/PrioritySelect.stories.ts`, `StateMenu.stories.ts`, `TagPicker.stories.ts`, `apps/web/stories/project/ProjectMenu.stories.ts`, `apps/web/stories/meetings/MeetingProjectFilter.stories.ts`, `MeetingPeopleFields.stories.ts`

**Interfaces:**
- Consumes: `TaskSchema`, `TaskDetailSchema`, `ProjectSchema`, `ProjectRefSchema`, `TagSchema`, `PersonRefSchema`, `MeSchema` from `@nasq/contracts`.
- Produces:
  - `apps/web/stories/fixtures/pmo.ts`: `makeTask(overrides?: Partial<Task>): Task`, `taskDetail(overrides?: Record<string, unknown>): TaskDetail`, `boardStages: { id: number; name: string; sequence: number; fold: boolean }[]`, `project: Project`, `archivedProject: Project`, `projectRefs`, `tags`, `people`, `me`.
  - `apps/web/stories/handlers/api.ts`: `apiHandlers` (array of MSW handlers), `transitionForbidden` (handler returning 403 `transition_forbidden`).
  - Preview default `parameters.msw.handlers = { api: apiHandlers }`; a story overrides by setting `parameters.msw.handlers.api`.
- Task 10 uses `makeTask` and `boardStages`.

The API endpoints come from the real composables: `usePeople` → `GET /api/v1/people`; `useTags` → `GET/POST /api/v1/tags`; `useProjects` → `GET /api/v1/projects?minimal=1&limit&offset` (array of `ProjectRef`); `useMe` → `GET /api/v1/me`; `useUpdateTask` → `PATCH /api/v1/tasks/:id` (returns `TaskDetail`); `useTransitionTask` → `POST /api/v1/tasks/:id/transition` (returns `TaskDetail`); `useArchiveProject`/`useUnarchiveProject` → `POST /api/v1/projects/:id/archive|unarchive` (returns `ProjectDetail`, whose charter fixture is out of scope, so the story answers 422 and shows the error toast).

- [ ] **Step 1: Write the failing fixture test** `apps/web/stories/fixtures/__tests__/pmo.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { MeSchema, TaskDetailSchema, TaskSchema } from '@nasq/contracts'
import { makeTask, me, taskDetail } from '../pmo'

describe('Storybook PMO fixtures follow the wire contracts', () => {
  it('builds tasks and task details that parse', () => {
    expect(() => TaskSchema.parse(makeTask({ state: 'done', is_closed: true }))).not.toThrow()
    expect(TaskDetailSchema.parse(taskDetail({ priority: '3' })).priority).toBe('3')
  })

  it('signs in a user who can read projects', () => {
    expect(MeSchema.parse(me).capabilities).toContain('pmo.projects.read')
  })
})
```

Run: `npx -w apps/web vitest run stories/fixtures/__tests__/pmo.test.ts`
Expected: FAIL — cannot resolve `../pmo`.

- [ ] **Step 2: Write `apps/web/stories/fixtures/pmo.ts`**

```ts
import { MeSchema, PersonRefSchema, ProjectRefSchema, ProjectSchema, TagSchema, TaskDetailSchema, TaskSchema, type Task } from '@nasq/contracts'

export const tags = TagSchema.array().parse([
  { id: 1, name: 'عاجل', color: 1 },
  { id: 2, name: 'ميزانية', color: 3 },
  { id: 3, name: 'جودة', color: 10 },
])

export const people = PersonRefSchema.array().parse([
  { id: 2, name: 'Admin', user_id: 2 },
  { id: 7, name: 'سارة القحطاني', user_id: 7 },
  { id: 9, name: 'محمد العتيبي', user_id: 9 },
])

export const boardStages = [
  { id: 11, name: 'جديد', sequence: 1, fold: false },
  { id: 12, name: 'قيد التنفيذ', sequence: 2, fold: false },
  { id: 13, name: 'مكتمل', sequence: 3, fold: true },
]

export function makeTask(overrides: Partial<Task> = {}): Task {
  return TaskSchema.parse({
    id: 101, name: 'إعداد تقرير الربع الثالث', project: { id: 1, name: 'مشروع ألفا' }, state: 'in_progress', priority: '2',
    date_deadline: '2026-09-15', days_remaining: 2, is_overdue: false, is_closed: false,
    personal_stage: null, stage: { id: 11, name: 'جديد' },
    assignees: [{ id: 2, name: 'Admin' }, { id: 7, name: 'سارة القحطاني' }], tags: [tags[0]!],
    can_write: true, can_approve: true,
    allowed_transitions: ['changes_requested', 'approved', 'waiting', 'done', 'cancelled'],
    ...overrides,
  })
}

export function taskDetail(overrides: Record<string, unknown> = {}) {
  return TaskDetailSchema.parse({
    ...makeTask(),
    description_html: '', allocated_hours: 0, age_days: 3, cycle_days: null, subtasks: [], depends_on: [], attachments: [],
    can_manage_dependencies: false, milestone: null, created_at: '2026-09-01 08:00:00', updated_at: '2026-09-10 08:00:00',
    planned_start: null, deliverables: [], allowed_actions: ['read', 'write'],
    completion_pending: false, completion_revision: 0, completion_return_note: null, completion_policy: 'none',
    completion_approver: null, completion_blocked_reason: null,
    ...overrides,
  })
}

export const project = ProjectSchema.parse({
  id: 1, name: 'مشروع ألفا', status: 'on_track', progress: 50, task_count: 24, closed_task_count: 12,
  active: true, can_manage: true, manager: { id: 2, name: 'Admin' }, date_end: '2026-12-31', allowed_actions: ['read', 'write', 'archive'],
})

export const archivedProject = ProjectSchema.parse({ ...project, id: 4, name: 'تحديث الأنظمة', active: false })

export const projectRefs = ProjectRefSchema.array().parse([
  { id: 1, name: 'مشروع ألفا' },
  { id: 2, name: 'تطوير البوابة' },
  { id: 3, name: 'التحول الرقمي' },
])

export const me = MeSchema.parse({
  id: 2, name: 'Admin', login: 'admin', email: 'admin@example.com', lang: 'ar_001', tz: 'Asia/Riyadh',
  role: 'admin', roles: [], capabilities: ['pmo.projects.read'], access_policy_version: 1, company: { id: 1, name: 'نسق' },
})
```

Run: `npx -w apps/web vitest run stories/fixtures/__tests__/pmo.test.ts`
Expected: PASS. If a schema rejects a field, read the Zod error and fix the fixture value (not the schema).

- [ ] **Step 3: Write `apps/web/stories/handlers/api.ts`**

```ts
import { http, HttpResponse } from 'msw'
import { TagSchema } from '@nasq/contracts'
import { me, people, projectRefs, tags, taskDetail } from '../fixtures/pmo'

const contains = (value: string, request: Request) => value.includes(new URL(request.url).searchParams.get('q') ?? '')

export const apiHandlers = [
  http.get('/api/v1/me', () => HttpResponse.json(me)),
  http.get('/api/v1/people', ({ request }) => HttpResponse.json(people.filter(person => contains(person.name, request)))),
  http.get('/api/v1/projects', () => HttpResponse.json(projectRefs)),
  http.get('/api/v1/tags', ({ request }) => HttpResponse.json(tags.filter(tag => contains(tag.name, request)))),
  http.post('/api/v1/tags', async ({ request }) => {
    const body = await request.json() as { name: string }
    return HttpResponse.json(TagSchema.parse({ id: 900, name: body.name, color: 0 }))
  }),
  http.patch('/api/v1/tasks/:id', async ({ request }) => HttpResponse.json(taskDetail(await request.json() as Record<string, unknown>))),
  http.post('/api/v1/tasks/:id/transition', async ({ request }) => HttpResponse.json(taskDetail(await request.json() as Record<string, unknown>))),
  http.post('/api/v1/projects/:id/:action', () => HttpResponse.json({ code: 'invalid', message: 'Storybook لا يحاكي أرشفة المشروع.' }, { status: 422 })),
]

export const transitionForbidden = [
  http.post('/api/v1/tasks/:id/transition', () => HttpResponse.json({ code: 'transition_forbidden', message: 'forbidden' }, { status: 403 })),
  ...apiHandlers,
]
```

- [ ] **Step 4: Register the handlers as preview defaults** — docs pages render several stories under one loader, so per-story handlers alone do not reach them. In `apps/web/.storybook/preview.ts` add `import { apiHandlers } from '../stories/handlers/api'` and change the `parameters` line to:

```ts
  parameters: { layout: 'padded', msw: { handlers: { api: apiHandlers } } },
```

- [ ] **Step 5: Write `apps/web/stories/task/PrioritySelect.stories.ts`**

Context: the phone task row in `TaskTable.vue:233` (`article.space-y-3.p-4 > div.flex.flex-wrap.items-center.gap-2`, `md:hidden`, so 375px). The desktop use in `TaskDetails.vue:197` sits in scoped CSS and is not reproduced.

```ts
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import PrioritySelect from '../../app/components/task/PrioritySelect.vue'
import StateMenu from '../../app/components/task/StateMenu.vue'
import { makeTask } from '../fixtures/pmo'
import { storyContext } from '../support/context'

const meta = {
  title: 'Task/PrioritySelect',
  component: PrioritySelect,
  args: { task: makeTask() },
  parameters: storyContext('apps/web/app/components/task/TaskTable.vue:233', 'صف المهمة على الجوال تحت 768px، فالغلاف بعرض 375px. التغيير يرسل PATCH إلى MSW.'),
  render: args => ({
    components: { PrioritySelect, StateMenu },
    setup: () => ({ args }),
    template: `<div class="divide-y divide-default" style="width: 375px"><article class="space-y-3 p-4"><div class="flex flex-wrap items-center gap-2"><StateMenu :task="args.task" /><PrioritySelect v-bind="args" /></div></article></div>`,
  }),
} satisfies Meta<typeof PrioritySelect>
export default meta
type Story = StoryObj<typeof meta>

export const InTaskRow: Story = { name: 'في صف المهمة' }
export const ReadOnly: Story = { name: 'بلا صلاحية تعديل', args: { task: makeTask({ can_write: false }) } }
```

- [ ] **Step 6: Write `apps/web/stories/task/StateMenu.stories.ts`**

```ts
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import PrioritySelect from '../../app/components/task/PrioritySelect.vue'
import StateMenu from '../../app/components/task/StateMenu.vue'
import { makeTask } from '../fixtures/pmo'
import { transitionForbidden } from '../handlers/api'
import { storyContext } from '../support/context'

const meta = {
  title: 'Task/StateMenu',
  component: StateMenu,
  args: { task: makeTask() },
  parameters: storyContext('apps/web/app/components/task/TaskTable.vue:232', 'صف المهمة على الجوال تحت 768px، فالغلاف بعرض 375px.'),
  render: args => ({
    components: { PrioritySelect, StateMenu },
    setup: () => ({ args }),
    template: `<div class="divide-y divide-default" style="width: 375px"><article class="space-y-3 p-4"><div class="flex flex-wrap items-center gap-2"><StateMenu v-bind="args" /><PrioritySelect :task="args.task" /></div></article></div>`,
  }),
} satisfies Meta<typeof StateMenu>
export default meta
type Story = StoryObj<typeof meta>

export const InTaskRow: Story = { name: 'في صف المهمة' }
export const NoTransitions: Story = { name: 'بلا انتقالات متاحة', args: { task: makeTask({ state: 'done', is_closed: true, allowed_transitions: [] }) } }
export const TransitionForbidden: Story = {
  name: 'انتقال مرفوض',
  parameters: { msw: { handlers: { api: transitionForbidden } }, docs: { description: { story: 'اختر حالة لرؤية رسالة الرفض من الخادم.' } } },
}
```

- [ ] **Step 7: Write `apps/web/stories/task/TagPicker.stories.ts`**

```ts
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import PageContainer from '../../app/components/shared/PageContainer.vue'
import TagPicker from '../../app/components/task/TagPicker.vue'
import { tags } from '../fixtures/pmo'
import { storyContext } from '../support/context'

const meta = {
  title: 'Task/TagPicker',
  component: TagPicker,
  parameters: { layout: 'fullscreen', ...storyContext('apps/web/app/components/project/ProjectGeneralForm.vue:194', 'اكتب اسم وسم غير موجود لرؤية خيار الإنشاء.') },
  args: { modelValue: [tags[0]!], canCreate: true },
  render: args => ({
    components: { PageContainer, TagPicker },
    setup() {
      const value = ref(args.modelValue)
      return { args, value, t: useI18n().t, onUpdate: (event: { resolved: typeof tags }) => { value.value = event.resolved } }
    },
    template: `<main class="nasq-shell-main"><PageContainer width="form"><section class="space-y-2"><label id="project-settings-tags-label" class="flex items-center gap-2 text-sm font-medium leading-none">{{ t('projects.settings.tags') }}</label><div id="project-settings-tags" aria-labelledby="project-settings-tags-label"><TagPicker :model-value="value" :can-create="args.canCreate" labelledby="project-settings-tags-label" @update:model-value="onUpdate" /></div></section></PageContainer></main>`,
  }),
} satisfies Meta<typeof TagPicker>
export default meta
type Story = StoryObj<typeof meta>

export const InProjectSettings: Story = { name: 'في إعدادات المشروع' }
export const WithoutCreate: Story = { name: 'بلا صلاحية إنشاء وسم', args: { modelValue: [], canCreate: false } }
```

- [ ] **Step 8: Write `apps/web/stories/project/ProjectMenu.stories.ts`**

```ts
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import ProjectMenu from '../../app/components/project/ProjectMenu.vue'
import { archivedProject, project } from '../fixtures/pmo'
import { storyContext } from '../support/context'

const meta = {
  title: 'Project/ProjectMenu',
  component: ProjectMenu,
  args: { project, hideSettings: true },
  parameters: storyContext('apps/web/app/components/project/ProjectCards.vue:83', 'تذييل بطاقة المشروع. الأرشفة تعرض تأكيدًا ثم خطأ 422 لأن Storybook لا يحاكي تفاصيل المشروع الكاملة.'),
  render: args => ({
    components: { ProjectMenu },
    setup: () => ({ args }),
    template: `<div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"><article class="flex flex-col gap-4 nasq-ui-record-surface p-5"><p class="font-semibold text-highlighted">{{ args.project.name }}</p><div class="mt-auto flex items-center justify-between gap-3 border-t border-default pt-3 text-xs text-muted"><span class="truncate">{{ args.project.manager?.name ?? '—' }}</span><span class="inline-flex shrink-0 items-center gap-2"><span>{{ args.project.date_end ?? '—' }}</span><ProjectMenu v-bind="args" /></span></div></article></div>`,
  }),
} satisfies Meta<typeof ProjectMenu>
export default meta
type Story = StoryObj<typeof meta>

export const OnProjectCard: Story = { name: 'على بطاقة المشروع' }
export const Archived: Story = { name: 'مشروع مؤرشف', args: { project: archivedProject } }
```

- [ ] **Step 9: Write `apps/web/stories/meetings/MeetingProjectFilter.stories.ts`**

```ts
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import MeetingProjectFilter from '../../app/components/meetings/MeetingProjectFilter.vue'
import FormSection from '../../app/components/shared/FormSection.vue'
import PageContainer from '../../app/components/shared/PageContainer.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Meetings/MeetingProjectFilter',
  component: MeetingProjectFilter,
  parameters: { layout: 'fullscreen' },
  args: { modelValue: undefined, disabled: false },
} satisfies Meta<typeof MeetingProjectFilter>
export default meta
type Story = StoryObj<typeof meta>

export const InFormField: Story = {
  name: 'داخل حقل نموذج',
  parameters: storyContext('apps/web/app/pages/meetings/[id]/resolutions/new.vue:99'),
  render: args => ({
    components: { FormSection, MeetingProjectFilter, PageContainer },
    setup: () => ({ args, t: useI18n().t, projectId: ref(args.modelValue) }),
    template: `<main class="nasq-shell-main"><PageContainer width="form"><FormSection><div class="nasq-form-grid"><UFormField class="sm:col-span-2" :label="t('meetingMinutesForm.project')" name="project"><MeetingProjectFilter id="res-project" hide-label v-model="projectId" :disabled="args.disabled" /></UFormField></div></FormSection></PageContainer></main>`,
  }),
}

export const WithLabel: Story = {
  name: 'بعنوان ظاهر في الفلاتر',
  parameters: storyContext('apps/web/app/pages/meetings/series/index.vue:94'),
  args: { modelValue: 2 },
  render: args => ({
    components: { MeetingProjectFilter, PageContainer },
    setup: () => ({ args, t: useI18n().t, projectId: ref(args.modelValue) }),
    template: `<main class="nasq-shell-main"><PageContainer width="list"><div class="nasq-ui-filter-content"><MeetingProjectFilter id="meeting-series-project" :label="t('meetingsFilters.project')" v-model="projectId" /></div></PageContainer></main>`,
  }),
}
```

- [ ] **Step 10: Write `apps/web/stories/meetings/MeetingPeopleFields.stories.ts`**

```ts
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import MeetingPeopleFields from '../../app/components/meetings/MeetingPeopleFields.vue'
import FormSection from '../../app/components/shared/FormSection.vue'
import PageContainer from '../../app/components/shared/PageContainer.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Meetings/MeetingPeopleFields',
  component: MeetingPeopleFields,
  parameters: { layout: 'fullscreen', ...storyContext('apps/web/app/pages/meetings/new.vue:169') },
  args: { attendeeIds: [7], secretaryId: null, disabled: false },
  render: args => ({
    components: { FormSection, MeetingPeopleFields, PageContainer },
    setup: () => ({ args, t: useI18n().t, attendees: ref(args.attendeeIds), secretary: ref(args.secretaryId) }),
    template: `<main class="nasq-shell-main"><PageContainer width="form"><form class="space-y-8"><FormSection :title="t('meetingsUi.sectionPeople')"><MeetingPeopleFields v-model:attendee-ids="attendees" v-model:secretary-id="secretary" :disabled="args.disabled" /></FormSection></form></PageContainer></main>`,
  }),
} satisfies Meta<typeof MeetingPeopleFields>
export default meta
type Story = StoryObj<typeof meta>

export const InMeetingForm: Story = { name: 'في نموذج الاجتماع' }
export const Disabled: Story = { name: 'معطّل', args: { disabled: true } }
```

- [ ] **Step 11: Verify**

Run: `npx -w apps/web vitest run stories/fixtures && npm -w apps/web run build-storybook && python3 -B tools/ui_policy.py`
Expected: fixture tests PASS; build succeeds (no unshimmed-API error — `useMe` goes through the `useFetch` shim); policy PASS, no `WARN:` lines.

In the dev server (`-p 6108`), with the browser Network panel open:
1. `MeetingProjectFilter → InFormField`: requests `/api/v1/me` and `/api/v1/projects`, then lists the three projects. If it renders nothing, `useAccess` did not see the capability: check that `/api/v1/me` returned 200 and that the `useFetch` shim set `data`; fix the shim in `apps/web/.storybook/nuxt-shims.ts`, not the component.
2. `PrioritySelect → InTaskRow`: choosing another priority sends `PATCH /api/v1/tasks/101` and the select keeps the new value.
3. `StateMenu → TransitionForbidden`: choosing a state shows the «forbidden» toast.
4. `TagPicker → InProjectSettings`: typing «جديد» offers the create item.
5. `ProjectMenu → OnProjectCard`: archive opens the inline confirmation; confirming shows the error toast.
6. `MeetingPeopleFields → InMeetingForm`: attendee search lists people from `/api/v1/people`.
Screenshot items 1, 3 and 6.

- [ ] **Step 12: Commit**

```bash
git add apps/web/stories/fixtures apps/web/stories/handlers apps/web/.storybook/preview.ts apps/web/stories/task apps/web/stories/project apps/web/stories/meetings
git commit -m "feat(web): add API-backed picker and menu stories over contract fixtures

MSW answers the real endpoints the composables call, with fixtures parsed by
the wire schemas so a contract change fails the story instead of drifting.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Task card and dashboard charts

**Files:**
- Modify: `apps/web/app/utils/projectChartData.ts` (add `projectChartLabels`)
- Modify: `apps/web/app/components/project/dashboard/ProjectDashboardCharts.vue:24-49`
- Test: `apps/web/app/utils/__tests__/projectChartData.test.ts`
- Create: `apps/web/stories/fixtures/projectReports.ts`, `apps/web/stories/task/TaskCard.stories.ts`, `apps/web/stories/project/DashboardChartPanel.stories.ts`, `apps/web/stories/shared/DashboardChart.stories.ts`, `apps/web/stories/charts/ChartContainer.stories.ts`

**Interfaces:**
- Consumes: `makeTask`, `boardStages` (Task 9); chart builders and `ChartLabels` from `apps/web/app/utils/projectChartData.ts`; `ProjectReportRowSchema` from `@nasq/contracts`.
- Produces: `projectChartLabels(t: (key: string) => string): ChartLabels`; `projectReportRows`; `dashboardCharts(t)` returning `{ status, tasks, progressBands, budget, projectProgress, finance }`. Story exports for Task 11: `TaskCard.InBoardColumn`, `DashboardChartPanel.StatusPie`, `DashboardChart.FinanceComparison`, `ChartContainer.Default`.

The labels map moves out of `ProjectDashboardCharts.vue` so stories use the same keys, not a copy.

- [ ] **Step 1: Write the failing test** — append to `apps/web/app/utils/__tests__/projectChartData.test.ts` and add `projectChartLabels` to its existing import from `../projectChartData`:

```ts
describe('dashboard chart labels', () => {
  it('maps every label to its projects locale key', () => {
    const labels = projectChartLabels(key => key)
    expect(labels.status).toEqual({
      on_track: 'projects.status.on_track',
      at_risk: 'projects.status.at_risk',
      off_track: 'projects.status.off_track',
      on_hold: 'projects.status.on_hold',
      done: 'projects.status.done',
      unset: 'projects.status.unset',
    })
    expect(labels.taskOverdue).toBe('projects.dashboard.charts.taskOverdue')
    expect(labels.progress100).toBe('projects.dashboard.charts.progress100')
    expect(labels.unavailable).toBe('projects.dashboard.unknown')
  })
})
```

Run: `npx -w apps/web vitest run app/utils/__tests__/projectChartData.test.ts`
Expected: FAIL — `projectChartLabels` is not exported.

- [ ] **Step 2: Implement** — append to `apps/web/app/utils/projectChartData.ts`:

```ts
export function projectChartLabels(t: (key: string) => string): ChartLabels {
  return {
    status: {
      on_track: t('projects.status.on_track'),
      at_risk: t('projects.status.at_risk'),
      off_track: t('projects.status.off_track'),
      on_hold: t('projects.status.on_hold'),
      done: t('projects.status.done'),
      unset: t('projects.status.unset'),
    },
    taskClosed: t('projects.dashboard.charts.taskClosed'),
    taskOpenOnTime: t('projects.dashboard.charts.taskOpenOnTime'),
    taskOverdue: t('projects.dashboard.charts.taskOverdue'),
    progressNoTasks: t('projects.dashboard.charts.progressNoTasks'),
    progressUnknown: t('projects.dashboard.charts.progressUnknown'),
    progress0to25: t('projects.dashboard.charts.progress0to25'),
    progress26to50: t('projects.dashboard.charts.progress26to50'),
    progress51to75: t('projects.dashboard.charts.progress51to75'),
    progress76to99: t('projects.dashboard.charts.progress76to99'),
    progress100: t('projects.dashboard.charts.progress100'),
    budgetUnknown: t('projects.dashboard.charts.budgetUnknown'),
    budgetWithin: t('projects.dashboard.charts.budgetWithin'),
    budgetOver: t('projects.dashboard.charts.budgetOver'),
    planned: t('projects.dashboard.charts.planned'),
    actual: t('projects.dashboard.charts.actual'),
    unavailable: t('projects.dashboard.unknown'),
  }
}
```

In `apps/web/app/components/project/dashboard/ProjectDashboardCharts.vue` replace the whole `const labels = computed<ChartLabels>(() => ({ … }))` block (lines 24-49) with `const labels = computed<ChartLabels>(() => projectChartLabels(t))`, and add `projectChartLabels,` to that file's import list from `@/utils/projectChartData`.

Run: `npx -w apps/web vitest run app/utils/__tests__/projectChartData.test.ts && npx -w apps/web vue-tsc --noEmit`
Expected: PASS; no type errors.

- [ ] **Step 3: Commit the app change on its own**

```bash
git add apps/web/app/utils/projectChartData.ts apps/web/app/utils/__tests__/projectChartData.test.ts apps/web/app/components/project/dashboard/ProjectDashboardCharts.vue
git commit -m "refactor(web): share the dashboard chart labels as one function

Chart stories need the same locale keys as the dashboard; one function keeps
them from drifting.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Write `apps/web/stories/fixtures/projectReports.ts`**

```ts
import { ProjectReportRowSchema, type ProjectReportRow } from '@nasq/contracts'
import {
  projectBudgetHealthChart,
  projectChartLabels,
  projectFinanceComparisonChart,
  projectProgressBandsChart,
  projectProgressByProjectChart,
  projectStatusDoughnutChart,
  projectTaskCompositionChart,
} from '../../app/utils/projectChartData'

const sar = { id: 1, name: 'Saudi Riyal', symbol: 'ر.س', decimal_places: 2 }
type Status = ProjectReportRow['project']['status']

function row(id: number, name: string, status: Status, tasks: number, closed: number, overdue: number, progress: number | null, planned: number | null, actual: number) {
  return {
    project: { id, name, status },
    finance: {
      project_id: id, currency: sar, charter_estimate: planned, planned, actual,
      remaining: planned === null ? null : planned - actual,
      utilization_percent: planned ? Math.round((actual / planned) * 100) : null,
      over_budget: planned !== null && actual > planned,
      budget_count: planned === null ? 0 : 1, expense_count: actual ? 3 : 0,
    },
    task_count: tasks, closed_task_count: closed, overdue_task_count: overdue, progress,
  }
}

export const projectReportRows = ProjectReportRowSchema.array().parse([
  row(1, 'مشروع ألفا', 'on_track', 24, 12, 1, 50, 120000, 64000),
  row(2, 'تطوير البوابة', 'at_risk', 40, 18, 6, 45, 300000, 310000),
  row(3, 'التحول الرقمي', 'off_track', 16, 3, 5, 19, 80000, 20000),
  row(4, 'تحديث الأنظمة', 'on_hold', 10, 10, 0, 100, null, 0),
  row(5, 'برنامج التدريب', 'done', 8, 8, 0, 100, 50000, 48000),
  row(6, 'دراسة الجدوى', null, 0, 0, 0, null, null, 0),
])

export function dashboardCharts(t: (key: string) => string) {
  const labels = projectChartLabels(t)
  return {
    status: projectStatusDoughnutChart(projectReportRows, labels, t('projects.dashboard.charts.statusTitle')),
    tasks: projectTaskCompositionChart(projectReportRows, labels, t('projects.dashboard.charts.taskTitle')),
    progressBands: projectProgressBandsChart(projectReportRows, labels),
    budget: projectBudgetHealthChart(projectReportRows, labels, t('projects.dashboard.charts.budgetHealthTitle')),
    projectProgress: projectProgressByProjectChart(projectReportRows, labels),
    finance: projectFinanceComparisonChart(projectReportRows, sar.id, labels),
  }
}
```

- [ ] **Step 5: Write `apps/web/stories/task/TaskCard.stories.ts`**

Context: a board column at `TaskBoard.vue:135` (`w-72 p-2 border`) holding the draggable list (`flex min-h-16 flex-1 flex-col gap-2`); cards repeat per task.

```ts
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { fn } from 'storybook/test'
import TaskCard from '../../app/components/task/TaskCard.vue'
import { boardStages, makeTask } from '../fixtures/pmo'
import { storyContext } from '../support/context'

const tasks = [
  makeTask(),
  makeTask({ id: 102, name: 'مراجعة عقد المورد مع الإدارة القانونية قبل التوقيع النهائي', priority: '3', date_deadline: '2026-09-10', days_remaining: -3, is_overdue: true, tags: [] }),
  makeTask({ id: 103, name: 'تحديث سجل المخاطر', state: 'done', is_closed: true, priority: '0', date_deadline: null, days_remaining: null, assignees: [{ id: 9, name: 'محمد العتيبي' }], allowed_transitions: [] }),
]

const meta = {
  title: 'Task/TaskCard',
  component: TaskCard,
  args: { task: tasks[0]!, stages: boardStages, currentStageId: 11, showProject: true, onOpen: fn(), onMove: fn() },
  parameters: storyContext('apps/web/app/components/task/TaskBoard.vue:149', 'عمود اللوحة `w-72 p-2 border` من `apps/web/app/components/task/TaskBoard.vue:135`؛ بطاقة لكل مهمة.'),
} satisfies Meta<typeof TaskCard>
export default meta
type Story = StoryObj<typeof meta>

export const InBoardColumn: Story = {
  name: 'داخل عمود اللوحة',
  render: args => ({
    components: { TaskCard },
    setup: () => ({ args, tasks }),
    template: `<div class="flex h-full w-72 shrink-0 flex-col gap-2 rounded-lg border border-default bg-elevated/30 p-2"><div class="flex items-center justify-between px-1"><h3 class="text-sm font-medium text-muted">جديد</h3><span class="text-xs text-muted">{{ tasks.length }}</span></div><div class="flex min-h-16 flex-1 flex-col gap-2 overflow-y-auto"><TaskCard v-for="task in tasks" :key="task.id" :task="task" :stages="args.stages" :current-stage-id="args.currentStageId" :show-project="args.showProject" @open="args.onOpen" @move="args.onMove" /></div></div>`,
  }),
}

export const ProjectBoard: Story = { ...InBoardColumn, name: 'في لوحة المشروع (بلا اسم المشروع)', args: { showProject: false } }
```

- [ ] **Step 6: Write `apps/web/stories/project/DashboardChartPanel.stories.ts`**

The dashboard grid is two columns when its container is at least 768px (`ProjectDashboardCharts.vue` scoped `@container (min-width: 768px)`); the wrapper copies that as an inline grid.

```ts
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import DashboardChartPanel from '../../app/components/project/dashboard/DashboardChartPanel.vue'
import PageContainer from '../../app/components/shared/PageContainer.vue'
import { dashboardCharts } from '../fixtures/projectReports'
import { storyContext } from '../support/context'

const meta = {
  title: 'Project/DashboardChartPanel',
  component: DashboardChartPanel,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof DashboardChartPanel>
export default meta
type Story = StoryObj<typeof meta>

type ChartKey = keyof ReturnType<typeof dashboardCharts>
const GRID = 'display: grid; gap: 1.25rem; grid-template-columns: repeat(2, minmax(0, 1fr));'

function panel(key: ChartKey, title: string, options: { variant?: 'pie' | 'donut' | 'donut-text'; height?: string; wide?: boolean; loading?: boolean; hasData?: boolean } = {}): Story['render'] {
  return () => ({
    components: { DashboardChartPanel, PageContainer },
    setup() {
      const { t } = useI18n()
      return { chart: computed(() => dashboardCharts(t)[key]), t, title, options, grid: GRID }
    },
    template: `<main class="nasq-shell-main"><PageContainer width="list"><div class="min-w-0" style="container-type: inline-size"><div class="min-w-0" :style="grid"><DashboardChartPanel :style="options.wide ? 'grid-column: span 2' : ''" :test-id="'story-' + title" :title-id="'story-' + title + '-title'" :title="t(title)" description="" :chart="chart" :variant="options.variant" :has-data="options.hasData ?? true" :loading="options.loading ?? false" :empty-text="t('projects.dashboard.charts.noStatusData')" :accessible-label="t(title)" v-bind="options.height ? { height: options.height } : {}" /></div></div></PageContainer></main>`,
  })
}

const at = (line: number) => storyContext(`apps/web/app/components/project/dashboard/ProjectDashboardCharts.vue:${line}`)

export const StatusPie: Story = { name: 'حالات المشاريع (pie)', parameters: at(75), render: panel('status', 'projects.dashboard.charts.statusTitle', { variant: 'pie' }) }
export const TaskDonutText: Story = { name: 'تركيب المهام (donut-text)', parameters: at(86), render: panel('tasks', 'projects.dashboard.charts.taskTitle', { variant: 'donut-text' }) }
export const ProgressBands: Story = { name: 'شرائح التقدم (bar)', parameters: at(97), render: panel('progressBands', 'projects.dashboard.charts.progressBandsTitle', { height: '240px' }) }
export const BudgetDonut: Story = { name: 'صحة الميزانية (donut)', parameters: at(108), render: panel('budget', 'projects.dashboard.charts.budgetHealthTitle', { variant: 'donut', height: '240px' }) }
export const ProjectProgress: Story = { name: 'تقدم المشاريع (bar عريض)', parameters: at(120), render: panel('projectProgress', 'projects.dashboard.charts.projectProgressTitle', { height: '360px', wide: true }) }
export const Loading: Story = { name: 'تحميل', parameters: at(75), render: panel('status', 'projects.dashboard.charts.statusTitle', { variant: 'pie', loading: true }) }
export const NoData: Story = { name: 'بلا بيانات', parameters: at(75), render: panel('status', 'projects.dashboard.charts.statusTitle', { variant: 'pie', hasData: false }) }
```

Before committing, confirm each `at(n)` is the line holding `<DashboardChartPanel` for that chart (75, 86, 97, 108, 120 when this plan was written); the policy only warns on drift.

- [ ] **Step 7: Write `apps/web/stories/shared/DashboardChart.stories.ts`**

```ts
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import DashboardChart from '../../app/components/shared/DashboardChart.client.vue'
import PageContainer from '../../app/components/shared/PageContainer.vue'
import { dashboardCharts } from '../fixtures/projectReports'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/DashboardChart',
  component: DashboardChart,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof DashboardChart>
export default meta
type Story = StoryObj<typeof meta>

export const FinanceComparison: Story = {
  name: 'المخطط مقابل الفعلي',
  parameters: storyContext('apps/web/app/components/project/dashboard/ProjectDashboardCharts.vue:152', 'بطاقة المالية عريضة داخل شبكة لوحة المشاريع؛ الاستخدام الآخر داخل `DashboardChartPanel` له قصصه.'),
  render: () => ({
    components: { DashboardChart, PageContainer },
    setup() {
      const { t } = useI18n()
      return { chart: computed(() => dashboardCharts(t).finance), t }
    },
    template: `<main class="nasq-shell-main"><PageContainer width="list"><div class="min-w-0" style="container-type: inline-size"><div class="min-w-0" style="display: grid; gap: 1.25rem; grid-template-columns: repeat(2, minmax(0, 1fr))"><UCard class="min-w-0 overflow-hidden" style="grid-column: span 2"><template #header><h2 class="text-lg font-semibold leading-6 text-highlighted">{{ t('projects.dashboard.charts.financeTitle') }}</h2></template><div class="min-w-0"><DashboardChart :chart="chart" :accessible-label="t('projects.dashboard.charts.financeTitle')" height="360px" /></div></UCard></div></div></PageContainer></main>`,
  }),
}
```

- [ ] **Step 8: Write `apps/web/stories/charts/ChartContainer.stories.ts`**

```ts
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import ChartContainer from '../../app/components/charts/ChartContainer.vue'
import DashboardChart from '../../app/components/shared/DashboardChart.client.vue'
import { dashboardCharts } from '../fixtures/projectReports'
import { storyContext } from '../support/context'

const meta = { title: 'Charts/ChartContainer', component: ChartContainer } satisfies Meta<typeof ChartContainer>
export default meta

export const Default: StoryObj<typeof meta> = {
  name: 'عبر DashboardChart',
  parameters: storyContext('apps/web/app/components/shared/DashboardChart.client.vue:186', 'حاوية الرسم تتكرر مرتين داخل `DashboardChart` (دائري وأعمدة)، ولا تُستخدم خارجه. غيّر لون الهوية لرؤية `--chart-*` تتبدل.'),
  render: () => ({
    components: { DashboardChart },
    setup() {
      const { t } = useI18n()
      const charts = computed(() => dashboardCharts(t))
      return { charts, t }
    },
    template: `<div class="grid gap-5" style="grid-template-columns: repeat(2, minmax(0, 1fr))"><UCard class="min-w-0 overflow-hidden"><div class="min-w-0"><DashboardChart :chart="charts.budget" variant="donut" :accessible-label="t('projects.dashboard.charts.budgetHealthTitle')" height="240px" /></div></UCard><UCard class="min-w-0 overflow-hidden"><div class="min-w-0"><DashboardChart :chart="charts.progressBands" :accessible-label="t('projects.dashboard.charts.progressBandsTitle')" height="240px" /></div></UCard></div>`,
  }),
}
```

- [ ] **Step 9: Verify**

Run: `npm -w apps/web run build-storybook && python3 -B tools/ui_policy.py`
Expected: build succeeds; policy PASS; no `WARN:` lines.

In the dev server: `TaskCard → InBoardColumn` shows three cards in a 288px column (overdue badge red, closed card muted); `DashboardChartPanel → StatusPie` in light, then Brand = Teal, then dark — colours follow brand and mode; hovering a bar in `ProgressBands` shows the tooltip. Screenshot `TaskCard → InBoardColumn` and `StatusPie` (Teal, dark).

- [ ] **Step 10: Commit**

```bash
git add apps/web/stories/fixtures/projectReports.ts apps/web/stories/task/TaskCard.stories.ts apps/web/stories/project/DashboardChartPanel.stories.ts apps/web/stories/shared/DashboardChart.stories.ts apps/web/stories/charts
git commit -m "feat(web): add task card and dashboard chart stories

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: Overview page, coverage list, smoke test and documentation

**Files:**
- Create: `apps/web/stories/Overview.mdx`, `apps/web/e2e/storybook-smoke.spec.ts`
- Modify: `tools/ui_policy.py` (`STORYBOOK_COMPONENTS`), `DESIGN.md`, `docs/design-system/nuxt-ui-reference.md`, `docs/design-system/components.md`

**Interfaces:**
- Consumes: story exports named in Tasks 2 and 4-10.

- [ ] **Step 1: Fill the coverage list** — in `tools/ui_policy.py` set:

```python
# Reused building blocks that must each have a story (spec §1). Add a path here when a
# component starts being reused across pages, together with its story.
STORYBOOK_COMPONENTS: tuple[str, ...] = tuple(COMPONENTS + path for path in (
    'shared/PageHeader.vue', 'shared/PageState.vue', 'shared/PageContainer.vue', 'shared/UnsavedChanges.vue',
    'shared/FormSection.vue', 'shared/RecordNumber.vue', 'settings/SettingsLayout.vue', 'shared/EmptyState.vue',
    'shared/FilterBar.vue', 'shared/DateField.vue', 'task/DescriptionEditor.vue', 'meetings/MeetingProjectFilter.vue',
    'meetings/MeetingPeopleFields.vue', 'shared/FileField.vue', 'project/ProjectFieldHelp.vue',
    'project/ProjectStatusBadge.vue', 'task/StateBadge.vue', 'task/DeadlineBadge.vue', 'access/AccessStateBadge.vue',
    'hr/AccessBadge.vue', 'task/PrioritySelect.vue', 'task/StateMenu.vue', 'task/TagPicker.vue',
    'project/ProjectMenu.vue', 'shell/SidebarCreateAction.vue', 'chat/ChatAttachment.vue', 'task/TaskCard.vue',
    'project/dashboard/DashboardChartPanel.vue', 'shared/DashboardChart.client.vue', 'charts/ChartContainer.vue',
))
```

Run: `python3 -B tools/ui_policy.py`
Expected: PASS. If it lists `…: component needs a story`, write the missing story following the matching task before continuing.

- [ ] **Step 2: Write `apps/web/stories/Overview.mdx`**

```mdx
import { Canvas, Meta } from '@storybook/addon-docs/blocks'
import * as Colors from './foundations/Colors.stories'
import * as Typography from './foundations/Typography.stories'
import * as Shape from './foundations/Shape.stories'
import * as Actions from './nuxt-ui/Actions.stories'
import * as Fields from './nuxt-ui/Fields.stories'
import * as Overlays from './nuxt-ui/Overlays.stories'
import * as Surfaces from './nuxt-ui/Surfaces.stories'
import * as PageContainer from './shared/PageContainer.stories'
import * as PageHeader from './shared/PageHeader.stories'
import * as FormSection from './shared/FormSection.stories'
import * as SettingsLayout from './settings/SettingsLayout.stories'
import * as PageState from './shared/PageState.stories'
import * as EmptyState from './shared/EmptyState.stories'
import * as RecordNumber from './shared/RecordNumber.stories'
import * as UnsavedChanges from './shared/UnsavedChanges.stories'
import * as FilterBar from './shared/FilterBar.stories'
import * as DateField from './shared/DateField.stories'
import * as FileField from './shared/FileField.stories'
import * as DescriptionEditor from './task/DescriptionEditor.stories'
import * as ProjectFieldHelp from './project/ProjectFieldHelp.stories'
import * as MeetingProjectFilter from './meetings/MeetingProjectFilter.stories'
import * as MeetingPeopleFields from './meetings/MeetingPeopleFields.stories'
import * as ProjectStatusBadge from './project/ProjectStatusBadge.stories'
import * as StateBadge from './task/StateBadge.stories'
import * as DeadlineBadge from './task/DeadlineBadge.stories'
import * as AccessStateBadge from './access/AccessStateBadge.stories'
import * as AccessBadge from './hr/AccessBadge.stories'
import * as PrioritySelect from './task/PrioritySelect.stories'
import * as StateMenu from './task/StateMenu.stories'
import * as TagPicker from './task/TagPicker.stories'
import * as ProjectMenu from './project/ProjectMenu.stories'
import * as SidebarCreateAction from './shell/SidebarCreateAction.stories'
import * as ChatAttachment from './chat/ChatAttachment.stories'
import * as TaskCard from './task/TaskCard.stories'
import * as DashboardChartPanel from './project/DashboardChartPanel.stories'
import * as DashboardChart from './shared/DashboardChart.stories'
import * as ChartContainer from './charts/ChartContainer.stories'

<Meta title="Overview/كل المكونات" />

# كل المكونات

المكونات المتكررة في نسق، وتوكناته ووصفات Nuxt UI، كما هي في التطبيق. غيّر اللغة والمظهر وحجم الخط ولون الهوية من الشريط العلوي. لكل مكوّن صفحة بحالاته وسياقاته في القائمة الجانبية.

## الأساس

<Canvas of={Colors.Brand} />
<Canvas of={Colors.Status} />
<Canvas of={Typography.Scale} />
<Canvas of={Shape.RadiusAndElevation} />

## وصفات Nuxt UI

<Canvas of={Actions.ButtonRanks} />
<Canvas of={Actions.BadgesAndProgress} />
<Canvas of={Fields.TextInputs} />
<Canvas of={Fields.Selects} />
<Canvas of={Overlays.Menus} />
<Canvas of={Surfaces.Card} />
<Canvas of={Surfaces.Table} />

## الصفحة والحالة

<Canvas of={PageContainer.List} />
<Canvas of={PageHeader.WithActions} />
<Canvas of={SettingsLayout.FormPage} />
<Canvas of={FormSection.InForm} />
<Canvas of={FormSection.Panel} />
<Canvas of={PageState.ErrorState} />
<Canvas of={PageState.Empty} />
<Canvas of={EmptyState.InTaskTable} />
<Canvas of={RecordNumber.InTableCell} />
<Canvas of={UnsavedChanges.CleanForm} />

## الحقول والفلاتر

<Canvas of={FilterBar.InPageToolbar} />
<Canvas of={DateField.InFormField} />
<Canvas of={FileField.InMeetingAttachments} />
<Canvas of={DescriptionEditor.WithContent} />
<Canvas of={ProjectFieldHelp.BesideFieldLabel} />
<Canvas of={MeetingProjectFilter.InFormField} />
<Canvas of={MeetingPeopleFields.InMeetingForm} />

## الشارات

<Canvas of={ProjectStatusBadge.InOverviewRow} />
<Canvas of={StateBadge.AllStates} />
<Canvas of={DeadlineBadge.AllDeadlines} />
<Canvas of={AccessStateBadge.InMobileCard} />
<Canvas of={AccessBadge.AllAccess} />

## المنتقيات والقوائم

<Canvas of={PrioritySelect.InTaskRow} />
<Canvas of={StateMenu.InTaskRow} />
<Canvas of={TagPicker.InProjectSettings} />
<Canvas of={ProjectMenu.OnProjectCard} />
<Canvas of={SidebarCreateAction.InContextSidebar} />
<Canvas of={ChatAttachment.InConversationInfo} />

## البطاقات والرسوم

<Canvas of={TaskCard.InBoardColumn} />
<Canvas of={DashboardChartPanel.StatusPie} />
<Canvas of={DashboardChart.FinanceComparison} />
<Canvas of={ChartContainer.Default} />
```

(`UnsavedChanges.CleanForm` and closed overlays keep the overview free of open dialogs; `DateField.InFilterPopover` and `FilterBar.FiltersOpen` stay on their own pages for the same reason.)

- [ ] **Step 3: Write `apps/web/e2e/storybook-smoke.spec.ts`**

Serves the static build itself (no dev server), runs one test per story, and skips when the build is missing.

```ts
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { expect, test } from '@playwright/test'

const root = join(__dirname, '..', 'storybook-static')
const indexFile = join(root, 'index.json')
const built = existsSync(indexFile)
const stories = built
  ? Object.values(JSON.parse(readFileSync(indexFile, 'utf8')).entries as Record<string, { id: string; type: string }>).filter(entry => entry.type === 'story')
  : []
const combos = ['locale:ar;appearance:light', 'locale:en;appearance:dark', 'locale:ar;appearance:cream']
const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' }

let server: Server
let base = ''

test.describe('Storybook stories render without errors', () => {
  test.skip(!built, 'Run `npm -w apps/web run build-storybook` first.')

  test.beforeAll(async () => {
    server = createServer((request, response) => {
      const path = normalize(decodeURIComponent((request.url ?? '/').split('?')[0]!)).replace(/^([/\\])+/, '')
      const file = join(root, path || 'index.html')
      if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) {
        response.writeHead(404).end()
        return
      }
      response.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' })
      createReadStream(file).pipe(response)
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
  })

  test.afterAll(() => new Promise<void>(resolve => server.close(() => resolve())))

  for (const story of stories) {
    test(story.id, async ({ page }) => {
      const errors: string[] = []
      page.on('pageerror', error => errors.push(`pageerror ${error.message}`))
      page.on('console', message => { if (message.type() === 'error') errors.push(`console ${message.text()}`) })
      for (const globals of combos) {
        await page.goto(`${base}/iframe.html?id=${story.id}&viewMode=story&globals=${globals}`)
        await expect(page.locator('#storybook-root')).not.toBeEmpty({ timeout: 10_000 })
      }
      expect(errors).toEqual([])
    })
  }
})
```

- [ ] **Step 4: Run the smoke test**

```bash
npm -w apps/web run build-storybook
cd apps/web && npx playwright test e2e/storybook-smoke.spec.ts; cd ../..
```

Expected: one passing test per story. A failure names the story and the error; fix the story, fixture, handler or shim. `StateMenu → TransitionForbidden` logs no console error because the 403 is handled by a toast; if MSW or the toast logs one, filter only that exact message in this spec with a comment naming the story. If an error comes from app code itself, stop and report it.

- [ ] **Step 5: Documentation**

In `DESIGN.md`, add this row to the «ابدأ هنا» table directly after the «العثور على مكوّن موجود ومسؤوليته» row:

```markdown
| رؤية المكونات المتكررة والتوكنات حيّة في سياقاتها | Storybook: `npm -w apps/web run storybook`. أداة عرض واختبار، ليست مصدر تصميم؛ القرار لهذا الملف |
```

Append to `docs/design-system/nuxt-ui-reference.md`:

```markdown
## Storybook

Storybook في `apps/web` يعرض المكونات **المتكررة** وتوكنات النظام ووصفات Nuxt UI الحقيقية؛ لا يحرر شيئًا ولا يضيف مصدرًا بصريًا. المكوّن المستخدم مرة واحدة لا يدخله.

| الجزء | المسار |
| --- | --- |
| الإعداد | `apps/web/.storybook/main.ts`، `preview.ts` |
| الاستيرادات التلقائية | تُولَّد من `.nuxt/imports.d.ts` و`.nuxt/components.d.ts` في `nuxt-imports.mjs` |
| بدائل Nuxt | `apps/web/.storybook/nuxt-shims.ts`؛ البناء يفشل إذا استدعى كود التطبيق واجهة Nuxt بلا بديل |
| القصص | `apps/web/stories/**`؛ كل قصة مكوّن تذكر سياقها الحقيقي بـ `storyContext('ملف:سطر')` |
| البيانات والـ API | `apps/web/stories/fixtures/**` تمر عبر مخططات `@nasq/contracts`؛ `apps/web/stories/handlers/api.ts` يحاكي `/api/v1` عبر MSW |
| قائمة التغطية | `STORYBOOK_COMPONENTS` في `tools/ui_policy.py` |

التشغيل: `npm -w apps/web run storybook` (منفذ 6006، أو `-- -p <port>`). البناء: `npm -w apps/web run build-storybook`. الفحص: `cd apps/web && npx playwright test e2e/storybook-smoke.spec.ts` بعد البناء.

إضافة لبنة: عندما يُستخدم مكوّن في ملفين أو أكثر، أضف مساره إلى `STORYBOOK_COMPONENTS` واكتب قصته داخل سياق استخدامه.

حدود معروفة: الـ bus وmiddleware المسارات وplugins Nuxt غير محاكاة؛ كاش `useFetch` في البدائل مبسّط؛ أرشفة المشروع في `ProjectMenu` تعرض خطأ 422 بدل النجاح.
```

If Task 2 Step 5 kept Storybook on Vite 7.3.6, add `Vite: Storybook على 7.3.6 بينما يُبنى التطبيق بـ 8.2.2.` to that «حدود معروفة» paragraph.

In `docs/design-system/components.md`, add below the intro paragraph:

```markdown
المكونات المتكررة لها قصص Storybook في `apps/web/stories/<المجلد>/<المكوّن>.stories.ts`؛ القائمة الملزمة `STORYBOOK_COMPONENTS` في `tools/ui_policy.py`.
```

- [ ] **Step 6: Final verification**

```bash
npm test
npx -w apps/web vue-tsc --noEmit
npx -w apps/web vue-tsc --noEmit -p .storybook/tsconfig.json 2>&1 | grep -E '\.storybook/|stories/' || echo "no Storybook type errors"
python3 -B tools/ui_policy.py
npm -w apps/web run build-storybook
cd apps/web && npx playwright test e2e/storybook-smoke.spec.ts; cd ../..
```

Expected: all pass; policy PASS with no `WARN:`.

Then in the dev server open `Overview/كل المكونات` in ar/light and en/dark and take both screenshots. Edit one class in the real `apps/web/app/components/task/StateBadge.vue` (for example add `font-semibold` to the `UBadge`), confirm the overview updates without a reload, revert the edit, and confirm `git status` shows no change to that file.

- [ ] **Step 7: Commit**

```bash
git add apps/web/stories/Overview.mdx apps/web/e2e/storybook-smoke.spec.ts tools/ui_policy.py DESIGN.md docs/design-system/nuxt-ui-reference.md docs/design-system/components.md
git commit -m "feat(web): add the reused-components overview and gate its coverage

A smoke test renders every story in both directions and three modes, and the
docs name Storybook as a viewer of reused components, not a design source.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 8: Report** — list changed files, the fresh command output from Step 6, the screenshots, the dark-calendar finding from Task 7, whether Vite was aligned, and residual risks (shimmed `useFetch` cache, bus/middleware not simulated, `storyContext` line numbers only warn, ProjectMenu success path not simulated). Do not push; integration into `main` is the orchestrator's decision.
