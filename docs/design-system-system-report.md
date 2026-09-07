# Nasq unified design system — implementation report

> UI authority update — 2026-09-07: [DESIGN.md](../DESIGN.md) supersedes this document's customer-UI appearance, component and navigation prescriptions wherever they conflict. Preserve historical implementation/verification evidence and still-valid API, permission, business and delivery contracts. This document is not a second theme source.

Date: 2026-09-05  
Worktree: `/Users/tariq/code/nasq-design-system`  
Branch: `codex/design-system`  
Baseline: `b17058a`  
Delivery state: reviewable uncommitted local changes; no commit, merge, push, deploy, or production change.

## Delivered behavior

### Company branding

- Branding PATCH accepts only `primary_color`. Name/logo fields are rejected with 403, including mixed requests and vendor requests. Institution identity is managed by Odoo system administrators; company and company-contact ORM guards prevent direct customer writes.
- Added authenticated admin GET/PATCH endpoints backed by `res.company`. Customer admins and vendor support can manage the active company; employees receive 403. Company contact ACL/rules preserve company isolation. No new `sudo()` path was added.
- Validates six-digit HEX at the TypeScript and Odoo boundaries. Public logo URLs include a content/write version and reflect identity changes made in Odoo.
- Added Settings > Branding with accessible presets, HEX text input, colour picker, a notice explaining Odoo-managed identity, visible loading/error/retry states, scoped preview, explicit Save, Cancel to saved state, and colour-only Reset Default draft. Failed saves preserve the draft; successful saves update admin and public branding caches.
- Added pure `createBrandTheme(input: string): Record<string,string>` with `DEFAULT_PRIMARY = '#18181b'`. Invalid or hostile input falls back before CSS serialization. Primary foreground chooses black/white by contrast; link and focus colours meet the specified white-background thresholds.
- Applies sanitized theme variables as inline `<html>` custom properties so the generated asset cascade cannot override saved branding. White primary buttons retain a fixed boundary and visible hover state. Brand text/link/radio uses the derived accessible link token; semantic success/warning/error colours remain fixed.

### Shared composition

- Added reusable `PageHeader`, `FilterBar`, and `EmptyState` Vue components.
- Adopted them in representative task, project, task-detail, project-detail, and HR surfaces while preserving actions, permissions, query persistence, task return routing, hydration guards, archive/open/closed filters, and HR document/department flows.
- Filter bars render search first, scope/list controls in their defined order, view controls last when present, and active filter chips below. Search occupies a full mobile row. HR clear-filter actions reset both search and department.
- Project and task `done` states now share the fixed success tone.
- Shared headers allow action groups to wrap within narrow viewports. Icon controls touched by the change retain visible translated names or translated accessible names.

### Component guide

- Added the standalone Arabic RTL guide under `docs/design-system/`, including typography, headers, filters, status vocabulary, fields, buttons, loading/disabled/error states, and the interactive branding draft/save/cancel/default demo.
- The guide embeds the production theme utility, uses local licensed fonts, and clearly labels its browser-only persistence.
- The builder validates the expected exports and marker region, rejects static imports, escapes inline-script terminators, synchronizes default literals/tokens from the production utility, and writes through a temporary file plus atomic rename.

## Principal files

- Theme and branding UI: `apps/web/app/utils/brandTheme.ts`, `apps/web/app/composables/{useBranding,useBrandingAdmin,colorHex}.ts`, `apps/web/app/components/settings/{BrandingForm,BrandingPreview,SettingsTabs}.vue`, `apps/web/app/pages/settings/branding.vue`.
- Shared UI: `apps/web/app/components/shared/{PageHeader,FilterBar,EmptyState}.vue` and representative task/project/HR consumers.
- Theme primitives: `apps/web/app/assets/css/main.css` and the button, input, select, tabs, toggle, textarea, badge, native-select, and radio-group primitives.
- Contracts/API: `packages/contracts/src/common/branding.ts`; `odoo-addons/nasq_api/controllers/branding.py`, `serializers/company.py`, manifest, ACL, record rule, and branding tests.
- Locales/tests: Arabic/English settings and HR locales; theme, contract, component, project-status, Odoo, HR browser, and branding browser tests.
- Guide: `docs/design-system/Components.html`, `build.mjs`, `README.md`, and licensed local font assets.

## Original design-system review and verification evidence

The evidence below predates the subsequent user-approved identity permissions correction. See `branding-permissions-report.md` for its current verification.

The tests were written before production implementation. Root observed the expected RED failures: missing `BrandingPatchSchema`, `brandTheme`, `colorHex`, and shared components; project `done` mapped to `info`; and isolated Odoo admin branding/versioning tests failed 6 of 8 without errors. The Odoo red log is `/tmp/nasq-design-system-red-odoo.log`.

Fresh completed checks on the stabilized implementation:

- Theme focused unit: 14 passed.
- Isolated Odoo install/update test on database `nasq_design_system_20260905`, explicit design-system addon path, port 8177: 18 post-install tests passed with 0 failures and 0 errors. Log: `/tmp/nasq-design-system-green-odoo.log`.
- Full addon Ruff: passed.
- Full JavaScript unit gate: 203 passed total — 44 contracts and 159 web.
- Web Vue typecheck: passed with exit 0.
- Production build: passed with exit 0.
- Standalone guide build and generated inline-script parse: passed. Root browser checks covered gold contrast 13.71:1, save/reload, cancel, invalid input, explicit default save, filter states, and 390 px overflow.
- Production-preview Playwright gate: 12 focused project/task/HR/branding cases passed. The broader run passed 11 cases; the sustained-outage branding retry case then passed separately in 1.6 seconds after correcting its network simulation. Saved colour/name reload, inline theme cascade, white primary control styling, failed-save draft retention, presets, invalid HEX, load error/retry, project/task filters, and HR filtered-empty clearing are covered.
- Built-preview mobile check at 390 px: document `scrollWidth` was 390 px; the project action remained inside the 342 px header content area and wrapped correctly.

The independent read-only review found no Critical issues. Its four Important findings—rendered focus-ring opacity, white primary-button boundary, mobile header wrapping, and department-only HR empty-state semantics—were fixed. Its three Minor findings—native logo input reset, accessible loading, and guide-builder hardening—were also addressed. The scoped independent re-review passed with all seven findings addressed and no new Critical or Important breakage; its retained disposition is `docs/design-system-review.md`.

## Commands for reproduction

```sh
cd /Users/tariq/code/nasq-design-system
npm test
npx -w apps/web vue-tsc --noEmit
npm run build
node docs/design-system/build.mjs
```

Odoo verification must run from `/Users/tariq/code/odoo` with `/Users/tariq/code/nasq-design-system/odoo-addons` passed explicitly, a fresh isolated database, and a unique port. Never run these tests on `odoo19`.

Focused browser verification used the isolated Odoo instance on 8177 and the built Nuxt preview on 3177. The current branding suite restores the original colour after its save/reload assertions; it never writes the name or logo.

## Residual limits

- All evidence is local. It proves only the named contract, unit, Odoo, build, guide, and browser layers; it is not deployment or production proof.
- The isolated database and local preview are disposable test/runtime state. The canonical `main` checkout and the active Phase 3b/sidebar worktrees were not edited.
- No branch history was created and no remote is configured or claimed.
