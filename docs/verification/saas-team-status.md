# SaaS team handoff inventory — 2026-09-23

## Authority, baseline and preservation

The user explicitly confirmed: “نعم، أوقفت التنفيذ القديم وسلّمت العمل لهذا الفريق”. The prior supervising session's writers are stopped and ownership handed over; this satisfies the mutation gate. No further handoff confirmation was inferred or needed.

Live canonical checkout: `/Users/tariq/code/nasq`, branch `main`, baseline `abde67b64155250f015b8ad213c26609532a124c` (`docs: record verified vendor workspace integration and delivery limits`), `origin/main` is three commits behind. Canonical already had user changes before this work (`apps/web/server/utils/__tests__/vendor-control.test.ts`, `apps/web/server/utils/__tests__/vendor-outage.test.ts`, `.agent-teams/`, and `docs/superpowers/plans/2026-09-23-company-operations-and-vendor-roadmap.md`); none were edited here. No commit/merge/push/deploy/reset/stash/delete or operational Docker/database work was performed. No tests were rerun.

Four independent worktrees were created from the exact baseline:

| Branch | Path | Owner / purpose |
|---|---|---|
| `codex/team-saas-adapter` | `/Users/tariq/code/nasq-team-saas-adapter` | luna-adapter: managed customer CLI/runtime |
| `codex/team-saas-control` | `/Users/tariq/code/nasq-team-saas-control` | luna-control: `apps/control-plane/src` and `packages/commercial-contracts/src`; carries 4 unstaged tracked modifications and 6 untracked paths, nothing staged (see the Git working-tree state table below) |
| `codex/team-saas-edge` | `/Users/tariq/code/nasq-team-saas-edge` | luna-edge: managed local edge; the only pre-existing source copied at this checkpoint is the outage compose fixture (`deploy/managed-local/**` is an intended new deliverable, see notes) |
| `codex/team-saas-evidence` | `/Users/tariq/code/nasq-team-saas-evidence` | deepseek-verify evidence; Grok review report is separate |

All branches point initially to `abde67b`. Worktrees use Git's separate working dirs; dependencies were not linked or installed. Source overlays copied are bounded and listed below. No canonical tracked files were changed by this task. The seven legacy `nasq-saas-*` worktrees remain intact and untouched.

### Git working-tree state in the four team worktrees

Observed read-only with an explicit absolute path per worktree (`git -C /Users/tariq/code/nasq-team-saas-<x> …`); no `cwd`-relative reading and no worktree inspected from inside another. **Three distinct states are recorded separately — "not staged" is not the same as "no tracked modification".**

| Worktree | Staged (index) | Tracked-modified, **unstaged** (`git diff --name-only`) | Untracked (`??`) |
|---|---|---|---|
| `/Users/tariq/code/nasq-team-saas-adapter` | none | `tools/nasq_cli/journal.py`, `tools/test_nasq_cli_operator.py` — 2 files, +167 lines | `tools/nasq_cli/managed_runtime.py`, `tools/test_managed_runtime.py`, `tools/test_nasq_cli_scratch_guards.py` — 3 files |
| `/Users/tariq/code/nasq-team-saas-control` | none | `apps/control-plane/src/db.ts`, `apps/control-plane/src/main.ts`, `apps/control-plane/src/worker-main.ts`, `apps/web/server/utils/__tests__/vendor-control.test.ts` — 4 files, +113/−9 | `apps/control-plane/src/worker-loop.ts`, `apps/control-plane/src/__tests__/db-outage.test.ts`, `apps/control-plane/src/__tests__/config.test.ts`, `apps/web/app/composables/__tests__/useVendorContext.test.ts`, `apps/web/app/middleware/__tests__/`, `apps/web/server/utils/__tests__/vendor-outage.test.ts` — 6 paths |
| `/Users/tariq/code/nasq-team-saas-edge` | none | none | `deploy/control-plane-outage/` — 9 files |
| `/Users/tariq/code/nasq-team-saas-evidence` | none | none | 19 paths (the copied evidence documents plus the Grok batch contract) |

Nothing is staged in any of the four worktrees (`git diff --cached --name-only` is empty for each), **but** the adapter and control worktrees do carry unstaged tracked modifications. Those two facts are independent and must not be collapsed: the copied overlays are **not** uniformly untracked, and a clean index does not mean a clean working tree.

## Packages 0–7 status (latest evidence, not historical summaries)

| Package | Status | Current evidence and authorship / source paths |
|---|---|---|
| 0 — runtime contracts | Implemented, independent review status not established here | `nasq-saas-runtime-contracts`: `docs/superpowers/specs/2026-09-23-saas-runtime-contracts.md`, `docs/operations/`; preserved under evidence worktree. No independent approval claim. |
| 1 — native control service runtime | Implemented; P1 acceptance reported, independent review remains | `nasq-saas-auth-tests/docs/verification/2026-09-23-saas-p1-verification-results.md`; its **final authoritative** table is §86 in Part 13 — **26 acceptance PASS + 1 diagnostic D2**. §88–91 in Part 14 separately record the **control-plane-side** business-outage window timeline (BASELINE_UP → CP shutdown → DURING interval → restore), with `window_valid = true`; Part 11 §76 holds an earlier superseded 23/3/1 table and Part 8's E2/E3 failure is superseded by Part 9. Auth tests, plan/results preserved in evidence. Source writers from the prior control-runtime/supervising overlay; candidate changes sit in the control worktree as **unstaged tracked modifications** (`db.ts`, `main.ts`, `worker-main.ts`, `vendor-control.test.ts`; +113/−9) together with untracked new files (`worker-loop.ts`, `db-outage.test.ts`, `config.test.ts`, the BFF outage test and the auth tests), for assigned implementation/review — not accepted integration, and nothing staged. |
| 2 — managed customer runtime (usable SaaS instance) | In progress / design conditional; implementation not reviewed | Plan `nasq-saas-scratch-guards/docs/superpowers/plans/2026-09-23-saas-p2-managed-runtime-plan.md`; design review says CONDITIONAL PASS (design only), frozen pending P1 (§1, §6, §11). G3–G5 edge/two-tenant gates belong to this package (see notes below). The adapter worktree carries `tools/nasq_cli/journal.py` and `tools/test_nasq_cli_operator.py` as **unstaged tracked modifications** (+167 lines) and the managed-runtime/scratch-guard files as untracked additions; nothing is staged there. `journal.read_receipt` + tests are a separate supervisor-owned shared change carried in that same worktree; adapter may consume it, not alter its semantics without reassignment. |
| 3 — SaaS policy management and health | Reviewed requirements only; not implemented, not acceptance | `nasq-saas-bff-tests/docs/verification/2026-09-23-saas-p3-design-review.md` ("REVIEWED REQUIREMENTS — NOT IMPLEMENTED, NOT ACCEPTANCE"). It records the source-backed gap that the worker synthesizes observed policy from the requested payload. No package acceptance result. |
| 4 — Trustworthy backup and restore | Reviewed design frozen; not implemented; reviewer verdict NEEDS_REVISION | `nasq-saas-config-tests/docs/verification/2026-09-23-saas-p4-design-review.md` (design frozen with 8 blocking review conditions and 4 freeze prerequisites). Numeric RPO/RTO, retention, maintenance window and cutover approval remain undefined human decisions. |
| 5 — Upgrade, rollback and operation reconciliation | Reviewed requirements only; not implemented; pending Packages 2 and 4 | `nasq-saas-config-tests/docs/verification/2026-09-23-saas-p5-design-review.md` ("REVIEWED REQUIREMENTS (Grok, source-backed) / NOT IMPLEMENTED / NOT ACCEPTANCE / PENDING P2 AND P4 CONTRACTS"). |
| 6 — Completing the administration-dashboard actions | Reviewed source-backed requirements only; not implemented | `nasq-saas-bff-tests/docs/verification/2026-09-23-saas-p6-action-map.md`. Still missing in the UI: restore, upgrade/rollback, reconciliation and administrative renewal. This is the vendor administration surface for authorised operators — **not** a customer self-service portal; the roadmap keeps CRM, billing, customer portal and ticketing out of scope. |
| 7 — Integrated acceptance and operational delivery | Not started; no artifact | Requires all preceding packages plus an explicit hosting/target decision and its own authorisation. No acceptance artifact for this package exists. |

Package-map notes:

- **G3–G5 edge-routing and two-tenant gates belong to Package 2, not Package 7.** Their evidence is `nasq-saas-outage-fixture/docs/verification/2026-09-23-saas-p2-edge-routing-g3-g5.md`, whose §5 records all three as **not yet passed** (G3: no Caddy validation or live edge; G4: no browser two-tenant run; G5: no Docker publication or IPv6 tests). The P2 design review freezes the same gates under Package 2.
- **BFF and control-plane config regression are verification lanes, not roadmap packages.** `2026-09-23-saas-bff-regression.md` (2 files / 10 tests / 0 skipped) and `2026-09-23-saas-config-regression.md` (1 file / 47 tests, exit 0) supply bounded unit-test evidence for management-plane surfaces; they do not define Packages 3 and 4.

## Overlay manifest: exact files copied or patched

- `nasq-saas-scratch-guards` → adapter: new `tools/nasq_cli/managed_runtime.py`, `tools/test_managed_runtime.py`, `tools/test_nasq_cli_scratch_guards.py`; tracked `tools/nasq_cli/journal.py` and `tools/test_nasq_cli_operator.py` moved only as `git diff --binary` patch (two files, 167 added lines). Preserve P1 accessor at `journal.py:179–213`; tests cover mutating row remains unchanged, digest/fingerprint identity, lock conflict, absence, invalid JSON and no writes. No whole tracked file replacement.
- `nasq-saas-control-runtime` → control: reviewed diff for `apps/control-plane/src/db.ts`, `main.ts`, `worker-main.ts` applied with `git diff --binary`; new `worker-loop.ts` and `__tests__/db-outage.test.ts` originate from **`nasq-saas-control-runtime`** (bounded source check: `worker-loop.ts` = `32274ea48b699c01…`, `db-outage.test.ts` = `fa3adcf78305b519…`, both present in `nasq-saas-control-runtime` and absent from `nasq-saas-config-tests`; both hashes match the values declared in the P1 report Part 9 §57); `__tests__/config.test.ts` (`14b463dd2db015e3…`) originates from `nasq-saas-config-tests`; BFF `apps/web/server/utils/__tests__/vendor-control.test.ts` and `vendor-outage.test.ts` copied from `nasq-saas-bff-tests`; auth `useVendorContext` and middleware tests from `nasq-saas-auth-tests`. The copied set is **mixed, not uniformly untracked**: `apps/control-plane/src/db.ts`, `main.ts`, `worker-main.ts` and `apps/web/server/utils/__tests__/vendor-control.test.ts` are **unstaged tracked modifications** (4 files, +113/−9), while `worker-loop.ts`, `db-outage.test.ts`, `config.test.ts`, `useVendorContext.test.ts`, `apps/web/app/middleware/__tests__/` and `vendor-outage.test.ts` are untracked (6 paths). Nothing is staged in any worktree. These are retained artifacts, not assertions that all compose without review.
- `nasq-saas-outage-fixture` → edge: `deploy/control-plane-outage/` copied (all 8 files byte-identical to their source, per the `t6` verification). At `t1` time `deploy/managed-local/` and `deploy/test_managed_local.py` were **absent by design** — an intended new deliverable of Package 2 / task `t5`, not missing or lost data and not a blocker. **Superseded:** `t5` has since created them (`deploy/managed-local/generate.py`, 204 lines; `deploy/test_managed_local.py`, 137 lines), and this is the only source the edge lane authored. `deploy/Caddyfile`, `deploy/docker-compose.yml` and `deploy/proxy/**` remain unmodified.
- `nasq-saas-runtime-contracts` → evidence: runtime contract spec + operations folder.
- Reports/design/plan files from auth, BFF, config, outage, scratch and control-runtime worktrees copied into evidence for this handoff. They are historical source evidence only; sensitive `.p1-*`, `.superpowers`, secrets, runtime env/config and databases were not copied.

## Preservation and limits

- In the P1 report, §86 (Part 13) is the **final authoritative** table — 26 acceptance PASS + 1 diagnostic D2 — and D2's PostgreSQL integration skip is explicitly not acceptance. **§88–91 (Part 14) is a different thing:** the control-plane-side business-outage window timeline with `window_valid = true`, plus post-restore identities, a disclosed ordering deviation and the final quiescent state. The **12/12 customer-side** before/during/after probes are the **fixture lane's own report** (`2026-09-23-saas-business-outage.md`), quoted by the P1 report as another lane's measurement. Neither half alone means full P1 acceptance; the gate as a whole is still open.
- Accessor implementation remains in the adapter task worktree at `/Users/tariq/code/nasq-team-saas-adapter/tools/nasq_cli/journal.py:179` (`read_receipt`; +36 lines, with its tests in `tools/test_nasq_cli_operator.py`, +131 lines) exactly as sourced from the supervisor-owned diff — both carried as unstaged tracked modifications. Do not edit/reimplement `journal.py` without explicit single-writer assignment.
- Existing canonical status remains ahead of origin/main with three local commits and preexisting dirt. Integration is outside this task and remains captain-owned.
- Docker/image execution and live reconciliation, customer target operations, environment/resource creation beyond git worktrees are outside this task; no new operational decision or authorization is implied. G1/G2 probes are PostgreSQL image only and are not proof for Nasq Odoo/web/proxy images.
- No testing performed for this handoff; test outcomes above quote existing report evidence only. No claim of package 0–7 full acceptance. The "no testing performed" sentence describes the **`t1` handoff only** — see the batch verification below.

## Batch verification of the three slices (`t6`) — read-only and independent

Full report: [`saas-team-batch-verification.md`](saas-team-batch-verification.md). Source was inspected read-only in the adapter/control/edge worktrees; no source was edited and nothing was committed.

**Verified pass (fresh output from this verifier):** adapter Python suites 64 + 27 + 30 + 26 tests OK, `ruff` clean; edge suite 4 tests OK, `ruff` clean; control `commercial-contracts` 4 tests and `control-plane` 62 tests passed with **one file skipped**, plus both `tsc --noEmit` checks; `git diff --check` clean in all three. Inheritance was proven by hash: the adapter's `journal.py`/accessor/scratch-guard files, the control lane's BFF/auth/`db-outage`/`worker-loop` files, and all eight edge outage-fixture files are **byte-identical to their `t1` sources**. Each lane's own output is confined to its scope — adapter: `managed_runtime.py`, `test_managed_runtime.py`, `cli.py`, `test_nasq_cli.py`; control: six `apps/control-plane/src` files plus `packages/commercial-contracts`; edge: `deploy/managed-local/generate.py` and `deploy/test_managed_local.py`. No writer overlaps and no work is missing.

**Not run, and therefore not a pass:** the PostgreSQL integration suite (skipped — `CONTROL_TEST_DATABASE_URL` unset); the real Python↔TypeScript invocation (control tests use injected doubles, so cross-language canonical-JSON/digest byte equality is unproven); any live managed create; G1–G5 (only a single `postgres:16` `sha256` probe was ever executed, which is not evidence for the Nasq Odoo/web/proxy images); and the combined-tree test.

**Blockers at the time of `t6` — all since resolved or reclassified; none is a current blocker:**

| `t6` finding | Current state |
| --- | --- |
| `hasUnresolvedMutation` lacked the contract-required `jsonb_typeof` hardening | **closed** by `t15`/`t16` — the predicate now requires `jsonb_typeof(result->'deployment_ready')='boolean'` and `result->'deployment_ready'='false'::jsonb`, wrapped in `COALESCE(…, false)`, with `isScratchDeploymentExemption` plus SQL-fragment assertions covering missing, JSON-null, string, true, object and number, and managed/no-marker. **No PostgreSQL run**: the classifier test is a literal-fragment check, not DB integration |
| The removed `status` operation left five unreachable branches | **reclassified** by the `t8` review: unreachable, no leak today, deletion is cleanup — **not an acceptance condition** |
| The Python↔TypeScript boundary is never executed | **reclassified** by the `t7` review: it measured equal digests (`sha256:0ef2774d…f21fc4`) for one descriptor that passed `validate_descriptor`, so the mismatch claim did not reproduce; the boundary itself remains unexecuted → residual limitation, not a proven failure |
| No lane persisted its verify evidence | **resolved** — the three review reports and the verification report are now persisted in the evidence worktree |

Lower-severity items — the dead `type === 'create'` condition, the loose `publicReceipt` target pattern, the newly public `payload_digest`, the two meanings of `descriptorBytes`, the shared managed/scratch state directory, and the extended `config.test.ts` manifest note — are recorded in the full report. The reviewer ruled the `publicReceipt` pattern and the `descriptorBytes` difference non-blocking; `payload_digest` and the shared state directory were not ruled on and are carried as residuals, not as closed items.

## Batch delivery (`t10`) — evidence and quality gate

Full document: [`saas-team-batch-delivery.md`](saas-team-batch-delivery.md). **This is a delivery gate, not Git integration and not SaaS acceptance**: nothing was merged, committed, pushed, deployed, copied onto `main`, or executed against a runtime resource.

- **Source manifest:** the three source worktrees `nasq-team-saas-{adapter,control,edge}` plus this evidence worktree, with the actual team-authored files and their current hashes, and the inherited overlays named as **not** team work. All four worktrees sit on `abde67b6` with no commits and nothing staged.
- **Reviews:** adapter and control were `needs_revision` in round 1 and are **PASS** after the `A-1`/`C-1` repairs; edge is **PASS within its static-source limits**. Latest reported suite results are per-invocation (adapter 64 + 27, control 64 + contracts 4, edge 4); they are never summed into one total, and the skipped PostgreSQL file is not a pass.
- **Status interface conformance after the fix** is stated explicitly, including that request identity reduces to `{operation, target, request_id}` and that the adapter substitutes the stored row's operation.
- **Not executed, so not a pass:** PostgreSQL integration, the combined-tree build/test, any live managed create, G1–G5, and any live customer/browser/Docker step.
- **Batch limits:** source + unit + review are done and verified at that level; **Package 2 and every other SaaS package remain incomplete** until runtime evidence exists. No background job, service, container, network, port or database was started, and no writer is mid-flight.

### One consolidated list of remaining decisions (no per-step approval)

1. **RD-2, RD-7, RD-8** — reconciliation invoker/scope, durable per-dimension health evidence, and the readiness-evidence freshness window. They block the reconciliation implementation, not this delivery.
2. **Policy application and entitlement** — decide the `tenant.entitle` identity/content set and wire policy application, then build the **minimal reconciliation path** that is the only route to `active` and to the `provisioned` lifecycle.
3. **One live-acceptance authorization bundle** — scratch resources, Docker network handling, pinned digests for the Nasq/Caddy images, and a browser two-tenant window. This unlocks G1–G5 and the first real managed create.
4. **Package 4 freeze conditions** — close the 8 blocking review conditions and 4 freeze prerequisites before any capture or restore.
5. **`non_saas` operations binding** — stays an explicit open human decision; it confers no commercial authority.
6. **canonical dirt and `stash@{0}`** — outside this batch.

### Packaged status 0–7

The authoritative table with owner-per-package is §7 of [`saas-team-batch-delivery.md`](saas-team-batch-delivery.md): Package 1 has an executed P1 result plus the batch's lane/status wiring but its gate is still open; Package 2 has complete **source + unit + review** with every live step outstanding; Packages 3–6 are reviewed requirements only; Package 7 has no artifact. Live `main` is unchanged at `abde67b6` with only its pre-existing dirt.
