# P1 local lifecycle verification plan — 2026-09-23 (corrected)

**Status: PLANNED / NOT EXECUTED. HOLD on live execution.**
No test, service, container or database has been started, stopped, queried or mutated to produce this
document. **Nothing in this document is a verifier pass.** Every statement sourced from the runtime owner or
from public docs is a *claim*; only a labelled fresh run with an attached artifact can become evidence.

**Provenance labels used throughout:** `[CLM]` owner/doc claim · `[OBS]` verifier read-only observation ·
`[GRK]` Grok-reviewed logic · `[RUN]` fresh verifier run (none exist yet).

**Owner:** test lane `/Users/tariq/code/nasq-saas-auth-tests` (branch `codex/saas-auth-tests`).
**Baseline:** canonical `main` `abde67b6`.
**Sources:** `deploy/control-plane/OPERATIONS.md` `[OBS]`; `deploy/control-plane/compose.yml` and
`env.example` structural reads `[OBS]`; `deploy/control-plane/*.sh` **old snapshot, SUPERSEDED** (§2) —
no current-code claim is made from it; `apps/control-plane/src/*` at `abde67b6` `[OBS]`; Package-0 drafts
(DRAFT / NOT ACCEPTED).

## 1. Authoritative facts (corrected)

| Fact | Value | Label |
| --- | --- | --- |
| Configured DB suite | **13/13 on `nasq_control_scratch_p1tests2`** | `[CLM]` |
| `p1tests3` as "latest verified" | **RETRACTED** | `[CLM]` |
| Unconfigured (no `CONTROL_TEST_DATABASE_URL`) | **3 pass + PostgreSQL integration skipped** | `[CLM]` |
| Retained test databases | **`p1tests` and `p1tests2` only.** `p1tests3` was never present; its claim is **retracted**, not retained | `[CLM]` |
| Runtime database | **`nasq_control`** (user `nasq_control`) | `[CLM]` + `[OBS]` scripts / `OPERATIONS.md:9` |
| Predecessor `nasq_control_scratch_p1runtime` | wrong; explicitly rejected by `OPERATIONS.md:9` | `[OBS]` |
| Ports | control DB `127.0.0.1:55432`, API `127.0.0.1:14179`; owner holds both exclusively until final stop | `[CLM]` |
| Node | pinned `/opt/homebrew/opt/node@22/bin/node` = **v22.22.2**, enforced `v22.*`; harness shell resolves Node 24.21.0, which the runtime refuses | `[OBS]` + `[CLM]` |
| `exit 10` | old-trap **identity mismatch** ⇒ **historical failed stop requiring a final lifecycle retest (A2/A3)**, not an unknown blocker. Afterwards the **API stopped (curl 000, no listener) while PostgreSQL remained available**, so the DB-down condition was never created and the **live 503 remains unmeasured** | `[CLM]` |
| Force-recreate of the CP container (~03:29) | performed **without authorization**; disclosed, no rollback, no further recreate | `[CLM]` |
| Secret incident | a diagnostic `docker inspect` printed the previous synthetic DB password; synthetic only, no production/customer secret | `[CLM]` + `[OBS]` `OPERATIONS.md:41` |
| Rotation | owner reports new password accepted, old rejected | `[CLM]` (not yet `[GRK]`) |
| Known latest source issues | **(a) container identity validation** (not a process-substring concern), owner repairing the startup branch; **(b) early xtrace-off** so secret-bearing expansions/assignments cannot be echoed — Grok references `run-local.sh:26`, `init-local.sh:19-27`, `test-local.sh:16-19`. **Both repair → Grok review are prerequisites to any live run** | `[GRK]` + `[CLM]` |

`OPERATIONS.md:7,9,23,25` reconcile with my independent reads on the Node pin, the `nasq_control` name, the
fail-closed bootstrap, the no-destructive command list and the empty v2 inventory.

## 2. Freeze model (corrected)

No commit is authorized and none is required, so a clean tree or a "final commit hash" is **not** a
precondition. Freeze = canonical base **`abde67b6`** plus **content hashes of the artifacts the run actually
depends on**, recorded at the real frozen handoff.

- **Scripts are NOT frozen and must not be hashed now** — the container-identity startup branch is under
  repair (`[GRK]`/`[CLM]`). Script-derived expectations in §5 are provisional until the repair lands.
- My **earlier script snapshot is SUPERSEDED.** It is retained as history only and I make **no allegation
  about the current code** from it. Grok's review of the latest actual file is the authority.
- Intended dirt (untracked owner files under `deploy/control-plane/`) is expected and never aborts.
- An unrelated, unexpected change **pauses only the checks that depend on it**; it does not abort the run.
- Where code changed, earlier artifacts are marked **SUPERSEDED**, never discarded.
- **Prerequisite to live — two concrete source gates** (`[GRK]`): **(a) existing-container identity
  validation** and **(b) early xtrace-off**, so secret-bearing expansions/assignments cannot be echoed
  (`run-local.sh:26`, `init-local.sh:19-27`, `test-local.sh:16-19`). Both must be repaired and Grok-reviewed
  against the latest actual file, then the freeze is established. Until then this plan stays on HOLD.

## 3. Public-doc audit — precise findings `[OBS]`

Findings needing a doc correction, a limitation note, or a pending measurement. **None is a verifier pass or
fail.**

1. **The doc names a database that does not exist.** `OPERATIONS.md:35` states "the latest completed verified
   run used `nasq_control_scratch_p1tests3`". The authoritative configured run is **13/13 on `p1tests2`**, the
   `p1tests3` claim is **retracted**, and `p1tests3` was **never present** as a retained database. The doc
   needs correction before it can serve as the test-lane evidence record.
2. **Designed behavior whose live measurement is still pending — not a contradiction.** `OPERATIONS.md:25`
   states `/healthz` "returns unavailable when DB is down". That is the **source-contract behavior**, and the
   code path supports it statically (`http.ts` outer catch → 503 `service_unavailable`) `[OBS]`. What is
   missing is the **measurement**: at `exit 10` the API had already stopped (curl **000**, no listener) while
   PostgreSQL **stayed available**, so the DB-down condition was never created. The design is not false; it is
   **unmeasured**. Case **E2** exists to measure it.
3. **Superseded snapshot — no current-code allegation.** `OPERATIONS.md:25` claims "recorded PID, exact argv,
   process start-time and generation ownership". I previously read containment-style comparisons in my **old**
   script snapshot, but that snapshot is **SUPERSEDED**, I have **not re-read** the current files, and I
   therefore make **no claim** that the doc conflicts with the actual code. The **known latest source issue is
   container identity validation**, which the owner is repairing and Grok will review against the latest
   actual file.
4. **Volume retention is asserted, not evidenced.** `OPERATIONS.md:41` states the force-recreate replaced the
   container "while retaining its named volume" as fact; the supervisor holds volume retention as a **claim
   pending evidence**.
5. **Rotation evidence lacks the required completeness.** `OPERATIONS.md:41` describes psql password input and
   in-process boolean checks, but gives **no target role, database, endpoint, auth method (TCP vs local/trust)
   or timestamps**. Those are required before the rotation claim can be treated as more than `[CLM]`.
6. **Silent omissions** (not contradictions): the doc does not record the retained test-DB inventory
   (`p1tests`, `p1tests2`), the unconfigured 3-pass + PG-skip run, or the `exit 10` outcome (API stopped with
   curl 000 while PostgreSQL stayed up). The doc cannot serve as the record for those facts.

## 4. Secrets handling (corrected)

- In-process tooling **may** read approved private credentials to authenticate or scan, provided it returns
  only redacted/count-only/boolean results. Forbidding this would make independent live auth verification
  impossible.
- The only hard boundary: **raw secret text and raw env/log output never reach me or my artifacts.**
- **No `=` ban.** Sanitized boolean lines legitimately contain `=`; `POSTGRES_PASSWORD_FILE=` is a reference,
  not a value. The safe form is *key names / booleans only*, never an emitted credential pair.
- `[CLM]` rotation is accepted as a claim with Grok's logic review as the independent leg; I will not upgrade
  the owner's claim to verified, and I will not learn or reproduce either password.
- Previously retained artifacts that may contain the old synthetic value stay **quarantined** and are excluded
  from the accepted evidence set; the final report states that limitation rather than claiming erasure.
  Container replacement is explicitly **not** forensic evidence of erasure (`OPERATIONS.md:41`).
- Legacy metadata disclosure is tracked **separately** from the source-regression requirement: the old
  invalidated `POSTGRES_PASSWORD` may persist in prior container metadata, and that is **not** a precondition
  for any other independent check. The regression requirement is only that the **current** configuration uses
  the file-backed reference and emits no current-secret output.

## 5. The 27 cases

All cases are `PLANNED / NOT EXECUTED`. Script names are the real ones; expectations tied to script internals
are provisional until the identity repair lands (§2).

### P1-A — Lifecycle and ownership (9)
| ID | Case | Expected |
| --- | --- | --- |
| A1 | `run-local.sh` then probe | `/healthz` 200; `pg_isready -h 127.0.0.1 -p 55432` ok; listener on `127.0.0.1:14179` only (a LAN-IP probe must fail) |
| A2 | `stop-local.sh`, then again | owned PIDs gone in a bounded window; DB container, named volume, credentials, inventory, state and logs retained; second stop safe. **This case is also the retest of the historical failed stop (`exit 10`)** |
| A3 | restart via the owner path | new PIDs ≠ old; exactly one listener; ownership records consistent; `/healthz` 200 again |
| A4 | duplicate start (`run-local.sh` while owning) | refused non-zero (`OPERATIONS.md:25`, `local-process.sh:42`) **or** safe idempotent success — either accepted; MUST be one listener, no second worker, truthful status |
| A5 | decoy whose argv contains `run-local.sh` | `status-local.sh`/`stop-local.sh` must not claim or signal it; the decoy survives — ownership must be discriminated by verified identity, not by a name match |
| A6 | stale ownership records after a natural stop | records cleared; a stale runtime record blocks duplicate start with a truthful message; recovery works **without** `kill -9` (no `kill -9` as first injection) |
| A7 | port 14179 held by a foreign verifier-owned listener | start refused non-zero (`run-local.sh:21`); the holder is never signalled or killed |
| A8 | generation/ownership across restart until reaped | new generation owns; old record persists until reaped; `status` never reports "not running" while a child is live; no signalling a reaped/reused PID |
| A9 | **container identity validation** (known latest source issue, Grok finding) | startup must validate the container identity and fail into a truthful non-zero state rather than proceeding on an unverified container; no signal to a mismatched process; one authoritative ownership-record location shared by `local-process.sh`, `stop-local.sh`, `status-local.sh` and `test-local.sh` |

### P1-B — No secrets in artifacts (3)
| ID | Case | Expected |
| --- | --- | --- |
| B1 | Post-rotation artifacts only | in-process, count-only scan: current secret occurrences **0**. Pre-rotation artifacts stay quarantined and are never read or scanned |
| B2 | Error hygiene | missing config names the variable (`<NAME> is required`), which is expected and not a leak; DB/auth failures return only `{code,message}`; no DSN, password, key or driver internals |
| B3 | Source-regression guard | current `compose.yml` uses the file-backed secret (`POSTGRES_PASSWORD_FILE`, `secrets: file:`) with **no literal password**; container env exposes the FILE key and not a password value; secret file mode 0600 outside the repo, mounted read-only; **no current-secret output**. Deliberately independent of the retained legacy metadata (§4) |

### P1-C — Migrations, grants and authorization (7)
| ID | Case | Expected |
| --- | --- | --- |
| C1 | migrate twice | exit 0 both; `SELECT version FROM schema_migrations ORDER BY version` = exactly {1,2,3}; expected objects incl. the `catalog_immutable` trigger |
| C2 | two concurrent migrates | both exit 0 under advisory lock `1397969233`; ledger still 3 rows |
| C3 | grant then re-grant | exit 0; one membership row, `revoked_at IS NULL`; audit append-only (`membership.granted`, `actor='operator'`) |
| C4 | revoke twice | first sets `revoked_at` + `membership.revoked`; second non-zero with no new audit row; a signed request as that actor afterwards → 403 |
| C5 | argument validation | `grant 0`/`abc` → `positive Odoo user ID required`; short reason rejected; duplicate capability rejected |
| C6 | configuration identity | per required var, `env -u` on an own isolated port → non-zero and exactly `<NAME> is required`; 31-byte key rejected; relative operator paths rejected; non-loopback without TLS rejected **before** binding; `CONTROL_PORT=70000` → `invalid CONTROL_PORT` |
| C7 | authorization matrix | no headers → `/v1/*` **401**, `/healthz` **200**, non-`/v1/` → 404; forged `x-nasq-*` → 401; timestamp now−31s → 401; replay → second call 401; valid signature, no membership → **403**; revoked → **403**; wrong issuer → **401** |

### P1-D — Real PostgreSQL suite on a dedicated test DB (3)
The owner's `test-local.sh` already owns the real run; these cases consume its result and do not duplicate it.
| ID | Case | Expected |
| --- | --- | --- |
| D1 | configured run | 13/13 `[CLM]` to be re-observed; exit 0; **zero** skipped markers in an in-process, count-only scan of the private log; the `p1tests2` target confirmed and the retracted `p1tests3` claim not repeated |
| D2 | unconfigured run | 3 pass + PG integration skipped, reproducing the documented silent-green shape — a diagnostic, never acceptance |
| D3 | blast radius and reuse guards | runtime `nasq_control` untouched before/after; the runner refuses an existing test DB, refuses the runtime DSN, refuses while the API/worker supervisor is active. If the runner requires it, a **new dedicated test DB** is created at handoff — no reuse of the retained `p1tests` / `p1tests2` |

### P1-E — Database outage and health truth (5)
| ID | Case | Expected |
| --- | --- | --- |
| E1 | healthy API | `/healthz` 200 `{status:'ok'}` |
| E2 | **stop ONLY the dedicated CP DB container while the API stays alive**, then start it again | `/healthz` → **503** `{code:'service_unavailable'}` promptly, no hang; after restart → 200 without restarting the API. **Currently unmeasured** — at `exit 10` the API had stopped (curl 000) while PG stayed up, so the condition was never created. A safe `stop` of that single container, matched by container ID and with no deletion, followed by `start` to restore, is **authorised after handoff for this case** |
| E3 | DB returns | `/healthz` 200 again without restarting the API |
| E4 | boot with the DB down | non-zero exit, clear message, nothing bound, no partially applied schema |
| E5 | DSN on a closed loopback port (own value) | fail fast under an external `timeout`; no hang |

## 6. Non-assertions

1. **No exact PostgreSQL session/connection count** is asserted — `pg_dump`, `psql` probes, pooling and the API
   plus worker legitimately vary it.
2. **Duplicate start need not fail** (A4).
3. **`kill -9` is not the primary fault injection** (A6).
4. **Retained legacy container metadata is not required to disappear** before other independent tests; it is a
   disclosure item, not a gate (§4).
5. **Container replacement proves no erasure.**
6. **No business-continuity claim** in this lane; see §8.
7. **No unattempted case is recorded as `skip`.** `skip` is a result status; an unrun case is
   `PENDING / NOT EXECUTED`.
8. **A static source contract is not a measurement, and an unmeasured design behavior is not a false one**
   (§3.2). The 503 contract is designed and statically supported; only the live measurement is outstanding.

## 7. Execution preconditions

1. **Both source gates repaired and Grok-reviewed against the latest actual file** (§2): existing-container
   identity validation **and** early xtrace-off. No live run before that.
2. `exit 10` is a **historical failed stop requiring a final lifecycle retest (A2/A3)** — not an unexplained
   blocker, and not a precondition to read-only checks.
3. Freeze recorded as base `abde67b6` + content hashes of the artifacts the run depends on.
4. The owner releases exclusive `55432`/`14179` (final stop).
5. **No `compose up`, no recreate, no `down`/`down -v`, no `dropdb`, no `docker rm`, no prune, no volume or
   metadata deletion.** For **E2 only**, after matching the existing container's ID, a **safe `stop` of the
   dedicated CP DB container while the API stays alive, followed by `start` to restore it**, is authorised
   after handoff. A blanket start-only rule would make E2 impossible.
6. No `odoo19`, no customer resource, no customer operation, no Docker socket. The Odoo + Nuxt business
   fixture has a **separate owner and stays independent** of this lane.
7. **Rotation completeness and volume retention are evidence items to verify, not blanket prerequisites.**
   Once the two source gates and the freeze are in place, non-mutating work — documentation/artifact review,
   structural key-name checks and other safe read-only probes — may proceed without waiting on them.

Order: Phase 0 read-only reality check (hashes, ports, container ID) → C1–C7 → A1–A9 → E1–E5 → B1–B3 over the
captures → D1–D3 with the API/worker stopped, then restore. One service state change at a time.

## 8. Results policy and the deferred business gate

Every criterion is reported `pass | fail | skip` **only after a real run**, with its artifact reference, and
labelled `[RUN]`. Docs and owner statements stay `[CLM]` and are never promoted to a pass.

Roadmap Package-1 acceptance — *customer projects and employees keep working while the control service is
down* — **is part of P1 acceptance** but cannot run in this lane: `/api/v1/projects`, `/api/v1/hr/*` and the
Nuxt shell live in Odoo + Nuxt. This lane contributes only the management-plane half (API/worker down,
`/healthz` unreachable or 503, control DB distinct). The gate needs an Odoo scratch DB with a real
authenticated session, a built Nuxt app wired to it, and the BFF pointed at the stopped API. Status:
**PENDING / NOT EXECUTED** — not a `skip` result. Later packages, not P1: `deployment_ready`, backup/restore,
policy/entitlement, TLS/domain, attachment and two-tenant isolation.

## 9. Triage classifications (final)

**Dispatch-blocking source gates**
1. **Existing-container identity validation** — repair not landed; Grok review of the latest actual file
   pending (§2(a), A9).
2. **Early xtrace-off** — secret-bearing expansions/assignments must not be echoable; Grok references
   `run-local.sh:26`, `init-local.sh:19-27`, `test-local.sh:16-19` (§2(b)). Repair + Grok review pending.

**Not blockers**
3. `exit 10` — **historical failed stop requiring a final lifecycle retest (A2/A3)**, consistent with the
   known identity-mismatch diagnosis. Not an unknown blocker.
4. **Unauthorized force-recreate** — a **disclosed incident**, not a removable blocking condition; retained in
   the record, no rollback and no further recreate.
5. **A new dedicated test DB when the runner requires one** — a **planned resource**, not a blocker (D3).

**Evidence items to verify — not blanket prerequisites, and they do not block safe read-only checks**
6. Rotation evidence completeness: target role, database, endpoint, TCP-with-password method and timestamps
   (§3.5).
7. Volume retention after the force-recreate (§3.4).

**Doc correction**
8. `OPERATIONS.md:35` names `p1tests3`, which was never a retained database; the authoritative configured run
   is on `p1tests2` (§3.1).

These classifications are to be carried into the eventual execution report.
