# Split Consolidated Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deliver the approved PR35 work through independently verified pull requests, then synchronize main and retire preserved task worktrees.

**Architecture:** Preserve immutable candidate `43870eade5b63b7aa1bbf1f3b1e88fb5fbeecd47` and its original commit graph. Extract coherent patches against current remote main; keep coupled authorization activation and application consumers together. Every intermediate main must work without temporary compatibility paths or weakened tests.

**Tech Stack:** GitHub protected PRs, Nuxt 4, Vue Query, Odoo 19, PostgreSQL scratch databases.

**Spec:** Owner-approved branch/shift/self-service decisions in `AGENTS.md`; delivery contract in `docs/agents/integration-rules.md`.

## Global Constraints

- Preserve unrelated edits, original source commits and recovery material; no force-push or direct main push.
- GPT-6.1 Sol only; the historical Claude exception applied only to PR36.
- Each PR needs fresh subset verification, current-head native review, CI and exact-head sensitive approval.
- No stock Odoo edit, new elevation, architecture-baseline growth, skipped assertions or live database tests.
- No deployment or live-data upgrade. Worktree cleanup uses `tools/wt.py gc` after preservation and verified integration.
- Preserve delegated-default/isolated/inherited branch policies, exact grants, company-timezone shift default and approved canonical account routes.

## Review Focus

- A newly enabled branch operation must retain its owner, native visibility and exact capability throughout its consumers.
- Anonymous/forged sessions cannot reserve application-work slots or upload buffers without bounded admission.
- A disconnected queued request cannot later execute; claimed writes retain the existing completion contract.
- Intermediate UI routes, manifests, strict contracts and locale/story references must match available endpoints.
- Splitting cannot lose source paths, original history, ignored configuration or regression coverage.

## Task 1: Independent session/proxy admission

**Files:** Nine source/test paths recorded in the extraction manifest: auth login/logout/totp handlers, API catch-all proxy, tenantTransport, apiSessionAdmission, tenantApiProxy unit/wire tests and tenantTransportQueue tests. This plan accompanies the first delivery.

**Interfaces:** Consumes the existing `/api/v1/me` identity response (`id`, `company.id`) and existing tenant binding/body helpers. Produces bounded `requireApiSession` and queue/cancellation behavior without new contracts, dependencies or backend APIs.

- [x] Extract exact source patches from the immutable candidate into a fresh main-based claimed worktree; byte-verify all nine results.
- [ ] Run focused proxy/transport tests, Nuxt prepare/types, repository npm/static/security checks.
- [ ] Independently review the actual extracted delta and evidence.
- [ ] Publish a bounded PR; require its own current-head Actions/native review and sensitive approval, then merge normally.

## Task 2: Company/branch authorization cohort

**Files:** Core/API and all affected application owner/privacy/native-cache consumers, access contracts, branch settings UI and corresponding regressions. The backend allocation has 179 paths overall, with seven shared paths needing semantic hunks; self-service and shift ownership are extracted separately.

**Interfaces:** Core scope activation and application consumers form one dependency cohort. Historical membership-only isolation commits are not safe preparatory PRs. The remaining backend cohort exceeds the Claude fallback size limit; native Codex remains required.

- [ ] Extract the atomic capability/fence cohort with its app consumers and branch UI/contracts.
- [ ] Keep all fresh native-cache, grant/revoke, attachment, contextual-read and owning-company regression assertions.
- [ ] Regenerate API artifacts on this candidate, run affected scratch acceptance and full owning checks, independently review and deliver through a protected PR.

## Task 3: Shift-day settings

**Files:** Shift backend/ACL/model registration hunks, shift contract/tests, ShiftSettingsForm/story/test, useHrShifts/useHrOwnIdentity, HR settings page and exact locale/manifest/mock hunks.

**Interfaces:** Produces GET/PATCH shift settings and company/user day-reference semantics consumed by personal schedules. Administrative personal-route removal waits for Task4's replacement route.

- [ ] Extract coherent final shift behavior without unrelated HR imports.
- [ ] Run owning model/HTTP, reactive/component and settings browser checks; deliver independently.

## Task 4: Employee self-service journeys

**Files:** Own HR/document/operations APIs and contracts, account/profile/schedule/assets/pay routes, personal settings, shared leave/request components, matching manifests/locales/stories/fixtures. Include useAiConversation/tests and the required useAiRun abort-after-JSON guard for logout safety.

**Interfaces:** Consumes shift settings; strict operations `purpose` changes travel with serializers and all consumers. Own-route declarations and navigation links move together.

- [ ] Extract shared-file hunks with explicit endpoint/contract parity.
- [ ] Retain required LeaveDecisionConfirm/RequestForm story-context updates.
- [ ] Run affected scratch/API, unit, type and browser journeys; independently review and deliver.

## Task 5: Shared navigation, attention and work

**Files:** Shared rail component/API and both applications' callers, launcher/work/home, provider types and manifests, per-app attention providers, identity-safe useAttention/tests, matching locale/story/catalog hunks.

**Interfaces:** Consumes self-service routes, HR pending-state constant and operations schemas. Includes generic assistant extension types/accessor and data-only story fixtures; concrete assistant sheet stays Task6.

- [ ] Extract rail API and both web/vendor callers together; preserve native endpoint filter contracts.
- [ ] Verify warm caches, company/user switches, stale responses, route/back/refresh, RTL and responsive behavior; review and deliver.

## Task 6: Assistant sheet and final references

**Files:** AI page/components/sheet, shell bindings/focus/sidebar state, AI helpers/tests/locale/stories, shared sheet CSS/frame API, remaining reference/catalog/product-document updates.

**Interfaces:** Consumes the shared conversation helper and generic assistant extension; sheet and full page retain one identity-safe run state.

- [ ] Extract the concrete assistant surface and shell lifecycle together.
- [ ] Run actual page/sheet/logout/focus/responsive tests, types/build and browser acceptance; regenerate catalogs from each actual intermediate tree.
- [ ] Review and deliver without unrelated feature changes.

## Task 7: Equivalence, history and retirement

- [ ] Verify every approved original source path/hunk is delivered; account explicitly for new delivery documents/generated reference positions.
- [ ] Reconcile current main into the preserved original branch using a normal merge after all semantic changes land. Retain original history through the final transparent history/delivery-record PR rather than rewriting it or manufacturing an ancestry-only merge.
- [ ] Require current-head gates and full post-merge main CI, then fast-forward a clean canonical checkout.
- [ ] Re-archive/hash-check ignored configuration and reports; verify complete source bundle and no active process uses a retiring worktree.
- [ ] Retire only owned worktrees/branches through the scoped project workflow. Close superseded PR35 only if the history-preserving reconciliation uses another reviewed PR.

## Acceptance evidence

Whole-candidate baseline: local combined Odoo1029, tooling1119/all six JS suites, web3369, production-artifact mock browser97 and policies/security passed. Whole-candidate GitHub CI also passed. These results do not establish any subset's acceptance; each task records its own immutable head and fresh evidence.
