# Nuxt UI Runtime Migration Implementation Plan

> **For agentic workers:** Use executing-plans with the scoped CLI delegation briefs. All integration and gates belong to the coordinator.

**Goal:** Move the real Nasq foundation and complete Projects workflows onto the approved Nuxt UI reference.
**Architecture:** In-place presentation migration with unchanged routed workflows and business composables. Independent worker checkouts; coordinator reconciles owned diffs.
**Tech Stack:** Nuxt 4, Vue 3, Nuxt UI 4.11.1, Tailwind 4, Odoo 19, Vitest, Playwright.
**Spec:** docs/superpowers/specs/2026-09-10-nuxt-runtime-migration-design.md

## Global Constraints
- Read DESIGN.md and docs/design-system/components.md. No demo data, new UI libraries, parallel appearance state, stock Odoo edits, tests on odoo19, commits or merges.
- Preserve routes/capabilities/drafts/query filters/unknown states and actual save operations.
- Workers own disjoint files and do not run build/lint/full tests; coordinator validates combined result.

## Execution checklist
- [x] Inspect clean baseline d4b6fc9 and create isolated coordinator checkout.
- [x] Verify Claude subscription and served Sonnet model; detect Grok authentication blocker.
- [x] Capture baseline tests after independent dependency installation.
- [x] Add behavioral regression cases for secondary branding and mobile/navigation/save workflows; observe missing behaviors before changes.
- [x] Coordinator: enable @nuxt/ui in apps/web/nuxt.config.ts, UApp in app.vue, add app.config.ts and assets/css/nuxt-theme.css recipes ported from reference without fixtures. Keep legacy consumers operational while migrated consumers use U components.
- [x] Coordinator: migrate shared components, ISO SharedDateField and single routed sheet. Preserve owner props/events/slots and centralized draft behavior.
- [x] Claude: migrate apps/web/app/pages/projects/**, project-templates/**, settings/projects/**, settings/projects.vue and components/project/** except coordinator route host/modal. Preserve state/composables and migrate to U controls with real translations and responsive records.
- [x] Grok after login: migrate components/shell/**, AppSidebar.vue, layouts/default.vue and assets/css/nuxt-shell.css. Desktop retains capability navigation; mobile exposes one menu with successful-route close and draft-safe cancel.
- [x] Coordinator or follow-up implementer: migrate project-consumed components/task/** dependencies after project ownership audit.
- [x] Coordinator: extend packages/contracts/src/common/branding.ts, nasq_core/res.company, nasq_api branding endpoints and settings branding form to secondary_color, preserving same authorization and full response.
- [x] Review each provider diff before copying owned files into coordinator checkout; catalog every new component.
- [x] Run python3 -B tools/ui_policy.py, npm test, npm run lint, npm run build. Diagnose baseline versus new failures; never weaken required behavior.
- [x] Run changed Odoo tests on isolated scratch DB and Playwright against unique ports. Check browser screenshots and console errors, actual save/re-read and navigation/draft permissions.
- [x] Independent review, fixes, final scope inventory and CLI workflow evaluation in docs/verification/2026-09-10-nuxt-runtime-migration.md. Leave uncommitted for user review.

## User-approved batch verification (2026-09-10)
Execute about five coherent tasks per batch, with independent file-owned implementers in parallel. Review diffs during execution. Defer browser testing until the batch has been implemented and integrated; collect fixes and rerun browser checks after the repair batch. Do not launch browser checks after individual task edits.
