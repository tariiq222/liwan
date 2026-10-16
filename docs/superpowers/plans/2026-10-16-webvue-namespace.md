# WebVue namespace implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline; use one independent whole-change reviewer.

**Goal:** Replace the entire owned product namespace and verify a fresh installation without disrupting concurrent work.

**Architecture:** One atomic namespace mapping across the existing architecture. No data migration, compatibility layer or new business behavior. One writer in an isolated worktree; latest-main reconciliation precedes integration.

**Tech Stack:** Odoo 19 Community, PostgreSQL, Nuxt 4, npm workspaces, Python AI service.

**Spec:** `docs/superpowers/specs/2026-10-16-webvue-namespace-design.md`

## Global Constraints

- Identifiers `webvue`, `WEBVUE`, `WebVue`; display `WebVue` / `ويب فيو`.
- Fresh isolated database only; upstream Odoo is read-only.
- No aliases or duplicate schema; preserve application boundaries, permissions and routes.
- Preserve third-party attribution, truthful external URLs and active physical checkout paths.
- No commit/merge/push/deploy or deletion of existing resources without authorization.

## Review Focus

- Stale references introduced by older concurrent branches.
- SQL, XML IDs and stored polymorphic model references diverging from renamed ORM models.
- HTTP headers or environment variables renamed at one end only.
- Runtime scripts still resolving old filesystem paths or package names.
- Architecture baseline/ranks weakened by mechanically renaming identifiers.

### Task 1: Pin the namespace contract and baseline

**Files:** `tools/test_product_namespace.py`; ignored `.superpowers/webvue-rename/*`.
**Interfaces:** Consumes repository files; produces failure list and task evidence.
- [x] Run existing unit/policy baseline and record pre-existing failures.
- [x] Write a regression check for the new module/package namespace and stale active identifiers; observe failure before conversion.

### Task 2: Convert owned source and active documentation atomically

**Files:** owned `odoo-addons/**`, `apps/**`, `packages/**`, `tools/**`, `deploy/**`, root configs, active docs.
**Interfaces:** Produces consistent new model/module/package/header/config names for all consumers.
- [x] Apply the case-preserving mapping to tracked text and owned filenames; protect historical evidence and actual external resources.
- [x] Bump affected addon schema versions and record fresh-install-only rationale in migration directories.
- [x] Regenerate the architecture baseline using its tool; verify every rule total does not increase.
- [x] Verify the namespace regression and focused policies.

### Task 3: Verify all layers on isolated resources

**Files:** fixes only inside the task worktree; ignored evidence and fresh databases.
**Interfaces:** Consumes Task 2; produces fresh command logs, counts and browser evidence.
- [x] Reinstall isolated dependencies; run unit/policy, commercial/control-plane and AI tests.
- [x] Run web/vendor type checks and builds, Python lint and relevant deployment checks.
- [x] Install the release catalog on a new PostgreSQL database; run nonzero Odoo tests and inspect the resulting schema.
- [x] Exercise real-stack browser flows with isolated ports, accounts and records.

### Task 4: Review and prepare integration handoff

**Files:** `docs/verification/2026-10-16-webvue-namespace.md`; independent read-only review.
**Interfaces:** Consumes all evidence; produces reviewed patch and collision protocol.
- [x] Review actual diff independently; resolve material findings and rerun affected checks.
- [x] Recheck main/concurrent work state and state any remaining integration requirements.
- [x] Record changed scope, test results and unverified areas; request integration authorization only after the result is concrete.
