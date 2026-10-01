# Real shared SaaS first-tenant acceptance — 2026-10-01

Scope: local Docker only, on uncommitted `codex/saas-real-lifecycle`, based on
`3899a095a3e6f608c90697faaead0b371ecbc9a3`. Worktree:
`/Users/tariq/.codex/worktrees/saas-real-lifecycle/nasq`.
Canonical `main` remains unchanged and clean. No commit, merge, push or deployment.
This record supplements the historical [shared acceptance](shared-live-acceptance.md);
its earlier 9/9 and F2b/F5 results were not rerun or relabeled as fresh evidence.

## Intended milestone and implementation

The vendor UI creates an idempotent shared onboarding request with catalog tier
and administrator identity. The opt-in worker creates a real scratch Odoo DB,
installs catalog-selected modules, applies policy, resets the default password,
assigns the administrator and independently reads modules/policy/company/access
and authenticates against steady Odoo. Only then does registry activation occur.
The UI displays progress and a customer login link after verified activation.

The existing dedicated form/worker and reference adapter remain available.
Credentials are operator-private files; delivery of an invitation/password to a
real customer is not implemented by this local milestone. Backup and restore are
not implemented by the new physical adapter. It refuses those operations.

## Isolated environment

- Project: `nasq-saas-life-1790879392`.
- Separate customer, vendor and control PostgreSQL services and volumes.
- Vendor fixture DB: `nasq_vendor_scratch`; synthetic administrator UID 5.
- Control operation DB: `nasq_control_scratch_lifecycle`.
- Unit/live-SQL test DB: `nasq_control_scratch_lifecycletests`, separate from jobs.
- Customer database query was empty before any worker submission; no customer DB
  or user was seeded directly. Each browser attempt created a new scratch tenant.
- Loopback ports 80/443 and control-test port 55447; wildcard local TLS and browser
  resolver. Existing PMO acceptance stack and `odoo19` were not used or changed.
- Docker address-pool exhaustion was resolved by allocating explicitly owned,
  non-overlapping networks; no existing network/volume was removed.
- Guard startup retries while the empty bootstrap registry is rejected. First
  disabled binding makes registry configuration valid without opening a route.

Runtime recipe and retained evidence layout:
[`tools/shared_saas_lifecycle/README.md`](../../tools/shared_saas_lifecycle/README.md).
All `.state/` credentials/evidence are ignored by Git and Docker contexts.

## Fresh code verification

- Control-plane TypeScript typecheck: passed.
- Control-plane tests on isolated live PostgreSQL: **409/409**, 34 files,
  including new onboarding SQL tests and existing queue/restore/payment tests.
  Existing marker-based tests do not prove real backup/restore/provider operation.
- Commercial contract tests: **4/4**.
- Focused web vendor tests: **25/25**, 4 files.
- Web `vue-tsc --build --noEmit`: passed.
- Python physical-boundary tests: **4/4**; harness syntax validation passed.
- Both shared and dedicated Nuxt Docker image builds passed.
- Secret guard, static UI policy and UI inventory checks passed.
- Independent static review found and verified fixes for activation revocation,
  policy field shape, stale readiness blocking other candidates, and concurrent
  activation/quarantine. Final review has no unresolved Important finding in scope.

## Browser and fault evidence

The final complete Playwright run passed **1/1** in 53.2 seconds at
`2026-10-01T19:04:58.817Z`. It used the real vendor form, observed the ready
link, logged in with the generated customer administrator, created project
`1` and task `2`, uploaded attachment `34`, downloaded it and
verified the same bytes after page refresh. Vendor detail was checked at desktop
and 390px mobile width after responsive layout settled.

- Tenant: `7ae8f8c0-e802-4ede-8966-9201b644ce90`.
- Job: `63d86e5b-4aef-4d1e-8510-ed5ec40ccde7` (durable `verified`; onboarding/tenant `active`).
- Customer DB: `nasq_scratch_7ae8f8c0e8024ede89669201b644ce90`.
- Real installed Nasq modules: `nasq_api`, `nasq_core`, `nasq_platform`, `nasq_pmo`.
- Real profile: `saas`, policy revision `1`; generated administrator UID `2`.
- Attachment: 62 bytes; SHA-256
  `5109ad92495bcd15043b3aae5cebd7e459aecf6178b210c46aa9a7676fb22d22`.
  Direct physical filestore bytes matched the browser download and DB checksum.
- TLS: both vendor and customer login returned 200 with the isolated Caddy root
  certificate validated by curl; browser automation separately accepted that
  private local CA. This is not public DNS/TLS acceptance.

Retained local evidence directory (ignored/private):
`tools/shared_saas_lifecycle/.state/nasq-saas-life-1790879392/evidence/`.
The successful run is `browser-1790881446016/`, with `first-tenant.json`,
`physical-readback.json`, `tls.json` and three screenshots. `source-manifest.json`
records 43 changed source hashes and exact image IDs. Earlier attempts are
retained: they exposed the initial guard bootstrap failure and acceptance-script
assumptions about responsive settling, required project date, route destination,
calendar/file-picker controls and attachment tab. They are not counted as passes.

Both real fault scenarios passed in `faults-1790881526.json`:

| Injection during an owned real Odoo install | Result after natural lease expiry |
| --- | --- |
| SIGKILL of this project's control-worker, then restart | `needs_intervention`, one attempt, no verified receipt, no completion marker, disabled route |
| Stop this project's control DB for 25 seconds, restore it and restart worker | Same closed/intervention result; no second physical attempt |

The stopped worker's detached install was allowed to finish and observed to exit;
it did not proceed through policy/admin completion or enable the route. No lease
timestamp, journal or operation state was edited to force these results. Separate
TLS-validated HTTP probes returned **403 `tenant_boundary_rejected`** for both
faulted hosts (`disabled-route-probes.json`). These tests verify refusal of blind
retries; they do not prove an operator recovery/resume product workflow.

The isolated runtime and all evidence/volumes remain available for the next
milestone. Failed/interrupted customers remain quarantined; no cleanup was run.

## Exact image identity

The complete IDs are recorded in `source-manifest.json`:

| Image | Digest prefix | Basis |
| --- | --- | --- |
| Odoo | `cdc9894289ed7aed` | Existing image labeled source `3899a095`; Odoo/addons unchanged |
| Guard | `f941dfb7df5a13e5` | Existing verified base; relevant source unchanged |
| Caddy | `148b2c09f91476d5` | Existing verified base; mounted current local/production config |
| Shared web | `47a42bd726184602` | Built from this worktree with shared tenancy compilation |
| Vendor web | `968578fb29fd0234` | Built from this worktree with dedicated tenancy compilation |
| Control runtime | `0ebf80c66aafeba7` | New Node/Docker/Python runtime; current control source bind-mounted |

No existing Odoo addon or stock Odoo source file was edited. No Odoo module test
suite was run; real installation, independent readback and browser use are the
Odoo evidence for this milestone.

Routing policy `astra-effort-v1`: coordinator Astra xhigh (active runtime), backend
Astra high, UI Astra medium, independent review Astra high; earlier trace Astra
medium. Measurement baselines for some phases/participants were late, so total
task tokens remain **unknown/incomplete**, with no savings claim. Local receipt
and acceptance evidence are under `~/.codex/routing-review/local-receipts/`.

## Remaining release work

1. Real tenant database **and filestore** backup/restore with byte comparisons.
2. Full second-tenant lifecycle and adversarial cross-tenant isolation checks.
3. Recovery/operator workflow for quarantined physical attempts and credential
   delivery; production runtime isolation/packaging (local worker uses Docker socket).
4. Real payment provider, capacity, operations, staging and production acceptance.

These remaining items are not covered by a successful first-tenant journey.
