# Managed create policy: bounded TDD evidence

## Scope and authority

This implements only the pure create-policy validation slice of
[the approved managed SaaS charter](managed-saas-charter.md), on
`codex/managed-saas-acceptance` in `/Users/tariq/code/nasq-managed-saas-acceptance`,
starting at `d780862e468e027286374ecebb9643f1490cc9e6`.

The operator's journey is to submit the worker-generated policy for one published
catalog composition and receive either that validated policy or a safe refusal
before any provisioning effect. Only these three new files are owned here:

- `tools/nasq_cli/managed_policy.py`
- `tools/test_managed_policy.py`
- `docs/project-closure/managed-policy-tdd.md`

No existing runtime, scratch operator or existing test file was edited. No Git
commit/merge, Docker, database, service, network or Odoo action was performed.
Other concurrent authors' untracked acceptance/probe tests were left untouched.

## API and integration contract

```python
from nasq_cli.managed_policy import PolicyError, parse_create_policy

policy = parse_create_policy(
    raw,
    catalog_path=catalog_path,
    catalog_sha256=release_ref['catalog_sha256'],
    commercial_mode=descriptor['commercial_mode'],
)
```

Exact signature:
`parse_create_policy(raw: bytes, *, catalog_path: Path, catalog_sha256: str, commercial_mode: str) -> dict`.

`PolicyError` subclasses `ValueError`. Its `.code`, `str(error)` and sole message
argument contain a safe stable code, not input values, paths or parser messages.
Underlying parser/filesystem diagnostic chains are suppressed.

| Code | Meaning |
| --- | --- |
| `policy_invalid` | Wrong primitive/container/schema type, invalid UTF-8/JSON, nonstandard JSON number or excessive nesting |
| `policy_too_large` | More than 16,384 policy bytes |
| `policy_duplicate_key` | Duplicate decoded JSON object key, including nested/escaped keys |
| `commercial_mode_unsupported` | Anything other than `saas`, including consistent non-SaaS/local-policy pairs |
| `policy_channel_mismatch` | Channel is not exactly `control_plane` |
| `catalog_reference_invalid` | Reference is not `sha256:` followed by 64 lowercase hexadecimal characters |
| `catalog_unavailable` | Invalid Path argument or catalog read failure |
| `catalog_digest_mismatch` | Catalog's original bytes do not match the supplied digest |
| `catalog_invalid` | Catalog cannot safely supply a valid composition |
| `policy_composition_mismatch` | Modules/features differ from every single catalog tier's worker defaults |

The only I/O is a read of the supplied local catalog. The original bytes are
hashed and those same bytes parsed. Publication authority belongs to the caller:
a matching caller-provided digest is not by itself proof of publication.

Policy keys are exactly `schema_version`, `channel`, `modules`, `features`.
The integer schema version is 1, never boolean/float/string. Module order is
significant: precisely `base_modules + selected_tier.modules`. Feature object
order is immaterial; values are precisely boolean true for tier booleans and
null for limits, with `users.limit` and `storage.limit_mb` null defaults. Numeric
ceilings are intentionally outside this create slice, not silently coerced.

Source alignment: `apps/control-plane/src/worker.ts:policyForCreate` supplies
the two baseline limits then selected-tier descriptors. The scratch operator's
`_catalog_composition` obtains defaults through core tier descriptors instead;
this new managed validator follows the worker and does not modify scratch code.
The catalog determines module lists, not a fixed set of all Nasq pillars.
Consumed catalog fields are checked defensively; this does not replace the
publisher's complete catalog schema/manifest/feature-registry validation gate.

## Actual RED/GREEN sequence

All commands below ran from the worktree root. Python ran with `-B` and
`PYTHONPATH=tools`; unittest and its standard-library mocks were the only test
framework. No dependencies were installed.

### Initial RED, before the production file existed

```sh
PYTHONPATH=tools python3 -B -m unittest tools.test_managed_policy -v
```

Actual result: **39 tests, 39 failures, exit 1** (`Ran 39 tests in 0.001s`).
Each failure was the explicit `managed_policy implementation is missing`
assertion in test setup. The suite uses `find_spec` solely to identify the
intentionally absent implementation; other import failures are not swallowed.
The production file was created only after this command failed as intended.

### Initial GREEN

The identical command then returned **39 tests, OK, exit 0**
(`Ran 39 tests in 0.014s`).

### Lint and behavior-preserving cleanup

```sh
ruff check --no-cache tools/nasq_cli/managed_policy.py tools/test_managed_policy.py
```

First result: exit 1, 15 `raw-string-in-exception` findings. A small typed `_fail`
helper centralized safe error construction instead of weakening lint rules.
The lint command and the 39-test suite then passed together (39 tests in 0.022s).

### Additional actual RED: malformed local catalog path

A final edge-case review added an embedded-null `Path` case before its fix:

```sh
PYTHONPATH=tools python3 -B -m unittest tools.test_managed_policy.ManagedPolicyCase.test_catalog_path_with_embedded_null_has_safe_code -v
```

Actual result: **1 test, 1 error, exit 1** (`ValueError: embedded null byte`).
The catalog-read boundary then normalized `ValueError` alongside `OSError` into
`PolicyError('catalog_unavailable')`.

### Final GREEN and lint

```sh
PYTHONPATH=tools python3 -B -m unittest tools.test_managed_policy -v && ruff check --no-cache tools/nasq_cli/managed_policy.py tools/test_managed_policy.py
```

Actual result: **40 tests, OK, exit 0** (`Ran 40 tests in 0.016s`), followed by
`All checks passed!`. Test counts are unittest test methods; subtest cases are
additional input matrices, not extra counted methods.

## What the pure tests establish

| Guarantee | Representative tests in `tools/test_managed_policy.py` | Result |
| --- | --- | --- |
| All four current tiers work independently | `test_all_current_catalog_tiers_round_trip` (core/projects/people/messaging), `test_base_only_core_does_not_add_pillars` | PASS |
| Catalog controls modules, not a hardcoded all-pillars list | `test_catalog_drives_composition_without_fixed_pillars`, `test_exact_ordered_base_plus_single_tier_modules` | PASS |
| Exact schema and strict primitive types | `test_exact_policy_keys`, `test_schema_version_is_integer_one_not_bool`, `test_modules_require_list_of_strings`, `test_features_must_be_object` | PASS |
| Exact worker feature defaults, no numeric coercion | `test_feature_values_require_exact_bool_or_null`, `test_feature_defaults_cannot_be_changed`, `test_feature_keys_exactly_match_tier_and_worker_defaults` | PASS |
| SaaS/channel classification enforced | `test_only_saas_mode_is_supported`, `test_channel_must_match_saas`, `test_even_consistent_non_saas_pair_is_rejected` | PASS |
| Original catalog bytes bound to strict digest reference | `test_mismatched_catalog_digest`, `test_digest_binds_exact_bytes_not_reserialized_json`, `test_sha256_reference_requires_exact_lowercase_format` | PASS |
| Duplicate JSON keys rejected, not last-value-wins | Top-level, nested feature, escaped-key and catalog duplicate tests | PASS |
| Byte boundary and invalid JSON fail safely | `test_policy_bytes_limit_inclusive`, raw/encoding/nonstandard-number/deep-JSON cases | PASS |
| Catalog structural errors fail closed, even on unselected tier | Catalog base/tier/descriptor/schema/default-limit and unselected malformed tier tests | PASS |
| Safe failures and repeatable, independent returns | Failure-message, unreadable/malformed Path, repeated-call and read-only catalog tests | PASS |

## Coverage and remaining boundaries

Coverage is **unmeasured**, not claimed at 80% or 100%. No global coverage module
was available per the task constraints, and no stdlib trace measurement was run.
The 40 passing pure tests and lint are the recorded evidence, not runtime proof.

Parent integration must call this validator before effects and independently
prove module installation, application/readback of entitlements, health,
journaling and idempotency. No Odoo application semantics or side effects were
invented here. No complete project closure or deployment readiness is claimed.
No checkpoint commits exist because the user explicitly prohibited commits.

## Self-review

| Axis | Score | Evidence / improvement |
| --- | --- | --- |
| Accuracy | 4/5 | 40 pure tests and lint pass; worker compatibility is source-derived, not a live TypeScript-to-Python execution test |
| Completeness | 4/5 | Requested validation cases implemented; quantitative coverage remains unmeasured |
| Clarity | 4/5 | Explicit error-code table and exact commands; detailed evidence is longer than the concise handoff |
| Actionability | 5/5 | Import, exact signature, safe exception contract and integration boundary supplied |
| Conciseness | 4/5 | Single-purpose validator; test matrices and evidence necessarily repeat some contract details |

Overall: **4.2/5**. Highest-value follow-ups are caller integration proof and
coverage measurement when the parent has an appropriate tool available. This
assessment deliberately distinguishes proven pure behavior from runtime work.
