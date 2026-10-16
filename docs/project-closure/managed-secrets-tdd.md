# Managed secret resolver — TDD evidence

## Scope

Parent-authorized narrow task: replace unsafe unbounded secret-file reading with
`resolve_secret(handle) -> str`, implemented only in the new
`tools/webvue_cli/managed_secrets.py` and its new `tools/test_managed_secrets.py` tests.
Runtime wiring remains parent-owned. This document is the third owned output.
No runtime, worker, credential, or other existing implementation file was edited.

The helper performs only explicit local file reads. Tests create synthetic private
temporary files/symlinks/FIFO and remove only those unittest fixtures. No real
secret file, Docker, database, network, service or Git mutation was performed.
No commits were made: the user's no-commit boundary overrides TDD checkpoint advice.

## API and guarantees

```python
resolve_secret(handle: str) -> str
SecretError(OSError)  # .code and str(error) == 'secret_unavailable'
```

The parent may map `SecretError` to its existing secret-unavailable conflict before
any mutation. Exceptions suppress underlying context in ordinary traceback rendering
and never include path, content, errno-specific details or a filename attribute.
As with other Python exceptions, private debugging tools must not dump traceback
locals or inspect suppressed exception context; that is outside the public error
contract.

- Require a string absolute lexically canonical POSIX path: no empty components,
  repeated/trailing separators, dot/dot-dot components, NUL, or paths over 4096 chars.
- Walk each parent relative to the previous open directory descriptor using
  `O_DIRECTORY | O_NOFOLLOW`; reject symlinks in **any** component.
- `stat(..., follow_symlinks=False)` the final entry before opening. Require regular
  file, current UID ownership, exact mode `0400` or `0600` and size 1..4096 bytes.
  FIFOs are refused without opening.
- Open final file using `O_NOFOLLOW | O_NONBLOCK`; immediately `fstat` and match the
  pre-open device/inode. Recheck type, ownership, permissions and size.
- Accumulate short reads with a strict maximum of 4097 bytes, detecting growth past
  4096. Recheck metadata and final size; EOF truncation refuses.
- Decode strict UTF-8, apply `.strip()`, and require the bundle URL-safe alphabet
  `[A-Za-z0-9_-]{24,256}`, at least eight distinct characters, and no
  change-me/changeme/placeholder forms. This matches the initial credential-stage
  sanity rules; it is not a randomness guarantee.
- Close every descriptor on success and failure. Nothing is written by the helper.

On macOS, `/tmp` and `/var` aliases are symlinks. Supply the canonical actual
`/private/...` handle instead; the resolver does not silently resolve an unsafe
handle. Tests use the resolved temporary root.

## Trusted-boundary limits

This is an operator-private file reader, not a sandbox against another process
running as the same UID, not ACL enumeration, and not a lock/freeze on concurrently
edited secret content. Parent directory ownership/modes are not checked, because
system parent directories are expected; the enclosing enrollment hierarchy remains
operator-trusted. Directory descriptors prevent path-component traversal through
swapped symlinks, but do not assert continued reachability of already-open renamed
directories. The resolver does not print secret values or perform network I/O.

## RED → GREEN

From `/Users/tariq/code/nasq-managed-saas-acceptance`:

```sh
PYTHONPATH=tools python3 -B -m unittest tools.test_managed_secrets -v
```

1. **RED before implementation:** 12 tests ran, all 12 failed with the intended
   `managed_secrets missing: intended RED`, exit 1.
2. **GREEN after implementation:** same 12 tests passed, exit 0.
3. **Expanded GREEN:** short-read/truncation and post-open permissions cases added;
   14 tests passed, exit 0 (`Ran 14 tests in 0.014s`).

| Guarantee | Test cases | Result |
|---|---|---|
| Private owned 0400/0600 files and trimmed newline accepted | private-files | PASS |
| Public, execute-only, special-bit and unreadable modes refused | mode cases | PASS |
| Wrong ownership refused | wrong-owner via UID double | PASS |
| Final and parent symlinks refused | symlink cases | PASS |
| Noncanonical, nonstring, missing paths and directories refused | path cases | PASS |
| FIFO refused before opening | FIFO guarded-open case | PASS |
| Oversize, invalid UTF-8, weak/default/malformed values refused | size/secret cases | PASS |
| Growth is bounded; short reads accumulate; truncation refuses | bounded/short-read cases | PASS |
| Opened inode mismatch and post-open permissions changes refused | race cases | PASS |
| Error content sanitized and all descriptors closed | exception/descriptor cases | PASS |

No coverage dependency was installed. Standard-library in-memory `sys.settrace`
collected executed lines during the same suite; recursive `dis.findlinestarts`
provided the host module's executable-line denominator. Output:

```text
Executable-line coverage: 59/59 (100.0%)
Unexecuted lines: []
Ran 14 tests in 0.031s
OK
```

This is executable-line coverage, not branch coverage or a live integration test.
Parent-owned runtime tests must still prove resolution failure maps to conflict,
prevents effects, and never leaks child environment values into receipts/logs.
