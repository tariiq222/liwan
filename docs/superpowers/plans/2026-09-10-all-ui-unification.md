# Complete customer UI unification plan

> **For agentic workers:** Execute the assigned file manifest in isolated worktrees. Coordinator handles integration and all validation; user-approved parallel batch workflow supersedes per-worker test/commit steps.

**Goal:** Audit every one of 91 runtime page files and 278 component definitions; correct all remaining legacy visual consumers against the approved Nuxt UI reference.
**Architecture:** Keep business contracts and routes. Port existing shared page/form/filter recipes, migrate module-owned consumers to real Nuxt UI, and inventory the remaining specialized/unused primitives. Preserve all user changes and capabilities.
**Tech Stack:** Nuxt4, Nuxt UI4.11.1, Vue3, TanStack, Reka, Unovis, Tiptap; Odoo19 unchanged.
**Spec:** DESIGN.md and apps/web/design-preview. Latest explicit user scope includes every module, including chat.

## Global constraints
- No commit, merge, push, deployment or cleanup. Main remains unchanged; integration is file-level in codex/nuxt-migration.
- Exactly one owner per file; three Luna high implementers maximum under the updated global policy. Worker scope is file-owned; no validation/browser until coordinator batch.
- Preserve real data, all routes/query/back, authorization, drafts, print, RTL/LTR, three appearance/font modes and reduced motion.
- Backend/API unchanged; all browser work uses scratch Odoo9469/DBnasq_nuxt_migration_20260910 and Nuxt3469. Never test odoo19.

## Batch deliverables
- [x] Shared foundation: apps/web/app/components/shared/{PageContainer,PageHeader,FormSection,PageState,EmptyState,DashboardChart.client}.vue; assets/css/{main,approved-shell,project-theme,nuxt-theme}.css. Coordinator owns reference widths/tokens/sections and scan enforcement.
- [x] Projects/tasks package: all paths in artifacts/all-ui/projects-tasks-owned.json. Luna high, continuing preserved Claude partials; file-only migration, preserve drag/drop and all workflow actions.
- [x] HR/access package: all paths in artifacts/all-ui/hr-access-owned.json. Luna high, continuing preserved Claude partials; preserve document, employee, role, password workflows.
- [x] Meetings/chat package: all paths in artifacts/all-ui/meetings-chat-owned.json. Luna high, continuing preserved Claude partials; preserve timed events, print, message/history/composer semantics.
- [x] Complete route/component coverage: machine inventory plus manifest of every concrete route and required fixtures; coordinator owns e2e/nuxt-all-pages.spec.ts and report. Scan before/after for old consumers and inspect every component classification.

## Verification after batch
1. Review each correction against artifact baseline hashes and copy owned changes only; preserve useful partials before any handoff.
2. Run UI policy, contracts/web tests,vue-tsc,isolated build once on combined work. Repair diagnosed failures without weakening retained behavior requirements.
3. Exercise every concrete page route plus project/tasks view tabs using real scratch fixtures; enumerate aliases/redirects and print. Check desktop/mobile and light/dark/cream with bounded coverage states, finite-animation screenshots, unresolved components/page errors/overflow and representative real saves.
4. Independently review diff and remaining component inventory. Record fresh exact checks, visible screenshots and any uncovered cases honestly. Finish only when required work is handled.

## Closure

Local verification complete: 91 route files, 498 authenticated route/viewport cases, 36 comprehensive browser tests plus 14 focused final-build checks passed; 15 policy, 160 contract and 811 web tests passed. Final typecheck/build passed. See docs/verification/2026-09-10-all-ui-unification.md. Changes remain uncommitted on codex/nuxt-migration; main is unchanged.
