# Managed process and routing health — TDD evidence

## Scope and API

New owned files only:

- `tools/nasq_cli/managed_health.py`
- `tools/test_managed_health.py`
- this document

Worktree `/Users/tariq/code/nasq-managed-saas-acceptance`, branch
`codex/managed-saas-acceptance`. No runtime, probe, bundle, credential, policy,
serializer, or frontend file was edited in this task. No real Docker process,
network request, database access, commit, or merge was performed.

```python
from nasq_cli.managed_health import health

healthy = health(descriptor, runner=approved_local_bounded_runner)
# Optional test seam: opener=..., attempts=15, delay=.5
```

The return value is strictly `True` or `False`. Invalid inputs, failed commands,
malformed observations, HTTP errors and timeouts fail closed without exposing
raw output or exception text. The caller must first complete independent policy
and initial-credential readback, preserve its validated Compose/config input
snapshot, and provide a runner pinned to the approved local Docker daemon.
The helper never performs those mutations or accesses a database.

## What a successful observation requires

1. A validated SaaS descriptor, bounded scratch database/project/path inputs,
   distinct integer ports and immutable release references.
2. Read-only `docker compose -p <project> -f <compose> ps --all --format json`
   returns exactly four services: `db`, `odoo`, `web`, `edge`, all running, with
   unique full 64-character hexadecimal container IDs. Both JSONL and JSON-array
   Compose output are accepted; duplicate JSON keys are rejected.
3. `docker container inspect <four validated IDs>` confirms actual ID, running
   state, exact Compose project/service labels, and image/config identities.
   Odoo/web/edge `Config.Image` must match the descriptor pin exactly. Each image
   reference is inspected and its immutable image ID must match container
   `.Image`; repository-digest references also require exact `RepoDigests`
   membership. PostgreSQL must have an immutable configured image matching its
   actual image ID; its expected pin remains bound by the parent's approved
   Compose snapshot because the descriptor contains no PostgreSQL image field.
4. Actual published ports match the descriptor on IPv4 loopback only: DB5432,
   Odoo8069, edge80. No other published ports are accepted; web is internal.
5. Direct Odoo and edge `/api/v1/branding` both return HTTP200 JSON with the exact
   source serializer schema and equal values. Required keys are `name`,
   `logo_url`, `primary_color`, and `font`; `secondary_color` is the only optional
   key. Names/fonts must be nonempty strings, colors six-digit hex, and logo URLs
   must match the serializer's local company/version path. Empty objects, extra
   keys, duplicate keys, nonfinite JSON values and wrong types are refused.
6. Edge `/login` returns HTTP200 HTML containing real parsed Nuxt root `#__nuxt`,
   source-owned `main.nasq-login-page`, `input#login[autocomplete=username]`, and
   `input#password[type=password]`. Matching strings inside comments/scripts do
   not satisfy this requirement. These markers were read in
   `apps/web/app/pages/login.vue`, not invented as a generic HTML signature.

The default opener disables environment proxies and HTTP redirects. Response
URL must remain the exact requested loopback URL and content type must match
JSON/HTML. Each response reads at most 1MiB+1 bytes and fails above 1MiB. HTTP
socket timeout is two seconds. Default retries are 15 with half-second spacing;
allowed budgets are 1–30 attempts and 0–2 seconds between attempts. Every retry
reobserves containers before HTTP, and no sleep occurs after the last attempt.

Runner stdout/stderr are each checked against 64KiB; invalid UTF-8 observations
fail closed. **The injected runner must impose its own streaming output quota
and process deadline.** The HTTP timeout is a socket-operation timeout, not a
strict end-to-end deadline against a continuously trickling peer; the parent
operation deadline remains responsible for the overall acceptance budget.

## TDD evidence

Journeys: the operator receives readiness evidence only for the enrolled running
four-service stack with matching application routing; foreign/stopped services,
unrelated HTTP responses and incomplete/oversized observations fail safely.

Command run from the assigned worktree:

```sh
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=tools python3 -B -m unittest discover -s tools -p test_managed_health.py -v
```

- **RED before implementation:** 16 tests ran, 16 expected failures, exit1:
  `managed_health implementation missing (RED)`.
- **GREEN after implementation:** 16 tests passed, exit0.
- **Lint:** `python3 -B -m ruff check --no-cache tools/nasq_cli/managed_health.py tools/test_managed_health.py`
  returned `All checks passed!`, exit0.
- **Coverage:** in-memory standard-library `trace.Trace` ran the same tests and
  compared executed lines to `trace._find_executable_linenos(path)`:
  **165/165 executable lines, 100.0%**, uncovered `[]`. No artifacts were written.
  This is line coverage, not branch coverage or real-runtime proof.

| Guarantee | Test group | Result |
| --- | --- | --- |
| Four running exact project/service/container identities | running/foreign/missing/duplicate/stopped tests | PASS |
| Image IDs and repository digests resolved against actual container image | pinned-image and repo-digest tests | PASS |
| Actual loopback publications match enrollment | published-port test | PASS |
| Strict branding schema and exact direct/edge equality | schema, mismatch, optional-color and JSON tests | PASS |
| Real parsed source login elements, not generic HTML/comments | login-markers test | PASS |
| No proxy/redirect, bounded bodies/timeouts/retries | default-opener, timeout/body and retry tests | PASS |
| Malformed descriptors/results fail before inappropriate observations | invalid-input and malformed-output tests | PASS |

All tests use injected runner/opener doubles. The default-opener test replaces
`urllib.request.build_opener` and checks its handler construction without
network access. Retry tests replace `time.sleep`; no real waiting or service
access occurs. No secret values or raw Docker observations appear in evidence.

## Evidence limits and handoff

This proves process identity and public application routing at observation time,
not full authentication, successful credentials, policy persistence, websocket
handshake, browser hydration, static asset completeness, customer isolation under
load, DNS, TLS or production readiness. Branding can be identical across tenants;
it is not a cryptographic database identity. The parent's exact database-bound
readback and immutable input checks remain mandatory. Docker inspection and HTTP
are sequential observations and cannot eliminate all concurrent replacement races.

The serializer's logo URL is `/web/binary/company_logo`; this helper validates
its shape but does not fetch the image. The parent was alerted that the current
local Caddy template forwards `/web/content` but not `/web/binary`; logo routing
requires a separate reviewed template/proxy decision, outside these owned files.

Self-review: accuracy4/5 (source-grounded checks and injected execution, no live
Docker/HTTP evidence); completeness4/5 (requested health contract covered, strict
end-to-end HTTP deadline delegated); clarity4/5 (database/auth exclusions explicit,
public branding is not unique identity); actionability4/5 (API available, parent
must wire pinned runner); conciseness4/5 (one helper, one focused test module,
no duplicated runtime orchestration). Overall4.0/5. Highest-value next check is
the parent's real isolated acceptance with pinned images and existing policy/
credential gates, not an expanded readiness claim based on these mocks.
