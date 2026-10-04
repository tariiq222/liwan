# Package Management Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development for the bounded tasks below. Preserve user-owned dirty changes. No commits, merges, pushes, cleanup, runtime changes or child agents by workers.

**Goal:** Usable package creation, editing, review, publication, withdrawal and draft deletion, with actual new-tenant limits and preserved historical customers.

**Architecture:** Immutable commercial package revisions reference one trusted catalog version/hash/tier. Server records derive policy; worker and Python verifier check the same authority. Existing catalog-only enrollment remains backward compatible. UI consumes package endpoints and selects a published revision at onboarding.

**Tech Stack:** TypeScript/Zod, PostgreSQL, Python provisioning tools, Nuxt/Vue/Nuxt UI, Vitest and unittest.

**Spec:** `docs/superpowers/specs/2026-10-02-package-management-design.md` (user approved continuation 2026-10-02).

## Global Constraints

- Work only in `/Users/tariq/.codex/worktrees/saas-lifecycle-integration/nasq`, branch `codex/ui-live-review`, base `5dc1daef79ff4628f92d4b23a8dec2d27e3af1eb`.
- User's newer Astra routing policy supersedes the old Luna paragraph. Backend Astra high; UI Astra medium; independent review Astra high. No paid APIs, children, or full worker test/build/lint runs.
- Read AGENTS.md/CLAUDE.md/DESIGN.md and preserve all prior dirty UI/operation-feed changes. Parent owns runtime, final checks and integration.
- Published revision identity/policy immutable; withdrawal stops new enrollment only; drafts deletable only without references. Numeric limits use safe nonnegative integers, null unlimited, 0 unusable. Storage means attachment-accounting MiB, not total disk.
- No arbitrary modules/features, prices, automatic customer upgrades or changes to Odoo core/addons. Old null policies, jobs and quotes retain meaning and replay behavior.
- Arabic/English, RTL, permissions, hydration, create panel, full edit/detail pages, inline destructive confirmation, field validation after submit, dirty protection and safe return paths are required.
- Full suite and DB/browser mutations are parent-owned; workers may run explicitly named focused tests without live databases. Existing scratch Docker database is never used for destructive unit suites.

## Review Focus

1. Parallel edit/review/publish races: revision compare-and-swap and frozen reviewed content.
2. Withdrawn published revision: reject new assignment but allow existing enrollment retry/job resolution.
3. Numeric spoofing or source mismatch: reject before Odoo effect; legacy unlimited path unchanged.
4. Catalog-only payment path targeting a package-bound customer: reject mismatch without silently removing the package reference.
5. Direct links and incomplete form: create/edit survives refresh and protects drafts; zero/unlimited rendered distinctly.

## Wire contract (freeze before dispatch)

`PackageRevision` fields: `id` revision UUID, `package_id` stable UUID, `version` positive revision number, `revision` positive optimistic edit token, `name`, `description`, `status: draft|validated|published`, `available` boolean, `catalog_version`, `catalog_tier`, `source_sha256`, `limits: Record<string,number|null>`, `modules: string[]`, `features: string[]` trusted descriptors, `customer_count`, `created_at`, `published_at: string|null`. Export types/schemas from commercial-contracts, implemented in `src/packages.ts`.

```ts
type PackageInput = {
  name: string; description: string;
  catalog_version: string; catalog_tier: string;
  limits: Record<string, number | null>;
}
// GET /v1/packages => {items: PackageRevision[], total:number}
// GET /v1/packages/:id => PackageRevision
// POST /v1/packages (PackageInput) => PackageRevision draft
// PATCH /v1/packages/:id (PackageInput & {revision:number}) => PackageRevision draft
// DELETE /v1/packages/:id ({revision:number,reason:string}) => {deleted:true}
// POST /v1/packages/:id/revisions ({reason:string}) => cloned draft PackageRevision
// POST /v1/packages/:id/(validate|publish|withdraw|restore)
//   ({revision:number,reason:string}) => PackageRevision
// GET /v1/catalog remains trusted source list; source tiers drive choices.
// shared onboarding accepts package_revision_id OR existing catalog_version/catalog_tier;
// package path resolves the source itself; caller never supplies derived policy.
```

Read capability `vendor.read`; all mutations `vendor.catalog.manage`. Creation/edit have intrinsic audit reasons describing draft save; lifecycle/delete/clone supply a 3–1000 character reason. Structured errors retain existing HTTP/field contract. Package list includes revisions (the UI can group/filter without hiding a published revision behind a draft).

### Task 1: Server package lifecycle and trusted provisioning policy

**Owner:** Backend implementer; parent is sole integrator. This is one dependent package, not parallel writers.

**Files:** create `packages/commercial-contracts/src/packages.ts`, package tests; create `apps/control-plane/src/packages.ts`, `package-http.ts`, `schema_011.sql`, package lifecycle tests. Modify existing contracts `index.ts` and shared provisioning schema, control `db.ts`/`http.ts`, `shared/onboarding.ts`, `shared/job-store.ts`, shared worker dispatch/real Odoo adapter as needed, and legacy `shared/shared-order.ts` guard. Modify `tools/nasq_cli/managed_policy.py` and `tools/shared_saas_lifecycle/odoo_effect.py`; add focused Python package authority tests beside existing policy tests. No frontend files.

**Interfaces:** Produces the frozen wire contract above and a worker authority resolver tied to immutable package revision/id/digest/catalog. Keep route plumbing small; package storage/lifecycle in its own module. New SQL references published package revisions from tenants, DB guards prevent published edits/deletes; logical availability separate from immutable content. Capture optimistic revision in each transition. Locked enrollment assignment makes withdrawal race-safe and replays preserve assigned source.

- [x] Write focused tests first: draft→validated→published, edit invalidates validation, stale token conflict, published content protection, draft deletion/refusal, withdrawn selection versus replay, exact finite/zero/null policy, arbitrary feature/source/digest rejection, historical derivation unchanged.

```ts
expect(derivePackagePolicy(trustedProjects, 'projects', {
 'users.limit': 3, 'storage.limit_mb': 2, 'projects.max_projects': 1,
}).features).toEqual({
 'users.limit': 3, 'storage.limit_mb': 2, 'pmo.enabled': true,
 'meetings.enabled': true, 'projects.max_projects': 1,
})
// A negative/fractional/unknown limit must reject; null and 0 stay distinct.
```

- [x] Run only new focused contract/pure unit tests and named Python authority tests, observe RED and record it. Do not run live SQL tests; parent supplies an isolated database at final verification.
- [x] Implement schemas, migration and atomic package store/API. Backend list/detail shapes exactly match contract. Required metadata is bounded/trimmed. SQL guards and server capability checks cover direct API bypasses.
- [x] Add optional pinned package selection to shared enrollment, derive server policy and persist identity in the job. Worker re-resolves and compares trusted package authority before execution; Python numeric policy acceptance is explicitly versioned and checked against worker-supplied trusted authority, not a caller-computed digest alone. Preserve trusted catalog hash/modules and legacy null-only verification.
- [x] Guard legacy paid-order code against rewriting a package-bound customer's selection; don't implement package pricing or payment.
- [x] Run focused pure tests GREEN, provide integration test cases for parent. Self-review diff and write report with exact frontend API/types, changed files and unresolved concerns. No commit.

### Task 2: Human-readable package UI and enrollment selection

**Owner:** UI implementer after Task 1 contract review, using existing worktree. No backend writes.

**Files:** move list from `apps/web/app/pages/vendor/catalog.vue` into `pages/vendor/catalog/index.vue`; keep `catalog.vue` as the thin parent wrapper rendering the list behind `/new` and `<NuxtPage />`, following `pages/project-templates.vue`. Add `new.vue`, `[id].vue`, `[id]/edit.vue`; new `components/vendor/PackageForm.vue` with Storybook story if shared, new package presentation utility/tests. Modify `pages/vendor/tenants/new.vue`, `composables/useSharedTenantOnboarding.ts` as required and `i18n/locales/{ar,en}/vendor.json`. Sidebar already uses vendor locale keys. Parent owns `server/utils/vendor-control.ts` and its test (PATCH/DELETE already added with focused 11/11 verification), plus shared story registry if needed.

**Interfaces:** Consume frozen PackageRevision and PackageInput. GET trusted catalog for template selection; show human translated tier/app/feature labels with technical fallbacks. Package form posts only editable metadata/template/limits. Shared tenant request posts selected package_revision_id; legacy source selection remains an explicitly named fallback until packages exist.

- [x] Write behavior tests for limit serialization (`0`, integer, explicit unlimited), unknown metadata fallback, selected package onboarding body, validation, lifecycle action payload revision/reason, and safe list-return URLs.

```ts
expect(packageLimitValue({ mode: 'unlimited', value: '' })).toBe(null)
expect(packageLimitValue({ mode: 'limited', value: '0' })).toBe(0)
expect(() => packageLimitValue({ mode: 'limited', value: '-1' })).toThrow()
```

- [x] Observe focused RED before implementation. Implement list/header/search/status filters in URL, name/function/apps/limits/state/next action. Avoid raw JSON in the main surface; source info goes under technical details in detail view.
- [x] Build /new in SharedCreatePanel and full detail/edit pages; shared PackageForm has a story and authorized catalog entry. Field errors appear after first submit, general error above form, save loading, dirty protection. Select a known composition; users/attachments plus project quota when applicable; no invented ceilings.
- [x] Implement contextual reason fields and inline confirmation for delete/withdraw; published edit clones a revision; validation and publication effects clearly explained. Conflict and permission failures visible.
- [x] Use published+available package choices in enrollment with human summary. Existing trusted catalog fallback clearly historical; never implicitly replace current customers.
- [x] Run focused UI behavior tests GREEN, self-review and report. Parent owns full checks and browser.

### Task 3: Integrated acceptance and preview

**Owner:** Parent plus one independent read-only reviewer. Source changes remain in isolated worktree, not main.

- [x] Review actual diff per task against pre-task dirty snapshot, not just HEAD (earlier UI work exists). Resolve findings without weakening earlier tests.
- [x] Run commercial contracts, full serial control-plane tests on a new isolated scratch database, relevant Python suite, web tests and typechecks. Preserve runtime database/volumes. Record actual counts and failures.
- [x] Rebuild vendor frontend sequentially on host with heap4096 and existing dependencies; package `.output` into Node22 Alpine runtime. Rebuild worker/API only as needed with owned volumes, then apply migration to owned local control DB. Preserve prior images and data.
- [x] Browser: empty guidance, create/edit/validate/publish, reason/error states, clone published revision, withdraw/re-enable, delete only task-created draft, customer boundary, RTL/mobile/direct-link/refresh/draft protection. Forbidden direct mutations are covered by live SQL/API tests. English translations/key parity verified; no English browser claim because no locale switch is exposed. Explicit browser-back coverage is not claimed separately.
- [x] Create a separate scratch customer through UI with finite package limits. Verify actual Odoo policy readback and user/project/attachment rejection at chosen limits; finite, zero, unlimited authority cases covered. Existing customer's selection unchanged after publishing another revision.
- [x] Save acceptance evidence in `docs/verification/2026-10-02-package-management.md`; update task receipt with actual participants and evidence. Measurement stays incomplete because initial baseline was late. Do not claim release readiness.

## Accepted local checkpoint

2026-10-02: package area accepted locally; detailed evidence and boundaries in `docs/verification/2026-10-02-package-management.md`. Real finite and unlimited/zero package customers provisioned and signed in. Seeded vendor-support admin exclusion fixed for new package provisioning, with fail-closed readback. Final structured quota messages translated and verified in Arabic browser; full web suite 1030/1030. Both frontend tenancy modes rebuilt separately and healthy. No commit/merge/push or production acceptance.
