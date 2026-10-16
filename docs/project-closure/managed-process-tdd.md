# Managed bounded process runner — TDD handoff

## Scope

Worktree `/Users/tariq/code/nasq-managed-saas-acceptance`, branch
`codex/managed-saas-acceptance`. This follow-up owns only new
`tools/webvue_cli/managed_process.py`, `tools/test_managed_process.py`, and this
report. Runtime integration remains parent-owned. No real Docker invocation,
DB access, install, commit, merge, deployment or existing-resource action was
performed. Tests execute only short-lived Python child processes, injected
Docker result fixtures and filesystem-stat mocks.

## API

```python
from webvue_cli.managed_process import run, local_docker_runner, ProcessError

run(argv, env=None, stdin_text=None, *, timeout=1800, output_limit=65536)
# -> (exit_code, stdout, '')

runner = local_docker_runner(*, env=None, runner=run)
# -> callable LocalDockerRunner with the same call signature
```

Success returns strict UTF-8 stdout. Every non-success discards stdout and all
stderr. Nonzero child exit codes are preserved; `124` denotes unavailable,
timeout, invalid inputs or invalid UTF-8; `125` denotes stdout overflow. No
successful truncated tail is ever returned.

`run` is a POSIX process runner, not a Docker operation allowlist. Input argv is
a nonempty list/tuple of NUL-free strings; no shell interpretation. Timeout is
finite, positive and at most 1800 seconds. Output limit is integer 0–16 MiB
(default 64 KiB), and stdin is at most 64 KiB encoded UTF-8. A new session/process
group is started with `shell=False`, `start_new_session=True`, `stderr=DEVNULL`.

`selectors` and nonblocking stdin/stdout pipes stream both directions concurrently,
preventing the write-input/read-output deadlock. Reads hold no more than the
requested stdout limit plus one detection byte. There is no temporary output
file, unbounded `communicate()`, or background reader thread. The execution
deadline continues after stdout closes. Error, overflow and timeout paths kill
the entire child process group, first SIGTERM with at most 0.2 seconds direct-child
wait, then SIGKILL. The direct child is always reaped and pipes are closed.
Lingering group members are also killed on successful direct-child exit.

**POSIX limitation:** a process cannot `waitpid` grandchildren that it does not
own. Cooperative parents reap theirs during the termination grace; remaining
killed orphans/zombies are OS-reaped. A descendant deliberately creating a new
session can escape the process group. This is bounded execution for trusted
local tools, not an arbitrary hostile-code sandbox. Test descendant termination
uses a cooperative Python parent and asserts the descendant is gone (or dead
zombie on Linux); it does not claim universal descendant-reaping control.

## Local Docker context boundary

Create the factory **once per operation**, only after structural validation,
and inside the mutation action, so journal replay and read-only receipt lookups
perform zero Docker context observations. Parent injects the same returned
runner into observation and provisioning seams.

Factory runs only the read-only command `docker context inspect`, bounded to
10 seconds and 64 KiB. Context resolution receives PATH/HOME/LANG/LC_ALL only:
DOCKER_HOST, DOCKER_CONTEXT, DOCKER_CONFIG and all DOCKER_TLS variables cannot
redirect it. It inspects the current context from the ordinary user's Docker
configuration; it does not silently select another context if this is remote.
Malformed/nonzero/duplicate-key/multiple-context observations raise code-only
`ProcessError('docker_context_unavailable')`. Remote, relative, unsafe or
non-socket endpoints raise `docker_context_not_local` (unavailable stat/resolve
errors use unavailable).

The single `Endpoints.docker.Host` must be `unix:///absolute/path` to an existing
Unix socket. Socket symlinks, including legitimate Docker Desktop links, are
resolved once. Every later call pins:

```
docker --host unix:///resolved/socket <original command and arguments>
```

The wrapper accepts only `docker` argv and rejects leading global flags and
endpoint/context/config/TLS overrides anywhere in the arguments, conservatively
including prefix variants (`--host=...`, `--context=...`, `-H...`). It removes all
DOCKER_* environment variables on every call but preserves supplied child-only
credentials such as POSTGRES_PASSWORD. The generic `run` does not sanitize env;
only the local Docker factory/wrapper does so. The wrapper is intentionally not
an operation allowlist—parent runtime owns bounded allowed Docker operations.

A local socket proves local transport selection, not identity or integrity of
the daemon listening there. Socket replacement and operator-owned Docker
configuration changes remain trusted-local-operator concerns. Pinning prevents
ordinary concurrent Docker context switches from redirecting the operation.

## Fresh evidence

```sh
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=tools python3 -B -m unittest tools/test_managed_process.py
python3 -B -m ruff check --no-cache tools/webvue_cli/managed_process.py tools/test_managed_process.py
```

- Initial RED: 13 failures, explicit missing module, exit 1.
- Additional RED: endpoint override flags appearing after a Docker subcommand
  were accepted; regression failed before the anywhere-in-argv rejection fix.
- Final GREEN: **17 tests passed**, exit 0, approximately 1 second, no skips in
  the observed run. Coverage includes real Python child success, UTF-8 input,
  invalid UTF-8 output, stderr/partial stdout suppression, output overflow,
  timeout, ignored SIGTERM, closed stdout, descendant termination, large
  concurrent stdin/stdout, early stdin closure, unavailable executable and
  shell metacharacters passed literally; Docker context paths use injected data.
- Ruff: final `All checks passed!` after two test-only style corrections.
- Installed `coverage` module unavailable; no install. Stdlib trace around
  test discovery and execution measured **159/160 executable lines (99.4%)**.
  One deadline recheck branch (line 124 at this checkpoint) is not deterministically
  exercised. This is line coverage, not branch coverage or live Docker proof.
  Trace data stayed in memory; no generated evidence artifacts.

## Self-check and remaining work

Accuracy 4/5: fresh child-process tests and fixture-only context observations;
actual Docker CLI execution deliberately excluded. Completeness 4/5: all scoped
runner and endpoint behaviors implemented; POSIX grandchild/setsid limits are
explicit. Clarity 4/5: stable code-only API documented, with parent integration
ordering spelled out. Actionability 4/5: import-ready functions, parent must wire
per-operation factory and error mapping. Conciseness 4/5: exactly three scoped
outputs; explicit tests outweigh shortening safety logic. Overall 4.0/5.

Highest-impact follow-ups are parent integration of the pinned factory, an
independent security review of endpoint overrides, and a separately authorized
local acceptance run. No production readiness is claimed.
