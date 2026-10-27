# WebVue AI service

The isolated agent service of WebVue AI (spec: `docs/superpowers/specs/2026-10-15-webvue-ai-design.md`).
It holds no WebVue credential: it receives a message and the caller's tool catalog, decides, and
stops at every tool with an `interrupt`; the Nuxt server executes tools and resumes it.

## Run locally

    python3 -m venv .venv && .venv/bin/pip install -e '.[dev]'
    # Operator bootstrap, once, against an empty AI database, before starting any runtime:
    AI_DATABASE_URL=postgresql://localhost/webvue_ai_dev \
    .venv/bin/python -m webvue_ai_service.store --initialize
    AI_PROVIDER=ollama AI_MODEL=qwen2.5:7b AI_BASE_URL=http://localhost:11434 \
    AI_DATABASE_URL=postgresql://localhost/webvue_ai_dev \
    .venv/bin/uvicorn webvue_ai_service.service:app --port 8600

`AI_DATABASE_URL` is required: without it the service refuses to start. For local development only, set
`AI_ALLOW_MEMORY_STATE=true` (exactly) to keep the state in memory; the service then logs a warning at startup.

## Environment

| Variable | Meaning |
|---|---|
| `AI_PROVIDER` | `anthropic`, `openai`, `ollama` or `openrouter` (see Providers) |
| `AI_MODEL` | provider model id |
| `AI_API_KEY` | required for anthropic, openai and openrouter |
| `AI_BASE_URL` | optional; overrides the provider's default base URL (Ollama host, OpenAI-compatible endpoint, OpenRouter) |
| `AI_OPENROUTER_REFERER` | optional; sent as `HTTP-Referer` to OpenRouter for app attribution (openrouter only; never required, never logged) |
| `AI_OPENROUTER_TITLE` | optional; sent as `X-Title` to OpenRouter (openrouter only; never required, never logged) |
| `AI_DATABASE_URL` | Postgres for run state (checkpoints + runs); required unless `AI_ALLOW_MEMORY_STATE=true` |
| `AI_GENERATION_ID` | stable unique release generation id (`[a-z][a-z0-9_-]{0,62}`); required with a service token for release administration; reuse the same id on restart, never reuse a drained id for a replacement generation |
| `AI_STATE_VERSION` | default `1`; run schema, graph/checkpoint payload and tool-result compatibility contract; another value refuses startup |
| `AI_ALLOW_MEMORY_STATE` | `true` (exactly) lets the service start without a database, keeping state in memory (development only) |
| `AI_RUN_RETENTION_DAYS` | default 30; `python -m webvue_ai_service.cleanup` deletes older runs |
| `AI_DEFAULT_TIMEOUT_SECONDS` | default 120 |
| `AI_SERVICE_TOKEN` | optional for development (the service logs a warning at startup when unset), at least 24 characters (it refuses to start with a shorter one) |

## Providers

The registry in `src/webvue_ai_service/provider_registry.py` is the single list of providers: `Settings.from_env` takes the valid
`AI_PROVIDER` names and the key rule from it, and `build_chat_model` builds the client from it.

| `AI_PROVIDER` | `AI_API_KEY` | Default base URL | Example `AI_MODEL` |
|---|---|---|---|
| `anthropic` | required | the Anthropic API | `claude-sonnet-4-5` |
| `openai` | required | the OpenAI API (any OpenAI-compatible endpoint through `AI_BASE_URL`) | `gpt-4o` |
| `ollama` | not needed | `http://localhost:11434` | `qwen2.5:7b` |
| `openrouter` | required | `https://openrouter.ai/api/v1` | `anthropic/claude-sonnet-4.5` |

For `openrouter`, `AI_MODEL` is the OpenRouter model id (`vendor/model`).

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
call itself, up to 3 attempts (0.5 s then 1 s apart, inside the run deadline), only for a 408/409/429/5xx answer or a connection error.
Titles are never retried.

## Service token

When `AI_SERVICE_TOKEN` is set, every route except `GET /healthz` requires the header `X-WebVue-Service-Token` to equal it
(constant-time comparison); anything else answers 401 with a fixed body. Without it the service is open (development only).
The token is never logged or sent in an event. The Nuxt server sends it from `NUXT_AI_SERVICE_TOKEN`.
Release administration always requires a configured token, including local memory mode.

## State initialization and release continuity

Runtime startup only reads the schema contract and generated `state_id` in `ai_state_schema`, verifies the durable `ai_generations` table exists, and checks the existing LangGraph
`checkpoint_migrations` version. It never calls either schema setup routine. The expected checkpoint
migration version comes from the runtime's installed checkpointer; a different package migration
version refuses startup before any DDL. Compatible processes use the same `ai_runs`, leases, claims and
checkpoints. There is no second deployment run-state store. Bootstrap generates an immutable `state_<uuidhex>` identity in the database; it is not an environment label. Runtime reports that stored value. Two independently initialized databases/schemas have different state identities even with the same version and generation label.

The operator bootstrap command above takes a PostgreSQL advisory lock and initializes an empty database
once. Repeating it on already compatible state is read-only. An unversioned existing schema, a partial
bootstrap or an incompatible version is refused by both bootstrap and runtime; neither silently upgrades
or stamps old data as compatible. Existing development data needs an explicit reviewed offline migration
or a separately authorized fresh scratch database. The runtime role only needs the established tables,
sequences and normal read/write privileges; keep schema ownership and bootstrap credentials with the
operator. Runtime needs SELECT on `ai_state_schema`, and SELECT/INSERT/UPDATE on `ai_generations`, besides normal run/checkpoint privileges. Do not grant runtime UPDATE on the schema identity. Do not give bootstrap credentials to overlapping runtime generations.

Changing graph payloads, tool-result semantics or `ai_runs` schema requires reviewing and advancing
`contracts.AI_STATE_VERSION` and the matching BFF expected version. A change incompatible with the shared
state requires AI-wide `service_maintenance` or blocks release. Odoo tenant isolation does not isolate
this database. A matching version is a declared contract; local HTTP health alone does not prove semantic
compatibility. Keep checkpointer dependency artifacts identical for compatible releases.

The internal, service-token-protected endpoints are `POST /internal/release/drain` and
`GET /internal/release/readiness`. Both require a configured service token and explicit `AI_GENERATION_ID`. Drain is persisted in `ai_generations` for that generation and remains closed after a process restart: it closes starts, claims and metadata changes, while an already claimed result and an automatic pending read can still settle. A replacement generation must have its own stable unique id. There is no timeout, reset endpoint or automatic reclamation of a drained generation. Pending
user decisions resume on the accepting generation. Evidence includes shared `running`/`executing`/`waiting_tool` counts, local active requests,
settlement tasks, PostgreSQL pool connection statistics, the actual stored `state_id` and the runtime `generation_id`. Local request admission is counted before awaiting the persisted gate, so a concurrent drain cannot miss that local admission. A stale claimed write or stalled automatic read remains a blocker;
it is never replayed or aged out merely to make retirement green. Use the existing unknown-result
recovery after investigating the effect. Memory-mode evidence is explicitly `memory_only` and cannot
prove cross-process retirement.

The coordinator must close admission and observe every old process, wait for durable tenant effect leases and shared active AI work, then retire the generation. Configure one directly observed HTTP process per generation id; do not hide several independently admitting workers behind one sampled readiness endpoint. Shared counts are deliberately conservative: activity in another generation can delay retirement. Its AI-only durable barrier is separate from Odoo tenant barriers.

In `AiMaintenanceCoordinator` operator configuration, `sharedStateId` must equal the actual `state_id` returned by the service; each `oldServices`/`newServices` entry's `id` must equal that runtime's `AI_GENERATION_ID`. The coordinator checks both on every observation and preflights all old/new endpoints before closing admission or invoking a migration adapter. A candidate attached to a different initialized database with the same state version is rejected. Read actual identity using the token-protected readiness endpoint and record only `state_id`/`generation_id` in the reviewed operator configuration, never connection credentials. Changing labels cannot substitute for an actual state identity.

This pre-release metadata schema has no compatibility branch for earlier unrecognized metadata or a missing generation table. Use a newly authorized empty scratch schema for development proof; existing development state requires a separately reviewed offline migration. Never stamp an old database with a guessed identity or silently initialize it during startup.

When `WEBVUE_RELEASE_ROUTES_DIR` is configured, the BFF requires trusted `event.context.webvueRelease`
(`releaseId`, `poolId`, `routeRevision`, `fence`, `aiUrl`, `aiStateVersion`, optional `aiMaintenance`).
Tenant middleware supplies it only after the tenant boundary is verified. The BFF snapshots the AI
destination for the entire request and sends the expected state version; browser headers never select
it. Missing/incompatible state metadata and maintenance fail closed. With release routing disabled,
the configured `NUXT_AI_SERVICE_URL` remains the normal destination.

Every non-GET Odoo tool/audit dispatch also requires trusted
`event.context.webvueReleaseWritePermit(action)` while release routing is enabled. The coordinator owns
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
    AI_DATABASE_URL=postgresql://localhost/webvue_ai_test .venv/bin/python -m webvue_ai_service.store --initialize
    AI_TEST_DATABASE_URL=postgresql://localhost/webvue_ai_test .venv/bin/pytest -q tests/test_postgres_release.py tests/test_postgres_state.py

`test_postgres_release.py` starts two Python claim processes and two independent service/checkpointer
pools, proves one claim and checkpoint continuation, reads shared drain evidence, and temporarily tests
an incompatible metadata version (restored in `finally`). Run it sequentially against its dedicated
scratch database. All model calls use local scripted fakes; no paid provider is needed.

## Notes

The service is developed and tested on Python 3.14 (installed locally; `requires-python` stays `>=3.12`
and the Dockerfile uses 3.12). All lower bounds in `pyproject.toml` resolved without being lowered
(langgraph 1.2.15, langgraph-checkpoint-postgres 3.2.0, langchain-core 1.6.11).

A startup failure names the offending variable only (for example `SettingsError: AI_DATABASE_URL`) and never a value, so connection strings and keys cannot leak through the server log. The expected value of each variable is in the table above.


### Durable generation restart acceptance

The opt-in test creates two new unique `release_durable_1016_*` schemas in an explicitly selected local `webvue_scratch_*` AI database. It never overwrites or drops schemas and leaves identities/records for inspection. It uses scripted models, fresh Python processes, real PostgreSQL and real loopback HTTP endpoints; no model provider is called.

```sh
PYTHONPATH=src:.:../.. AI_DURABLE_RELEASE_TEST=1 \
  AI_TEST_DATABASE_URL=postgresql://scratch_operator@127.0.0.1/webvue_scratch_ai_test \
  .venv/bin/pytest -q -s tests/test_generation_restart_postgres.py
```

The first proof drains a generation, exits the process and starts a fresh process with the same id: new work still receives 503, while a new generation accepts on the same stored identity. The second gives the candidate a different actual database identity with the same schema version: coordinator preflight rejects it before a barrier, drain or migration. This does not establish general schema-migration correctness, an infrastructure fence or production deployment.
