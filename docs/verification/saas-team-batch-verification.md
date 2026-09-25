# Independent verification of the three batch slices — 2026-09-23

**Status: INDEPENDENT VERIFICATION, READ-ONLY SOURCE INSPECTION + RE-RUN OF THE FOCUSED SUITES THAT HAD NO PERSISTED EVIDENCE. NOT package acceptance, NOT integration acceptance, NOT a live-runtime result.**

Verifier: `deepseek-verify` (task `t6`). Report worktree `/Users/tariq/code/nasq-team-saas-evidence`
(branch `codex/team-saas-evidence`). Source was inspected read-only in
`/Users/tariq/code/nasq-team-saas-{adapter,control,edge}`. No source file was edited, no source
repair was performed, no writer worktree was mutated, and no commit/merge/push/deploy/reset/stash
was run. `git diff --check` was clean in every worktree before and after this verification.

Governing contract: `docs/superpowers/specs/saas-team-batch-contract.md` (t2). Frozen external
reference: `docs/superpowers/specs/2026-09-23-saas-p2-l1a-revised-contract.md` (Revision 3.1).

## 0. Authority, baseline and method

| Item | Value |
| --- | --- |
| Baseline commit, all four team worktrees | `abde67b64155250f015b8ad213c26609532a124c` (`abde67b6`) |
| Commits created by any team worktree | **none** |
| Staged content in any team worktree | **none** (`git diff --cached --name-only` empty in all four) |
| Canonical `/Users/tariq/code/nasq` | unchanged by the lanes: still `abde67b6` with only its pre-existing dirt (the two accidental BFF test copies, `.agent-teams/`, and the untracked roadmap) |
| Legacy `nasq-saas-*` worktrees | all seven present and untouched |

**Why tests were re-run.** None of the three lanes persisted a verify-evidence document: their
worktrees contain source and test files only (`git status` shows no report, no `.tN-evidence/`, no
log). The lane results reached the team only as messages. The batch contract §3–§5 prescribes the
verify commands, so this verification re-ran them for the lanes whose evidence was not durable, and
nothing else. No suite was re-run merely because a count was convenient.

Commands were run with an explicit `cd`/`git -C` absolute path per worktree; no cross-worktree
implicit `cwd` was used (the `t12` correction).

## 1. Ownership and inherited-versus-team separation

Each file has exactly one lane. The decisive check was hashing every lane file against the `t1`
manifest source it was supposed to be inherited from.

### 1.1 Adapter (`codex/team-saas-adapter`) — slice `t3`

| File | Provenance | Evidence |
| --- | --- | --- |
| `tools/nasq_cli/journal.py` | **inherited t1 overlay — unchanged** | `4d666f2596469216…` = `nasq-saas-scratch-guards` copy |
| `tools/test_nasq_cli_operator.py` | **inherited t1 overlay — unchanged** | `d5aeed5dc883da6c…` = scratch-guards copy |
| `tools/test_nasq_cli_scratch_guards.py` | **inherited t1 overlay — unchanged** | `67411d175c817ed4…` = scratch-guards copy |
| `tools/nasq_cli/managed_runtime.py` | **team-authored (changed)** | now `0e88c02b7f280848…`, was `c50b1fff0bd46845…` in the t1 snapshot |
| `tools/test_managed_runtime.py` | **team-authored (changed)** | now `9c29b0aa0ee3a3d3…`, was `372607133487f829…` |
| `tools/nasq_cli/cli.py` | **team-authored**, within the contract's shared-file exception | `64aac3e210e32e0b…` vs baseline `8d01368ab88923df…` |
| `tools/test_nasq_cli.py` | **team-authored**, same exception | `9ec3251362ca6834…` vs baseline `fa39fefd9bde1a5b…` |

`journal.py` in the adapter worktree is **byte-identical to the t1 source**: `t3` did not touch the
accessor or `payload_digest`. The `cli.py` / `test_nasq_cli.py` edits are exactly the permitted
`status`-only input.

### 1.2 Control (`codex/team-saas-control`) — slice `t4`

| File | Provenance | Evidence |
| --- | --- | --- |
| `apps/web/server/utils/__tests__/vendor-control.test.ts` | inherited t1 (BFF) — unchanged | `25ed1b14bfcfc93e…` = BFF lane copy |
| `apps/web/server/utils/__tests__/vendor-outage.test.ts` | inherited t1 (BFF) — unchanged | `ea15f1337a9d7338…` = BFF lane copy |
| `apps/web/app/composables/__tests__/useVendorContext.test.ts` | inherited t1 (auth) — unchanged | `5fda7eb8bf4e22f2…` |
| `apps/web/app/middleware/__tests__/vendor.test.ts` | inherited t1 (auth) — unchanged | `7b2c61cd6c8421a2…` |
| `apps/control-plane/src/__tests__/db-outage.test.ts` | inherited t1 (control-runtime) — unchanged | `fa3adcf78305b519…` |
| `apps/control-plane/src/worker-loop.ts` | inherited t1 (control-runtime) — unchanged | `32274ea48b699c01…` |
| `apps/control-plane/src/__tests__/config.test.ts` | **inherited t1 (config) but EXTENDED by this lane** | now `72bab511bee09eb4…`, was `14b463dd2db015e3…` |
| `apps/control-plane/src/{config,db,http,main,worker-main,worker}.ts` | **team-authored** | modified against baseline |
| `packages/commercial-contracts/src/index.ts` | **team-authored, net effect is whitespace only** | one blank line removed; no schema change |

**Disclosed deviation.** The `config.test.ts` extension is 2 additive lines (`NASQ_MANAGED_INVENTORY`
added to the env-key list, `managedInventoryPath` added to the expected config-key list), required by
the `config.ts` change. Test count is unchanged (47) and it passes. It is correct and in scope, but
the config lane's persisted evidence hash for that file no longer describes the control-worktree
copy — the manifest must record that, and did not.

The removal of the HTTP `status` endpoint/schema is confirmed at the schema level: `operationRequestSchema`
in `packages/commercial-contracts/src/index.ts` is a `discriminatedUnion('type', …)` over
`tenant.create | tenant.inspect | health | backup | tenant.entitle | upgrade | restore` — there is no
`status` variant.

### 1.3 Edge (`codex/team-saas-edge`) — slice `t5`

| File | Provenance | Evidence |
| --- | --- | --- |
| `deploy/managed-local/generate.py` | **team-authored (new)** | 204 lines |
| `deploy/test_managed_local.py` | **team-authored (new)** | 137 lines |
| `deploy/control-plane-outage/**` (8 files) | inherited t1 (outage-fixture) — all unchanged | every file byte-identical to its source, e.g. `outage-fixture` `328082d4a92458ff…`, `probe.mjs` `42f7df93600a9cf8…`, `bootstrap.py` `1f6fc3b091c163f5…` |

Only two files are the edge lane's own output. No production deploy file was touched:
`deploy/Caddyfile`, `deploy/docker-compose.yml` and `deploy/proxy/**` are unmodified.

**No missing work and no overlapping writer.** Every file changed belongs to exactly one lane and to
that lane's declared scope. `deploy/managed-local/**` and `deploy/test_managed_local.py` exist, so
`t1`'s earlier "not found" observation is superseded by `t5`'s creation, not a discrepancy.

## 2. Verify results per slice

### 2.1 Adapter (Python, stdlib `unittest`, `python3` 3.9.6)

| Command | Result |
| --- | --- |
| `python3 -B -m unittest discover -s tools -p 'test_managed_runtime.py'` | **PASS — 64 tests, OK, exit 0** (0.247 s) |
| `python3 -B -m unittest discover -s tools -p 'test_nasq_cli.py'` | **PASS — 27 tests, OK, exit 0** |
| `python3 -B -m unittest discover -s tools -p 'test_nasq_cli_operator.py'` | **PASS — 30 tests, OK, exit 0** (accessor) |
| `python3 -B -m unittest discover -s tools -p 'test_nasq_cli_scratch_guards.py'` | **PASS — 26 tests, OK, exit 0** |
| `ruff check tools/nasq_cli/managed_runtime.py tools/nasq_cli/cli.py tools/test_managed_runtime.py tools/test_nasq_cli.py` | **PASS** — "All checks passed!" (ruff 0.16.3) |
| `git diff --check` | **clean** |

No count is aggregated across these suites: they overlap by file, and each number is the result of
one invocation only.

### 2.2 Control (Vitest, Node in the `control` worktree; `node_modules` already present)

| Command | Result |
| --- | --- |
| `npm -w packages/commercial-contracts run test` | **PASS — 4 tests / 1 file, exit 0** |
| `npm -w apps/control-plane run test` | **PASS with one skip — 62 tests passed, 5 files passed, **1 file skipped** (`src/__tests__/service.test.ts`, 0 tests), exit 0** |
| `npm -w packages/commercial-contracts run build` (`tsc --noEmit`) | **PASS**, exit 0 |
| `npm -w apps/control-plane run build` (`tsc --noEmit`) | **PASS**, exit 0 |
| `git diff --check` | **clean** |

`CONTROL_TEST_DATABASE_URL` was **unset**, so the PostgreSQL integration file was skipped. Per batch
contract §4 **a skip is not a pass and is not integration acceptance**. Both "build" scripts are
`tsc --noEmit`; they emit no artifacts.

### 2.3 Edge (Python, stdlib)

| Command | Result |
| --- | --- |
| `python3 -B -m unittest discover -s deploy -p 'test_managed_local.py'` | **PASS — 4 tests, OK, exit 0** |
| `ruff check deploy/managed-local deploy/test_managed_local.py` | **PASS** — "All checks passed!" |
| `git diff --check` | **clean** |

Running the edge suite left the worktree byte-identical (`git status --porcelain` unchanged).

## 3. Interface conformance, Python ↔ worker

Checked by reading both sides and by the executed tests; the cross-language execution itself is
**not** run (see §5).

| Contract requirement | Verdict | Evidence |
| --- | --- | --- |
| One lane function used for both the mutation and the `status` verification | **PASS** | `resolveTargetLane` (`http.ts:82`) is called by `enqueue` and by `executeClaimed`; `worker.ts:121` selects module/env from the same `lane` |
| `scratch` keeps `nasq_cli.operator` + `NASQ_CLI_INVENTORY` | **PASS** | `worker.ts:124-127`; test "keeps scratch operations on `nasq_cli.operator`" |
| `compose-local` uses `nasq_cli.managed_runtime` + `NASQ_MANAGED_INVENTORY` + `NASQ_CLI_STATE_DIR` | **PASS** | same lines; test asserts `calls[0].env.NASQ_MANAGED_INVENTORY` |
| `status` receives the **identical policy bytes** as the create, never a receipt copy | **PASS** | `executeClaimed` reuses `invocation.policyBytesFile`; test asserts `calls[0].policyBytes.equals(calls[1].policyBytes)` |
| Adapter binds identity once and reads the file once | **PASS** | `managed_runtime.py:665-666` reads once under `POLICY_MAX_BYTES`; `:711-712` recomputes with the same bytes |
| Request identity excludes lookup-only inputs | **PASS** | `_request_identity` (`:640-643`) strips `policy_file`/`policy_bytes_file`; `_status` then substitutes the receipt's operation. Create and status therefore reduce to `{operation, target, request_id}` and match |
| No digest recomputation in TypeScript; only identity/format/fingerprint checks | **PASS** | `executeClaimed` checks `/^[a-f0-9]{64}$/` and `fingerprint === lane.descriptorDigest`; the equality is the adapter's |
| Unready create stays `needs_intervention` and blocks; no managed exemption | **PASS** | `worker.ts:260` `incompleteCreate` requires strict `true` for `deployment_ready` **and** managed `policy_verified === true`; managed create receipts are forced to `policy_verified=false`, so a managed create can never be `succeeded`. Test asserts the `needs_intervention`/`deployment_incomplete` write |
| `health`/`status` never activate or resolve | **PASS** | activation at `worker.ts:202` additionally requires `deployment_ready === true && policy_verified === true`; tests assert no `SET status='active'` |
| Mismatched/absent receipt ⇒ quarantine | **PASS** | `receipt_unverified` path; test asserts it |
| Public receipt accepts the managed target form and rejects absolute strings | **PARTIAL — see F-4** | `publicReceipt` target pattern is `/^[a-z][a-z0-9._-]{0,63}$/`, not the strict `^tgt_[a-z0-9_]{1,59}$`; it accepts `tgt_…` incidentally and rejects `/`-bearing strings, and managed targets are bounded upstream by `resolveTargetLane` |
| `policy_verified` stays `false`; no field claims policy application | **PASS** | adapter emits `policy_verified=False` (`:722`, `:626`); worker forces `result.policy_verified = false` for managed create; `tenant.entitle` reports `policy_application_not_wired` (`:756`) |
| `scratch`/`non_saas` unaffected | **PASS** | `non_saas` refused by `_authorize_operation`; the managed lane never writes the scratch marker; scratch keeps its existing path |
| `journal.read_receipt` semantics preserved | **PASS** | accessor byte-identical to the t1 source; `t3` did not edit it |

**Edge static contract:** image references must be pinned by `@sha256:<64 hex>` (`generate.py:71-72`);
`port`, `subnet`, `network_name`, `compose_project`, `database`, `filestore`, `db_secret`,
`admin_secret`, `hostname` are all required with no defaults; per-tenant distinctness is enforced for
key, project, database, filestore, network, hostname, port and secrets; subnets must not overlap;
reserved names (`nasq`, `odoo19`, `postgres`, `production`, `canonical`) are refused; no `rate_limit`
and no `/api/commercial/v1` in the generated Caddyfile; output is written `0600` with `O_EXCL`, so an
existing output is refused. All **PASS**.

## 4. Edge specifics requested before this verification

- **`GATES.md` is a generated output, not a delivered source file.** It is the `GATES` string
  constant at `generate.py:187` written into the operator's output directory at `:173`. **No
  `GATES.md` exists in the edge worktree** — a repository-wide search finds the name only inside
  `generate.py` and `test_managed_local.py`. It must not be counted as a delivered file, and its
  content is verified only indirectly, by the fixture assertion `assertIn("NOT VERIFIED",
  outputs["GATES.md"])` and `assertIn("G3–G5", …)`. The rendered table records G1–G5 as
  `NOT VERIFIED`.
- **`address_pool_checked` and `port_checked` are input declarations, not verification.** Both are
  guarded as `is not True` on operator-supplied input (`generate.py:75` and `:113-114`) and cause a
  fail-closed `ConfigError` when absent. The code performs **no** network or port availability check:
  `validate()` only enforces intra-tenant uniqueness and non-overlap of the two subnets. These
  booleans must never be presented as live network or port evidence.
- `deploy/managed-local/generate.py` and `deploy/test_managed_local.py` are both **present**; the
  directory-level `changedPaths` claim is superseded by these two concrete files.

## 5. Explicitly NOT RUN — none of these is a pass

| Item | Status |
| --- | --- |
| PostgreSQL integration suite (`service.test.ts`) | **SKIPPED** — `CONTROL_TEST_DATABASE_URL` unset. Not acceptance |
| Python↔TypeScript boundary as executed code (real `nasq_cli.managed_runtime` invocation from the worker, canonical-JSON/digest byte equality across languages, receipt verification over a real subprocess) | **NOT RUN** — control tests inject `invokeAdapter` doubles. The bytes-identity property is proven at TS level and the digest equality at Python level; their union is unproven |
| Real managed create against a live Compose project | **NOT RUN** |
| G1 / G2 | **NOT VERIFIED** — and the only executed probe was the bare-`sha256` `postgres:16` probe; it is **not** evidence for `nasq-odoo` / `nasq-web` / proxy images |
| G3 edge routing (Caddy validation + live routes) | **NOT VERIFIED** — no `GATES.md` in the tree; only the static template exists |
| G4 two-tenant browser proof | **NOT VERIFIED** |
| G5 IPv4/IPv6 publication | **NOT VERIFIED** |
| Combined-tree test (all three slices together) | **NOT RUN** — no claim is made that the slices compose |
| Docker, network or port resources | **NOT TOUCHED** |

## 6. Findings for the captain's review

Severity is about impact on this batch, not about production.

| # | Severity | Finding | Owner | One next step |
| --- | --- | --- | --- | --- |
| **F-1** | **medium** | **`hasUnresolvedMutation` is missing the contract-required `jsonb_typeof` hardening.** Batch contract §4 requires that a scratch-lane create whose `deployment_ready` is missing or non-boolean must **not** be exempt. `db.ts:53-55` only added `AND result->>'_control_lane'='scratch'`; with a missing key, `result->>'deployment_ready'='false'` is NULL and `NOT (… AND NULL)` is NULL, so the row is excluded and still reads as exempt. The **managed** lane is safe by two independent mechanisms (the worker forces `result.policy_verified=false`, and the lane marker), so no managed exemption was widened. No test covers this predicate at all. | `luna-control` | Add `jsonb_typeof(result->'deployment_ready')='boolean' AND result->'deployment_ready'='false'::jsonb` to the predicate, plus a predicate test. |
| **F-2** | **medium** | **The removal of the `status` operation left unreachable branches.** `operationRequestSchema` has no `status` variant, so `status` cannot be enqueued — yet `http.ts:161`, `http.ts:169`, `worker.ts:161`, `worker.ts:227` and `worker.ts:238` still handle it. The queued-`status` branch would additionally fail, because the idempotent-replay reshape at `http.ts:161` carries `receipt_request_id`/`operation`/`operation_id` but **not** `policy_bytes`, so `operatorArgs` would throw `status_binding_invalid`. Behaviourally inert today, but the deletion is incomplete and internally inconsistent. The internal status verification used by managed create is separate, reachable, and correct. | `luna-control` | Delete the five queued-`status` branches (or record why they are kept), so the boundary matches the removed schema. |
| **F-3** | **low** | **Dead condition** at `worker.ts:209`: `type === 'create'` can never be true because `type` is `'tenant.create'`. The branch is covered by `MUTATIONS.has(type)`, so behaviour is unaffected. | `luna-control` | Remove the `type === 'create'` disjunct. |
| **F-4** | **low** | **`publicReceipt` does not enforce the strict managed target form.** The contract asks for `^tgt_[a-z0-9_]{1,59}$` alongside the scratch form; the implementation keeps the looser `/^[a-z][a-z0-9._-]{0,63}$/`. Absolute strings are still rejected and managed targets are bounded upstream, so this is a letter-of-contract gap, not an open hole. | `luna-control` | Add the strict `tgt_` alternative to the target pattern. |
| **F-5** | **low** | **`payload_digest` is a newly public receipt field.** `publicReceipt` now whitelists a 64-hex `payload_digest`; managed create then deletes it, scratch keeps it. It is a digest, not policy bytes or a secret, so the "no secrets / no policy bytes in the public receipt" rule still holds — but it is a new public field not named in the contract. | `luna-control` + `grok-review` | Confirm the field is intended public, or delete it for both lanes. |
| **F-6** | **low** | **Two meanings for "descriptorBytes".** The TS `lane.descriptorBytes` **excludes** `descriptor_digest` (used only to feed test doubles), while the Python `_descriptor_bytes` **includes** it (used in the real digest). No runtime mismatch today because the TS value never reaches argv, but the naming invites a future error. | `luna-control` + `luna-adapter` | Rename or document, and decide which form the boundary should carry. |
| **F-7** | **low** | **The managed lane shares the scratch state directory.** `resolveTargetLane` returns `stateDir: config.stateDir`, identical to the scratch lane, so the managed projection is created under the same root as the scratch journal. Not prohibited by the contract, but the lane type implies it could differ. | `luna-control` | Confirm the shared state root is intended; otherwise give the managed lane its own directory. |
| **F-8** | **high** (verification gap) | **The cross-language boundary is not executed by any test.** `worker-managed.test.ts` proves the TS side with `invokeAdapter` doubles, and the adapter's own tests prove the Python side against SQLite. Nothing runs the real Python CLI from the worker, so the canonical-JSON/descriptor-digest byte equality between `json.dumps(..., sort_keys=True, ensure_ascii=False)` and `canonicalJson()` is **unproven**, and a mismatch would surface only as `receipt_unverified` at runtime. | `luna-adapter` + `luna-control` | Add one bounded test that runs the real managed adapter from the worker (or a Python-side replay of the TS canonical bytes) and asserts the fingerprint/digest agree. |
| **F-9** | **info** | **No lane persisted its verify evidence.** All three lane results arrived only as messages; the worktrees contain no evidence document, so this verification re-ran the suites. | `luna-adapter`, `luna-control`, `luna-edge` | Persist the command output in each lane's worktree for the next round. |
| **F-10** | **info** | **An inherited artifact was extended without a manifest note.** `apps/control-plane/src/__tests__/config.test.ts` is no longer byte-identical to its config-lane source (`72bab511…` vs `14b463dd…`) because the control lane added 2 required lines. Correct and in scope, but the config lane's persisted evidence hash no longer describes this copy. | `luna-control` | Note the extension in the overlay manifest. |

No finding contradicts a lane's reported verify result: every command the lanes said they ran was
re-produced here with the same outcome, and the two verifier-visible deviations (F-1, F-2) were not
claimed otherwise by the lanes. F-1 is a requirement the contract placed **in scope** that was not
implemented; F-2 is an inconsistency in work the lane said it had removed.

## 7. Per-criterion verdict

| t6 acceptance criterion | Verdict |
| --- | --- |
| Baseline and changed files per lane documented, inherited overlays separated from team changes, no missing work and no overlapping writer | **PASS** — §1, by hash against the t1 manifest |
| Verify evidence per slice checked; regression and CLI/bytes/receipt/quarantine conformance actually examined; only changed or evidence-less suites re-run; no overlapping counts aggregated | **PASS** — §2–§3; each count is one invocation; §5 lists what was not run |
| Clear pass/fail/not-run per criterion; PostgreSQL / live browser / Docker not counted as success; defects reported to the captain without self-repairing tests or source | **PASS** — §2–§6; no source or test was modified by the verifier |
| Concise user status tying each blocker to an owner and one step; no wait/poll loops and no hidden new assignment | **PASS** — §6 owner/step column and the short section appended to `saas-team-status.md` |

## 8. Non-claims

This verification does not accept Packages 0–7, does not accept any slice as an integrated whole, and
does not claim that the three slices compose — no combined-tree test was run. It does not assert
production readiness, deployment, DNS/TLS, or live-runtime behaviour. A `skip` is never counted as a
pass. Unit success in one language does not prove the cross-language boundary (§5, F-8). G1–G5 remain
unverified; the only executed probe was a single `postgres:16` `sha256` probe and is not evidence for
the Nasq Odoo/web/proxy images. No Docker, network, port, database or customer resource was touched
by this verification. Integration, cleanup and any commit remain the captain's, and are not
authorized by this document.
