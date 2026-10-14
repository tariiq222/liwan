# Nasq "Tasmim" — unified redesign of the customer UI

- Date: 2026-10-11
- Owner: Tariq Alwalidi
- Branch / worktree: `codex/web-tasmim` at `.worktrees/tasmim` (from local `main` 163834dd)
- Scope: `apps/web` only. Odoo, contracts and APIs are unchanged.
- Status: approved. CP1 (foundations) approved by the owner on 2026-10-11, including the values in §3–§4 and the dark rail `#0d1a38`.
- Server default primary: changed to midnight on a separate branch `codex/core-default-primary` (owner option A, 2026-10-11).

## 1. Goal

Give Nasq its own visual identity and make every customer page behave the same way.
Today the UI is stock Nuxt UI v4 with light tuning, and pages build their own tables,
filters, cards, headers and states, so similar screens look and act differently.

Success means:

1. One identity (midnight blue + lime) applied in light and dark.
2. Every one of the 142 pages is composed from one of eight shared page templates and
   five shared states; no page hand-builds a header, table scaffold, filter row or state.
3. A dense, fast, keyboard-first feel in the spirit of Linear and Attio, readable in Arabic.
4. All product contracts in `CLAUDE.md` still hold (routes, filters in the URL,
   `?view=board`, route-backed `SharedCreatePanel`, inline destructive confirmation,
   no stacked business dialogs, the three overlay exceptions, `useHydrated()`).
5. Checks pass: `npm test`, `npm -w apps/web run lint`, `python3 -B tools/ui_policy.py`,
   Playwright mock suite with no new failures against the `main` baseline, visual
   snapshots approved, a11y checks clean.

Non-goals: Odoo QWeb/PDF reports (`cyan_meeting_minutes`, `nasq_meetings` report
templates) and the Odoo vendor theme `web_theme_shadcn` — both deferred. No new product
features, no API or contract changes, no route changes.

## 2. Decisions taken with the owner

| Topic | Decision |
|---|---|
| Ambition | New identity **and** full unification |
| Personality | Modern, fast, dense (Linear / Attio) |
| Customer colour | Kept: tenant `primary_color` still replaces the default primary |
| Nasq brand | Midnight blue (default primary) + lime (fixed Nasq accent) |
| Appearances | Light and dark only; cream removed |
| Navigation | Keep the three layers (header, module rail, context sidebar), restyled |
| Module rail | Always Nasq midnight in both modes, independent of the tenant colour |
| Delivery | Everything on `codex/web-tasmim`, one final `--no-ff` merge to `main` |
| Vendor (`/vendor/*`) and subscription pages | Same identity and templates; vendor header shows a console badge |
| Logo | Temporary text wordmark «نَسَق» with a lime dot until a real SVG exists |
| Odoo PDF reports | Out of scope for this branch |

## 3. Identity and colour

Exact values are fixed at checkpoint 1 from rendered swatches; starting points:

| Role | Light | Dark | Rule |
|---|---|---|---|
| Primary (midnight) | ~`#13234A` | lighter midnight step for text/fills | Default `--primary`; replaced by tenant `primary_color` |
| Accent (lime) | ~`#C8F031` | same | Fixed Nasq accent. Fill with dark text, dot or bar only — never text on light surfaces |
| Neutral | `slate` | surfaces derived from midnight, background ~`#0A1124`, raised steps above | Never tinted by tenant colour |
| Rail | midnight | midnight | Fixed; active item = translucent white layer + lime bar on the inline-start edge |
| Status | success / warning / error / info | dark-adjusted | Fixed semantic colours |

Lime is used only for: active rail indicator, unread dot, 100% progress, logo, and the
first action of empty/welcome states.

Contrast: text ≥ 4.5:1, fills and focus ≥ 3:1 (WCAG 2 AA is the gate; APCA is advisory),
verified automatically for both modes and for random tenant primaries.

`utils/brandTheme.ts` keeps deriving the `--primary*` family from the tenant colour and
stops feeding the rail. `/settings/branding` preview (`BrandingPreview.vue`) shows the
fixed midnight rail. The branding API contract is unchanged.

## 4. Typography, density and shape

- Fonts: IBM Plex Sans Arabic for both Arabic and Latin (the family ships matching Latin glyphs; owner-approved 2026-10-11 at CP1, no second family loaded); `tabular-nums` for
  tables, metrics and dates.
- Scale (default size): 12 helper/labels, 14 body (Arabic base; 13 for `en`), 16 section
  title, 20 page title, 24 large metric. Hierarchy through weight 500/600, not size.
- The three user font sizes stay (accessibility) and scale the whole ramp by one factor.
- Density: table row 36px, controls and menu items 32px, mobile icon buttons 44px.
- Spacing: 4px grid (4/8/12/16/24); card and section padding 12–16px.
- Radius: 6px controls, 8px cards/panels (replaces today's `rounded-lg/xl/2xl/full` recipes).
- Hairline borders separate; shadows only on floating layers (menus, palette, popovers).
- Motion 100–150ms, disabled under reduced motion.

## 5. Shell, command palette and shortcuts

| Part | Today | New |
|---|---|---|
| Header | 64px | 48px neutral: breadcrumb, `⌘K` trigger, bell, account menu; vendor console badge on `/vendor/*` |
| Module rail | 76px | 64px fixed midnight, icon + small label, lime active bar |
| Context sidebar | 236px | 232px, sections with small counters, collapsible with `[`, state persisted |
| Content | max 1780px | full width for tables/boards/dashboards; comfortable max width for forms and reading |

Mobile breakpoint stays 768px; rail and sidebar become a drawer; tables scroll inside
their region. `UDashboardGroup/Sidebar/Panel/Navbar` are prototyped against a custom
shell in phase 2 and adopted only if they keep RTL behaviour and the three-layer layout.

Command palette (`⌘K`): `GlobalSearch.vue` is rebuilt on `UCommandPalette` (reusing
`useAppSearch`) with three groups — Go to (manifest navigation), Search (manifest search
providers), Actions. Actions come from a new optional `commands` field in
`apps/web/app/modules/<app>/manifest.ts`; each command carries its capability and is
hidden without it. The shell names no application (R3).

Shortcuts go through one shared key-matching layer (`composables/shortcuts/keymap.ts`) that uses the Latin character when the layout produces one and otherwise the US key position, so they work on Arabic, AZERTY and QWERTZ keyboards. Nuxt UI 4.11.1 `defineShortcuts` was rejected in phase 3 (it cannot match `/`, `?` or `[` by key position, ignores IME composition and misses `<select>`/open menus — evidence in Plan 3):

| Keys | Action |
|---|---|
| `⌘K` / `Ctrl K` | Command palette |
| `/` | Focus list search |
| `C` | Create in current context |
| `G` then letter | Go to (`G P` projects, `G T` tasks, …, from manifests) |
| `J` / `K`, `Enter` | Move between rows, open |
| `Esc` | Back / close |
| `?` | Shortcut help |

Shortcuts are inactive while typing in a field; tooltips show the shortcut.

## 6. Page templates and states

Shared components live in `apps/web/app/components/shared/`, each with a Storybook story
and an entry in `STORYBOOK_COMPONENTS` (`tools/ui_policy.py`) and
`docs/design-system/components.md`.

| # | Template | Component(s) | Pages |
|---|---|---|---|
| 1 | List | `ListPage`, `DataTable` (FilterBar + UTable + Pagination + mobile rows + bulk bar), list/board switch | projects, tasks, employees, departments, documents, meetings, series, templates, roles, users, access log, invoices, vendor lists |
| 2 | Record | `RecordPage`, `PropertiesPanel`, `PropertyRow`, `RecordSection` | project, task, employee, department, meeting, series, role, user, vendor customer/tenant/plan/bundle/invoice |
| 3 | Form | existing `CreatePanel` (route-backed `/new`), `FormSection`, `UnsavedChanges`; edit pages use the same sections | every `new` and `edit` route |
| 4 | Dashboard | `DashboardPage` (MetricTile grid + `ChartPanel`) | home, `/projects/dashboard`, finance, vendor overview, reports |
| 5 | Timeline | `TimelineFrame` (shared header/toolbar around calendar or Gantt) | `meetings/calendar`, `projects/[id]/schedule` |
| 6 | Conversation | `ConversationLayout` | `/chat/*`, task timeline/comments |
| 7 | Settings | `SettingsPage` (moved from `settings/SettingsLayout.vue`) | `/settings/*`, `/account`, project settings/catalogs |
| 8 | Standalone | `StandalonePage` | login, invite, error, print pages |

States: `LoadingSkeleton`, `EmptyState` (exists), `ErrorState`, `ForbiddenState` (403),
`NotFoundState` (404). `PageState` stays as a thin facade over them so its ~106 call sites
keep working during migration.

Merges: the eight status badge components → one `StatusBadge` driven by a map (app maps
stay in their app folders); `FilterCard` folds into `FilterBar`; vendor and subscription
`InvoiceLines` → one component; `ProjectWorkspaceTabs`/`ProjectGovernanceTabs` → one tab
helper; the seven `*Table.vue` components migrate onto `DataTable`.

Print: `meetings/[id]/print` and the charter print view use a black-on-white print
stylesheet under `StandalonePage`.

Product contracts that do not move: routes, URL filters and back navigation preserving
them, `?view=board`, inline destructive confirmation, no stacked business dialogs, overlay
exceptions (search, bell, unsaved draft), `useHydrated()` gating, `data-testid` hooks and
visible headings used by Playwright.

## 7. Housekeeping done at the start of the branch

From the structure and component audits (2026-10-11):

1. Move `task/DescriptionEditor` and `task/TagPicker` to `shared/` (with stories); this
   removes the four R3 entries in `tools/arch_baseline.json`. Shrink the baseline with
   `python3 -B tools/arch_policy.py --write-baseline` in the same commit.
2. Move `AppSidebar`, `AppAccountMenu`, `GlobalSearch` into `components/shell/`.
3. Stop `shell/ContextSidebar.vue` importing `chat/ConversationList.vue`; the chat
   manifest supplies its sidebar content.
4. Remove `data-project-theme` / `data-workspace-theme` toggling in `layouts/default.vue`.
5. Split `pages/meetings/[id].vue` (627 lines) when it moves onto the Record template.

Left alone on purpose: `project`/`projects` naming, `composables/` and `utils/` breadth,
the pages tree, manifests, per-pillar locales, vendor/subscription folders.

## 8. Removal of the cream appearance

Touches `utils/appearance.ts`, `utils/brandTheme.ts` and their tests,
`components/shell/AppearanceMenu.vue`, `components/settings/BrandingPreview.vue`,
`assets/css/tokens.css` (`:root.cream`), `i18n/locales/{ar,en}/settings.json`,
`tools/test_ui_policy.py`. A stored `cream` preference resolves to `light`.

## 9. Tooling added

Adopt now (free, local):

- Visual snapshots: a Playwright spec that visits Storybook story iframes and calls
  `toHaveScreenshot` over the matrix ar/en × light/dark (desktop, plus mobile for shell and
  templates). Baselines generated in one pinned environment to avoid font drift. A
  baseline of the **current** UI is captured before any visual change.
- Accessibility: `@storybook/addon-a11y` (stories start at `todo`, tightened to `error`
  per template once migrated) and `@axe-core/playwright` on template pages.
- Colour checks reuse the contrast engine already in `apps/web/app/utils/brandTheme.ts`
  (no new dependency): Vitest tests assert the Nasq palette and sampled tenant primaries
  meet the contrast floors in both modes.

Deferred: ESLint Tailwind rules (`ui_policy.py` already flags physical classes).
Rejected: hosted/paid or unmaintained visual services (Chromatic, Argos, Lost Pixel).

## 10. Phases and checkpoints

| Phase | Work | Owner checkpoint |
|---|---|---|
| 0 | Worktree, `npm ci --ignore-scripts`, isolated mock stack on free ports | — |
| 0.5 | Housekeeping (§7), tooling (§9), baseline snapshots of current UI | Tooling demo |
| 1 | Tokens (light/dark), type, density, radius in `tokens.css` + `app.config.ts`; cream removal; text logo; new `DESIGN.md` | **CP1:** foundations story in both modes |
| 2 | Shell (header, rail, sidebar, mobile), stories for all shell parts | **CP2:** shell shots ar/en × light/dark |
| 3 | Command palette, `commands` in manifests, shortcuts, `?` help | **CP3:** live demo |
| 4 | Eight templates, five states, merges (§6) with stories | **CP4:** Storybook review |
| 5 | Pilot: `/projects` and `/projects/[id]` fully migrated | **CP5 (decisive):** direction confirmed or adjusted before rollout |
| 6 | Rollout by app, parallel agents on sub-branches merged into `codex/web-tasmim`: PMO → HR → Meetings → Chat → Settings/Account → Subscription → Vendor | Shots per app |
| 7 | Remove leftover `nasq-*` classes, scoped styles and inline styles (RichText and Gantt last); merge `main` in; full gates; review | **Owner authorizes the merge** |

`main` is merged into the branch regularly (at least weekly). Agent sub-branches are
named `codex/web-tasmim-<app>` (area `web`), each in its own worktree with its own
`node_modules` and `.nuxt`, and merge only into `codex/web-tasmim`, never into `main`.

## 11. Documentation changes

`DESIGN.md` is rewritten for the new identity (it currently mandates stock Nuxt UI,
three appearances and 64/76/236 shell geometry). Also updated: `docs/design-system/components.md`,
`docs/design-system/nuxt-ui-reference.md`, `docs/design-system/catalog.json`
(`node tools/ui_catalog.mjs`), `stockTheme.test.ts` (allowed `app.config.ts` keys),
`tools/ui_policy.py` rules and `STORYBOOK_COMPONENTS`. New user-facing strings (palette,
shortcut help, states) go into the owning locale files in `ar` and `en`.

## 12. Verification

Per phase: `npm test`, `npm -w apps/web run lint` (run from repo root as written; never
`npx -w`), `python3 -B tools/ui_policy.py`, `node tools/ui_catalog.mjs`, visual snapshot
spec, a11y checks, colour script. Playwright mock e2e is compared by failing-title set
against a pre-branch run on `main` (about 73 known failures) so only new failures count.
Before merge: `python3 -B tools/git_policy.py --base main` and
`python3 -B tools/arch_policy.py --base main`. No Odoo tests are required unless a phase
touches `odoo-addons`, which this design does not.

## 13. Risks

| Risk | Mitigation |
|---|---|
| Long-lived branch conflicts with `main` | Regular `main` merges; app batches touch disjoint folders |
| Late taste rejection (as with the reverted 2026-09-14 refresh) | CP1–CP5, with the pilot before any rollout |
| Agents diverge visually | Templates first; snapshots and a11y gates; agents only compose shared parts |
| Playwright selectors break | Keep `data-testid`, headings and route structure |
| Tenant colours with poor contrast | Colour script checks sampled tenant primaries; derived steps adjusted, chosen value never changed |
| Arabic shortcut layouts | `layoutIndependent: true`, verified in phase 3 |
