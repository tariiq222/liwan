# Batch delivery — evidence and quality gate before any integration or live run (2026-09-23)

**This is a delivery/evidence gate, not Git integration and not SaaS acceptance.** Nothing was merged, committed, pushed, deployed, copied onto `main`, or executed against a runtime resource to produce this document. Source changes remain uncommitted in their own worktrees.

Batch contract: `docs/superpowers/specs/saas-team-batch-contract.md`. Independent verification: `docs/verification/saas-team-batch-verification.md`. Review reports: `saas-team-adapter-review.md`, `saas-team-control-review.md`, `saas-team-edge-review.md`.

## 1. Source manifest — the three source worktrees

Baseline for all four worktrees: `abde67b64155250f015b8ad213c26609532a124c` (`abde67b6`). **No commits and nothing staged in any worktree.**

| Lane | Worktree (`git worktree` path) | Branch | Team-authored files (current SHA-256 prefix) |
| --- | --- | --- | --- |
| adapter (P2 slice 2A) | `/Users/tariq/code/nasq-team-saas-adapter` | `codex/team-saas-adapter` | `tools/nasq_cli/managed_runtime.py` `9c70050961b4cbd3`; `tools/test_managed_runtime.py` `06759d56adefcf15`; `tools/nasq_cli/cli.py` `64aac3e210e32e0b`; `tools/test_nasq_cli.py` `9ec3251362ca6834` |
| control (P2 slice 2B) | `/Users/tariq/code/nasq-team-saas-control` | `codex/team-saas-control` | modified: `apps/control-plane/src/config.ts` `24503a7604713686`, `db.ts` `4b967d494982e7db`, `http.ts` `e99536042f30b3e2`, `main.ts` `fd62ebb5c8a10380`, `worker-main.ts` `415ecd5a6c4f17d6`, `worker.ts` `aa820834e615cfe8`, `packages/commercial-contracts/src/index.ts` `35f38b86eaf21df5`; new: `__tests__/config.test.ts` `72bab511bee09eb4`, `__tests__/db-outage.test.ts` `fa3adcf78305b519`, `__tests__/worker-managed.test.ts` `b0067416795682d5`, `worker-loop.ts` `32274ea48b699c01` |
| edge (P2 slice 2C) | `/Users/tariq/code/nasq-team-saas-edge` | `codex/team-saas-edge` | `deploy/managed-local/generate.py` `784b83618a86042a`; `deploy/test_managed_local.py` `81fff8a270c97ad8` |
| evidence (reports only) | `/Users/tariq/code/nasq-team-saas-evidence` | `codex/team-saas-evidence` | this document and the verification/review reports |

**Inherited overlays are not team work.** Proven byte-identical to their `t1` sources: the adapter's `journal.py` (the `read_receipt` accessor), `test_nasq_cli_operator.py`, `test_nasq_cli_scratch_guards.py`; the control lane's BFF `vendor-control.test.ts` / `vendor-outage.test.ts`, auth `useVendorContext.test.ts` / middleware `vendor.test.ts`, and the `db-outage.test.ts` / `worker-loop.ts` pair from `nasq-saas-control-runtime`; and all eight `deploy/control-plane-outage/` files in the edge worktree. Nothing inherited was modified, except `config.test.ts`, which the control lane extended by the two lines its `config.ts` change required (`72bab511…` vs `14b463dd…`).

`null`, `undefined` and the "not present" case are never conflated with "present but empty" anywhere in this delivery: the three slices' own output is exactly the files listed above, and `t1`'s earlier "`deploy/managed-local` not found" is superseded by `t5` creating it, not a discrepancy.

## 2. Review and verification evidence

| Artifact | Verdict | Scope of the verdict |
| --- | --- | --- |
| `saas-team-adapter-review.md` (t7) | round 1 `needs_revision` (A-1) → **closed by t13/t14: PASS** | adapter slice, source + unit only |
| `saas-team-control-review.md` (t8) | round 1 `needs_revision` (C-1) → **closed by t15/t16: PASS** | control slice, source + unit only |
| `saas-team-edge-review.md` (t9) | **PASS within the slice's static-source limits** | edge slice, static source only |
| `saas-team-batch-verification.md` (t6) | independent verification; classification of all lanes, incl. inherited vs team changes | read-only, unit-level |

Latest reported suite results, per lane (numbers are **per-invocation**, never summed across lanes — the suites overlap):

| Lane | Reported result | Note |
| --- | --- | --- |
| adapter | 64 tests (`test_managed_runtime.py`) and 27 (`test_nasq_cli.py`), ruff clean, `git diff --check` clean | unit; SQLite temp only |
| control | 64 tests passed (`apps/control-plane`) with **`service.test.ts` skipped**; 4 contracts tests; both `tsc --noEmit` clean | 62 were independently measured by `t6` on the pre-repair source; the repair added 2 classifier tests. The skip is not a pass |
| edge | 4 tests, ruff clean, `git diff --check` clean | static/fixture only |

No inflated total appears anywhere: the adapter's 64+27, the control's 64+4, and the edge's 4 are separate invocations over different trees, and `t6` is **not** an additional lane result — it re-ran what had no persisted evidence.

## 3. Closed round-1 defects (history, not current blockers)

| id | Was | Closure |
| --- | --- | --- |
| **A-1** | adapter `status` receipt echoed `operation = status` instead of the stored row's `tenant.create`, so every managed create would have been quarantined as `receipt_unverified` by `worker.ts` | **closed** — `managed_runtime.py` now sets `receipt_fields['operation'] = row['operation']` before building the public payload, `policy_verified` stays `false`, and no journal write occurs (t14 re-read the source and re-ran 64 + 27 tests, ruff and `diff --check`). |
| **C-1** | the scratch exemption in `db.ts` used `result->>'deployment_ready'='false'`, so a missing or non-boolean value made the predicate NULL and the row read as exempt | **closed** — the predicate now requires `jsonb_typeof(result->'deployment_ready')='boolean'` **and** `result->'deployment_ready'='false'::jsonb`, wrapped in `COALESCE(…, false)` to defeat three-valued logic, and a pure classifier `isScratchDeploymentExemption` plus SQL-fragment assertions cover the missing, JSON-null, string, true, object and number cases and the managed/no-marker cases (t16). |

## 4. Status interface conformance after the fix

The managed `status` call is the batch's cross-boundary contract, so it is stated explicitly:

- One lane resolver (`resolveTargetLane`) serves both the mutation and the `status` verification; `scratch` keeps `nasq_cli.operator` + `NASQ_CLI_INVENTORY`, `compose-local` uses `nasq_cli.managed_runtime` + `NASQ_MANAGED_INVENTORY` + `NASQ_CLI_STATE_DIR`.
- The worker writes the policy bytes once and passes the **same file** to the create and to the internal `status` call; the adapter reads it once under the 16 384-byte bound and recomputes the digest from those bytes.
- Request identity excludes lookup-only inputs, so create and `status` both reduce to `{operation, target, request_id}`; the adapter substitutes the stored row's operation, which is what makes the receipt comparable after the A-1 fix.
- No digest is recomputed in TypeScript: the worker checks shape and identity only (`^[a-f0-9]{64}$`, `fingerprint === lane.descriptorDigest`, operation/target/request match). Equality is the adapter's.
- `policy_verified` stays boolean `false`; a managed create can never reach `succeeded`, and activation requires `deployment_ready === true` **and** `policy_verified === true`; `health`/`status` neither resolve the row nor lift quarantine; `tenant.entitle` reports `policy_application_not_wired`.

**What this conformance is not:** it is proven by reading both sides plus unit tests and TypeScript doubles. The **real** Python adapter has never been invoked by the worker, so the cross-language canonical-JSON/digest equality is a residual limitation (§5), and the literal SQL-fragment test plus review inspection of the predicate are **not** PostgreSQL integration evidence.

## 5. Residual limitations — not closed, not claimed closed

Recorded per the reviewers' verdicts; none of these is a delivery blocker, and none is claimed as fixed.

| id | Item | Reviewer position |
| --- | --- | --- |
| F-2 | five unreachable branches still handle the removed `status` operation (`http.ts:161,169`; `worker.ts:161,227,238`); the one at `http.ts:161` would additionally throw `status_binding_invalid` because the replay reshape does not carry `policy_bytes` | t8: unreachable, no leak today, **deletion is cleanup, not an acceptance condition** |
| F-3 | dead condition `type === 'create'` in `worker.ts` (the value is `'tenant.create'`; `MUTATIONS.has(type)` already covers it) | not raised as a defect; residual cleanup |
| F-4 | `publicReceipt`'s target pattern is `/^[a-z][a-z0-9._-]{0,63}$/`, not the strict `^tgt_[a-z0-9_]{1,59}$`; absolute strings are still rejected and managed targets are bounded upstream | t8: **not an acceptance defect** |
| F-5 | `payload_digest` is now whitelisted into the public receipt (kept for scratch, deleted for managed) — a digest, not policy bytes or a secret | **not ruled on by the reviewer**; left as a residual to confirm |
| F-6 | two meanings for "descriptorBytes": the journal bytes include `descriptor_digest`, `lane.descriptorBytes` excludes it; the worker never passes the descriptor buffer into `payload_digest`, so no proven verification failure | t7: **latent, not a proven failure** |
| F-7 | the managed lane shares the scratch state directory (`stateDir: config.stateDir`) | **not ruled on**; residual to confirm |
| F-8 | digest/canonical-JSON equality across Python and TypeScript is not exercised end-to-end | t7 measured equal digests (`sha256:0ef2774d…f21fc4`) for one descriptor that passed `validate_descriptor`, so the mismatch claim **did not reproduce**; the boundary remains unexecuted |
| F-9 | lanes originally persisted no verify evidence | **resolved for this batch** — the three review reports and the verification report are now persisted in the evidence worktree |
| F-10 | `config.test.ts` was extended by 2 required lines, so the config lane's earlier hash no longer describes it | recorded in §1; informational |

## 6. Explicitly NOT executed — none of this is a pass

- **PostgreSQL integration**: `service.test.ts` was skipped (`CONTROL_TEST_DATABASE_URL` unset). A skip is not integration acceptance, and the `db.ts` predicate is **not** proven against a live database.
- **Combined-tree test**: the three slices were never built or tested together. This delivery makes **no claim that they compose**.
- **Live managed create / entitlement / reconciliation**: not run.
- **G1–G5**: not verified. The only probe ever executed in this batch was a bare-`sha256` `postgres:16` probe, which is **not** evidence for the `nasq-odoo`, `nasq-web` or proxy images. `GATES.md` is a generated output of `generate.py`, not a delivered file, and it records G1–G5 as `NOT VERIFIED`.
- **Live customer / browser / Docker / network / port**: untouched.

## 7. Package status 0–7 with owner

| # | Package | State | Owner of the next move |
| --- | --- | --- | --- |
| 0 | Runtime decision and delivery contracts | contract drafted, Grok delta PASS on the **local** contract only; live Package 0 unproven | captain / orchestrator |
| 1 | Nasq administration runtime and its permissions | P1 implementation exists; **26 acceptance PASS + 1 diagnostic D2** and a CP-side outage window with `window_valid = true`; the batch added the lane and `status` wiring | `luna-control` + captain (gate as a whole still open) |
| 2 | A usable SaaS instance | **source + unit + review complete** for all three slices; G3–G5 and every live step outstanding | lanes done for the unit slice; live acceptance needs the §8 authorizations |
| 3 | SaaS policy management and health | reviewed requirements only; observed-policy synthesis gap recorded | unassigned — needs the renewal contract |
| 4 | Trustworthy backup and restore | design frozen, reviewer verdict `NEEDS_REVISION` (8 conditions, 4 freeze prerequisites); RPO/RTO/retention undecided | unassigned |
| 5 | Upgrade, rollback and operation reconciliation | reviewed requirements only; blocked on 2 and 4 | unassigned |
| 6 | Completing the administration-dashboard actions | source-backed action map; restore, upgrade/rollback, reconciliation and renewal still missing in the UI | unassigned |
| 7 | Integrated acceptance and operational delivery | not started; no artifact | captain |

**Live `main`:** `/Users/tariq/code/nasq` is on `main` at `abde67b6`, three commits ahead of `origin/main`, with only its pre-existing dirt (`apps/web/server/utils/__tests__/vendor-control.test.ts` modified, untracked `vendor-outage.test.ts`, `.agent-teams/`, and the untracked roadmap). The seven legacy `nasq-saas-*` worktrees are intact. No commit, merge, push, deploy or deletion occurred in this batch.

## 8. One consolidated list of remaining decisions

No approval is needed per unit step; these are the decisions that gate the next phase.

1. **RD-2, RD-7, RD-8** — who may invoke reconciliation and in what scope; the durable per-dimension health-evidence shape; the freshness window for readiness evidence at reconciliation time. These three block the reconciliation implementation, not this delivery.
2. **Policy application and entitlement** — decide the `tenant.entitle` identity/content set and wire policy application, after which `policy_verified` may stop being permanently `false`; **then** the minimal reconciliation path that is the only route to `active` and to the `provisioned` lifecycle.
3. **Live-acceptance authorizations, one bundle** — scratch resources, Docker network handling, pinned image digests for the Nasq/Caddy images, and a browser two-tenant window. These unlock G1–G5 and the first real managed create.
4. **Backup/restore freeze conditions** — close the 8 blocking review conditions and the 4 freeze prerequisites of Package 4 before any capture or restore is attempted.
5. **`non_saas` operations binding** — whether a non-SaaS installation may ever carry an operations binding; today it is an explicit open human decision and confers no commercial authority.
6. **canonical dirt and the stash** — the fate of the two accidental BFF test copies in `main` and `stash@{0}` (CP2 originals); outside this batch.

## 9. Batch limits — stated plainly

**Achieved:** source for the three slices, focused unit tests, and independent review + independent verification — all of it local, uncommitted, and unit-level.

**Not achieved:** Package 2 and every other SaaS package remain incomplete. There is no runtime evidence, no PostgreSQL integration, no combined-tree test, no live create, no G1–G5 result, and no deployment. The management plane is not proven to work on real resources, and the customer edge is not proven to serve a browser.

**No implicit work is left running:** no background jobs, services, containers, networks, ports or databases were started by this delivery, and no writer is mid-flight — each lane's output is settled in its own worktree as listed in §1. This document is a gate that reports status; it transfers nothing.
