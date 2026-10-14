# Nasq Operations and Approvals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Track steps below and preserve all unrelated work.

**Goal:** Add the adapted OCA approval engine and an Arabic/English operations UI; authorize every action with Nasq capabilities and test on isolated resources before any merge.
**Architecture:** `base_tier_validation` is a registered rank-3 service adapted to run without new sudo/private access overrides/direct SQL. `nasq_operations` owns process definitions, immutable submitted-request snapshots, sequential approvals, audit and once-only transactional execution. Execution uses private application hooks rather than installing the privileged server-action addon.
**Tech Stack:** Odoo 19 Community, Nuxt 4/Nuxt UI, TanStack Vue Query, Zod, Vitest and Playwright.
**Spec:** `docs/superpowers/specs/2026-10-14-nasq-operations-approvals-design.md`; the owner's latest instruction rejects the earlier exemption proposal.

## Global Constraints

- No growth of `exempt`, `commercial.allowed` or `arch_baseline.json`; do not edit the policy tools to pass the change.
- No new `sudo()`, private Odoo access overrides or direct SQL on Odoo tables. Preserve Odoo source and original Eradah distribution.
- Preserve OCA attribution and AGPL-3 on imported source; Nasq-authored addon files retain their own declared license.
- All routes: `type='json2'`, `auth='user'`, `api_handler`, `requires_feature('operations.enabled')`, current-company and record guards; lists `{items,total}` and strict serializers/contracts.
- All mutations require capabilities through ORM and HTTP; requester/reviewer/monitor/manager roles remain distinct. System admin does not gain business approval.
- Use isolated worktree, scratch DBs and ports; never test on `odoo19`. No commit/merge/push/deploy/cleanup authorization.
- Required model for every participant: GPT-6.1 Sol; implementation effort high. No worker children.

## Review Focus

1. Repeated/concurrent final approvals must produce one execution and a single committed decision.
2. A reviewer removed or disabled after submission must lose authority; another company's users must never see or decide the request.
3. A manager must not rewrite a submitted request, its stage snapshot or its evidence through raw ORM or context injection.
4. Process edits must not change a submitted cycle; stale revisions, returns and retries must preserve history and invalidate old decisions.
5. Engine methods and direct RPC must not bypass feature/capability checks enforced by HTTP.

### Task 1: Adapt imported tier engine (worker)

**Files:** Own only `odoo-addons/base_tier_validation/**` and `.superpowers/operations-20261014/engine-{brief,report}.md`; original source `/Users/tariq/code/eradah/.work/oca-tier19-fixed-20261013/candidate/base_tier_validation` is read-only.
**Consumes:** Odoo 19 public ORM/record rules and the original security token pattern.
**Produces:** Existing `tier.validation` mixin APIs `request_validation`, `validate_tier`, `reject_tier`, `restart_validation`, `_tier_lock`, `_validate_tier`, `_rejected_tier`, `_tier_eligible_reviews`; original `tier.definition`, `tier.review` and `_workflow_reviews` token helper.

- [x] Import source with attribution/provenance and no generated caches. Registering ranks is coordinator-owned.
- [x] Add behavioral tests denying review mutation and foreign-document reads; run them against the imported source before adaptation. Existing source supplies the test reference model.
- [x] Replace elevated writes with guarded public CRUD + appropriate ACLs, object-identity internal tokens, and document-following record rules. A user cannot forge these tokens via JSON.
- [x] Remove private access/search overrides and direct SQL using public ORM/rules. Keep sequential decision/locking behavior and no bypass through fabricated context.
- [x] Run focused engine tests on `scratch_nasq_operations_engine_20261014` port 8275 with a private config/data dir; no other database or service. Do not run broad suites. Document commands and actual nonzero counts.
- [x] Report actual diff, remaining concerns, APIs and evidence. Do not commit.

### Task 2: Operations resources, contracts and API (coordinator)

**Files:** `odoo-addons/nasq_operations/**`, `packages/contracts/src/operations/**`, contracts barrel and registry/catalog integration.
**Interfaces:** Process `{id,name,description,state,revision,steps:[{name,reviewer_ids}],execution_kind}`; request `{id,name,description,process:{id,name},state,revision,cycle,requester,created_at,steps,events,execution_count,allowed_actions}`. States `draft,pending,returned,rejected,withdrawn,done`. Actions `submit,approve,reject,return,withdraw,edit`. Bodies use `{revision,comment?}` for decisions, reject/return require comment.

- [x] Write regression fixtures extending `NasqApiCase`, two reviewers, requester, outsider, manager and second company. Begin with two-stage approval and blocked raw state mutation tests.
- [x] Implement process/step version publication, protected review definitions and request snapshots. No arbitrary executable code or model from user.
- [x] Implement private server tokens for audit/protected writes and public transitions checking feature/capability/current company/record visibility/actor/status/revision. Use a savepoint for final approval+execution, claim before the private hook, and return full detail.
- [x] Add strict request/process/list Zod contracts and golden fixtures; reject unknown fields and contradictory action/state inputs in boundary tests.
- [x] Implement HTTP routes and serializers, including safe attachments with original-record download authorization and revision conflict 409.
- [x] Run focused ORM/HTTP cases on `scratch_nasq_operations_app_20261014` port 8274; then repeat update of the same scratch install and assert retained history/count.

Test acceptance example (literal expectations):
```python
request.with_user(requester).action_submit(0)
request.with_user(reviewer_a).action_approve(1)
assert request.state == 'pending' and request.execution_count == 0
request.with_user(reviewer_b).action_approve(2)
assert request.state == 'done' and request.execution_count == 1
```

### Task 3: Operations UI (worker; coordinator integration)

**Files:** `apps/web/app/{pages,components,composables,modules}/operations/**`, `apps/web/i18n/locales/{ar,en}/operations.json`, operation stories/tests, `DESIGN.md` registration.
**Consumes:** Task-2 strict contracts and server `allowed_actions`; no local privilege inference.
**Produces:** `/operations`, `/operations/pending`, `/operations/monitoring`, `/operations/processes`, route-backed request/process creation, full record/edit pages, filters/back/draft protection.

- [x] Add tests for request-query normalization, no optimistic approval, and form errors/draft protection against real forms/composables at their boundary.
- [x] Use published shared components and Nuxt UI, existing RTL shell, localized strings, hydrated controls and route manifests.
- [x] Show stages/reviewers and append-only history; inline reject/return reasons and confirmation; disable all writes in-flight. Surface actual HTTP failures.
- [x] Run focused Vitest and owning `vue-tsc` from apps/web, then live-browser requester/reviewer journey and direct-link/refresh/back checks in Arabic at 375 and 1440, light/dark appearances; English locale parity is checked statically. Browser acceptance in English remains unverified because the existing client exposes no locale selector.

### Task 4: Integration and independent final review (coordinator/reviewer)

**Files:** optional PMO bridge, deployment registration/copies, acceptance evidence and final diff package.
**Consumes:** Tasks 1–3 and PMO `_nasq_accept_completion(revision)`; no edits to PMO ownership.

- [x] Bridge PMO completion only through the original designated-reviewer/revision checks; no independent capability grant. Deny stale/foreign/not-designated actors and duplicate completion.
- [x] Run real concurrent approval sessions and a failing execution/retry in scratch. Assert exact one committed side effect and rollback.
- [x] Run `npm test`, web lint, `ruff`, catalog/policy checks and `git_policy.py --base main`, `arch_policy.py --base main`; exemptions/baseline must be unchanged.
- [x] Package actual uncommitted diff/new files for independent Sol review, resolve findings and repeat only affected checks after changes.
- [x] Record actual checked boundaries. Keep task worktree/data/evidence and report ready-for-review without committing or merging.


Acceptance captured on 2026-10-14 in the isolated worktree. Current report and exact logs: `docs/verification/2026-10-14-operations-approvals.md`. No commit, merge, push or deployment occurred.
