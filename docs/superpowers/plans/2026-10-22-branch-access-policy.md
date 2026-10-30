# Branch Access Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax.

**Goal:** Implement the owner-approved branch access modes without cross-company permission leakage.
**Architecture:** Core owns policies and assignment checks; API pins each operation to authorized companies. Nuxt uses the typed versioned admin API.
**Tech Stack:** Odoo 19, PostgreSQL, Zod, Nuxt 4, Vue Query.
**Spec:** docs/superpowers/specs/2026-10-22-branch-access-policy-design.md

## Global Constraints
- Modes: isolated, delegated (default), inherited. Membership never grants sensitive access.
- Preserve all unrelated work. Native GPT-6.1 Sol only; no external model fallback or deployment.
- No new sudo bypass, stock source edits or live database changes. Scratch tests only.
- User-facing alternatives belong in settings; defects are never configurable.

## Review Focus
- Read permission in one company must not enable writes elsewhere.
- any/all capability gates must not union incompatible per-company permissions.
- Context injection and stock ORM paths must not bypass the server's scope.
- Inheritance and role revocation must affect existing sessions immediately.
- Settings must preserve unseen/other-company assignments and reject stale edits.

### Task 1: Policy, authorization and typed API
**Files:** odoo-addons/liwan_core/**, odoo-addons/liwan_api/**, packages/contracts/src/access/**; exports only in packages/contracts/src/index.ts if required.
**Interfaces:** The two GET/PATCH admin APIs and shapes in the spec. Export BranchPolicySchema, BranchPolicyInputSchema, UserBranchAccessSchema, UserBranchAccessInputSchema and inferred types.
- [ ] Write regression tests reproducing parent capability leakage and verify failure.
- [ ] Implement core policy persistence, explicit branch assignment operations, capability scoping and inheritance; migration/version/audit.
- [ ] Implement declared admin routes and schema validation.
- [ ] Run focused Odoo/core/API/contracts regressions, including all Review Focus conditions.
- [ ] Commit the owned changes after self-review; no push.

### Task 2: Customer settings and delegation UI
**Files:** apps/web/app/pages/settings/team/branches.vue, apps/web/app/components/access/**, apps/web/app/composables/useBranchAccess.ts, apps/web/i18n/locales/{ar,en}/access.json, owning nav and settings registration, focused web tests.
**Interfaces:** Consume Task 1's Zod schemas and versioned APIs exactly. Link branch delegation from existing user access page.
- [ ] Add focused schema/UI behavior tests; verify failure.
- [ ] Implement three-mode selector, per-branch opt-out/role selection, explicit per-user branch grants, hydration/draft/error/conflict handling and existing settings navigation.
- [ ] Run focused unit tests and web type check.
- [ ] Commit owned changes after backend integration; no push until integrated checks and review.

### Task 3: Integrated verification and review
**Files:** docs/api generated artifacts, acceptance evidence and PR description.
- [ ] Review actual diffs against spec; independent Sol review of the complete change.
- [ ] Run focused scratch Odoo and upgrade checks, npm test, web lint, architecture/Git/migration/API/route gates; record evidence.
- [ ] Resolve review findings with regressions. Publish to the same PR only when ready; preserve protected delivery gates.

### Approved independent repair packages — 2026-10-23
- [ ] Direct web/session/HomeFocus/document-link corrections: worker owns declared files in web-review-fixes; focused regression evidence and local commit, no push. Canonical route decision changes no runtime code if live consumers already conform.
- [ ] Shift-day settings: worker owns liwan_hr, contracts/hr/shifts.ts, HR personal summary/settings/form/stories/locales. Implement approved spec addendum; focused regression and scratch tests, version/migration.
- [ ] Coordinator owns native branch settings UI, finance shared imperative gate adoption and finance branch HTTP/ORM tests. Merge worker commits only after actual diff review; final broad review covers all packages.

#### Full-release compatibility repair addendum

The backend lane owns narrow explicit shared gate adapters across existing HR/tasks/meetings/PMO/operations controller permission helpers, preserving existing all/any behavior. Known contextual PMO GET readers use the separate read-scope declaration contract in the design addendum; actual record authorization remains in the existing model/service. Chat has no registered operation capability and stays current-only, with its old membership-only matrix corrected explicitly. Native implied internal groups are preserved when supplied by an actual branch capability, rather than injected from unrelated membership. Repeated native authorization computation may use only a bounded transaction memo with relevant mutation and rollback invalidation; same-operation immediate revocation, branch isolation and query thresholds remain binding. Reproduce actual regressions before edits, verify the affected classes and core scope cases, independently review the immutable delta, then require current-head full CI release shards before merge.
