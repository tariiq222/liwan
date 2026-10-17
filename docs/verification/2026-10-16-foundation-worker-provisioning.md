# Worker provisioning acceptance — 2026-10-16 (T2)

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

Local scratch evidence only. **Not deployment authorization, not production evidence.**

- Script: `tools/foundation_acceptance/provision_two_tenants.mjs` on branch `codex/tools-foundation-provision`
  (`bb9353df` add, `184cc953` hardening after review), based on `main` at `67902a05`.
- Command: `NASQ_IMAGE_TAG=67902a0 node --import tsx tools/foundation_acceptance/provision_two_tenants.mjs`
- Images: `nasq-odoo`, `nasq-web` (shared), `nasq-guard`, `nasq-accept-caddy`, tag `67902a0`. macOS Docker Desktop.

## What the run does

1. Starts db, odoo and web of a `nasq-shared-found<ts>` compose project with an empty registry.
2. Starts the control-plane API and `worker:shared` on loopback with per-run keys and the scratch
   control database `nasq_control_scratch_foundation`.
3. Ensures the dev owner and signs in through the dev-only loopback route (`ADMIN_DEV_LOGIN_EMAIL`), with
   `dev-step-up` before every privileged request.
4. Imports, validates and publishes the catalog through the admin CLI and API (no direct SQL).
5. Creates tenants A and B with signed `POST /v1/shared/tenants`; the real worker runs
   `odoo_effect` (install, policy, password, admin) until `active`.
6. Logs in each tenant admin through the edge with the worker-written credentials, checks `/api/v1/me`
   and company name, and checks each session cookie is rejected on the other host.
7. Tears down the project, volumes, networks, control database and processes.

## Final run (fresh, after the hardening commit)

`22/22 passed in 145s`, exit 0. Tenant A active in 49s, tenant B in 55s. Both admins logged in (200),
`/api/v1/me` login and company matched, cross-tenant cookies rejected both ways with
`403 tenant_boundary_rejected`, no container, process or control database left, ports 443/80/4731 free.
The implementer also exercised `--keep` then `--down`, and Ctrl-C during provisioning (exit 130, full teardown).

Review: one reviewer pass plus Jev (advisory, all dimensions 7.0–8.8). Its findings (step-up freshness,
signal teardown, pointer validation, weak assertions, secret redaction, env allow-list, tsx launch) are fixed in `184cc953`.

## Product findings reported at the historical source

1. **Guard cannot start with an empty tenant registry.** `apps/web/server/utils/tenantRegistry.ts:7` rejects
   `snapshotRevision < 1` and an empty `targets` list, and guard reads it on every request. A fresh shared
   deployment therefore crash-loops guard until the first onboarding publishes its disabled binding. The script
   starts guard/proxy after that publication. That workaround does not prove successful empty-registry
   bootstrap; the current registry contract needs its own fresh check.
2. **`@nasq/commercial-contracts` exports TypeScript sources**, so Node tools that import its server helpers
   must run under `tsx`.

## Not covered

Invitation flow for the first admin (`POST /v1/invitations/accept`), entitlement-based app denial (403),
backup/restore of these tenants (T4), fault injection, Linux hosts.
