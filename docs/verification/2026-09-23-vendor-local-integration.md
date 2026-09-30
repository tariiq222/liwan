# Vendor workspace local integration — 2026-09-23

## Scope and baseline

User authorized the recommended local commit and integration. Canonical `main`
was `abc2400e6d14aaa12aded6333bf3548dcf7581f7`; after fetching, it was one
commit ahead of `origin/main`, with no remote-only commits. Incoming implementation
is `47d0cbc68019c978f3bd88f69476a970c2b7e928` (`codex/vendor-control`).

The combined tree was prepared on `codex/vendor-control-integration` in
`/Users/tariq/.codex/worktrees/nasq-vendor-integration/nasq`, starting at that
exact main baseline. The reviewed index tree matched the incoming tree exactly.
Only delivery documentation was added after checks. No Odoo addon or existing
committed regression test was deleted or changed.

The 16 preexisting dirty CP2 files in canonical main were inventoried and copied
with SHA-256 hashes to the original implementation worktree's ignored
`.superpowers/merge-local/canonical-backup` directory. Catalog content was identical;
CLI changes extend that work with the journaled operator, fail-closed legacy
mutation entry and sanitized errors. Legacy adapter mutation tests move to the
new operator tests; the original source is retained in the snapshot and Git stash.
Main promotion uses a scoped retained stash and `git merge --ff-only` only after
rechecking the baseline and all 16 source hashes. No stash, branch or worktree
is deleted.

## Fresh combined-tree validation

Independent dependencies were installed using `npm ci --ignore-scripts`; no
node_modules or generated-state symlinks were used. All commands below exited 0.

| Command / check | Result |
| --- | --- |
| `npm -w apps/web run postinstall` | Nuxt preparation passed |
| `npm test` — Python tools | 205 passed |
| `npm test` — existing contracts | 178 passed / 28 files |
| `npm test` — web | 847 passed / 126 files |
| Secret, external-reference, UI policy/inventory/templates/catalog guards | Passed |
| `npm run test:commercial` — commercial contracts | 4 passed |
| `npm run test:commercial` — control service | 13 passed / 3 files, no skips |
| `npm run lint` | Web TypeScript and Odoo Ruff passed |
| `npm run build` | Contracts and Nuxt production build passed |
| Commercial contracts and control service build | TypeScript passed |
| `git diff --check` | Passed |

Control-service tests used the newly created loopback database
`nasq_control_scratch_merge923a`; no tests ran on `odoo19`. Logs are retained in
this integration worktree under `.superpowers/integration/`. Existing browser
and real CP2 operation evidence is documented in the implementation report; those
flows were not rerun for this content-identical local integration. No fresh full
Odoo, Docker-image, English LTR browser, or production acceptance is claimed.

## Delivery boundary

Vendor workspace flags remain false by default. Customer databases remain
independent. Local integration is not a push or deployment. Customer provisioning
still reports `deployment_ready:false`, backup capture remains UNVERIFIED, and
live customer mutations remain blocked. CRM, recurring billing and a fully
operational government/corporate delivery package remain subsequent work.

> Note (2026-09-30): the scratch database `nasq_control_scratch_merge923a`
> referenced in this document was dropped by a later verification run. The results
> recorded here are historical and the live DB can no longer be re-inspected.
> Recovery is pending the owner's decision.
