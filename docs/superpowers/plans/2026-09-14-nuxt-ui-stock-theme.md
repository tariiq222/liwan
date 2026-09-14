# Nuxt UI Stock Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Revert today's Stripe/ClickUp refresh and make every control render with Nuxt UI v4's stock recipes (Figma "Nuxt UI v4 (Community)"), keeping the shell layout, the brand primary from settings, the Arabic font and the three modes.

**Architecture:** One revert commit, then delete the component recipe layer (`app.config.ts` slots, `nasq-ui-*` classes, geometry/elevation tokens) and replace its ~107 usages with Nuxt UI primitives and stock utilities. Shell geometry (`shell.css`) and brand derivation (`brandTheme.ts`) stay.

**Tech Stack:** Nuxt 4, Nuxt UI 4.11, Tailwind v4, Storybook 10, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-14-nuxt-ui-stock-theme-design.md`

## Global Constraints

- Worktree `codex/nuxt-ui-stock` from current `main` (3733273); no commits to `main`, no push, until the user says so.
- Arabic default, RTL-first, logical Tailwind classes only; `t()` for every string; no new locale keys.
- Keep routes, query filters, permissions, draft protection, Escape/back rule, `data-testid`s.
- Storybook stays the mandatory component catalog; `STORYBOOK_COMPONENTS` list unchanged except removals that follow deletions.
- Gates per task: `npx -w apps/web vitest run`, `npx -w apps/web vue-tsc --noEmit`, `python3 -B tools/ui_policy.py`; final: `npm test`, Storybook build + smoke, mock-stack screenshots.

---

### Task 1: Revert the refresh, keep the Storybook rule

**Files:** all files touched by 80df4a7..3733273; then re-apply Storybook-rule wording in `DESIGN.md`, `CLAUDE.md`, `AGENTS.md`, `.claude/agents/frontend-theme.md`, `docs/design-system/components.md`, `docs/design-system/nuxt-ui-reference.md`, `tools/ui_policy.py`.

- [ ] `git revert --no-commit 80df4a7^..3733273` → `git commit -m "revert: undo the Stripe/ClickUp refresh"`.
- [ ] Re-apply only the Storybook-rule sentences (copy from `git show 821df3b`, drop Stripe geometry lines). `python3 -B tools/ui_policy.py` PASS. Commit `docs: keep Storybook as the mandatory component source`.
- [ ] `npx -w apps/web vitest run` → all pass (this is the pre-refresh tree + docs).

### Task 2: Theme layer reset (tests first)

**Files:** `apps/web/app/app.config.ts`, `apps/web/app/assets/css/tokens.css`, `apps/web/app/assets/css/components.css`, `apps/web/app/assets/css/shell.css`; test `apps/web/app/assets/__tests__/stockTheme.test.ts` (new).

- [ ] Failing test:
```ts
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
const read = (p: string) => readFileSync(resolve(import.meta.dirname, p), 'utf8')
const config = read('../../app.config.ts'); const tokens = read('../css/tokens.css'); const comps = read('../css/components.css')
describe('stock Nuxt UI theme', () => {
  it('app.config only sets colors and overlay layers', () => {
    expect(config).toContain("colors: { primary: 'brand', neutral: 'slate' }")
    for (const key of ['button:', 'input:', 'card:', 'table:', 'badge:', 'textarea:', 'calendar:', 'progress:']) expect(config).not.toContain(key)
    expect(config).not.toMatch(/rounded-|min-h-|nasq-ui-/)
  })
  it('tokens keep brand derivation and drop custom geometry', () => {
    expect(tokens).toContain('--color-brand-500')
    for (const t of ['--nasq-radius', '--ui-radius', '--elevation-1', '--content-shadow']) expect(tokens).not.toContain(t)
  })
  it('no component recipes remain in components.css', () => {
    expect(comps).not.toMatch(/\.nasq-ui-|\.nasq-elevation-/)
  })
})
```
- [ ] Implement per spec Step 2 (app.config, tokens, components.css, shell.css). Keep `.nasq-status-*`, shell rules, icon size, focus outline for links/editors, scrollbar/selection.
- [ ] Run the test + `vue-tsc`; commit `feat(theme): stock Nuxt UI recipes; brand primary only`.

### Task 3: Replace `nasq-ui-*` usages

**Files:** every `.vue`/`.ts` under `apps/web/app` and `apps/web/stories` matching `nasq-ui-|nasq-elevation-|data-nasq-reference-detail|--nasq-ui-progress` (list with `rg -l`).

- [ ] Failing test `apps/web/app/components/shared/__tests__/noCustomRecipes.test.ts`: walk `app/` and `stories/`, assert no file contains `nasq-ui-` or `nasq-elevation-` (allow `nasq-ui-z-` tokens).
- [ ] Apply the mapping table from the spec, file by file. Routed tab strips (`ProjectFrame`, settings) → `UTabs variant="link"` items with `to`; segments → `UButtonGroup`; record surfaces → `UCard`; progress → `UProgress :model-value`.
- [ ] Update design tests that asserted the old classes (`taskListDesign`, `governanceDesign`, `registerDesign`, `templateDesign`, `financeListDesign`, `notificationPageDesign`, `composition`, `taskChromeDesign`, `pmoRepairContracts`) to assert the replacements.
- [ ] Run vitest + `vue-tsc` + `ui_policy`; commit `refactor(web): replace custom recipes with Nuxt UI primitives`.

### Task 4: Docs, stories, catalog

**Files:** `DESIGN.md` (§1, §2, §6), `docs/design-system/components.md`, `docs/design-system/nuxt-ui-reference.md`, `apps/web/stories/foundations/Shape.stories.ts`, `apps/web/stories/nuxt-ui/*.stories.ts` descriptions.
- [ ] Rewrite per spec Step 3; `python3 -B tools/ui_policy.py` PASS; commit `docs: the customer UI is stock Nuxt UI v4`.

### Task 5: Verification

- [ ] `npm test`, `npx -w apps/web vue-tsc --noEmit -p .storybook/tsconfig.json`, `npx -w apps/web storybook build -o storybook-static` + `npx playwright test e2e/storybook-smoke.spec.ts`.
- [ ] Mock stack: `/projects`, `/tasks`, `/tasks/101`, `/projects/1`, `/settings/users` at 1440/390, light/cream/dark; review PNGs.
- [ ] Report changed files, command evidence, residual risk. No merge/push without instruction.
