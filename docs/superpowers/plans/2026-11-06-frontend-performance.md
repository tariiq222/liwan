# Frontend performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** implement the full audited frontend/BFF improvements and protected merge.
**Architecture:** independent data/realtime, bootstrap/rendering, and BFF packages on origin/main. One coordinator owns integration; native workers authorized explicitly.
**Tech Stack:** existing Nuxt4, Vue3, TanStack Vue Query5, H3, Odoo19.
**Spec:** docs/superpowers/specs/2026-11-06-frontend-performance-design.md

## Global Constraints
No paid API or dependency upgrades. Preserve authorization, company/tenant/session boundaries, approvals, drafts, filters, history and RTL/accessibility. Node24.15.0, independent dependencies/generated outputs, test_slot for heavy checks. No development DB tests. Owner alone authorizes overlap already recorded. Coordinator owns commits/integration/publication; user explicitly requested merge, normal PR/CI only.

## Review Focus
- Role revoked or tenant disabled during a queued request must still refuse.
- Failed next-page loads and failed writes must settle without retry storms or stale rollback.
- Rapid search/navigation and parallel edits must retain latest intended rows.
- Hidden/background to foreground and socket loss/recovery must reconcile missed durable events.
- SSR, hydration, viewport resize and keyboard controls must remain consistent.

### Task 1: data and realtime
**Files:** apps/web/app/composables except useApi.ts/useMe.ts; components/chat; components/inbox/InboxThread.vue; components/pmo/tasks/TaskBoard.vue; focused tests in owned directories.
**Interfaces:** existing query keys and useApi signal; do not change API envelopes; retry owner supplied by Task2.
- [ ] Reproduce board loop, typing invalidation, repeated read acknowledgment, broad history replay and optimistic concurrency with behavioral tests; run RED.
- [ ] Implement targeted invalidation, safe rollback, cancellation and response-seeded mutation caches; consolidate polling while preserving recovery; run GREEN focused tests.
- [ ] Record remaining history profiling needs and exact changed files; no worker commit.

### Task 2: bootstrap and rendering
**Files:** plugins, middleware, lib, app.vue; useApi.ts/useMe.ts; NotificationCenter; operations/RequestList; CRM list; dashboard adapters; packages/ui; focused tests.
**Interfaces:** retain $api signal support and ApiError shape; changes to retry defaults classified centrally; data worker does not modify useApi/useMe.
- [ ] RED request-count/SSR/hydration tests using installed libraries for retry classes, public identity, closed bell, initial hydration and list HTML.
- [ ] Implement noncritical query scheduling, one retry owner, safe identity reuse, render content on SSR and reduce duplicate responsive representation; GREEN focused checks.
- [ ] Profile chart initialization and responsive DOM; implement only demonstrated improvements without new dependencies; report measured/unmeasured evidence.

### Task 3: BFF
**Files:** server/utils/{apiSessionAdmission,tenantRequest,tenantRegistry,tenantTransport,customer-commercial}.ts; routes/api/v1/[...path].ts; api/invitations; utils/__tests__.
**Interfaces:** API status/cookies preserved, no result cache across calls; immutable request binding with fresh dispatch publication checks.
- [ ] RED wire tests cold me request count, identity differences, concurrent callers, registry publication mutation, chunked/stalled bodies and unavailable principal.
- [ ] Implement reused admission identity response, bounded bodies and transient status, request snapshot optimization preserving publication fences; GREEN scoped tests.

### Task 4: remaining measured opportunities
**Files:** decide from Task1-3 evidence; finance aggregate backend/contracts/frontend requires Odoo-workflow first, separate exact ownership.
- [ ] Record baseline production build and isolated browser request counts/load/interaction samples.
- [ ] Resolve finance KPI request fanout and long-history/chart candidates against evidence, test and implement supported improvements; document any real blocker rather than claim completion.

### Task 4b: remaining list SSR consistency
**Files:** pages/tasks.vue, pages/projects/index.vue, operations/ProcessList.vue, crm/imports/CrmImportBatchList.vue, project catalogs page; TaskTable/ProjectTable/ProjectCardBody clock-relative badges only; useTaskFilters deferred storage initialization; exact focused SSR/template tests.
**Interfaces:** preserve hidden-KPI/local preference policy, disabled controls and API/query contracts. PMO coordinator approved isolated presentation-only overlap; preserve its unmerged tools/nullability work.
- [ ] Reproduce missing SSR content and local-storage/clock mismatch, then render static table/card content with hydration-safe controls and date placeholders.
- [ ] Verify allowed/empty/error/refused states, stored preferences and URL precedence, and board-only fallback; preserve sibling presentation logic.

### Task 5: independent review and protected delivery
- [ ] Coordinator reviews each actual patch and re-runs focused integrated checks; reconcile sibling work without merging unrelated branches.
- [ ] Independent whole diff review, fixes, combined npm test/type/static checks and isolated browser acceptance.
- [ ] Commit logical changes; authorized push and draft PR, mark ready after preparation; inspect current-head CI and protection.
- [ ] Normal protected merge only after current-head ci-result green, verify merge SHA/postmerge CI. Preserve checkout dirt and all worktrees.
