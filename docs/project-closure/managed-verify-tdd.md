# Managed initial-policy verification — TDD evidence

## Scope and authority

This scoped child implementation follows [the managed SaaS charter](managed-saas-charter.md).
It owns only:

- `tools/webvue_cli/managed_verify.py`
- `tools/test_managed_verify.py`
- this evidence document

Worktree: `/Users/tariq/code/nasq-managed-saas-acceptance`, branch
`codex/managed-saas-acceptance`, initial HEAD `d780862e`.
Existing parent/other-worker dirty files were preserved. No Docker command,
real Odoo process, database access, credential handling, commit, merge, or
runtime integration was performed by this child. The user prohibited checkpoint
commits; RED/GREEN evidence is recorded here instead.

## Journeys and integration API

As the initial-create operator, apply the catalog-derived features only to the
explicit new scratch target, then verify the committed policy in an independent
read-only shell before declaring readiness. As the runtime caller, reject missing,
ambiguous, oversized, malformed, or mismatched evidence without exposing logs.

```python
from webvue_cli.managed_verify import (
    VerificationError,
    build_policy_script,
    build_snapshot_script,
    parse_snapshot,
)

# policy is the already catalog-validated create document:
# {schema_version: 1, channel: 'control_plane', modules: [...], features: {...}}
apply_stdin = build_policy_script(policy, database)
# Parent runs the authorized shell, checks its exit status, then:
apply_ack = parse_snapshot(apply_stdout, policy, database)

# Mandatory fresh shell process/transaction, not reuse of apply_stdout:
snapshot_stdin = build_snapshot_script(database)
verified_snapshot = parse_snapshot(snapshot_stdout, policy, database)
```

The helpers generate scripts; they never start a process. Parent owns bounded
subprocess execution, image/target identity, classification mounting, stderr
handling, uncertain-outcome quarantine, initial-resource authorization, and
health checks. The parent must check shell exit status and must not truncate
oversized output into apparently valid evidence. Host parsing bounds stdout at
65,536 UTF-8 bytes; embedded policy is limited to 16,384 bytes, feature count to
256, installed-module count to 1,024. Parent must impose process deadlines,
including time spent acquiring the profile row lock.

The guarded image entrypoint recognizes `shell` only as its first command
argument. Use that entrypoint, an explicit `-d webvue_scratch_<suffix>` and exact
`--db-filter`, `--no-http`, `--workers=0`, and `--max-cron-threads=0`; feed the
script through stdin. Do not bypass `deploy/security/odoo_secure.py`.

Both scripts emit one `WEBVUE_MANAGED_POLICY:<json>` line. Success fields are
exactly `database`, `commercial_mode`, `entitlement_source`, `status`,
`valid_until`, `features`, `policy_revision`, and `modules`. The modules list
contains actual installed Odoo modules, not the embedded requested list. Only
its `webvue_*` subset must exactly match the requested modules. Upstream `hr` and
`project` dependencies are not rejected as unselected WebVue pillars.

Failure emits only a fixed `error_code`; exceptions/logs/credentials are never
embedded in the sentinel. `VerificationError.code` is allowlisted and suitable
for a sanitized parent error. The parser rejects extra snapshot keys, duplicate
JSON keys, nonfinite numbers, coercible-but-wrong feature types, duplicates in
module lists, extra WebVue modules, wrong targets and wrong classifications.

## Application and readback boundaries

The apply script checks `env.cr.dbname` against the validated explicit scratch
name before touching models. It requires exactly one profile with singleton key
`tenant`, locks it, reads trusted `load_classification`, and checks SaaS /
control-plane, active status, and absent expiry. It then calls
`_webvue_require_policy_source('control_plane')`. Only an actual integer revision
zero and an empty feature object may proceed. Existing policies, even ones that
match the desired policy, are refused rather than changed. The feature write
uses the existing authorized `OPERATOR_CONTEXT` boundary, not a new sudo path.
The resulting actual profile and installed modules are validated before exactly
one commit. Failure rolls back and emits a safe error.

The snapshot script takes no expected policy input. It rolls back shell setup,
starts `SET TRANSACTION READ ONLY`, invalidates ORM cache without flushing,
reads actual singleton fields and installed modules, and rolls back in `finally`.
It never locks, writes or commits. This separate readback, not the apply response,
is the proof source. `parse_snapshot` accepts a nonnegative integer revision as
specified; the initial apply independently requires transition zero → one.

Trusted commercial classification must already be mounted before module
installation, because profile creation reads it and classification is immutable.
Neither script handles user/admin credentials or changes an existing customer's
subscription. These checks do not replace parent authorization that the target
is newly created and isolated.

## RED → GREEN evidence

Runner detected from neighboring tools tests: Python standard-library unittest.
No dependency installation was needed.

```sh
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=tools python3 -B -m unittest discover -s tools -p test_managed_verify.py -v
```

- **RED before implementation:** 20 tests executed, 20 failures, exit 1. Every
  failure was the deliberate `managed_verify implementation is missing` assertion.
  The module did not yet exist; no unrelated import/setup failure was hidden.
- **First GREEN after implementation:** same command, 20 tests passed, exit 0.
- **Expanded edge coverage/final GREEN:** same command, 24 tests passed, exit 0.
  Added all published pillar compositions, byte/count limits, nested/error
  payload handling, and commit-failure sanitization.
- **Lint:** `python3 -B -m ruff check --no-cache tools/webvue_cli/managed_verify.py tools/test_managed_verify.py`
  initially reported the repository's raw-exception-string rule and one nested
  function blank line. Refactored safe errors through `_fail` and corrected the
  test formatting. Final result: `All checks passed!`, exit 0.
- **Whitespace:** `git diff --check`, exit 0. This does not review untracked
  files; the two owned Python files additionally passed Ruff.

| Guarantee | Test group in `tools/test_managed_verify.py` | Evidence |
| --- | --- | --- |
| Requested WebVue modules exactly match actual composition; upstream dependencies allowed | `test_module_composition_exact_for_webvue_not_upstream`, `test_each_supported_composition_runs_without_extra_pillars` | PASS |
| Wrong target is rejected before model access | `test_scripts_reject_wrong_target_before_model_access`, `test_invalid_database_never_builds_executable_script` | PASS |
| Lock/source authorization precedes one commit; stale initialized policy is refused | `test_apply_locks_checks_source_and_commits_once_before_marker`, `test_apply_rejects_existing_or_changed_policy_after_lock` | PASS |
| Actual profile values, not expected-policy echoes, provide evidence | `test_apply_does_not_echo_expected_when_write_ignored`, `test_snapshot_reads_real_policy_without_mutating_or_committing` | PASS |
| Singleton/classification/status/expiry are required | `test_scripts_reject_non_singleton_classification_status_and_expiry`, `test_scripts_sanitize_classification_errors` | PASS |
| Strict unique bounded JSON sentinel and scalar types | parser-focused tests (`exactly_one`, `duplicate_json`, `output_bound`, `feature_values`, `profile_and_revision`, `fields`) | PASS |
| Commit failures and private exception text do not become success/secrets | `test_commit_failure_is_not_success_and_does_not_echo_exception`, `test_snapshot_does_not_emit_invalid_or_secret_feature_values` | PASS |

## Coverage and remaining limits

`coverage` was not installed. Used the Python standard-library `trace.Trace`
collector in memory, running the same unittest discovery and comparing executed
lines for the absolute `managed_verify.py` path with
`trace._find_executable_linenos(path)`. No coverage files were written.

Result: **109/109 executable host-module lines, 100.0%**, uncovered lines `[]`;
24 tests passed in that coverage run. This is line coverage, not branch coverage.
Generated script string contents are not part of the host-module percentage;
tests compile and execute both scripts against focused Odoo/transaction doubles.
The mocks prove script ordering and refusal semantics, not real PostgreSQL
transaction behavior, Odoo ACLs, actual installation, Docker readiness, DNS, or
production deployment. Parent owns real isolated acceptance and runtime wiring.

## Self-review

| Axis | Score | Evidence / improvement |
| --- | --- | --- |
| Accuracy | 4/5 | Source APIs inspected and scripts executed in mocks; real Odoo/DB semantics remain a parent acceptance check. |
| Completeness | 4/5 | All three requested API functions and scoped tests/docs delivered; branch coverage not measured. |
| Clarity | 4/5 | Apply acknowledgement versus separate readback proof is explicit; caller must preserve that distinction. |
| Actionability | 4/5 | Integration API shared early and commands documented; helpers intentionally do not wire parent execution. |
| Conciseness | 4/5 | Three bounded files; script helpers duplicate host validation because the image cannot import the host module. |

Overall: **4.0/5**. Highest-value follow-up is the parent's isolated real-runtime
acceptance; it must not be inferred from this hermetic result. This assessment
reflects the user's explicit no-runtime-access boundary rather than claiming
production readiness.
