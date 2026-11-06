# Frontend performance remediation design

Owner request 2026-11-06: implement the complete frontend/BFF audit improvements and merge after verification. Owner explicitly chose native Codex workers instead of paid OpenCode and authorized isolated overlap with web-list-keep-results, preserving its work.

## Intent and constraints
Reduce unnecessary requests and serial waiting while preserving authorization, tenant/company/session isolation, list/filter semantics, server-confirmed approvals, drafts, history access, RTL/accessibility and SSR consistency. Existing Nuxt4/VueQuery5 stack stays. No paid API, dependency upgrades, production deployment, unrelated branch integration or cleanup. Baseline origin/main c7e4a3e9bfbf1816da27a71301a1369cb3a86eff; recheck before delivery.

## Required outcomes
- Board next-page failure settles until deliberate retry; optimistic rollback cannot revert another successful row.
- Typing never refetches durable chat; read acknowledgments coalesce monotonically; durable chat/inbox events invalidate only affected data. One bounded fallback/reconciliation owner, no overlapping polls; preserve missed-event recovery and hidden-tab catchup.
- Scoped invalidation and response-seeded detail caches; preserve list membership/order/count correctness. QueryFns propagate cancellation and snapshot query keys across sampled domain applications. Notification invalidation happens once.
- One classified retry budget; no deterministic-error retry or automatic write retry. Public token pages do not require private identity. Noncritical bell preview does not block SSR. Preserve authoritative navigation checks; reuse already resolved SSR identity during hydration without granting stale capabilities.
- Render server list content while disabling first-click controls; reduce duplicate responsive DOM without hydration/resize/accessibility regression. Profile long inbox DOM and chart initialization before introducing viewport windows or lazy initialization; preserve full history and scroll anchors.
- BFF cold requested me reuses its verified response, without caching capabilities for later calls. Avoid repeated whole-registry parsing within a request while preserving dispatch-time pending/disable/revision checks. Small invitation/commercial bodies use bounded readers; transport failures retain transient status instead of401.
- Finance KPI fanout: measure representative path, then use a properly authorized aggregate endpoint if beneficial; do not return false counts from client-only loaded pages.

## Acceptance
Behavioral regression tests with RED/GREEN evidence for loops, request counts, cancellation, concurrent mutations, hidden SSR dependencies, retry classes, identity isolation, tenant publication and bounded chunked bodies. Focused worker checks only; coordinator combined npm test, typechecks of both consumers when UI changes, static policies, production build and isolated browser request-count/interaction journeys. Inspect live rules/current-head ci-result, protected PR merge, postmerge CI. No timing/percent claim without comparable measurements.

## Audit evidence
Source audit and findings: /Users/tariq/Documents/Codex/2026-11-06/webvue-frontend-audit/AUDIT.ar.md with underlying five reports and independent-review.md. Every finding must be fixed, profiled and resolved, or explicitly reported blocked; do not silently drop a candidate or claim all complete.

## Evidence-driven implementation decisions
- Task writes reuse the existing updated_at fact at microsecond precision; write-source notification metadata unions changed field names without values. Comments/mixed events stay conservative. Local acknowledgements are bounded/consumed and identity-bound; no timestamp-only cache-hit suppression.
- Registry snapshots share one weakly held immutable index only after fresh path/stat/publication checks. No authorization TTL; per-request tenant binding remains immutable. Synthetic 2000-target retained-event probes exposed and removed per-request index duplication; no production capacity/percentage claim.
- Inbox history remains fully accessible/retained. Native support-gated offscreen rendering was chosen over a new virtualizer/retention cap, with quote/newest two-frame alignment, reduced motion, print visibility, focus-ring margin and disposal guards verified in a headless DOM matrix. DOM count still grows with loaded history; no bounded-memory claim.
- Whole-list hydration gates are removed for table/list surfaces after stable SSR settlement; draggable board may retain its own hydration placeholder. Only clock-relative badges/tones stay deferred, controls remain disabled until hydration, and local filter persistence uses deferred initialization without overwriting saved preferences. Hidden-KPI policy remains unchanged.
- Latest origin/main7020958dc contains the approved list-placeholder and rail changes. They must be merged into the candidate and preserved before final checks.
- Initial web typecheck hit the documented default4GB Node heap limit; final checks use NODE_OPTIONS=--max-old-space-size=6144 with Node24.15.0. No production memory setting changes.
