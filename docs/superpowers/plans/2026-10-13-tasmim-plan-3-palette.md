# Tasmim Plan 3 — Command palette and keyboard shortcuts

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver phase 3 of the spec. The header search becomes a command palette on `UCommandPalette` with Go to, Search and Actions groups, and a shortcut-help view inside the same overlay. Manifests can declare `commands` and `goKey`s. One layout-aware keyboard layer handles `⌘K`/`Ctrl K`, `/`, `C`, `G` then a letter, `J`/`K`/`Enter`, `Esc`, `?` and `[`. It works on Arabic keyboards and never fires while the user is typing. The plan ends at owner checkpoint CP3.

**Architecture:** One pure keymap (`composables/shortcuts/keymap.ts`) normalizes a keydown and decides every shortcut. Its rule: the Latin character when there is one, otherwise the US physical position. One capture-phase shell listener (`composables/useShellShortcuts.ts`, called once by `ShellHeader`) dispatches palette, help, list search, create and go-to. The `[` listener in `AppSidebar` and the J/K listeners (`TaskDetailPanel`, new `useRowNavigation`) reuse the same predicates. The palette stays in `shell/GlobalSearch.vue`, which is the one approved search overlay. Its state lives in `usePalette()` (`useState`). A pure model (`composables/nav/paletteModel.ts`) builds its groups from three sources: `useNav` for Go to, `useAppSearch` for Search, and a new optional `AppManifest.commands` for Actions. Applications reach the shell only through `app/modules/<app>/manifest.ts` (`commands`, `nav[].goKey`). Pages opt in to `/`, `C` and row navigation with `data-shortcut-*` attributes. No Odoo, contract or API change.

**Tech Stack:** Nuxt 4.6, Nuxt UI 4.11.1 (`UCommandPalette`, `UModal`, `UKbd`, `UTooltip`), reka-ui Listbox/Dialog, Tailwind 4.3, Storybook 10.6, Playwright 1.62, Vitest 4, `@tanstack/vue-query`, Python policy checks in `tools/`.

**Spec:** `docs/superpowers/specs/2026-10-11-nasq-tasmim-design.md` (§5 command palette and shortcuts table, §6 product contracts, §10 phase 3, §11, §13 "Arabic shortcut layouts")

## Owner amendments (2026-10-13, CP2 decisions — binding, override any task text below)

1. The lime focus ring on the module rail is approved as Plan 2 built it. No change.
2. English rail labels keep the ellipsis and the full-name tooltip (`title`). No change.
3. The vendor console badge text becomes «الكونسول» / "Console". Task 2 does this.
4. A more prominent dark-mode primary button is deferred to Plan 4 (templates and states). It is not part of this plan. Do not touch the dark `--ui-primary` steps or the button recipes here.

## Decision: one keymap, not `defineShortcuts`

Spec §5 names `defineShortcuts` with `layoutIndependent: true` and asks for verification against Nuxt UI 4.11.1 in phase 3 (§13). The source shows it cannot carry the shortcut table:

| Evidence (`node_modules/@nuxt/ui/dist/runtime/…`) | Consequence for Nasq |
|---|---|
| `composables/defineShortcuts.js:7-30` `convertKeyToCode` maps only letters, digits, F-keys and nine named keys. `:194-198` passes the base key through it, and `:109-112` compares `e.code !== shortcut.key`. | `/` (`Slash`), `?` (`Shift`+`Slash`) and `[` (`BracketLeft`) can never match in layout-independent mode. Without that mode, `:118` compares `e.key`, which is «ظ», «؟» and «ج» on an Arabic layout. |
| `:152-160` `usingInput` reads only `activeElement` `INPUT`/`TEXTAREA`/`contenteditable="true"\|"plaintext-only"`. | It misses `<select>` and `contenteditable=""`, and ignores open menus and dialogs. `isEditableKeyTarget` and `overlayOwnsEscape` (`composables/useEscapeBack.ts:17-34`) already cover these. |
| `:81-151` `onKeyDown` never reads `isComposing` or `keyCode 229`. | A key still held by an IME would fire a shortcut. |
| `:89-105` matches chained shortcuts on the last two codes with no modifier check. | `Ctrl`+`G` then `P` would fire `g-p`. |
| `:208-211` turns `meta_` into `ctrl_` outside macOS. | `⌘K` and `Ctrl K` on a Mac need two entries. Easy to work around; the rows above are what decide. |
| `:85-86` layout-independent mode reads only `e.code`. | An AZERTY user pressing the key labelled M (code `Semicolon`) never gets `m`. |
| `components/CommandPalette.vue:304-306` item `kbds` only render `UKbd`. The palette registers no shortcut. | Key hints in the palette are display only. Binding stays in our layer. |

So `composables/shortcuts/keymap.ts` decides every shortcut with one rule (`shortcutKey`):

- If the key types a Latin letter, a digit, or the shortcut symbol itself, that character is the key. QWERTY, AZERTY, QWERTZ and Dvorak therefore follow their labels.
- Otherwise the US physical position (`event.code`) is used. This covers Arabic and other non-Latin layouts, and dead keys.

Examples:

- Arabic: «ل» then «ح» is `G P`, «ج» is `[`, «ظ» is `/` and «؟» is `?`.
- QWERTZ: `[` is the `ü` key, matched by position because it types no `[`.
- AZERTY: `[` is the `^` dead key, matched by position. `?` is `Shift`+`,`, matched by its character.

Plan 2's `event.code === 'BracketLeft'` rule (`composables/nav/sidebarShortcut.ts:15`) moves onto this rule (deferred item b). `tools/ui_policy.py` then forbids `defineShortcuts(` under `apps/web/app`, so no second layer can appear.

## Decision: the shortcut help is a palette view; `GlobalSearch.vue` keeps its name

`?` opens the same `UModal` in its `shortcuts` view. No overlay type is added, and `OVERLAY_OWNERS` (`tools/ui_policy.py:400`) stays `{shell/GlobalSearch.vue}`. Renaming the file would change `OVERLAY_OWNERS`, `STORYBOOK_COMPONENTS`, the `shell-globalsearch--*` baselines and `components.md` without changing any behaviour. Instead, the file's header comment states that it is the command palette.

Palette and dialog facts this plan relies on (Nuxt UI 4.11.1 / reka-ui):

- **Fuse defaults.** `CommandPalette.vue:96-104` sets `threshold 0.1`, `matchAllWhenSearchEmpty` and `resultLimit 12`, and `:128` applies that limit to every group. The palette passes a larger `fuse.resultLimit` so a search section is not cut at 12.
- **Group handling.** `:113-115` and `:175-195`: `ignoreFilter` groups keep provider results unfiltered. `:149-165`: `preserveGroupOrder`.
- **Slots.** `:353-368` `#close`, `:403-407` `#empty`, `:410-412` `#footer`, `:295-309` `#item-trailing`.
- **Enter.** `reka-ui/dist/Listbox/ListboxRoot.js:160-166` clicks the highlighted element unless an IME is composing. Items with `to` therefore navigate like links.
- **Focus.** `Modal.vue:21,72` binds the `content` prop onto `DialogContent`. `reka-ui/dist/Dialog/DialogContentImpl.js:57` records the element focused at open; the trigger is recorded when focus was on `<body>`. `DialogContentModal.js:70-73` restores focus to it on close unless `closeAutoFocus` is prevented.

## Global Constraints

- Work only in `/Users/tariq/code/nasq/.worktrees/tasmim` on branch `codex/web-tasmim`. Never commit to or push `main`.
- Commit subjects: `type(web|tools): imperative subject`, ≤ 72 chars, with `type` ∈ `feat fix refactor perf test docs ci build chore`. One logical change per commit. End every message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `npm -w apps/web run lint` (from the worktree root; never `npx -w`) and `npm test` must be green at **every** commit.
- No changes under `odoo-addons/`, `packages/contracts/` or `apps/control-plane/`. No new API endpoint and no new request. The palette reuses the manifest search providers (`GET /api/v1/projects?minimal=1`, `GET /api/v1/tasks?filter=mine&q=…`).
- No route or visible-heading change. Existing `data-testid`s are kept. New ones: `global-search-trigger`, `command-palette`, `palette-back`, `palette-footer`. Never rename an e2e test title: the failing-title diff keys on titles. Where the palette changes the DOM (results become `role="option"`), update the assertion in place and list it in the commit body.
- R3: nothing under `components/shell/` or `layouts/` imports or tags an application component folder (`project task meetings hr chat`) or `modules/<app>`. Task 1 hardens this scan. The shell names no application:
  - applications contribute `commands` and `goKey` through their manifest;
  - pages opt in with the `data-shortcut-search`, `data-shortcut-create` and `data-shortcut-row` attributes.
- `tools/arch_baseline.json` only shrinks, and only through `python3 -B tools/arch_policy.py --write-baseline`. `tools/arch_layers.json` is not touched.
- **One keyboard layer.** Every shortcut matches through `composables/shortcuts/keymap.ts` (`shortcutKey`, `plainShortcutBlocked`, `matchShortcut`). No `defineShortcuts`, and no `event.key === '<letter>'` in new code.
- **When shortcuts are inactive.** A plain shortcut does nothing:
  - before hydration;
  - while typing (`isEditableKeyTarget`: input, textarea, select, contenteditable);
  - with `Ctrl`/`⌘`/`Alt` held;
  - during IME composition (`isComposing` or `keyCode 229`);
  - on auto-repeat or an already handled key;
  - while any reka layer is mounted (`overlayOwnsEscape(document)`: menus, popovers, dialogs, the palette).

  `⌘K`/`Ctrl K` is the one exception: it also works while typing and while the palette is open, where it toggles the palette.
- **Overlays.** The palette is the one search overlay. The `?` help is its `shortcuts` view. No new `UModal`, `USlideover` or `UDrawer`. DESIGN.md's three exceptions (search, bell, unsaved draft) stay three.
- Logical properties only (`ms- me- ps- pe- start- end- text-start`, `inset-inline-*`). Direction icons flip with `rtl:-scale-x-100`.
- `useHydrated()`: the palette trigger stays disabled until hydrated, and the shell layer ignores keys until then.
- i18n: every new string goes in `apps/web/i18n/locales/{ar,en}/common.json` with ar/en parity:
  - palette strings under the existing `search.*`;
  - shortcut strings under a new `shortcuts.*`;
  - command labels reuse the owning application's existing keys (`nav.newProject`, `tasks.new`, `meetingsUi.newSeries`, `hr.*`).
- **Stories.** Every story uses `storyContext(...)`. `GlobalSearch.vue` is already in `STORYBOOK_COMPONENTS`, and this plan adds no new `.vue` component. Run `node tools/ui_catalog.mjs` in the same commit as any story change. After editing a cited file, run `python3 -B tools/ui_policy.py --refresh-story-context`.
- **Ports and processes.** Never use ports 3000/8069 or the `odoo19` database. The mock stack is Nuxt 4097 plus mock API 4498. Start background processes with `& PID=$!` and wait on that PID (`while kill -0 "$PID" 2>/dev/null; do sleep 1; done`). Never use `pgrep -f`. If `npx nuxt dev` leaves a child on 4097 after `kill`, stop it by port: `lsof -ti tcp:4097 | xargs kill`.
- Tasks run sequentially. A test the plan asks for is never weakened to pass. If a step's expected output differs, report it instead of editing the expectation.

## Review Focus

1. **An Arabic typist.** Typing «لحق» in a field, in the palette input or in rich text never triggers `G`, `C`, `/` or `?`. Outside a field on the Arabic layout, «ل» then «ف» (physical `G` `T`) opens `/tasks`. Pinned in Task 3 (`keymap.test.ts` "Arabic layout" and "while typing" cases) and Task 6 (`shortcuts-tasmim.spec.ts` "G then P navigates by label and on an Arabic layout, never while typing").
2. **Two applications claim one `G` letter**, for example a new app declaring `goKey: 'p'`. Expected: `npm test` fails and names the letter and both targets. Pinned in Task 4 (`manifests.test.ts` real-manifest check and `paletteModel.test.ts` "a new application that reuses p").
3. **The palette shows an action the user cannot perform**, for example to a reader without `pmo.projects.create` or to a read-only tenant (`writable_features: []`). Expected: Actions has no «مشروع جديد». Pinned in Task 4 (`paletteModel.test.ts` `visibleCommands`) and Task 5 (`storybook-shell.spec.ts` "Actions hide commands the user cannot run").
4. **Focus after Esc or a selection.** Opened from the trigger, Esc returns focus to the trigger. Opened with `⌘K` from a focused link, Esc returns focus to that link. After Enter opens a page, focus is on `<main>`. Pinned in Task 5 (`storybook-shell.spec.ts` "Esc closes and returns focus…") and Task 6 (`shortcuts-tasmim.spec.ts` "Enter on a Go to option…").
5. **Stale or racing search results.** Typing `ab` then `abc` never shows `ab` rows under `abc`, and the superseded request is aborted. Pinned in Task 4 (`useAppSearch.test.ts` "passes the vue-query abort signal…", next to the existing "shows server rows only once the typed term equals the debounced term").

---

### Task 1: The web R3 scan sees `Lazy` and kebab-case tags (Plan 2 deferred item a)

Plan 2's final review found two gaps. The shell scan in `tools/arch_policy.py` matches only `<PascalDir…>` tags, and its tests have no `Chat*` tag case and no `modules/<app>` case for the shell.

**Files:**
- Modify: `tools/arch_policy.py:208-253` (add `component_tag`; use it in `foreign_component_uses`)
- Modify: `tools/test_arch_policy.py:29-32` (`WEB_APPS` gains `meetings` and `chat`, mirroring `tools/arch_layers.json`)
- Modify: `tools/test_arch_policy.py` (two tests after `test_glob_strings_are_not_import_specifiers` near `:204`; one test after `test_shell_and_layout_name_no_application` near `:305`)

**Interfaces:**
- Produces: `component_tag(directory: str) -> re.Pattern[str]`. It matches `<Pascal…>`, `<LazyPascal…>`, `<dir-…>` and `<lazy-dir-…>` tags of a component under `components/<directory>/`.
- `foreign_component_uses(text, own_app, web_apps, rel=None) -> int` keeps its signature.

- [ ] **Step 1: Failing tests**

In `tools/test_arch_policy.py`, replace `WEB_APPS`:

```python
WEB_APPS = {
    'pmo': {'components': ['project', 'task'], 'pages': ['projects', 'tasks']},
    'meetings': {'components': ['meetings'], 'pages': ['meetings']},
    'hr': {'components': ['hr'], 'pages': ['hr']},
    'chat': {'components': ['chat'], 'pages': ['chat']},
}
```

Add inside `class TestPureRules`:

```python
    def test_every_app_folder_is_caught_in_every_tag_form(self):
        for directory, name in (('project', 'Project'), ('task', 'Task'), ('meetings', 'Meetings'),
                                ('hr', 'Hr'), ('chat', 'Chat')):
            for tag in (f'<{name}Card />', f'<Lazy{name}Card />', f'<{directory}-card />', f'<lazy-{directory}-card />'):
                with self.subTest(tag=tag):
                    self.assertEqual(foreign_component_uses(tag, '', WEB_APPS), 1)

    def test_html_and_own_tags_are_not_foreign(self):
        self.assertEqual(foreign_component_uses('<hr /><hr><Hrx />', '', WEB_APPS), 0)
        self.assertEqual(foreign_component_uses('<LazyChatPanel /><chat-panel />', 'chat', WEB_APPS), 0)
```

Add inside `class TestCollect`:

```python
    def test_shell_flags_lazy_kebab_and_module_imports_of_any_app(self):
        self.clean_tree()
        self.write('apps/web/app/components/shell/ShellHeader.vue',
                   "<script setup>import m from '@/modules/chat/manifest'</script>"
                   "<template><LazyChatSidebarPanel /><meetings-card /></template>\n")
        violations, _ = collect(self.root, self.layers)
        self.assertEqual(violations['R3'], {'web apps/web/app/components/shell/ShellHeader.vue': 3})
```

- [ ] **Step 2: Run and see them fail**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim/tools && python3 -B -m unittest test_arch_policy -q 2>&1 | tail -15
```

Expected: FAIL in `test_every_app_folder_is_caught_in_every_tag_form`, on the `Lazy…`, `<dir-…>` and `<lazy-dir-…>` subtests. Also FAIL in `test_shell_flags_lazy_kebab_and_module_imports_of_any_app`, which counts 1 instead of 3 because only the module import is seen. `test_html_and_own_tags_are_not_foreign` passes.

- [ ] **Step 3: Implement**

In `tools/arch_policy.py`, add after `pascal`:

```python
def component_tag(directory: str) -> re.Pattern[str]:
    """A Nuxt tag of a component under components/<directory>/: PascalCase or kebab-case, with or without `Lazy`."""
    return re.compile(
        rf'<(?:Lazy)?{re.escape(pascal(directory))}[A-Z]|<(?:lazy-)?{re.escape(directory.lower())}-[a-z]',
    )
```

In `foreign_component_uses`, replace

```python
            total += len(re.findall(rf'<{pascal(directory)}[A-Z]', code))
```

with

```python
            total += len(component_tag(directory).findall(code))
```

- [ ] **Step 4: Run, including the real tree**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim
(cd tools && python3 -B -m unittest test_arch_policy -q)
python3 -B tools/arch_policy.py; echo "exit=$?"
python3 -B tools/arch_policy.py --base main; echo "exit=$?"
rg -n "<Lazy(Project|Task|Meetings|Hr|Chat)|<(lazy-)?(project|task|meetings|hr|chat)-[a-z]" apps/web/app --glob '*.vue' --glob '*.ts'
```

Expected: the tests pass, both `arch_policy` runs exit 0, and `rg` prints nothing. (Checked on 2026-10-13: the tree has no such tag.) If `arch_policy` reports a new R3 entry, that is a real violation. Stop and report it. Never add it to the baseline.

- [ ] **Step 5: Commit**

```bash
git add tools/arch_policy.py tools/test_arch_policy.py
git commit -m "fix(tools): catch Lazy and kebab app tags in the web R3 scan

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Shorten the vendor console badge (owner amendment 3)

**Files:**
- Modify: `apps/web/i18n/locales/ar/common.json:37`, `apps/web/i18n/locales/en/common.json:37` (`nav.consoleBadge`)
- Modify: `apps/web/e2e/storybook-shell.spec.ts:139-142`
- Modify: `apps/web/stories/shell/ShellHeader.stories.ts:19` (story display name only; the id stays `shell-shellheader--console`)
- Modify: `DESIGN.md:113` («شارة «وحدة إدارة نسق»» → «شارة «الكونسول»»)
- Regenerate: the 12 PNGs `apps/web/e2e/storybook-visual.spec.ts-snapshots/shell-shellframe--console-*` (8, including mobile) and `shell-shellheader--console-*` (4)

**Interfaces:** none.

- [ ] **Step 1: Failing assertion**

Replace the test body in `apps/web/e2e/storybook-shell.spec.ts`. The title is unchanged.

```ts
  test('the vendor console shows its badge', async ({ page }) => {
    await open(page, 'shell-shellframe--console', 'locale:ar;appearance:light')
    await expect(page.getByTestId('vendor-console-badge')).toHaveText('الكونسول')
    await open(page, 'shell-shellframe--console', 'locale:en;appearance:light')
    await expect(page.getByTestId('vendor-console-badge')).toHaveText('Console')
  })
```

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim/apps/web
npm run build-storybook >/dev/null && npx playwright test e2e/storybook-shell.spec.ts -g 'vendor console shows its badge' --reporter=line
```

Expected: FAIL. The received text is `وحدة إدارة نسق`.

- [ ] **Step 2: Change the strings**

- `ar/common.json`: `"consoleBadge": "الكونسول",`
- `en/common.json`: `"consoleBadge": "Console",`
- `ShellHeader.stories.ts:19`: `name: 'وحدة إدارة نسق'` → `name: 'الكونسول'`
- `DESIGN.md:113`: in the sentence about `/vendor/*`, the badge name «وحدة إدارة نسق» → «الكونسول».

- [ ] **Step 3: Run, then re-baseline exactly the console stories**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim/apps/web
npm run build-storybook >/dev/null
npx playwright test e2e/storybook-shell.spec.ts --reporter=line
npx playwright test e2e/storybook-visual.spec.ts --reporter=line 2>&1 | grep -E "✘|failed" | head -20
npx playwright test e2e/storybook-visual.spec.ts -g 'shell-shellframe--console|shell-shellheader--console' --update-snapshots --reporter=line
git status --short e2e/storybook-visual.spec.ts-snapshots | wc -l
NASQ_REQUIRE_STORYBOOK=1 npx playwright test e2e/storybook-visual.spec.ts --reporter=line | tail -3
```

Expected:

- `storybook-shell` passes.
- The first visual run fails only on `shell-shellframe--console…` and `shell-shellheader--console…` tests.
- The `git status` count is `12`.
- The last run passes.

Any other diff is a regression. Investigate it; do not re-baseline it.

- [ ] **Step 4: Gates and commit**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim
npm -w apps/web run lint && npm test 2>&1 | tail -3 && python3 -B tools/ui_policy.py
git add apps/web/i18n DESIGN.md apps/web/stories/shell/ShellHeader.stories.ts apps/web/e2e/storybook-shell.spec.ts apps/web/e2e/storybook-visual.spec.ts-snapshots
git commit -m "fix(web): shorten the vendor console badge to Console

Owner CP2 decision 2026-10-13. Re-baselines the 12 console snapshots.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: One layout-aware keymap (Plan 2 deferred item b)

This task adds the pure keymap and moves the three existing key handlers onto it: `[` in `AppSidebar`, J/K in `TaskDetailPanel`, and the one-key jumps on `/search`. It also keeps `tools/new_app.py` from handing a new application a letter the shell now owns.

**Files:**
- Create: `apps/web/app/composables/shortcuts/keymap.ts`
- Create: `apps/web/app/composables/shortcuts/__tests__/keymap.test.ts`
- Rewrite: `apps/web/app/composables/nav/sidebarShortcut.ts`, `apps/web/app/composables/nav/__tests__/sidebarShortcut.test.ts`
- Modify: `apps/web/app/composables/searchKeyboard.ts`, `apps/web/app/composables/__tests__/searchKeyboard.test.ts`
- Modify: `apps/web/app/components/task/TaskDetailPanel.vue:1-10` (import), `:133-150` (`onKeydown`)
- Modify: `apps/web/app/composables/nav/shellModules.ts:32` (branding `/search` one-key `shortcut: 'g'` → `'a'`; `g` now starts the global chord)
- Modify: `apps/web/app/modules/types.ts:11-15` (document what `shortcut` is)
- Modify: `tools/new_app.py:32-35`, `tools/test_new_app.py` (one test)

**Interfaces:**
- Produces, in `composables/shortcuts/keymap.ts`:
  - `interface ShortcutKeyEvent { key; code; metaKey; ctrlKey; altKey; shiftKey; repeat; isComposing; keyCode?; defaultPrevented; target: unknown }`
  - `shortcutKey(event: Pick<ShortcutKeyEvent, 'key' | 'code' | 'shiftKey'>): string | null`
  - `plainShortcutBlocked(event: ShortcutKeyEvent, context: { hydrated: boolean; overlayOpen: boolean }): boolean`
  - `type ShortcutAction = { kind: 'palette' } | { kind: 'help' } | { kind: 'focus-search' } | { kind: 'create' } | { kind: 'chord' } | { kind: 'go'; key: string }`
  - `interface ShortcutState { goSince: number | null }`, `IDLE_SHORTCUTS`, `CHORD_TIMEOUT_MS = 1000`
  - `interface ShortcutContext { hydrated: boolean; overlayOpen: boolean; now: number }`
  - `matchShortcut(event, context, state): { action: ShortcutAction | null; state: ShortcutState }`
  - `isApplePlatform(nav: { platform?: string; userAgent?: string }): boolean`
- Changes: `SidebarShortcutEvent` becomes an alias of `ShortcutKeyEvent` (it now needs `key`). `isSidebarToggleShortcut(event, overlayOpen)` keeps its signature.

- [ ] **Step 1: Failing keymap tests**

Create `apps/web/app/composables/shortcuts/__tests__/keymap.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { IDLE_SHORTCUTS, isApplePlatform, matchShortcut, shortcutKey, type ShortcutKeyEvent } from '../keymap'

const body = { tagName: 'BODY', closest: () => null }
const ev = (patch: Partial<ShortcutKeyEvent> = {}): ShortcutKeyEvent => ({
  key: 'c', code: 'KeyC', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false,
  repeat: false, isComposing: false, keyCode: 67, defaultPrevented: false, target: body, ...patch,
})
const ready = { hydrated: true, overlayOpen: false, now: 10_000 }

describe('shortcutKey: the Latin character, else the US physical position', () => {
  it.each([
    ['p', 'KeyP', 'p'], ['P', 'KeyP', 'p'],
    ['ح', 'KeyP', 'p'], ['ن', 'KeyK', 'k'], ['ل', 'KeyG', 'g'], // Arabic (101)
    ['[', 'BracketLeft', '['], ['ج', 'BracketLeft', '['], // US, Arabic
    ['ü', 'BracketLeft', '['], ['Dead', 'BracketLeft', '['], // QWERTZ, AZERTY dead key
    ['[', 'Minus', '['], ['/', 'BracketLeft', '/'], // Dvorak: the character wins
    ['m', 'Semicolon', 'm'], [',', 'KeyM', null], // AZERTY: labels win
    ['ظ', 'Slash', '/'], ['?', 'Slash', '?'], ['؟', 'Slash', '?'],
    ['1', 'Digit1', '1'], ['١', 'Digit1', '1'],
    ['Escape', 'Escape', null], ['Enter', 'Enter', null], [' ', 'Space', null], ['Shift', 'ShiftLeft', null],
  ] as const)('%s on %s is %s', (key, code, expected) => {
    expect(shortcutKey({ key, code, shiftKey: key === '?' || key === '؟' })).toBe(expected)
  })
})

describe('matchShortcut: ⌘K / Ctrl K', () => {
  it.each([
    ['⌘K', { key: 'k', code: 'KeyK', metaKey: true }],
    ['Ctrl K', { key: 'k', code: 'KeyK', ctrlKey: true }],
    ['Ctrl K on an Arabic layout', { key: 'ن', code: 'KeyK', ctrlKey: true }],
    ['⌘K inside a field', { key: 'k', code: 'KeyK', metaKey: true, target: { tagName: 'INPUT' } }],
  ] as const)('%s opens the palette', (_label, patch) => {
    expect(matchShortcut(ev(patch), ready, IDLE_SHORTCUTS).action).toEqual({ kind: 'palette' })
  })

  it('toggles while the palette (a reka layer) is open', () => {
    expect(matchShortcut(ev({ key: 'k', code: 'KeyK', metaKey: true }), { ...ready, overlayOpen: true }, IDLE_SHORTCUTS).action)
      .toEqual({ kind: 'palette' })
  })

  it.each([
    ['before hydration', { key: 'k', code: 'KeyK', metaKey: true }, { hydrated: false }],
    ['with Shift', { key: 'K', code: 'KeyK', metaKey: true, shiftKey: true }, {}],
    ['with Alt', { key: 'k', code: 'KeyK', ctrlKey: true, altKey: true }, {}],
    ['while composing', { key: 'k', code: 'KeyK', ctrlKey: true, isComposing: true }, {}],
  ] as const)('does nothing %s', (_label, patch, context) => {
    expect(matchShortcut(ev(patch), { ...ready, ...context }, IDLE_SHORTCUTS).action).toBeNull()
  })
})

describe('matchShortcut: plain keys', () => {
  it.each([
    ['/', { key: '/', code: 'Slash' }, { kind: 'focus-search' }],
    ['/ on Arabic («ظ»)', { key: 'ظ', code: 'Slash' }, { kind: 'focus-search' }],
    ['/ on QWERTZ (Shift+7)', { key: '/', code: 'Digit7', shiftKey: true }, { kind: 'focus-search' }],
    ['? (Shift+/)', { key: '?', code: 'Slash', shiftKey: true }, { kind: 'help' }],
    ['? on Arabic («؟»)', { key: '؟', code: 'Slash', shiftKey: true }, { kind: 'help' }],
    ['? on AZERTY (Shift+,)', { key: '?', code: 'KeyM', shiftKey: true }, { kind: 'help' }],
    ['C', { key: 'c', code: 'KeyC' }, { kind: 'create' }],
    ['C on Arabic («ؤ»)', { key: 'ؤ', code: 'KeyC' }, { kind: 'create' }],
    ['G', { key: 'g', code: 'KeyG' }, { kind: 'chord' }],
  ] as const)('%s', (_label, patch, action) => {
    expect(matchShortcut(ev(patch), ready, IDLE_SHORTCUTS).action).toEqual(action)
  })

  it.each([
    ['typing in an input', { target: { tagName: 'INPUT' } }],
    ['typing in a textarea', { target: { tagName: 'TEXTAREA' } }],
    ['choosing in a select', { target: { tagName: 'SELECT' } }],
    ['typing in rich text', { target: { tagName: 'DIV', isContentEditable: true } }],
    ['inside contenteditable=""', { target: { tagName: 'SPAN', closest: (s: string) => (s.includes('contenteditable') ? {} : null) } }],
    ['typing Arabic in an input', { key: 'ؤ', target: { tagName: 'INPUT' } }],
    ['Ctrl', { ctrlKey: true }],
    ['⌘', { metaKey: true }],
    ['Alt', { altKey: true }],
    ['Shift (capital C)', { key: 'C', shiftKey: true }],
    ['auto-repeat', { repeat: true }],
    ['IME composition', { isComposing: true }],
    ['IME keyCode 229', { keyCode: 229 }],
    ['an already handled key', { defaultPrevented: true }],
  ] as const)('C does nothing when %s', (_label, patch) => {
    expect(matchShortcut(ev(patch), ready, IDLE_SHORTCUTS).action).toBeNull()
  })

  it('nothing plain fires before hydration or while a menu or dialog is open', () => {
    for (const context of [{ ...ready, hydrated: false }, { ...ready, overlayOpen: true }]) {
      for (const patch of [{}, { key: 'g', code: 'KeyG' }, { key: '/', code: 'Slash' }, { key: '?', code: 'Slash', shiftKey: true }]) {
        expect(matchShortcut(ev(patch), context, IDLE_SHORTCUTS).action).toBeNull()
      }
    }
  })
})

describe('matchShortcut: G then a letter', () => {
  it('a letter within a second is a go-to, by label or by position', () => {
    const first = matchShortcut(ev({ key: 'g', code: 'KeyG' }), ready, IDLE_SHORTCUTS)
    expect(first).toEqual({ action: { kind: 'chord' }, state: { goSince: 10_000 } })
    expect(matchShortcut(ev({ key: 'p', code: 'KeyP' }), { ...ready, now: 10_900 }, first.state))
      .toEqual({ action: { kind: 'go', key: 'p' }, state: IDLE_SHORTCUTS })
    const arabic = matchShortcut(ev({ key: 'ل', code: 'KeyG' }), ready, IDLE_SHORTCUTS)
    expect(matchShortcut(ev({ key: 'ف', code: 'KeyT' }), ready, arabic.state).action).toEqual({ kind: 'go', key: 't' })
  })

  it('the letter after G is a destination, not the C shortcut', () => {
    expect(matchShortcut(ev(), ready, { goSince: 10_000 }).action).toEqual({ kind: 'go', key: 'c' })
  })

  it('a late, modified, typed or non-letter key ends the chord without acting', () => {
    const pending = { goSince: 10_000 }
    expect(matchShortcut(ev({ key: 'p', code: 'KeyP' }), { ...ready, now: 11_001 }, pending)).toEqual({ action: null, state: IDLE_SHORTCUTS })
    expect(matchShortcut(ev({ key: 'Escape', code: 'Escape' }), ready, pending)).toEqual({ action: null, state: IDLE_SHORTCUTS })
    expect(matchShortcut(ev({ key: 'p', code: 'KeyP', ctrlKey: true }), ready, pending)).toEqual({ action: null, state: IDLE_SHORTCUTS })
    expect(matchShortcut(ev({ key: 'p', code: 'KeyP', target: { tagName: 'INPUT' } }), ready, pending)).toEqual({ action: null, state: IDLE_SHORTCUTS })
  })

  it('a bare modifier press keeps the chord pending', () => {
    const pending = { goSince: 10_000 }
    expect(matchShortcut(ev({ key: 'Shift', code: 'ShiftLeft', shiftKey: true }), ready, pending)).toEqual({ action: null, state: pending })
  })
})

describe('isApplePlatform', () => {
  it.each([
    [{ platform: 'MacIntel' }, true],
    [{ platform: '', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' }, true],
    [{ platform: 'Win32' }, false],
    [{ platform: 'Linux x86_64' }, false],
  ])('%o → %s', (nav, expected) => {
    expect(isApplePlatform(nav)).toBe(expected)
  })
})
```

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim/apps/web && npx vitest run app/composables/shortcuts
```

Expected: FAIL. The keymap module does not exist yet.

- [ ] **Step 2: The keymap**

Create `apps/web/app/composables/shortcuts/keymap.ts`:

```ts
// Relative import: this module is unit-tested directly under plain vitest.
import { isEditableKeyTarget } from '../useEscapeBack'

/*
 * The shell keyboard layer (Tasmim spec §5). Every shortcut is decided here, so all of them
 * share one key rule and one "may a plain key act now" test. Nuxt UI's defineShortcuts is not
 * used: in 4.11.1 it cannot match `/`, `?` or `[` by position, ignores IME composition and
 * open menus (evidence: docs/superpowers/plans/2026-10-13-tasmim-plan-3-palette.md, "Decision").
 */

/** The keydown fields the layer reads. A KeyboardEvent satisfies it; tests pass plain objects. */
export interface ShortcutKeyEvent {
  key: string
  code: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  repeat: boolean
  isComposing: boolean
  /** 229 while an IME holds the key; some browsers leave isComposing false on the first key. */
  keyCode?: number
  defaultPrevented: boolean
  target: unknown
}

const ASCII_PRINTABLE = /^[\x20-\x7e]$/
const MODIFIER_KEYS: ReadonlySet<string> = new Set(['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock'])

/**
 * The key a shortcut sees. A Latin layout's own character wins (QWERTY, AZERTY, QWERTZ and
 * Dvorak follow their labels). A non-Latin character (Arabic «ن») or a dead key falls back to
 * the US physical position, so the same key works on an Arabic keyboard: «ل» is g, «ج» is [,
 * «ظ» is /. Returns a lower-case letter, a digit, `/`, `?`, `[` or null.
 */
export function shortcutKey(event: Pick<ShortcutKeyEvent, 'key' | 'code' | 'shiftKey'>): string | null {
  const { key, code } = event
  if (/^[a-z0-9]$/i.test(key)) return key.toLowerCase()
  if (key === '/' || key === '?' || key === '[') return key
  if (key === '؟') return '?'
  if (ASCII_PRINTABLE.test(key)) return null
  const letter = /^Key([A-Z])$/.exec(code)
  if (letter) return letter[1]!.toLowerCase()
  const digit = /^Digit(\d)$/.exec(code)
  if (digit) return digit[1]!
  if (code === 'Slash') return event.shiftKey ? '?' : '/'
  if (code === 'BracketLeft') return '['
  return null
}

function composing(event: ShortcutKeyEvent): boolean {
  return event.isComposing || event.keyCode === 229
}

/** True when a plain shortcut (no ⌘, Ctrl or Alt) must leave this key alone. */
export function plainShortcutBlocked(event: ShortcutKeyEvent, context: { hydrated: boolean; overlayOpen: boolean }): boolean {
  if (!context.hydrated || context.overlayOpen) return true
  if (event.metaKey || event.ctrlKey || event.altKey) return true
  if (event.repeat || composing(event) || event.defaultPrevented) return true
  return isEditableKeyTarget(event.target)
}

export type ShortcutAction =
  | { kind: 'palette' }
  | { kind: 'help' }
  | { kind: 'focus-search' }
  | { kind: 'create' }
  | { kind: 'chord' }
  | { kind: 'go'; key: string }
export interface ShortcutState { goSince: number | null }
export interface ShortcutContext { hydrated: boolean; overlayOpen: boolean; now: number }
export const IDLE_SHORTCUTS: ShortcutState = Object.freeze({ goSince: null })
/** How long `G` waits for its letter. */
export const CHORD_TIMEOUT_MS = 1000

/**
 * One step of the shell layer: the action a keydown asks for and the next chord state.
 * `[` is not here; AppSidebar owns the sidebar state and matches it with the same rule.
 */
export function matchShortcut(
  event: ShortcutKeyEvent,
  context: ShortcutContext,
  state: ShortcutState,
): { action: ShortcutAction | null; state: ShortcutState } {
  const key = shortcutKey(event)
  // ⌘K / Ctrl K on every platform, once hydrated: also in a field and in the open palette (it toggles).
  if (key === 'k' && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey) {
    const ready = context.hydrated && !event.repeat && !composing(event)
    return { action: ready ? { kind: 'palette' } : null, state: IDLE_SHORTCUTS }
  }
  // A bare modifier (Shift on the way to `?`) keeps a pending G.
  if (MODIFIER_KEYS.has(event.key)) return { action: null, state }
  if (plainShortcutBlocked(event, context)) return { action: null, state: IDLE_SHORTCUTS }
  if (state.goSince !== null && context.now - state.goSince <= CHORD_TIMEOUT_MS) {
    const letter = key !== null && /^[a-z]$/.test(key) && !event.shiftKey
    return { action: letter ? { kind: 'go', key: key! } : null, state: IDLE_SHORTCUTS }
  }
  if (key === '?') return { action: { kind: 'help' }, state: IDLE_SHORTCUTS }
  if (key === '/') return { action: { kind: 'focus-search' }, state: IDLE_SHORTCUTS }
  if (event.shiftKey) return { action: null, state: IDLE_SHORTCUTS }
  if (key === 'c') return { action: { kind: 'create' }, state: IDLE_SHORTCUTS }
  if (key === 'g') return { action: { kind: 'chord' }, state: { goSince: context.now } }
  return { action: null, state: IDLE_SHORTCUTS }
}

/** macOS and iOS show ⌘ where other platforms show Ctrl; the palette shortcut accepts both everywhere. */
export function isApplePlatform(nav: { platform?: string; userAgent?: string }): boolean {
  return /Mac|iPhone|iPad|iPod/.test(nav.platform || nav.userAgent || '')
}
```

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim/apps/web && npx vitest run app/composables/shortcuts
```

Expected: PASS.

- [ ] **Step 3: `[` on the shared rule (failing test first)**

Replace `apps/web/app/composables/nav/__tests__/sidebarShortcut.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { isSidebarToggleShortcut, type SidebarShortcutEvent } from '../sidebarShortcut'

const press: SidebarShortcutEvent = {
  key: '[', code: 'BracketLeft', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false,
  repeat: false, isComposing: false, keyCode: 219, defaultPrevented: false, target: { tagName: 'BODY' },
}

describe('[ toggles the context sidebar', () => {
  it.each([
    ['US «[»', { key: '[', code: 'BracketLeft' }],
    ['Arabic «ج» on the same key', { key: 'ج', code: 'BracketLeft' }],
    ['QWERTZ «ü» on the same key', { key: 'ü', code: 'BracketLeft' }],
    ['AZERTY ^ dead key on the same key', { key: 'Dead', code: 'BracketLeft' }],
    ['Dvorak «[» on another key', { key: '[', code: 'Minus' }],
  ] as const)('matches %s', (_label, patch) => {
    expect(isSidebarToggleShortcut({ ...press, ...patch }, false)).toBe(true)
  })

  it.each([
    ['another key', { key: ']', code: 'BracketRight' }],
    ['Dvorak «/» typed on the BracketLeft key', { key: '/', code: 'BracketLeft' }],
    ['Cmd', { metaKey: true }],
    ['Ctrl', { ctrlKey: true }],
    ['Alt', { altKey: true }],
    ['Shift', { shiftKey: true }],
    ['auto-repeat', { repeat: true }],
    ['IME composition', { isComposing: true }],
    ['IME keyCode 229', { keyCode: 229 }],
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

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim/apps/web && npx vitest run app/composables/nav/__tests__/sidebarShortcut.test.ts
```

Expected: FAIL. "matches Dvorak «[» on another key" fails, and so do the "IME keyCode 229" and "Dvorak «/»…" ignore cases.

Then replace `apps/web/app/composables/nav/sidebarShortcut.ts`:

```ts
// Relative import: this module is unit-tested directly under plain vitest.
import { plainShortcutBlocked, shortcutKey, type ShortcutKeyEvent } from '../shortcuts/keymap'

export type SidebarShortcutEvent = ShortcutKeyEvent

/**
 * `[` collapses or expands the context sidebar (Tasmim spec §5). Matched by the shared keymap
 * rule: the `[` character on a Latin layout, else the BracketLeft position («ج» on Arabic, «ü» on
 * QWERTZ, the ^ dead key on AZERTY). AppSidebar owns the sidebar state, so this key keeps its own
 * listener there instead of the shell layer's.
 */
export function isSidebarToggleShortcut(event: SidebarShortcutEvent, overlayOpen: boolean): boolean {
  if (event.shiftKey) return false
  return shortcutKey(event) === '[' && !plainShortcutBlocked(event, { hydrated: true, overlayOpen })
}
```

`AppSidebar.vue:29-33` stays as it is: it passes the `KeyboardEvent`, and `toggle()` keeps its own hydration guard.

- [ ] **Step 4: `/search` one-key jumps and task J/K on the same rule**

Replace `apps/web/app/composables/searchKeyboard.ts`:

```ts
import { shortcutKey } from './shortcuts/keymap'
import { isEditableKeyTarget } from './useEscapeBack'

type Shortcut = { shortcut: string; to: string }
type KeyboardLikeEvent = Pick<KeyboardEvent, 'key'> & { code?: string; target?: unknown; keyCode?: number }
  & Partial<Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'isComposing' | 'defaultPrevented'>>

/** The /search page's one-key jump for this key, matched by the shell keymap rule (works on Arabic layouts). */
export function findSearchShortcut(event: KeyboardLikeEvent, query: string, shortcuts: Shortcut[]): Shortcut | undefined {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.isComposing || event.keyCode === 229) return undefined
  // The shell layer runs first (capture phase) and prevents the keys it used, such as the G chord.
  if (event.defaultPrevented || query || isEditableKeyTarget(event.target)) return undefined
  const key = shortcutKey({ key: event.key, code: event.code ?? '', shiftKey: false })
  return key ? shortcuts.find(item => item.shortcut === key) : undefined
}
```

Append inside `describe('global search keyboard handler', …)` in `apps/web/app/composables/__tests__/searchKeyboard.test.ts`:

```ts
  it('matches an Arabic layout by key position and skips keys the shell already used', () => {
    const target = { tagName: 'BODY', closest: () => null }
    expect(findSearchShortcut({ key: 'س', code: 'KeyS', target }, '', shortcuts)).toEqual(shortcuts[1])
    expect(findSearchShortcut({ key: '١', code: 'Digit1', target }, '', shortcuts)).toEqual(shortcuts[0])
    expect(findSearchShortcut({ key: 's', code: 'KeyS', target, defaultPrevented: true }, '', shortcuts)).toBeUndefined()
  })
```

In `apps/web/app/components/task/TaskDetailPanel.vue`:

- add `import { shortcutKey } from '@/composables/shortcuts/keymap'` after `:6`;
- change the first guard of `onKeydown` to `if (!hydrated.value || e.defaultPrevented) return`;
- replace the J/K lines

```ts
  if (e.key === 'j' || e.key === 'J') goTo(siblings.value.nextId)
  else if (e.key === 'k' || e.key === 'K') goTo(siblings.value.prevId)
```

with

```ts
  // By the shell keymap rule, so «ت» / «ن» on an Arabic layout move too.
  const key = shortcutKey(e)
  if (key === 'j') goTo(siblings.value.nextId)
  else if (key === 'k') goTo(siblings.value.prevId)
```

In `apps/web/app/composables/nav/shellModules.ts:32`, change the branding item's `shortcut: 'g'` to `shortcut: 'a'`. In `apps/web/app/modules/types.ts`, replace `AppNavItem` with:

```ts
export interface AppNavItem {
  to: string; labelKey: string; icon: AppIcon; capability: string
  /** One-key jump on the /search page only, not a global shortcut; tools/new_app.py picks a free one. */
  shortcut: string
  /** Rail module this item opens; defaults to the manifest id. PMO uses 'home' for the dashboard. */
  module?: string
}
```

- [ ] **Step 5: `new_app.py` keeps off the shell letters (failing test first)**

Append after `test_hard_wired_keys_are_never_chosen` in `tools/test_new_app.py`:

```python
    def test_shell_keymap_letters_are_never_chosen(self):
        modules = self.root / 'apps/web/app/modules'
        for path in modules.glob('*/manifest.ts'):
            path.unlink()
        (self.root / 'apps/web/app/composables/nav/shellModules.ts').unlink()
        (modules / 'hi').mkdir(exist_ok=True)
        (modules / 'hi/manifest.ts').write_text(
            "export default { rail: [{ id: 'hi', order: 990 }], nav: ["
            "{ shortcut: 'a' }, { shortcut: 'b' }, { shortcut: 'd' }, { shortcut: 'e' }, { shortcut: 'f' }] }\n",
            encoding='utf-8',
        )
        self.assertEqual(new_app.web_slots(self.root)[1], 'h')
```

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim/tools && python3 -B -m unittest test_new_app -q 2>&1 | tail -5
```

Expected: FAIL, `'c' != 'h'`. Then in `tools/new_app.py:32-35` replace the comment and constant:

```python
# Keys the shell keymap (apps/web/app/composables/shortcuts/keymap.ts) and list navigation own:
# c (create), g (go-to chord), j/k (rows) and 0 (reset); `/`, `?` and `[` are outside the charset.
# A /search one-key nav shortcut must not take them.
HARD_WIRED_SHORTCUTS = frozenset({'c', 'g', 'j', 'k', '0'})
```

- [ ] **Step 6: Run**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim
(cd apps/web && npx vitest run app/composables)
(cd tools && python3 -B -m unittest test_new_app -q)
npm -w apps/web run lint && npm test 2>&1 | tail -3 && python3 -B tools/ui_policy.py && python3 -B tools/arch_policy.py
cd apps/web && npm run build-storybook >/dev/null && npx playwright test e2e/storybook-shell.spec.ts -g '\[' --reporter=line
```

Expected: everything passes. The Plan 2 storybook `[` tests still pass: they dispatch `{ key: '[' | 'ج', code: 'BracketLeft' }`.

- [ ] **Step 7: Commit (two commits)**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim
git add apps/web/app
git commit -m "refactor(web): match every shortcut through one layout-aware keymap

The [ toggle, task J/K and /search one-key jumps share shortcutKey:
the Latin character wins, else the US key position, so Arabic,
AZERTY and QWERTZ keyboards work. Branding's /search key moves
from g to a because g now starts the global G chord.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git add tools/new_app.py tools/test_new_app.py
git commit -m "chore(tools): keep new apps off the shell keymap letters

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Manifest `commands` and `goKey`s, the pure palette model, cancellable search

**Files:**
- Modify: `apps/web/app/modules/types.ts` (`AppNavItem.goKey`, new `AppCommand`, `AppManifest.commands`; Step 6: `AppSearchApi` options gain `signal`)
- Modify: `apps/web/app/modules/surfaces.ts` (add `appCommands`)
- Modify: `apps/web/app/modules/{pmo,meetings,chat,hr}/manifest.ts` (`goKey` on nav items, `commands`)
- Modify: `apps/web/app/composables/nav/shellModules.ts:28-35` (`NavItem.goKey`; users `u`, roles `r`)
- Modify: `apps/web/app/composables/shortcuts/keymap.ts` (append `SHORTCUT_HELP`)
- Create: `apps/web/app/composables/nav/paletteModel.ts`, `apps/web/app/composables/nav/__tests__/paletteModel.test.ts`
- Modify: `apps/web/app/modules/__tests__/manifests.test.ts` (append)
- Modify: `apps/web/i18n/locales/{ar,en}/common.json` (`search.*` additions, new `shortcuts.*`)
- Modify: `apps/web/app/composables/useAppSearch.ts:41-45`, `apps/web/app/composables/useApi.ts:27-36`, `apps/web/app/composables/__tests__/useAppSearch.test.ts` (append)

**Interfaces:**
- Consumes: `useNav`, `allNavItems`, `NavItem` (`composables/nav/shellModules.ts`); `canReach`, `canReachPath`, `AccessIdentity` (`utils/accessPolicy.ts`); `withManifests`, `appManifests`, `manifestForPath` (`modules/manifests.ts`).
- Produces in `modules/types.ts`:
  - `AppNavItem.goKey?: string`
  - `interface AppCommand { id: string; labelKey: string; icon: AppIcon; to: string; capability: string; shortcut?: string }`
  - `AppManifest.commands?: AppCommand[]`
  - `AppSearchApi` options `{ query?; schema; signal?: AbortSignal }`
- Produces in `modules/surfaces.ts`: `appCommands(): AppCommand[]`.
- Produces in `composables/shortcuts/keymap.ts`: `interface ShortcutHelpEntry { id: string; labelKey: string; kbds: readonly string[] }`, `SHORTCUT_HELP`.
- Produces in `composables/nav/paletteModel.ts`:
  - `PALETTE_SECTION_LIMIT = 50`
  - `type PaletteItemAction`, `interface PaletteItem`, `interface PaletteGroup`, `interface PaletteSearchSection`
  - `goKeyProblems(items): string[]`, `goKeyTargets(visible): Map<string, NavItem>`
  - `visibleCommands(identity, commands?): AppCommand[]`
  - `goToItems(visible, label)`, `commandItems(commands, label, returnTo)`, `helpItems(visible, label, goTo)`, `paletteGroups(input): PaletteGroup[]`
- Changes: `useApi().$api` options accept `signal?: AbortSignal`, which is passed to `$fetch`.

G letters (lower-case, unique, never `g`): `h` home (dashboard), `p` projects, `t` my tasks, `m` meetings, `c` chat, `e` employees, `d` departments, `u` users, `r` roles. Commands: `pmo.new-project`, `pmo.new-task`, `meetings.new-meeting`, `meetings.new-series`, `chat.new-conversation`, `hr.new-employee`, `hr.new-department`, `hr.new-document`. Every command opens a route that already exists, and each one's `capability` equals that route's own `routeCapabilities` entry.

- [ ] **Step 1: Types, surfaces, help table, locale keys**

In `apps/web/app/modules/types.ts`, add `goKey` to `AppNavItem` (after `shortcut`):

```ts
  /** Letter of the global `G` then letter shortcut: a–z, never g, unique across apps and the foundation (manifests.test.ts). */
  goKey?: string
```

Add after `AppNavItem`:

```ts
/** A palette action (Tasmim spec §5, Actions group): opens a route; hidden unless the user may run it. */
export interface AppCommand {
  /** `<manifest id>.<name>`, unique. */
  id: string
  labelKey: string
  icon: AppIcon
  /** The route the command opens, usually a `/new` form; the palette adds `returnTo`. */
  to: string
  /** Checked with its feature and the route's own capability (paletteModel.visibleCommands). */
  capability: string
  /** Display-only key hint beside the command; it binds no key. */
  shortcut?: string
}
```

In `AppManifest`, add after `search?: AppSearchProvider[]`:

```ts
  /** Palette actions (Actions group of the command palette). */
  commands?: AppCommand[]
```

Also add `commands` to the list in the file's header comment ("Data only: …").

In `apps/web/app/modules/surfaces.ts`, add `AppCommand` to the type import and append:

```ts
/** Palette commands of every application, in rail order. */
export function appCommands(): AppCommand[] {
  return activeManifests().flatMap(manifest => manifest.commands ?? [])
}
```

In `apps/web/app/composables/nav/shellModules.ts`:

- add `goKey?: string` to `NavItem` (`:28`);
- set `goKey: 'u'` on `/settings/users` and `goKey: 'r'` on `/settings/roles`.

Append to `apps/web/app/composables/shortcuts/keymap.ts`:

```ts
export interface ShortcutHelpEntry { id: string; labelKey: string; kbds: readonly string[] }
/** The fixed rows of the `?` help view in reading order; a `G` row per visible go key follows (paletteModel.helpItems). */
export const SHORTCUT_HELP: readonly ShortcutHelpEntry[] = [
  { id: 'palette', labelKey: 'shortcuts.palette', kbds: ['meta', 'K'] },
  { id: 'search', labelKey: 'shortcuts.search', kbds: ['/'] },
  { id: 'create', labelKey: 'shortcuts.create', kbds: ['C'] },
  { id: 'go', labelKey: 'shortcuts.go', kbds: ['G'] },
  { id: 'rows', labelKey: 'shortcuts.rows', kbds: ['J', 'K'] },
  { id: 'open', labelKey: 'shortcuts.open', kbds: ['enter'] },
  { id: 'sidebar', labelKey: 'shortcuts.sidebar', kbds: ['['] },
  { id: 'escape', labelKey: 'shortcuts.escape', kbds: ['escape'] },
  { id: 'help', labelKey: 'shortcuts.help', kbds: ['?'] },
]
```

(`UKbd` renders `meta` as ⌘ on Apple platforms and Ctrl elsewhere, `enter` as ↵ and `escape` as Esc.)

In `apps/web/i18n/locales/ar/common.json`, the `search` object becomes the following, with a new `shortcuts` object after it:

```json
  "search": {
    "description": "ابحث في الصفحات والمشاريع والمهام…",
    "close": "إغلاق البحث",
    "tasks": "المهام",
    "actions": "إجراءات",
    "loading": "جارٍ البحث…",
    "error": "تعذّر البحث. اختر للمحاولة مجددًا.",
    "footerMove": "تنقّل",
    "footerOpen": "فتح",
    "footerClose": "إغلاق"
  },
  "shortcuts": {
    "title": "اختصارات لوحة المفاتيح",
    "filter": "ابحث في الاختصارات…",
    "backToCommands": "العودة إلى الأوامر",
    "layoutNote": "الحروف بحسب لوحة المفاتيح اللاتينية، وعلى العربية تعمل المفاتيح نفسها بمواضعها.",
    "palette": "فتح لوحة الأوامر",
    "search": "البحث في القائمة الحالية",
    "create": "إنشاء في القسم الحالي",
    "go": "الانتقال إلى صفحة: G ثم حرفها",
    "goTo": "الانتقال إلى {name}",
    "rows": "الصف التالي أو السابق",
    "open": "فتح الصف المحدد",
    "sidebar": "طي القائمة الجانبية أو فتحها",
    "escape": "رجوع أو إغلاق",
    "help": "عرض الاختصارات"
  },
```

In `apps/web/i18n/locales/en/common.json`:

```json
  "search": {
    "description": "Search pages, projects and tasks…",
    "close": "Close search",
    "tasks": "Tasks",
    "actions": "Actions",
    "loading": "Searching…",
    "error": "Search failed. Select to try again.",
    "footerMove": "Move",
    "footerOpen": "Open",
    "footerClose": "Close"
  },
  "shortcuts": {
    "title": "Keyboard shortcuts",
    "filter": "Filter shortcuts…",
    "backToCommands": "Back to commands",
    "layoutNote": "Letters follow a Latin keyboard; on Arabic the same keys work by position.",
    "palette": "Open the command palette",
    "search": "Search the current list",
    "create": "Create in the current section",
    "go": "Go to a page: G, then its letter",
    "goTo": "Go to {name}",
    "rows": "Next or previous row",
    "open": "Open the selected row",
    "sidebar": "Collapse or expand the sidebar",
    "escape": "Back or close",
    "help": "Show shortcuts"
  },
```

- [ ] **Step 2: Manifests declare their letters and commands**

`apps/web/app/modules/pmo/manifest.ts`:

- `nav`: add `goKey: 'h'` to `/projects/dashboard`, `goKey: 'p'` to `/projects`, and `goKey: 't'` to `/tasks`.
- After `search: [projectsSearch, tasksSearch],` add:

```ts
  commands: [
    { id: 'pmo.new-project', labelKey: 'nav.newProject', icon: 'i-lucide-folder-kanban', to: '/projects/new', capability: 'pmo.projects.create' },
    { id: 'pmo.new-task', labelKey: 'tasks.new', icon: 'i-lucide-check-square', to: '/tasks/new', capability: 'pmo.tasks.create' },
  ],
```

`apps/web/app/modules/meetings/manifest.ts`:

- `nav`: add `goKey: 'm'` to `/meetings`.
- After `landing` add:

```ts
  commands: [
    { id: 'meetings.new-meeting', labelKey: 'nav.newMeeting', icon: 'i-lucide-calendar-days', to: '/meetings/new', capability: 'meetings.create' },
    { id: 'meetings.new-series', labelKey: 'meetingsUi.newSeries', icon: 'i-lucide-repeat', to: '/meetings/series/new', capability: 'meetings.create' },
  ],
```

`apps/web/app/modules/chat/manifest.ts`:

- `nav`: add `goKey: 'c'` to `/chat`.
- After `contextLinks` add:

```ts
  commands: [
    { id: 'chat.new-conversation', labelKey: 'nav.newConversation', icon: 'i-lucide-message-circle', to: '/chat/new', capability: 'nasq.internal' },
  ],
```

`apps/web/app/modules/hr/manifest.ts`:

- `nav`: add `goKey: 'e'` to `/hr` and `goKey: 'd'` to `/hr/departments`.
- After `landing` add:

```ts
  commands: [
    { id: 'hr.new-employee', labelKey: 'hr.directory.newEmployee', icon: 'i-lucide-users', to: '/hr/employees/new', capability: 'hr.employees.manage' },
    { id: 'hr.new-department', labelKey: 'hr.depts.new', icon: 'i-lucide-network', to: '/hr/departments/new', capability: 'hr.departments.manage' },
    { id: 'hr.new-document', labelKey: 'hr.docs.new', icon: 'i-lucide-files', to: '/hr/documents/new', capability: 'hr.documents.manage' },
  ],
```

(The icons are ones the manifests already use, so the icon bundle scan covers them (`modules/__tests__/iconBundle.test.ts`).)

- [ ] **Step 3: Failing model and manifest tests**

Create `apps/web/app/composables/nav/__tests__/paletteModel.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { appManifests, withManifests } from '../../../modules/manifests'
import type { AppCommand, AppManifest } from '../../../modules/types'
import { allNavItems, type NavItem } from '../shellModules'
import {
  commandItems, goKeyProblems, goKeyTargets, goToItems, helpItems, paletteGroups,
  PALETTE_SECTION_LIMIT, visibleCommands, type PaletteSearchSection,
} from '../paletteModel'

const FEATURES = ['pmo.enabled', 'meetings.enabled', 'hr.enabled', 'chat.enabled']
const identity = (capabilities: string[], writable: string[] = FEATURES) =>
  ({ capabilities, platform: { readable_features: FEATURES, writable_features: writable } })
const writer = identity([
  'pmo.projects.read', 'pmo.projects.create', 'pmo.tasks.read', 'pmo.tasks.create',
  'meetings.read', 'meetings.create', 'hr.employees.read', 'hr.employees.manage',
])
const ids = (commands: AppCommand[]) => commands.map(command => command.id)
const item = (to: string, goKey?: string): NavItem =>
  ({ to, labelKey: 'nav.x', icon: 'i-lucide-house', shortcut: '', capability: 'x.read', ...(goKey ? { goKey } : {}) })

describe('visibleCommands', () => {
  it('keeps the commands whose capability, feature and route the user holds', () => {
    const visible = ids(visibleCommands(writer))
    expect(visible).toEqual(expect.arrayContaining(['pmo.new-project', 'pmo.new-task', 'meetings.new-meeting', 'hr.new-employee', 'chat.new-conversation']))
    expect(visible).not.toContain('hr.new-department')
  })

  it('hides create commands from a reader', () => {
    const visible = ids(visibleCommands(identity(['pmo.projects.read', 'pmo.tasks.read'])))
    expect(visible).not.toContain('pmo.new-project')
    expect(visible).not.toContain('pmo.new-task')
  })

  it('hides every command in a read-only tenant, whatever the capabilities', () => {
    expect(visibleCommands(identity([...writer.capabilities], []))).toEqual([])
  })

  it('hides the commands of an application whose feature is closed', () => {
    const pmoOnly = { capabilities: writer.capabilities, platform: { readable_features: ['pmo.enabled'], writable_features: ['pmo.enabled'] } }
    expect(ids(visibleCommands(pmoOnly)).filter(id => !id.startsWith('pmo.'))).toEqual([])
  })
})

describe('go keys', () => {
  it('reports a reserved g, a malformed key and a letter two destinations claim', () => {
    expect(goKeyProblems([item('/a', 'p'), item('/b', 'p'), item('/c', 'g'), item('/d', 'P'), item('/e')])).toEqual([
      '/c: go key "g" is reserved',
      '/d: go key "P" is not one lower-case letter',
      'go key "p" is declared by /a and /b',
    ])
  })

  it('a new application that reuses p makes the real navigation fail', () => {
    const crm: AppManifest = {
      id: 'crm', feature: 'crm.enabled', routePrefixes: ['/crm'],
      rail: [{ id: 'crm', labelKey: 'nav.crm', icon: 'i-lucide-handshake', to: '/crm', order: 60 }],
      nav: [{ to: '/crm', labelKey: 'nav.crm', icon: 'i-lucide-handshake', shortcut: 'q', goKey: 'p', capability: 'crm.leads.read' }],
    }
    withManifests([...appManifests, crm], () => {
      expect(goKeyProblems(allNavItems())).toEqual(['go key "p" is declared by /projects and /crm'])
    })
  })

  it('maps each letter to the first item the user can see', () => {
    expect([...goKeyTargets([item('/a', 'p'), item('/b'), item('/c', 'q'), item('/d', 'p')]).entries()].map(([key, target]) => [key, target.to]))
      .toEqual([['p', '/a'], ['q', '/c']])
  })
})

describe('palette items', () => {
  it('Go to rows carry their G letter as a hidden hint and open the console in a new tab', () => {
    const rows = goToItems([item('/projects', 'p'), item('/odoo')], navItem => navItem.to)
    expect(rows[0]).toMatchObject({ id: 'goto:/projects', label: '/projects', to: '/projects', kbds: ['G', 'P'], kbdsHidden: true })
    expect(rows[1]).toMatchObject({ to: '/odoo', external: true, target: '_blank' })
    expect(rows[1]!.kbds).toBeUndefined()
  })

  it('commands open their form with a return path', () => {
    const [row] = commandItems(
      [{ id: 'pmo.new-project', labelKey: 'nav.newProject', icon: 'i-lucide-folder-kanban', to: '/projects/new', capability: 'pmo.projects.create' }],
      key => `t:${key}`,
      '/tasks?q=a',
    )
    expect(row).toEqual({ id: 'command:pmo.new-project', label: 't:nav.newProject', icon: 'i-lucide-folder-kanban', to: { path: '/projects/new', query: { returnTo: '/tasks?q=a' } } })
  })

  it('help lists the fixed shortcuts, then one spoken G row per visible letter', () => {
    const rows = helpItems([item('/tasks', 't'), item('/projects', 'p'), item('/x')], key => key, navItem => `go ${navItem.to}`)
    expect(rows[0]).toEqual({ id: 'help:palette', label: 'shortcuts.palette', kbds: ['meta', 'K'], action: { kind: 'none' } })
    expect(rows.slice(-2)).toEqual([
      { id: 'help:go:p', label: 'go /projects', kbds: ['G', 'P'], action: { kind: 'none' } },
      { id: 'help:go:t', label: 'go /tasks', kbds: ['G', 'T'], action: { kind: 'none' } },
    ])
    expect(rows.some(row => row.kbdsHidden)).toBe(false)
  })
})

const labels = { goTo: 'Go to', actions: 'Actions', shortcuts: 'Shortcuts', loading: 'Searching…', error: 'Search failed', loadMore: 'Load more' }
const section = (patch: Partial<PaletteSearchSection> = {}): PaletteSearchSection => ({
  id: 'pmo-tasks', label: 'Tasks', icon: 'i-lucide-check-square', rows: [], waiting: false, error: false,
  hasNext: false, fetchingNext: false, notice: null, ...patch,
})
const base = {
  view: 'main' as const,
  term: '',
  goTo: goToItems([item('/projects', 'p')], () => 'Projects'),
  search: [section({ rows: [{ id: 1, label: 'Fix login', to: '/tasks/1' }] })],
  actions: [{ id: 'command:pmo.new-project', label: 'New project' }],
  help: [],
  returnTo: '/tasks?q=1',
  labels,
}

describe('paletteGroups', () => {
  it('shows Go to then Actions before a term is typed', () => {
    expect(paletteGroups(base).map(group => group.id)).toEqual(['goto', 'actions'])
  })

  it('puts one unfiltered Search group per provider between Go to and Actions; rows return to the page', () => {
    const groups = paletteGroups({ ...base, term: 'fix' })
    expect(groups.map(group => group.id)).toEqual(['goto', 'search-pmo-tasks', 'actions'])
    expect(groups[1]).toEqual({
      id: 'search-pmo-tasks', label: 'Tasks', ignoreFilter: true,
      items: [{ id: 'search:pmo-tasks:1', label: 'Fix login', icon: 'i-lucide-check-square', to: { path: '/tasks/1', query: { returnTo: '/tasks?q=1' } } }],
    })
  })

  it('renders waiting, failed, capped and paged sections as rows', () => {
    const term = 'fix'
    expect(paletteGroups({ ...base, term, search: [section({ waiting: true })] })[1]!.items)
      .toEqual([{ id: 'search:pmo-tasks:loading', label: 'Searching…', loading: true, disabled: true }])
    expect(paletteGroups({ ...base, term, search: [section({ error: true, hasNext: true })] })[1]!.items.map(row => row.action))
      .toEqual([{ kind: 'retry', section: 'pmo-tasks' }])
    expect(paletteGroups({ ...base, term, search: [section({ rows: [{ id: 1, label: 'a', to: '/tasks/1' }], hasNext: true })] })[1]!.items.at(-1))
      .toMatchObject({ label: 'Load more', action: { kind: 'load-more', section: 'pmo-tasks' } })
    expect(paletteGroups({ ...base, term, search: [section({ notice: 'Only the first 200' })] })[1]!.items)
      .toEqual([{ id: 'search:pmo-tasks:notice', label: 'Only the first 200', icon: 'i-lucide-info', disabled: true }])
  })

  it(`caps a section at ${PALETTE_SECTION_LIMIT} rows and drops empty groups`, () => {
    const rows = Array.from({ length: 80 }, (_, index) => ({ id: index, label: `t${index}`, to: `/tasks/${index}` }))
    const groups = paletteGroups({ ...base, term: 't', goTo: [], actions: [], search: [section({ rows })] })
    expect(groups.map(group => group.id)).toEqual(['search-pmo-tasks'])
    expect(groups[0]!.items).toHaveLength(PALETTE_SECTION_LIMIT)
  })

  it('the shortcuts view shows only the help', () => {
    expect(paletteGroups({ ...base, term: 'x', view: 'shortcuts', help: [{ id: 'help:x', label: 'x' }] }))
      .toEqual([{ id: 'shortcuts', label: 'Shortcuts', items: [{ id: 'help:x', label: 'x' }] }])
  })
})
```

Append to `apps/web/app/modules/__tests__/manifests.test.ts`. Put the imports at the top: `allNavItems` from `'../../composables/nav/shellModules'`, `goKeyProblems` from `'../../composables/nav/paletteModel'`, `appCommands` from `'../surfaces'`. Add `requiredCapabilityForPath` to the existing `accessPolicy` import if it is not already imported.

```ts
describe('palette declarations', () => {
  it('go keys are single letters, never g, and unique across applications and the foundation', () => {
    expect(goKeyProblems(allNavItems())).toEqual([])
    expect(allNavItems().flatMap(item => item.goKey ?? []).sort()).toEqual(['c', 'd', 'e', 'h', 'm', 'p', 'r', 't', 'u'])
  })

  it('commands have unique ids under their manifest, open a path it owns and need that route\'s capability', () => {
    const ids = appCommands().map(command => command.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const manifest of appManifests) {
      for (const command of manifest.commands ?? []) {
        expect(command.id.startsWith(`${manifest.id}.`), command.id).toBe(true)
        expect(manifestForPath(command.to)?.id, command.id).toBe(manifest.id)
        expect(requiredCapabilityForPath(command.to), command.id).toBe(command.capability)
      }
    }
    expect(ids).toEqual(expect.arrayContaining([
      'pmo.new-project', 'pmo.new-task', 'meetings.new-meeting', 'meetings.new-series',
      'chat.new-conversation', 'hr.new-employee', 'hr.new-department', 'hr.new-document',
    ]))
  })
})
```

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim/apps/web && npx vitest run app/composables/nav/__tests__/paletteModel.test.ts app/modules/__tests__/manifests.test.ts
```

Expected: `paletteModel.test.ts` FAILS because the module is missing. In `manifests.test.ts`, the new `palette declarations` tests fail for the same reason, and the existing tests still pass.

- [ ] **Step 4: The palette model**

Create `apps/web/app/composables/nav/paletteModel.ts`:

```ts
import type { RouteLocationRaw } from 'vue-router'
// Relative imports: this module is unit-tested directly under plain vitest.
import { canReach, canReachPath, type AccessIdentity } from '../../utils/accessPolicy'
import { appCommands } from '../../modules/surfaces'
import type { AppCommand, AppSearchRow } from '../../modules/types'
import { SHORTCUT_HELP } from '../shortcuts/keymap'
import type { NavItem } from './shellModules'

/** Rows one search section shows; UCommandPalette cuts every group at `fuse.resultLimit` (default 12). */
export const PALETTE_SECTION_LIMIT = 50
/** `g` starts the chord, so it cannot also be a destination. */
const RESERVED_GO_KEYS: ReadonlySet<string> = new Set(['g'])

export type PaletteItemAction =
  | { kind: 'shortcuts' }
  | { kind: 'retry' | 'load-more'; section: string }
  | { kind: 'none' }

/** One palette row before the component adds its `onSelect`. */
export interface PaletteItem {
  id: string
  label: string
  icon?: string
  to?: RouteLocationRaw
  external?: boolean
  target?: '_blank'
  kbds?: string[]
  /** The key hint is decoration: hidden from assistive tech so the option's name stays its label. */
  kbdsHidden?: boolean
  loading?: boolean
  disabled?: boolean
  /** Not a link: the palette runs it and stays open. */
  action?: PaletteItemAction
}
export interface PaletteGroup { id: string; label: string; items: PaletteItem[]; ignoreFilter?: boolean }
/** One manifest search provider as the palette renders it (from useAppSearch). */
export interface PaletteSearchSection {
  id: string
  label: string
  icon: string
  rows: readonly AppSearchRow[]
  waiting: boolean
  error: boolean
  hasNext: boolean
  fetchingNext: boolean
  /** The provider's translated `truncatedKey` when it capped its response, else null. */
  notice: string | null
}

/** Every go key that is malformed, reserved or declared twice, as readable findings; empty when consistent. */
export function goKeyProblems(items: readonly Pick<NavItem, 'to' | 'goKey'>[]): string[] {
  const problems: string[] = []
  const owners = new Map<string, string[]>()
  for (const item of items) {
    if (item.goKey === undefined) continue
    if (!/^[a-z]$/.test(item.goKey)) problems.push(`${item.to}: go key "${item.goKey}" is not one lower-case letter`)
    else if (RESERVED_GO_KEYS.has(item.goKey)) problems.push(`${item.to}: go key "${item.goKey}" is reserved`)
    owners.set(item.goKey, [...(owners.get(item.goKey) ?? []), item.to])
  }
  for (const [key, targets] of owners) {
    if (targets.length > 1) problems.push(`go key "${key}" is declared by ${targets.join(' and ')}`)
  }
  return problems
}

/** The destination of each go key among the nav items the user can see (`useNav`). */
export function goKeyTargets(visible: readonly NavItem[]): Map<string, NavItem> {
  const targets = new Map<string, NavItem>()
  for (const item of visible) {
    if (item.goKey && !targets.has(item.goKey)) targets.set(item.goKey, item)
  }
  return targets
}

/**
 * Commands the identity may run: the command's capability with its feature (write for a `/new`
 * path, so a read-only tenant sees none) and the route's own capability, the gate the page itself applies.
 */
export function visibleCommands(identity: AccessIdentity, commands: readonly AppCommand[] = appCommands()): AppCommand[] {
  return commands.filter(command => canReach(identity, command.capability, command.to) && canReachPath(identity, command.to))
}

const goKbds = (key: string) => ['G', key.toUpperCase()]

/** Go to: the nav items the user can see, in rail order, with their `G` letter as a decorative hint. */
export function goToItems(visible: readonly NavItem[], label: (item: NavItem) => string): PaletteItem[] {
  return visible.map(item => ({
    id: `goto:${item.to}`,
    label: label(item),
    icon: item.icon,
    to: item.to,
    ...(item.to === '/odoo' ? { external: true, target: '_blank' as const } : {}),
    ...(item.goKey ? { kbds: goKbds(item.goKey), kbdsHidden: true } : {}),
  }))
}

/** Actions: each visible command opens its form with a return path to where the palette was opened. */
export function commandItems(commands: readonly AppCommand[], label: (key: string) => string, returnTo: string): PaletteItem[] {
  return commands.map(command => ({
    id: `command:${command.id}`,
    label: label(command.labelKey),
    icon: command.icon,
    to: { path: command.to, query: { returnTo } },
    ...(command.shortcut ? { kbds: [command.shortcut], kbdsHidden: true } : {}),
  }))
}

/** The `?` help view: the fixed table, then one `G` row per visible go key in letter order. Keys are read aloud here. */
export function helpItems(visible: readonly NavItem[], label: (key: string) => string, goTo: (item: NavItem) => string): PaletteItem[] {
  const none = { kind: 'none' } as const
  const fixed = SHORTCUT_HELP.map(entry => ({ id: `help:${entry.id}`, label: label(entry.labelKey), kbds: [...entry.kbds], action: none }))
  const go = [...goKeyTargets(visible).entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => ({ id: `help:go:${key}`, label: goTo(item), kbds: goKbds(key), action: none }))
  return [...fixed, ...go]
}

/**
 * The palette's groups (Tasmim spec §5): Go to; while a term is typed, one Search group per
 * provider (not re-filtered by Fuse: the provider already matched); then Actions. The shortcuts
 * view shows only the help. Empty groups are dropped.
 */
export function paletteGroups(input: {
  view: 'main' | 'shortcuts'
  term: string
  goTo: PaletteItem[]
  search: readonly PaletteSearchSection[]
  actions: PaletteItem[]
  help: PaletteItem[]
  returnTo: string
  labels: { goTo: string; actions: string; shortcuts: string; loading: string; error: string; loadMore: string }
}): PaletteGroup[] {
  if (input.view === 'shortcuts') return [{ id: 'shortcuts', label: input.labels.shortcuts, items: input.help }]
  const search = input.term.trim() ? input.search.flatMap((section): PaletteGroup[] => {
    const items: PaletteItem[] = section.rows.slice(0, PALETTE_SECTION_LIMIT).map(row => ({
      id: `search:${section.id}:${row.id}`,
      label: row.label,
      icon: section.icon,
      to: { path: row.to, query: { returnTo: input.returnTo } },
    }))
    if (section.notice) items.push({ id: `search:${section.id}:notice`, label: section.notice, icon: 'i-lucide-info', disabled: true })
    if (section.waiting && !section.rows.length) {
      items.push({ id: `search:${section.id}:loading`, label: input.labels.loading, loading: true, disabled: true })
    }
    if (section.error) {
      items.push({ id: `search:${section.id}:error`, label: input.labels.error, icon: 'i-lucide-rotate-cw', action: { kind: 'retry', section: section.id } })
    } else if (section.hasNext) {
      items.push({
        id: `search:${section.id}:more`, label: input.labels.loadMore, icon: 'i-lucide-chevrons-down',
        loading: section.fetchingNext, action: { kind: 'load-more', section: section.id },
      })
    }
    return items.length ? [{ id: `search-${section.id}`, label: section.label, items, ignoreFilter: true }] : []
  }) : []
  return [
    { id: 'goto', label: input.labels.goTo, items: input.goTo },
    ...search,
    { id: 'actions', label: input.labels.actions, items: input.actions },
  ].filter(group => group.items.length > 0)
}
```

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim/apps/web && npx vitest run app/composables/nav app/modules app/composables/shortcuts
```

Expected: PASS. (`toEqual` ignores key order, so any failure is a real difference in content.)

- [ ] **Step 5: Gates and commit**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim
npm -w apps/web run lint && npm test 2>&1 | tail -3 && python3 -B tools/ui_policy.py && python3 -B tools/arch_policy.py
git add apps/web/app apps/web/i18n
git commit -m "feat(web): declare palette commands and go keys in manifests

Manifests gain optional commands and nav goKey; paletteModel builds
the Go to, Search and Actions groups and the shortcut help rows and
checks go-key uniqueness. Shell strings: search.* and shortcuts.*.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Abort superseded searches (failing test first)**

Append inside `describe('useAppSearch', …)` in `apps/web/app/composables/__tests__/useAppSearch.test.ts`:

```ts
  it('passes the vue-query abort signal to every provider request', async () => {
    const { useAppSearch } = await import('../useAppSearch')
    const api = vi.fn(async () => [])
    const calling: AppManifest = {
      ...sales(true),
      search: [{
        ...provider(true),
        search: async (fetcher, q) => {
          await fetcher('/api/v1/sales', { query: { q }, schema: { parse: (value: unknown) => value } as never })
          return { rows: [] }
        },
      }],
    }
    withManifests([calling], () => useAppSearch({
      surface: 'dialog', term: ref('a'), debounced: ref('a'), gate: true, requireTerm: true, can: () => true, api: api as never,
    }))
    const controller = new AbortController()
    await fake.queries[0]!.options.queryFn({ pageParam: 0, signal: controller.signal })
    expect(api).toHaveBeenCalledWith('/api/v1/sales', expect.objectContaining({ query: { q: 'a' }, signal: controller.signal }))
  })
```

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim/apps/web && npx vitest run app/composables/__tests__/useAppSearch.test.ts
```

Expected: FAIL. `signal` is missing from the call.

In `apps/web/app/modules/types.ts`, change `AppSearchApi` to:

```ts
export type AppSearchApi = <T>(
  url: string,
  options: { query?: Record<string, unknown>; schema: ZodType<T>; signal?: AbortSignal },
) => Promise<T>
```

In `apps/web/app/composables/useAppSearch.ts`, add `import type { ZodType } from 'zod'` and, above `useAppSearch`:

```ts
/** The provider's fetcher with vue-query's abort signal, so a superseded term's request is cancelled. */
function withSignal(api: AppSearchApi, signal: AbortSignal): AppSearchApi {
  return <T>(url: string, options: { query?: Record<string, unknown>; schema: ZodType<T>; signal?: AbortSignal }) =>
    api(url, { ...options, signal })
}
```

Then change the `queryFn` line to:

```ts
      queryFn: ({ pageParam, signal }) => provider.search(withSignal(api, signal), provider.serverSearch ? debounced.value : '', pageParam),
```

In `apps/web/app/composables/useApi.ts`, add `signal?: AbortSignal` to the `$api` `opts` type and `signal: opts.signal,` to the `$fetch` options, after `query: opts.query,`.

Staleness and cancellation in one place:

- Rows of a server search show only when the typed term equals the debounced term (`settled`, `useAppSearch.ts:53-56`; pinned by the existing test).
- Each term has its own query key, so a late response for `ab` lands in the `ab` cache entry and never under `abc`.
- When the key moves on, the superseded query loses its observer, and vue-query aborts the consumed signal.

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim
(cd apps/web && npx vitest run app/composables/__tests__/useAppSearch.test.ts)
npm -w apps/web run lint && npm test 2>&1 | tail -3
git add apps/web/app/composables/useAppSearch.ts apps/web/app/composables/useApi.ts apps/web/app/composables/__tests__/useAppSearch.test.ts apps/web/app/modules/types.ts
git commit -m "perf(web): abort superseded palette search requests

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```


---

### Task 5: The command palette

`GlobalSearch.vue` is rebuilt on `UCommandPalette`, and `⌘K`/`Ctrl K` and `?` move into the shell layer. The policy gains one rule: one palette, one keyboard layer.

**Files:**
- Create: `apps/web/app/composables/usePalette.ts`, `apps/web/app/composables/useShellShortcuts.ts`
- Rewrite: `apps/web/app/components/shell/GlobalSearch.vue`
- Modify: `apps/web/app/components/shell/ShellHeader.vue:1-29` (import and call `useShellShortcuts()`; update the header comment)
- Modify: `tools/ui_policy.py:394-418` (add `keyboard_layer_errors`), `:798` (call it); `tools/test_ui_policy.py` (after `test_header_search_keeps_its_approved_dialog`, `:448`)
- Rewrite: `apps/web/stories/shell/GlobalSearch.stories.ts`; Modify: `apps/web/stories/fixtures/shell.ts` (add `readOnlyShellMe`)
- Modify: `apps/web/e2e/support/visualStories.ts` (add `VISUAL_DIALOG_STORIES`), `apps/web/e2e/storybook-visual.spec.ts` (dialog loop and page-level axe)
- Modify: `apps/web/e2e/storybook-shell.spec.ts` (new describe `Tasmim command palette`)
- Modify (deliberate assertion updates, titles unchanged): `apps/web/e2e/command-menu.spec.ts:22`, `apps/web/e2e/header-overlays.spec.ts:24,35`
- Regenerate: `docs/design-system/catalog.json`; new PNGs `apps/web/e2e/storybook-visual.spec.ts-snapshots/shell-globalsearch--palette-*`

**Interfaces:**
- Consumes: everything Task 4 produced; `matchShortcut`, `IDLE_SHORTCUTS`, `isApplePlatform` (Task 3); `overlayOwnsEscape`; `useAppSearch`; `useNav`.
- Produces:
  - `usePalette(): { open: WritableComputedRef<boolean>; view: WritableComputedRef<PaletteView>; term: WritableComputedRef<string>; show(view?: PaletteView, term?: string): void; close(): void; toggle(): void }`, with `type PaletteView = 'main' | 'shortcuts'`. State key: `useState('nasq-palette')`.
  - `useShellShortcuts(handlers?: ShortcutHandlers): void`, with `type ShortcutHandlers = { [K in ShortcutAction['kind']]?: (action: Extract<ShortcutAction, { kind: K }>) => boolean }`. Built in: `palette` (toggle) and `help` (show `shortcuts`).
  - `keyboard_layer_errors(current: dict[str, str]) -> list[str]` (Python).
  - testids: `global-search-trigger`, `command-palette` (with `data-view="main|shortcuts"`), `palette-back`, `palette-footer`.

- [ ] **Step 1: One palette, one keyboard layer (policy, failing test first)**

Add to `tools/test_ui_policy.py` inside `StaticGateTest`, after `test_header_search_keeps_its_approved_dialog`:

```python
    def test_command_palette_and_define_shortcuts_have_one_owner(self):
        palette = "<template><UCommandPalette :groups='g' /></template>"
        self.assertEqual(policy.keyboard_layer_errors({self.COMPONENTS + "shell/GlobalSearch.vue": palette}), [])
        self.assertTrue(policy.keyboard_layer_errors({self.PAGES + "x.vue": palette}))
        self.assertTrue(policy.keyboard_layer_errors({self.COMPONENTS + "x.vue": "defineShortcuts({ g: () => {} })"}))
        self.assertEqual(policy.keyboard_layer_errors({self.COMPONENTS + "x.vue": "/* defineShortcuts(x) */"}), [])
```

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim/tools && python3 -B -m unittest test_ui_policy -q 2>&1 | tail -4
```

Expected: ERROR, `module 'ui_policy' has no attribute 'keyboard_layer_errors'`.

In `tools/ui_policy.py`, after `overlay_errors`:

```python
# Tasmim Plan 3: UCommandPalette renders only in the approved search overlay, and no component
# registers Nuxt UI defineShortcuts beside the shell keymap (apps/web/app/composables/shortcuts/keymap.ts).
COMMAND_PALETTE_TAG = re.compile(r'<(?:UCommandPalette|u-command-palette)[\s>/]')
DEFINE_SHORTCUTS = re.compile(r'\bdefineShortcuts\s*\(')


def keyboard_layer_errors(current: dict[str, str]) -> list[str]:
    errors = []
    for path, source in sorted(current.items()):
        if not path.startswith(APP) or not path.endswith(('.vue', '.ts')) or '/__tests__/' in path:
            continue
        text = COMMENTS.sub('', source)
        if path not in OVERLAY_OWNERS and COMMAND_PALETTE_TAG.search(text):
            errors.append(path + ': UCommandPalette renders only in the header palette (shell/GlobalSearch.vue)')
        if DEFINE_SHORTCUTS.search(text):
            errors.append(path + ': defineShortcuts bypasses the shell keymap; use composables/shortcuts/keymap.ts')
    return errors
```

In `main`, after `errors.extend(overlay_errors(current))`, add `errors.extend(keyboard_layer_errors(current))`.

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim && (cd tools && python3 -B -m unittest test_ui_policy -q) && python3 -B tools/ui_policy.py
git add tools/ui_policy.py tools/test_ui_policy.py
git commit -m "feat(tools): keep one command palette and one keyboard layer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: the tests pass, and `ui_policy` passes on the tree because no file uses either today.

- [ ] **Step 2: Palette state and the shell listener**

Create `apps/web/app/composables/usePalette.ts`:

```ts
import { computed } from 'vue'

export type PaletteView = 'main' | 'shortcuts'
interface PaletteState { open: boolean; view: PaletteView; term: string }

/**
 * The one command palette (Tasmim spec §5), shared by the header trigger, the shell keyboard
 * layer and stories. `useState` keeps one state per request on the server and one per app on the client.
 */
export function usePalette() {
  const state = useState<PaletteState>('nasq-palette', () => ({ open: false, view: 'main', term: '' }))
  function show(view: PaletteView = 'main', term = '') {
    state.value = { open: true, view, term }
  }
  function close() {
    state.value = { open: false, view: 'main', term: '' }
  }
  function toggle() {
    if (state.value.open) close()
    else show()
  }
  const open = computed({
    get: () => state.value.open,
    set: (value: boolean) => (value ? show(state.value.view, state.value.term) : close()),
  })
  const view = computed({
    get: () => state.value.view,
    set: (value: PaletteView) => { state.value = { ...state.value, view: value, term: '' } },
  })
  const term = computed({
    get: () => state.value.term,
    set: (value: string) => { state.value = { ...state.value, term: value } },
  })
  return { open, view, term, show, close, toggle }
}
```

Create `apps/web/app/composables/useShellShortcuts.ts`:

```ts
import { useEventListener } from '@vueuse/core'
import { IDLE_SHORTCUTS, matchShortcut, type ShortcutAction, type ShortcutState } from './shortcuts/keymap'
import { overlayOwnsEscape } from './useEscapeBack'
import { usePalette } from './usePalette'

/** A handler runs one action and returns true when it used the key; the listener then prevents its default. */
export type ShortcutHandlers = { [K in ShortcutAction['kind']]?: (action: Extract<ShortcutAction, { kind: K }>) => boolean }

/**
 * The shell's one keyboard listener (Tasmim spec §5); call it once, from ShellHeader. It listens
 * on window in the capture phase, so a key it uses is default-prevented before any page listener
 * runs (those skip defaultPrevented keys) and never types into a field the action just focused.
 */
export function useShellShortcuts(handlers: ShortcutHandlers = {}) {
  const hydrated = useHydrated()
  const palette = usePalette()
  const builtIn: ShortcutHandlers = {
    palette: () => { palette.toggle(); return true },
    help: () => { palette.show('shortcuts'); return true },
  }
  let state: ShortcutState = IDLE_SHORTCUTS
  useEventListener(() => (typeof window === 'undefined' ? null : window), 'keydown', (event: KeyboardEvent) => {
    const overlayOpen = overlayOwnsEscape(document)
    const result = matchShortcut(event, { hydrated: hydrated.value, overlayOpen, now: event.timeStamp }, state)
    state = result.state
    const action = result.action
    if (!action) return
    const run = (handlers[action.kind] ?? builtIn[action.kind]) as ((action: ShortcutAction) => boolean) | undefined
    if (run?.(action)) event.preventDefault()
  }, { capture: true })
}
```

In `apps/web/app/components/shell/ShellHeader.vue`:

- add `import { useShellShortcuts } from '@/composables/useShellShortcuts'` to the imports;
- add `useShellShortcuts()` after `const mobileCreateLinks = …`;
- replace the comment at `:13-14` with:

```ts
// The 48px neutral header (spec §5): tenant mark, breadcrumb, the ⌘K command palette,
// appearance, bell, account; a console badge on /vendor/*. It also hosts the shell's
// one keyboard listener (useShellShortcuts).
```

- [ ] **Step 3: `GlobalSearch.vue` on `UCommandPalette`**

Replace `apps/web/app/components/shell/GlobalSearch.vue`:

```vue
<script setup lang="ts">
import { refDebounced } from '@vueuse/core'
import type { CommandPaletteGroup, CommandPaletteItem } from '@nuxt/ui'
import { useNav, type NavItem } from '@/composables/nav/shellModules'
import {
  commandItems, goToItems, helpItems, paletteGroups, PALETTE_SECTION_LIMIT, visibleCommands, type PaletteItem,
} from '@/composables/nav/paletteModel'
import { isApplePlatform } from '@/composables/shortcuts/keymap'
import { useAppSearch } from '@/composables/useAppSearch'
import { usePalette } from '@/composables/usePalette'

// The command palette (Tasmim spec §5) and still the one approved search overlay
// (DESIGN.md §5; tools/ui_policy.py OVERLAY_OWNERS): Go to (the nav the user can reach),
// Search (one group per manifest provider), Actions (manifest commands), and the `?`
// shortcut help as a second view of the same dialog. Keys are bound in useShellShortcuts.
const { t, localeProperties } = useI18n()
const { me } = useMe()
const { can } = useAccess()
const { $api } = useApi()
const route = useRoute()
const hydrated = useHydrated()
const { open, view, term, close } = usePalette()
const trimmed = computed(() => term.value.trim())
const debounced = refDebounced(trimmed, 200)
const sections = useAppSearch({ surface: 'dialog', term: trimmed, debounced, gate: open, requireTerm: true, can, api: $api })
// ⌘ on Apple platforms, Ctrl elsewhere; SSR and the first client render agree on ⌘.
const metaKey = ref('⌘')
onMounted(() => { if (!isApplePlatform(navigator)) metaKey.value = 'Ctrl ' })
watch(() => route.fullPath, () => { if (open.value) close() })

function navLabel(item: NavItem) {
  return item.to === '/projects/settings' ? t('nav.projectSettings') : t(item.labelKey)
}
const sectionFor = (id: string) => sections.find(section => section.provider.id === id)
const searching = computed(() => !!trimmed.value && sections.some(section => section.visible.value && section.waiting.value))

// A link selection that leaves the page hands focus to the layout, which focuses <main>
// after the route changes; otherwise reka returns focus to the trigger or to the element
// that had it when ⌘K was pressed.
let leavingFor: string | null = null
function pathOf(to: PaletteItem['to']): string | null {
  if (typeof to === 'string') return to.split(/[?#]/, 1)[0] ?? to
  return to && typeof to === 'object' && 'path' in to && typeof to.path === 'string' ? to.path : null
}
function onCloseAutoFocus(event: Event) {
  if (leavingFor !== null && leavingFor !== route.path) event.preventDefault()
  leavingFor = null
}
function toItem(item: PaletteItem): CommandPaletteItem {
  const { action, ...rest } = item
  return {
    ...rest,
    onSelect(event: Event) {
      if (!action) {
        leavingFor = item.external ? null : pathOf(item.to)
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
function onBackspace() {
  if (view.value === 'shortcuts' && !term.value) view.value = 'main'
}

const groups = computed<CommandPaletteGroup<CommandPaletteItem>[]>(() => {
  if (!open.value) return []
  const visible = useNav(me.value)
  const shortcutsEntry: PaletteItem = { id: 'command:shortcuts', label: t('shortcuts.title'), icon: 'i-lucide-keyboard', kbds: ['?'], kbdsHidden: true, action: { kind: 'shortcuts' } }
  return paletteGroups({
    view: view.value,
    term: trimmed.value,
    goTo: goToItems(visible, navLabel),
    search: sections.filter(section => section.visible.value).map(section => ({
      id: section.provider.id,
      label: t(section.provider.labelKey),
      icon: section.provider.icon,
      rows: section.rows.value,
      waiting: section.waiting.value,
      error: !!section.error.value,
      hasNext: section.hasNext.value,
      fetchingNext: section.fetchingNext.value,
      notice: section.truncated.value && section.provider.truncatedKey ? t(section.provider.truncatedKey) : null,
    })),
    actions: [...commandItems(visibleCommands(me.value), key => t(key), route.fullPath), shortcutsEntry],
    help: helpItems(visible, key => t(key), item => t('shortcuts.goTo', { name: navLabel(item) })),
    returnTo: route.fullPath,
    labels: {
      goTo: t('nav.goTo'), actions: t('search.actions'), shortcuts: t('shortcuts.title'),
      loading: t('search.loading'), error: t('search.error'), loadMore: t('app.loadMore'),
    },
  }).map(group => ({ ...group, items: group.items.map(toItem) }))
})
</script>

<template>
  <UModal
    v-model:open="open"
    :title="t('app.search')"
    :description="t('search.description')"
    :content="{ onCloseAutoFocus }"
    :ui="{ content: 'nasq-search-dialog max-w-2xl max-h-[min(620px,calc(100dvh-2rem))] gap-0 divide-y-0 overflow-hidden rounded-xl p-0', overlay: 'nasq-search-overlay' }"
  >
    <UButton
      :aria-label="t('app.search')"
      aria-keyshortcuts="Meta+K Control+K"
      color="neutral"
      variant="outline"
      class="nasq-search-trigger"
      data-testid="global-search-trigger"
      :disabled="!hydrated"
    >
      <span class="flex min-w-0 items-center gap-2">
        <UIcon name="i-lucide-search" class="size-4 shrink-0" aria-hidden="true" />
        <span data-slot="label" class="nasq-search-trigger-label truncate">{{ t('app.search') }}</span>
      </span>
      <UKbd dir="ltr">{{ metaKey }}K</UKbd>
    </UButton>
    <template #content>
      <UCommandPalette
        v-model:search-term="term"
        :groups="groups"
        :placeholder="view === 'shortcuts' ? t('shortcuts.filter') : t('search.description')"
        :input="{ id: 'global-search-input', 'aria-label': t('app.search'), autocomplete: 'off' }"
        :loading="searching"
        :fuse="{ resultLimit: PALETTE_SECTION_LIMIT + 3 }"
        preserve-group-order
        :dir="localeProperties.dir"
        :data-view="view"
        data-testid="command-palette"
        class="max-h-[min(620px,calc(100dvh-2rem))]"
        @keydown.backspace="onBackspace"
      >
        <template #close>
          <div class="flex shrink-0 items-center gap-1">
            <UButton
              v-if="view === 'shortcuts'"
              color="neutral"
              variant="ghost"
              square
              icon="i-lucide-arrow-left"
              :ui="{ leadingIcon: 'rtl:-scale-x-100' }"
              :aria-label="t('shortcuts.backToCommands')"
              data-testid="palette-back"
              @click="view = 'main'"
            />
            <UButton color="neutral" variant="ghost" square icon="i-lucide-x" :aria-label="t('search.close')" @click="close()" />
          </div>
        </template>
        <template #item-trailing="{ item }">
          <span v-if="item.kbds?.length" class="flex shrink-0 items-center gap-0.5" dir="ltr" :aria-hidden="item.kbdsHidden ? 'true' : undefined">
            <UKbd v-for="kbd in item.kbds" :key="kbd" :value="kbd" size="sm" />
          </span>
        </template>
        <template #empty>
          <p class="px-4 py-10 text-center text-base text-muted">{{ t('app.noResults') }}</p>
        </template>
        <template #footer>
          <p v-if="view === 'shortcuts'" class="text-xs text-muted" data-testid="palette-footer">{{ t('shortcuts.layoutNote') }}</p>
          <div v-else class="flex flex-wrap items-center gap-3 text-xs text-muted" data-testid="palette-footer">
            <span class="flex items-center gap-1">
              <span class="flex gap-0.5" dir="ltr" aria-hidden="true"><UKbd value="arrowup" size="sm" /><UKbd value="arrowdown" size="sm" /></span>
              {{ t('search.footerMove') }}
            </span>
            <span class="flex items-center gap-1"><UKbd value="enter" size="sm" aria-hidden="true" />{{ t('search.footerOpen') }}</span>
            <span class="flex items-center gap-1"><UKbd value="escape" size="sm" aria-hidden="true" />{{ t('search.footerClose') }}</span>
          </div>
        </template>
      </UCommandPalette>
    </template>
  </UModal>
</template>
```

Notes for the implementer:

- **`UModal` keeps its title, description and `#content` slot.** With `#content`, the title and description are rendered visually hidden (`Modal.vue:82-93`), so the dialog's accessible name stays «بحث».
- **The trigger's `⌘K` text is unchanged on macOS.** The `shell-globalsearch--default`, `shell-shellheader--*` and `shell-shellframe--*` baselines must not change.
- **The listener moved.** The old `useEventListener('keydown', …)` in this file is gone; `useShellShortcuts` now owns `⌘K`.
- **If `vue-tsc` rejects `:content="{ onCloseAutoFocus }"`**, type the handler as `(event: Event) => void` and keep it. Do not drop focus handling.

- [ ] **Step 4: Stories**

Append to `apps/web/stories/fixtures/shell.ts`:

```ts
/** The same workspace user without any create or manage capability (palette Actions must be empty). */
export const readOnlyShellMe = { ...shellMe, capabilities: shellMe.capabilities.filter(key => !/\.(create|manage)$/.test(key)) }
```

Replace `apps/web/stories/shell/GlobalSearch.stories.ts`:

```ts
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { http, HttpResponse } from 'msw'
import GlobalSearch from '../../app/components/shell/GlobalSearch.vue'
import { usePalette, type PaletteView } from '../../app/composables/usePalette'
import { readOnlyShellMe } from '../fixtures/shell'
import { shellHandlers } from '../handlers/shell'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shell/GlobalSearch',
  component: GlobalSearch,
  parameters: { msw: { handlers: { api: shellHandlers } } },
} satisfies Meta<typeof GlobalSearch>
export default meta
type Story = StoryObj<typeof meta>

const context = storyContext('apps/web/app/components/shell/ShellHeader.vue:52')
const template = '<div class="nasq-shell-header-actions"><GlobalSearch /></div>'
/** The palette already open: the state is set in setup, after the global loader resets the shim state. */
const opened = (view: PaletteView = 'main', term = '') => () => ({
  components: { GlobalSearch },
  setup: () => { usePalette().show(view, term) },
  template,
})
const withTasks = (resolver: Parameters<typeof http.get>[1]) =>
  ({ msw: { handlers: { api: [http.get('/api/v1/tasks', resolver), ...shellHandlers] } } })

export const Default: Story = {
  name: 'زر البحث',
  parameters: context,
  render: () => ({ components: { GlobalSearch }, template }),
}
export const PaletteMain: Story = { name: 'لوحة الأوامر', parameters: context, render: opened() }
export const PaletteSearch: Story = {
  name: 'نتائج البحث',
  parameters: { ...context, ...withTasks(() => HttpResponse.json({ items: [], total: 0 })) },
  render: opened('main', 'مشروع'),
}
export const PaletteError: Story = {
  name: 'تعذّر البحث',
  parameters: { ...context, ...withTasks(() => HttpResponse.json({ code: 'server_error', message: 'Storybook' }, { status: 500 })) },
  render: opened('main', 'مشروع'),
}
export const PaletteShortcuts: Story = { name: 'اختصارات لوحة المفاتيح', parameters: context, render: opened('shortcuts') }
export const PaletteReadOnly: Story = {
  name: 'قارئ بلا صلاحية إنشاء',
  parameters: { ...context, msw: { handlers: { api: [http.get('/api/v1/me', () => HttpResponse.json(readOnlyShellMe)), ...shellHandlers] } } },
  render: opened(),
}
```

There is deliberately no loading story: an endless MSW delay would block the visual spec's `networkidle` wait. The `paletteGroups` unit test pins the loading row.

In `apps/web/e2e/support/visualStories.ts`, append:

```ts
// Stories whose content is a portal dialog, captured full-page with a page-level axe pass (Tasmim Plan 3).
export const VISUAL_DIALOG_STORIES: string[] = ['shell-globalsearch--palette-']
```

In `apps/web/e2e/storybook-visual.spec.ts`:

- import `VISUAL_DIALOG_STORIES`;
- add inside `test.describe('Storybook visual snapshots', …)`, after the mobile loop:

```ts
  for (const story of storybookEntries().filter(entry => entry.type === 'story' && VISUAL_DIALOG_STORIES.some(prefix => entry.id.startsWith(prefix)))) {
    const visit = async (page: import('@playwright/test').Page, locale: string, appearance: string) => {
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.goto(`${base}/iframe.html?id=${story.id}&viewMode=story&globals=locale:${locale};appearance:${appearance}`)
      await page.getByRole('dialog').waitFor()
      await page.waitForLoadState('networkidle')
      await expect(page.locator('[role="dialog"] .animate-spin')).toHaveCount(0)
      await page.evaluate(() => document.fonts.ready)
    }
    for (const { locale, appearance } of VISUAL_MATRIX) {
      test(`${story.id} ${locale}-${appearance} dialog`, async ({ page }) => {
        await visit(page, locale, appearance)
        await expect(page).toHaveScreenshot(`${story.id}-${locale}-${appearance}-dialog.png`, { animations: 'disabled', maxDiffPixelRatio: 0.002, threshold: 0.05 })
      })
    }
    test(`${story.id} dialog has no serious axe violations`, async ({ page }) => {
      for (const { locale, appearance } of VISUAL_MATRIX) {
        await visit(page, locale, appearance)
        const result = await new AxeBuilder({ page }).include('[role="dialog"]').analyze()
        const serious = result.violations.filter(v => v.impact === 'serious' || v.impact === 'critical')
        expect(serious.map(v => `${locale}-${appearance} ${v.id}: ${v.nodes.length}`)).toEqual([])
      }
    })
  }
```

- [ ] **Step 5: Storybook interaction tests**

Append to `apps/web/e2e/storybook-shell.spec.ts`:

```ts
test.describe('Tasmim command palette', () => {
  requireStorybook()
  test.use({ viewport: { width: 1440, height: 900 } })
  test.beforeAll(async () => { ({ base, close } = await startStorybookServer()) })
  test.afterAll(async () => { await close() })
  const dialog = (page: Page) => page.getByRole('dialog', { name: 'بحث', exact: true })

  for (const chord of ['Meta+k', 'Control+k'] as const) {
    test(`${chord} opens the palette with its input focused and toggles it closed`, async ({ page }) => {
      await open(page, 'shell-shellframe--default', 'locale:ar;appearance:light')
      await expect(page.getByTestId('global-search-trigger')).toBeEnabled()
      await page.keyboard.press(chord)
      await expect(dialog(page)).toBeVisible()
      await expect(dialog(page).getByRole('textbox', { name: 'بحث', exact: true })).toBeFocused()
      await expect(dialog(page).getByRole('option', { name: 'المشاريع', exact: true })).toBeVisible()
      await page.keyboard.press(chord)
      await expect(dialog(page)).toBeHidden()
    })
  }

  test('typing filters Go to; Enter opens the highlighted page', async ({ page }) => {
    await open(page, 'shell-shellframe--default', 'locale:ar;appearance:light')
    await page.getByTestId('global-search-trigger').click()
    await page.keyboard.type('المشاريع')
    await expect(dialog(page).getByRole('option', { name: 'المشاريع', exact: true })).toBeVisible()
    await expect(dialog(page).getByRole('option', { name: 'مهامي', exact: true })).toHaveCount(0)
    await page.keyboard.press('Enter')
    await expect(dialog(page)).toBeHidden()
    await expect(page.getByTestId('context-link-projects')).toHaveAttribute('aria-current', 'page')
  })

  test('Esc closes and returns focus to the trigger, or to the element ⌘K was pressed on', async ({ page }) => {
    await open(page, 'shell-shellframe--default', 'locale:ar;appearance:light')
    const trigger = page.getByTestId('global-search-trigger')
    await trigger.click()
    await expect(dialog(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toBeHidden()
    await expect(trigger).toBeFocused()
    const link = page.getByTestId('context-link-tasks')
    await link.focus()
    await page.keyboard.press('ControlOrMeta+k')
    await expect(dialog(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toBeHidden()
    await expect(link).toBeFocused()
  })

  test('? opens the shortcut help inside the same dialog; Backspace and the back button return', async ({ page }) => {
    await open(page, 'shell-shellframe--default', 'locale:ar;appearance:light')
    await expect(page.getByTestId('global-search-trigger')).toBeEnabled()
    await page.keyboard.press('Shift+Slash')
    const palette = page.getByTestId('command-palette')
    await expect(palette).toHaveAttribute('data-view', 'shortcuts')
    await expect(page.getByRole('dialog')).toHaveCount(1)
    await expect(palette.getByRole('option', { name: /فتح لوحة الأوامر/ })).toBeVisible()
    await expect(palette.getByRole('option', { name: /الانتقال إلى المشاريع/ })).toContainText('P')
    await page.keyboard.press('Backspace')
    await expect(palette).toHaveAttribute('data-view', 'main')
    await palette.getByRole('option', { name: 'اختصارات لوحة المفاتيح', exact: true }).click()
    await expect(palette).toHaveAttribute('data-view', 'shortcuts')
    await page.getByTestId('palette-back').click()
    await expect(palette).toHaveAttribute('data-view', 'main')
  })

  test('Actions hide commands the user cannot run', async ({ page }) => {
    await open(page, 'shell-globalsearch--palette-main', 'locale:ar;appearance:light')
    await expect(page.getByRole('option', { name: 'مشروع جديد', exact: true })).toBeVisible()
    await open(page, 'shell-globalsearch--palette-read-only', 'locale:ar;appearance:light')
    await expect(page.getByRole('option', { name: 'المشاريع', exact: true })).toBeVisible()
    await expect(page.getByRole('option', { name: 'مشروع جديد', exact: true })).toHaveCount(0)
  })

  test('search shows provider rows, and a retry row when a provider fails', async ({ page }) => {
    await open(page, 'shell-globalsearch--palette-search', 'locale:ar;appearance:light')
    await expect(page.getByRole('option', { name: 'مشروع ألفا', exact: true })).toBeVisible()
    await open(page, 'shell-globalsearch--palette-error', 'locale:ar;appearance:light')
    await expect(page.getByRole('option', { name: 'تعذّر البحث. اختر للمحاولة مجددًا.', exact: true })).toBeVisible()
  })

  for (const [locale, dir] of LOCALES) {
    test(`the palette follows the page direction (${locale})`, async ({ page }) => {
      await open(page, 'shell-globalsearch--palette-main', `locale:${locale};appearance:light`)
      const palette = page.getByTestId('command-palette')
      await expect(palette).toHaveAttribute('dir', dir)
      const option = page.getByRole('option').first()
      const row = (await option.boundingBox())!
      const icon = (await option.locator('[data-slot="itemLeadingIcon"]').boundingBox())!
      if (dir === 'rtl') expect(icon.x + icon.width).toBeGreaterThan(row.x + row.width - 40)
      else expect(icon.x).toBeLessThan(row.x + 40)
    })
  }
})
```

- [ ] **Step 6: Deliberate assertion updates in the mock e2e specs**

Results are now `role="option"` inside a listbox, no longer `role="link"` buttons. Edit the following lines and keep their titles:

- `apps/web/e2e/command-menu.spec.ts:22`: `dialog.getByRole('link', { name: 'المشاريع', exact: true })` → `dialog.getByRole('option', { name: 'المشاريع', exact: true })`
- `apps/web/e2e/header-overlays.spec.ts:24` and `:35`: `dialog.getByRole('link', { name: task.name, exact: true })` → `dialog.getByRole('option', { name: task.name, exact: true })`

Confirm nothing else asserts the old dialog DOM:

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim/apps/web
rg -n "name: 'بحث', exact: true \}\)" e2e -l | xargs rg -n "dialog\.getByRole\('(link|button)'|nasq-search-dialog|global-search-input"
```

Expected: no output.

- [ ] **Step 7: Run**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim
python3 -B tools/ui_policy.py --refresh-story-context && node tools/ui_catalog.mjs
npm -w apps/web run lint && npm test 2>&1 | tail -3
python3 -B tools/ui_policy.py && (cd tools && python3 -B -m unittest test_ui_policy -q) && python3 -B tools/arch_policy.py
cd apps/web && npm run build-storybook >/dev/null
npx playwright test e2e/storybook-shell.spec.ts e2e/storybook-smoke.spec.ts --reporter=line
npx playwright test e2e/storybook-visual.spec.ts -g 'shell-globalsearch' --update-snapshots=missing --reporter=line
git status --short e2e/storybook-visual.spec.ts-snapshots
NASQ_REQUIRE_STORYBOOK=1 npx playwright test e2e/storybook-visual.spec.ts --reporter=line | tail -3
```

Expected:

- The shell and smoke specs pass, apart from the known pre-existing `shared-createpanel--form` smoke failure.
- `--update-snapshots=missing` writes only new files:
  - 20 root PNGs `shell-globalsearch--palette-*-{ar,en}-{light,dark}-darwin.png` (5 stories × 4);
  - 20 dialog PNGs `…-dialog-darwin.png`.
- `git status` lists only those 40 new files.
- The last run passes, including the five dialog axe tests.

A diff in `shell-globalsearch--default`, `shell-shellheader--*` or `shell-shellframe--*` means the trigger changed. Fix the component; do not re-baseline.

Then run the mock-stack specs that open the palette:

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim/apps/web
SCRATCH=$(mktemp -d)
PROJECTS_UI_PREVIEW=1 MODULE_UI_PREVIEW=1 MOCK_PORT=4498 node e2e/internal-ui-audit-mock.mjs > "$SCRATCH/mock.log" 2>&1 & MOCK_PID=$!
NUXT_ODOO_URL=http://127.0.0.1:4498 NUXT_ODOO_DB=nasq_ui_mock_only NUXT_PUBLIC_WS_URL=ws://127.0.0.1:4498/websocket npx nuxt dev --port 4097 > "$SCRATCH/nuxt.log" 2>&1 & NUXT_PID=$!
for i in $(seq 1 120); do curl -sf -o /dev/null http://localhost:4097/login && break; sleep 2; done
E2E_BASE_URL=http://localhost:4097 npx playwright test e2e/command-menu.spec.ts e2e/header-overlays.spec.ts e2e/internal-pages.spec.ts e2e/shell-tasmim.spec.ts --reporter=line
kill "$NUXT_PID" "$MOCK_PID"; while kill -0 "$NUXT_PID" 2>/dev/null || kill -0 "$MOCK_PID" 2>/dev/null; do sleep 1; done
lsof -ti tcp:4097 | xargs kill 2>/dev/null; true
```

Expected: no failing title that is absent from `.superpowers/tasmim-shared/e2e-baseline-failures.txt`.

- [ ] **Step 8: Commit**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim
git add apps/web docs/design-system/catalog.json
git commit -m "feat(web): rebuild the header search as a command palette

GlobalSearch now renders UCommandPalette: Go to, one Search group per
manifest provider, Actions from manifest commands, and the ? shortcut
help as a second view of the same dialog. Cmd/Ctrl+K and ? move to
the shell keyboard layer (useShellShortcuts, capture phase).

Deliberate e2e updates (titles unchanged): results are options now:
command-menu.spec.ts:22, header-overlays.spec.ts:24,35.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `/`, `C` and `G` then a letter

**Files:**
- Create: `apps/web/app/composables/shortcuts/targets.ts`, `apps/web/app/composables/shortcuts/__tests__/targets.test.ts`
- Modify: `apps/web/app/composables/useShellShortcuts.ts` (built-in `chord`)
- Modify: `apps/web/app/components/shell/ShellHeader.vue` (handlers for `focus-search`, `create`, `go`)
- Modify: `apps/web/app/components/shell/ContextSidebar.vue:41-55` (`C` hint on the first create action)
- Modify: `apps/web/app/components/shared/FilterBar.vue:4`, `apps/web/app/components/shared/FilterCard.vue:4` (`data-shortcut-search` on the search slot wrapper)
- Modify: `apps/web/app/pages/projects/index.vue:233`, `apps/web/app/pages/search.vue:40` (`data-shortcut-search` on the input)
- Create: `apps/web/e2e/shortcuts-tasmim.spec.ts`

**Interfaces:**
- Produces in `composables/shortcuts/targets.ts`:
  - `SEARCH_TARGET = '[data-shortcut-search]'`, `CREATE_TARGET = '[data-shortcut-create]'`
  - `focusListSearch(root: ParentNode): boolean`
  - `clickPageCreate(root: ParentNode): boolean`
- Page contract (documented in DESIGN.md by Task 8):
  - **`data-shortcut-search`** goes on a list's search input, or on a wrapper around it. `/` focuses and selects the first visible, enabled one. Without any, `/` does nothing and its default is kept.
  - **`data-shortcut-create`** goes on the page's own create control. `C` presses it. Without one, `C` opens the current module's pinned create link (`contextLinks`), the same target as the sidebar's create action. If neither exists, `C` does nothing.
  - **`G` then a letter** opens the visible nav item with that `goKey`. The pair is consumed even when no visible item has the letter, so it never types or reaches a page.

- [ ] **Step 1: Failing target tests**

Create `apps/web/app/composables/shortcuts/__tests__/targets.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { clickPageCreate, focusListSearch } from '../targets'

interface Double { tag: string; visible: boolean; disabled: boolean; ariaDisabled: boolean; children: Double[] }
function make(tag: string, patch: Partial<Double> = {}) {
  const node = { tag, visible: true, disabled: false, ariaDisabled: false, children: [] as Double[], focus: vi.fn(), select: vi.fn(), click: vi.fn(), ...patch }
  const tags = (selectors: string) => selectors.split(',').map(selector => selector.trim())
  return Object.assign(node, {
    matches: (selectors: string) => tags(selectors).includes(node.tag),
    querySelector: (selectors: string) => node.children.find(child => tags(selectors).includes(child.tag)) ?? null,
    getClientRects: () => (node.visible ? [{}] : []),
    getAttribute: (name: string) => (name === 'aria-disabled' && node.ariaDisabled ? 'true' : null),
  })
}
const root = (...marked: unknown[]) => ({ querySelectorAll: () => marked }) as unknown as ParentNode

describe('focusListSearch', () => {
  it('focuses and selects a marked input', () => {
    const input = make('input')
    expect(focusListSearch(root(input))).toBe(true)
    expect(input.focus).toHaveBeenCalled()
    expect(input.select).toHaveBeenCalled()
  })

  it('focuses the input inside a marked wrapper', () => {
    const input = make('input')
    expect(focusListSearch(root(make('div', { children: [input] })))).toBe(true)
    expect(input.focus).toHaveBeenCalled()
  })

  it('skips hidden and disabled fields and reports when nothing is usable', () => {
    const hidden = make('input', { visible: false })
    const disabled = make('input', { disabled: true })
    expect(focusListSearch(root(hidden, disabled, make('div')))).toBe(false)
    expect(hidden.focus).not.toHaveBeenCalled()
    expect(disabled.focus).not.toHaveBeenCalled()
  })
})

describe('clickPageCreate', () => {
  it('presses the first usable marked control', () => {
    const blocked = make('button', { ariaDisabled: true })
    const create = make('a')
    expect(clickPageCreate(root(blocked, create))).toBe(true)
    expect(blocked.click).not.toHaveBeenCalled()
    expect(create.click).toHaveBeenCalled()
  })

  it('reports when the page marked none', () => {
    expect(clickPageCreate(root())).toBe(false)
  })
})
```

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim/apps/web && npx vitest run app/composables/shortcuts/__tests__/targets.test.ts
```

Expected: FAIL. The module is missing.

- [ ] **Step 2: Targets and the shell handlers**

Create `apps/web/app/composables/shortcuts/targets.ts`:

```ts
/*
 * The attributes a page sets to opt in to shell shortcuts (Tasmim spec §5). The shell reads the
 * DOM for them, so it imports no page or application component (R3).
 */
export const SEARCH_TARGET = '[data-shortcut-search]'
export const CREATE_TARGET = '[data-shortcut-create]'
const FIELD = 'input, textarea'

function usable(element: HTMLElement): boolean {
  return element.getClientRects().length > 0
    && !(element as HTMLInputElement).disabled
    && element.getAttribute('aria-disabled') !== 'true'
}

/** `/`: focus and select the first visible, enabled list search a page marked; false when there is none. */
export function focusListSearch(root: ParentNode): boolean {
  for (const marked of Array.from(root.querySelectorAll<HTMLElement>(SEARCH_TARGET))) {
    const field = marked.matches(FIELD) ? marked : marked.querySelector<HTMLElement>(FIELD)
    if (!field || !usable(field)) continue
    field.focus()
    ;(field as HTMLInputElement).select?.()
    return true
  }
  return false
}

/** `C`: press the page's own create control when it marked one; false lets the shell use the module's create link. */
export function clickPageCreate(root: ParentNode): boolean {
  const control = Array.from(root.querySelectorAll<HTMLElement>(CREATE_TARGET)).find(usable)
  if (!control) return false
  control.click()
  return true
}
```

In `apps/web/app/composables/useShellShortcuts.ts`, add a third built-in. The first `G` is consumed, so it never types or reaches a page:

```ts
    chord: () => true,
```

In `apps/web/app/components/shell/ShellHeader.vue`:

- add the imports:

```ts
import { useNav } from '@/composables/nav/shellModules'
import { goKeyTargets } from '@/composables/nav/paletteModel'
import { clickPageCreate, focusListSearch } from '@/composables/shortcuts/targets'
```

- replace `useShellShortcuts()` with:

```ts
const { me } = useMe()
useShellShortcuts({
  'focus-search': () => focusListSearch(document),
  create: () => {
    if (clickPageCreate(document)) return true
    const link = contextLinks.value.find(item => item.pinned)
    if (!link) return false
    void navigateTo(createTo(link))
    return true
  },
  go: ({ key }) => {
    const target = goKeyTargets(useNav(me.value)).get(key)
    if (target) void navigateTo(target.to)
    return true
  },
})
```

- [ ] **Step 3: Pages and shared lists opt in; the create hint**

- `FilterBar.vue:4`: `<div v-if="$slots.search" class="min-w-48 flex-1 *:w-full">` → `<div v-if="$slots.search" data-shortcut-search class="min-w-48 flex-1 *:w-full">`
- `FilterCard.vue:4`: add `data-shortcut-search` to the `data-slot="search"` wrapper the same way.
- `pages/projects/index.vue:233`: add `data-shortcut-search` to the `UInput` (Nuxt UI passes it to the `<input>`).
- `pages/search.vue:40`: add `data-shortcut-search` to `#navigation-search`.

In `ContextSidebar.vue:42-55`, change the create loop to index the first action and advertise `C`:

```vue
            <UTooltip v-for="(link, index) in props.createLinks" :key="link.id" :text="t(link.labelKey)" :kbds="index === 0 ? ['C'] : undefined">
              <UButton
                :to="link.to"
                color="primary"
                variant="ghost"
                square
                size="sm"
                icon="i-lucide-plus"
                class="nasq-context-create-icon"
                :data-active="link.active"
                :aria-current="link.active ? 'page' : undefined"
                :aria-label="t(link.labelKey)"
                :aria-keyshortcuts="index === 0 ? 'c' : undefined"
                :data-testid="`context-link-${link.id}`"
              />
            </UTooltip>
```

These are attribute-only changes, so no visual baseline may change.

- [ ] **Step 4: Mock-stack e2e**

Create `apps/web/e2e/shortcuts-tasmim.spec.ts`:

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
async function hydrated(page: Page, path: string) {
  await page.goto(path)
  await expect(page.getByTestId('global-search-trigger')).toBeEnabled()
}
/** A keydown as an Arabic (101) layout sends it: the Arabic character with the US physical code. */
async function arabicKey(page: Page, key: string, code: string) {
  await page.evaluate(([k, c]) => {
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: k, code: c, bubbles: true, cancelable: true }))
  }, [key, code] as const)
}
const dialog = (page: Page) => page.getByRole('dialog', { name: 'بحث', exact: true })

test.describe('Tasmim palette and shortcuts', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('the palette trigger and Cmd+K wait for hydration', async ({ page }) => {
    const resume = await beforeHydration(page, '/tasks')
    const trigger = page.getByTestId('global-search-trigger')
    await expect(trigger).toBeDisabled()
    await page.keyboard.press('ControlOrMeta+k')
    await expect(dialog(page)).toHaveCount(0)
    resume()
    await expect(trigger).toBeEnabled()
    await page.keyboard.press('ControlOrMeta+k')
    await expect(dialog(page)).toBeVisible()
  })

  test('Enter on a Go to option navigates and focus lands on the page', async ({ page }) => {
    await hydrated(page, '/tasks')
    await page.keyboard.press('ControlOrMeta+k')
    await dialog(page).getByRole('textbox').fill('المشاريع')
    await expect(dialog(page).getByRole('option', { name: 'المشاريع', exact: true })).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/projects$/)
    await expect(dialog(page)).toBeHidden()
    await expect(page.getByTestId('shell-main')).toBeFocused()
  })

  test('an action opens its create form with a return path', async ({ page }) => {
    await hydrated(page, '/tasks')
    await page.keyboard.press('ControlOrMeta+k')
    await dialog(page).getByRole('option', { name: 'مشروع جديد', exact: true }).click()
    await expect(page).toHaveURL(/\/projects\/new\?returnTo=%2Ftasks$/)
  })

  test('G then P navigates by label and on an Arabic layout, never while typing', async ({ page }) => {
    await hydrated(page, '/tasks')
    await page.getByRole('heading', { level: 1 }).click()
    await page.keyboard.press('g')
    await page.keyboard.press('p')
    await expect(page).toHaveURL(/\/projects$/)
    await expect(page.getByTestId('global-search-trigger')).toBeEnabled()
    await arabicKey(page, 'ل', 'KeyG')
    await arabicKey(page, 'ف', 'KeyT')
    await expect(page).toHaveURL(/\/tasks$/)
    await hydrated(page, '/projects')
    const search = page.locator('input[data-shortcut-search]')
    await expect(search).toBeEnabled()
    await search.click()
    await page.keyboard.type('gp')
    await expect(search).toHaveValue('gp')
    await expect(page).toHaveURL(/\/projects(?:\?.*)?$/)
  })

  test('/ focuses the list search without typing a slash; C opens the module create form', async ({ page }) => {
    await hydrated(page, '/projects')
    const search = page.locator('input[data-shortcut-search]')
    await expect(search).toBeEnabled()
    await page.getByRole('heading', { level: 1 }).click()
    await page.keyboard.press('/')
    await expect(search).toBeFocused()
    await expect(search).toHaveValue('')
    await page.getByRole('heading', { level: 1 }).click()
    await page.keyboard.press('c')
    await expect(page).toHaveURL(/\/projects\/new\?returnTo=%2Fprojects/)
  })

  test('? opens the shortcut help, and no plain shortcut fires while a menu is open', async ({ page }) => {
    await hydrated(page, '/tasks')
    await page.getByRole('heading', { level: 1 }).click()
    await page.keyboard.press('Shift+Slash')
    await expect(page.getByTestId('command-palette')).toHaveAttribute('data-view', 'shortcuts')
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toBeHidden()
    await page.getByTestId('appearance-menu').click()
    await expect(page.locator('[data-dismissable-layer]')).not.toHaveCount(0)
    await page.keyboard.press('g')
    await page.keyboard.press('p')
    await expect(page).toHaveURL(/\/tasks$/)
  })
})
```

If the mock identity lacks `pmo.projects.create`, the action and `C` tests fail on a missing option or URL. Check the `me` fixture in `e2e/internal-ui-audit-mock.mjs` and report. Do not edit the mock and do not weaken the test.

- [ ] **Step 5: Run**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim
(cd apps/web && npx vitest run app/composables)
python3 -B tools/ui_policy.py --refresh-story-context && node tools/ui_catalog.mjs
npm -w apps/web run lint && npm test 2>&1 | tail -3 && python3 -B tools/ui_policy.py && python3 -B tools/arch_policy.py
cd apps/web && npm run build-storybook >/dev/null
NASQ_REQUIRE_STORYBOOK=1 npx playwright test e2e/storybook-shell.spec.ts e2e/storybook-visual.spec.ts --reporter=line | tail -3
```

Expected: everything passes with no visual diff.

Then start the mock stack exactly as in Task 5 Step 7 and run:

```bash
E2E_BASE_URL=http://localhost:4097 npx playwright test e2e/shortcuts-tasmim.spec.ts e2e/shell-tasmim.spec.ts e2e/command-menu.spec.ts e2e/header-overlays.spec.ts --reporter=line
```

Expected: `shortcuts-tasmim` passes 6/6, and the others show no failing title outside the baseline. Stop both processes by PID as in Task 5.

If the "focus lands on the page" assertion fails because the trigger holds focus, `onCloseAutoFocus` is not being reached. Check that `:content` is bound on `UModal`; do not drop the assertion.

- [ ] **Step 6: Commit**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim
git add apps/web docs/design-system/catalog.json
git commit -m "feat(web): add the / C and G shortcuts to the shell

Pages opt in with data-shortcut-search and data-shortcut-create; C
otherwise opens the module's pinned create link. G then a letter uses
the manifest goKey. The first sidebar create action shows its C hint.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The J / K row contract and a demo story

Lists wire this in Plan 4 through `DataTable`. Here it ships as a composable, an attribute contract and a demo story only.

**Files:**
- Create: `apps/web/app/composables/shortcuts/rows.ts`, `apps/web/app/composables/shortcuts/__tests__/rows.test.ts`
- Create: `apps/web/app/composables/useRowNavigation.ts`
- Create: `apps/web/stories/shell/RowNavigation.stories.ts`
- Modify: `apps/web/e2e/support/visualStories.ts` (add `'shell-rownavigation--'` to `VISUAL_STORIES`)
- Modify: `apps/web/e2e/storybook-shell.spec.ts` (new describe)
- Regenerate: `docs/design-system/catalog.json`; 4 new PNGs `shell-rownavigation--demo-*`

**Interfaces:**
- Produces in `composables/shortcuts/rows.ts`:
  - `ROW_SELECTOR = '[data-shortcut-row]'`
  - `rowMove(event: ShortcutKeyEvent, context: { hydrated: boolean; overlayOpen: boolean }): 'j' | 'k' | null`
  - `nextRowIndex(current: number, count: number, move: 'j' | 'k'): number` (−1 when there are no rows)
- Produces `useRowNavigation(container: Readonly<Ref<HTMLElement | null>>): void`.
- Contract:
  - each row inside the container carries `data-shortcut-row` and is focusable (`tabindex="-1"` or a link);
  - `J`/`K` move focus;
  - `Enter` on a focused row clicks its first `a[href]`.

- [ ] **Step 1: Failing tests**

Create `apps/web/app/composables/shortcuts/__tests__/rows.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { ShortcutKeyEvent } from '../keymap'
import { nextRowIndex, rowMove } from '../rows'

const ev = (patch: Partial<ShortcutKeyEvent> = {}): ShortcutKeyEvent => ({
  key: 'j', code: 'KeyJ', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false,
  repeat: false, isComposing: false, keyCode: 74, defaultPrevented: false, target: { tagName: 'BODY', closest: () => null }, ...patch,
})
const ready = { hydrated: true, overlayOpen: false }

describe('rowMove', () => {
  it.each([
    [{ key: 'j', code: 'KeyJ' }, 'j'], [{ key: 'k', code: 'KeyK' }, 'k'],
    [{ key: 'ت', code: 'KeyJ' }, 'j'], [{ key: 'ن', code: 'KeyK' }, 'k'],
  ] as const)('%o moves %s', (patch, move) => {
    expect(rowMove(ev(patch), ready)).toBe(move)
  })

  it.each([
    ['Shift', { key: 'J', shiftKey: true }],
    ['typing', { target: { tagName: 'INPUT' } }],
    ['Ctrl', { ctrlKey: true }],
    ['composition', { isComposing: true }],
    ['another key', { key: 'x', code: 'KeyX' }],
  ] as const)('ignores %s', (_label, patch) => {
    expect(rowMove(ev(patch), ready)).toBeNull()
  })

  it('ignores keys while a menu is open or before hydration', () => {
    expect(rowMove(ev(), { hydrated: true, overlayOpen: true })).toBeNull()
    expect(rowMove(ev(), { hydrated: false, overlayOpen: false })).toBeNull()
  })
})

describe('nextRowIndex', () => {
  it.each([
    [-1, 3, 'j', 0], [-1, 3, 'k', 2], [0, 3, 'j', 1], [2, 3, 'j', 2], [1, 3, 'k', 0], [0, 3, 'k', 0], [-1, 0, 'j', -1],
  ] as const)('from %i of %i, %s goes to %i', (current, count, move, expected) => {
    expect(nextRowIndex(current, count, move)).toBe(expected)
  })
})
```

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim/apps/web && npx vitest run app/composables/shortcuts/__tests__/rows.test.ts
```

Expected: FAIL. The module is missing.

- [ ] **Step 2: Implement**

Create `apps/web/app/composables/shortcuts/rows.ts`:

```ts
// Relative import: this module is unit-tested directly under plain vitest.
import { plainShortcutBlocked, shortcutKey, type ShortcutKeyEvent } from './keymap'

/** A row a list offers to J / K (Tasmim spec §5); its container calls useRowNavigation. */
export const ROW_SELECTOR = '[data-shortcut-row]'

/** J or K by the shell keymap rule (so «ت» / «ن» work on Arabic), or null when the key must be left alone. */
export function rowMove(event: ShortcutKeyEvent, context: { hydrated: boolean; overlayOpen: boolean }): 'j' | 'k' | null {
  if (event.shiftKey || plainShortcutBlocked(event, context)) return null
  const key = shortcutKey(event)
  return key === 'j' || key === 'k' ? key : null
}

/** The row J / K moves to, clamped to the list; from no row, J starts at the top and K at the bottom. */
export function nextRowIndex(current: number, count: number, move: 'j' | 'k'): number {
  if (count === 0) return -1
  if (current < 0) return move === 'j' ? 0 : count - 1
  return move === 'j' ? Math.min(current + 1, count - 1) : Math.max(current - 1, 0)
}
```

Create `apps/web/app/composables/useRowNavigation.ts`:

```ts
import { useEventListener } from '@vueuse/core'
import type { Ref } from 'vue'
import { nextRowIndex, ROW_SELECTOR, rowMove } from './shortcuts/rows'
import { overlayOwnsEscape } from './useEscapeBack'

/**
 * J / K move focus between the rows `container` marked with `data-shortcut-row` (each focusable),
 * and Enter on a focused row opens its first link. A list opts in by calling this with its container;
 * Plan 4's DataTable wires it, the shell does not.
 */
export function useRowNavigation(container: Readonly<Ref<HTMLElement | null>>) {
  const hydrated = useHydrated()
  useEventListener(() => (typeof document === 'undefined' ? null : document), 'keydown', (event: KeyboardEvent) => {
    const root = container.value
    if (!root || event.defaultPrevented) return
    const rows = Array.from(root.querySelectorAll<HTMLElement>(ROW_SELECTOR))
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
    if (event.key === 'Enter' && current >= 0 && rows[current] === focused) {
      const link = rows[current]!.querySelector<HTMLElement>('a[href]')
      if (link) {
        event.preventDefault()
        link.click()
      }
    }
  })
}
```

- [ ] **Step 3: Demo story and its test**

Create `apps/web/stories/shell/RowNavigation.stories.ts`:

```ts
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRowNavigation } from '../../app/composables/useRowNavigation'
import { projectRefs } from '../fixtures/pmo'

// No component: the J / K contract (data-shortcut-row + useRowNavigation) that Plan 4's DataTable wires.
const meta = {
  title: 'Shell/RowNavigation',
  parameters: { layout: 'padded', docs: { description: { component: 'J / K تنقل بين الصفوف الموسومة `data-shortcut-row`، وEnter يفتح رابط الصف.' } } },
} satisfies Meta
export default meta

export const Demo: StoryObj = {
  name: 'تنقل الصفوف بـ J و K',
  render: () => ({
    setup() {
      const list = ref<HTMLElement | null>(null)
      useRowNavigation(list)
      return { list, rows: projectRefs, t: useI18n().t }
    },
    template: `<ul ref="list" class="max-w-md divide-y divide-default rounded-lg ring ring-default" :aria-label="t('nav.projects')">
      <li v-for="row in rows" :key="row.id" data-shortcut-row tabindex="-1" class="px-3 py-2 outline-none focus-visible:bg-elevated focus:bg-elevated">
        <a :href="'#project-' + row.id" class="text-highlighted">{{ row.name }}</a>
      </li>
    </ul>`,
  }),
}
```

Add `'shell-rownavigation--',` to `VISUAL_STORIES` in `apps/web/e2e/support/visualStories.ts`, after `'shell-mobilenavigation--',`. Append to `apps/web/e2e/storybook-shell.spec.ts`:

```ts
test.describe('Tasmim row navigation', () => {
  requireStorybook()
  test.use({ viewport: { width: 1440, height: 900 } })
  test.beforeAll(async () => { ({ base, close } = await startStorybookServer()) })
  test.afterAll(async () => { await close() })

  test('J and K move between marked rows by label or position; Enter opens the row', async ({ page }) => {
    await open(page, 'shell-rownavigation--demo', 'locale:ar;appearance:light')
    const rows = page.locator('[data-shortcut-row]')
    await page.keyboard.press('j')
    await expect(rows.nth(0)).toBeFocused()
    await page.keyboard.press('j')
    await expect(rows.nth(1)).toBeFocused()
    await page.keyboard.press('k')
    await expect(rows.nth(0)).toBeFocused()
    await page.evaluate(() => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ت', code: 'KeyJ', bubbles: true, cancelable: true })))
    await expect(rows.nth(1)).toBeFocused()
    await page.keyboard.press('Enter')
    await expect.poll(() => page.evaluate(() => location.hash)).toBe('#project-2')
  })
})
```

- [ ] **Step 4: Run and commit**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim
(cd apps/web && npx vitest run app/composables/shortcuts)
node tools/ui_catalog.mjs && npm -w apps/web run lint && npm test 2>&1 | tail -3 && python3 -B tools/ui_policy.py
cd apps/web && npm run build-storybook >/dev/null
npx playwright test e2e/storybook-shell.spec.ts -g 'row navigation' --reporter=line
npx playwright test e2e/storybook-visual.spec.ts -g 'shell-rownavigation' --update-snapshots=missing --reporter=line
NASQ_REQUIRE_STORYBOOK=1 npx playwright test e2e/storybook-visual.spec.ts -g 'shell-rownavigation' --reporter=line
cd .. && cd .. && git add apps/web docs/design-system/catalog.json
git commit -m "feat(web): add the J and K row navigation contract

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: the row test passes. Four `shell-rownavigation--demo-*` PNGs are written, and its axe test passes.

---

### Task 8: Document the palette and the shortcuts

**Files:**
- Modify: `DESIGN.md:113` (header bullet), new subsection before `### شريط الموديولات` (`:122`), `:195` (overlay exceptions)
- Modify: `docs/design-system/components.md` (new row after the «التنقل» row, `:27`)
- Modify: `docs/design-system/nuxt-ui-reference.md` (`## الغلاف`, `:86`)
- Regenerate: `docs/design-system/catalog.json`

**Interfaces:** documentation only.

- [ ] **Step 1: DESIGN.md (Arabic, in the file's voice)**

On line 113, replace the phrase «زر البحث مع ⌘K (يفتح البحث الحالي؛ لوحة الأوامر في الخطة 3)» (⌘K is in backticks in the file) with «زر لوحة الأوامر مع ⌘K», keeping ⌘K in backticks.

Insert before `### شريط الموديولات`:

> ### لوحة الأوامر والاختصارات
>
> - `⌘K` أو `Ctrl K`، أو زر البحث في الهيدر، يفتح لوحة الأوامر `shell/GlobalSearch.vue`. هي `UCommandPalette` داخل نافذة البحث الوحيدة. مجموعاتها بالترتيب:
>   - «الانتقال إلى»: صفحات التنقل التي يصل إليها المستخدم، وبجانب كل منها حرف `G`.
>   - نتائج البحث: مجموعة لكل مزوّد بحث في الـmanifests. تبدأ بعد توقف الكتابة 200ms، ويُلغى الطلب القديم.
>   - «إجراءات»: من `commands` في الـmanifest. تختفي إن غابت القدرة أو الميزة، وفي نسخة القراءة فقط.
> - Enter يفتح المحدد. Esc يغلق اللوحة ويعيد التركيز إلى الزر، أو إلى العنصر الذي ضُغط عليه `⌘K`. بعد الانتقال إلى صفحة يذهب التركيز إلى المحتوى.
> - `?` يعرض «اختصارات لوحة المفاتيح» داخل اللوحة نفسها، لا في نافذة ثانية. Backspace أو زر الرجوع يعيدان إلى الأوامر.
> - الاختصارات:
>   - `/` يركّز بحث القائمة إذا وسمته الصفحة بـ`data-shortcut-search` (يفعل ذلك `FilterBar` و`FilterCard`).
>   - `C` ينشئ في القسم الحالي. يضغط زر الصفحة الموسوم `data-shortcut-create`، وإن لم يوجد يفتح رابط الإنشاء المثبّت للموديول.
>   - `G` ثم حرف خلال ثانية ينتقل إلى الصفحة. الحرف من `goKey` في الـmanifest: حرف واحد فريد، ولا يكون `g`، ويفحصه `manifests.test.ts`.
>   - `J` و`K` للصفوف، و`Enter` للفتح، في القوائم التي تستدعي `useRowNavigation` وتسم صفوفها بـ`data-shortcut-row`.
>   - `[` يطوي القائمة الجانبية، و`Esc` للرجوع أو الإغلاق.
> - المفتاح يُقرأ من الحرف الذي يكتبه إن كانت لوحة المفاتيح لاتينية، فتتبع QWERTY وAZERTY وQWERTZ ملصقات مفاتيحها. في غيرها يُقرأ من موضع المفتاح على اللوحة الأمريكية (`event.code`). على العربية: «ل» ثم «ح» تعني `G P`، و«ج» تعني `[`، و«ظ» تعني `/`، و«؟» تعني `?`. مفتاح `ü` في QWERTZ ومفتاح `^` في AZERTY يعملان كـ`[`.
> - لا يعمل أي اختصار في هذه الحالات:
>   - أثناء الكتابة في حقل أو محرر؛
>   - مع `Ctrl` أو `⌘` أو `Alt`، عدا `⌘K`؛
>   - أثناء تركيب IME؛
>   - مع قائمة أو نافذة مفتوحة؛
>   - قبل الترطيب.
> - للاختصارات طبقة واحدة هي `composables/shortcuts/keymap.ts`. لا يُستخدم `defineShortcuts`، ويمنعه `ui_policy`.
> - التلميحات: زر البحث يعرض `⌘K`، وزر الطي يعرض `[`، وأول زر إنشاء في القائمة يعرض `C`.

On line 195, replace «- البحث العام: نافذة مركزية.» with «- البحث العام ولوحة الأوامر (`⌘K`)، ومعها عرض الاختصارات (`?`): نافذة مركزية واحدة، لا نافذة ثانية.»

- [ ] **Step 2: Components and reference**

In `docs/design-system/components.md`, add a row after the «التنقل» row:

| لوحة الأوامر والاختصارات | `apps/web/app/components/shell/GlobalSearch.vue` (قصة: `apps/web/stories/shell/GlobalSearch.stories.ts`), `apps/web/app/composables/shortcuts/keymap.ts`, `apps/web/app/composables/useShellShortcuts.ts`, `apps/web/app/composables/usePalette.ts`, `apps/web/app/composables/useRowNavigation.ts` (قصة: `apps/web/stories/shell/RowNavigation.stories.ts`) | UCommandPalette داخل UModal؛ طبقة اختصارات واحدة؛ UKbd/UTooltip |

In `docs/design-system/nuxt-ui-reference.md`, append this paragraph to `## الغلاف`:

> تُستخدم `UCommandPalette` داخل `UModal` في `shell/GlobalSearch.vue` وحده، ويمنع `ui_policy` استخدامها في مكان آخر. إعداداتها:
>
> - المجموعات معروضة بـ`preserve-group-order`.
> - مجموعات البحث `ignoreFilter`، لأن المزوّد طابق النص مسبقًا.
> - `fuse.resultLimit` أكبر من الافتراضي 12.
> - `#item-trailing` يعرض المفاتيح، ويخفيها عن قارئ الشاشة في الصفوف القابلة للتنفيذ حتى يبقى اسم الخيار هو عنوانه.
> - `#close` فيه زر الرجوع من عرض الاختصارات وزر الإغلاق.
> - `#footer` فيه تلميحات التنقل.
>
> `defineShortcuts` غير مستخدم، لأن نسخة 4.11.1 لا تناسب الاختصارات المطلوبة:
>
> - لا تطابق `/` و`?` و`[` في الوضع المستقل عن التخطيط.
> - لا تقرأ `isComposing`.
> - لا تعرف القوائم المفتوحة.
>
> الأدلة في `docs/superpowers/plans/2026-10-13-tasmim-plan-3-palette.md`.

- [ ] **Step 3: Check and commit**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim
node tools/ui_catalog.mjs && python3 -B tools/ui_policy.py && npm test 2>&1 | tail -3
rg -n "لوحة الأوامر في الخطة 3|وحدة إدارة نسق»" DESIGN.md
git add DESIGN.md docs/design-system
git commit -m "docs(web): document the command palette and keyboard shortcuts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: the policy and tests pass, and the `rg` prints nothing.

---

### Task 9: Checkpoint CP3 — full gates, e2e diff, owner demo

**Files:**
- Regenerate (only if Step 1 shows intended diffs): `apps/web/e2e/storybook-visual.spec.ts-snapshots/*`
- Create (not committed): `.superpowers/tasmim-shared/cp3/*.png`, `.superpowers/tasmim-shared/cp3/palette-ar-light.webm`, `.superpowers/tasmim-shared/e2e-cp3-failures.txt`

- [ ] **Step 1: Storybook gates**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim/apps/web
npm run build-storybook >/dev/null
NASQ_REQUIRE_STORYBOOK=1 npx playwright test e2e/storybook-visual.spec.ts e2e/storybook-density.spec.ts e2e/storybook-smoke.spec.ts e2e/storybook-shell.spec.ts --reporter=line 2>&1 | tail -15
```

Expected: everything passes with no skipped describe. The one exception is the known pre-existing `shared-createpanel--form` smoke failure (Plan 2 ruling; tracked for Plan 4). Any visual diff is unexpected: Tasks 2, 5 and 7 baselined their own stories. Investigate it before running `--update-snapshots`, and list any re-baselined family in the CP3 note.

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

Expected: all exit 0, and `git status` shows a clean tree.

- [ ] **Step 3: Mock e2e failing-title diff**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim/apps/web
SCRATCH=$(mktemp -d)
PROJECTS_UI_PREVIEW=1 MODULE_UI_PREVIEW=1 MOCK_PORT=4498 node e2e/internal-ui-audit-mock.mjs > "$SCRATCH/mock.log" 2>&1 & MOCK_PID=$!
NUXT_ODOO_URL=http://127.0.0.1:4498 NUXT_ODOO_DB=nasq_ui_mock_only NUXT_PUBLIC_WS_URL=ws://127.0.0.1:4498/websocket npx nuxt dev --port 4097 > "$SCRATCH/nuxt.log" 2>&1 & NUXT_PID=$!
for i in $(seq 1 120); do curl -sf -o /dev/null http://localhost:4097/login && break; sleep 2; done
FORCE_COLOR=0 E2E_BASE_URL=http://localhost:4097 E2E_PROJECT_POPUPS=1 npx playwright test --reporter=line > "$SCRATCH/cp3-e2e.log" 2>&1 || true
awk '/^ +[0-9]+ failed$/{f=1;next} f && /^ +[0-9]+ (flaky|passed|skipped|interrupted|did not run)/{f=0} f' "$SCRATCH/cp3-e2e.log" > ../../.superpowers/tasmim-shared/e2e-cp3-failures.txt
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
normalize < ../../.superpowers/tasmim-shared/e2e-cp3-failures.txt > "$SCRATCH/cp3.norm"
echo "NEW failures:"; comm -13 "$SCRATCH/baseline.norm" "$SCRATCH/cp3.norm"
echo "FIXED since baseline:"; comm -23 "$SCRATCH/baseline.norm" "$SCRATCH/cp3.norm"
echo "Raw counts:"; wc -l < ../../.superpowers/tasmim-shared/e2e-baseline-failures.txt; wc -l < ../../.superpowers/tasmim-shared/e2e-cp3-failures.txt
echo "Per-spec counts (< baseline, > cp3):"
diff <(cut -d' ' -f1 "$SCRATCH/baseline.norm" | sort | uniq -c) <(cut -d' ' -f1 "$SCRATCH/cp3.norm" | sort | uniq -c) || true
grep -E "^ +[0-9]+ (passed|failed|flaky)" "$SCRATCH/cp3-e2e.log"
```

Keep the mock stack running for Step 4.

Expected: `NEW failures:` is empty. The normalizer removes line numbers and reporter truncation (titles are cut at 90 characters, so parameterized families sharing a prefix collapse). That is why both the raw counts and the per-spec counts are compared.

Classify every NEW title as one of two kinds:

- **Intended.** A test whose title is unchanged but whose assertion this plan changed on purpose (Task 2 console badge, Task 5 option roles). Each must pass. If one fails, treat it as a regression.
- **Regression.** Fix it in the component, not in the spec.

For a title known to be load-sensitive (Plan 2: `project-clarity`), re-run that spec alone. It counts as a flake only if it then passes. Record each classification in the CP3 note.

- [ ] **Step 4: CP3 image set and a short recording**

With the mock stack still running, write `$SCRATCH/cp3-shots.cjs`:

```js
const { createRequire } = require('node:module')
const { chromium } = createRequire('/Users/tariq/code/nasq/.worktrees/tasmim/apps/web/package.json')('@playwright/test')
const out = process.argv[2]
const base = 'http://localhost:4097'
;(async () => {
  const browser = await chromium.launch()
  for (const locale of ['ar', 'en']) for (const mode of ['light', 'dark']) {
    const record = locale === 'ar' && mode === 'light'
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 }, locale: 'ar-SA', reducedMotion: 'reduce',
      ...(record ? { recordVideo: { dir: out, size: { width: 1440, height: 900 } } } : {}),
    })
    await context.addCookies([{ name: 'nasq-appearance', value: encodeURIComponent(JSON.stringify({ mode, fontSize: 'small' })), url: base }])
    const page = await context.newPage()
    await page.goto(`${base}/tasks`)
    await page.locator('[data-testid="global-search-trigger"]:not([disabled])').waitFor()
    if (locale === 'en') {
      await page.evaluate(async () => { await document.querySelector('#__nuxt').__vue_app__.$nuxt.$i18n.setLocale('en') })
      await page.locator('html[dir="ltr"]').waitFor()
    }
    await page.waitForLoadState('networkidle')
    await page.evaluate(() => document.fonts.ready)
    const shot = name => page.screenshot({ path: `${out}/palette-${locale}-${mode}-${name}.png` })
    const palette = page.getByTestId('command-palette')
    await page.keyboard.press('ControlOrMeta+k')
    await palette.waitFor()
    await shot('goto')
    await page.keyboard.type(locale === 'ar' ? 'جديد' : 'New')
    await page.waitForTimeout(400)
    await shot('actions')
    const projects = await (await page.request.get(`${base}/api/v1/projects?minimal=1`)).json()
    await page.getByRole('textbox', { name: locale === 'ar' ? 'بحث' : 'Search', exact: true }).fill(String(projects[0]?.name ?? 'a').slice(0, 4))
    await page.waitForTimeout(800)
    await shot('search')
    await page.keyboard.press('Escape')
    await page.getByRole('heading', { level: 1 }).click()
    await page.keyboard.press('Shift+Slash')
    await page.locator('[data-testid="command-palette"][data-view="shortcuts"]').waitFor()
    await shot('shortcuts')
    await page.keyboard.press('Escape')
    const video = page.video()
    await context.close()
    if (video) { await video.saveAs(`${out}/palette-ar-light.webm`); await video.delete() }
  }
  await browser.close()
})()
```

```bash
mkdir -p ../../.superpowers/tasmim-shared/cp3
node "$SCRATCH/cp3-shots.cjs" /Users/tariq/code/nasq/.worktrees/tasmim/.superpowers/tasmim-shared/cp3
cp e2e/storybook-visual.spec.ts-snapshots/shell-globalsearch--palette-*-dialog-darwin.png ../../.superpowers/tasmim-shared/cp3/
ls ../../.superpowers/tasmim-shared/cp3 | wc -l
kill "$NUXT_PID" "$MOCK_PID"; while kill -0 "$NUXT_PID" 2>/dev/null || kill -0 "$MOCK_PID" 2>/dev/null; do sleep 1; done
lsof -ti tcp:4097 | xargs kill 2>/dev/null; true
```

Expected: 16 app shots (ar/en × light/dark × goto/actions/search/shortcuts), `palette-ar-light.webm`, and the 20 Storybook dialog shots, 37 files in total. If the English `Search` textbox name differs, use its `en/common.json` `app.search` value; do not skip the search shot.

- [ ] **Step 5: Commit baselines (only if Step 1 re-baselined an approved family)**

```bash
cd /Users/tariq/code/nasq/.worktrees/tasmim
git status --short apps/web/e2e/storybook-visual.spec.ts-snapshots
# only if non-empty and listed in the CP3 note:
git add apps/web/e2e/storybook-visual.spec.ts-snapshots
git commit -m "test(web): re-baseline visual snapshots after the command palette

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Present CP3 to the owner**

The orchestrator sends the `cp3/` shots and the recording, the `NEW`/`FIXED` lists with their classification, and the per-spec count diff. The note asks the owner to confirm five decisions:

- (a) One keymap rule ("the Latin character, else the US key position") instead of `defineShortcuts`.
- (b) The `G` letters `h p t m c e d u r`, plus no letter for templates, calendar, series, documents, branding and subscription.
- (c) `C` falls back to the module's pinned create link. On a task page, for example, it opens «مشروع جديد» until Plan 4 templates mark their own create with `data-shortcut-create`.
- (d) The eight commands.
- (e) The shortcut help as a view of the palette rather than its own dialog.

Plan 4 does not start until the owner approves CP3.

---

## Spec coverage (phase 3)

| Spec | Task |
|---|---|
| §5 `GlobalSearch.vue` rebuilt on `UCommandPalette`, reusing `useAppSearch` | 5 (model in 4) |
| §5 three groups: Go to (manifest navigation), Search (manifest providers), Actions | 4, 5 |
| §5 `commands` in `app/modules/<app>/manifest.ts`, capability-gated; the shell names no app (R3) | 4 (+ Task 1 R3 scan) |
| §5 `⌘K` / `Ctrl K` | 3 (keymap), 5 (listener, tests) |
| §5 `/` list search | 3, 6 |
| §5 `C` create in current context | 3, 6 |
| §5 `G` then letter from manifests, conflict-free | 3, 4 (uniqueness test), 6 |
| §5 `J` / `K`, `Enter` | 7 (contract and demo; wiring in Plan 4) and 3 (task detail J/K on the rule) |
| §5 `Esc` back / close | unchanged behaviour; focus return pinned in 5 and 6 |
| §5 `?` help | 5 (palette view; no new overlay) |
| §5 inactive while typing; tooltips show the shortcut | 3 (predicates), 5 (trigger `⌘K`), 6 (`C` hint); `[` hint from Plan 2 |
| §5 / §13 Arabic layouts ("layoutIndependent, verified in phase 3") | Decision section; 3 (rule and tests), 6 (e2e) |
| §6 contracts: `useHydrated`, overlay exceptions, testids, headings | Global Constraints; 5, 6 (hydration e2e) |
| §9 stories, visual, a11y | 5, 7 (dialog-level axe), 9 |
| §10 CP3 live demo | 9 |
| §11 DESIGN.md, components.md, nuxt-ui-reference, catalog, locale files | 4 (locales), 8 |
| Plan 2 deferred (a) R3 `Lazy`/kebab/`modules/<app>`; (b) `[` on AZERTY/QWERTZ | 1; 3 |
| Owner amendment 3 (console badge) | 2 |

Not in this plan, on purpose: recent palette items (YAGNI); wiring `useRowNavigation` and `data-shortcut-create` into list and record pages (Plan 4 templates); the dark-mode primary button (Plan 4, owner amendment 4).

## Roadmap — next

**Plan 4 — Templates and states** (spec §6, phase 4, CP4). Plan 4 builds:

- the eight page templates (`ListPage`/`DataTable`, `RecordPage`, `FormSection`/`CreatePanel`, `DashboardPage`, `TimelineFrame`, `ConversationLayout`, `SettingsPage`, `StandalonePage`);
- the five states (`LoadingSkeleton`, `EmptyState`, `ErrorState`, `ForbiddenState`, `NotFoundState`), with `PageState` kept as a facade;
- the merges (`StatusBadge`, `FilterBar`/`FilterCard`, `InvoiceLines`, the tab helper), each with stories and axe at `error`.

Plan 4 also carries the following from this plan and CP2:

- `DataTable` calls `useRowNavigation` and marks its rows with `data-shortcut-row`.
- `ListPage` marks its search with `data-shortcut-search`, and its primary create with `data-shortcut-create`, so `C` creates the right record in each context.
- The dark-mode primary button is made more prominent (owner amendment 4).
- The known `shared-createpanel--form` smoke failure is fixed with the Form template.
