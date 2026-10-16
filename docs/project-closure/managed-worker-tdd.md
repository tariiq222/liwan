# Managed worker acceptance: scoped TDD evidence

## Scope and baseline

Derived from [managed-saas-charter.md](managed-saas-charter.md) and the delegated worker request. Worktree: `/Users/tariq/code/nasq-managed-saas-acceptance`, branch `codex/managed-saas-acceptance`, baseline `d780862e`.

This slice changes only:

- `apps/control-plane/src/worker.ts`
- `apps/control-plane/src/__tests__/worker-managed.test.ts`
- this evidence document

Parent-owned Python changes were already dirty and were read, not edited. No module/contract changes, commits, merges, database operations, Docker actions, or services were performed by this worker task. `npm ci --ignore-scripts` installed independent dependencies in this worktree (exit 0; npm reported one low-severity vulnerability). No dependency symlinks or npm configuration changes were made.

## User journey and acceptance boundary

As an operator, I need managed creation to activate a tenant only when its durable receipt proves the exact requested policy for the enrolled target. Immediate success or true flags alone must not activate it.

The worker now:

1. Keeps the exact policy bytes sent to creation and reuses those bytes for status. Desired policy comes from that same invocation, not a second catalog lookup.
2. Verifies the durable operation ID, request ID, target, operation, descriptor fingerprint, and exact journal digest. The digest follows `webvue_cli.journal.payload_digest`: canonical request, target fingerprint, then length-framed original policy bytes and full enrolled descriptor including `descriptor_digest`. The fingerprint itself excludes the descriptor digest field.
3. Requires durable `deployment_ready === true` and `policy_verified === true`, a `safeProfileFeatures`-valid profile with exactly the expected feature keys and values, and matching top-level/profile initial revision 1 (the Python initial-create verifier requires 1).
4. Requires profile modules as installation evidence: a valid unique module list whose WEBVUE module set exactly matches the selected policy. Stock Odoo dependencies are permitted, as in `managed_verify.parse_snapshot`. The parent clarified that the Python verified profile always exposes modules; absence is therefore rejected.
5. Keeps incomplete managed creation quarantined. Rejected managed evidence has false readiness flags and no projected revision, so it cannot advance the tenant revision or health timestamp through `finishClaim`.
6. Leaves the scratch deployment exemption intact, including its verified observed policy despite `deployment_ready: false`.

This is a worker boundary check, not a replacement for Python's independent target readback and health verification. The worker trusts the managed adapter implementation to establish that proof. Digest equality binds the request; it is not a signature or independent proof that a deployment exists.

## RED / GREEN commands and results

All commands ran from the worktree above.

| Phase | Command | Observed result |
| --- | --- | --- |
| RED 1, before worker edits | `npm -w apps/control-plane run test -- src/__tests__/worker-managed.test.ts` | Exit 1: 15 failed, 13 passed. Valid proof flags were stripped; 12 absent/mismatched profile cases wrongly succeeded; arbitrary and different-policy-byte digests were accepted. |
| GREEN 1 | Same focused command | Exit 0: 28 passed. |
| Characterization expansion | `npm -w apps/control-plane run test -- src/__tests__/worker-managed.test.ts src/__tests__/receipt.test.ts` | Exit 0: 35 passed (33 worker, 2 receipt). |
| RED 2, before revision projection fix | `npm -w apps/control-plane run test -- src/__tests__/worker-managed.test.ts` | Exit 1: 12 failed, 21 passed. Rejected profiles still advanced revision/health projection through a retained public revision. |
| RED 3, required module evidence clarification | `npm -w apps/control-plane run test -- src/__tests__/worker-managed.test.ts` | Exit 1: 1 failed, 33 passed. Verified profile lacking modules wrongly succeeded. |
| Final GREEN | `npm -w apps/control-plane run test -- src/__tests__/worker-managed.test.ts src/__tests__/receipt.test.ts` | Exit 0: 36 passed (34 worker, 2 receipt), no skips. Includes real Python digest parity using pure hashing only. |
| Type/static check | `npm -w apps/control-plane run build` | Exit 0: `tsc --noEmit`. The package has no lint script; this is a type check, not ESLint. |
| Whitespace check | `git diff --check` | Exit 0, no findings. |

No checkpoint commits were made: the user explicitly prohibited commits. The RED results above are executed test failures, not inferred failures.

## Test guarantees

All new behavior tests are in `apps/control-plane/src/__tests__/worker-managed.test.ts` and exercise `executeClaimed` with a mocked pool and injected adapter unless specified.

| Guarantee | Evidence |
| --- | --- |
| Only durable matching proof activates creation and projects the original desired policy/revision | `activates only from the durable verified matching create profile, not the immediate response` |
| True flags cannot override absent profile, wrong features/classification/revision, missing/extra WEBVUE modules, duplicate/malformed module list | Twelve `rejects truth flags with ...` cases; also assert no revision or health timestamp update |
| Request/target/operation-ID/fingerprint/digest mismatch fails closed | Six binding cases, including identical semantic policy with different bytes (trailing newline) |
| Immediate true flags cannot replace incomplete durable flags | Two durable false-flag cases |
| Journal algorithm matches the Python implementation | `accepts a journal digest computed by Python over the identical request and policy bytes`; subprocess imports `journal.payload_digest` only, no journal instance or database |
| Required module evidence cannot be omitted | Verified flags/profile without modules remain `deployment_incomplete`; malformed and mismatching modules are also rejected |
| Scratch incomplete-create exemption survives | Scratch adapter routing, observed-policy projection, server-owned exemption classifier |
| Inspect and health are not creation completion | Safe-profile inspect succeeds without activation; missing-profile inspect fails; health does not activate or copy desired policy |
| Explicit status does not replay creation or activate | One status adapter call only; matching stored create receipt still does not become a create completion |
| Public output remains whitelisted | Happy-path result omits profile; existing `receipt.test.ts` passes |

## Source-grounded status, inspect, and health semantics

- The create path calls managed status to corroborate its mutation. Python `_status` is read-only and returns the stored mutation identity (`operation: tenant.create`). With parent changes, it preserves verified flags/profile only after revalidation of the bound stored evidence. It is not a fresh health probe.
- An explicit worker operation of type `status` remains separate. Even a bound valid create receipt fails the existing general operation-name check (`tenant.create` versus `status`), and does not activate a tenant. This behavior is characterized, not advertised as a successful reconciliation path or fixed in this slice.
- Worker `tenant.inspect` succeeds only with a safe profile, stores the observed features/revision, and does not activate. The Python `_read_only` implementation inspected during this task returns lifecycle/descriptor metadata without a profile; consequently it does not yet provide this worker happy path. A passing injected-profile test is not evidence of a live inspect integration.
- Worker `health` success refreshes `health_checked_at` without activation. The inspected Python standalone health path returns conflict `health_unverified`; it does not yet supply a standalone successful probe. Parent create-time health verification is a separate path.

## Coverage and remaining verification

The installed dependencies do not include `@vitest/coverage-v8`; no coverage percentage was measured or claimed. No packages or contract files were changed to add a coverage provider. The 80% coverage target remains unmeasured for this scoped run.

Database-backed service tests and adapter subprocess suites that create SQLite journals were not run under the no-database-action instruction. No live managed deployment was created by this task. The parent's isolated runtime acceptance and broader integration checks remain necessary; worker mocks and pure-hash parity do not establish deployment, production readiness, DNS, or replay behavior of the real journal.

## Self-review

| Axis | Score | Evidence / improvement |
| --- | --- | --- |
| Accuracy | 4/5 | 36 passing tests and Python digest parity; real deployment evidence belongs to the parent. |
| Completeness | 4/5 | Requested acceptance, rejection, scratch, status/inspect/health boundaries covered; coverage percentage unavailable. |
| Clarity | 4/5 | Exact commands and source semantics are explicit; digest framing adds necessary technical detail. |
| Actionability | 4/5 | Changes remain scoped and uncommitted; parent must run authorized broader acceptance checks. |
| Conciseness | 4/5 | Table-driven negative cases keep test duplication bounded; this document retains detail needed for handoff. |

Overall: 4.0/5. Highest-value follow-ups are the parent's real-runtime acceptance and measured coverage when an approved provider is available. The assessment intentionally separates this tested worker boundary from unproven live behavior.
