# Unified Nasq Design System Implementation Plan

> Execute task-by-task with one integration owner; the user approved execution. No additional process approval is needed.

**Goal:** Apply the approved reusable components and editable company colour.

**Architecture:** Keep the existing Nuxt/shadcn-vue primitives and res.company branding contract. Add a pure colour derivation utility and thin shared composite components. Reuse only committed Phase 3b branding dependencies.

**Tech Stack:** Nuxt 4, Vue 3, Tailwind 4, Vitest, Odoo 19.

**Spec:** ../specs/2026-09-05-design-system.md

## Global Constraints

- Arabic default; English translations for all product strings. Logical RTL properties; existing useHydrated guards.
- Never run tests on odoo19; no upstream Odoo source/config edits.
- No commit/merge/push/deploy or discarding unrelated work.
- Worktree /Users/tariq/code/nasq-design-system, baseline b17058a, dependencies installed independently.
- Root owns docs/design-system and prototype under the existing scratch server. Technical lead owns app/backend changes. Root alone owns final tests/runtime.

### Task 1: Functional branding and theme

Files: apps/web/app/utils/brandTheme.ts and its unit test, assets/css/main.css, composables/useBranding.ts, composables/useBrandingAdmin.ts, composables/colorHex.ts, components/settings/BrandingForm.vue and BrandingPreview.vue, SettingsTabs.vue, pages/settings/{projects,branding}.vue, locales/{ar,en}/settings.json; packages/contracts/src/common/branding.ts and branding tests; nasq_api branding controller/company serializer/tests/security/manifest as needed.

- [x] Examine committed 91c0ee2 branding diff and reuse only its branding paths; do not bring account or HR features.
- [x] Add tests for theme derivation (white/yellow readable text, links with 4.5:1 contrast on white, ring with 3:1, invalid CSS falls back); root runs red gate before utility implementation.
- [x] Implement createBrandTheme and use it in app head and scoped preview. Use default #18181b and validated six-digit hex. Foreground chooses higher contrast of #000000/#ffffff; derive darkened brand-link/ring until thresholds hold.
- [x] Wire admin branding endpoints and preserve existing security: no new sudo, role check plus company record rule. Import corresponding existing regression tests.
- [x] Add preset palette, accessible colour input, preview, saved/cancel/default draft transitions and explicit Save. Draft never changes app until server success; failed save retains draft. Update query/public branding caches after success.

### Task 2: Shared composition and adoption

Files: apps/web/app/components/shared/{PageHeader,FilterBar,EmptyState}.vue, task/TaskToolbar.vue, project/ProjectHeader.vue, task/TaskDetailPage.vue, pages/{tasks,hr}.vue, pages/projects/index.vue, tables/boards empty surfaces, taskState/projectStatus and owning locales as required.

- [x] Implement PageHeader(title,description?, backTo?,backLabel?) with back/title/actions slots, responsive gap and logical alignment. FilterBar uses search/default/view/active slots with search first, controls then view last. EmptyState(title,description?) has icon/action slots and status presentation.
- [x] Replace duplicated header/filter/empty wrappers in representative tasks, projects and HR while preserving every action/permission and URL filter behaviour. Do not rewrite feature logic.
- [x] Use same success tone for completed task and project. Centralize semantic classes via CSS tokens where currently duplicated. Preserve readable labels independent of colour.
- [x] Ensure actionable icon-only buttons in touched components have translated labels; clear filters remains distinct from empty-data create.

### Task 3: Reviewable component guide

Root-owned files: docs/design-system/Components.html and any associated scoped CSS/JS. Existing supplied scratch Components.dc.html receives the same self-contained output, after retaining an original backup.

- [x] Build a responsive Arabic guide with shared typography, page header, filters, states, inputs and tables. Include a settings demo with preset/custom primary, live scoped preview, save/cancel/default and clear explanation that demo saves in this browser only.
- [x] Use CSS tokens exclusively for brand-bearing components; compute readable foreground/link/ring matching production policy. Keep semantic tones fixed.
- [x] Browser-check narrow and wide layouts, invalid input, save/reload, cancel and reset. Do not describe prototype persistence as backend verification.

### Task 4: Final verification and handoff

- [x] Lead reviews worker diffs for spec and quality without running full suites. Root runs npm test, web typecheck, production build once after changes stabilize.
- [x] Root runs focused nasq_api/core tests on nasq_design_system_20260905 with explicit worktree addons and unique port 8177; no odoo19 tests.
- [x] Root checks live preview and focused settings flows on isolated runtime ports 3177/8177. Reviewer inspects final diff and receives fresh test evidence; resolve actionable findings then rerun only affected checks.
- [x] Record paths, checks, residual risks and exact branch/runtime state. Keep worktree and uncommitted output for user review.

## Final local evidence

Completed on 2026-09-05: 203 contract/web unit tests, 18 isolated Odoo post-install tests with zero failures/errors, Vue typecheck, addon Ruff, production build, and all 12 selected browser scenarios (11 in the final broad run plus the corrected sustained-outage retry scenario in a focused rerun). Mobile projects and branding fit 390 px; the settled keyboard focus ring is opaque and visible. The guide passed its interaction and mobile checks.

Live review: guide `http://127.0.0.1:8877/Components.dc.html`; application `http://127.0.0.1:3177/settings/branding`; Odoo `127.0.0.1:8177`, isolated DB `nasq_design_system_20260905`. Changes remain uncommitted on `codex/design-system`; canonical `main` is clean.
