# t5 integration evidence — bounded foundation, not runtime isolation acceptance

Working copy: `/Users/tariq/code/nasq-shared-isolation`, `codex/shared-isolation`.
Attempt 2 inherited and reconciled baseline's partial edits; no Git integration,
commit, deployment, Docker build/up/pull, live SQL migration or Odoo execution.

## Integrated result

- Explicit `deploy/docker-compose.shared.yml` opt-in; base Compose and dedicated
  Caddy unchanged. Offline rendered-config tests use only synthetic environment
  values and `/dev/null` env-file. Only proxy publishes 80/443; all four backend
  services have reset empty ports. Edge shares no network with Odoo/web; web and
  Odoo have disjoint internal networks joined by guard. This is configuration
  proof, **not** measured network reachability or protection from a privileged host.
- Shared Odoo replaces inherited command including `--proxy-mode`, uses no CLI
  overrides, and mounts t9's validating launcher before the preserved secure
  `nasq-odoo` entrypoint. Full external secret config is mandatory via
  `NASQ_SHARED_ODOO_CONFIG`; the committed template is NOT a usable credentials
  source. The custom image does not interpret HOST/USER/PASSWORD env values.
- Registry mounts use `NASQ_TENANT_REGISTRY_DIR:/etc/nasq:ro`, not single inode
  mounts. Both readers access `/etc/nasq/registry.json` fresh. Atomic rename test
  verifies next request rejects disabled target and stale envelope after re-enable.
  This tests filesystem readers, not an actual Docker mount or durable publisher.
- Guard packaging, shared Caddy four rate-limit zones and Odoo validator are
  routing-owned t8/t9 dependencies. Guard image runtime and Caddy parsing NOT RUN.
  TCP healthchecks are liveness only: they do not prove registry/upstream readiness.
- Nuxt Docker build ARG defaults to dedicated; shared overlay passes shared during
  compilation AND runtime. Shared compile omits only the seven existing proxy rules,
  removes dev WS bypass and uses same-origin WS/empty fallback DB. Future non-proxy
  route rules belong outside the conditional spread. Config evaluation tested.
  **Build/runtime mode mismatch is a residual security/deployment blocker, not
  dynamically blocked in a prebuilt dedicated image**: compiled dedicated proxy
  rules may survive runtime `NASQ_TENANCY_MODE=shared`; deployment must rebuild
  with shared argument. The config test reproduces the premise: dedicated compile
  has seven proxy rules while shared compile has none. It is not a built-image
  exploit test or a runtime mismatch guard. No full
  built-Nuxt SSR proof is claimed; this is a remaining acceptance blocker.
- Package `@nasq/commercial-contracts/shared` exported and t3 imports reconciled.
  Root barrel exports schemas only; Node hashing/planner remain server-side.
- Shared control-plane execution is explicitly dormant: shared/invalid mode rejects
  target resolution and enqueue, returns no available actions, does not claim
  dedicated queue, and quarantines a previously claimed job before adapter calls.
  Existing dedicated enqueue does not reference business_key, preserving old DB
  compatibility. Do not enable shared through legacy scratch/Compose inventories.
- Forward migration 004 adds nullable business_key with partial unique
  `(tenant_id,business_key)` index; no backfill or guessed identity. Registered in
  db.ts under existing transaction/advisory migration lock. Restored schema.sql to
  historical contents; version 004 alone owns new SQL. Tests exercise migration
  order, already-applied case and rollback. No actual SQL execution evidence.

## Fresh verification

| Command | Result | Boundary |
|---|---|---|
| `npm -w apps/control-plane test` | 187 passed; service.test.ts skipped | Includes 12 new integration tests; no live DB service suite |
| `npm -w apps/web test` after t10 | 902 passed / 134 files | Existing dedicated regression preserved |
| `npm -w apps/control-plane run build` | exit 0 | TypeScript only |
| `npm -w packages/commercial-contracts test` | 4 passed | Commercial schemas |
| `npm -w packages/commercial-contracts run build` | exit 0 | TypeScript only |
| `npm -w apps/web run lint` | exit 0 | vue-tsc |
| `node --test deploy/shared/guard.test.mjs deploy/shared/package.test.mjs` | 9 passed | Native Node24 mock HTTP/WS + static packaging |
| `git diff --check` | exit 0 | Whitespace validation |

First broad web regression run: 898 passed / 1 failed (vendor-outage dedicated
proxy call gained empty third headers argument in t2). Reported to captain for
routing-owned t10; do not classify this as a pre-existing baseline failure.
After routing t10 fixed dedicated two-argument proxy behavior without altering
vendor-outage.test.ts, final full rerun passed 902 tests / 134 files; log retained
at `/tmp/nasq-t5-web-final.log`. Full combined CP/lint/type gates also passed.
Final launcher review caught its required `NASQ_TENANCY_MODE=shared` precondition;
added Odoo service environment and reran rendered topology 3/3 plus diff check.

RED/GREEN: dormant tests first 4 failed then 4 passed; migration tests first
2 failed/1 passed then 3 passed. Registry refresh was initially written with
Node test runner and passed native invocation, but Vitest discovery rejected it;
converted to Vitest and final broad control-plane suite is green. No tests removed.

## Remaining gates / dormant functionality

1. No authenticated atomic registry+audit publisher, durable tenant tombstones or
   cross-resource allocation store. No fenced shared adapter or enqueue-to-effect
   wiring. UNIQUE business_key prepares schema but does not close these gaps.
2. Shared database===filestore enforced by runtime registry; general t3 schemas
   still permit distinct values. Shared CP refuses *all* execution, so does not
   assert a selectively executable path is safe. Future adapter needs explicit
   equality check before effects and authoritative source binding verification.
3. Restore requires exact registry revision: host/enabled changes block old backup
   replay. This is a safe day-2 limitation requiring a later authorized recovery
   contract, not a reason to omit identity/revision checks.
4. No Docker image startup, Caddy config parsing with plugin, container network
   negative test, real Odoo multi-DB/no-DB test, DB migration test, live backup,
   built Nuxt SSR header/cookie/origin/redirect proof. TLS/Secure-cookie/Host are
   configured and mock-tested, not demonstrated end-to-end on real Odoo.
5. No release approval. t6 verification and independent t7 review remain required.

## Self-check (not independent review)

Accuracy 4/5: fresh executable checks with runtime boundaries explicit.
Completeness 4/5: bounded integration done; live and built SSR proof deferred.
Clarity 4/5: configuration vs execution evidence separated.
Actionability 4/5: concrete gates and env/mount contracts supplied.
Conciseness 4/5: necessary detail across topology and queue boundaries.
Overall 4.0/5; highest-value next actions are independent review and explicitly
approved isolated runtime verification, not enabling shared provisioning.
