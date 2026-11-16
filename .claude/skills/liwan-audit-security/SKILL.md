---
name: liwan-audit-security
description: Audit LiwanOS security, authorization and tenant isolation — Semgrep with the pinned rulesets, gitleaks secret scan, route gate, sudo gate, dependency direction, then the Odoo capability and record-rule suites on a scratch database. Use when asked for a security review or audit, before exposing a route or permission change, when checking tenant isolation, or when asked whether secrets or unsafe defaults exist in the tree.
---

# liwan-audit-security: security, permissions and tenant isolation

```sh
python3 -B tools/audit/audit.py run --profile security
python3 -B tools/audit/audit.py run --profile security --deep      # adds npm audit + AI-service audit
python3 -B tools/audit/audit.py run --profile security --include-odoo
```

Without `--include-odoo` the capability, record-rule, tenancy and audit-trail probes stay
**Not Verified**. Say so; a static-only pass is not a security clearance.

## What each probe proves, and what it does not

| Probe | Proves | Does **not** prove |
| --- | --- | --- |
| `semgrep` (pinned `p/python`, `p/typescript`, `p/secrets`) | no ERROR-severity match of the pinned rules on the scanned files | that the code is safe; rules only match what they encode |
| `gitleaks` | no credential-shaped literal outside tests, docs and reviewed fixtures | that no secret was ever committed (history is not scanned here) |
| `route gate` | every route declares its auth and feature gate | that the declared gate is the right one |
| `sudo gate` | every `sudo()` is documented with a real reason | that the `sudo()` is avoidable |
| `arch policy` | the R1–R10 layering, capability and bridge rules | runtime behavior |
| `dent-cruiser` | the web module graph has no forbidden direction | runtime import cycles Odoo resolves dynamically |
| `authorization` / `tenancy` (Odoo) | capability checks and record rules refuse the wrong caller | — |

Rules that hide a problem instead of fixing it are findings, not fixes: a bare
`# nosemgrep`, an `eslint-disable`, a `@ts-ignore`, a new `sudo()` case without a reason, or an
allowlist entry added to make a run green. The suppression sets only shrink (`AGENTS.md`).

## Authorization scope to check on every security run

- **Capabilities, not groups.** `liwan.access.service` composes the catalog; legacy groups are ORM
  support, never a substitute for a capability check. Membership alone never grants a sensitive
  capability.
- **Every operation re-checks** the current company and record visibility, not only the capability.
- **The Odoo web client is closed.** The `liwan_platform` `ir.http` guard returns 404 for `/web`,
  `/json/2`, `/doc`, `/xmlrpc`, `/jsonrpc`, `/odoo` and `/report` for every session, including
  `system_admin`. A function reachable only there must move into `/api/v1` and the Nuxt UI.
- **Payroll data** (`hr.payroll.*`) never appears in general employee, directory or people
  serializers, and needs its own capability and sub-feature.
- **Tenant isolation is database-per-tenant.** There is no shared-database tenant layer; a query that
  spans tenants is a P0.
- **Public routes** are only the documented `/api/v1/public/` exception and the Inbox hook
  callbacks, each listed in `tools/route_gate_allowlist.json` with its reason.

## Active scanning is out of scope here

No DAST, no OWASP ZAP run against a live or deployed target, no fuzzing of a remote endpoint, no
load against production. A dynamic scan needs an isolated stack, an explicit scope and the owner's
approval; record it as deferred instead of running it.

## Reading the result

- `semgrep` blocking findings → verify each sample before calling it exploitable. A rule match is a
  hypothesis; use `fp-check` reasoning before promoting it to a finding.
- `gitleaks` production candidates → **P0** until proven false. Never paste the secret value into a
  report; name `file:line`, the rule, and say "rotate if real".
- A `security` or `secrets` probe that is Not Verified means the axis is **unscored**. Do not
  summarize it as "no security issues found".

Report findings as `file:line`, the input that breaks it, the impact, and the test that would prove
the fix. Propose fixes; do not implement them in an audit run.
