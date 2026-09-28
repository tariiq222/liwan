# Managed runtime regression fixture migration

## Scope

Follow-up delegated ownership is limited to `tools/test_managed_runtime.py` and
this new report. Parent owns all runtime changes and new acceptance tests.
Worktree: `/Users/tariq/code/nasq-managed-saas-acceptance`, branch
`codex/managed-saas-acceptance`. No production file was changed in this task.
No live Docker, PostgreSQL/Odoo, network or service actions were performed;
the existing suite uses temporary local SQLite operation-journal fixtures.
No commits, merges or dependency installations were performed.

## Initial regression evidence, before fixture edits

```sh
PYTHONPATH=tools python3 -B -m unittest tools.test_managed_runtime -v
```

Actual result: `Ran 65 tests in 0.131s`, `FAILED (failures=44)`, exit 1.
Unittest counts subtest failures in that failure total. The dominant failure was
`policy_invalid`: placeholder `{"policy":"same"}` no longer enters the newly
catalog-validated create path. This blocked the original intended behavioral
assertions, rather than demonstrating changed collision or journal behavior.

## Every semantic fixture/assertion update

1. **Catalog and policy:** The temporary catalog now copies the exact repository
   `deploy/catalog/solutions/platform.json` bytes, and its SHA-256 reference is
   recomputed from those bytes. The create policy is the valid core composition:
   base modules only and null users/storage limits. No all-pillars assumption.
2. **Runner evidence:** `RecordingRunner` emits `NASQ_MANAGED_POLICY:` JSON only
   for Odoo `shell` invocations with nonempty script stdin. It supplies the target
   database, SaaS/control-plane classification, active state, revision 1, selected
   core modules and core features. Non-shell commands retain zero exit and empty
   stdout. Explicit result queues or `default=(0, '', '')` override simulation,
   so an intentionally empty runner remains empty. Parent's empty-output failure
   acceptance test was not edited.
3. **Independent verification:** `successful_create` asserts six child calls:
   database up, `pg_isready`, selected-module installation, apply shell, separate
   readback shell, services up. It checks the `-i` argument and two distinct script
   invocations: apply contains `OPERATOR_CONTEXT`; readback does not. Verified
   result and returned features must match the fixture. This strengthens success
   evidence beyond the earlier three zero-exit commands.
4. **Health isolation:** A per-test guard makes `_http_health` raise if reached
   unexpectedly. Only the successful-create helper temporarily replaces it with
   true and asserts exactly one call naming the expected target database. No
   actual HTTP request can be made by these helpers. Phase-A recovery now uses
   that same success helper rather than an unguarded direct create invocation.
5. **Failure injection:** Existing interrupted-create fixtures now script success
   for database up and readiness, then failure at module installation. This is
   the original intended failure point shifted by the newly inserted readiness
   command, not a new acceptance of retries. Quarantine, changed-state,
   non-destructive argv and retained failure-stage assertions remain intact.
6. **Policy byte conflicts:** The create request-ID conflict and status digest
   mismatch tests now append JSON whitespace to valid policy bytes. Thus they
   still prove byte identity matters while respecting pre-journal policy
   validation. Same-content/different-path replay assertions are unchanged.
7. **Readiness:** The successful create lifecycle assertion changes
   `deployment_ready=False` to `True` because the fixture now supplies independent
   policy readback plus explicit health evidence. This does not assert real
   deployment readiness; it tests the adapter's response to those doubles.
8. **Bounded install API:** The existing bounded-argv test additionally supplies
   `modules=CORE_POLICY['modules']`, verifies exact `-i` contents and confirms
   missing explicit modules raises `ManagedFailure` with `policy_invalid`.

No collision, authorization, cross-target request ownership, idempotent replay,
pre-effect refusal, status no-effect, private journal/projection, failure
preservation, scratch-lane or secret-redaction assertion was removed or weakened.
All 65 original test methods remain.

## Verification after fixture migration

The same unittest command passed: `Ran 65 tests in 0.257s`, `OK`, exit 0.
After adding the explicit install-argv assertions, the suite passed again but
Ruff reported one `raw-string-in-exception` finding. The test-double message was
assigned to a local variable; no lint rule was disabled.

Final command at this checkpoint:

```sh
PYTHONPATH=tools python3 -B -m unittest tools.test_managed_runtime -v && ruff check --no-cache tools/test_managed_runtime.py && git diff --check -- tools/test_managed_runtime.py && git diff -- tools/test_managed_runtime.py
```

Actual result: `Ran 65 tests in 0.250s`, `OK`; Ruff `All checks passed!`;
scoped whitespace/diff inspection passed; combined exit 0.

## Coordinated status follow-up

Parent identified and fixed a separate status activation issue: the old `_status`
always returned `policy_verified=False`, even when the stored create receipt
contains verified readback and readiness. After the parent's change, the two
existing success/status cases (`test_t63_status_returns_the_stored_receipt` and
`test_t64_status_has_no_effects`) now require `policy_verified=True`,
`deployment_ready=True`, matching features and revision 1. All original
receipt-identity, no-runner/no-probe, unchanged projection and journal assertions
remain.

A new `test_legacy_incomplete_receipt_stays_unverified_and_read_only` directly
seeds the old incomplete receipt shape. It requires false verification, no true
readiness, no top-level profile, no projection creation, an unchanged journal row,
zero runner calls, zero probe calls and no HTTP health call. This prevents new
verified successes from accidentally promoting legacy incomplete receipts.
This is the ninth semantic update, coordinated with the parent-owned status
implementation. No separate RED is claimed for this follow-up; the parent
reported its production fix ready before these regression expectations changed.

Final follow-up command:

```sh
PYTHONPATH=tools python3 -B -m unittest tools.test_managed_runtime -v && ruff check --no-cache tools/test_managed_runtime.py && git diff --check -- tools/test_managed_runtime.py
```

Actual result: **66 tests**, `Ran 66 tests in 0.299s`, `OK`; Ruff
`All checks passed!`; scoped whitespace check clean; combined exit 0. All 65
original tests are retained, plus the new legacy-receipt regression. No remaining
production regression was observed in this owned suite.

## Credential-stage follow-up

Parent subsequently added an initial admin credential apply and independent
credential readback contract. These stages must complete after policy readback
but before exposing services. This follow-up owns only the same test/report files.
The first baseline run was still **66 tests OK** (0.278s), because the parent's
runtime wiring had not yet landed at that moment.

The tenth semantic update extends the runner simulation to recognize only
credential shell scripts containing `NASQ_MANAGED_CREDENTIALS:` and an explicit
`snapshot = False` (apply) or `snapshot = True` (readback). It returns a separate
DB-bound credential sentinel with `changed=True` or `False` respectively and
`verified=True`. Explicit runner results/defaults still take precedence; empty
output is never upgraded to evidence by the double.

Successful-create assertions now require **eight** runner calls and **four**
independent shell calls: policy apply/readback, credential apply/readback, then
services up. Policy shell invocations do not carry `-e`; credential shell calls
must carry `-e NASQ_ADMIN_PASSWORD` before the `odoo` service name. The secret is
in the synthetic child environment only, never embedded in argv or script text.
Credential readback must contain `SET TRANSACTION READ ONLY`, not the password
write helper. Existing third-call installation failures are unchanged. These are
simulation assertions, not evidence that real admin credentials were changed.

Actual targeted RED after updating the expectations:

```sh
PYTHONPATH=tools python3 -B -m unittest tools.test_managed_runtime.LifecycleCase.test_t36_reserved_admits_create -v
```

Result: **1 test, 1 failure**, `6 != 8` (0.008s), exit 1. This correctly exposed
that parent production wiring was not present yet.

After the parent wired both stages, the final command was:

```sh
PYTHONPATH=tools python3 -B -m unittest tools.test_managed_runtime -v && ruff check --no-cache tools/test_managed_runtime.py && git diff --check -- tools/test_managed_runtime.py
```

Actual result: **66 tests**, `Ran 66 tests in 0.398s`, `OK`; Ruff
`All checks passed!`; scoped whitespace check clean; combined exit 0. No additional
test methods were needed: the shared success assertions now exercise both new
stages in all existing successful-create journeys. Parent's new negative
credential-evidence test remains untouched.

## Evidence limits

This is fixture migration and hermetic regression evidence only. It does not
execute generated Odoo scripts, validate real Docker Compose resources or prove
actual HTTP health. Coverage is unmeasured. Parent acceptance tests, including
empty-runner rejection, remain parent-owned and untouched by this task.

Self-review: accuracy 4/5 (66 tests plus lint, no live runtime claim);
completeness 4/5 (all original methods retained plus legacy coverage, quantitative
coverage unmeasured); clarity 4/5 (ten semantic changes documented, full detail
is longer than the handoff); actionability 5/5 (exact commands and ownership
provided); conciseness 4/5 (some evidence repetition intentionally retained).
Overall 4.2/5. Parent's wider acceptance run remains the next verification step.
