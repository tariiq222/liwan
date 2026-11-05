# LiwanOS AI service

The isolated agent service of LiwanOS AI (spec: `docs/superpowers/specs/2026-10-15-liwan-ai-design.md`).
It holds no LiwanOS credential: it receives a message and the caller's tool catalog, decides, and
stops at every tool with an `interrupt`; the Nuxt server executes tools and resumes it.

## Run locally

    python3 -m venv .venv && .venv/bin/pip install -e '.[dev]'
    # Operator bootstraps, once each, against empty databases, before starting any runtime:
    # 1. release control state in the service database
    AI_DATABASE_URL=postgresql://localhost/liwan_ai_dev \
    .venv/bin/python -m liwan_ai_service.store --initialize-control
    # 2. tenant state in schema liwan_ai of each tenant database
    AI_DATABASE_URL=postgresql://localhost/liwan_ai_dev \
    .venv/bin/python -m liwan_ai_service.store --initialize-tenant dev_tenant

    # Run against those databases: AI_SERVICE_TOKEN is required and must be at least 24 characters.
    AI_PROVIDER=ollama AI_MODEL=qwen2.5:7b AI_BASE_URL=http://localhost:11434 \
    AI_DATABASE_URL=postgresql://localhost/liwan_ai_dev \
    AI_SERVICE_TOKEN="$(python3 -c 'import secrets; print(secrets.token_hex(32))')" \
    LIWAN_TENANCY_MODE=dedicated AI_TENANT_DATABASE=dev_tenant \
    .venv/bin/uvicorn liwan_ai_service.service:app --port 8600

    # Or run without a database and without a token (local development only): in-memory state, no authentication.
    AI_PROVIDER=ollama AI_MODEL=qwen2.5:7b AI_BASE_URL=http://localhost:11434 \
    AI_ALLOW_MEMORY_STATE=true AI_DEV_INSECURE=true \
    .venv/bin/uvicorn liwan_ai_service.service:app --port 8600

`AI_DATABASE_URL` is required for real state: without it the service refuses to start. For local development only,
`AI_ALLOW_MEMORY_STATE=true` (exactly) keeps the state in memory; the service then logs a warning at startup, and
`AI_SERVICE_TOKEN` is still required. `AI_DEV_INSECURE=true` is the only token-free mode: the service accepts it only
together with `AI_ALLOW_MEMORY_STATE=true` and no `AI_DATABASE_URL`, it serves every route unauthenticated, and it
must stay unset outside local development.

## Environment

| Variable | Meaning |
|---|---|
| `AI_PROVIDER` | `anthropic`, `openai`, `ollama` or `openrouter` (see Providers) |
| `AI_MODEL` | provider model id |
| `AI_API_KEY` | required for anthropic, openai and openrouter |
| `AI_BASE_URL` | optional; overrides the provider's default base URL (Ollama host, OpenAI-compatible endpoint, OpenRouter) |
| `AI_OPENROUTER_REFERER` | optional; sent as `HTTP-Referer` to OpenRouter for app attribution (openrouter only; never required, never logged) |
| `AI_OPENROUTER_TITLE` | optional; sent as `X-Title` to OpenRouter (openrouter only; never required, never logged) |
| `AI_DATABASE_URL` | Postgres for release control state (deployment `state_id`, generation draining); required unless `AI_ALLOW_MEMORY_STATE=true` |
| `LIWAN_TENANCY_MODE` | `dedicated` (default) or `shared`; which tenant databases this deployment serves |
| `AI_TENANT_DATABASE` | dedicated mode only: the one tenant database, also used as the tenant id; required with real state |
| `LIWAN_TENANT_REGISTRY_PATH` | shared mode only: the read-only tenant registry JSON (`targets[].tenantId -> database`); required |
| `AI_GENERATION_ID` | stable unique release generation id (`[a-z][a-z0-9_-]{0,62}`); required with a service token for release administration; reuse the same id on restart, never reuse a drained id for a replacement generation |
| `AI_STATE_VERSION` | default `1`; run schema, graph/checkpoint payload and tool-result compatibility contract; another value refuses startup |
| `AI_ALLOW_MEMORY_STATE` | `true` (exactly) lets the service start without a database, keeping state in memory (development only) |
| `AI_DEV_INSECURE` | `true` (exactly) removes the service token requirement; accepted only with `AI_ALLOW_MEMORY_STATE=true` and no `AI_DATABASE_URL`, so development only, and it must stay unset in deployments |
| `AI_RUN_RETENTION_DAYS` | default 30; `python -m liwan_ai_service.cleanup` deletes older runs |
| `AI_DEFAULT_TIMEOUT_SECONDS` | default 120 |
| `AI_SERVICE_TOKEN` | required: at least 24 characters (a shorter one refuses startup, and a missing one refuses it too), the only exception being `AI_DEV_INSECURE=true` above |

## Providers

The registry in `src/liwan_ai_service/provider_registry.py` is the single list of providers: `Settings.from_env` takes the valid
`AI_PROVIDER` names and the key rule from it, and `build_chat_model` builds the client from it.

| `AI_PROVIDER` | `AI_API_KEY` | Default base URL | Example `AI_MODEL` |
|---|---|---|---|
| `anthropic` | required | the Anthropic API | `claude-sonnet-4-5` |
| `openai` | required | the OpenAI API (any OpenAI-compatible endpoint through `AI_BASE_URL`) | `gpt-4o` |
| `ollama` | not needed | `http://localhost:11434` | `qwen2.5:7b` |
| `openrouter` | required | `https://openrouter.ai/api/v1` | `anthropic/claude-sonnet-4.5` |

For `openrouter`, `AI_MODEL` is the OpenRouter model id (`vendor/model`).

Token counts come from the provider's stream. The `openai` provider asks for the usage chunk (`stream_options`) only without `AI_BASE_URL`,
because a compatible server may answer 400 to it; with a custom `AI_BASE_URL` its calls are still reported, with null token counts. OpenRouter
and Anthropic always report tokens. `AI_MODEL` must be 1 to 128 characters without control characters and the provider name must match
`^[a-z][a-z0-9_-]{0,31}$` (the usage ledger's rule); a bad value stops the boot.

## Adding a provider

- An OpenAI-compatible endpoint (vLLM, LM Studio, LiteLLM, Together, Groq, Mistral's compatible API) needs no code:
  set `AI_PROVIDER=openai` and `AI_BASE_URL` to the endpoint, with its key in `AI_API_KEY`.
- A provider with its own LangChain package (for example `langchain-google-genai` or `langchain-mistralai`) needs, in this order:
  1. one dependency line in `pyproject.toml`;
  2. one build function and one `ProviderSpec(name, needs_api_key, default_base_url, build)` entry in `provider_registry.py`,
     importing the SDK inside the build function;
  3. one test in `tests/test_providers.py` (the registry-driven tests already check that it builds without network and that the key rule holds);
  4. one row in the Providers table above.

## Run naming and usage events

`POST /v1/runs` names its run through exactly one of `new_run_id` (a new run, `^r_[0-9a-f]{24}$`, chosen by the caller; 409 when taken)
and `run_id` (continues a finished run); anything else is 422.

Before each provider attempt the stream carries `model_call` (`call_id`, `kind` `plan|title`, `provider`, `model`, `called_at`) and after it
`model_usage` (`call_id`, `outcome` `ok|failed|retried|aborted`, `input_tokens`, `output_tokens`, null when the provider reported none). The
Nuxt server consumes both and never relays them to the browser. The provider SDKs are built with `max_retries=0`; the service retries a plan
call itself, up to 3 attempts, only for a 408/409/429/5xx answer or a connection error (Ollama's 5xx answers included). A wait is 0.5 s then 1 s,
or the provider's `Retry-After` when longer, plus 0 to 25 % jitter; a wait that would not end before the run deadline is not started and the failure is
final. Titles are never retried.

## Tenant policy, own key and residency

Every run and resume carries the tenant's `policy` from Odoo (`provider_mode`, `outside_allowed`, `max_output_tokens`).
The service picks the run's model from it: the deployment's platform model, or the tenant's own key from
`ai_tenant_config` (encrypted with `pgcrypto`; `AI_KEY_ENCRYPTION_KEYS`, `AI_KEY_ENCRYPTION_KEY_ID`). A tenant-key policy
without a key is refused with 409 `ai_tenant_key_missing`; there is no fallback to the platform key. Each provider in the
registry states where it processes data (`location`); an `outside` provider without a valid consent is refused with 403
`ai_consent_required` before any provider call. `max_output_tokens` stops a platform run with `limit_reached`
(`output_tokens`) once its plan calls reached the cap. Every `model_call` event names its `billing`. The routes
`GET /v1/tenant/config`, `PUT /v1/tenant/config/retention`, `PUT|DELETE /v1/tenant/config/key` never return the key, only
`configured` and its last four characters. Pre-release, the tenant schema changed in place with `AI_STATE_VERSION` still
`1`: a development database bootstrapped before `ai_tenant_config` existed is re-created (drop schema `liwan_ai`, run the
bootstrap again).

## Service token

Every route except `GET /healthz` requires the header `X-Liwan-Service-Token` to equal `AI_SERVICE_TOKEN`
(constant-time comparison); anything else answers 401 with a fixed body. The token is required: the service refuses
to start when it is missing or shorter than 24 characters. The one exception is `AI_DEV_INSECURE=true` (development
only), which the service accepts only with `AI_ALLOW_MEMORY_STATE=true` and no `AI_DATABASE_URL`, and which makes it
start without a token and serve every route unauthenticated. The token is never logged or sent in an event. The Nuxt
server sends it from `NUXT_AI_SERVICE_TOKEN`. Release administration always requires a configured token, including
local memory mode.

## State initialization and release continuity

AI state has two parts.

**Control state** in the service database `AI_DATABASE_URL`: `ai_state_schema` holds the schema contract and the immutable `state_<uuidhex>` `state_id`, and `ai_generations` holds the release generation draining flags. It holds no tenant content. Bootstrap generates the identity; it is not an environment label, and two independently initialized databases have different state identities even with the same version and generation label.

**Tenant state** in each tenant's own database, in schema `liwan_ai`: `ai_runs`, the LangGraph checkpoint tables and `ai_tenant_schema`. The run table has no `tenant` column because the database is the tenant. `TenantStates` opens one Postgres pool per tenant database, with `search_path=liwan_ai` and a bounded size, keeps the most recently used pools (LRU) up to `max_open`, and closes a pool after its idle window; concurrent requests for one database share a single pool. The tenant is mapped to its database from deployment configuration only: `AI_TENANT_DATABASE` in dedicated mode, `LIWAN_TENANT_REGISTRY_PATH` in shared mode. A tenant the deployment does not serve answers 403 before any connection. A tenant database whose schema was never bootstrapped answers 503 `ai_state_uninitialized`; a tenant database that cannot be reached at all (refused connection, timeout, bad credentials) answers 503 `ai_state_unavailable`. Both failures affect only that tenant and no other.

Operator bootstrap commands (the runtime only validates state and never runs DDL):

    python -m liwan_ai_service.store --initialize-control
    python -m liwan_ai_service.store --initialize-tenant <database>

Each takes a PostgreSQL advisory lock and initializes empty state once. Repeating it on already compatible state is read-only. An unversioned existing schema, a partial bootstrap or an incompatible version is refused by both bootstrap and runtime; neither silently upgrades or stamps old data as compatible. Existing development data needs an explicit reviewed offline migration or a separately authorized fresh scratch database. Keep schema ownership and bootstrap credentials with the operator. Runtime needs SELECT on `ai_state_schema`, and SELECT/INSERT/UPDATE on `ai_generations`, besides normal run/checkpoint privileges in each tenant schema. Do not grant runtime UPDATE on the schema identity. Do not give bootstrap credentials to overlapping runtime generations.

Changing graph payloads, tool-result semantics or `ai_runs` schema requires reviewing and advancing
`contracts.AI_STATE_VERSION` and the matching BFF expected version. A change incompatible with the stored
state requires AI-wide `service_maintenance` or blocks release. A matching version is a declared contract; local HTTP health alone does not prove semantic
compatibility. Keep checkpointer dependency artifacts identical for compatible releases.

The internal, service-token-protected endpoints are `POST /internal/release/drain` and
`GET /internal/release/readiness`. Both require a configured service token and explicit `AI_GENERATION_ID`. Drain is persisted in `ai_generations` for that generation and remains closed after a process restart: it closes starts, claims and metadata changes, while an already claimed result and an automatic pending read can still settle. A replacement generation must have its own stable unique id. There is no timeout, reset endpoint or automatic reclamation of a drained generation. Pending
user decisions resume on the accepting generation. Readiness reports the control `state_id`, the runtime `generation_id`, local active requests,
settlement tasks, PostgreSQL pool statistics per open tenant, and run activity summed across every tenant database (`activity_scope` is `tenant_states`). Local request admission is counted before awaiting the persisted gate, so a concurrent drain cannot miss that local admission. A stale claimed write or stalled automatic read remains a blocker;
it is never replayed or aged out merely to make retirement green. Use the existing unknown-result
recovery after investigating the effect. Memory-mode evidence is explicitly `memory_only` and cannot
prove cross-process retirement.

The coordinator must close admission and observe every old process, wait for durable tenant effect leases and active AI work in every tenant, then retire the generation. Configure one directly observed HTTP process per generation id; do not hide several independently admitting workers behind one sampled readiness endpoint. Counts are deliberately conservative: activity in another generation can delay retirement. Its AI-only durable barrier is separate from Odoo tenant barriers.

In `AiMaintenanceCoordinator` operator configuration, `sharedStateId` must equal the actual control `state_id` returned by the service; each `oldServices`/`newServices` entry's `id` must equal that runtime's `AI_GENERATION_ID`. The coordinator checks both on every observation and preflights all old/new endpoints before closing admission or invoking a migration adapter. A candidate attached to a different initialized control database with the same state version is rejected. Read actual identity using the token-protected readiness endpoint and record only `state_id`/`generation_id` in the reviewed operator configuration, never connection credentials. Changing labels cannot substitute for an actual state identity.

This pre-release metadata schema has no compatibility branch for earlier unrecognized metadata or a missing generation table. Use a newly authorized empty scratch schema for development proof; existing development state requires a separately reviewed offline migration. Never stamp an old database with a guessed identity or silently initialize it during startup.

When `LIWAN_RELEASE_ROUTES_DIR` is configured, the BFF requires trusted `event.context.liwanRelease`
(`releaseId`, `poolId`, `routeRevision`, `fence`, `aiUrl`, `aiStateVersion`, optional `aiMaintenance`).
Tenant middleware supplies it only after the tenant boundary is verified. The BFF snapshots the AI
destination for the entire request and sends the expected state version; browser headers never select
it. Missing/incompatible state metadata and maintenance fail closed. With release routing disabled,
the configured `NUXT_AI_SERVICE_URL` remains the normal destination.

Every non-GET Odoo tool/audit dispatch also requires trusted
`event.context.liwanReleaseWritePermit(action)` while release routing is enabled. The coordinator owns
the durable tenant lease, checks the barrier/authorized route after acquiring it, holds it through the
response, and releases it on settlement. A shielded claimed write uses the same fence. The BFF permits
only the matching successful claim's approved result to settle during newly announced maintenance;
it does not admit another claim or turn a completed effect into a rejection.

## Conversation history

`GET /v1/runs` (owner headers) lists the caller's own runs, newest update first, as
`{"items": [{run_id, title, status, updated_at, archived}], "total": n}` (at most 50; never another tenant's or user's).
Archived runs are left out; `?archived=true` lists only the archived ones, in the same envelope. A stale `executing` run is
listed as `failed`, as in `GET /v1/runs/{run_id}`.

**Title.** A run starts with the first user message as its title (whitespace-collapsed, cut to 60 characters). When the first
answer of a run completes, the service asks the same configured provider and model for a short title (at most 6 words and
60 characters, in the language of the conversation) from the first message and the first answer, each cut to 300 characters.
This happens after the `answer` event and before the stream's `done` event, so the list fetched after the stream already shows it.
The request is best effort with a 10 second timeout: on failure, timeout or an unusable reply the provisional title stays and the
cause is logged. The title request is not part of the conversation (it is not in the thread and not a user message), and a run is
titled at most once: later turns never rename it. A title the user set is never overwritten (`title_locked`).

**Rename and archive.** `PATCH /v1/runs/{run_id}` (owner headers, owner only; another owner's run is 404) with
`{"title"?: string, "archived"?: boolean}` (at least one). A title is trimmed, 1 to 80 characters, with no control characters;
setting it locks the title against the model. `archived: true` hides the run from the default list, `false` brings it back.
The reply is the updated list item. Neither change touches the run's status, lease or `updated_at`, so an executing run can be
archived and still settles normally, and an archived run can still be opened and continued.

**Retention.** The retention cleanup (`delete_older_than`) works by `updated_at` and deletes archived runs like any other:
archiving does not keep a conversation.

## Claiming a write call

`POST /v1/runs/{run_id}/claim` with `{"call_id": "c_01"}` (and the owner headers) reserves the pending call of a run in
`waiting_user` before the caller executes it: 200 `{"ok": true}` moves the run atomically to `executing`; 409 means the call is
not the pending one, is a read call, or was already claimed or answered. `resume` accepts `waiting_tool`, `waiting_user` and
`executing`. A run stuck in `executing` past `STALE_AFTER_SECONDS` (the executor crashed) is never claimed or resumed again, so a write runs
at most once: `GET` reports it as `failed` with no `pending`, claim and resume answer 409, and only a new message
(`POST /v1/runs` with its `run_id`) continues it, the model being told the call's result is unknown. While a call is `executing`,
a `resume` carrying `decision: "rejected"` answers 409; only the claimer's own result may answer it.

## Tests

    .venv/bin/pytest -q
    # Dedicated empty scratch state only, never odoo19 or a shared development AI database:
    AI_DATABASE_URL=postgresql://localhost/liwan_ai_test .venv/bin/python -m liwan_ai_service.store --initialize-control
    AI_DATABASE_URL=postgresql://localhost/liwan_ai_test .venv/bin/python -m liwan_ai_service.store --initialize-tenant <scratch tenant database>
    AI_TEST_DATABASE_URL=postgresql://localhost/liwan_ai_test .venv/bin/pytest -q tests/test_postgres_release.py tests/test_postgres_state.py

`test_postgres_release.py` starts two Python claim processes and two independent service/checkpointer
pools, proves one claim and checkpoint continuation, reads drain evidence, and temporarily tests
an incompatible metadata version (restored in `finally`). Run it sequentially against its dedicated
scratch database. All model calls use local scripted fakes; no paid provider is needed.

## Notes

The service is developed and tested on Python 3.14 (installed locally; `requires-python` stays `>=3.12`
and the Dockerfile uses 3.12). All lower bounds in `pyproject.toml` resolved without being lowered
(langgraph 1.2.15, langgraph-checkpoint-postgres 3.2.0, langchain-core 1.6.11).

A startup failure names the offending variable only (for example `SettingsError: AI_DATABASE_URL`) and never a value, so connection strings and keys cannot leak through the server log. The expected value of each variable is in the table above.


### Durable generation restart acceptance

The opt-in test creates two new unique `release_durable_1016_*` schemas in an explicitly selected local `liwan_scratch_*` AI database. It never overwrites or drops schemas and leaves identities/records for inspection. It uses scripted models, fresh Python processes, real PostgreSQL and real loopback HTTP endpoints; no model provider is called.

```sh
PYTHONPATH=src:.:../.. AI_DURABLE_RELEASE_TEST=1 \
  AI_TEST_DATABASE_URL=postgresql://scratch_operator@127.0.0.1/liwan_scratch_ai_test \
  .venv/bin/pytest -q -s tests/test_generation_restart_postgres.py
```

The first proof drains a generation, exits the process and starts a fresh process with the same id: new work still receives 503, while a new generation accepts on the same stored identity. The second gives the candidate a different actual database identity with the same schema version: coordinator preflight rejects it before a barrier, drain or migration. This does not establish general schema-migration correctness, an infrastructure fence or production deployment.
