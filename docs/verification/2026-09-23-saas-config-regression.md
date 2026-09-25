# SaaS control-plane config regression — 2026-09-23

## Scope and baseline

Preparatory regression coverage for the exported `getConfig()` contract of
`apps/control-plane/src/config.ts`. This is bounded parsing coverage only. It is
**not** package-1 runtime, operator, or deployment acceptance, and it authorizes
nothing.

- Worktree: `/Users/tariq/code/nasq-saas-config-tests`
- Branch: `codex/saas-config-tests`
- Base: current `main` = `abde67b64155250f015b8ad213c26609532a124c`, created with
  `git worktree add -b codex/saas-config-tests … main`. The target path and
  branch did not exist before; nothing was overwritten.
- Canonical `/Users/tariq/code/nasq` was and remains `main` @ `abde67b6`. It is
  **not** claimed clean; see the canonical dirty state section below.
- Runtime actually used: host Node `v24.21.0` with npm `11.19.0`. The repository
  pins Node `22` through `.nvmrc`; no `engines` field exists in the root or
  workspace `package.json` files. The recorded run therefore executed on host
  Node 24, not on the pinned Node 22.
- Independent dependencies: `npm ci --ignore-scripts` inside the worktree
  (exit 0, 1208 packages). `node_modules` is a real directory, not a symlink; no
  `.nuxt` directory was created and no generated-state symlink was used. The
  global `~/.npmrc` was not read-edited or modified.
- This lane performed no commit, merge, push, fetch, deploy, deletion, service
  start, database access, or Odoo mutation.

## Changed paths

| Path | State |
| --- | --- |
| `apps/control-plane/src/__tests__/config.test.ts` | New, untracked. 320 lines. SHA-256 `14b463dd2db015e303365079a783cd839e8ad58659110afe9d04d1435c1f2afc`. |
| `docs/verification/2026-09-23-saas-config-regression.md` | New, untracked (this document). |

`git diff --name-only main` is empty: no tracked file was edited, and no
production code, schema, package manifest, or lockfile was changed. The accepted
config test was left byte-identical to the version that produced the evidence
below (same SHA-256).

## Focused evidence (this lane)

Command derived from the package script `"test": "vitest run"` in
`apps/control-plane/package.json`:

```sh
cd /Users/tariq/code/nasq-saas-config-tests
npm -w apps/control-plane run test -- src/__tests__/config.test.ts
```

| Field | Recorded value |
| --- | --- |
| Exit status | `0` |
| Runner | vitest 4.1.11 |
| Test files | 1 passed (1) |
| Tests | 47 passed (47) |
| Duration | 115 ms (as printed by that run) |
| Start | 02:51:55 (as printed by that run) |

Static type check from the package script `"build": "tsc --noEmit"`:

```sh
npm -w apps/control-plane run build
```

| Field | Recorded value |
| --- | --- |
| Exit status | `0` |

The suite was **not** rerun while writing this document; the figures above are
the single recorded run, and no additional timing or log artifact was produced
or is referenced. Command output was captured inline in the working session;
there is no log file. No database or service was contacted: the PostgreSQL
integration file (`service.test.ts`, gated on `CONTROL_TEST_DATABASE_URL`) was
not executed and that variable was never set.

Coverage asserted against the real implementation: each required variable absent
and empty; a 31-byte key rejected and exactly 32 bytes accepted, including byte
versus character semantics for a multibyte key; port boundaries `1`/`65535`
accepted and `0`, `65536`, `-1`, `4179.5`, `abc`, `""` rejected; non-loopback
hosts (`0.0.0.0`, a private address, a DNS name, and a padded loopback value)
requiring TLS, with loopback `127.0.0.1`/`::1`/`localhost` allowed without it;
readable TLS material loaded as buffers and unreadable TLS paths failing loudly;
relative and empty operator paths rejected; host/port/Python defaults and the
exact returned key set; and environment snapshot/clear/restore with no
call-time caching.

## Independent verification (Grok)

An independent Grok rerun of the focused suite is reported as **PASS**. The raw
output and its own counts are held by the orchestrator/verification lane, not by
this lane, so no figure is reproduced here.

Grok's recorded boundary: the suite exercises real `getConfig` parsing only. It
proves no database, socket, or service behavior; it proves nothing about
control-URL safety, operator-path existence, the presence or identity of the
Python executable, filesystem permissions, or TLS key/certificate pairing. A TLS
assertion that the call throws does not prove a stable error code or contract.

## Environment and secrets

Only environment variable names that are already public in
`apps/control-plane/README.md` are referenced in the test and in this record. No
service key, TLS material, connection string, or other secret value is written
here; the fixtures used placeholder-only values.

## Missing live gates

- No `CONTROL_TEST_DATABASE_URL` run: PostgreSQL, HTTP server, worker, migration,
  lease and advisory-lock paths are unverified.
- No Odoo addon check and no scratch-database run. Nothing ran on `odoo19` and no
  customer database was touched.
- The CI workflow was not executed in this lane. `.github/workflows/ci.yml`
  defines seven jobs at this baseline (`static`, `odoo`, `upgrade`, `image`,
  `restore-drill`, `e2e-mock`, `control-plane`); the six-job list in `CLAUDE.md`
  is stale. None of the seven ran here.
- No Docker image build, backup/restore drill, browser/e2e run, deployment, DNS or
  TLS cutover, and no production acceptance.
- Not package-1 acceptance. Package-1 concerns — durable service/database/worker
  operation, session and grant binding, default-off enforcement, operator
  bootstrap — remain unproven here. Vendor workspace flags remain false by
  default.

## Canonical dirty state (other lane — read-only observation)

At the time of writing, canonical `/Users/tariq/code/nasq` reports these dirty
paths:

```
 M apps/web/server/utils/__tests__/vendor-control.test.ts
?? apps/web/server/utils/__tests__/vendor-outage.test.ts
?? docs/superpowers/plans/2026-09-23-company-operations-and-vendor-roadmap.md
```

The orchestrator reports that the two BFF files come from another lane's
accidental relative-path writes. A read-only working-tree inspection shows the
modified file carries 77 added lines of BFF boundary test cases and the
untracked file is a new BFF outage test; this lane records only that observation
and makes no further judgement. This lane never wrote to canonical, did not
touch those files, and treats their preservation or restoration as pending
explicit user approval. Canonical `main` must not be described as clean.

The untracked user roadmap plan predates this work, was not modified by this
lane, and remains untracked.

## Boundary

Local configuration-parsing regression only. No push, merge, deployment, or
release is claimed. The worktree and branch are retained for the orchestrator's
integration decision.
