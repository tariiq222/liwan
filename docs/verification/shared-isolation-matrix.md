# Shared SaaS gate — package 2: AC-01/02 ten-tenant isolation matrix

> Historical checkpoint: the commands, results, branch and unmerged status below
> describe the execution stage recorded here. Shared packages 1–7 were subsequently
> integrated into `main` through `7ffee66e` and `3fd76c38`. For the consolidated
> implementation status and remaining release gates, see [current hosting status](../project-closure/saas-hosting-direction-status.md).
> This annotation does not rerun tests or broaden the original evidence.

**Status:** completed for its scope. This closes the routing/session isolation
layer evidence (AC-01 and the routing/session surfaces of AC-02) against the
REAL guard edge and the REAL built shared-mode Nuxt server, over ten synthetic
tenant identities matching the authorized scratch databases. It is NOT real
Odoo/ACL evidence, NOT TLS/Caddy, NOT the physical fenced adapter, and NOT a
deployment authorization. Execution branch: `codex/shared-isolation`
(uncommitted working tree on top of `d780862e`). No commit/merge/push/deploy.

## New evidence: integrated isolation matrix

New file `tools/shared_isolation_acceptance/isolation-matrix.test.mjs`.
Topology is the real production chain minus TLS/Caddy and with a synthetic
tenant-aware upstream instead of Odoo:

```
client → real guard (deploy/shared/guard.mjs) → built Nuxt (.output, shared mode)
                                            ↘ Odoo hop (guard internal) → synthetic upstream
```

- The guard runs the real `createGuard` with the 10-tenant registry file; Nuxt
  is the real built server spawned with `NASQ_TENANCY_MODE=shared`,
  `NUXT_ODOO_URL` pointing at the guard (the internal hop), and the
  `t17-ssr-probe` outbound restriction (Nuxt may only connect to the guard).
- Tenants: hosts `t01..t10.isolation-matrix.invalid`, databases
  `nasq_shared_scratch_sharedgate20260928_t01..t10` (the authorized scratch
  databases; remain empty — the upstream is marker-based synthetic data).
- Sessions use the real per-tenant sealed envelope (`sessionCodec`: HMAC over
  tenantId + registryRevision + expiry), obtained through the real full login
  chain per tenant (client → guard → Nuxt BFF → guard internal → upstream),
  not hand-crafted.

## Matrix coverage (all fresh, single run, then a confirmation rerun)

| Phase | Check | Result |
| --- | --- | --- |
| 1 | 10/10 full-chain logins produce per-tenant sealed cookies (HttpOnly/Secure/SameSite=Lax) | ✔ |
| 2 | Positive controls: own session → own identity (API) + own project in SSR markup; zero foreign markers in any of the 10 rendered pages; proxy token never in HTML | ✔ |
| 3 | **90 directional A→B session crossings on /api/v1/me**: every one 403 `tenant_boundary_rejected`, dispatched-upstream count unchanged | ✔ |
| 4 | **90 directional A→B crossings on /search (SSR/web hop)**: every one 403 before Nuxt; upstream count unchanged | ✔ |
| 5 | **90+90 object-id crossings** (A's project/content id on B's host with B's own valid session): 404, no marker leak; 10/10 own objects still resolve | ✔ |
| 6 | Unknown host (API + SSR), forged `x-odoo-database`/`x-openerp-session-id`/`x-forwarded-host`/`forwarded`/`x-nasq-proxy-token`, direct-to-Nuxt bypass without guard headers (403), stale internal revision binding | ✔ |
| 7 | WebSocket: own-tenant upgrade + echo; foreign-cookie handshake and foreign-origin handshake both 403 | ✔ |
| 8 | Registry `.pending` publication barrier: all requests fail closed; removal recovers | ✔ |
| 9 | Fresh single-target disable (t05): that tenant 403 while t06 stays 200; re-enable restores | ✔ |
| Audit | All 414 upstream dispatches: zero foreign sessions, zero trusted-header (x-nasq-*) leaks to the upstream | ✔ |

## Commands

```sh
node --experimental-strip-types --test tools/shared_isolation_acceptance/isolation-matrix.test.mjs
# ✔ pass 1 fail 0 (~31s) — run twice; identical result both times
node --experimental-strip-types --test tools/shared_isolation_acceptance/operational-ssr.test.mjs
# ✔ pass 1 fail 0 (~19s) — regression check after the matrix addition
```

No leftover processes or listening ports after the runs.

## Relationship to AC-01/AC-02

- **AC-01 (unknown/forged/ambiguous host):** covered at the real HTTP edge —
  unknown hosts, forged routing headers, direct Nuxt bypass, stale internal
  binding, and the publication barrier all fail closed with no DB selection
  and no metadata leak.
- **AC-02 (90 A→B pairs per surface):** covered for the HTTP surfaces the
  edge owns — API identity, SSR/web, `/web/content` object ids, project object
  ids, sessions/cookies, WebSocket handshakes. Browser-level hydration for the
  A→B→A journey was already proven separately in
  `operational-ssr.test.mjs` (2 tenants, synthetic network interception).

## Explicit remaining boundaries

- **Real Odoo ACLs are not proven.** The upstream is synthetic marker data;
  the ten scratch databases remain empty. "Actual ACL enforcement" and
  MFA/real-session semantics inside Odoo need a later gate running real Odoo
  against these databases (separate authorization, per the plan).
- **TLS/Caddy and network-bypass drills** (real edge proxy, certificate
  handling, direct-to-Odoo port isolation) are not covered; the guard here is
  reached over loopback HTTP.
- **Object-id crossing at the Odoo data layer** (attachment records, company
  scoping) is simulated by the mock's 404s, not by real record rules.
- **Physical fenced adapter, backup/restore crossing, billing sandbox:** not
  in scope (packages 3–6).
