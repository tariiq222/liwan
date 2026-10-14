# Tasmim Plan 1 — Setup, housekeeping, tooling and foundations

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare the `codex/web-tasmim` branch (phases 0, 0.5 and 1 of the spec) and deliver the new Nasq foundations — midnight/lime palette, light/dark only, dense type and shape — ending at owner checkpoint CP1.

**Architecture:** All visual inputs stay where the repo already keeps them: tokens in `apps/web/app/assets/css/tokens.css`, Nuxt UI recipes in `apps/web/app/app.config.ts`, the tenant-colour engine in `apps/web/app/utils/brandTheme.ts`, the display preference in `apps/web/app/utils/appearance.ts`. A Storybook-driven Playwright spec captures visual snapshots (ar/en × light/dark) and runs axe, so every later plan has a regression net. No Odoo, contract or API change.

**Tech Stack:** Nuxt 4, Nuxt UI 4.11.1, Tailwind 4.3, Storybook 10.6, Playwright 1.62, Vitest 4, Python policy checks in `tools/`.

**Spec:** `docs/superpowers/specs/2026-10-11-nasq-tasmim-design.md`

## Global Constraints

- Work only in `/Users/tariq/code/nasq/.worktrees/tasmim` on branch `codex/web-tasmim`; never commit to or push `main`.
- Commit subjects: `type(web): imperative subject`, ≤ 72 chars, `type` ∈ `feat fix refactor perf test docs ci build chore`; one logical change per commit; end every message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- No changes under `odoo-addons/`, `packages/contracts/`, `apps/control-plane/`. The server keeps accepting `mode: 'cream'`; the client stops offering or sending it.
- No route, `data-testid` or visible-heading changes.
- Logical Tailwind properties only (`ms- me- ps- pe- start- end- text-start`).
- Every user-facing string in `apps/web/i18n/locales/{ar,en}/<owner>.json`; ar and en keys stay in parity.
- A shared component ships with its story and an entry in `STORYBOOK_COMPONENTS` (`tools/ui_policy.py`).
- `tools/arch_baseline.json` only shrinks, and only through `python3 -B tools/arch_policy.py --write-baseline`.
- Type-check with `npm -w apps/web run lint` from the worktree root; never `npx -w`.
- Never use ports 3000 or 8069 or the `odoo19` database; the mock stack uses free ports (4097 Nuxt / 4498 mock).
- Palette values (from the spec): primary midnight `#13234a`, accent lime `#c8f031`, lime foreground `#13234a`; dark surfaces bg `#0a1124`, muted `#0f182f`, elevated `#15203b`, accented `#1d2a48`, border `#22304f`, border-muted `#1a2642`, border-accented `#2c3b5e`.
- Density (at the default 14px root): control 32px, table row 36px, radius 6px controls / 8px cards, type 12/14/16/20/24; `en` root is 1px smaller per font size (13/15/17).

## Review Focus

1. **A user whose saved preference is `cream`** — expected: the app renders light, the menu shows light checked, nothing is sent until the user picks a mode. Pinned in Task 5 (`appearance.test.ts`, `appearanceFromWire({ mode: 'cream' })`).
2. **A tenant primary that is very dark, very light, or pure lime/yellow** — expected: links ≥ 4.5:1 and rings/fills ≥ 3:1 on every light and dark surface, and the rail stays midnight. Pinned in Task 6 (`brandTheme.test.ts` sampled-primary loop and rail-independence test).
3. **English locale** — expected: root font is 1px smaller than Arabic at every font size and Latin glyphs use the Plex family. Pinned in Task 7 (`density.spec` en measurement).
4. **Large font size** — expected: controls and rows scale proportionally (no clipped text). Pinned in Task 7 (`density.spec` large measurement).
5. **Dark mode surfaces and lime accent** — expected: body text ≥ 4.5:1 on every dark surface, lime fill with midnight text ≥ 4.5:1, white on the rail ≥ 4.5:1. Pinned in Task 6 (`nasqPalette` contrast tests).

---

### Task 1: Worktree setup and green baseline

**Files:** none modified (environment only).

**Interfaces:**
- Produces: an installed worktree with recorded green baseline outputs used by every later task.

- [ ] **Step 1: Confirm branch and clean tree**

Run: `cd /Users/tariq/code/nasq/.worktrees/tasmim && git status --short && git branch --show-current`
Expected: empty status, `codex/web-tasmim`.

- [ ] **Step 2: Install dependencies (independent node_modules, no symlinks)**

Run: `npm ci --ignore-scripts && npm -w apps/web exec nuxt prepare`
Expected: exit 0; `apps/web/.nuxt` exists.

- [ ] **Step 3: Record the baseline gates**

Run each and save the tail to the scratchpad (not the repo):
```bash
npm test 2>&1 | tail -20
npm -w apps/web run lint 2>&1 | tail -5
python3 -B tools/ui_policy.py; echo "ui_policy exit=$?"
python3 -B tools/arch_policy.py; echo "arch_policy exit=$?"
```
Expected: all exit 0. If any fails on the untouched branch, stop and report it to the orchestrator — it is pre-existing and must be recorded, not fixed silently.

- [ ] **Step 4: Record the mock e2e baseline failing set**

Start the mock and Nuxt on free ports (see memory note "isolated UI mock stack"):
```bash
cd apps/web
PROJECTS_UI_PREVIEW=1 MODULE_UI_PREVIEW=1 MOCK_PORT=4498 node e2e/internal-ui-audit-mock.mjs &
NUXT_ODOO_URL=http://127.0.0.1:4498 NUXT_ODOO_DB=nasq_ui_mock_only NUXT_PUBLIC_WS_URL=ws://127.0.0.1:4498/websocket npx nuxt dev --port 4097 &
E2E_BASE_URL=http://localhost:4097 E2E_PROJECT_POPUPS=1 npx playwright test --reporter=line 2>&1 | grep -E '^\s+[0-9]+\) ' | sort > "$SCRATCH/e2e-baseline-failures.txt"
```
Expected: a sorted list of failing titles (around 73 known). This file is the comparison set for every later e2e run. Stop both background processes afterwards.

No commit in this task.

---

### Task 2: Move `DescriptionEditor` and `TagPicker` to `shared/`

Removes the four R3 baseline entries (meeting pages importing a PMO component).

**Files:**
- Move: `apps/web/app/components/task/DescriptionEditor.vue` → `apps/web/app/components/shared/DescriptionEditor.vue`
- Move: `apps/web/app/components/task/TagPicker.vue` → `apps/web/app/components/shared/TagPicker.vue`
- Move: `apps/web/stories/task/DescriptionEditor.stories.ts` → `apps/web/stories/shared/DescriptionEditor.stories.ts`
- Move: `apps/web/stories/task/TagPicker.stories.ts` → `apps/web/stories/shared/TagPicker.stories.ts`
- Modify imports in: `app/components/project/ProjectGeneralForm.vue:4`, `app/components/project/ProjectUpdateForm.vue:2`, `app/pages/meetings/[id]/minutes.vue:3`, `app/pages/meetings/[id]/resolutions/[resolutionId]/edit.vue:3`, `app/pages/meetings/[id]/edit.vue:3`, `app/pages/meetings/new.vue:2`, `app/components/task/TaskDetails.vue:20`, `app/components/task/TaskDescription.vue:7`, `app/lib/debouncedFlush.ts:1` (comment)
- Modify: `tools/ui_policy.py:41,44,566`, `docs/design-system/components.md:42`
- Modify (generated): `tools/arch_baseline.json`

**Interfaces:**
- Produces: `@/components/shared/DescriptionEditor.vue` and `@/components/shared/TagPicker.vue` with unchanged props/events.

- [ ] **Step 1: Move with git**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim/apps/web
git mv app/components/task/DescriptionEditor.vue app/components/shared/DescriptionEditor.vue
git mv app/components/task/TagPicker.vue app/components/shared/TagPicker.vue
git mv stories/task/DescriptionEditor.stories.ts stories/shared/DescriptionEditor.stories.ts
git mv stories/task/TagPicker.stories.ts stories/shared/TagPicker.stories.ts
```

- [ ] **Step 2: Rewrite imports**

```bash
rg -l "components/task/(DescriptionEditor|TagPicker)\.vue" app stories | xargs sed -i '' -E 's#components/task/(DescriptionEditor|TagPicker)\.vue#components/shared/\1.vue#g'
sed -i '' -E "s#from '\./TagPicker\.vue'#from '@/components/shared/TagPicker.vue'#" app/components/task/TaskDetails.vue
sed -i '' -E "s#from '\./DescriptionEditor\.vue'#from '@/components/shared/DescriptionEditor.vue'#" app/components/task/TaskDescription.vue
```
Inside the two moved story files, the import path `../../app/components/task/...` becomes `../../app/components/shared/...` (covered by the first command). Check `TaskDescription.test.ts:46` still matches: it tests `request.endsWith('/DescriptionEditor.vue')`, which is path-agnostic — no change.

If the moved components import siblings with `./` (e.g. `./something.vue` from `task/`), change those to `@/components/task/<file>.vue`:
```bash
rg -n "from '\./" app/components/shared/DescriptionEditor.vue app/components/shared/TagPicker.vue
```
Expected after fixing: no `./` import that points at a `task/` file. If one exists and the target is task-specific, stop and report — moving it would pull PMO into shared.

- [ ] **Step 3: Update policy list, index and the stray comment**

In `tools/ui_policy.py` `STORYBOOK_COMPONENTS`, replace `'task/DescriptionEditor.vue'` with `'shared/DescriptionEditor.vue'` and `'task/TagPicker.vue'` with `'shared/TagPicker.vue'`; at line ~566 replace `COMPONENTS + 'task/DescriptionEditor.vue'` with `COMPONENTS + 'shared/DescriptionEditor.vue'`.
In `docs/design-system/components.md`, move the two entries from the task row to the shared row with their new story paths.
In `app/lib/debouncedFlush.ts:1` the comment stays valid (names the file only) — no change.

- [ ] **Step 4: Run the checks**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim
npm -w apps/web run lint && npm test 2>&1 | tail -5 && python3 -B tools/ui_policy.py
python3 -B tools/arch_policy.py; echo "exit=$?"
```
Expected: all pass; `arch_policy` reports the R3 baseline as stale (fewer violations than recorded) or passes.

- [ ] **Step 5: Shrink the baseline**

Run: `python3 -B tools/arch_policy.py --write-baseline && git diff tools/arch_baseline.json`
Expected: the four `web apps/web/app/pages/meetings/...` R3 entries are gone; nothing else changed.

- [ ] **Step 6: Commit**

```bash
git add -A apps/web tools/ui_policy.py tools/arch_baseline.json docs/design-system/components.md
git commit -m "refactor(web): move DescriptionEditor and TagPicker to shared

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Move root shell components into `components/shell/`

**Files:**
- Move: `apps/web/app/components/{AppSidebar,AppAccountMenu,GlobalSearch}.vue` → `apps/web/app/components/shell/`
- Modify: `app/layouts/default.vue:51`, `app/components/shell/ShellHeader.vue:24,28`, `app/plugins/bus.client.ts:6,18`, `app/composables/useBus.ts:73`, `tools/ui_policy.py:398`, `tools/test_ui_policy.py:444`, `tools/new_app.py:32` (comment), `docs/design-system/components.md:25`

**Interfaces:**
- Produces: Nuxt auto-import names `ShellAppSidebar`, `ShellAppAccountMenu`, `ShellGlobalSearch` (Nuxt prefixes by folder; `nuxt.config.ts:39` uses the default `pathPrefix`).

- [ ] **Step 1: Move**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim/apps/web
for f in AppSidebar AppAccountMenu GlobalSearch; do git mv app/components/$f.vue app/components/shell/$f.vue; done
```

- [ ] **Step 2: Update tags and references**

```bash
sed -i '' 's#<AppSidebar />#<ShellAppSidebar />#' app/layouts/default.vue
sed -i '' -e 's#<GlobalSearch />#<ShellGlobalSearch />#' -e 's#<AppAccountMenu />#<ShellAppAccountMenu />#' app/components/shell/ShellHeader.vue
sed -i '' "s#COMPONENTS + 'GlobalSearch.vue'#COMPONENTS + 'shell/GlobalSearch.vue'#" ../../tools/ui_policy.py
sed -i '' 's#self.COMPONENTS + "GlobalSearch.vue"#self.COMPONENTS + "shell/GlobalSearch.vue"#' ../../tools/test_ui_policy.py
```
Update the comments in `plugins/bus.client.ts`, `composables/useBus.ts` (`AppSidebar` → `shell/AppSidebar`) and the shell row in `docs/design-system/components.md` to the new paths. Check for relative imports inside the moved files:
```bash
rg -n "from '\.\./|from '\./" app/components/shell/AppSidebar.vue app/components/shell/AppAccountMenu.vue app/components/shell/GlobalSearch.vue
```
Fix any relative path to its `@/...` absolute form.

- [ ] **Step 3: Run checks**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim
npm -w apps/web run lint && npm test 2>&1 | tail -5 && python3 -B tools/ui_policy.py && python3 -B -m pytest tools/test_ui_policy.py -q 2>&1 | tail -3
```
Expected: all pass. (If `pytest` is not installed, run `python3 -B -m unittest tools.test_ui_policy -q`.)

- [ ] **Step 4: Commit**

```bash
git add -A apps/web tools docs/design-system/components.md
git commit -m "refactor(web): move shell components under components/shell

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Visual snapshot and accessibility harness (captures today's UI)

**Files:**
- Create: `apps/web/e2e/support/storybookServer.ts`
- Modify: `apps/web/e2e/storybook-smoke.spec.ts` (use the helper)
- Create: `apps/web/e2e/storybook-visual.spec.ts`
- Create: `apps/web/e2e/support/visualStories.ts`
- Modify: `apps/web/package.json` (devDependencies `@axe-core/playwright`, `@storybook/addon-a11y@10.6.0`)
- Modify: `apps/web/.storybook/main.ts` (addons), `apps/web/.storybook/preview.ts` (a11y parameter)
- Create: `apps/web/e2e/storybook-visual.spec.ts-snapshots/` (generated baselines)

**Interfaces:**
- Produces: `startStorybookServer(): Promise<{ base: string, stories: StoryEntry[], close(): Promise<void> }>` and `VISUAL_STORIES: string[]` (story-id prefixes); `VISUAL_MATRIX` of `{ locale: 'ar'|'en', appearance: 'light'|'dark' }`. Later plans append story-id prefixes to `VISUAL_STORIES`.

- [ ] **Step 1: Install the two dev dependencies**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim
npm -w apps/web install -D --ignore-scripts @axe-core/playwright @storybook/addon-a11y@10.6.0
```
Expected: `apps/web/package.json` and root `package-lock.json` change; no other dependency moves major version (`git diff package-lock.json | rg '"version"' | head`).

- [ ] **Step 2: Extract the static Storybook server**

Create `apps/web/e2e/support/storybookServer.ts` by moving the server code out of `storybook-smoke.spec.ts` unchanged in behaviour:

```ts
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, isAbsolute, join, normalize, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface StoryEntry { id: string, type: string, title: string, name: string }

const root = fileURLToPath(new URL('../../storybook-static', import.meta.url))
const indexFile = join(root, 'index.json')
const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' }

export const storybookBuilt = existsSync(indexFile)

export function storybookEntries(): StoryEntry[] {
  if (!storybookBuilt) return []
  return Object.values(JSON.parse(readFileSync(indexFile, 'utf8')).entries as Record<string, StoryEntry>)
}

export async function startStorybookServer(): Promise<{ base: string, close: () => Promise<void> }> {
  const server = createServer((request, response) => {
    let decoded: string
    try {
      decoded = decodeURIComponent((request.url ?? '/').split('?')[0]!)
    } catch {
      response.writeHead(400).end()
      return
    }
    const requestPath = normalize(decoded).replace(/^([/\\])+/, '')
    const file = join(root, requestPath || 'index.html')
    // path.relative + an absolute/".." check is the safe containment test.
    const rel = relative(root, file)
    const inRoot = rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
    if (!inRoot || !existsSync(file) || statSync(file).isDirectory()) {
      response.writeHead(404).end()
      return
    }
    response.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' })
    createReadStream(file).pipe(response)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
  return { base, close: () => new Promise<void>(resolve => server.close(() => resolve())) }
}
```

Edit `storybook-smoke.spec.ts` to import `storybookBuilt`, `storybookEntries`, `startStorybookServer` and drop its local copies; keep its `combos` but change `'locale:ar;appearance:cream'` to `'locale:ar;appearance:dark'` only in Task 5 (leave it now so this task changes no behaviour).

- [ ] **Step 3: Define the visual story set and matrix**

Create `apps/web/e2e/support/visualStories.ts`:

```ts
// Story-id prefixes captured by storybook-visual.spec.ts. Each later Tasmim
// plan appends the stories it introduces (shell, templates, states).
export const VISUAL_STORIES: string[] = [
  'foundations-',
  'shared-pageheader--',
  'shared-pagestate--',
  'shared-emptystate--',
  'shared-filterbar--',
  'shared-formsection--',
  'shared-metrictile--',
  'shared-pagination--',
  'shell-sidebarcreateaction--',
  'task-statebadge--',
  'task-taskcard--',
]

export const VISUAL_MATRIX = [
  { locale: 'ar', appearance: 'light' },
  { locale: 'ar', appearance: 'dark' },
  { locale: 'en', appearance: 'light' },
  { locale: 'en', appearance: 'dark' },
] as const
```

- [ ] **Step 4: Write the visual + axe spec**

Create `apps/web/e2e/storybook-visual.spec.ts`:

```ts
import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { startStorybookServer, storybookBuilt, storybookEntries } from './support/storybookServer'
import { VISUAL_MATRIX, VISUAL_STORIES } from './support/visualStories'

const stories = storybookEntries()
  .filter(entry => entry.type === 'story' && VISUAL_STORIES.some(prefix => entry.id.startsWith(prefix)))

let base = ''
let close: () => Promise<void> = async () => {}

test.describe('Storybook visual snapshots', () => {
  test.skip(!storybookBuilt, 'Run `npm -w apps/web run build-storybook` first.')
  test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })

  test.beforeAll(async () => { ({ base, close } = await startStorybookServer()) })
  test.afterAll(async () => { await close() })

  for (const story of stories) {
    for (const { locale, appearance } of VISUAL_MATRIX) {
      test(`${story.id} ${locale}-${appearance}`, async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' })
        await page.goto(`${base}/iframe.html?id=${story.id}&viewMode=story&globals=locale:${locale};appearance:${appearance}`)
        await page.locator('#storybook-root').waitFor()
        await page.evaluate(() => document.fonts.ready)
        await expect(page.locator('#storybook-root')).toHaveScreenshot(`${story.id}-${locale}-${appearance}.png`, {
          animations: 'disabled',
          maxDiffPixelRatio: 0.002,
        })
      })
    }
  }

  for (const story of stories.filter(entry => entry.id.startsWith('foundations-'))) {
    test(`${story.id} has no serious axe violations`, async ({ page }) => {
      for (const { locale, appearance } of VISUAL_MATRIX) {
        await page.goto(`${base}/iframe.html?id=${story.id}&viewMode=story&globals=locale:${locale};appearance:${appearance}`)
        await page.locator('#storybook-root').waitFor()
        const result = await new AxeBuilder({ page }).include('#storybook-root').analyze()
        const serious = result.violations.filter(v => v.impact === 'serious' || v.impact === 'critical')
        expect(serious.map(v => `${locale}-${appearance} ${v.id}: ${v.nodes.length}`)).toEqual([])
      }
    })
  }
})
```

- [ ] **Step 5: Enable the a11y addon in Storybook (advisory level)**

In `apps/web/.storybook/main.ts` change `addons: ['@storybook/addon-docs', 'msw-storybook-addon']` to `addons: ['@storybook/addon-docs', '@storybook/addon-a11y', 'msw-storybook-addon']`.
In `apps/web/.storybook/preview.ts` add to the `preview` object: `parameters: { ...(existing parameters), a11y: { test: 'todo' } }` (merge with any existing `parameters` key; do not drop existing entries).

- [ ] **Step 6: Build Storybook and capture today's baselines**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim/apps/web
npm run build-storybook
npx playwright test e2e/storybook-visual.spec.ts --update-snapshots --reporter=line
npx playwright test e2e/storybook-visual.spec.ts e2e/storybook-smoke.spec.ts --reporter=line
```
Expected: first run writes PNGs under `e2e/storybook-visual.spec.ts-snapshots/`; second run passes. If the foundations axe test fails on today's UI, record the violation ids in the commit body and mark that test `test.fixme` with a comment naming Task 7 as the fix — do not change colours in this task.

- [ ] **Step 7: Commit (spec, helper, baselines)**

Add `apps/web/storybook-static` to nothing — confirm it is git-ignored (`git check-ignore apps/web/storybook-static`). Then:
```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim
git add apps/web/e2e apps/web/.storybook apps/web/package.json package-lock.json
git commit -m "test(web): add Storybook visual snapshots and axe checks

Baselines capture the pre-Tasmim UI (ar/en x light/dark).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Remove the cream appearance from the client

**Files:**
- Modify: `apps/web/app/utils/appearance.ts`
- Test: `apps/web/app/utils/__tests__/appearance.test.ts`
- Modify: `apps/web/app/components/shell/AppearanceMenu.vue:9,11`
- Modify: `apps/web/app/components/settings/BrandingPreview.vue` (cream token block, class binding, cream button)
- Modify: `apps/web/i18n/locales/{ar,en}/settings.json` (`branding.preview.modes.cream`, `appearance.cream`, `appearance.modeHint`)
- Modify: `apps/web/.storybook/preview.ts` (appearance toolbar items, `classList.remove`)
- Modify: e2e specs `shell-design.spec.ts:186-199`, `storybook-smoke.spec.ts` combos, `module-ui-rollout.spec.ts:101`, `project-dashboard.spec.ts:76`, `nuxt-project-visual.spec.ts:3`, `branding.spec.ts:11`

**Interfaces:**
- Produces: `type AppearanceMode = 'light' | 'dark'`; `type WireAppearanceMode = 'light' | 'cream' | 'dark'`; `WireAppearance.mode: WireAppearanceMode`; `HtmlAttrs.class: '' | 'dark'`. `normalizeAppearance` maps any non-`dark` mode (including `cream`) to `light`.

- [ ] **Step 1: Write the failing tests**

In `apps/web/app/utils/__tests__/appearance.test.ts` replace the cream expectations:

```ts
it('treats a stored cream preference as light', () => {
  expect(normalizeAppearance({ mode: 'cream', fontSize: 'medium' })).toEqual({ mode: 'light', fontSize: 'medium' })
  expect(appearanceFromWire({ mode: 'cream', font_size: 'large' })).toEqual({ mode: 'light', fontSize: 'large' })
})

it('only emits light or dark html classes', () => {
  expect(htmlAttrsFor({ mode: 'light', fontSize: 'small' }).class).toBe('')
  expect(htmlAttrsFor({ mode: 'dark', fontSize: 'small' }).class).toBe('dark')
})
```
Delete the table row `['cream', 'cream']` (line ~24) and the `appearancePatchBody({ mode: 'cream' })` case (line ~56); replace the latter with `expect(appearancePatchBody({ mode: 'dark' })).toEqual({ mode: 'dark' })`.

- [ ] **Step 2: Run to see it fail**

Run: `cd /Users/tariq/code/nasq/.worktrees/tasmim/apps/web && npx vitest run app/utils/__tests__/appearance.test.ts`
Expected: FAIL — `normalizeAppearance` returns `mode: 'cream'`.

- [ ] **Step 3: Implement**

In `apps/web/app/utils/appearance.ts`:

```ts
export type AppearanceMode = 'light' | 'dark'
// The server still stores 'cream' for older preferences (contract unchanged);
// the client reads it as light and never sends it.
export type WireAppearanceMode = 'light' | 'cream' | 'dark'
```
- `normalizeAppearance`: `mode: stored.mode === 'dark' ? 'dark' : 'light'` (cast `stored` as `{ mode?: unknown, fontSize?: unknown }`).
- `WireAppearance`: `mode: WireAppearanceMode`.
- `HtmlAttrs.class`: `'' | 'dark'`; `htmlAttrsFor`: `class: mode === 'dark' ? 'dark' : ''`.

- [ ] **Step 4: Run the unit tests**

Run: `npx vitest run app/utils/__tests__/appearance.test.ts`
Expected: PASS.

- [ ] **Step 5: Update the consumers**

- `AppearanceMenu.vue`: `const modes: AppearanceMode[] = ['light', 'dark']` and `modeIcons = { light: 'i-lucide-sun', dark: 'i-lucide-moon' }`.
- `BrandingPreview.vue`: delete the `cream:` block from `modeSurfaceTokens`; class binding becomes `:class="{ dark: previewMode === 'dark' }"`; delete the cream `UButton`.
- Locales: delete `settings.branding.preview.modes.cream` and `settings.appearance.cream` in both `ar` and `en`; set `appearance.modeHint` to `"اختر المظهر الفاتح أو الداكن"` (ar) and `"Choose a light or dark appearance"` (en).
- `.storybook/preview.ts`: appearance toolbar `items: ['light', 'dark']`; `root.classList.remove('dark', 'cream')` stays (harmless cleanup) but add nothing else.
- e2e specs: replace every `'cream'` mode with `'light'` where a third mode was being cycled, and delete cream-only assertions (`shell-design.spec.ts:194-195`, `branding.spec.ts:11` entry). `storybook-smoke.spec.ts` combos become `['locale:ar;appearance:light', 'locale:en;appearance:dark', 'locale:ar;appearance:dark']`.

- [ ] **Step 6: Run checks**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim
npm -w apps/web run lint && npm test 2>&1 | tail -5 && python3 -B tools/ui_policy.py
rg -n "cream" apps/web/app apps/web/i18n apps/web/.storybook apps/web/e2e | rg -v "WireAppearanceMode|stores 'cream'|remove\('dark', 'cream'\)"
```
Expected: lint/test pass. `ui_policy` FAILS only with `missing theme input :root.cream` (fixed in Task 7) — acceptable at this step; any other failure must be fixed. The `rg` lists only `brandTheme.ts`/`brandTheme.test.ts`/`tokens.css` (handled in Tasks 6–7).

- [ ] **Step 7: Commit**

```bash
git add -A apps/web
git commit -m "feat(web): drop the cream appearance from the client

Stored cream preferences render as light; the server contract is unchanged.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Nasq palette in the brand engine (midnight default, fixed rail, dark surfaces)

**Files:**
- Modify: `apps/web/app/utils/brandTheme.ts`
- Create: `apps/web/app/utils/nasqPalette.ts`
- Test: `apps/web/app/utils/__tests__/brandTheme.test.ts`, create `apps/web/app/utils/__tests__/nasqPalette.test.ts`

**Interfaces:**
- Consumes: `AppearanceMode = 'light' | 'dark'` (Task 5).
- Produces:
  - `nasqPalette.ts`: `export const NASQ_MIDNIGHT = '#13234a'`, `export const NASQ_LIME = '#c8f031'`, `export const NASQ_LIME_FOREGROUND = '#13234a'`, `export const DARK_SURFACES = { bg: '#0a1124', muted: '#0f182f', elevated: '#15203b', accented: '#1d2a48', border: '#22304f', borderMuted: '#1a2642', borderAccented: '#2c3b5e' } as const`, `export function contrastRatio(a: string, b: string): number`.
  - `brandTheme.ts`: `DEFAULT_PRIMARY === NASQ_MIDNIGHT`; `MODE_SURFACES: Record<AppearanceMode, string[]>` with no `cream` key and dark entries = `Object.values(DARK_SURFACES)`; `createBrandTheme` no longer returns `--shell-background`, `--shell-foreground`, `--shell-hover`, `--shell-active` (the rail is fixed, owned by `tokens.css`).

- [ ] **Step 1: Write the palette tests**

Create `apps/web/app/utils/__tests__/nasqPalette.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { contrastRatio, DARK_SURFACES, NASQ_LIME, NASQ_LIME_FOREGROUND, NASQ_MIDNIGHT } from '../nasqPalette'

describe('Nasq palette', () => {
  it('keeps white text readable on the midnight rail', () => {
    expect(contrastRatio('#ffffff', NASQ_MIDNIGHT)).toBeGreaterThanOrEqual(4.5)
  })
  it('keeps midnight text readable on lime fills', () => {
    expect(contrastRatio(NASQ_LIME_FOREGROUND, NASQ_LIME)).toBeGreaterThanOrEqual(4.5)
  })
  it('keeps lime visible as a bar on the rail', () => {
    expect(contrastRatio(NASQ_LIME, NASQ_MIDNIGHT)).toBeGreaterThanOrEqual(3)
  })
  it('keeps light body text readable on every dark surface', () => {
    for (const surface of [DARK_SURFACES.bg, DARK_SURFACES.muted, DARK_SURFACES.elevated, DARK_SURFACES.accented]) {
      expect(contrastRatio('#e2e8f0', surface)).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio('#94a3b8', surface)).toBeGreaterThanOrEqual(4.5)
    }
  })
})
```

- [ ] **Step 2: Extend the brand engine tests**

In `apps/web/app/utils/__tests__/brandTheme.test.ts`:
- Delete the `'preserves %s in cream mode …'` test (line ~80) and change every `['light', 'cream', 'dark'] as const` to `['light', 'dark'] as const`.
- Add:

```ts
it('defaults to Nasq midnight', () => {
  expect(DEFAULT_PRIMARY).toBe('#13234a')
})

it('no longer derives shell colours from the tenant primary', () => {
  const theme = createBrandTheme('#e11d48', 'light')
  for (const key of ['--shell-background', '--shell-foreground', '--shell-hover', '--shell-active']) {
    expect(theme).not.toHaveProperty(key)
  }
})

it.each(['#000000', '#ffffff', '#c8f031', '#ffff00', '#13234a', '#0055ff', '#e11d48', '#7c3aed'])(
  'keeps %s readable on every surface in both modes',
  (primary) => {
    for (const mode of ['light', 'dark'] as const) {
      const theme = createBrandTheme(primary, mode)
      for (const surface of MODE_SURFACES[mode]) {
        expect(contrastRatio(theme['--brand-link']!, surface)).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(theme['--ring']!, surface)).toBeGreaterThanOrEqual(3)
      }
    }
  },
)
```
Import `contrastRatio` from `../nasqPalette`.

- [ ] **Step 3: Run to see them fail**

Run: `cd /Users/tariq/code/nasq/.worktrees/tasmim/apps/web && npx vitest run app/utils/__tests__/nasqPalette.test.ts app/utils/__tests__/brandTheme.test.ts`
Expected: FAIL — `nasqPalette` module missing; `DEFAULT_PRIMARY` is `#18181b`; shell keys present.

- [ ] **Step 4: Implement `nasqPalette.ts`**

```ts
// Nasq's own identity (spec 2026-10-11 §3). Tenant colours replace the
// primary only; the midnight rail and lime accent stay Nasq's.
export const NASQ_MIDNIGHT = '#13234a'
export const NASQ_LIME = '#c8f031'
export const NASQ_LIME_FOREGROUND = '#13234a'

export const DARK_SURFACES = {
  bg: '#0a1124',
  muted: '#0f182f',
  elevated: '#15203b',
  accented: '#1d2a48',
  border: '#22304f',
  borderMuted: '#1a2642',
  borderAccented: '#2c3b5e',
} as const

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((start) => {
    const channel = Number.parseInt(hex.slice(start, start + 2), 16) / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(first: string, second: string): number {
  const a = luminance(first)
  const b = luminance(second)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}
```

- [ ] **Step 5: Update `brandTheme.ts`**

- `import { DARK_SURFACES, NASQ_MIDNIGHT, contrastRatio } from './nasqPalette'`; `export const DEFAULT_PRIMARY = NASQ_MIDNIGHT`.
- Replace the private `relativeLuminance`/`contrast` pair with `contrastRatio` where `contrast(` was used (keep `relativeLuminance` only if `interaction()` still needs it — it does, so keep that function and delete only `contrast`, renaming its call sites to `contrastRatio`).
- `MODE_SURFACES`:
  ```ts
  export const MODE_SURFACES: Record<AppearanceMode, string[]> = {
    light: ['#f6f7fb', '#ffffff', '#f8f9fc', '#eef1f7', '#f1f3f9', '#e5e8ef', '#d9dde7'],
    dark: Object.values(DARK_SURFACES),
  }
  ```
- In `createBrandTheme`: `const surface = mode === 'dark' ? DARK_SURFACES.bg : '#ffffff'`; delete the `shell` constant and the four `--shell-*` entries from the returned object.
- `BrandingPreview.vue:147` uses `var(--shell-background)`/`var(--shell-foreground)`, which no longer exist: change its inline style to `background: var(--nasq-rail); color: #fff` (the preview now shows the fixed midnight rail). Task 7 adds the `bg-nasq-rail` utility; replacing the inline style with it is left to Plan 4's settings work. Also update its `dark` block in `modeSurfaceTokens` to the `DARK_SURFACES` values (`--ui-bg: DARK_SURFACES.bg`, `--ui-bg-muted: DARK_SURFACES.muted`, `--ui-bg-elevated: DARK_SURFACES.elevated`, `--ui-bg-accented: DARK_SURFACES.accented`, `--ui-border: DARK_SURFACES.border`, `--ui-border-muted: DARK_SURFACES.borderMuted`, `--ui-border-accented: DARK_SURFACES.borderAccented`, text `#e2e8f0`, muted text `#94a3b8`).

- [ ] **Step 6: Run the tests**

Run: `npx vitest run app/utils/__tests__/ && cd ../.. && npm -w apps/web run lint`
Expected: PASS. If a sampled primary fails link/ring contrast in dark mode, the fix belongs in `contrastTone` (it already walks toward white/black) — check that `MODE_SURFACES.dark` is the list it iterates; do not weaken the thresholds.

- [ ] **Step 7: Commit**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim
git add -A apps/web/app
git commit -m "feat(web): add Nasq palette and fixed rail to the brand engine

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Tokens, recipes and density

**Files:**
- Modify: `apps/web/app/assets/css/tokens.css`
- Modify: `apps/web/app/app.config.ts`
- Modify: `tools/ui_policy.py:442-470` (`ALLOWED_RECIPE_KEYS` unchanged, `REQUIRED_TOKENS`, radius rule) and `tools/test_ui_policy.py:390-410` (`whole()` fixture)
- Create: `apps/web/stories/foundations/Density.stories.ts`
- Modify: `apps/web/stories/foundations/Colors.stories.ts` (Nasq group)
- Create: `apps/web/e2e/storybook-density.spec.ts`

**Interfaces:**
- Consumes: `NASQ_*`, `DARK_SURFACES` values (Task 6, copied as CSS literals).
- Produces CSS custom properties used by Plans 2–5: `--nasq-midnight`, `--nasq-lime`, `--nasq-lime-foreground`, `--nasq-control-h` (2.285714rem = 32px at 14px root), `--nasq-row-h` (2.571429rem = 36px), `--nasq-rail` (fixed midnight), `--nasq-rail-deep`, `--rail-hover`; Tailwind utilities `bg-nasq-lime`, `text-nasq-lime-foreground`, `bg-nasq-rail`, `bg-nasq-midnight`.
- Story ids: `foundations-density--controls`, `foundations-density--table`.

- [ ] **Step 1: Write the density story**

Create `apps/web/stories/foundations/Density.stories.ts`:

```ts
import type { Meta, StoryObj } from '@storybook/vue3-vite'

export default { title: 'Foundations/Density' } satisfies Meta

export const Controls: StoryObj = {
  name: 'الحقول والأزرار',
  render: () => ({
    template: `
      <div class="flex flex-wrap items-center gap-2 p-4" data-testid="density-controls">
        <UButton data-testid="density-button">حفظ</UButton>
        <UButton color="neutral" variant="outline">إلغاء</UButton>
        <UInput data-testid="density-input" placeholder="بحث" />
        <USelect :items="['أ', 'ب']" model-value="أ" />
        <UBadge data-testid="density-badge">قيد التنفيذ</UBadge>
        <span class="inline-flex items-center rounded-md bg-nasq-lime px-2 text-xs font-medium text-nasq-lime-foreground" data-testid="density-lime">جديد</span>
      </div>`,
  }),
}

export const Table: StoryObj = {
  name: 'الجدول',
  render: () => ({
    setup: () => ({
      rows: [
        { name: 'مشروع البوابة', owner: 'سارة', due: '2026-11-02' },
        { name: 'تحديث الأنظمة', owner: 'خالد', due: '2026-11-15' },
        { name: 'Onboarding', owner: 'Lina', due: '2026-12-01' },
      ],
    }),
    template: '<div class="p-4"><UCard data-testid="density-card"><UTable :data="rows" data-testid="density-table" /></UCard></div>',
  }),
}
```

- [ ] **Step 2: Write the failing density spec**

Create `apps/web/e2e/storybook-density.spec.ts`:

```ts
import { expect, test } from '@playwright/test'
import { startStorybookServer, storybookBuilt } from './support/storybookServer'

let base = ''
let close: () => Promise<void> = async () => {}
const url = (id: string, globals: string) => `${base}/iframe.html?id=${id}&viewMode=story&globals=${globals}`

test.describe('Tasmim density', () => {
  test.skip(!storybookBuilt, 'Run `npm -w apps/web run build-storybook` first.')
  test.beforeAll(async () => { ({ base, close } = await startStorybookServer()) })
  test.afterAll(async () => { await close() })

  for (const [globals, root] of [
    ['locale:ar;appearance:light;fontSize:small', 14],
    ['locale:en;appearance:light;fontSize:small', 13],
    ['locale:ar;appearance:dark;fontSize:large', 18],
  ] as const) {
    test(`controls and rows scale with a ${root}px root (${globals})`, async ({ page }) => {
      await page.goto(url('foundations-density--controls', globals))
      const scale = root / 14
      const button = await page.getByTestId('density-button').boundingBox()
      const input = await page.getByTestId('density-input').locator('input').boundingBox()
      expect(Math.abs(button!.height - 32 * scale)).toBeLessThanOrEqual(1)
      expect(Math.abs(input!.height - 32 * scale)).toBeLessThanOrEqual(1)
      const radius = await page.getByTestId('density-button').evaluate(el => Number.parseFloat(getComputedStyle(el).borderTopLeftRadius))
      expect(Math.abs(radius - 6 * scale)).toBeLessThanOrEqual(0.6)

      await page.goto(url('foundations-density--table', globals))
      const row = await page.getByTestId('density-table').locator('tbody tr').first().boundingBox()
      expect(Math.abs(row!.height - 36 * scale)).toBeLessThanOrEqual(1)
      const cardRadius = await page.getByTestId('density-card').evaluate(el => Number.parseFloat(getComputedStyle(el).borderTopLeftRadius))
      expect(Math.abs(cardRadius - 8 * scale)).toBeLessThanOrEqual(0.6)
    })
  }
})
```

- [ ] **Step 3: Run to see it fail**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim/apps/web
npm run build-storybook && npx playwright test e2e/storybook-density.spec.ts --reporter=line
```
Expected: FAIL (heights/radii are today's values; `bg-nasq-lime` has no colour).

- [ ] **Step 4: Rewrite `tokens.css`**

Apply these changes (keep every token not mentioned; Plans 2–5 retire the rest):
1. Header comment: describe "Nasq identity (midnight + lime), light/dark modes, dense type and shape".
2. `@theme`: add `--text-2xl: 1.714286rem;` (24px at 14px root). Keep the Plex Arabic font stack — it covers Latin glyphs, so no second family is loaded.
3. `:root`:
   - `--ui-radius: 0.285714rem;` (4px at 14px root, so Nuxt UI's `rounded-md` = 6px and `rounded-lg` = 8px).
   - Default primary family from midnight: `--primary: #13234a; --primary-hover: #2f3c5f; --primary-active: #4a5573; --brand-link: #13234a;` (foregrounds `#fff`). `brandTheme.ts` overwrites these at runtime; the defaults only matter before hydration.
   - Add `--nasq-midnight: #13234a; --nasq-lime: #c8f031; --nasq-lime-foreground: #13234a;`
   - Add `--nasq-control-h: 2.285714rem; --nasq-row-h: 2.571429rem;`
   - Replace the rail lines with fixed values: `--nasq-rail: #13234a; --nasq-rail-deep: #0d1a38; --rail-hover: #1f3160;`
   - Chart defaults: `--chart-1: #13234a; --chart-2: #3a5191; --chart-3: #6b7fb8; --chart-4: #9ab0d8; --chart-5: #5b6b8c; --chart-6: #8b97b1;`
4. Font sizes: keep `[data-font-size="medium"]` 16px and `large` 18px, and add
   ```css
   :root:lang(en) { font-size: 13px; }
   :root:lang(en)[data-font-size="medium"] { font-size: 15px; }
   :root:lang(en)[data-font-size="large"] { font-size: 17px; }
   ```
5. Delete the whole `:root.cream { … }` block.
6. `.dark` block becomes:
   ```css
   .dark {
     color-scheme: dark;
     --ui-bg: #0a1124;
     --ui-bg-muted: #0f182f;
     --ui-bg-elevated: #15203b;
     --ui-bg-accented: #1d2a48;
     --ui-border: #22304f;
     --ui-border-muted: #1a2642;
     --ui-border-accented: #2c3b5e;
     --ui-text: #e2e8f0;
     --ui-text-highlighted: #f8fafc;
     --ui-text-muted: #94a3b8;
     --ui-text-toned: #cbd5e1;
     --ui-text-dimmed: #94a3b8;
     --nasq-rail: #0d1a38;
     --nasq-rail-deep: #081129;
     --rail-hover: #1a2a52;
     --unread-count-foreground: var(--ui-bg);
   }
   ```
7. `@theme inline`: add `--color-nasq-midnight: var(--nasq-midnight); --color-nasq-lime: var(--nasq-lime); --color-nasq-lime-foreground: var(--nasq-lime-foreground); --color-nasq-rail: var(--nasq-rail);`

- [ ] **Step 5: Rewrite `app.config.ts` recipes**

```ts
export default defineAppConfig({
  ui: {
    // Tasmim recipes (DESIGN.md «وصفات الثيم المعتمدة»). Colours: tenant primary
    // from settings (utils/brandTheme.ts), slate neutral, Nasq midnight/lime in
    // tokens.css. Sizes come from tokens: --nasq-control-h, --nasq-row-h,
    // --ui-radius (rounded-md = 6px, rounded-lg = 8px at the 14px root).
    colors: { primary: 'brand', neutral: 'slate' },

    button: { slots: { base: 'rounded-md min-h-(--nasq-control-h) transition-colors duration-150 motion-reduce:transition-none' } },
    input: { slots: { base: 'rounded-md min-h-(--nasq-control-h) bg-default' } },
    inputNumber: { slots: { base: 'rounded-md min-h-(--nasq-control-h) bg-default' } },
    textarea: { slots: { base: 'rounded-md bg-default' } },
    select: { slots: { base: 'rounded-md min-h-(--nasq-control-h) bg-default', content: 'z-[var(--nasq-ui-z-menu)] rounded-lg shadow-lg ring ring-default' } },
    selectMenu: { slots: { base: 'rounded-md min-h-(--nasq-control-h) bg-default', content: 'z-[var(--nasq-ui-z-menu)] rounded-lg shadow-lg ring ring-default' } },

    // Surfaces: hairline ring, no resting shadow, compact padding.
    card: { slots: { root: 'rounded-lg ring ring-default shadow-none', header: 'px-4 py-3', body: 'p-3 sm:p-4', footer: 'px-4 py-3' } },
    table: {
      slots: {
        th: 'h-(--nasq-row-h) px-3 py-0 text-xs font-medium text-muted',
        td: 'h-(--nasq-row-h) px-3 py-0 text-sm',
        tr: 'transition-colors hover:bg-elevated/50 data-[selected=true]:bg-primary/5',
      },
    },

    badge: { slots: { base: 'rounded-md' } },
    progress: { slots: { base: 'rounded-full', indicator: 'rounded-full' } },
    avatar: { slots: { root: 'ring-2 ring-bg' } },
    tabs: { slots: { list: 'rounded-md', indicator: 'rounded-sm', trigger: 'rounded-sm' } },

    // Floating layers carry the only shadows.
    dropdownMenu: { slots: { content: 'z-[var(--nasq-ui-z-menu)] rounded-lg shadow-lg ring ring-default' } },
    popover: { slots: { content: 'z-[var(--nasq-ui-z-menu)] rounded-lg shadow-lg ring ring-default' } },
    tooltip: { slots: { content: 'z-[var(--nasq-ui-z-menu)] rounded-md' } },
    slideover: { slots: { content: 'z-[var(--nasq-ui-z-sheet)]' } },
    modal: { slots: { content: 'z-[80] rounded-lg shadow-xl', overlay: 'z-[79] backdrop-blur-xs' } },
  },
})
```

- [ ] **Step 6: Update the policy rules and their test**

In `tools/ui_policy.py`:
```python
REQUIRED_TOKENS = ('--color-brand-500', 'IBM Plex Sans Arabic', '--nasq-midnight', '--nasq-lime', '.dark')
RETIRED_TOKENS = ('--nasq-radius', '--elevation-1', '--content-shadow', '--radius:', ':root.cream')
```
Radius rule: replace `r'--ui-radius:\s*0\.5rem'` with `r'--ui-radius:\s*0\.285714rem'` and the message with `'--ui-radius is the one official radius token (4px base: md 6px, lg 8px)'`. Update the comment above `ALLOWED_RECIPE_KEYS` to "brand primary, slate neutral, Nasq midnight/lime, the official --ui-radius token, the Arabic font and the light/dark modes".
In `tools/test_ui_policy.py` `whole()`: tokens fixture becomes `":root { --color-brand-500: #06c; --ui-radius: 0.285714rem; --nasq-midnight: #13234a; --nasq-lime: #c8f031;\n" … "\n.dark { color: #fff; }"` (drop `:root.cream`). Add a test:

```python
    def test_cream_mode_is_retired(self):
        snapshot = self.whole(**{APP + "assets/css/tokens.css": self.whole()[APP + "assets/css/tokens.css"] + "\n:root.cream { color: #000; }"})
        self.assertIn(APP + "assets/css/tokens.css: retired token :root.cream", policy.theme_errors(snapshot))
```

- [ ] **Step 7: Add the Nasq group to the colour story**

In `stories/foundations/Colors.stories.ts` add
`export const Nasq: StoryObj = { ...table(colorNames('nasq')), name: 'هوية نسق' }` — check `groupTokens` prefixes: `--nasq-midnight` and `--nasq-lime` share the `nasq` prefix with `--nasq-surface`; if that makes `Surfaces` duplicate them, remove `'nasq'` from the `Surfaces` prefix list.

- [ ] **Step 8: Run all checks**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim
npm -w apps/web run lint && npm test 2>&1 | tail -5
python3 -B tools/ui_policy.py && python3 -B -m unittest tools.test_ui_policy -q
cd apps/web && npm run build-storybook && npx playwright test e2e/storybook-density.spec.ts e2e/storybook-smoke.spec.ts --reporter=line
```
Expected: all pass. If the `min-h-(--nasq-control-h)` utility is not generated (button height unchanged), confirm Tailwind 4.3 parses `min-h-(--var)`; the fallback is `min-h-[var(--nasq-control-h)]`, and `ui_policy`'s arbitrary-value rule must still pass — report which form was used.

- [ ] **Step 9: Commit**

```bash
git add -A apps/web tools/ui_policy.py tools/test_ui_policy.py
git commit -m "feat(web): apply Tasmim tokens, density and recipes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Temporary text wordmark

**Files:**
- Create: `apps/web/app/components/shared/BrandWordmark.vue`
- Create: `apps/web/stories/shared/BrandWordmark.stories.ts`
- Test: `apps/web/app/components/shared/__tests__/BrandWordmark.test.ts`
- Modify: `tools/ui_policy.py` (`STORYBOOK_COMPONENTS` += `'shared/BrandWordmark.vue'`), `apps/web/i18n/locales/{ar,en}/common.json` (`brand.name`), `docs/design-system/components.md`

**Interfaces:**
- Produces: `<SharedBrandWordmark size="sm|md|lg" :inverted="boolean" />` — renders `t('brand.name')` (ar «نَسَق», en «Nasq») followed by a decorative lime dot (`aria-hidden="true"`). Plan 2 places it in the rail and on the login page.

- [ ] **Step 1: Write the failing test**

```ts
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { createI18n } from 'vue-i18n'
import BrandWordmark from '../BrandWordmark.vue'

const i18n = createI18n({ legacy: false, locale: 'ar', messages: { ar: { brand: { name: 'نَسَق' } } } })

describe('BrandWordmark', () => {
  it('renders the product name and a decorative lime dot', () => {
    const wrapper = mount(BrandWordmark, { global: { plugins: [i18n] } })
    expect(wrapper.text()).toBe('نَسَق')
    const dot = wrapper.find('[data-slot="dot"]')
    expect(dot.attributes('aria-hidden')).toBe('true')
    expect(dot.classes()).toContain('bg-nasq-lime')
  })
  it('uses white text when inverted', () => {
    const wrapper = mount(BrandWordmark, { props: { inverted: true }, global: { plugins: [i18n] } })
    expect(wrapper.classes()).toContain('text-white')
  })
})
```
Check how sibling tests in `components/shared/__tests__/` mount components with i18n (e.g. `UnsavedChanges.test.ts`) and follow that helper if one exists instead of the inline `createI18n`.

- [ ] **Step 2: Run to see it fail**

Run: `cd apps/web && npx vitest run app/components/shared/__tests__/BrandWordmark.test.ts`
Expected: FAIL — component missing.

- [ ] **Step 3: Implement**

```vue
<script setup lang="ts">
// Temporary Nasq wordmark until an SVG logo exists (spec 2026-10-11 §2).
const props = withDefaults(defineProps<{ size?: 'sm' | 'md' | 'lg', inverted?: boolean }>(), { size: 'md', inverted: false })
const { t } = useI18n()
const text = { sm: 'text-sm', md: 'text-base', lg: 'text-xl' } as const
const dot = { sm: 'size-1.5', md: 'size-2', lg: 'size-2.5' } as const
</script>

<template>
  <span class="inline-flex items-baseline gap-1 font-semibold" :class="[text[props.size], props.inverted ? 'text-white' : 'text-highlighted']">
    {{ t('brand.name') }}<span data-slot="dot" aria-hidden="true" class="inline-block rounded-full bg-nasq-lime" :class="dot[props.size]" />
  </span>
</template>
```
Add `"brand": { "name": "نَسَق" }` to `ar/common.json` and `"brand": { "name": "Nasq" }` to `en/common.json` (merge with an existing `brand` key if present).

- [ ] **Step 4: Story**

```ts
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import BrandWordmark from '../../app/components/shared/BrandWordmark.vue'

export default { title: 'Shared/BrandWordmark', component: BrandWordmark } satisfies Meta<typeof BrandWordmark>
export const Default: StoryObj<typeof BrandWordmark> = { args: { size: 'md' } }
export const OnRail: StoryObj<typeof BrandWordmark> = {
  args: { size: 'lg', inverted: true },
  render: args => ({ components: { BrandWordmark }, setup: () => ({ args }), template: '<div class="bg-nasq-rail p-4"><BrandWordmark v-bind="args" /></div>' }),
}
```
Follow the `storyContext(...)` convention if the sibling stories in `stories/shared/` use it (check `EmptyState.stories.ts`) — `ui_policy` story checks require it.

- [ ] **Step 5: Run checks and commit**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim
(cd apps/web && npx vitest run app/components/shared/__tests__/BrandWordmark.test.ts)
npm -w apps/web run lint && npm test 2>&1 | tail -5 && python3 -B tools/ui_policy.py
git add -A apps/web tools/ui_policy.py docs/design-system/components.md
git commit -m "feat(web): add temporary Nasq text wordmark

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: DESIGN.md foundations, docs and catalog

**Files:**
- Modify: `DESIGN.md` (intro reference paragraph, §1 «الأساس», §2 «اللون», «وصفات الثيم المعتمدة» table)
- Modify: `docs/design-system/nuxt-ui-reference.md` (theme inputs paragraph)
- Regenerate: `docs/design-system/catalog.json`

**Interfaces:** documentation only; later plans rewrite the shell, template and page sections of `DESIGN.md`.

- [ ] **Step 1: Rewrite the foundations in DESIGN.md (Arabic, matching the file's voice)**

Replace:
- The «المرجع البصري المعتمد» paragraph: the approved reference is now the Tasmim spec (`docs/superpowers/specs/2026-10-11-nasq-tasmim-design.md`); Nuxt UI stays the component library, styled by Nasq's tokens and recipes.
- §1: theme inputs = tenant primary (feeds `primary`), `slate` neutral, Nasq midnight `#13234a` and lime `#c8f031`, IBM Plex Sans Arabic (covers Latin) with three font sizes, **two** appearances (light/dark); density tokens `--nasq-control-h` (32px) and `--nasq-row-h` (36px); radius 6/8px via `--ui-radius: 0.285714rem`; shadows only on floating layers. State that the shell geometry is being redone in Tasmim Plan 2 and the current numbers remain until then.
- §2 colour table: add rows «هوية نسق — الأزرق الليلي» (default primary, replaced by tenant colour) and «التمييز — الليموني» (fixed; fill with midnight text, dot or bar; never text on light surfaces; used for active rail bar, unread dot, 100% progress, logo, first empty-state action); change «شريط الموديولات» to «ثابت بالأزرق الليلي `--nasq-rail`، لا يتبع لون العميل».
- Remove every mention of «كريمي» / cream in DESIGN.md.
- «وصفات الثيم المعتمدة» table: one row per key in the new `app.config.ts` (Task 7 Step 5) with its recipe and intent.

- [ ] **Step 2: Update the technical reference and regenerate the catalog**

In `docs/design-system/nuxt-ui-reference.md` update the theme-inputs paragraph to match §1. Then:
```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim && node tools/ui_catalog.mjs && git diff --stat docs/design-system/catalog.json
```
Expected: catalog reflects the moved components and `BrandWordmark`.

- [ ] **Step 3: Check and commit**

```bash
rg -n "كريمي|cream" DESIGN.md docs/design-system/ ; python3 -B tools/ui_policy.py
git add DESIGN.md docs/design-system
git commit -m "docs(web): document Tasmim foundations in DESIGN.md

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Expected: `rg` prints nothing; policy passes.

---

### Task 10: Checkpoint CP1 — new baselines, full gates, owner review

**Files:**
- Regenerate: `apps/web/e2e/storybook-visual.spec.ts-snapshots/*`
- Create (scratchpad only, not committed): CP1 screenshots

- [ ] **Step 1: Re-baseline the visual snapshots on the new foundations**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim/apps/web
npm run build-storybook
npx playwright test e2e/storybook-visual.spec.ts --reporter=line 2>&1 | tail -5   # expected: diffs (old look)
npx playwright test e2e/storybook-visual.spec.ts --update-snapshots --reporter=line
npx playwright test e2e/storybook-visual.spec.ts e2e/storybook-density.spec.ts e2e/storybook-smoke.spec.ts --reporter=line
```
Expected: last run passes, including the foundations axe test (remove any `test.fixme` added in Task 4).

- [ ] **Step 2: Full gates**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim
npm test 2>&1 | tail -5
npm -w apps/web run lint
python3 -B tools/ui_policy.py && python3 -B -m unittest tools.test_ui_policy -q
python3 -B tools/arch_policy.py --base main && python3 -B tools/git_policy.py --base main
```
Expected: all exit 0.

- [ ] **Step 3: Mock e2e regression diff**

Start the mock stack as in Task 1 Step 4 and run the same command, writing to `$SCRATCH/e2e-cp1-failures.txt`; then `diff $SCRATCH/e2e-baseline-failures.txt $SCRATCH/e2e-cp1-failures.txt`.
Expected: no new failing titles. A new failure caused by the denser controls (e.g. a click target moved) is fixed in the owning component's recipe use, not by editing the spec's expectation, unless the spec asserted a cream/rail-colour fact that the spec 2026-10-11 deliberately changed — list those explicitly.

- [ ] **Step 4: Commit the baselines**

```bash
git add apps/web/e2e
git commit -m "test(web): re-baseline visual snapshots on Tasmim foundations

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Present CP1 to the owner**

Collect into the scratchpad: the `Foundations/Colors` (Nasq, Brand, Surfaces), `Foundations/Density` and `Shared/BrandWordmark` snapshots for ar-light, ar-dark, en-light, en-dark, plus one before/after pair of `shared-pageheader` and `task-taskcard`. Send them with `SendUserFile` and ask the owner to approve or adjust the exact midnight, lime and dark-surface values. Plan 2 does not start until the owner approves CP1.

---

## Roadmap — later plans (each written after the previous checkpoint)

| Plan | Spec phases | Ends at |
|---|---|---|
| 2 — Shell | 2: header 48px, rail 64px fixed midnight with lime bar and wordmark, context sidebar 232px collapsible with `[`, mobile drawer, stories for every shell part, `ContextSidebar` stops importing `chat/ConversationList` (chat manifest supplies it), drop `data-project-theme`/`data-workspace-theme`, `UDashboard*` prototype vs custom shell decision | CP2 |
| 3 — Command palette and shortcuts | 3: `ShellGlobalSearch` on `UCommandPalette`, `commands` field in manifests with capability gating, `defineShortcuts({ … }, { layoutIndependent: true })` verified on an Arabic layout, `?` help dialog | CP3 |
| 4 — Templates and states | 4: `ListPage`/`DataTable`, `RecordPage`/`PropertiesPanel`/`PropertyRow`/`RecordSection`, `DashboardPage`/`ChartPanel`, `TimelineFrame`, `ConversationLayout`, `SettingsPage` (from `SettingsLayout`), `StandalonePage` with print sheet, `LoadingSkeleton`/`ErrorState`/`ForbiddenState`/`NotFoundState` with `PageState` facade, `StatusBadge` merge, `FilterCard`→`FilterBar`, `InvoiceLines` merge, tab helper merge | CP4 |
| 5 — Pilot | 5: `/projects` and `/projects/[id]` on the templates | CP5 (decisive) |
| 6 — Rollout | 6: one sub-plan per app on `codex/web-tasmim-<app>` sub-branches (PMO, HR, Meetings incl. splitting `meetings/[id].vue`, Chat, Settings/Account, Subscription, Vendor) | per-app shots |
| 7 — Close-out | 7: remove leftover `nasq-*` classes, scoped and inline styles (RichText and Gantt last), final `DESIGN.md`, merge `main` in, full gates, review, owner-authorized `--no-ff` merge | owner merge approval |
