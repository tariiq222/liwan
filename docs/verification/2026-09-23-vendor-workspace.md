# Company workspace and vendor administration — 2026-09-23

This report records the implementation checkpoint. For subsequent local integration
and fresh combined-tree checks, see [local integration](2026-09-23-vendor-local-integration.md).

## Decision and delivery boundary

The company uses its own internal non-SaaS Nasq installation for projects, people,
meetings and messaging. It is not a subscription sold to itself. A separately
permissioned **Nasq administration** section in the same frontend talks through
a same-origin BFF to an independent control service/database. Customer databases
remain independent. Existing `/odoo` support access does not grant vendor access.
CRM, payment collection, recurring billing and a customer self-service portal are
not implemented by this change.

Implementation is local in `codex/vendor-control`, worktree
`/Users/tariq/.codex/worktrees/nasq-vendor-control/nasq`, based on `abc2400e`.
The original CP2 work in the canonical checkout was copied and preserved.
No commit, merge, push, production deployment or existing customer mutation was
performed. The initial source audit is in `2026-09-23-vendor-control-baseline.md`;
that file describes the pre-implementation checkpoint.

## Implemented surfaces

- CP2: explicit `python -m nasq_cli.operator` entry, private inventory, physical
  target alias rejection, OS target lock, durable SQLite receipts, content/target
  bound idempotency, fenced revision update, selected catalog module composition,
  scratch creation/inspection/health/entitlement/backup/restore/upgrade. The old
  adapter mutation entry now fails closed.
- CP3: independent PostgreSQL migrations, installation-bound vendor grants,
  revocation, signed BFF requests with replay protection, catalog validation and
  publication, tenant registry, durable operation queue, worker and audit.
- CP4: existing company shell navigation plus overview, customer installations,
  registration, details/policy/operation grants, catalog, operation progress and
  audit pages. Company login remains the identity provider; vendor authority is
  checked separately on every API request.

## Real operational evidence

Two new scratch targets completed **12 commands**: create, inspect, entitle,
backup, restore and upgrade once per SaaS/non-SaaS mode. All exited 0 with
matching successful receipts. The current inspect implementation was subsequently
read against both databases and returned the expected distinct policies/revisions.
Private evidence: `.superpowers/vendor-control/cp2-real-verified/operations.jsonl`
and `inspect-features-proof.json` (retained locally, not versioned).

The first run exposed a real backup manifest mismatch after create/inspect/entitle
passed. The mismatch was corrected and the whole sequence rerun with new databases;
the uncertain first backup receipt was not replayed or erased.

Backup capture remains **UNVERIFIED**, non-atomic and not recovery-ready.
Restore verification into a new scratch database does not establish original
capture consistency. Upgrade verifies module state and classified database profile;
HTTP application health remains unverified. Creation verifies database, selected
modules and policy, but reports `deployment_ready:false`. The control service
retains policy evidence while marking deployment incomplete rather than claiming
an active customer installation. Live customer targets are rejected by operational
mutations until a separately verified deployment adapter exists.

CP1 tests: 85 Odoo tests passed on a new SaaS scratch database. The first non-SaaS
run had 1 failure and 2 errors caused by three SaaS-only expiry fixtures; its
non-SaaS cutoff guard correctly refused those fixtures. No tests ran on `odoo19`.
The internal company non-SaaS instance authenticated and served `/api/v1/me`
without a running control service or an ambient commercial classification file.

## Integration validation

Fresh local results:

| Check | Result |
| --- | --- |
| Python tools (`unittest discover -s tools`) | 205 passed |
| Existing product contracts | 178 passed, 28 files |
| Web unit suite | 840 passed, 125 files; additional numeric-policy regression suite 7 passed |
| Commercial contracts | 4 passed |
| Control service with scratch PostgreSQL and process-group tests | 13 passed, 3 files |
| Web TypeScript and production build | Passed on the final implementation |
| Control service and commercial contract TypeScript | Passed |
| Ruff: new CLI/catalog tools and all Odoo addons | Passed |
| Secrets/external-reference/UI-policy/inventory/template/catalog guards | Passed; 251 Vue templates, 43 catalog components |

Browser acceptance used the real company Odoo session, independent control database,
real API worker and CP2 entry. Observed flows: catalog validate/publish, SaaS and
non-SaaS registration, creation dispatch and truthful incomplete-deployment result,
policy update dispatch, candidate backup and UNVERIFIED notice,
audit events, search and route-backed return-to links. Registration now exits the
unsaved-changes guard after successful save. Actual permission revocation returns
403 for vendor pages while company projects load. Stopping the control API also
leaves company projects usable. This is bounded manual browser evidence, not a full
automated browser regression suite.

Arabic RTL pages were inspected at 390, 768 and 1440 widths without document overflow.
English locale keys are included; an English LTR browser pass was not completed
because the current company shell has no visible locale-switch control. No customer
production deployment or full live-customer outage test is claimed.

Independent review found and fixed backup manifest mismatch, target aliases bypassing
locks, overstated upgrade health, process-group lifetime on timeout, globally scoped
request-ID mismatch and target quarantine after uncertain operations. The worker
kills the entire process group on timeout; both queue and CLI refuse a new mutation
on a target with unresolved mutation outcome. The sole queue exception is a verified
DB-ready create explicitly marked deployment incomplete; its CLI receipt is certain.


A final persisted-state check caught a numeric form issue: Nuxt emitted numbers,
but the original editor accepted only strings and sent null. The initial successful
receipt was therefore a no-op, not proof of the entered limit. The editor now
handles numeric/string/empty values explicitly, preserves untouched fields, and
has 7 regression cases covering 25, zero, unlimited and invalid limits. The final
live value/revision confirmation is recorded below after rerunning the browser.

Final persisted-state confirmation: the browser submitted a numeric limit of 25.
A direct read of the new SaaS scratch database returned `policy_revision=2` and
`features.users.limit=25`. A subsequent request with revision 1 failed with
`revision_conflict` and left both values unchanged. Real BFF acceptance also
returned 403 for missing Origin, 422 for spoofed actor payload, and 422 for an
attempted control-plane policy override on non-SaaS even after its operations
grant was enabled. That grant was restored to disabled. Evidence is retained in
`.superpowers/vendor-control/http-acceptance-proof.json`. Queued operations now
preserve HTTP 202 through the BFF; browser registration preserves HTTP 201.

Local preview: `http://127.0.0.1:3196/vendor/overview`. The preview uses only the
new scratch company/customer/control databases. Runtime configuration and test
credentials remain private under the ignored evidence directory; they are not
part of the source change. Scratch resources and the isolated worktree are retained
for review. Canonical main and its preexisting uncommitted CP2 files are unchanged.

Final browser return-to check confirmed the Arabic search term and filtered one-row
list survive opening a customer installation and returning. Final canonical/main
and isolated branch base both remain `abc2400e`; `git diff --check` and final
secret/external-reference/catalog checks passed.
