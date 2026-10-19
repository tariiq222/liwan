# OCA DMS scalability implementation

> Execute inline with executing-plans; no commits, merges or deployments.

**Goal:** Resolve the four audited scaling limits without changing canonical document permissions, revision conflict handling, original-actor checks or storage quota ownership.
**Architecture:** SQL permission subqueries; shared policy locks for independent document mutations with exclusive document locks and exclusive quota locks on uploads; paginated remote selectors and file API.
**Tech:** Odoo 19, PostgreSQL REPEATABLE READ, pinned unmodified OCA DMS, Nuxt/Vue Query, Zod.
**Spec:** User authorization in this conversation, four findings recorded below. Preserve all current dirty work in docs-oca-dms.

## Global constraints
No customer sudo, native private access overrides, copied OCA code, byte duplication, quota bypass, commit or merge. Only new isolated scratch data for loads/tests. Preserve preview records. Default shared-lock parameters remain exclusive for existing callers. Measure real before/after under identical fixtures and concurrency; local results are not production capacity.

## Context Brief
| Source | Current behavior / implication |
| --- | --- |
| document.py:122 | Materializes all company document IDs for rules; replace with SQL predicate. |
| document.py:365 | Company/fence/document/profile exclusive locks serialize unrelated metadata. |
| core/access_service.py:300 | Same advisory lock protects role/admin changes; keep exclusive default. |
| document_policy.py:49 | UPDATE MVCC fence must invalidate old RR snapshots. |
| platform/tenant_profile.py:216 | Exclusive quota/policy lock; shared only for non-storage document mutations. |
| document_file.py:39 | Upload must acquire exclusive profile lock before attachment quota claim. |
| serializers/document.py:161 | Unbounded detail files; remove embedded files and add bounded collection. |
| controllers/common.py:32 | Existing pagination defaults 50, cap 200, validates offset. Reuse. |
| useDocuments.ts:104 | Fixed first 200 selector choices; replace with query/page-aware lookup. |
| Odoo orm/domains.py:995,1527 | Domains accept SQL/Query operands; keep predicates inside DB. |

## Task 1: Baseline and regression tests
Freeze current source; scratch-only HTTP benchmark at 100/1000 documents, 250 files, concurrency 1/4/8; record p50/p95, throughput/statuses and fixture/configuration. Add failing independent-document concurrency test, feature-revoke stale-snapshot test, bounded file API tests and remote selection regressions. Expected: independent writes and bounded file API fail before implementation; existing same-document, grants/roles and competing-upload tests remain.

## Task 2: Policy predicates and lock scope
Replace all owned `_webvue_accessible_ids` references with SQL subquery; retain operation/company/archive/grant policy. Shared company advisory and policy row locks for document mutations; shared tenant profile for non-storage mutations, exclusive for upload. Defaults on core/platform remain exclusive. No shared-to-exclusive upload upgrade. Test independent writes, stale same-row revision, role/grant/feature revocation and quota race. Expected all focused Odoo tests green.

## Task 3: Bounded files contract
Detail consists of summary + body; GET /documents/:id/files returns {items,total}, default 50 cap 200, same native/canonical permissions/archive behavior. Mutations return complete new detail. Add company/document/page cache keys and invalidate files on mutations; UI pagination/loading/error/empty states; preserve revision409 handling. Update contracts, fixtures, acceptance harness and stories together. Expected contract/web tests and real API >200-file traversal green.

## Task 4: Remote metadata selection
Search + pagination for contexts/tags, preserve selected values outside current page; cache by company/kind/search/page and cancel old requests. Use existing UI primitives with accessible loading/error/next page. Preserve read-only/hydration behavior. Tests >200 options, selected values, kind/company change and query reset.

## Task 5: Integrated acceptance and load comparison
Rerun benchmark against changed source and identical seed/resources. Verify Odoo security/concurrency/quota, API/contracts/UI, lint/build/typechecks as affected. Fresh Sol 6.1 reviewer checks actual incremental source versus frozen baseline. Record evidence and material limits in docs/verification/oca-dms/scalability.md. No integration action.

## Review Focus
SQL domain cache behavior, native attachment/file/directory paths, archived restrictions, current company, policy changes across RR snapshots, mixed mutation lock order, quota uploads, duplicate file pages, selected values outside lookup pages, stale responses after company change, 409 invalidation, honest load status accounting and scratch cleanup.
