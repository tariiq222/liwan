# Phase 4 — New Application Template Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Tasks are dispatched to
> Sonnet/Haiku agents, each in its own worktree branched from the integration branch `codex/tools-new-app`.

**Goal:** a new application (`webvue_<app>`) is added by creating files inside its own folders plus three registration
edits, without touching any foundation file, and an agent can do it right the first time with the `webvue-new-app` skill.

**Architecture:** the web shell stops hardcoding the four applications: each application ships an `AppManifest`
in `apps/web/app/modules/<app>/manifest.ts`, discovered with `import.meta.glob`, and the registry, access policy,
navigation, search and bell read the manifests. The tools derive release-module lists, git areas and app tokens from
`tools/arch_layers.json` and the current catalog instead of literal lists. A scaffold script `tools/new_app.py`
generates the addon, contracts folder, web manifest, locale files and the three registration edits; the skill wraps it.

**Spec:** [roadmap Phase 4](2026-10-05-architecture-roadmap.md#المرحلة-4--قالب-التطبيق-الجديد) and the Phase 5
residual list in the same file ("باقٍ عمداً خارج هذا الشرط"). CLAUDE.md R1–R10 are binding.

## Global Constraints

- Allowed registration edits for a new app (and nothing else outside its own folders):
  1. `tools/arch_layers.json` — `ranks` entry (rank 4) and `web_apps` entry.
  2. `deploy/catalog/solutions/platform_v3.json` — one tier `{"id","name","modules":["webvue_<app>"],"features":["boolean:<app>.enabled"]}`.
  3. `packages/contracts/src/index.ts` — one `export * from './<app>'` line.
  Plus files rewritten mechanically by `python3 -B tools/catalog_check.py --sync-release-copies` (Task 2).
- App-owned folders: `odoo-addons/webvue_<app>/`, `packages/contracts/src/<app>/`, `apps/web/app/modules/<app>/`,
  `apps/web/app/pages/<app>/`, `apps/web/app/components/<app>/`, `apps/web/i18n/locales/{ar,en}/<app>.json`,
  `apps/web/stories/<app>/`.
- Behaviour of the four existing apps must not change: same nav items and order, same shortcuts, same route gates,
  same bell visibility, same search results. Existing unit tests stay green unchanged unless a test pins a removed
  internal; then the test is moved to assert the same behaviour through the manifest.
- Unknown application paths fail closed only when a manifest claims them; foundation paths keep today's rules.
- Never edit `tools/arch_baseline.json` by hand, never weaken `tools/arch_layers.json`, never add an
  `Architecture-approved-by:` trailer.
- Commits: `type(scope): imperative subject` ≤72 chars, scopes from `core platform api pmo hr chat meetings web cp
  deploy tools docs ci`; body ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Use two `-m` flags.
- Do not run anything against the `odoo19` database; Odoo checks use scratch DBs `webvue_scratch_*` only, from
  `/Users/tariq/code/odoo` (read-only checkout) with the worktree's explicit addons path. Never edit `~/.npmrc`.
- Worktrees install with `npm ci --ignore-scripts`; type-check with `cd apps/web && npm run lint`.

## Shared interface (Task 1 produces it; Tasks 5, 6, 7 consume it verbatim)

```ts
// apps/web/app/modules/types.ts
export interface AppNavItem {
  to: string; labelKey: string; icon: string; shortcut: string; capability: string
  /** Rail module this item opens; defaults to the manifest id. PMO uses 'home' for the dashboard. */
  module?: string
  /** Optional custom active test, replacing the branches in isNavPathActive. */
  isActive?: (path: string) => boolean
}
export interface AppContextLink { id: string; labelKey: string; icon: string; to: string; capability: string; pinned?: boolean }
export interface AppRailEntry { id: string; labelKey: string; icon: string; to: string; order: number }
export interface AppSearchProvider {
  id: string; labelKey: string; capability: string
  /** Vue-query key + fetcher run through useApi(); returns rows with id and label. */
  search: (api: <T>(url: string) => Promise<T>, q: string) => Promise<Array<{ id: number | string; label: string; to: string; caption?: string }>>
}
export interface AppBellKind { kind: string; href: (row: Record<string, unknown>) => string | null; titleKey?: string }
export interface AppManifest {
  id: string                         // 'pmo' | 'meetings' | 'hr' | 'chat' | '<app>'
  feature: string                    // '<app>.enabled'
  routePrefixes: string[]            // feature gate + active rail module
  rail: AppRailEntry[]               // usually one; PMO declares 'home' (order 10) and 'projects' (order 20)
  nav: AppNavItem[]
  contextLinks?: (path: string | undefined) => AppContextLink[]  // keyed by rail id via link module in nav
  routeCapabilities?: Array<{ pattern: RegExp; capability: string }>
  landing?: Array<{ path: string; capability: string }>          // firstAllowedPath order within the app
  capabilityAliases?: Record<string, string>                      // chat: { 'webvue.internal': 'chat.enabled' }
  bell?: { capabilities: string[]; kinds?: AppBellKind[] }
  search?: AppSearchProvider[]
}
// apps/web/app/modules/manifests.ts
export const appManifests: readonly AppManifest[]   // import.meta.glob('./*/manifest.ts', { eager: true }), sorted by min rail order
export function manifestForPath(path: string): AppManifest | null
```

Rail order today (must be preserved): home 10, projects 20, meetings 30, chat 40, hr 50; settings, management and
vendor remain foundation entries in `shellModules.ts` after the apps.

---

### Wave 1 (parallel)

### Task 1: App manifest infrastructure, registry and access policy  — `codex/web-app-manifest` (Sonnet)

**Files:** create `apps/web/app/modules/types.ts`, `modules/manifests.ts`, `modules/{pmo,meetings,hr,chat}/manifest.ts`,
`modules/__tests__/manifests.test.ts`; modify `modules/registry.ts`, `utils/accessPolicy.ts` and their tests.

- Move every app-specific literal from `registry.ts` (`KNOWN_FEATURE_KEYS` stays as the typed list but
  `MODULE_FEATURES` app entries, `featureForPath`, `CAPABILITY_FEATURES`, the `webvue.notifications` rule) and from
  `accessPolicy.ts` (`destinations`, `NOTIFICATION_ACCESS` capability list, `isNavPathActive` app branches,
  `requiredCapabilityForPath` app rules, the `/chat` and `/archived-tasks` return-to allowlist) into the four manifests.
- `featureForPath(path)` = `manifestForPath(path)?.feature ?? null`. `canUse(identity,'webvue.notifications')` = any
  manifest with `bell` whose feature is on. `hasCapability(...,'webvue.notifications')` = any manifest `bell.capabilities`
  present. `destinations` = manifests' `landing` in rail order followed by the foundation destinations, keeping today's
  exact order (`/projects/dashboard, /tasks, /projects, /project-templates, /reports, /meetings, ...`). Settings,
  vendor, subscription remain in the foundation files.
- Keep exported names and signatures (`MODULE_FEATURES` may become `Record<string, FeatureKey|null>` built from manifests
  plus foundation nulls). Manifests import nothing from app components (data only; icons are strings).
- Test: a table test that for every path/capability in the existing tests the result is unchanged; a test that a fake
  manifest registered through an exported `withManifests(list, fn)` test seam (or a `registerManifestForTest`) gates
  `/crm` by `crm.enabled` and adds its landing/nav. Run `npm test` (root) and `cd apps/web && npm run lint`.
- Commit(s): `refactor(web): read application routes from app manifests`.

### Task 2: Derive release lists, git areas and app tokens in tools — `codex/tools-release-derivation` (Sonnet)

**Files:** `tools/catalog_check.py`, `tools/git_policy.py`, `tools/arch_policy.py`, `tools/api_surface.py`,
`tools/webvue_cli/catalog_source.py`, `tools/webvue_cli/operator.py`, `tools/check_cp1_scratch.py`, `deploy/provision.sh`,
`deploy/woodpecker/image.yml`, `deploy/check_isolated.py`, `deploy/verification-checks.json`,
`deploy/control-plane-outage/outage-fixture`, `deploy/OPERATIONS.md`, `tools/shared_acceptance_live/up.sh`,
`apps/control-plane/src/shared/catalog-source.ts`, `packages/commercial-contracts/src/commercial/catalog.ts`, and tests
(`tools/test_catalog_check.py`, `tools/test_module_closure.py`, `deploy/test_operations.py`, `tools/test_git_policy.py`,
`tools/test_arch_policy.py`, packages tests).

- Every literal copy of the release module list either reads `catalog_check.py --release-modules` / imports
  `current_release()` (Python that runs from the repo), or is listed in `RELEASE_COPIES` and rewritten by a new
  `python3 -B tools/catalog_check.py --sync-release-copies` (files that run on a customer host). The guard keeps failing on
  drift. Add a test for the sync writer (idempotent, rewrites only the list).
- Replace the hand pins (`test_the_committed_release_is_the_ten_addon_install`, `test_module_closure.EXPECTED`,
  `deploy/test_operations.py` tuple) with invariants: release = base modules then tier closures in tier order; and a
  new `catalog_check` rule `release_app_missing`: every rank-4 addon in `arch_layers.json` is in exactly one tier of the
  current release and every tier module of rank 4 is registered. Keep a pin of the base three modules.
- `git_policy.AREAS` = fixed non-app areas + app areas derived from `arch_layers.json` rank-4 names without `webvue_`
  (today `pmo hr chat meetings`, so the set is unchanged). `arch_policy.STATIC_APP_TOKENS` shrinks to the tokens not
  derivable (`project`, `cyan_meeting_minutes`) if tests still pass. `arch_policy` R3 web check also covers
  `apps/web/app/modules/<app>/` (manifest folder = app id key in `web_apps`; a manifest may not import another app's
  folders). `api_surface.NAMESPACE_HINTS` falls back to `/api/v1/<app>` → `<app>` for any rank-4 app.
- `KNOWN_SOURCES` (Python and TS) glob `deploy/catalog/solutions/platform*.json` in name order, or keep the literal and
  add a parity test — pick the glob only if both runtimes can read the directory; otherwise parity test.
- `ENFORCEMENT` in `catalog.ts`: a `<app>.enabled` key without an explicit entry derives
  `webvue_api.requires_feature:<app>.enabled`; existing entries unchanged; test it.
- Gates: `python3 -B -m unittest discover -s tools -p 'test_*.py'`, `python3 -B tools/catalog_check.py`,
  `python3 -B tools/arch_policy.py --base main`, `python3 -B tools/git_policy.py --base main`, `python3 -B -m pytest
  deploy/test_operations.py` (or unittest), `npm test`, `npm -w apps/control-plane run build` if it exists.
- Commits per logical change, scope `tools`/`deploy`/`cp`.

### Task 3: Bring the reviewer and existing skills up to R1–R10 — `codex/docs-reviewer-rules` (Haiku)

**Files:** `.claude/agents/odoo-reviewer.md`, `.claude/skills/webvue-api-endpoint/SKILL.md`,
`.claude/skills/webvue-odoo-test/SKILL.md`.

- odoo-reviewer: scope = all `webvue_*` addons, bridges, contracts, web composables; add an "Architecture (R1–R10)"
  checklist mirroring CLAUDE.md lines verbatim in short form (R1 core generic, R2 app-owned groups, R3 bridges
  `webvue_<a>_<b>` auto_install and web folder isolation, R4 dependency direction and `arch_layers.json` registration,
  R5 no control-plane import, R6 no customer conditions, R7 sudo only in documented cases, R8 saas/non_saas, R9 public
  extension points, R10 feature registry with owner and per-route `requires_feature`/`requires_registered_feature`);
  remove `webvue_core.group_*` as an app group check; commit format `type(scope): subject`; run `arch_policy` and
  `git_policy --base main`.
- webvue-api-endpoint: the endpoint lives in the owning addon (not `webvue_api` unless shared plumbing); every route gets
  `@requires_feature('<app>.enabled', operation=...)` or `requires_registered_feature` for rank-3 services; sudo rule
  per R7; R8; Done-when adds `arch_policy`, `git_policy`.
- webvue-odoo-test: replace hardcoded module lists with `$(python3 -B tools/catalog_check.py --release-modules)` and
  derived test tags, as `.woodpecker.yml` does.
- Commit: `docs(docs): align reviewer and skills with R1-R10`.

### Task 4: Locale files are discovered, not listed — `codex/web-locale-glob` (Haiku)

**Files:** `apps/web/nuxt.config.ts` (i18n `files` arrays) and a unit test under `apps/web/tests` or `tools`.

- Build each locale's `files` with `readdirSync('i18n/locales/<code>')` filtered to `*.json`, sorted, `common.json`
  first, so the result equals today's 14 entries. Fail the config load if `ar` and `en` file sets differ.
- Verify `.storybook/main.ts` still reads them; run `npm test`, `cd apps/web && npm run lint`, and
  `cd apps/web && npx nuxi prepare` or the build used by tests.
- Commit: `build(web): discover locale namespaces from the locale folders`.

### Wave 2 (after Task 1 merges into the integration branch; Task 7 also after Task 2)

### Task 5: Navigation reads the manifests — `codex/web-nav-manifest` (Sonnet)

**Files:** `apps/web/app/composables/nav/shellModules.ts`, `nav/activeRoute.ts`, `composables/useShellNavigation.ts`,
`components/shell/ContextSidebar.vue`, their tests, and the four manifests (add `nav`, `rail`, `contextLinks`).

- `items`, `shellModules`, `linksByModule` app entries and `activeShellModule` prefixes come from manifests; settings,
  management, vendor, subscription stay literal in the foundation file. `NavGroup`/`ShellModule` become `string`.
- `hrCreateLinkForPath` and `projectsContextLinks` move into the hr/pmo manifest `contextLinks`; `isContextPathActive`
  app branches become `isActive` on items. ContextSidebar's chat panel: manifest may declare `sidebarPanel` as a
  component name string resolved by the existing component; keep chat behaviour identical.
- Add a dev-time test: shortcuts unique across manifests and foundation items.
- Gates: `npm test`, `cd apps/web && npm run lint`, existing nav tests unchanged in intent.

### Task 6: Search and bell are provider registries — `codex/web-search-bell` (Sonnet)

**Files:** `apps/web/app/components/GlobalSearch.vue`, `pages/search.vue`, `components/notifications/NotificationCenter.vue`,
`components/shell/ShellHeader.vue` if needed, pmo/meetings manifests (`search`, `bell.kinds`), tests.

- GlobalSearch and search.vue render one section per visible provider (`can(provider.capability)`), keeping the PMO
  projects and tasks sections identical in markup, order, query keys and API URLs. `search.vue` return-to allowlist
  takes manifest route prefixes.
- NotificationCenter `notificationHref`/title use `bell.kinds` from manifests, with the existing generic fallback for
  unknown kinds unchanged.
- Gates: `npm test`, lint; mock e2e specs touching search/bell if runnable (`docs/` memory: compare failing sets with main).

### Task 7: Scaffold `tools/new_app.py` — `codex/tools-new-app-scaffold` (Sonnet)

**Files:** `tools/new_app.py`, `tools/new_app_templates/**`, `tools/test_new_app.py`.

- `python3 -B tools/new_app.py <app> --name-ar <ar> --name-en <en> [--dry-run]` creates, refusing if any exists:
  - `odoo-addons/webvue_<app>/` copied from webvue_hr's smallest shape: `__init__.py`, `__manifest__.py` (LGPL-3,
    19.0.1.0.0, author Tariq Alwalidi, depends `webvue_api`), `models/feature_registry.py` (`<app>.enabled`, owner,
    module), `models/access_service.py` (`<app>.records.read`, `<app>.records.manage`, role grants),
    `security/<app>_capability_groups.xml`, `data/<app>_access_permissions.xml` (+ role `role_<app>_manager`),
    `security/ir.model.access.csv`, a minimal `webvue.<app>.record` model with company rule, `controllers/` with one
    `GET /api/v1/<app>/records` route (`json2`, `auth='user'`, `api_handler`, `requires_feature`), a serializer, and
    `tests/` (`common.py` extending `WebVueApiCase`, access-composition test, route test, feature-closed test).
  - `packages/contracts/src/<app>/index.ts` with a zod schema; `apps/web/app/modules/<app>/manifest.ts`;
    `apps/web/app/pages/<app>/index.vue` (list page using the shared page components per DESIGN.md);
    `apps/web/i18n/locales/{ar,en}/<app>.json`.
  - The three registration edits (JSON edits preserve formatting; index.ts line appended in order), then runs
    `catalog_check.py --sync-release-copies`.
- Every Python file starts with the Odoo header line. Templates use `{{app}}`, `{{App}}`, `{{name_ar}}`, `{{name_en}}`.
- Test: run into a temp copy of the needed repo subset (or `--root` pointing to a temp dir seeded with the registration
  files) and assert files, idempotent refusal, JSON validity, and that `arch_policy`'s addon scan accepts the output.
- Commit: `feat(tools): scaffold a new application with new_app.py`.

### Wave 3

### Task 8: `webvue-new-app` skill and docs — `codex/docs-new-app-skill` (Sonnet)

**Files:** `.claude/skills/webvue-new-app/SKILL.md`, `CLAUDE.md` (check command uses `--release-modules`; one line in the
Odoo addon rules pointing to the skill; frontend rules: "a new application adds its own manifest" replacing the
"(Phase 4)" note), `docs/parallel-work.md` if it lists apps, roadmap row 3 → merged `c7115a77`, row 4 → this plan.

- Skill frontmatter: `name: webvue-new-app`, one-line `description` ending with "Use when …". Steps: choose id; run the
  scaffold; fill model/serializer/contract; capabilities and roles; manifest nav/rail/landing; locale labels; tests;
  gates (`npm test`, lint, `arch_policy --base main`, `git_policy --base main`, `catalog_check`, scratch Odoo install
  with `--release-modules`); review with `odoo-reviewer`; the allowed-files rule. ≤120 lines.

### Task 9: Proof on a throwaway branch — `spike/new-app-proof` (Sonnet), never merged

- From the integration branch after Tasks 1–8: run the skill end to end for `sample` («تجريبي» / Sample).
- Evidence: `git diff --stat codex/tools-new-app` lists only app-owned paths, the three registration files and
  sync-written copies; `npm test`, lint, `arch_policy --base codex/tools-new-app`, `catalog_check`, scratch Odoo install
  + tests for the release modules incl. `webvue_sample` all pass; mock UI shows the Sample rail entry gated by
  `sample.enabled` (screenshot optional).
- Write `docs/reports/2026-10-08-new-app-template-proof.md` on the integration branch (separate commit, scope docs)
  with the commands and results. Tag the spike `archive/new-app-proof` is NOT needed; the branch is deleted after.

## Review Focus

1. A path under an app prefix must stay gated when that app's feature is closed (no fail-open after the refactor).
2. Nav order, shortcuts and the rail destination fallback for users who lack the module's first destination.
3. Bell visibility for a tenant with only meetings, only PMO, or neither.
4. `--sync-release-copies` must not reorder or touch anything but the module list.
5. `git_policy` areas and `arch_policy` tokens unchanged for today's tree (no baseline growth).
