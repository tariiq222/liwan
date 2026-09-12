> **سجل تاريخي — ليس تعليمات تنفيذ.** المرجع المعتمد الآن: [DESIGN.md](../../../../../DESIGN.md). النتائج والمسارات الواردة أدناه تخص وقت تسجيلها.

# Nasq Internal Pages Implementation Plan

> تاريخي. السياسة: [DESIGN.md](../../../../../DESIGN.md). ليس تعليمات واجهة.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert every mounted Nasq business overlay into an addressable internal page while preserving authorization, mutations, filters, and Arabic/RTL behavior.

**Architecture:** Existing composables remain the data and mutation layer. Route pages compose extracted form/body components, parent routes flatten child rendering through `<NuxtPage />`, and a shared safe-return helper preserves only validated owner-local paths. A source architecture test prevents future business overlay use.

**Tech Stack:** Nuxt 4 file routing, Vue 3 Composition API, TanStack Vue Query, vue-i18n, Vitest, Playwright.

**Spec:** `docs/archive/ui/superpowers/specs/2026-09-05-nasq-internal-pages.md`

**Delivery record:** [Completed local delivery](#delivery-record)

## Global Constraints

- Frontend-only: do not change Odoo, API, database, or contract schemas.
- Do not edit `AGENTS.md` or `CLAUDE.md`; root owns their lasting policy changes.
- Do not commit, merge, push, deploy, remove worktrees/branches, or discard unrelated changes.
- Preserve every existing authorization, archive/regrant, self/vendor, fixed-login-warning, explicit-save, secret-GC, attachment, hydration, Arabic/RTL, cache, and filter assertion.
- Parent pages render only `<NuxtPage />` on child routes.
- Business pages/layouts/non-UI components may not import or mount `Dialog`, `AlertDialog`, `Sheet`, `Drawer`, or `CommandDialog`, or call native `alert`/`confirm`/`prompt`.
- Workers run focused tests only. The lead runs the final typecheck, unit, E2E, and build gates once.

---

### Task 1: Freeze route-return and architecture contracts

**Files:**
- Create: `apps/web/app/utils/safeReturnTo.ts`
- Create: `apps/web/app/utils/__tests__/safeReturnTo.test.ts`
- Create: `apps/web/app/utils/__tests__/businessOverlays.test.ts`

**Interfaces:**
- Produces: `safeReturnTo(value: unknown, fallback: string, allowedPrefixes: readonly string[]): string`.
- Produces: `returnToQuery(fullPath: string): { returnTo: string }`.
- The accepted value must begin with one `/`, contain no scheme, backslash, or control byte, and match an allowed prefix at a route boundary before an optional query/hash.

- [x] Write the safe-return unit matrix: valid owner path/query, fallback for `//evil`, `https:`, backslash, control bytes, unrelated pillars, non-string input, and prefix confusion such as `/hr-malicious`.
- [x] Implement `safeReturnTo` and `returnToQuery` with no browser globals so SSR and unit tests share the same behavior.
- [x] Add an architecture test that scans `app/pages`, `app/layouts`, and business components while excluding generated UI primitives and explicitly scanning the active sidebar composite; fail on forbidden imports/tags and native alert/confirm/prompt calls.
- [x] Run `npm -w apps/web test -- --run app/utils/__tests__/safeReturnTo.test.ts app/utils/__tests__/businessOverlays.test.ts`: 17 tests passed after the expected implementation-stage architecture failure was cleared.

### Task 2: Convert HR and document workflows

**Files:**
- Modify: `apps/web/app/pages/hr.vue`
- Create/modify: `apps/web/app/pages/hr/**`
- Create/modify/delete: `apps/web/app/components/hr/**`
- Modify: `apps/web/i18n/locales/ar/hr.json`
- Modify: `apps/web/i18n/locales/en/hr.json`
- Modify: `apps/web/e2e/hr-directory.spec.ts`
- Modify: `apps/web/e2e/hr-documents.spec.ts`
- Modify: `apps/web/e2e/hr-people-access.spec.ts`
- Focused unit tests may be added only under `apps/web/app/composables/__tests__/hr*.test.ts` or `apps/web/app/utils/__tests__/hr*.test.ts`.

**Interfaces:**
- Consumes: `safeReturnTo` and `returnToQuery` from Task 1.
- Produces: every `/hr` route in the spec, with `hr.vue` acting as an exact-root parent and all forms/bodies free of business overlays.

- [x] Make `/hr` row, create, manage, department, and document actions route to the exact spec URLs while carrying the current `route.fullPath` as `returnTo`.
- [x] Extract employee create/general/access/password/card bodies from dialog shells and compose them in routed pages. Keep general and access as separate URLs; render archive/restore and revoke confirmations inline.
- [x] Replace the department sheet/dialog flow with department list/create/detail/edit pages. Keep safe deletion counts and API error messages visible beside the inline confirmation.
- [x] Replace document sheet/dialog state with list/create/read/edit pages. Keep attachment reads/uploads, Tiptap editor lifecycle, explicit saves, and role-based reader/editor behavior.
- [x] Render translated loading, invalid-id, not-found/forbidden, and mutation-error states on direct loads.
- [x] Update the three HR E2E files to use routed pages and retain all business assertions; add reload, browser-back/filter, deep-link, and no-dialog/sheet assertions.
- [x] The lead ran the three HR Playwright specs during focused integration and again in the complete 53-test suite; all passed. The worker did not claim a separate browser run.

### Task 3: Convert PMO and task workflows

**Files:**
- Modify: `apps/web/app/pages/projects/index.vue`
- Modify: `apps/web/app/pages/projects/[id].vue`
- Modify: `apps/web/app/pages/tasks.vue`
- Create/modify: `apps/web/app/pages/projects/**` except the unchanged task-detail page unless inline archive navigation requires it.
- Create: `apps/web/app/pages/tasks/new.vue`
- Create/modify/delete: `apps/web/app/components/project/**`
- Create/modify/delete: `apps/web/app/components/task/CreateTaskDialog.vue`, `TaskDetailPanel.vue`, and any replacement form component.
- Modify: `apps/web/i18n/locales/ar/projects.json`, `en/projects.json`, `ar/tasks.json`, `en/tasks.json`.
- Modify: `apps/web/e2e/project-admin.spec.ts`, `detail.spec.ts`, `tasks.spec.ts`, and `hydration.spec.ts` where their routed assertions require it.

**Interfaces:**
- Consumes: `safeReturnTo` and `returnToQuery` from Task 1.
- Produces: every `/projects` and `/tasks` route in the spec; project settings composes general/stages/followers on one page.

- [x] Route project and task create buttons to `/projects/new`, `/tasks/new`, or `/projects/:id/tasks/new`, preserving the owning list/project full path.
- [x] Replace project settings dialog with `/projects/:id/settings` and keep general, stage lifecycle, follower search/actions, pointer drag, and accessible keyboard stage ordering on the page.
- [x] Route milestone create/edit and project update creation to their spec URLs. Put milestone deletion and project archive confirmation inline on the relevant page; preserve count guards and status updates.
- [x] Replace task archive dialog inside active `TaskDetailPanel` with an inline consequence/cancel/confirm region without changing the detail body, keyboard navigation, or sibling behavior.
- [x] Ensure `tasks.vue` and `projects/[id].vue` mount only `<NuxtPage />` for every child route, including static `new` and nested administration routes.
- [x] Render translated loading, invalid-id, missing/forbidden, and mutation-error states on direct loads.
- [x] Update focused PMO/task E2E coverage for routed navigation, reload, browser back/filter restoration, and no business dialogs/sheets.
- [x] The lead ran the affected PMO/task specs during focused integration, stress-ran keyboard stage ordering three times, and reran them in the complete 53-test suite; all deterministic checks passed. The worker did not claim a separate browser run.

### Task 4: Convert shared search and mobile navigation

**Files:**
- Modify/delete: `apps/web/app/components/CommandMenu.vue`
- Modify: `apps/web/app/layouts/default.vue`
- Modify: `apps/web/app/components/AppSidebar.vue`
- Modify: `apps/web/app/components/ui/sidebar/Sidebar.vue`
- Create: `apps/web/app/pages/search.vue`
- Reuse unchanged: `apps/web/app/composables/useNav.ts`
- Verify unchanged: `apps/web/app/composables/__tests__/useNav.test.ts`
- Modify: `apps/web/i18n/locales/ar/common.json`
- Modify: `apps/web/i18n/locales/en/common.json`
- Modify: `apps/web/e2e/command-menu.spec.ts`
- Create: `apps/web/e2e/internal-pages.spec.ts`

**Interfaces:**
- Consumes: route table and architecture rule from the spec.
- Produces: a full `/search` page and mobile sidebar markup with no portal, backdrop, focus trap, or sheet dependency.

- [x] Replace global command open state with keyboard/button navigation to `/search`; focus the search field after route navigation and keep single-key result shortcuts when the field is empty.
- [x] Render navigation and project results as full-page command/list content with direct links and role-aware visibility.
- [x] Replace the mobile `Sheet` branch in `ui/sidebar/Sidebar.vue` with inline collapsible navigation controlled by the existing sidebar state.
- [x] Update common translations and verify the unchanged role-aware `useNav` behavior in the complete unit suite.
- [x] Add E2E proof for keyboard search routing, direct/reloaded search, mobile inline navigation, and absence of overlay layers.

### Task 5: Integrate, review, verify, and refresh preview

**Files:**
- Reconcile all files from Tasks 1-4 without touching backend or root-owned instruction files.
- Update: `docs/archive/ui/superpowers/plans/2026-09-05-nasq-internal-pages.md` only if an implementation ruling changes the route contract.

**Interfaces:**
- Consumes: all task outputs.
- Produces: one coherent route tree and fresh local verification evidence.

- [x] Inspect the full diff, route manifest/build output, forbidden-overlay inventory, and all deleted/replacement component imports.
- [x] Run the final root commands `npm run lint` and `npm test`; these include the architecture/safe-return tests, web typecheck, Ruff, contracts, and web unit suites.
- [x] Stop the task dev server before build. Run the complete Playwright suite at `http://localhost:3800` with `NUXT_PUBLIC_WS_URL=ws://localhost:9169/websocket` against the isolated `9169` runtime/database.
- [x] Run `npm run build` and record exit status. No Odoo tests are claimed because no backend code changed.
- [x] Replace only the local review preview on port `3200` with the successful build and verify authenticated `/hr`, `/search`, a PMO route, direct reload, and mobile navigation.
- [x] Report changed surfaces, exact test counts, actual branch/worktree/runtime, deliberately retained control popovers/generated primitives, and residual limitations without implying merge, push, deployment, or production proof.

## Delivery Record

Completed locally on 2026-09-05 in `/Users/tariq/code/nasq-phase-3b`, branch `codex/phase-3b`, with `HEAD` still at `91c0ee2`. The implementation remains an uncommitted working-tree delivery. No commit, merge, push, deployment, backend/API/schema change, or Odoo test run was performed.

Fresh final verification:

- `npm run lint`: passed (`vue-tsc --build --noEmit` and Ruff).
- `npm test`: 223 tests passed — 52 contracts and 171 web unit tests.
- `npm -w apps/web run test:e2e`: 53/53 Playwright tests passed against the isolated database.
- `npm run build`: passed and produced the Nitro node-server output.
- Built-preview smoke: 4/4 passed for full-page search/reload, HR and Projects reload, inline mobile navigation, and keyboard project-stage reorder with persisted reload state.
- Final source audit: zero business overlay/native-popup hits, zero references to removed business shells, zero backend/contract/deployment changes, and clean `git diff --check`.

At delivery time, the built preview listened on `127.0.0.1:3200` and Odoo listened on `127.0.0.1:9169` using `nasq_phase3b_e2e_final4_20260905_1653`. Evidence is retained under `/Users/tariq/code/nasq-internal-pages-run-20260905/`: `lint.log`, `unit.log`, `full-e2e.log`, `stage-reorder-repeat.log`, `build.log`, `preview-smoke.log`, and `final-audit.log`.

The stage-order handle still supports pointer dragging. Its headless SortableJS pointer simulation was intermittent after the settings surface moved from a modal into a taller page, so this delivery does not claim automated verification of that specific pointer gesture. The accessible Arrow Up, Arrow Down, Home, and End path uses the same reorder mutation and passed pure boundary tests, three consecutive focused runs, the full suite, reload-persistence coverage, and built-preview smoke.

## Follow-up verification — 2026-09-05

The user's requested re-verification found and fixed two direct-route defects: document creation now resolves and requires an existing department before showing its form; milestone editing now shows the missing/forbidden state before generic request errors when its project or milestone is unavailable. Added E2E regression coverage for malformed/missing departments and a missing milestone parent project, including reload.

Fresh verification after those fixes:

- Production build: passed; retained `reverify-build.log`.
- Complete Playwright suite against the rebuilt preview at `http://localhost:3200`: **54/54 passed in 1.8 minutes**, exit 0; retained `reverify-final-built-e2e.log`.
- Focused architecture/safe-return tests: 17/17 passed; web lint/typecheck passed during the route review.
- Actual in-app browser: malformed department document URL and missing-project milestone edit both display the intended not-found message without a writable form. HR directory loaded after authenticated login.
- Actual pointer drag on disposable project 3 changed stage order, persisted after reload, and the original order was restored and verified after another reload. This single observed gesture does not remove the earlier headless pointer-simulation limitation.
- `git diff --check`: passed. Canonical Nasq and stock Odoo working trees remain clean.

The first built-suite attempt retained in `reverify-built-e2e.log` exposed test timing and hostname issues. Hydration checks now explicitly hold scripts while asserting server-rendered disabled controls. The pending-description test waits for actual pathname navigation and the save response before hard reload. Realtime checks must use localhost consistently with the compiled WebSocket host; using 127.0.0.1 for the app omitted the authenticated cookie from the localhost socket. The corrected final run retained all functional assertions. See `reverify-realtime-diagnosis.md` in the evidence directory.

The rebuilt local preview runs on port 3200 against the same isolated Odoo/database. This remains uncommitted local work; no merge, push, deployment, or stock Odoo modification is claimed.
