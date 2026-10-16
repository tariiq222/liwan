# Managed fresh-create credential stage — TDD evidence

## Scope and journey

Derived from the parent coordinator's authorized implementation task: before exposing
one newly created isolated SaaS stack, initialize the explicit human administrator's
login password and independently verify its stored hash. Only these files are owned:

- `tools/webvue_cli/managed_credentials.py`
- `tools/test_managed_credentials.py`
- this evidence record

No Docker, database, network, service, commit, merge, deployment or deletion was
performed. Runtime integration is parent-owned. Checkpoint commits were not made
because the user's no-commit instruction takes precedence.

## API and integration contract

```python
build_credentials_script(database) -> str
build_credentials_snapshot_script(database) -> str
parse_credentials(stdout, database, *, expected_changed=True) -> dict
```

`CredentialsError.code` is always `credentials_unverified`; its text contains no
private underlying exception or input. Apply emits exactly one success sentinel:

```text
WEBVUE_MANAGED_CREDENTIALS:{"changed": true, "database": "webvue_scratch_...", "verified": true}
```

The independent snapshot emits `changed:false`; parse it with
`expected_changed=False`. Both scripts consume `WEBVUE_ADMIN_PASSWORD` from their
one-shot process environment. The parent passes `-e WEBVUE_ADMIN_PASSWORD` before
the Compose service name, never a command-line password value. Neither builder
accepts or embeds secret bytes. Do not print environment values or raw child logs.
The parser returns only whitelisted fields, not surrounding logs.

Order: initial feature apply → independent policy readback → credential apply →
independent credential snapshot → services up. A failed stage leaves resources for
inspection, quarantines the operation, and must not expose services. Credential
apply is its own transaction, not atomic with the earlier feature transaction.
The parent must authorize a **new create**; profile revision one is a guard, not
a standalone authorization to rotate an existing installation's password.

Scripts require the exact scratch DB, root UID 1 with `su=True`, singleton active
SaaS/control-plane profile at revision one with nonempty feature dictionary, and
explicit active `base.user_admin` with login `admin` in the root company. The apply
script locks the profile, writes through `_webvue_access_write`, flushes password,
queries the hash by the resolved administrator ID, verifies the supplied password
and rejects the shipped `admin` password before its single commit. Errors roll
back and emit one generic refusal. The separate snapshot begins a read-only
transaction, verifies without invoking the write helper, and rolls back.

Secrets follow the bundle alphabet `[A-Za-z0-9_-]{24,256}`, require at least eight
distinct characters, and reject change-me/changeme/placeholder forms. This is a
sanity boundary, not proof of randomness. Generate the secret securely upstream.
The local acceptance caller may explicitly use the same approved admin secret for
the Odoo database-manager master password and human login; setting `admin_passwd`
alone does **not** initialize the human login. Independent credentials are preferable
outside this bounded acceptance setup.

## Source-supported behavior

- `odoo-addons/webvue_core/models/res_users.py:119-151`: the private mutation helper
  authorizes actual superuser, owns its internal marker, bumps access version, and
  suppresses the ordinary password-security email. No fake marker or extra sudo is used.
- `odoo-addons/webvue_core/models/access_service.py:454-459`: the customer reset service
  forbids vendor-support resets; it is intentionally not reused or weakened.
- Stock Odoo `odoo/cli/shell.py:138-149` uses superuser and rolls back on shell exit;
  `odoo/orm/environments.py:64-67` forces UID 1 into superuser mode.
- Stock Odoo `odoo/addons/base/models/res_users.py:217-218,294-306` hashes the ORM
  password inverse through `_crypt_context()`. Its `_check_credentials` uses
  `CryptContext.verify_and_update` and the **environment user's** ID at lines
  364-372. This implementation instead uses `CryptContext.verify(password, hash)`
  against the explicitly queried admin hash, avoiding environment-user confusion
  and avoiding a readback rehash/write. Hashes never enter the sentinel.

## RED → GREEN evidence

Runner discovered from the neighboring Python tests: standard-library unittest.
Executed from `/Users/tariq/code/nasq-managed-saas-acceptance`:

```sh
PYTHONPATH=tools python3 -B -m unittest tools.test_managed_credentials -v
```

- **RED:** 10 tests executed, 10 failures, exit 1. All failures were the intended
  `managed_credentials missing: intended RED` assertion before implementation.
- **GREEN:** same command after implementation, 10 tests passed, exit 0.
- **Expanded GREEN:** same command after missing-record/hash and parser-boundary
  cases were added, 12 tests passed, exit 0 (`Ran 12 tests in 0.015s`).

| Guarantee | Tests | Evidence |
|---|---|---|
| Single commit and separate read-only hash verification | `test_apply_and_separate_readonly_snapshot` | PASS |
| No non-root, wrong DB, stale/wrong profile, or root-account mutation | root, database/profile, exact-admin cases | PASS |
| Missing/default/malformed secret fails before password write | `test_secret_sanity` | PASS |
| Wrong hash/default password acceptance/commit errors refuse and rollback | hash/default and exception cases | PASS |
| Snapshot mismatch never writes | `test_snapshot_mismatch_never_writes` | PASS |
| Missing profile/admin/hash or hash verifier error refuses | missing-record/hash case | PASS |
| Strict DB-bound typed success, one sentinel, exact keys, unique JSON keys | parser cases | PASS |
| Oversized/invalid Unicode/invalid JSON/type confusion refuses | parser-boundary cases | PASS |

## Coverage and limits

The local Python has no `coverage` package (`coverage_available=False`); no package
was installed. An in-memory standard-library `sys.settrace` line counter collected
executed host-module lines during the same unittest suite, compared against
recursive code-object `dis.findlinestarts`, and printed:

```text
Host-module executable-line coverage: 61/61 (100.0%)
Unexecuted host-module lines: []
Generated script body is exec-tested separately, not included in host-module line percentage.
Ran 12 tests in 0.339s
OK
```

This is **host executable-line coverage**, not branch coverage. Generated scripts
were compiled/executed against Odoo environment/cursor/admin/crypt-context doubles.
The test hash double uses SHA-256 solely to model verification deterministically;
production script calls Odoo's actual password context, not the double. These tests
do not establish real-image ORM behavior, passlib integration, live persistence,
network/login/MFA readiness, or absence of effects on existing services. Parent-owned
live acceptance must supply those proofs. No raw secret/hash appears in the generated
script source, sentinel or generic exception text; transport/logging and Compose
ordering remain parent integration responsibilities.
