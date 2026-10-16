# WebVue AI service

The isolated agent service of WebVue AI (spec: `docs/superpowers/specs/2026-10-15-webvue-ai-design.md`).
It holds no WebVue credential: it receives a message and the caller's tool catalog, decides, and
stops at every tool with an `interrupt`; the Nuxt server executes tools and resumes it.

## Run locally

    python3 -m venv .venv && .venv/bin/pip install -e '.[dev]'
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

## Service token

When `AI_SERVICE_TOKEN` is set, every route except `GET /healthz` requires the header `X-WebVue-Service-Token` to equal it
(constant-time comparison); anything else answers 401 with a fixed body. Without it the service is open (development only).
The token is never logged or sent in an event. The Nuxt server sends it from `NUXT_AI_SERVICE_TOKEN`.

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
    AI_TEST_DATABASE_URL=postgresql://localhost/webvue_ai_test .venv/bin/pytest -q tests/test_postgres_state.py

## Notes

The service is developed and tested on Python 3.14 (installed locally; `requires-python` stays `>=3.12`
and the Dockerfile uses 3.12). All lower bounds in `pyproject.toml` resolved without being lowered
(langgraph 1.2.15, langgraph-checkpoint-postgres 3.2.0, langchain-core 1.6.11).

A startup failure names the offending variable only (for example `SettingsError: AI_DATABASE_URL`) and never a value, so connection strings and keys cannot leak through the server log. The expected value of each variable is in the table above.
