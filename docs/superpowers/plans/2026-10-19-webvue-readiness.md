# WebVue readiness implementation plan

Goal: execute the four approved readiness packages, with local evidence and no commit, merge or production activation.
Architecture: reuse existing release assets/runtime/quiescent backup and shared job authority. Customer runtime must remain independent of the control plane. One coordinator owns all shared changes.
Spec: the owner's approved four-package plan in this conversation, 2026-10-19.

## Constraints
- Existing docs-oca-dms worktree; preserve all pre-existing dirty files. HEAD dc39a8eb. main is 17 commits ahead; security/finance integration is a separate pending gate, not silently imported.
- Preserve the user preview8380. Test on separate webvue_scratch_* databases, ports and owned runtimes only.
- Keep canonical actor/company permissions, revision conflict, revoke and quota concurrency regressions.
- No source changes to Odoo/OCA; no paid external judge or source upload. Sol6.1 only. No commit/merge/deploy/cleanup of user data.
- Baseline measurement begins after initial inspection; whole-task token attribution remains incomplete.

## Review focus
- A stale source/image/evidence receipt must never become launch acceptance.
- A bundle build/change must not corrupt a running release or old hashed assets.
- Wrong-tenant/revoked actor/replayed restore requests must not publish a route.
- Failure after dump or publication must preserve evidence and keep fail-closed state.
- Load samples must include failures/timeouts and cannot mask untested tenants or phases.

## Tasks
1. Baseline and readiness: freeze tracked/untracked source; implement a source-bound acceptance matrix with strict scenario results and evidence hashes. Historical E04/E09 remain historical. Fresh acceptance requires current receipts; update consolidated status without claiming complete commercial provider acceptance.
2. Release bundle: prepare completed Nitro outputs as an independent immutable release bundle; reuse append-only assets. Add operator CLI prepare/verify, safe internal symlink normalization, missing/tampered artifact rejection and original-source independence tests. Prove via actual candidate frontend on a separate port, no rebuild of8380.
3. Restore operations: implement durable tenant-scoped publication requests through authenticated control API; worker alone performs physical observation and publishes using current authorization. Wire operation progress/vendor controls through existing API/BFF patterns. Add fresh migration, idempotency/revocation/cross-tenant/receipt failure tests. Bind shared backup to the quiescent release adapter; never silently fall back to whole-service stop. Exercise real scratch dump/filestore restore and other-tenant continuity where supported.
4. Capacity: create a bounded repeatable HTTP journey runner (BFF + Odoo) recording all attempts, percentiles, rates and source/runtime identities; seed only disposable own databases and use ordinary actors. Run graduated volume/concurrency and sustained observations with resource evidence. Publish supported operating envelope and retain failures. Do not call an absent 100-tenant run passed.
5. Integrated verification: focused RED/GREEN per package; relevant broad suites once after integrated diff. One fresh Sol6.1 reviewer. Fix important findings RED/GREEN, record rulings and residual gates. Final state remains local candidate, no release approval inferred.

Execution: inline; tasks2/3 share release runtime and authority (sequential), task4 depends on matched stable candidate, task1 evidence is finalized after5. No implementation workers; one final independent reviewer.
