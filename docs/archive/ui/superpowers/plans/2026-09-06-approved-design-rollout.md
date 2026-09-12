> **سجل تاريخي — ليس تعليمات تنفيذ.** المرجع المعتمد الآن: [DESIGN.md](../../../../../DESIGN.md). النتائج والمسارات الواردة أدناه تخص وقت تسجيلها.

# Nasq approved design implementation plan

> تاريخي. السياسة: [DESIGN.md](../../../../../DESIGN.md). ليس تعليمات واجهة.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan. Project delegation and no-commit requirements override skill defaults.

**Goal:** Apply the approved Nasq UI throughout the real application, retaining institution branding and adding persisted light/dark and three font sizes.
**Architecture:** Keep existing Nuxt/Odoo APIs and capability checks. Share reactive page context, semantic theme tokens and icon primitives across the real pages. Personal appearance is an SSR-readable cookie preference.
**Tech Stack:** Nuxt 4, Vue 3, TypeScript, Tailwind 4, existing shadcn-vue/Reka, @lucide/vue, Vitest and Playwright.
**Spec:** `docs/archive/ui/superpowers/specs/2026-09-06-approved-design-rollout-design.md`

## Global Constraints

- Isolated delivery in `codex/design-rollout`; no commits/merges/pushes/deploys/cleanup.
- Real data and existing capability gates; no prototype fixtures in runtime, no backend schema changes or tests against odoo19.
- One visible H1; Arabic RTL and English; icon 18px/stroke2 and outlined action square32px/radius8px.
- Appearance defaults light/small; font root14/16/18px; branding primary preserved exactly in both modes.
- Root owns shared integration/runtime/testing; workers do not build, lint or run full suites.

## Task 1: Appearance and brand foundation (root)

Files: `app/utils/appearance.ts`, `app/composables/useAppearance.ts`, `app/utils/brandTheme.ts`, `app/composables/useBranding.ts`, `app/assets/css/main.css`, `app/app.vue`, `app/pages/settings/appearance.vue`, `app/components/settings/AppearanceForm.vue`, `SettingsTabs.vue`, ar/en common/settings locales, corresponding utility tests and `e2e/appearance.spec.ts` (paths relative to apps/web).

Interfaces:
```ts
type AppearanceMode = 'light' | 'dark'
type FontSize = 'small' | 'medium' | 'large'
type AppearancePreference = { mode: AppearanceMode; fontSize: FontSize }
normalizeAppearance(value: unknown): AppearancePreference
createBrandTheme(input: string, mode?: AppearanceMode): Record<string, string>
useAppearance(): { mode: Ref<AppearanceMode>; fontSize: Ref<FontSize>; setMode(mode: AppearanceMode): void; setFontSize(size: FontSize): void }
```
- [x] Add utility tests for invalid/missing cookie, each valid preference, exact primary, contrast >=4.5 for text links/foreground across white/dark backgrounds and extreme brand colours. Observe new tests failing.
- [x] Implement normalization and cookie-backed shared reactive preference, mount html dark class/data-font-size via useHead for SSR, theme computation keyed by mode.
- [x] Add complete dark semantic tokens and typography selectors; preserve brand preview and existing colour writes.
- [x] Build appearance form with light/dark and small/medium/large labelled selections, show small as default active, link from SettingsTabs/account menu.
- [x] Import shell worker CSS and integrate locale fragments. Add browser checks for persistence and independence from admin branding.

## Task 2: Approved common shell (Sol lead)

Files: `app/layouts/default.vue`, `app/components/AppSidebar.vue`, new `AppAccountMenu.vue`, `app/components/shared/{PageHeader,PageContainer}.vue`, new `app/composables/usePageHeader.ts`, `app/components/ui/**` where icon primitives require changes, `app/composables/useNav.ts`, new `app/assets/css/approved-shell.css`, shell browser checks. No root-owned edits.

Interfaces: spec's usePageHeader/useShellPageHeader; SharedPageHeader props/slots preserved; root provides theme/appearance globals and imports approved-shell.css.
- [x] Compare approved reference with actual shell and preserve permission-filtered navigation, hydration controls, mobile and account actions.
- [x] Implement page context without DOM title scraping or SSR cross-request state; maintain a safe route fallback while async record loads.
- [x] Build balanced header, centered search, end account menu; reusable icon boxes and sidebar232/72.
- [x] Review all shared components for dark tokens and fixed icon dimensions; no global blanket selectors affecting logos/avatars.
- [x] Review PMO and other-page worker patches for spec and quality. Deliver patch/report to root; no commits.

## Task 3: Project and task pages (Luna worker coordinated by Sol)

Files: `app/pages/projects/**`, `app/pages/tasks.vue`, `app/pages/tasks/**`, `app/pages/archived-tasks.vue`, `app/components/project/**`, `app/components/task/**`, ar/en projects/tasks owning locale files, relevant focused E2E. No shared/header/theme/auth files.

Interfaces: SharedPageHeader existing props/slots and usePageHeader; button `size="icon"` global32px; semantic tokens from root.
- [x] Apply compact approved projects table, toolbar and summary cards from actual filtered records; all-summary eye toggle persists.
- [x] Match project overview/tasks/milestones/updates/settings layouts, equal icon action boxes, preserve routed creation/editing and permissions.
- [x] Match task detail metadata, main work area and activity column; all existing real editor, assignees, state transitions, subtasks, dependencies, attachments and prev/next must still function. Preserve filters and direct links.
- [x] Audit text/icons/dark classes in all PMO pages. Write targeted behavioral E2E checks without running global gates.
- [x] Deliver owned patch and self-review to Sol/root.

## Task 4: HR, account and administration pages (Luna worker coordinated by Sol)

Files: `app/pages/hr/**`, `app/components/hr/**`, existing `app/pages/settings/**` except appearance, `app/components/settings/**` except AppearanceForm/SettingsTabs, account/search/notifications/reports pages and owning components, ar/en hr/access/notifications locales. Shared common/settings fragments only.

Interfaces: existing SharedPageHeader and semantic theme tokens; root owns new appearance page.
- [x] Apply approved consistent content containers, headers/actions, compact filters/forms/cards/tables across all routes.
- [x] Keep HR ids/documents/list envelopes, role/user access workflows, password/account flows, real search and notification behavior intact.
- [x] Replace hardcoded light surfaces/status backgrounds with dark-compatible semantic or paired styles while retaining contrast.
- [x] Audit responsive layout and icon action sizes and submit owned patch/self-review. No backend changes or tests on Odoo.

## Task 5: Root integration and final acceptance

- [x] Apply disjoint worker patches into main task worktree after lead review; resolve only documented ownership collisions.
- [x] Run `npm test`, contracts build/Nuxt prepare/typecheck, production build sequentially; fix actual failures with scoped reruns.
- [x] Start independent runtime/ports with explicitly isolated test database or clearly scoped route mocks; run relevant existing browser gates and new appearance/layout cases.
- [x] Inspect rendered desktop/mobile light/dark small/medium/large and custom brand; confirm source main untouched.
- [x] Obtain focused Sol final review of integrated diff and resolve material findings. Write validation report, leave worktree intact, deliver preview and boundaries.
