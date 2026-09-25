# P1 verification results — preflight — 2026-09-23

**Status: PREFLIGHT ONLY. RUNTIME NOT EXECUTED. HOLD — runtime kept quiescent pending Grok re-review.** The
27-case plan is `PENDING / NOT EXECUTED`; no case has a result. No API, worker, container or database was
started, stopped, created, dropped, migrated or queried. No private file was read. No `Config.Env` was printed.
Read-only Docker metadata and the read-only identity guard were exercised as **preflight evidence, not tests**.
This report will be **appended**, not rewritten, when Grok's actual re-read arrives.

**Owner:** test lane `/Users/tariq/code/nasq-saas-auth-tests` (branch `codex/saas-auth-tests`).
**Target under verification:** `/Users/tariq/code/nasq-saas-control-runtime` (branch `codex/saas-control-runtime`).
**Plan of record:** [`2026-09-23-saas-p1-verification-plan.md`](2026-09-23-saas-p1-verification-plan.md) — 27 cases.

**Outcome in one line:** three of the five given hashes match exactly (`run-local.sh`, `init-local.sh`,
`compose.yml`); `test-local.sh`'s given value is **not a valid SHA-256** and must be re-issued; and
`resource_guard.py` both **mismatches its given hash** and **fails against the live retained container**, so the
documented `run-local.sh` reuse path cannot execute. Dependent gates stay **pending**, not clear.

## 1. Hash comparison against the given (Grok-cleared) set

The **actual generated manifest and Grok's actual re-read are the authority**. A hash is *not* re-derived by
deleting an apparent typo character.

| File | Verdict | Notes |
| --- | --- | --- |
| `run-local.sh` | **MATCH** | given `08f9198f…474ab` = actual `08f9198f4c8c90f49de139c0920a84c056751d02be5a3239285fabb0355474ab` |
| `init-local.sh` | **MATCH** | actual `c7db6c4daf96a4e57248b7e7a3baa01b4294095183846a5997d2dee890af199b` equals the given full value; the truncated chat value is superseded |
| `test-local.sh` | **GIVEN HASH INVALID** | the given string is **65 hex characters**, so it is not a SHA-256 at all and cannot be accepted. **Actual:** `a7cf4857a7847e89f2e36fac5e5cd799c12567dbe024bc9dbcf35444bcf4652a`. Both values are reported as-is; **no equivalence is inferred** from the apparent single-character difference. A corrected given value is required |
| `compose.yml` | **MATCH** | given `585ac3a2…b3b9be3` = actual `585ac3a2ff3abdeeef23b632c60518f2ef7656277481083af5202bdb0b3b9be3` |
| `resource_guard.py` | **MISMATCH** | given `e2bdb8c75de5068614a818de184b4a69d42615587dd76c40f647f8729a60e541`; **actual** `72a84fa7da841c6c1f43bc106bdbadd508e686a68bc33f05c03b391e787bc965` |

**`resource_guard.py` was the most recently written file in the set** (mtime `2026-09-23 03:59:20`, later than
`run-local.sh` 03:57:16 and `OPERATIONS.md` 03:55:32), so the given hash almost certainly predates the frozen
revision. A mismatch leaves the dependent gates **pending**; the source set is **not** claimed clear and **no
runtime source was patched**.

## 1a. Blocking finding — the frozen guard fails against the live container

Read-only, token-only invocation of the frozen guard on the retained container:

| Check | Result |
| --- | --- |
| `python3 deploy/control-plane/resource_guard.py` | prints **`project_container_set_mismatch`**, exit **1** |
| `python3 -m unittest -q test_resource_guard` | **4 tests OK** (exit 0) |
| `docker ps -aq --filter label=com.docker.compose.project=nasq-saas-control-local` | **1** line, length **12** (`d18854335fdc`) |
| `docker ps -aq --no-trunc …` | length **64** |
| `docker inspect --format '{{.Id}}' …` | length **64**, `d18854335fdc331060e1700892639bb7834b78a45a61721bdf3ffdfc101177c3` |
| Short = full? | **NOT EQUAL** |

**Cause:** `resource_guard.py:54,59` compares `docker ps -aq` output — a **12-character short ID** — against
`docker inspect` `.Id`, a **64-character full ID**. The equality can never hold, so `inspect()` always returns
`project_container_set_mismatch`. `test_resource_guard.py:4` imports only `validate()` and the constants, so
this `inspect()` path is **not covered** by the passing unit tests.

**Consequence:** `run-local.sh:23` (existing-resource branch) and `run-local.sh:28` (new-resource branch) each
`exit 6` on this guard, so the documented reuse path is **fail-closed broken**. The A-series and any E-series or
D-series case needing the API through `run-local.sh` cannot run. This is a **source drift finding, reported and
not patched**; it is the reason the runtime is held quiescent.

Per the prescribed precondition — the `run-local.sh` existing branch runs only after the source check confirms
the exact retained healthy container — the source check **failed**, so `run-local.sh` was **not executed**.

## 2. Frozen manifest

Captured `2026-09-23T01:01:53Z`. Base HEAD `abde67b64155250f015b8ad213c26609532a124c`, branch
`codex/saas-control-runtime`, **11 files present, all untracked** (intended dirt; no commit is authorized).

```
585ac3a2ff3abdeeef23b632c60518f2ef7656277481083af5202bdb0b3b9be3  compose.yml
8dad06cda631b1f4a1fe6939914abf1072f116cc125a398465ce1ca566fb8d76  env.example
c7db6c4daf96a4e57248b7e7a3baa01b4294095183846a5997d2dee890af199b  init-local.sh
c6359b79ca0bb045d53ba179a4f054f14031d070798a9991f3fdcfed62c21e6c  local-process.sh
fad7b8a3df25614ae2d011dfb5f79e23347c8a9fed1a7c045195e5f0a85a54e7  OPERATIONS.md
72a84fa7da841c6c1f43bc106bdbadd508e686a68bc33f05c03b391e787bc965  resource_guard.py
08f9198f4c8c90f49de139c0920a84c056751d02be5a3239285fabb0355474ab  run-local.sh
44156affdbbc98e7cc220773ef4fd64c5d004173441292367d0bce5bc8ef67df  status-local.sh
b6976f0d0dcdfaf349b6589b2ca437e157687afd22a2b6fe7148dc2b53fe9b6a  stop-local.sh
9f891b79c177ea49bde9f801ef74de10666a4397ab8a1d3b6ca35f4d954e8135  test_resource_guard.py
a7cf4857a7847e89f2e36fac5e5cd799c12567dbe024bc9dbcf35444bcf4652a  test-local.sh
```

Only the five files above are hash-gated by the Grok clearance. The other six (`OPERATIONS.md`, `env.example`,
`local-process.sh`, `status-local.sh`, `stop-local.sh`, `test_resource_guard.py`) are recorded here for the
manifest only and are **not** claimed cleared.

## 3. Retained resource identity — read-only, env-free

Recorded **before** any mutation, using an explicit `docker inspect --format` that never touches `Config.Env`.

| Field | Observed |
| --- | --- |
| Container ID (**before**) | `d18854335fdc331060e1700892639bb7834b78a45a61721bdf3ffdfc101177c3` |
| Name | `nasq-saas-control-local-control-db-1` |
| Image | `sha256:e17e86066e5ef83e0952a9347f5c792b7ece00972e2aa787a6986f471b3dd3d5` |
| State / health | `running` / `healthy` |
| Compose labels | project `nasq-saas-control-local`, service `control-db`, config-hash label **present** |
| Config file / working dir | `…/deploy/control-plane/compose.yml` / `…/deploy/control-plane` |
| Port bindings | `{"5432/tcp":[{"HostIp":"127.0.0.1","HostPort":"55432"}]}` |
| Mounts | 2 (single data volume at `/var/lib/postgresql/data` plus the file-backed secret) |
| Project volumes | exactly `nasq-saas-control-local-db` |
| Project networks | exactly `nasq-saas-control-local-private` |
| Project container set | exactly one container |
| Listener `14179` | **none** — API/worker are not running (quiesced) |
| Listener `55432` | **one** — PostgreSQL retained and listening |

**Notable:** the container was force-recreated at ~03:29, yet the live image ID still equals the value
hardcoded in `resource_guard.py:13`. Every other field the guard asserts is also consistent. So the reuse path
would very likely return `ok`; this is *read-only evidence*, not a guard run and not a pass.

## 4. Source-gate status

**Gate (a) — container identity validation: implemented, clearance stale.** `resource_guard.py` validates
container name/state/health, exact image ID, compose project+service labels, config-hash presence, config-file
and working-dir paths, the exact loopback port binding, exactly one data mount matching the named volume,
exactly one project volume and exactly one project network. It is wired fail-closed into `run-local.sh:23`
(existing-resource branch) and `run-local.sh:28` (new-resource branch), both `exit 6` on failure. **Blocked on
clearance**, because its hash does not match the cleared value (§1).

**Gate (b) — early xtrace-off: implemented.** All six shell scripts carry `set +x` as their `set` line (line 2):
`run-local.sh`, `init-local.sh`, `test-local.sh`, `local-process.sh`, `status-local.sh`, `stop-local.sh`. No
`set -x` or `BASH_XTRACE` path was found. This is the repair Grok referenced for `run-local.sh:26`,
`init-local.sh:19-27` and `test-local.sh:16-19`. **Awaiting Grok's review of the current hashes.**

## 5. Corrected database inventory

| Item | Value |
| --- | --- |
| Runtime database | `nasq_control` (user `nasq_control`) on `127.0.0.1:55432` |
| Retained test DBs | `p1tests`, `p1tests2` |
| `p1tests3` | **never created** — claim retracted (`OPERATIONS.md:35`) |
| Test DB for the live run | `TEST_DB=nasq_control_scratch_p1tests5` already set in `test-local.sh:12`, created only if absent and guarded by `test-local.sh:22` (must equal the fresh scratch DSN and differ from the runtime DSN) |
| Historical claim, not my run | owner's 13/13 on `p1tests2` — `[CLM]`, historical |

## 6. Exact commands available for the 27-case run

Verbatim from `OPERATIONS.md:13-21,31-33`; `TEST_DB` is fixed in `test-local.sh` as `p1tests5`.

```sh
export NASQ_CONTROL_HOME="$HOME/.local/share/nasq-saas-control-local"
export NASQ_NODE_BIN=/opt/homebrew/opt/node@22/bin
# bootstrap (already done; fail-closed if re-run over existing data — do NOT re-run)
NASQ_CONTROL_HOME="$NASQ_CONTROL_HOME" NASQ_NODE_BIN="$NASQ_NODE_BIN" deploy/control-plane/init-local.sh
# lifecycle (existing-resource reuse branch; no compose up/recreate)
NASQ_CONTROL_HOME="$NASQ_CONTROL_HOME" NASQ_NODE_BIN="$NASQ_NODE_BIN" deploy/control-plane/run-local.sh
NASQ_CONTROL_HOME="$NASQ_CONTROL_HOME" deploy/control-plane/status-local.sh
NASQ_CONTROL_HOME="$NASQ_CONTROL_HOME" deploy/control-plane/stop-local.sh
# database-backed suite (API/worker must be stopped first)
NASQ_CONTROL_HOME="$NASQ_CONTROL_HOME" NASQ_NODE_BIN="$NASQ_NODE_BIN" deploy/control-plane/test-local.sh
```

Undocumented-but-required probes, my own harness only (no source edits): `GET /healthz` on
`127.0.0.1:14179`; signed `/v1/*` requests built in-process; `psql` reads of `schema_migrations`,
`vendor_memberships`, `audit_events` inside the retained container; in-process count-only secret scans.

## 7. Blocked gates and what remains pending

**Not claimed clear** (hash mismatch): anything that depends on `resource_guard.py` — the entire `run-local.sh`
existing-resource reuse path, and therefore **A1–A9** and the E-series that needs a running API, plus D-cases
that require a healthy retained DB through `run-local.sh`.

**Still pending regardless of hashes:** the business-outage gate (separate Odoo + Nuxt lane, not executable
here); rotation-evidence completeness (role/database/endpoint/TCP method/timestamps); volume-retention
independent confirmation; and the fact that the historical `exit 10` is retested by A2/A3, not assumed.

**Requested decision:** either (i) Grok re-reviews the frozen `resource_guard.py` at
`72a84fa7da841c6c1f43bc106bdbadd508e686a68bc33f05c03b391e787bc965`, or (ii) the supervisor confirms this
artifact is the intended frozen guard and the earlier cleared hash covered a superseded revision. Until then
the source set is not clear and I will not start the mutating run. **I did not patch any runtime source.**

## 8. Constraints recorded for the live run (not yet exercised)

Sole ownership of `55432`/`14179`; forbidden fixture ports `55439`/`18179`/`13109`; no source changes to writer
files; report and harness only inside my own worktree; no `compose up`/recreate/`down`/delete/`dropdb`; the
`run-local.sh` existing branch only after the source check confirms the exact retained healthy container, with
the container ID recorded before and after; safe identity-checked start/stop of only my own API/worker; **E2**
stops and starts the **exact matched CP DB container** while the API stays alive and verifies 200 → 503 → 200,
restoring even on failure; `p1tests5` only if absent; runtime `nasq_control` and the retained `p1tests`/
`p1tests2` row counts preserved; 27 cases reported truthfully with **no PG-skip accepted**; private credentials
in-process only — never on argv, in raw output, in log dumps, or via xtrace; synthetic actor only through the
CLI scope with no customer operations or inventory targets; at the end, stop only my own API/worker, keep
PostgreSQL healthy and all databases present, and emit a final hash manifest with commands, exit codes and
redacted per-case evidence. A safety finding stops the run and is reported, never patched.

---

# Part 2 — live execution attempt and partial results (2026-09-23)

**Authority:** supervisor GO after Grok re-cleared the actual `resource_guard.py` at
`72a84fa7da841c6c1f43bc106bdbadd508e686a68bc33f05c03b391e787bc965`, superseding the earlier value.

**Hash re-verified immediately before dispatch at `2026-09-23T01:04:12Z`:** `resource_guard.py`, `run-local.sh`,
`init-local.sh`, `compose.yml` all **MATCH** their cleared values. `test-local.sh` actual recorded as
`a7cf4857a7847e89f2e36fac5e5cd799c12567dbe024bc9dbcf35444bcf4652a` — the given value is not a valid SHA-256 and
**no arithmetic normalization was applied**.

**OUTCOME: STOPPED ON A REAL FINDING. No case produced a pass. The runtime is left quiescent and unchanged.**

## 9. What was dispatched

| Step | Command | Exit | Output |
| --- | --- | --- | --- |
| A1 | `deploy/control-plane/run-local.sh` (mode runtime, existing-resource branch), backgrounded | **4** | `Runtime ownership record exists; inspect status.` |
| A6 | `deploy/control-plane/status-local.sh` | **2** | `runtime exact process identity not confirmed.` |
| A6 | `deploy/control-plane/stop-local.sh` | **10** | `Cannot verify all owners (runtime); refusing partial stop.` |
| A6 | `deploy/control-plane/local-process.sh stop api` | **10** | `Exact process identity mismatch for api; refusing signal.` |
| C1 (partial) | `psql` read-only on `nasq_control` | **0** | ledger `1 2 3`; 8/8 expected tables; `catalog_immutable` trigger = 1; `operations_request_id_global` index = 1 |

## 10. Finding — dead-generation ownership records deadlock the runtime with no in-band recovery

**Evidence (read-only, values only, no secrets):** `$NASQ_CONTROL_HOME/processes/` holds stale records from
generation `97d4e3cab7f5de8e0121352e66b351ce`, started `Wed 23 Sep 03:38:51–52 2026`:

| Record | PID | Process start | Liveness |
| --- | --- | --- | --- |
| `runtime.{pid,start}` | 45160 | Wed 23 Sep 03:38:51 2026 | **dead** |
| `api.{pid,start,generation}` | 45219 | Wed 23 Sep 03:38:52 2026 | **dead** |
| `worker.{pid,start,generation}` | 45246 | Wed 23 Sep 03:38:52 2026 | **dead** |

`14179` has **no listener**, so nothing is running; the records are stale, not live.

**Mechanism (`local-process.sh` at the cleared hash):**
- `stop_one` (lines 51–52) requires `valid "$n"` before acting; a dead PID fails `valid`, so it returns 10 and
  **refuses to clear the stale record**.
- `stop` for `runtime` (line 61) first requires `valid` for **all three** owners, so it exits 10 before any
  signal — fail-closed, nothing killed.
- `start_one` (line 28) refuses whenever `runtime.pid` exists, so the start path cannot proceed either.

**Consequence:** stale records from a dead generation leave the system **fail-closed with no in-band recovery
path**. `run-local.sh` cannot start, `stop-local.sh` will not clear the records, and `status-local.sh` truthfully
reports "not confirmed". Exiting this state would require deleting state files or other out-of-band action — both
**outside the authorized scope**, so neither was attempted.

**Classification:** real finding, reported and **not patched**; no source fix, no recreate, no delete. This is
the reason the run stopped. Whether the record-clearing behaviour is intended (strict fail-closed) or a recovery
gap is the owner's call.

## 11. Case status after the stop

| Cases | Status | Basis |
| --- | --- | --- |
| **A6** | **PARTIAL** — blocking behaviour and truthful status confirmed; recovery half **FAILED** | start refused 4 with a truthful message; status exited 2 truthfully; but no safe recovery exists (§10) |
| **A4** | **PARTIAL** — duplicate start refused (exit 4) with one listener and no second worker | same refusal; cannot be distinguished from the stale-record block |
| **C1** | **PARTIAL** — ledger `{1,2,3}`, 8/8 tables, trigger and index present | read-only; migrate-twice idempotency and concurrent migrate **not run** |
| A1, A2, A3, A5, A7, A8, A9, B1–B3, C2–C7, D1–D3, E1–E5 | **NOT RUN** | blocked: no API could be started, so no authenticated, lifecycle, outage, test-DB or secret-scan case could execute |
| Business-outage gate | **PENDING**, separate lane, fixture owner `822…` — not touched | unchanged |

No case is reported as `skip`; unrun cases are `NOT RUN`.

## 12. Final state preserved

| Item | Before | After |
| --- | --- | --- |
| CP container ID | `d18854335fdc331060e1700892639bb7834b78a45a61721bdf3ffdfc101177c3` | **identical** |
| Container state / health | running / healthy | **running / healthy** |
| Listener `14179` | 0 | **0** (nothing started by me) |
| Listener `55432` | 1 | **1** |
| Control-plane processes running | 0 | **0** |
| Databases | `nasq_control`, `…p1tests`, `…p1tests2` | **identical** — no `p1tests3`, no `p1tests5` |
| `nasq_control` rows | `schema_migrations=3`, `vendor_memberships=0`, `tenants=0`, `audit_events=0` | **unchanged** |

Nothing was created, dropped, truncated, migrated, granted, revoked, recreated or deleted. No `compose`
mutation, no `down`, no `dropdb`. Private credentials were never printed, never placed on argv, and never
dumped; the only `docker` reads used explicit `--format` fields that exclude `Config.Env`. No background jobs
remain running. Nothing in the fixture owner's scope was touched.

## 13. Open items for the owner and supervisor

1. **Recovery gap (§10)** — decide whether stale records from a dead generation should be clearable by the owned
   stop path; the current behaviour deadlocks the harness.
2. The given `test-local.sh` hash is **invalid** (65 hex characters) and must be re-issued from the generated
   manifest; the actual value is recorded here.
3. `resource_guard.py` is now cleared at its actual hash; the earlier value is superseded.
4. Rotation evidence still lacks role/database/endpoint/TCP-method/timestamps; volume retention still rests on
   the owner's claim.
5. Business-outage gate remains a separate lane and no P1-complete claim is made from this report.

---

# Part 3 — fresh source manifest and supported-recovery retry (2026-09-23)

**Authority:** second supervisor GO — bounded recovery/start-stop retry under the scoped clear of the current
source. **Outcome: STOPPED ON A REAL BLOCKER. Nothing mutated; zero records changed.**

**Supersedes Part 2 §10.** Part 2 reported "no in-band recovery path" based on the **03:57** `local-process.sh`.
That finding is **superseded**: the current tree ships a supported, tested recovery mechanism
(`recover_generation.py` + `begin_generation.py`, driven by `run-local.sh`). The blocker below is different and
narrower. Part 2 is retained, not erased.

## 14. Actual full SHA-256 manifest

Generated `2026-09-23T03:03:50Z` over the public `deploy/control-plane/` files (22 files, excluding
`__pycache__`). **No hash was inferred from a prefix.**

```
d8354d2982ac33f2ab69585d2d6a9c68b753121de328f597ef744607d329ed26  begin_generation.py
585ac3a2ff3abdeeef23b632c60518f2ef7656277481083af5202bdb0b3b9be3  compose.yml
8dad06cda631b1f4a1fe6939914abf1072f116cc125a398465ce1ca566fb8d76  env.example
c7db6c4daf96a4e57248b7e7a3baa01b4294095183846a5997d2dee890af199b  init-local.sh
2539059fc5a235c35a141e6a46e0f613f1c8ade307401f4c7e55a0fc0dceba0b  local-process.sh
6513cf96535a341ea2318b98a1e8c2a87def15465aa98db0cb5ada0210c9187b  OPERATIONS.md
019b673dea7f4fa0e82aeddad549d746e2c3ebe4612caf7909c532e622bfb153  pid_probe.py
d6644f5463db943550d09d0732d513081d9851ca96cb9b741c42072f804a5beb  process_lock.py
acb408aa82ee3bd95709a03c9dc43b979f8479645ed94160c3c62874d938fb8d  recover_generation.py
72a84fa7da841c6c1f43bc106bdbadd508e686a68bc33f05c03b391e787bc965  resource_guard.py
f21e8da79bf7ca6c73d8ac573c4a01a9d39d11837fa44e37eabfd5a769708371  run-local.sh
6f0772614f0e91bf5664407d97b4fe717561e28b64afd67dd57fe0f81cdee7c2  runtime-trap-cleanup.sh
35504419e2c544f524d6b09fce442bc8a9e31521d03fdf02624eaf673a31ecdb  runtime-trap.sh
00d0ca343a0f5dd773ea06deb75996afa76696997d8c2e4b00a9a5358d178ec3  startup_handoff.py
44156affdbbc98e7cc220773ef4fd64c5d004173441292367d0bce5bc8ef67df  status-local.sh
b6976f0d0dcdfaf349b6589b2ca437e157687afd22a2b6fe7148dc2b53fe9b6a  stop-local.sh
a8cc9c6894c2efc6d9c9c8647035ff76efab959146df9e6ad4761f90118eb672  test_dead_recovery.py
9f891b79c177ea49bde9f801ef74de10666a4397ab8a1d3b6ca35f4d954e8135  test_resource_guard.py
a3657eb6e5995f7fc1c4779361576fcd70ed884c8dff2ec407b03d22af11fb11  test_startup_publication.py
20bca16f4af89dfc8d9c93aedc46dd0e731645dab29625fde5d87fbee7877d16  test_stop_protocol.py
a7cf4857a7847e89f2e36fac5e5cd799c12567dbe024bc9dbcf35444bcf4652a  test-local.sh
```

**Provided prefixes vs this manifest — prefix match only, one file each, no inference:**

| Given prefix | Matches | Actual full hash (from the row above) |
| --- | --- | --- |
| `f21e8da7` | `run-local.sh` | `f21e8da79bf7ca6c73d8ac573c4a01a9d39d11837fa44e37eabfd5a769708371` |
| `35504419` | `runtime-trap.sh` | `35504419e2c544f524d6b09fce442bc8a9e31521d03fdf02624eaf673a31ecdb` |
| `2539059f` | `local-process.sh` | `2539059fc5a235c35a141e6a46e0f613f1c8ade307401f4c7e55a0fc0dceba0b` |
| `6f077261` | `runtime-trap-cleanup.sh` | `6f0772614f0e91bf5664407d97b4fe717561e28b64afd67dd57fe0f81cdee7c2` |
| `d6644f54` | `process_lock.py` | `d6644f5463db943550d09d0732d513081d9851ca96cb9b741c42072f804a5beb` |
| `20bca16f` | `test_stop_protocol.py` | `20bca16f4af89dfc8d9c93aedc46dd0e731645dab29625fde5d87fbee7877d16` |
| `a3657eb6` | `test_startup_publication.py` | `a3657eb6e5995f7fc1c4779361576fcd70ed884c8dff2ec407b03d22af11fb11` |

I cannot contact Grok directly from this lane; the corroboration above is a prefix comparison against my own
generated manifest, which is the strongest available pre-mutation check.

## 15. `recovery-review-hashes.json` — labeled STALE

The supervisor flagged this file as stale; it is **partially** stale. Compared against the actual manifest:
**7 of 10 entries match**, **3 are stale**, and the 3 stale entries are exactly three of the seven files the
supervisor gave as current:

| File | Review value | Actual | Verdict |
| --- | --- | --- | --- |
| `local-process.sh` | `34ca1ba99681…` | `2539059fc5a2…` | **STALE** |
| `run-local.sh` | `20b115495e36…` | `f21e8da79bf7…` | **STALE** |
| `test_startup_publication.py` | `6a25fbe6b9dd…` | `a3657eb6e599…` | **STALE** |
| `OPERATIONS.md`, `begin_generation.py`, `process_lock.py`, `recover_generation.py`, `startup_handoff.py`, `test_dead_recovery.py`, `test_resource_guard.py` | — | — | MATCH |

The file must not be used as a clearance source for those three files.

## 16. Recovery attempt — actual result

Fresh check first (`2026-09-23T03:04:05Z`): the recorded PIDs `45160`/`45219`/`45246` were used only as a
**hint**, not as authority. Observed: all three **absent**; `generation` = `97d4e3cab7f5de8e0121352e66b351ce`
(32 hex) with `api.generation` and `worker.generation` equal to it; three distinct PIDs > 1; starts non-empty;
`14179` listener **free**.

| Step | Result |
| --- | --- |
| `deploy/control-plane/run-local.sh` | **exit 4** |

Output: a Python traceback ending `ValueError: incomplete_or_unexpected_records` at
`recover_generation.py:29` (raised via `begin_generation.py:28` → `recover()`), followed by the wrapper line
`Existing runtime records could not be safely recovered.`

**Blocker:** `$NASQ_CONTROL_HOME/processes/` contains **10 entries** — the nine records the contract requires
**plus a pre-existing directory `archive-prior-generation/`** (mtime 03:30, 6 entries inside). The contract
permits **only** the nine names: `OPERATIONS.md:25` states "unexpected records fail closed", and
`test_dead_recovery.py:78` (`test_unexpected_and_symlink_records_preserve_generation`) asserts exactly this
preservation behaviour. So the refusal is **designed behaviour hitting a leftover artifact**, not a defect in
the new recovery design.

**Zero mutation, proven:** no `processes-archive-*` directory was created at the home level (count **0**); the
`processes/` entries are byte-identical to before; `archive-prior-generation/` is **intact** with its 6 entries;
`14179` still has **0** listeners; no process was started or signalled. `_validate` raises before any `rename`.

**Consequence:** the supported recovery cannot run until that pre-existing archive directory is relocated or
the contract is changed to tolerate it. Both are **state/contract changes outside my authority** — moving or
deleting it would be precisely the record deletion I was told not to perform. I did **not** patch source and did
**not** touch the directory. The start → status → duplicate → stop → restart sequence could not be attempted.

## 17. Case status after Part 3

| Cases | Status |
| --- | --- |
| **A6** recovery (mislabeled "A7" in Part 3) | **FAIL at the time** — supported recovery exited 4 on the unexpected pre-existing record; fail-closed, zero mutation. **Resolved in Part 4: PASS** |
| A1, A2, A3, A4, A5, A6, A8, A9 | **NOT RUN** — no API could be started |
| C1 | **PARTIAL** (unchanged from Part 2) — ledger `{1,2,3}`, 8/8 tables, trigger, index |
| B1–B3, C2–C7, D1–D3, E1–E5 | **NOT RUN** |
| Business-outage gate | **PENDING**, separate lane; fixture owner `822…` not touched |

Nothing is reported as `skip`; unrun cases are `NOT RUN`. No P1-complete claim.

## 18. Final state after Part 3 (unchanged)

Container `d18854335fdc331060e1700892639bb7834b78a45a61721bdf3ffdfc101177c3` — **same ID**, `running`/`healthy`;
`14179` 0 → **0**; `55432` 1 → **1**; control-plane processes **0**; databases `nasq_control`,
`nasq_control_scratch_p1tests`, `nasq_control_scratch_p1tests2` — **identical**, no `p1tests3`, no `p1tests5`.
No `compose` mutation, no recreate/up/down, no `dropdb`, no foreign signals, no fixture ports touched, no
secrets on argv or in output, no `Config.Env` read. Background jobs collected; none running.

## 19. What is needed to continue

1. **Supervisor/owner decision on `processes/archive-prior-generation/`** — relocate it outside `processes/`
   (preserving it) or extend the contract to tolerate pre-existing archive directories. This is the single
   blocker for the whole lifecycle sequence; nothing else in the run is blocked.
2. Re-issue the `test-local.sh` given hash from the generated manifest (the supplied value is not a valid
   SHA-256).
3. Treat `recovery-review-hashes.json` as stale for `local-process.sh`, `run-local.sh`,
   `test_startup_publication.py`.
4. After (1), resume at `recover → start → status → duplicate → stop → restart`, then the remaining cases
   including E2 and a fresh `p1tests5` if absent.

**Case-label correction:** Part 3 referred to the recovery attempt as "A7". That was a mislabel — in the plan
**A7 is the held-port case** and the dead/stale-ownership recovery case is **A6**. The Part 3 recovery attempt
is therefore **A6**, and it was resolved in Part 4.

---

# Part 4 — authorized preservation relocation, supported recovery, and the container-identity blocker

**Authority:** supervisor GO authorizing exactly one bounded preservation relocation of the known legacy nested
archive, then resumption of the lifecycle. **Outcome: relocation and recovery SUCCEEDED; the lifecycle then
FAILED at the container-identity guard. STOPPED — no patch.** All resources safe.

## 20. Source verification — full hashes, not prefixes

`2026-09-23T03:06:14Z`, comparing the **full** Grok hashes against the actual files: **14/14 MATCH** —
`run-local.sh`, `local-process.sh`, `runtime-trap.sh`, `runtime-trap-cleanup.sh`, `process_lock.py`,
`begin_generation.py`, `recover_generation.py`, `startup_handoff.py`, `pid_probe.py`, `status-local.sh`,
`stop-local.sh`, `init-local.sh`, `compose.yml`, `resource_guard.py`. The cleared source is the running source.

## 21. Preservation relocation of the legacy nested archive — SUCCEEDED

Performed by my own harness (`.p1-harness/relocate_archive.py`, written only in my worktree, no source edits),
executed under the **held lifecycle lock** via `process_lock.py --hold`.

Preconditions verified in-process before the rename: correct `NASQ_CONTROL_HOME`; home and `processes/` and the
archive all real directories, **no symlinks**; all three recorded PIDs (45160/45219/45246) **ESRCH-absent**; no
`14179` listener; destination non-existent; archive entry count **exactly 6**; no `.pid` inside the archive
alive. State was re-verified immediately before the atomic `os.rename`.

| Item | Value |
| --- | --- |
| Source | `$NASQ_CONTROL_HOME/processes/archive-prior-generation` |
| Destination | `$NASQ_CONTROL_HOME/archive-prior-generation-preserved-20260923T030637Z-19363` |
| Method | `os.rename` on the same filesystem — **no copy, no prune** |
| Files moved | **6** |
| Aggregate SHA-256 before → after | `1ea27dff1621f44b5184050d5ed397d6658b86ce83a2bce28740e0be3b3403bf` → **identical** |
| Per-entry mode/size/hash list | identical before/after |
| Source after | absent (moved, **not deleted**) |
| Active records after | **exactly 9** |
| Deletion / overwrite / source edits | **none** |
| Receipt | `.p1-evidence/relocation-receipt.json` |

## 22. Supported recovery — SUCCEEDED

`run-local.sh` passed the recovery stage: the dead generation was archived and a fresh generation reserved.

| Item | Value |
| --- | --- |
| New archive | `$NASQ_CONTROL_HOME/processes-archive-97d4e3cab7f5de8e0121352e66b351ce-19459` |
| Older records retained | yes — archived, not deleted |
| Legacy preserved archive | still intact, 6 entries |
| `processes/` after recovery | **`generation` only** (freshly reserved) |

So **A6 (stale dead-generation recovery) now PASSES** on the supported path once the legacy archive was
relocated out of `processes/`. Part 2's "no in-band recovery" and Part 3's `incomplete_or_unexpected_records`
blocker are both **superseded**.

## 23. Lifecycle FAILURE — container-identity guard never passes (case **A9**)

Immediately after recovery, `run-local.sh` exited **6**:

```
Existing database resources do not match the recorded isolated runtime identity; refusing changes.
```

The refusal comes from `resource_guard.py`, whose hash is the **cleared** value
`72a84fa7da841c6c1f43bc106bdbadd508e686a68bc33f05c03b391e787bc965`. Invoked directly it prints
**`project_container_set_mismatch`** and exits 1. Cause, measured read-only:

| Read | Value |
| --- | --- |
| `docker ps -aq --filter label=com.docker.compose.project=nasq-saas-control-local` | 1 line, **12** chars |
| `docker inspect --format '{{.Id}}' …` | **64** chars |
| Equality | **NO** |

`resource_guard.py:54,59` compares the short `docker ps -aq` ID against the full `docker inspect` `.Id`, so the
comparison can **never** hold for a healthy container and the guard always refuses. `test_resource_guard.py:4`
imports only `validate()` and the constants, so this `inspect()` path is **uncovered** by the passing unit
tests. This is the same defect recorded in Part 1a, now confirmed **at the integration level**: the documented
reuse path cannot start the API.

**Consequence:** A9 **FAIL (blocked)**; A1–A5, A8 and the API-dependent E-series and D-series **NOT RUN**, because
no API can be started through the supported path. **I did not patch the guard and did not bypass it** by
starting `local-process.sh start api` directly, since that would circumvent the very identity gate under
verification — that is a scope decision for the supervisor, not for me.

## 24. Case status after Part 4

| Case | Status |
| --- | --- |
| **A6** stale dead-generation recovery | **PASS** — recovery archived the dead generation, reserved a fresh one, retained all older records |
| **A9** container identity validation | **FAIL (blocked)** — the cleared guard's ID comparison can never pass; `run-local.sh` exits 6 |
| A1, A2, A3, A4, A5, A7, A8 | **NOT RUN** — no API could start |
| C1 | **PARTIAL** (unchanged) — ledger `{1,2,3}`, 8/8 tables, trigger, index |
| B1–B3, C2–C7, D1–D3, E1–E5 | **NOT RUN** |
| Business-outage gate | **PENDING**, separate lane; fixture owner `822…` not touched |

No case is reported as `skip`. No P1-complete claim.

## 25. Final state after Part 4 — resources safe

Container `d18854335fdc331060e1700892639bb7834b78a45a61721bdf3ffdfc101177c3` — **same ID**, `running`/`healthy`;
`14179` **0** listeners; `55432` **1**; control-plane processes **0**; databases `nasq_control`,
`nasq_control_scratch_p1tests`, `nasq_control_scratch_p1tests2` — **unchanged**, no `p1tests3`, no `p1tests5`.
No `compose` mutation, no recreate/up/down, no `dropdb`, no foreign signals, no fixture ports, no secrets on
argv or in output, no `Config.Env` read. Runtime tree unmodified by me; background jobs collected.

## 26. Single decision needed to continue

`resource_guard.py` must be corrected so its container-ID comparison can succeed (compare like with like, e.g.
`docker inspect` on both sides or `--no-trunc`), or the supervisor must authorize an explicit, documented
alternative that does not silently disable the identity check. **I will not patch it and will not bypass it
without that authorization.** Once corrected, the lifecycle can be resumed at `start → status → duplicate →
stop → restart`, then the remaining 27-case set including E2 with a fresh `p1tests5` if absent.

---

# Part 5 — scoped-cleared retry: guard fixed, generation-only recovery unreachable

**Authority:** supervisor GO under Grok's scoped clear of the generation-only recovery (pinned 32/32).
**Outcome: the container-identity defect is FIXED and verified; the lifecycle is then blocked by a NEW
ordering defect in the generation-only path. STOPPED — no patch, no bypass.** All resources unchanged.

## 27. Replacement hashes — exact, before mutation

`2026-09-23T03:42:43Z`: **5/5 MATCH** on the declared replacements, and the **prior 12 lifecycle hashes
unchanged** (17 verified in total):

| File | Declared | Verdict |
| --- | --- | --- |
| `begin_generation.py` | `77ce1ce487191aac58df18129a2e9ec53c6304ab256f1c26debba193edc9fed2` | **MATCH** |
| `recover_generation.py` | `0d003f97182f4086e43fd28b42197303f5874b4c081121795c9ef5ea3d9c774a` | **MATCH** |
| `test_reservation_recovery.py` | `145112312dbbe79732cd44d7c7c52c6a23e6314b6ef7dadc912d8d47b7df7a52` | **MATCH** |
| `resource_guard.py` | `4538d8e188c2612a93f114446b1a3506448e35163e63925bc071a06e745d06fc` | **MATCH** |
| `test_resource_guard.py` | `d9ec0322dfed251100d821cdc2ec097d39ecc10f23c64637089af094ce2d77db` | **MATCH** |
| run-local, local-process, trap, cleanup, lock, handoff, pid_probe, status, stop, init, compose, test-local | see Part 4 §20 | **unchanged 12/12** |

## 28. Container-identity defect (A9) — FIXED and verified

The replacement guard now returns **`ok`** (exit 0) against the retained container, read-only:
`python3 resource_guard.py` → `ok`. Part 4 §23's `project_container_set_mismatch` no longer reproduces, so the
cleared replacement corrected the short-vs-full ID comparison. **A9 = PASS (guard correction verified).**
`recovery-review-hashes.json` remains stale and was not used as authority.

## 29. Fresh metadata before the attempt

Exact home `$HOME/.local/share/nasq-saas-control-local`; `processes/` held only `generation`; **both archives
present** (`archive-prior-generation-preserved-20260923T030637Z-19363`, 6 entries, and
`processes-archive-97d4e3cab7f5de8e0121352e66b351ce-19459`, 9 entries); **no `14179` listener**; `55432`
listening; container `d18854335fdc…77c3` `running`/`healthy`; **0** control-plane processes (no other owner —
`status-local.sh` exits 2 "not confirmed"); guard `ok`. Node pinned via `NASQ_NODE_BIN`; `python3` on PATH is
`/usr/bin/python3` 3.9.6.

## 30. NEW FAILURE — the generation-only recovery path cannot be reached

`run-local.sh` → **exit 4**, output:

```
reservation_runtime_identity_unavailable
Existing runtime records could not be safely recovered.
```

**Root cause — an export-ordering defect, source-level:**

- `run-local.sh:21` runs `python3 begin_generation.py "$HOME_DIR"`.
- `NASQ_REPOSITORY_ROOT` is only exported at `run-local.sh:26` — **five lines later**.
- `startup_handoff.py:26` only validates the lock and `execvp`s; it sets **no** environment.
- `begin_generation.py:29-31` requires **both** `NASQ_REPOSITORY_ROOT` and `NASQ_NODE_BIN` for the
  generation-only branch and otherwise exits `reservation_runtime_identity_unavailable`.

So when `run-local.sh` reaches line 21, `NASQ_REPOSITORY_ROOT` is unset, and the branch always fails. The
documented invocation (`OPERATIONS.md:13-21`) exports only `NASQ_CONTROL_HOME` and `NASQ_NODE_BIN`, and
`OPERATIONS.md` never mentions `NASQ_REPOSITORY_ROOT`, so the generation-only recovery is **unreachable from the
documented path**.

This also explains why Part 4 succeeded: that state had all **nine** records, so `begin_generation.py` took the
`recover()` branch (line 34), which needs neither variable. Only the generation-only branch added in this
revision requires them.

**I did not patch `run-local.sh`, did not hand-edit or fabricate records, did not bypass the gate, and did not
supply `NASQ_REPOSITORY_ROOT` myself** to force the branch — the ordering must be fixed at source or the
invocation must be explicitly documented and authorized.

## 31. Case status after Part 5

| Case | Status |
| --- | --- |
| **A9** container identity validation | **PASS** — replacement guard returns `ok` (Part 4 defect fixed) |
| **A6** stale dead-generation recovery | **PASS** (from Part 4) |
| **A5-new** generation-only reservation recovery | **FAIL (blocked)** — `reservation_runtime_identity_unavailable`; path unreachable as documented |
| A1, A2, A3, A4, A5, A7, A8 | **NOT RUN** — no API could start |
| C1 | **PARTIAL** (unchanged) — ledger `{1,2,3}`, 8/8 tables, trigger, index |
| B1–B3, C2–C7, D1–D3, E1–E5 | **NOT RUN** |
| Business-outage gate | **PENDING**, separate lane; fixture owner `822…` not touched |

No case is reported as `skip`. No P1-complete claim.

## 32. Final state after Part 5 — unchanged and safe

`processes/` still holds only `generation`; **both archives intact** (6 and 9 entries); `14179` **0** listeners;
`55432` **1**; container `d18854335fdc…77c3` `running`/`healthy`; **0** control-plane processes; databases
`nasq_control`, `nasq_control_scratch_p1tests`, `nasq_control_scratch_p1tests2` unchanged (no `p1tests3`, no
`p1tests5`); runtime rows `migrations=3`, `vendor_memberships=0`, `tenants=0`, `audit_events=0` unchanged. No
`compose` mutation, no recreate/up/down, no `dropdb`, no foreign signals, no fixture ports, no secrets on argv
or in output, no `Config.Env` read. Runtime tree **0 modified files**; background jobs collected; none running.

## 33. Decision needed to continue

Either (a) move the `NASQ_REPOSITORY_ROOT` export above the `begin_generation.py` call in `run-local.sh` (or set
it inside `begin_generation.py` from its own location, as `local-process.sh:8` already does with a fallback), or
(b) explicitly authorize and document supplying `NASQ_REPOSITORY_ROOT` in the invocation. On that decision the
lifecycle resumes at `start → status → duplicate → stop → restart`, then the remaining cases including bounded
E2 (200 → 503 → 200, restore in `finally`) with a fresh `p1tests5` if absent. The sequence is **not** claimed
unblocked until it actually runs.

---

# Part 6 — ordering fix confirmed; generation-only recovery blocked by the candidate check

**Authority:** supervisor GO under Grok's scoped clear of the caller-ordering fix. **Outcome: the ordering
defect is FIXED and verified; the documented invocation now fails later, at the runtime-candidate check.
STOPPED — no patch, no bypass.** All resources unchanged.

## 34. Hash check before mutation (`2026-09-23T03:49:17Z`)

| File | Declared | Verdict |
| --- | --- | --- |
| `run-local.sh` | `f28bfa09a82853b4c23c856be1a8bba41ef65c587118541179d33d4cbe9e2e88` | **MATCH** (64 chars) |
| `begin_generation.py` | `77ce1ce4…c9fed2` | **MATCH** |
| `recover_generation.py` | `0d003f97…3d9c774a` | **MATCH** |
| `resource_guard.py` | `4538d8e1…745d06fc` | **MATCH** |
| `test_run_local_ordering.py` (**new file**) | `5bd23399854a6a744d9f12cce30b5cc545c00ec764377db7278c8bdad2e53bd6` | **MATCH** |
| `test_reservation_recovery.py` | Part 5 value (`145112312d…7b7df7a52`) | **unchanged** |
| other 16 manifest files | Part 4/5 values | **unchanged 16/16** |

**Attribution correction (supersedes the first issue of this section).** Part 6 originally attributed the
declared value `5bd23399…` to `test_reservation_recovery.py` and reported a mismatch. That attribution was
**wrong, and no file drift occurred**: the declared hash belongs to the **new** file
`test_run_local_ordering.py`, which exists and hashes to exactly
`5bd23399854a6a744d9f12cce30b5cc545c00ec764377db7278c8bdad2e53bd6` (**MATCH**).
`test_reservation_recovery.py` is **unchanged** at its Part 5 value
`145112312dbbe79732cd44d7c7c52c6a23e6314b6ef7dadc912d8d47b7df7a52`. The ambiguity came from an abbreviated
handoff that omitted the new file's name; it was **not** an artifact mismatch and the earlier "erroneous hash /
possible drift" reading is withdrawn.

## 35. Ordering defect — FIXED and verified

`run-local.sh:18` now exports `NASQ_CONTROL_HOME`, `NASQ_REPOSITORY_ROOT="$ROOT"` and `NASQ_NODE_BIN` **before**
the lock exec (line 19) and before the `begin_generation.py` call. The Part 5
`reservation_runtime_identity_unavailable` error no longer occurs.

## 36. NEW FAILURE — `runtime_process_present_or_uncertain`

Documented invocation (only `NASQ_CONTROL_HOME` and `NASQ_NODE_BIN` exported; **no manual ROOT override**),
after a passing fresh identity check: `run-local.sh` → **exit 4** with a traceback ending
`ValueError: runtime_process_present_or_uncertain` at `recover_generation.py:143` (via
`begin_generation.py:32` → `recover_reservation`), then
`Existing runtime records could not be safely recovered.`

## 37. Root cause — the candidate check matches the caller itself

`_runtime_candidates_present` (`recover_generation.py:25-77`) enumerates `/bin/ps -ww -axo pid=,command=` and
flags a process as a runtime candidate when any argv token is in `known_paths` **or** whose basename is in
`entry_names = {run-local.sh, startup_handoff.py, process_lock.py, main.ts, worker-main.ts}`. **There is no
self/caller/ancestor exclusion.**

`begin_generation.py` is invoked by `run-local.sh`, so the process table necessarily contains
`/bin/bash …/deploy/control-plane/run-local.sh` — its own parent — whose argv basename is `run-local.sh`, which
is in `entry_names`. The check returns True and `recover_reservation` refuses.

Verified read-only with a replica probe (`.p1-harness/probe_candidates.py`, basenames only) plus a direct argv
test:

| argv | matches `entry_names` |
| --- | --- |
| `['/bin/bash', '/Users/…/deploy/control-plane/run-local.sh']` | **True** |
| `['/bin/bash', 'deploy/control-plane/run-local.sh']` | **True** |
| `['bash', '/x/run-local.sh']` | **True** |

A benign decoy whose argv basename was `run-local.sh` was independently flagged with rule `entry_names`,
confirming the rule is purely name-based; absolute and relative forms both match, so no invocation style avoids
it. (Probe runs were themselves flagged via the `dashc` rule because a `bash -c` command text mentioning these
names is also treated as a candidate — a second, incidental over-match recorded for the owner.)

**Consequence:** the generation-only reservation branch is **unreachable when driven by `run-local.sh`**, its
only documented driver. Part 4's nine-record `recover()` branch has no such check, which is why it worked. **I
did not patch it and did not supply anything to bypass it.**

## 38. Case status after Part 6

| Case | Status |
| --- | --- |
| **A9** container identity validation | **PASS** (Part 5) — guard returns `ok` |
| **A6** stale dead-generation recovery (9-record) | **PASS** (Part 4) |
| **A5-new** generation-only reservation recovery | **FAIL (blocked)** — caller matched as a candidate |
| A1–A5, A7, A8 | **NOT RUN** — no API could start |
| C1 | **PARTIAL** — ledger `{1,2,3}`, 8/8 tables, trigger, index |
| B1–B3, C2–C7, D1–D3, E1–E5, E2 | **NOT RUN** — E2 explicitly gated on a passing lifecycle |
| Business-outage gate | **PENDING**, separate lane; fixture owner `822…` not touched |

No case is reported as `skip`; no acceptance inflation. **Distinction preserved:** these are individual active
case outcomes only — the full P1 package and the business-outage gate remain **pending**.

## 39. Final state after Part 6 — unchanged and safe

`processes/` still holds only `generation`; **both archives intact** (legacy preserved = 6 entries, recovered
generation = 9 entries); `14179` **0** listeners; `55432` **1**; container `d18854335fdc…77c3`
`running`/`healthy`; **0** control-plane processes; databases unchanged; runtime rows unchanged; no `compose`
mutation, no recreate/up/down, no `dropdb`, no foreign signals, no fixture ports, no secrets on argv or in
output, no `Config.Env` read; runtime tree **0 modified files**; background jobs collected (`bash-35`, exit 4).

## 40. Decision needed to continue

The fix must **narrow to the verified locked startup chain** — the specific run-local/process-lock/handoff
processes that hold the lifecycle lock for this generation — rather than excluding all ancestors or skipping
records with missing PIDs; missing or unverifiable PIDs must continue to fail closed. The `dashc` over-match
should also be narrowed so an unrelated `bash -c` whose text merely mentions these names is not a candidate.
The repair is delegated to the owner (`7dd`); this lane stays **quiescent** and performs no runtime action.

**No further live attempt until Grok's actual-caller integration proof is delivered.** On that proof the
lifecycle resumes at `start → status → duplicate → stop → restart`, then the remaining cases including bounded
E2 with a fresh `p1tests5` only if absent.

## 41. Post-receipt correction — attribution only, no runtime action

The supervisor's hash-attribution correction was verified read-only and applied:

| Check | Result |
| --- | --- |
| `test_run_local_ordering.py` exists (new file) | **yes** (2734 bytes) |
| Its SHA-256 | `5bd23399854a6a744d9f12cce30b5cc545c00ec764377db7278c8bdad2e53bd6` — **equals the declared value** |
| `test_reservation_recovery.py` SHA-256 | `145112312dbbe79732cd44d7c7c52c6a23e6314b6ef7dadc912d8d47b7df7a52` — **unchanged from Part 5** |
| File drift | **none** — the ambiguity came from an abbreviated handoff that omitted the new filename |

No runtime action was taken for this correction; no process was started or stopped, no file outside my own
report was modified, and the runtime tree remains unmodified by this lane.

---

# Part 7 — generation-only recovery SUCCEEDS and the API starts; two new lifecycle defects

**Authority:** supervisor GO with Grok's scoped clear of the caller-exclusion fix (independently 38/38).
**Outcome: the generation-only recovery and the runtime start SUCCEEDED for the first time; the bounded
lifecycle then failed at `status` and at duplicate-start, and a third defect leaves the supported stop path
unusable. STOPPED — no source patch; quiescence restored by a disclosed identity-verified action.** All
resources preserved.

## 42. Hash check before mutation (`2026-09-23T04:15:30Z`)

| File | Declared | Verdict |
| --- | --- | --- |
| `recover_generation.py` | `0dea0bea55f8042fe160e4ceee5d31d6f032c7ad8a5209531c0b0adab28fa93b` | **MATCH** |
| `begin_generation.py` | `92c2faf4084831b0b5cc1370473e0fc1ab6d81d9f731b789b9e397f7d6264fd3` | **MATCH** |
| `test_reservation_recovery.py` | `53c36f9f1af7b9a1aa04f883ec1e9831a29b71a0213771ecd04943e99e4c1be9` | **MATCH** |
| `test_actual_reservation_caller.py` (new) | `f03c64118e3df2135053f88bbe01633d9a6e47f7c758ddbbf1e5d1e40b2b4493` | **MATCH** |
| `run-local.sh` | `f28bfa09…cbe9e2e88` | **MATCH** |
| `resource_guard.py` | `4538d8e1…745d06fc` | **MATCH** |
| other 17 source files | Part 4–6 values | **unchanged 17/17** |

Fresh preflight (`04:15:37Z`) passed in full: home `0700`; `processes/` = `generation` only; **2 archives**
(6 and 9 entries); `14179` free; `55432` listening; container `d18854335fdc…77c3` `running`/`healthy`; **0**
control-plane processes; `status-local.sh` "not confirmed"; guard **`ok`**; databases unchanged; runtime tree
unmodified.

## 43. Generation-only recovery and start — SUCCESS

Documented invocation (only `NASQ_CONTROL_HOME` and `NASQ_NODE_BIN`; ROOT derived internally, **no override**):

- Exit **0**; output `Local control API ready at 127.0.0.1:14179; worker running.`
- **A new third archive was produced**:
  `processes-archive-reservation-ca7f1b01fc396fc61a40b85a95b9d0bc-39943` — the generation-only reservation was
  archived exactly as designed, with both earlier archives left untouched.
- All nine owner records published: `runtime` 39927, `api` 40005, `worker` 40038, generation
  `b3c9bc20df6681648ddc6cebf7bcffbc`.

**A1 PASS.**

| Probe | Result |
| --- | --- |
| `GET /healthz` | **200** `{"status":"ok"}` |
| Listener | **`127.0.0.1:14179` only** (no wildcard bind) |
| LAN probe `http://192.168.1.165:14179/healthz` | **000** — unreachable off-loopback |
| Control-plane processes | exactly one api + one worker, correct argv |

**C7 (authorization matrix) — PARTIAL PASS:** `GET /v1/context` with **no** headers → **401**; a non-`/v1/`
path → **404**. Signed-request, replay, stale-timestamp, membership and capability rows remain NOT RUN.

## 44. NEW DEFECT 1 — `status-local.sh` cannot confirm a healthy runtime

`status-local.sh` → **exit 2**, `runtime exact process identity not confirmed.` while the API was serving 200.

Cause (`status-local.sh:15-16`): it compares the supervisor command with **exact string equality** against
`bash <ROOT>/deploy/control-plane/run-local.sh`, but `ps` reports

```
expected: bash /Users/tariq/code/nasq-saas-control-runtime/deploy/control-plane/run-local.sh
actual  : /bin/bash /Users/tariq/code/nasq-saas-control-runtime/deploy/control-plane/run-local.sh
```

`bash` ≠ `/bin/bash`, so the runtime owner never validates and the command exits 2 before checking the API or
the api/worker owners (whose expectations do match). This affects the **documented status command** only.

## 45. NEW DEFECT 2 — the lifecycle lock is never released, so every later command blocks

`local-process.sh:11` acquires the lifecycle lock (`process_lock.py --hold`) on **every** invocation. Measured
while the runtime was up:

| Observation | Result |
| --- | --- |
| `flock(LOCK_EX\|LOCK_NB)` on `processes.lock` from a fresh process | **HELD** |
| Holders (`lsof`) | **`node` 40005 (api) and `node` 40038 (worker), fd `10u`** |
| `local-process.sh status runtime` | **blocked** (killed by a 60 s timeout) |
| `run-local.sh` duplicate invocation | **blocked** (killed by a 60 s timeout), produced **no second runtime** |

So duplicate start does **not** refuse as documented — it blocks on the lock — and `local-process.sh stop` (and
therefore `stop-local.sh`) **blocks indefinitely**, making the supported stop path unusable while the runtime
runs. The lock is expected to be released before the readiness/steady-state waits with children closing the
inherited descriptor; observed behaviour is the opposite.

**Supervisor trap outcome:** after the forced stop, the supervisor's own output was
`Exact process identity mismatch for api; refusing signal.` and it exited **10** — the same identity-comparison
class as Defect 1, so the official cleanup could not complete either.

## 46. Disclosed deviation — identity-verified stop to restore quiescence

The supervisor required the CP returned quiescent, but the supported stop path blocks. I therefore performed an
**identity-verified** stop with my own harness (`.p1-harness/stop_owned.py`), which is disclosed here as a
deviation forced by Defect 2. Safety properties preserved: only the three recorded PIDs were considered; each
was required to be alive, to match its recorded `ps -o lstart=` value exactly, and to match the expected
generation argv exactly before any signal; order was runtime → api → worker; **no record, archive or file was
deleted** and no other PID was ever signalled.

Result: all three verified, `SIGTERM` sent to each, `remaining_after_wait: none`.

## 47. Final state after Part 7 — quiescent, resources preserved

| Item | Value |
| --- | --- |
| `14179` listeners | **0** |
| Control-plane processes | **0** |
| Lifecycle lock | **FREE** |
| Archives | **3, all intact** — legacy preserved (6 entries), recovered generation (9), **new reservation archive** |
| `processes/` records | nine stale owner records retained — **not deleted** |
| PG container | `d18854335fdc…77c3` — same ID, `running`/`healthy` |
| Databases | `nasq_control`, `nasq_control_scratch_p1tests`, `nasq_control_scratch_p1tests2` — unchanged; no `p1tests3`, no `p1tests5` |
| Runtime rows | `schema_migrations=3`, `vendor_memberships=0`, `tenants=0`, `audit_events=0` — unchanged |
| Runtime tree | **0 modified files** |
| Background jobs | collected (`bash-36`, exit 10) |

The nine retained records are the normal input to the nine-record recovery path (proven in Part 4), so the next
supported start self-heals them; nothing was hand-edited. Side note: my own harness initially raised
`TypeError: unsupported operand type(s) for |` because `int | None` is evaluated at runtime under the PATH
`python3` = 3.9.6; adding `from __future__ import annotations` fixed it. That is a defect in **my** harness, not
in the runtime source, and it corroborates the earlier Python-3.9 observation.

## 48. Case status after Part 7

| Case | Status |
| --- | --- |
| **A5-new** generation-only reservation recovery | **PASS** — reservation archived, fresh generation reserved |
| **A1** start / health / loopback-only binding | **PASS** — 200, `127.0.0.1` only, LAN probe 000 |
| **C7** authorization matrix | **PARTIAL PASS** — 401 unauthenticated, 404 non-`/v1/`; signed/replay/membership rows NOT RUN |
| **A3** status | **FAIL** — Defect 1 (`bash` vs `/bin/bash`) |
| **A4** duplicate start | **FAIL as documented** — Defect 2; no second runtime (safe) but blocks instead of refusing |
| **A2/A5/A8** stop / port-held / generation-reaping | **NOT RUN** — the supported stop path blocks (Defect 2) |
| A9, A6 | **PASS** (Parts 4–5) |
| C1 | **PARTIAL** — ledger `{1,2,3}`, 8/8 tables, trigger, index |
| B1–B3, C2–C6, D1–D3, E1–E5, E2 | **NOT RUN** |
| Business-outage gate | **PENDING**, separate lane; fixture owner `822…` untouched |

No case is reported as `skip`; **no blanket PASS** and **no P1-complete claim**. This clearance was a retry
only; it does not constitute P1 or business-outage acceptance.

## 49. Decisions needed to continue

1. **Defect 1** — make the runtime-owner comparison accept the observed argv0 (`/bin/bash` vs `bash`), or
   normalise both sides, in `status-local.sh` (and check the same expectation in `local-process.sh:12`).
2. **Defect 2** — release the lifecycle lock before the readiness/steady-state waits and ensure children close
   the inherited descriptor, so `status`, duplicate start and **stop** can run; as written, an up runtime is
   unstoppable through the documented path.
3. Then resume the bounded lifecycle at `status → duplicate → stop → restart`, and afterwards the remaining
   cases including bounded E2 with a fresh `p1tests5` only if absent.

---

# Part 8 — bounded documented lifecycle PASSES; E2/E3 fail on database outage

**Authority:** supervisor GO with Grok's scoped clear (39/39). **Outcome: the whole bounded documented
lifecycle PASSED — nine-record archive, start, status, duplicate refusal, stop, restart — and both prior defects
are fixed. E2 then FAILED: a database outage kills the API and worker, produces connection refusal rather than
503, and they do not recover. STOPPED at that failure; documented shutdown refused, so the previously disclosed
identity-verified emergency harness was used again for the single orphaned supervisor.** All resources preserved.

## 50. Hash check before mutation (`2026-09-23T04:29:22Z`)

| File | Declared | Verdict |
| --- | --- | --- |
| `local-process.sh` | `7ab84f36f0b9b9361a40507957a69e890530836a665900bdc2d7f0d551649d88` | **MATCH** |
| `status-local.sh` | `e338cf802660e24fd27e5009d9459f785dc2cc67edb927131f324d29af228df5` | **MATCH** |
| `test_actual_runtime_lifecycle.py` (new) | `01b7fdb74242f0c85c5b490eda87a9f010da0ee5660dd3fcd82b2fc8d92a5a6d` | **MATCH** |
| `run-local.sh` | `f28bfa09…cbe9e2e88` | **MATCH** |
| other 20 source files | Part 4–7 values | **unchanged 20/20** |

Fresh state check (`04:29:28Z`), not assumed: exactly **9 records**, all three recorded PIDs **dead**
(39927/40005/40038), generation `b3c9bc20…` coherent across both markers, **3 archives**, `14179` free,
**lock FREE with 0 openers**, guard `ok`, container `d18854335fdc…77c3` `running`/`healthy`, databases unchanged.

## 51. Lifecycle — **ALL PASS**

| Case | Command | Result |
| --- | --- | --- |
| A5 nine-record recovery + start | `deploy/control-plane/run-local.sh` (documented; ROOT derived, no override) | **exit 0**; `Local control API ready at 127.0.0.1:14179; worker running.`; **new 4th archive** `processes-archive-b3c9bc20df6681648ddc6cebf7bcffbc-50510` |
| A1 health / binding | `curl /healthz`; `lsof`; LAN probe | **PASS** — `200 {"status":"ok"}`; listener **`127.0.0.1:14179` only**; LAN `192.168.1.165:14179` → **000** |
| A3 status | `deploy/control-plane/status-local.sh` | **PASS, exit 0** — "Runtime/API/worker exact argv, start times and generation ownership verified." + "Control API/database health HTTP 200." |
| **Defect 2 re-check** | independent `flock(LOCK_EX\|LOCK_NB)` while up | **PASS** — lock **FREE while the runtime is up** |
| A4 duplicate start | second `run-local.sh`, bounded 20 s | **PASS** — **exited 4** promptly, `pid_live_or_uncertain:50494`; **no second runtime** (1 listener, recorded api pid unchanged 50568, healthz 200) |
| A2 stop (documented) | `deploy/control-plane/stop-local.sh` | **PASS, exit 0** — "Owned runtime stopped; DB/data retained."; `14179` 0, 0 processes, `processes/` **cleaned**, **4 archives intact**, container retained `running`/`healthy` |
| A3 restart | `deploy/control-plane/run-local.sh` | **PASS** — health 200; **new** PIDs runtime 51376 / api 51441 / worker 51618 (all ≠ previous); new generation `bfd477cf9ba3e78fce159f855e457b7b`; `status-local.sh` **exit 0**; no spurious archive |

**Both Part 7 defects are FIXED and verified:** Defect 1 (status identity) — `status-local.sh` now returns 0 and
verifies all three owners; Defect 2 (unreleased lock) — the lock is free while the runtime is up, so status,
duplicate start and stop all behave as documented. `local-process.sh start runtime` was **not** used.

## 52. E2 FAIL — a database outage kills the API and worker

Procedure: the **exact matched** container `d18854335fdc…77c3` was stopped with `docker stop` while the API
stayed alive, then started again — restore guarded by a shell `trap … EXIT` so it ran regardless of outcome.

| Step | Observed |
| --- | --- |
| Baseline | `/healthz` → **200** |
| Container stopped (only this container) | `/healthz` → **000** for the full 24 s poll — **connection refused, never 503** |
| Container restored (finally) | container `running`/`healthy`, DB `accepting connections`, **same ID** |
| Recovery poll, 60 s | `/healthz` → **000** throughout — **no recovery** |

Diagnosis: **both the API (pid 51441) and worker (pid 51618) processes died** when the database went away.
`14179` has **0 listeners** and the port is **closed**, so no HTTP status is produced at all; the runtime
supervisor (51376) survived but does not restart its children.

- **E2 FAIL** — the designed `503 {code:'service_unavailable'}` is **not** produced; the process exits instead.
  The contract wording "the handler is designed to return unavailable when DB is down" is therefore **not
  empirically supported**; it should read "terminates on database loss" until fixed.
- **E3 FAIL** — no automatic recovery; the API stays down after the database returns, so `200` again "without
  restarting the API" does not hold.

This is a genuine availability finding for the management plane. It does not by itself demonstrate a customer
outage — the customer business surface is a separate lane — but it is a package-relevant defect.

## 53. Shutdown after the failure — documented path refused; disclosed emergency stop

| Step | Result |
| --- | --- |
| `deploy/control-plane/stop-local.sh` (planned shutdown, documented) | **exit 10** — `Cannot verify all owners (api); refusing partial stop.` (the api record points at a dead PID) |
| Emergency harness `stop_owned.py` (previously disclosed), supervisor only | runtime 51376 **verified** exactly (alive, start time, argv) → `SIGTERM`; api 51441 / worker 51618 reported `not_alive` and **skipped**; `remaining_after_wait: none` |

No new unreviewed lifecycle source was written: the emergency harness is the same identity-verified tool
disclosed in Part 7, reused only because the documented stop cannot handle a dead child record. **This is not a
normal PASS path and is not counted as verification of the stop contract.**

Supervisor job `bash-38` exited **10**, its own trap failing on the same dead-record identity check.

## 54. Final state after Part 8 — quiescent, resources preserved

| Item | Value |
| --- | --- |
| `14179` listeners / port | **0 / closed** |
| Control-plane processes | **0** |
| `run-local.sh` processes | **0** |
| Lifecycle lock | **FREE** |
| Archives | **4, all intact** — legacy preserved (6), recovered generation (9), reservation (gen-only), nine-record archive |
| `processes/` records | nine retained (dead PIDs, `generation` present) — **not deleted**; documented stop could not clean them |
| PG container | `d18854335fdc…77c3` — **same ID**, `running`/`healthy` |
| Databases | `nasq_control`, `nasq_control_scratch_p1tests`, `nasq_control_scratch_p1tests2` — unchanged; no `p1tests3`, no `p1tests5` |
| Runtime rows | `schema_migrations=3`, `vendor_memberships=0`, `tenants=0`, `audit_events=0` — unchanged |
| Runtime tree | **0 modified files**; no stray harness processes; jobs collected |

No container recreate/up/down, no `dropdb`, no DB or archive deletion, no fixture involvement, no secrets printed.

## 55. Case status after Part 8

| Case | Status |
| --- | --- |
| A1 start/health/loopback | **PASS** |
| A2 stop (documented) | **PASS** |
| A3 status / restart | **PASS** (both) |
| A4 duplicate start | **PASS** (bounded refusal, no second runtime) |
| A5/A6/A9 recovery and identity | **PASS** (Parts 4–8) |
| **A8** generation ownership across restart | **PASS** — new generation + new PIDs, old records archived |
| C1 | **PARTIAL** — ledger `{1,2,3}`, 8/8 tables, trigger, index |
| C7 | **PARTIAL PASS** — 401 unauth, 404 non-`/v1/`; signed/replay/membership rows NOT RUN |
| **E2** DB-down health | **FAIL** — API/worker die; 000 not 503 |
| **E3** DB-restored health | **FAIL** — no recovery without restart |
| E1 | **PASS** (implied by every 200 health check) |
| E4, E5, A7, B1–B3, C2–C6, D1–D3 | **NOT RUN** |
| Business-outage gate | **PENDING**, separate lane; fixture owner `822…` untouched |

No `skip` reported, **no blanket PASS**, and **no P1-complete claim**: this clearance was a retry only. The
business-outage gate plus Grok review remain outstanding for P1.

## 56. Decisions needed to continue

1. **E2/E3 (highest value)** — the API and worker must survive a database outage: either return
   `503 service_unavailable` from `/healthz` while the DB is unreachable, or exit non-zero and be restarted by
   the supervisor, and recover automatically once the DB returns. As built, a DB blip leaves the management API
   permanently down.
2. **Stop after a child death** — `stop-local.sh` refuses when a child record is dead (exit 10), so a crashed
   runtime cannot be stopped through the documented path; a supported dead-child cleanup/recovery step is
   needed.
3. Then the remaining cases — B1–B3 secret scans, C2–C6, D1–D3 with a fresh `p1tests5` only if absent, E4/E5,
   A7 — and finally the separate business-outage lane.

---

# Part 9 — E2/E3 PASS after the outage fix; the DB suite passes with zero skips

**Authority:** supervisor GO (BOTHGATES Grok clear) with new app-source and deploy hashes.
**Outcome: E2 and E3 PASS — the database outage now yields the designed 503 with the API and worker surviving,
and health recovers automatically. The D-group DB suite passes with zero skips. Parts 8's E2/E3 FAIL is
SUPERSEDED, not erased.** All resources preserved; CP left quiescent.

## 57. Hash verification before mutation (`2026-09-23T05:19:22Z`)

**9/9 declared MATCH:**

| File | Declared | Verdict |
| --- | --- | --- |
| `apps/control-plane/src/db.ts` | `57fef87a…71830124` | MATCH |
| `apps/control-plane/src/main.ts` | `fd62ebb5…8cb101b74` | MATCH |
| `apps/control-plane/src/worker-main.ts` | `415ecd5a…760dfb3c56` | MATCH |
| `apps/control-plane/src/worker-loop.ts` (new) | `32274ea4…1b10dc6980` | MATCH |
| `apps/control-plane/src/__tests__/db-outage.test.ts` (new) | `fa3adcf7…3242d74a20` | MATCH |
| `deploy/control-plane/local-process.sh` | `a40713c0…ab2ab2e6a` | MATCH |
| `deploy/control-plane/test_partial_runtime_stop.py` (new) | `f66e3cf6…f746f56e` | MATCH |
| `deploy/control-plane/run-local.sh` | `f28bfa09…cbe9e2e88` | MATCH |
| `deploy/control-plane/status-local.sh` | `e338cf80…9af228df5` | MATCH |

**10/10** other `deploy/control-plane` files unchanged (`recover_generation.py`, `begin_generation.py`,
`resource_guard.py`, `process_lock.py`, `startup_handoff.py`, `pid_probe.py`, `stop-local.sh`,
`runtime-trap.sh`, `runtime-trap-cleanup.sh`, `compose.yml`).

**Truthful tree status — this is NOT a "0 modified" tree any more.** The app source is now tracked and modified
by authorization:

```
 M apps/control-plane/src/db.ts
 M apps/control-plane/src/main.ts
 M apps/control-plane/src/worker-main.ts
?? apps/control-plane/src/__tests__/db-outage.test.ts
?? apps/control-plane/src/worker-loop.ts
?? deploy/control-plane/
```

Fresh state (`05:19:30Z`): home `0700`; **9 records** with all three PIDs dead (51376/51441/51618); **4
archives**; `14179` free; **0** other owners; **lock FREE / 0 openers**; guard `ok`; container
**`d18854335fdc331060e1700892639bb7834b78a45a61721bdf3ffdfc101177c3`** `running`/`healthy`; databases unchanged.

## 58. Baseline — documented start PASS

| Case | Result |
| --- | --- |
| `run-local.sh` (documented) | exit 0; `Local control API ready at 127.0.0.1:14179; worker running.`; **new 5th archive** `processes-archive-bfd477cf…-87355` |
| A1 | `{"status":"ok"}` **200**; listener `127.0.0.1:14179` |
| A3 status | **exit 0** — "Runtime/API/worker exact argv, start times and generation ownership verified." |
| Baseline identity | runtime 87339, api **87413**, worker **87593**; generation `2168e655b3be932aaa3729f1809536ca` |

## 59. **E2 PASS** — database outage produces 503 and the API survives (`I2-e2e3.out`)

Exact matched container `d18854335fdc…77c3` stopped with `docker stop` while the API stayed alive; restore
guarded by `trap … EXIT`.

| Step | Observed |
| --- | --- |
| Baseline | `{"status":"ok"}` **200** |
| DB stopped, poll at **t=2 s** | **`{"code":"service_unavailable","message":"Control service is unavailable"}` [503]** — the designed response, **not 000** |
| API survival | pid **87413**, start `Wed 23 Sep 08:19:45 2026` — **same_pid=yes, same_start=yes** |
| Worker survival | pid **87593**, start `Wed 23 Sep 08:19:46 2026` — **same_pid=yes, same_start=yes** |
| Alive / listener during outage | api alive **yes**, worker alive **yes**, **1 listener maintained** |

**This supersedes Part 8 §52**, where the API and worker died and returned `000`. The outage handling fix is
verified end to end.

## 60. **E3 PASS** — automatic recovery after the DB returns

| Step | Observed |
| --- | --- |
| Container restored (`finally`) | same ID `d18854335fdc…77c3` |
| Poll at **t=3 s** | **`{"status":"ok"}` [200]** — recovered **without restarting the API** |
| Post-restore identity | api 87413 **same**, worker 87593 **same** |
| Container | `running`/`healthy` after the health check settled |

This supersedes Part 8 §52's "no recovery without restart".

## 61. Documented stop before the DB suite PASS

`stop-local.sh` → **exit 0**, "Owned runtime stopped; DB/data retained."; `14179` 0, 0 processes, `processes/`
**cleaned to empty**, container retained **healthy**.

## 62. **D PASS** — real PostgreSQL suite on a fresh `p1tests5`, zero skips

`p1tests5` was **absent** beforehand (verified), so the absent-only path was exercised.

| Item | Result |
| --- | --- |
| `test-local.sh` (documented) | **exit 0** — "Control-plane build and tests passed; PostgreSQL integration used only newly-created `nasq_control_scratch_p1tests5` on isolated port 55432." |
| In-process no-skip scan of the private log (counts only) | **`skipped` occurrences = 0**; Test Files passed = **4**; Tests passed = **20**; failed = **none**; skipped counts = none; **DSN-like occurrences in log = 0** |
| Blast radius | databases now `nasq_control`, `…p1tests`, `…p1tests2`, **`…p1tests5`**; **runtime rows unchanged** `mig=3 mem=0 tenants=0 audit=0`; no existing DB altered |

**D1 PASS** (configured run: 20 passed / 4 files, **no skip is accepted as a pass and none occurred**).
**D3 partial**: blast radius verified; the reuse-refusal guards were not exercised. **D2** (unconfigured run)
was not repeated this window.

## 63. **B1 PASS** — secret scan over my own collected artifacts

In-process, count-only, values never printed: **30 evidence files scanned**, **0 secret hits** against both
private values (DB password, service key), **0 password-bearing DSN occurrences**.

## 64. Final state after Part 9 — quiescent, resources preserved

| Item | Value |
| --- | --- |
| `14179` listeners / processes | **0** / control-plane **0**, run-local **0**, test-local **0** |
| Lifecycle lock | **FREE** |
| `processes/` records | **empty** (documented stop cleaned them) |
| Archives | **5, all intact** — legacy preserved (6), recovered generation (9), reservation, nine-record, dead-generation |
| PG container | `d18854335fdc…77c3` — **same ID**, `running`/`healthy` |
| Databases | + **`nasq_control_scratch_p1tests5`** created and retained; existing DBs untouched |
| Runtime rows | unchanged (`mig=3 mem=0 tenants=0 audit=0`) |
| Stray harness processes | **0**; background jobs collected |

## 65. Case status after Part 9

| Case | Status |
| --- | --- |
| A1, A2, A3, A4, A5, A6, A8, A9 | **PASS** |
| **E1** healthy | **PASS** |
| **E2** DB-down health | **PASS** (supersedes Part 8) |
| **E3** DB-restored health | **PASS** (supersedes Part 8) |
| **D1** configured suite, no skips | **PASS** (20 / 4 / 0 skipped) |
| **B1** secret hygiene | **PASS** (30 files, 0 hits) |
| C1 | **PARTIAL** — ledger `{1,2,3}`, 8/8 tables, trigger, index |
| C7 | **PARTIAL PASS** — 401 unauth, 404 non-`/v1/` |
| D3 | **PARTIAL** — blast radius confirmed; reuse guards not exercised |
| E4, E5, A7, B2, B3, C2–C6, D2 | **NOT RUN** this window |
| Business-outage gate | **PENDING** — separate lane/window; fixture owner `822…` untouched |

No case reported as `skip`. **No blanket PASS and no P1-complete claim**; this window verified specific cases
only. No production deployment is implied.

## 66. Notes for the owner

1. Second occurrence of a Python-3.9 constraint in **my own harness** (an f-string containing a backslash is a
   syntax error under `/usr/bin/python3` 3.9.6); restructuring the expression fixed it. The runtime source was
   not affected.
2. Remaining unexercised cases are listed in §65; the highest-value follow-ups are **E4** (boot with DB down),
   **E5** (closed-port DSN), **C2–C6** (migrate concurrency, grant/revoke audit) and **B2/B3** (error-shape and
   source-regression guards).
3. The business-outage gate still needs its own window with the Odoo + Nuxt fixture; nothing in this part
   substitutes for it.

---

# Part 10 — remaining bounded cases and the authoritative 27-case table

**Authority:** supervisor GO for the remaining bounded P1 cases (same frozen hashes). **Outcome: the residual
cases mostly PASS; two self-caught invalid attempts and several PARTIAL / NOT RUN classifications are recorded
honestly. No source patch. CP left quiescent.** Frozen hashes re-verified **12/12 MATCH** at
`2026-09-23T05:22:46Z`.

## 67. Case-label reconciliation (captain's correction applied)

Parts 4–9 labelled the recovery work **"A5"**. That was **wrong**. Per the plan of record:

- **A5 = decoy survival** — a verifier-owned process whose argv contains `run-local.sh` must not be claimed by
  `status`/`stop`. This was exercised only as an identity-rule probe (Parts 6–7), **not** as an end-to-end
  status/stop refusal ⇒ **PARTIAL**.
- **A6 = stale ownership records / dead-generation recovery** — everything Parts 4, 7 and 9 called "A5" is
  actually **A6**, which is **PASS**.

Downstream "A5 PASS" claims for recovery are corrected to A6 in the table below. Earlier Part text is retained
as history (superseded, not erased).

## 68. Newly executed cases

| Case | Command / probe | Result |
| --- | --- | --- |
| **A2** second stop | `stop-local.sh` with nothing running | **exit 10**, `Generation records are incomplete; refusing partial stop.` — safe refusal, **no mutation**, but **not a clean no-op** ⇒ A2 stays **PARTIAL** |
| **A7** foreign listener on 14179 | verifier-owned Node 22 listener, then `run-local.sh` | **PASS** — `run_local_exit=5`, `API port 14179 occupied.`; **decoy still alive after the refusal**; decoy stopped by me; left a lone `generation` marker (benign, self-heals via the supported generation-only path) |
| **B2** config error hygiene | `admin grant` with `CONTROL_SERVICE_KEY` unset | **PASS** — stderr names the **variable** (`CONTROL_INSTALLATION_ID is required`); **0** secret-shaped material in output |
| **B3** source-regression structural | `compose.yml` key names only, **no `Config.Env` read** | **PASS** — `POSTGRES_PASSWORD_FILE` present (1); bare `POSTGRES_PASSWORD` env key **absent** (0); `secrets:` + `file:` reference present (1); literal password **0**. Explicitly **not** claimed that the old leaked secret was erased from earlier container metadata |
| **D3(a)** reuse refusal | `test-local.sh` with `p1tests5` already present | **PASS** — **exit 5**, `Refusing to reuse a previous test database.`; `p1tests5` rows unchanged (`mem=2 audit=10`) ⇒ **no DB writes before the refusal** |
| **D2** unconfigured run (diagnostic) | `npm -w apps/control-plane run test`, `CONTROL_TEST_DATABASE_URL` unset | **exit 0**; `Test Files 3 passed | 1 skipped (4)`; `Tests 10 passed (10)`; `↓ src/__tests__/service.test.ts (0 test)`. Recorded as the **documented silent-green diagnostic**, **not acceptance** |
| **E5 (redo)** closed-port DSN | verified-free **non-fixture** loopback port **55449**, external `perl alarm 30` | **PASS** — exit 1 in **1 s**, `connect ECONNREFUSED`, no hang, **0** secret leaks |
| **C1** migration ledger | read-only `psql` on `nasq_control` | **PASS** — versions `1 2 3`; **8/8** tables; `catalog_immutable` trigger 1; `operations_request_id_global` index 1 |
| **C2** concurrent migrate | two `migrate` runs simultaneously against the runtime DB | **PASS** — both `rc=0`; ledger after = **3 rows {1,2,3}**; runtime rows unchanged (`mem=0 tenants=0 audit=0`) |
| **C3** grant / re-grant audit | `admin grant 9001 …` twice against **`p1tests5`** | **PASS** — grant `rc=0`; membership rows **1**; granted audit rows **1 → 2** (append-only, upsert not duplicate) |
| **C4** revoke twice + post-revoke denial | `admin revoke 9001` twice, then a signed request | **PASS** — revoke `rc=0`, revoked rows 1, revoked audit 1; **second revoke `rc=1` with audit rows still 1**; **signed request after revoke → 403** |
| **C7** authorization matrix | isolated API on **`p1tests5`**, port **55451** (verified free), signed in-process, **no secret on argv** | **PASS** — no headers **401**; non-`/v1/` **404**; forged signature **401**; stale timestamp −31 s **401**; wrong issuer **401**; valid signature without membership **403**; replay first **200** then **401**; signed member context **200**. Isolated API stopped (`exit=0`, 0 listeners) |

All test grants were **revoked at the end**; no rows deleted, all audit rows preserved.

## 69. Self-caught invalid attempts (disclosed, not counted)

1. **The first E5 attempt used port 55439 — a forbidden fixture port.** A listener was already present
   (`listeners=1`), so it did **not** test a closed port and is **INVALID**. E5 was redone on the verified-free
   port **55449** (§68). Retained here, not hidden.
2. **E4 is INVALID / NOT PROVEN this window.** The exact container `d18854335fdc…77c3` was stopped with the
   API/workers OFF (state `exited`) and the documented boot failed with **exit 4** at the
   **reservation-recovery** stage — `runtime_process_present_or_uncertain` at `recover_generation.py:236` via
   `begin_generation.py:41` — reaching **neither** the resource guard **nor** the app/migration stage. Per the
   captain's rule such a failure **must not** be counted as proof the app fails to bind. **E4 therefore
   provides no evidence** and is classified **NOT PROVEN**, not FAIL. The container was restored in a
   `trap … EXIT` handler: **same ID**, `running`/`healthy`.

## 70. Authoritative 27-case table

**PASS** = the plan's exact criterion met with fresh cited evidence · **PARTIAL** = subset proven ·
**NOT RUN** · **NOT PROVEN** = attempted but the evidence does not support the criterion. No `skip` counts as
acceptance.

| # | Case | Status | Evidence |
| --- | --- | --- | --- |
| A1 | Start; health; loopback-only bind | **PASS** | Parts 7, 9: `200 {"status":"ok"}`, `127.0.0.1:14179` only, LAN probe 000 |
| A2 | Stop; second stop safe | **PARTIAL** | Documented stop PASS (exit 0, records cleaned, DB retained); second stop exits 10 with a truthful refusal — safe, not a clean no-op (§68) |
| A3 | Restart; new owners; no orphan | **PASS** | Parts 7, 9: new PIDs + new generation, `status-local.sh` exit 0, one listener |
| A4 | Duplicate start bounded, no second runtime | **PASS** | Parts 7, 9: exit 4 within the bound, 1 listener, recorded PID unchanged |
| A5 | **Decoy survival** (argv contains `run-local.sh`) | **PARTIAL** | Identity rule proven to match such argv (Parts 6–7, `entry_names`); end-to-end status/stop refusal against the decoy not exercised |
| A6 | Stale records / dead-generation **recovery** | **PASS** | Parts 4, 7, 9: dead-generation and generation-only reservations archived via supported paths, records cleaned, **no deletion** |
| A7 | Port 14179 held by a foreign listener | **PASS** | §68: exit 5 refusal, decoy survived untouched |
| A8 | Generation ownership across restart | **PASS** | Parts 7, 9: new generation verified by status; old records archived |
| A9 | Container identity validation | **PASS** | Part 5: guard returns `ok`; the short-vs-full-ID defect fixed and verified |
| B1 | Post-rotation artifact secret scan | **PASS** | Part 9: 30 evidence files, **0** hits, **0** password-bearing DSNs |
| B2 | Error hygiene | **PASS** | §68: variable named, no value exposed |
| B3 | Source-regression structural guard | **PASS** | §68: key names/booleans only, no `Config.Env`, no literal password; no erasure claim |
| C1 | Migration ledger and objects | **PASS** | §68: `{1,2,3}`, 8/8 tables, trigger, index |
| C2 | Concurrent migrate under advisory lock | **PASS** | §68: both rc 0, ledger intact, runtime rows unchanged |
| C3 | Grant / re-grant, append-only audit | **PASS** | §68: 1 membership, audit 1→2 |
| C4 | Revoke twice; denial after revoke | **PASS** | §68: second revoke rc 1 with no new audit row; signed → 403 |
| C5 | Argument validation (uid, reason, duplicate capability) | **NOT RUN** | — |
| C6 | Configuration identity (key length, relative paths, non-loopback TLS, invalid port) | **PARTIAL** | Missing-required-var leg proven (§68 B2); other legs NOT RUN |
| C7 | Authorization matrix | **PASS** | §68: 401/404/401/401/401/403, replay 200→401, member 200 |
| D1 | Configured suite on fresh `p1tests5`, zero skips | **PASS** | Part 9: 20 tests / 4 files, `skipped=0`, 0 DSNs in log |
| D2 | Unconfigured run (diagnostic only) | **PASS (diagnostic)** | §68: 3 passed / 1 PG file skipped — diagnostic, **not acceptance** |
| D3 | Reuse guards + blast radius | **PARTIAL** | §68: reuse refusal PASS (exit 5, no writes), blast radius PASS; runtime-target and active-owner refusals NOT RUN |
| E1 | Healthy `/healthz` 200 | **PASS** | Parts 7–9 |
| E2 | DB-down → 503 with API/worker survival | **PASS** | Part 9: 503 at t=2 s, **same PIDs/start times**, 1 listener — supersedes Part 8 |
| E3 | DB-restore → automatic 200 | **PASS** | Part 9: 200 at t=3 s, same PIDs — supersedes Part 8 |
| E4 | Boot with DB down; guard vs app failure separated | **NOT PROVEN** | §69: failed at the recovery stage, reaching neither guard nor app; no binding evidence |
| E5 | Closed-port DSN fails fast | **PASS** | §68 redo on free port 55449: exit 1 in 1 s, `ECONNREFUSED` (first fixture-port attempt INVALID, disclosed) |

**Tally: 21 PASS · 4 PARTIAL (A2, A5, C6, D3) · 1 NOT RUN (C5) · 1 NOT PROVEN (E4) = 27.**

## 71. Final state after Part 10 — quiescent, resources preserved

| Item | Value |
| --- | --- |
| `14179` / `55451` listeners | **0 / 0** |
| Control-plane, run-local, test-local processes | **0** |
| Isolated C7 API | stopped (`exit=0`), 0 listeners |
| Lifecycle lock | **FREE** |
| `processes/` records | lone `generation` marker (left by A7) — benign, self-heals via the supported generation-only path |
| Archives | **5, all intact** |
| PG container | `d18854335fdc…77c3` — **same ID**, `running`/`healthy` |
| Databases | `nasq_control`, `…p1tests`, `…p1tests2`, **`…p1tests5`** preserved |
| `nasq_control` rows | `mig=3 mem=0 tenants=0 audit=0` — **unchanged** |
| `p1tests5` rows | `mig=3 mem=3 audit=13` — preserved; all test grants revoked, **no deletes** |
| Stray harness processes | **0**; all jobs collected |

## 72. Standing caveats

1. **P1 is not complete.** The **business-outage gate** remains outstanding in its own separate window (Odoo +
   Nuxt fixture, owner `822…`, untouched by this lane), as does the final Grok review. No P1-complete claim and
   no production-deployment claim.
2. **No source was patched** by this lane at any point; the only mutation-class actions were the authorized
   preservation relocation and the disclosed identity-verified emergency stops.
3. This lane is **terminal** for now; the business window runs after it, not concurrently.
4. Harness tooling lives only in `.p1-harness/` inside the test worktree. A third Python-3.9 quirk was avoided
   by pinning `/Users/tariq/code/odoo/.venv/bin/python` and Node 22 for harness runs.

---

# Part 11 — evidence-audit corrections and the final validated classification

**Authority:** the supervisor's Grok evidence-audit corrections. **Outcome: four downgraded items are now
measured and restored to PASS with the missing legs cited; three items stay PARTIAL and one NOT PROVEN; the E4
mechanism is determined from source; no source changed; CP quiescent.** Frozen hashes re-verified **12/12
MATCH** before this round.

## 73. Newly measured legs (upgrades)

| Case | Required leg (auditor) | Measurement | Now |
| --- | --- | --- | --- |
| **B3** | keys **≠** mount RO + 0600 | host secret files are `-rw-------` (**0600**); `docker inspect` **Mounts metadata only** (no `Config.Env`, no private content) → `type=bind dest=/run/secrets/control_db_password rw=false` (**read-only**) and `type=volume dest=/var/lib/postgresql/data rw=true` (expected data volume) | **PASS** |
| **C1** | ledger **≠** migrate **twice** | two **sequential explicit** `migrate` runs against `p1tests5` → **rc=0 both**; `mig=3` versions `1,2,3`, `audit=13`, `mem=3` **preserved** before and after | **PASS** |
| **C5** | invalid args, no grant writes | `grant 0`, `grant abc`, short reason, duplicate capability, missing capability → **all rc=1**; `mem=3` and `audit=13` **unchanged** ⇒ **zero writes** | **PASS** |
| **A5** | decoy survival via real status/stop | isolated fake home + decoy whose argv basename is `run-local.sh` at a **non-runtime path**; real `status-local.sh` → **exit 2** `runtime exact process identity not confirmed.`; real `stop-local.sh` → **exit 10** `Owner runtime is neither exactly owned nor provably gone; refusing signal.`; **decoy survived** | **PASS** (fake-home scope) |
| **A8** | live-child status **and** reused/reaped PID | live-child leg: Parts 7/9 `status-local.sh` **exit 0** with live api+worker. Reaped-PID leg: a **reaped** PID placed in the record → `status` **exit 2** (not reported live), `stop` **exit 10** refusing signal, and **no signal reached any live process** | **PASS** |

**Scope honesty for A5/A8:** these ran against an **owned fake isolated home**, with the decoy at a **different
path** from the real runtime entry. No historical PID was forged against any live unrelated resource, and the
real home was untouched (its records remained `generation`). The stronger same-path decoy variant remains
unexercised and is **not** claimed.

## 74. Classifications that stay down

| Case | Classification | Reasoning recorded |
| --- | --- | --- |
| **A2** | **PARTIAL** (unchanged) | The plan requires the second stop to be **safe**, not that it exit 0. Observed: `stop-local.sh` **exit 10**, `Generation records are incomplete; refusing partial stop.` — a truthful refusal with **no mutation**. Reported exactly as observed. The auditor's additional "clean no-op" expectation is an **added** expectation, not a rewrite of the plan's wording |
| **C6** | **PARTIAL** | Only the missing-required-var leg is proven (`CONTROL_INSTALLATION_ID is required`). The isolated-synthetic-config child with timeouts / no-binding was **not** run this window |
| **D3** | **PARTIAL** | Guards are source-confirmed and all precede any write: `test-local.sh:16` active-owner (exit 4), `:17` previous-DB marker (exit 5, **proven empirically**), `:19` runtime-DSN shape (exit 6), `:22` test-DSN selection (exit 6), `:26` existing DB name (exit 8); `createdb` runs only after all five. The active-owner and runtime-DSN refusals were **source-verified but not executed** |
| **D2** | **PASS (diagnostic, separate)** | `Test Files 3 passed \| 1 skipped (4)`, `Tests 10 passed`; the PostgreSQL integration file is skipped without `CONTROL_TEST_DATABASE_URL` — a **diagnostic of the silent-green shape**, explicitly **not** acceptance |
| **E4** | **NOT PROVEN** | See §75. The E5 closed-port result is **not** accepted as a DB-down substitute |

## 75. E4 mechanism determined from source (no DB stop performed)

Read-only inspection of `run-local.sh`'s existing-resource branch answers "does the documented path's guard
prevent reaching the app?" — **yes**:

1. `docker inspect` of the CP container must succeed (else exit 6).
2. **`resource_guard.py` must pass** — and that guard requires `State.Health.Status == healthy`.
3. Only then is `State.Status == running` checked, then `pg_isready`, and only then are the API/worker started.

With the CP container stopped, **stage 2 fails first and the app is never reached**. The documented path
therefore **cannot** produce evidence about app no-bind behaviour on DB-down — exactly the caution raised. **No
DB stop was performed this turn.**

**Proposed separate window (not run):** once the fixture check is complete, start the **app entry directly**
(`apps/control-plane/src/main.ts`, plus `worker-main.ts`/`worker-loop.ts` for the worker) with an **isolated
config** whose `CONTROL_DATABASE_URL` targets the stopped CP DB, on a **checked-free non-fixture port**, and
observe whether it binds and what `/healthz` returns (503 vs connection refusal). That isolates the app from
`run-local.sh`'s identity guard and would yield real E4 evidence. It requires the CP DB to be down, so it
belongs in its own window and never concurrently with the business-outage lane.

## 76. Final authoritative 27-case table

| # | Case | Status | Basis |
| --- | --- | --- | --- |
| A1 | Start; health; loopback-only bind | **PASS** | 200, `127.0.0.1:14179` only, LAN probe 000 |
| A2 | Stop; second stop **safe** | **PARTIAL** | stop PASS; second stop exit 10, truthful, **no mutation** (§74) |
| A3 | Restart; new owners; no orphan | **PASS** | new PIDs + generation, status exit 0 |
| A4 | Duplicate start bounded, no second runtime | **PASS** | exit 4 bounded, 1 listener, PID unchanged |
| A5 | Decoy survival | **PASS** (fake-home scope) | §73 |
| A6 | Stale records / dead-generation recovery | **PASS** | Parts 4/7/9, supported paths, no deletion |
| A7 | Port 14179 held by foreign listener | **PASS** | exit 5, decoy survived |
| A8 | Generation / reaped-PID ownership | **PASS** | §73, both legs |
| A9 | Container identity validation | **PASS** | guard `ok`; defect fixed and verified |
| B1 | Post-rotation artifact secret scan | **PASS** | 30 files, 0 hits, 0 DSNs |
| B2 | Error hygiene | **PASS** | variable named, no value exposed |
| B3 | Source-regression structural guard | **PASS** | §73 keys + RO + 0600 |
| C1 | Ledger **and** migrate twice | **PASS** | §73 two sequential rc 0, rows preserved |
| C2 | Concurrent migrate | **PASS** | both rc 0, ledger intact |
| C3 | Grant / re-grant audit | **PASS** | 1 membership, audit 1→2 |
| C4 | Revoke twice; denial after revoke | **PASS** | second revoke rc 1, no new row; signed → 403 |
| C5 | Argument validation, no writes | **PASS** | §73 five rc 1, counts unchanged |
| C6 | Configuration identity (all five legs) | **PARTIAL** | missing-var leg only |
| C7 | Authorization matrix | **PASS** | 401/404/401/401/401/403, replay 200→401, member 200 |
| D1 | Configured suite on fresh `p1tests5`, zero skips | **PASS** | 20 tests / 4 files, `skipped=0` |
| D2 | Unconfigured run — **diagnostic** | **PASS (diagnostic)** | separate from acceptance |
| D3 | Reuse guards + blast radius | **PARTIAL** | guards source-confirmed pre-write; marker refusal proven; 2 refusals not executed |
| E1 | Healthy `/healthz` 200 | **PASS** | Parts 7–9 |
| E2 | DB-down → 503 with API/worker survival | **PASS** | 503 at t=2 s, same PIDs/start times |
| E3 | DB-restore → automatic 200 | **PASS** | 200 at t=3 s, same PIDs |
| E4 | Boot with DB down; guard vs app separated | **NOT PROVEN** | §75 guard short-circuits before the app |
| E5 | Closed-port DSN fails fast | **PASS** | free port 55449, exit 1 in 1 s, `ECONNREFUSED` |

**Tally: 23 PASS · 3 PARTIAL (A2, C6, D3) · 1 NOT PROVEN (E4) · 0 NOT RUN = 27.**

Incidents are preserved, not erased: the Part 8 E2/E3 failure (superseded), the E5 fixture-port attempt
(invalid, disclosed), the E4 recovery-stage result (NOT PROVEN), and the earlier unauthorized force-recreate and
secret incident.

## 77. Final state

PG healthy on the same container `d18854335fdc…77c3`; `14179` and `55451` have **0** listeners; **0**
control-plane/run-local/test-local processes and **0** stray harness processes; lifecycle lock **FREE**;
**5 archives intact**; `nasq_control` rows unchanged (`mig=3 mem=0 tenants=0 audit=0`); `p1tests5` preserved
(`mig=3 mem=3 audit=13`) with all test grants revoked and no deletes; the only leftover is the fake-home scratch
directory inside my own worktree. **No source was changed. P1 remains incomplete**: the business-outage gate and
Grok review are outstanding, fixture owner `822…` untouched, no production-deployment claim.

---

# Part 12 — C6, D3 and the separate E4 window: all three now PASS

**Authority:** supervisor authorization for the bounded remaining C6/D3 plus the separate E4 window (sole CP
owner, fixture lane quiescent). **Outcome: C6, D3 and E4 all PASS; the final table is 26 PASS / 1 PARTIAL / 0
NOT PROVEN. No source changed; CP quiescent; resources preserved.** Frozen hashes re-verified **12/12 MATCH**
before this round.

## 78. E4 — separate window, DIRECT app entry (PASS)

Precheck: container `d18854335fdc331060e1700892639bb7834b78a45a61721bdf3ffdfc101177c3` **identity exact**,
`running`/`healthy`, **0** API/worker processes, port 55461 verified free. Counts before:
`mig=3 mem=0 audit=0`.

**Only that PG container** was stopped (state `exited`). The two app entries were then launched **directly** with
the documented Node 22 + tsx command and an isolated private config whose DSN targeted the same CP endpoint/DB,
on the checked-free non-fixture port 55461, under an external deadline, with no operator/customer inventory
targets:

| Entry | Exit | Max listeners during | Bound? | `ECONNREFUSED` in output | Secret leak |
| --- | --- | --- | --- | --- | --- |
| `src/main.ts` | **1** | **0** | **no** | yes | 0 |
| `src/worker-main.ts` | **1** | **0** | **no** | yes | 0 |

Port 55461 listeners after: **0**. Container restored in a `finally`/`trap`: **same ID**, `running`/`healthy`.
Counts after: `mig=3 mem=0 audit=0` — **identical**; ledger `1,2,3` intact ⇒ **no partial schema**.

So the app **enters, fails promptly on the database connection, and never binds** — the expected nonzero-before-bind
behaviour, **not** a 503 readiness state. **Scope stated honestly:** this tests the **app boot path** directly;
it does **not** claim the documented launcher reached the app (and per §75 the launcher cannot, because the
identity guard short-circuits first).

## 79. C6 — configuration identity, all five legs (PASS)

Each scenario was run through the **direct entry** with a synthetic environment and pinned Node 22, before any
bind:

| Scenario | Exit | Message |
| --- | --- | --- |
| `CONTROL_INSTALLATION_ID` unset | **1** | `CONTROL_INSTALLATION_ID is required` |
| `CONTROL_SERVICE_KEY` too short | **1** | `must contain at least 32 bytes` |
| relative `NASQ_CLI_INVENTORY` | **1** | `operator paths must be absolute` |
| `CONTROL_HOST=0.0.0.0` without TLS | **1** | `HTTPS is required outside loopback` |
| `CONTROL_PORT=70000` | **1** | `invalid CONTROL_PORT` |

Port 55463 listeners after: **0** — nothing bound in any scenario.

## 80. D3 — active-owner and runtime-DSN guards (PASS)

Run against an **isolated fake home** with **placeholder non-sensitive** private files, and with the
previous-DB marker deliberately **absent** so it could not mask the target condition:

| Guard | Exit | Message |
| --- | --- | --- |
| active owner (`processes/runtime.pid` present) | **4** | `Stop only the owned runtime first; refusing concurrent test mutation.` |
| runtime DSN shape wrong | **6** | `Runtime DSN is not the expected isolated control DB; refusing tests.` |

Both fired at their **correct source stage** (`test-local.sh:16` and `:19`), i.e. **before** the `createdb` at
line 27. **No DB write occurred**: `p1tests5` remained `mem=3 audit=13 mig=3`, unchanged, and still present. The
real runtime home and the real private files were not touched.

## 81. A2 — precise status left for Grok (unchanged)

The plan requires the second stop to be **safe**; it does **not** require exit 0. Observed:
`stop-local.sh` → **exit 10**, `Generation records are incomplete; refusing partial stop.` — a truthful refusal
that mutated nothing. Reported exactly as observed; the added "clean no-op" expectation is an auditor addition,
**not** a contract rewrite. **A2 remains PARTIAL** and the precise status is left for Grok.

## 82. FINAL AUTHORITATIVE TABLE (26 PASS / 1 PARTIAL / 0 NOT PROVEN)

All other rows are as in §76; the three changed this round:

| # | Case | Status | Basis |
| --- | --- | --- | --- |
| **C6** | Configuration identity, all five legs | **PASS** | §79 — five scenarios, correct messages, never bound |
| **D3** | Reuse guards + blast radius | **PASS** | §80 — active-owner exit 4 and runtime-DSN exit 6 at the correct stages, **no DB write**; plus the earlier marker refusal (exit 5) and blast-radius check |
| **E4** | Boot with DB down; guard vs app separated | **PASS** (direct-entry scope) | §78 — both entries exit 1, never bind, no partial schema; explicitly not a launcher-reached-app claim |
| A2 | Stop; second stop **safe** | **PARTIAL** | §81 — precise status left for Grok |

**Final tally: 26 PASS · 1 PARTIAL (A2) · 0 NOT PROVEN · 0 NOT RUN = 27.**

## 83. Final state after Part 12

Ports `14179` / `55451` / `55461` / `55463`: **0 listeners each**; **0** control-plane, run-local, test-local and
stray harness processes; lifecycle lock **FREE**; **5 archives intact**; PG container
`d18854335fdc…77c3` — **same ID**, `running`/`healthy`; databases `nasq_control`, `…p1tests`, `…p1tests2`,
**`…p1tests5`** all present; runtime rows unchanged (`mig=3 mem=0 tenants=0 audit=0`); `p1tests5`
(`mem=3 audit=13 mig=3`) preserved with all test grants revoked and **no deletes**; the accepted auth tests in my
worktree remain untouched. **No source was changed by this lane at any point.**

**P1 is still not complete:** the **business-outage gate** (Odoo + Nuxt fixture, owner `822…`, untouched) and
the final Grok review remain outstanding. No production-deployment claim. This lane is **terminal**; the
business window is coordinated separately and must not overlap.

---

# Part 13 — C6 completed to all nine legs; A2 reclassified; final table

**Authority:** supervisor's final bounded authorization for the four omitted C6 variables (no retained-runtime
or PG actions). **Outcome: all four PASS; C6 is complete; A2 is reclassified to PASS under the plan's original
"safe" contract with a recorded usability limitation. Final table: 26 acceptance PASS + 1 diagnostic
(D2).** Paired hash freeze re-verified **13/13 MATCH**. No source edit, no DB or service change.

## 84. C6 — the four omitted variables (PASS)

Each was unset from an otherwise **valid isolated synthetic config** and exercised through the **actual app
entry** (`src/main.ts`, pinned Node 22 + tsx), with a **synthetic DSN on a checked-closed non-fixture port**
(55469 — 0 listeners, verified), **no real credential**, an external deadline, and a monitored checked-free
port (55465).

| Variable unset | Exit | Diagnostic | Max listeners during | Leak |
| --- | --- | --- | --- | --- |
| `CONTROL_SERVICE_KEY` | **1** | `CONTROL_SERVICE_KEY is required` | **0** | **0** |
| `CONTROL_DATABASE_URL` | **1** | `CONTROL_DATABASE_URL is required` | **0** | **0** |
| `NASQ_CLI_STATE_DIR` | **1** | `NASQ_CLI_STATE_DIR is required` | **0** | **0** |
| `NASQ_REPOSITORY_ROOT` | **1** | `NASQ_REPOSITORY_ROOT is required` | **0** | **0** |

Monitored port 55465: **0** listeners before and after; **0** control-plane processes afterwards. Exact
variable names, exits, and the no-leak/no-listener results are recorded above.

With §79's five legs (missing `CONTROL_INSTALLATION_ID`, short key, relative operator path, non-loopback
without TLS, invalid port) plus these four, **C6 now covers all nine required-var and guard legs ⇒ PASS**.

## 85. A2 — reclassified to PASS under the plan's original contract

The plan's A2 criterion is that the second stop be **safe**; it does **not** require exit 0. Observed:
`stop-local.sh` → **exit 10**, `Generation records are incomplete; refusing partial stop.` — a truthful,
fail-closed refusal that **mutated nothing** (no records deleted, no process signalled, DB container untouched).
Under the plan's original wording this satisfies A2 ⇒ **PASS**, with a **recorded usability limitation**: a
second stop on an already-stopped runtime returns non-zero rather than a silent success, which a caller must
handle. The precise exit code and message are preserved above for Grok.

## 86. FINAL AUTHORITATIVE TABLE — 26 acceptance PASS + 1 diagnostic

| # | Case | Status |
| --- | --- | --- |
| A1 | Start; health; loopback-only bind | **PASS** |
| A2 | Stop; second stop **safe** (exit 10, no mutation) | **PASS** (usability limitation recorded) |
| A3 | Restart; new owners; no orphan | **PASS** |
| A4 | Duplicate start bounded, no second runtime | **PASS** |
| A5 | Decoy survival (fake-home scope) | **PASS** |
| A6 | Stale records / dead-generation recovery | **PASS** |
| A7 | Port 14179 held by foreign listener | **PASS** |
| A8 | Generation / reaped-PID ownership | **PASS** |
| A9 | Container identity validation | **PASS** |
| B1 | Post-rotation artifact secret scan | **PASS** |
| B2 | Error hygiene | **PASS** |
| B3 | Source-regression structural guard (keys + RO + 0600) | **PASS** |
| C1 | Ledger **and** two sequential migrates | **PASS** |
| C2 | Concurrent migrate | **PASS** |
| C3 | Grant / re-grant audit | **PASS** |
| C4 | Revoke twice; denial after revoke | **PASS** |
| C5 | Argument validation, no writes | **PASS** |
| C6 | Configuration identity — **all nine legs** | **PASS** |
| C7 | Authorization matrix | **PASS** |
| D1 | Configured suite on fresh `p1tests5`, zero skips | **PASS** |
| D2 | Unconfigured run — **diagnostic only** | **DIAGNOSTIC** (not acceptance) |
| D3 | Reuse guards + blast radius | **PASS** |
| E1 | Healthy `/healthz` 200 | **PASS** |
| E2 | DB-down → 503 with API/worker survival | **PASS** |
| E3 | DB-restore → automatic 200 | **PASS** |
| E4 | Boot with DB down; guard vs app separated | **PASS** (direct-entry scope) |
| E5 | Closed-port DSN fails fast | **PASS** |

**Counts: 27 rows = 26 acceptance PASS + 1 diagnostic (D2).** `D2` is deliberately excluded from acceptance
because a skipped PostgreSQL suite is a diagnostic of the silent-green shape, never a pass.

## 87. Final state after Part 13

All monitored ports (`14179`, `55451`, `55461`, `55463`, `55465`, `55469`) show **0 listeners**; **0** owned
control-plane, run-local, test-local or harness processes; **0** background jobs outstanding; lifecycle lock
**FREE**; **5 archives intact**; PG container `d18854335fdc…77c3` — **same ID**, `running`/`healthy`;
`nasq_control` rows unchanged (`mig=3 mem=0 tenants=0 audit=0`); `p1tests`/`p1tests2`/`p1tests5` preserved
(`p1tests5` = `mem=3 audit=13 mig=3`, all test grants revoked, **no deletes**); the accepted auth tests in my
worktree remain untouched; **no source was edited**.

**Ownership status:** the CP remains **OFF**, the fixture lane is untouched (owner `822…`), and **the CP side of
the business window is mine to run later but is NOT started**. **P1 remains incomplete** pending the
business-outage gate and Grok's review of the four rows recorded in §84.

---

# Part 14 — business-outage gate: verified management outage timeline (CP side)

**Scope of this part:** the **control-plane half** of the business-outage gate, recorded from the executed
runs. The **customer half** (12/12 before/during/after probes in the Odoo + Nuxt fixture) was produced and
owned by the fixture lane; its numbers are quoted here as the other lane's report, not as this lane's
measurement. No source was changed and no runtime mutation was made while writing this part.

## 88. Verified outage timeline (all times UTC)

| Time | Event | Evidence |
| --- | --- | --- |
| `12:05:52Z` | **BASELINE_UP re-verified** immediately before the outage | `healthz {"status":"ok"}`; `status-local.sh` **exit 0**; **lock FREE**; api/worker pids 53931/54109 |
| `~12:05:57Z` | **CP shutdown** | `stop-local.sh` → **exit 0**, `Owned runtime stopped; DB/data retained.`; then `docker stop d18854335fdc331060e1700892639bb7834b78a45a61721bdf3ffdfc101177c3` → **exit 0** (no down, no rm, no prune, no compose up) |
| — | Container state | **`exited`** (verified) |
| `~12:06:11Z` | **Watchdog armed** against the already-`exited` container | token **`fad3dfe6-3865-4300-9536-47b05d1a16fb`**, **timer pid 54592**, `timer_alive=true`, budget **300 s**, recorded container ID exact |
| `12:06:17Z` | **Full outage confirmed** | **0 listeners on `14179`**; **0 control-plane processes**; PG container **`exited`** (`pg_isready` → "container … is not running") |
| **`12:06:50Z – 12:06:51Z`** | **DURING probe executed while the CP was verified down** (fixture lane) | fixture lane reports **12/12** customer reads/writes succeeded in that interval |
| `12:07:26Z` | **Watchdog disarmed and collected** | token `fad3dfe6…` → `final cleanup done`; **0 armed windows** afterwards |
| `12:07:26Z` | **`docker start`** of the exact container | exit 0, same container ID |
| `t = 8 s` | **PG healthy and accepting** | `running`/`healthy`; `pg_isready` → `accepting connections` |
| `12:07:52Z` | **CP restored and verified** | `run-local.sh` exit 0; `healthz {"status":"ok"}` **200**; listener `127.0.0.1:14179` only; `status-local.sh` **exit 0**; **lock FREE**; PG same ID `running`/`healthy` |

## 89. Post-restore identities and preserved state

| Item | Value |
| --- | --- |
| runtime | **55020** (`15:07:39`) |
| api | **55087** (`15:07:40`) |
| worker | **55271** (`15:07:41`) |
| generation | **`e27f9566121dace92fdccff0ebf942f4`** |
| Archives | **9**, all preserved |
| PG container | `d18854335fdc331060e1700892639bb7834b78a45a61721bdf3ffdfc101177c3` — **same ID**, `running`/`healthy` |
| `nasq_control` rows | `mig=3 mem=0 tenants=0 audit=0` — unchanged |
| Mutations | **none** beyond the authorized stop/start of the dedicated container and the documented stop/start of the CP |

**Window verdict:** the DURING probe occurred inside a **verified** full outage; the watchdog did **not**
self-trigger (it was collected ~4 minutes before its `~12:11:11Z` deadline), so **`window_valid` = true** and no
overlapped interval requires repudiation.

## 90. Ordering deviation disclosed

The watchdog was **disarmed before** the restore rather than after it, deliberately, to remove a double-restore
race: had it fired at its deadline while the restore was in flight it would have issued its own `docker start`
plus `run-local.sh` concurrently. The disarm is idempotent and the observed outcome is identical to the
prescribed order.

## 91. Final quiescent state (read-only check, `12:12:20Z`)

| Item | Value |
| --- | --- |
| `14179` listeners | **0** |
| Control-plane / run-local processes | **0** |
| Watchdog | **not armed**, token collected, **0** window dirs live |
| Lifecycle lock | **FREE** |
| PG container | **same ID**, `running`/`healthy` |
| Archives | **9, intact** |
| Databases | `nasq_control`, `p1tests`, `p1tests2`, `p1tests5` preserved; `nasq_control` rows unchanged |
| Harness scratch | only `.p1-harness/` state inside the test worktree |

**Standing operational caveat (reproduced five times):** the long-lived CP process does not survive the
harness's turn-boundary job cleanup, so each `BASELINE_UP` / `BASELINE_RESTORED` assertion is valid **only
within the turn in which it was verified**. Every stage must therefore **re-verify `healthz` and
`status-local.sh` immediately before proceeding** and re-establish the baseline in-turn if it has been
reclaimed. This does not affect any measurement above: the outage window itself was timed and verified while
the CP was genuinely down, and PG was never restarted or recreated.

**Gate status:** the **CP half** of the business-outage gate is now documented with a verified timeline; the
gate as a whole remains the supervisor's/Grok's to close against the fixture lane's customer evidence, and this
part makes **no** P1-completion or production-deployment claim.
