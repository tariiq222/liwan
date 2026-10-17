# Shared live acceptance rerun — 2026-10-16 (T1)

> Historical evidence imported on 2026-10-17 from documentation commit
> `ad0bed8144ec599e2be3f3c0c5b91f957552f9d9`. The runs below concern source
> `67902a053821ea4895047c804015addcc2e4f15a` and the explicitly named tool
> commits, before the WebVue source/name reconciliation. They were not rerun
> for current WebVue. Results, old NASQ names, commands and source paths are
> retained as historical identifiers, not current operating instructions.
> Tool source is preserved in Git at `002fee8c7a08a63bc4077f9f107819169ef91aa6`;
> The original seven-file implementation is not imported. Current tools are a
> narrower provisioning-only adaptation with separate, fresh evidence requirements.
> This record does not establish current acceptance, merge, deployment or release approval.

Local scratch evidence for the two-tenant shared edge only. **Not deployment authorization, not production evidence.**

- Source: `main` at `67902a05`, images built from `/Users/tariq/code/nasq` and tagged `67902a0`
  (`nasq-odoo`, `nasq-web` with `NASQ_TENANCY_MODE=shared`, `nasq-guard`, `nasq-accept-caddy` with `http.handlers.rate_limit`).
- Harness: `tools/shared_acceptance_live/` unchanged (`up.sh`, `probe.mjs`, `proof8.spec.mjs`, `down.sh`).
  Tenants are seeded by `seed_tenant.py`, not by the control-plane worker.
- Stack torn down with `down.sh` after the run; no container of the project remains.

## Results

| Proof | Result |
|---|---|
| 1 TLS chain + SAN (A, B) | PASS |
| 2 host data isolation (`/api/v1/me`, projects, HR) | PASS |
| 3 private headers from outside → 403 | PASS (2 headers) |
| 4 only `127.0.0.1:443/80` published | PASS |
| 5 session cookie flags | PASS |
| 6 cross-tenant cookie → 403 `tenant_boundary_rejected` | PASS |
| 7 unknown host fail-closed | PASS |
| 7b disabled host fail-closed without restart, then restored | PASS |
| 8 real browser, Arabic UI, logout | **FAIL as written**; PASS on `/projects` and `/hr` (see below) |
| 9 auth rate limit → 429 | PASS |

`probe.mjs --skip-rate-limit`: 11/11 PASS. `probe.mjs --rate-limit-only`: 1/1 PASS.

## Findings reported at the historical source

1. **Proof 8 expectation is stale.** It requires the tenant's project name on `/`. Since the
   home redesign `/` is a workspace launcher that lists no projects, so the assertion times out
   for both tenants. No cross-tenant leak was observed on `/`. A temporary copy that checks only
   `/projects` and `/hr` passed for both tenants (login, own data visible, other tenant absent,
   logout 204, `/projects` after logout redirects to `/login`). This records the old spec failure; current proof 8 needs its own fresh run by the
   owner of `tools/shared_acceptance_live/`.
2. **README image names drift.** `tools/shared_acceptance_live/README.md` says all images are
   `nasq-accept-<name>`; `up.sh` and the compose files use `nasq-odoo`, `nasq-web`, `nasq-guard`
   and only `nasq-accept-caddy`. The first `up.sh` attempt failed on the missing `nasq-odoo` tag.
3. **`/web/session/get_session_info` returns 403 through the shared edge.** `apps/web/app/composables/useBus.ts:164`
   calls it on every page to read `websocket_worker_version`; guard rejects it, the browser logs a
   console error, and the bus falls back to its default version. Whether live updates still
   work in shared mode was not tested here.
4. **Stale stack on the host.** Containers and networks named `nasq-saas-commercial-acceptance-*`
   from the removed harness are still present; `...-guard-1` is in a restart loop. Not touched.

## Not covered

Provisioning through the control-plane worker, backup/restore of these tenants, worker or
database fault injection, and the commercial journey (plan T2–T4).
