# Nasq AI service

The isolated agent service of Nasq AI (spec: `docs/superpowers/specs/2026-10-15-nasq-ai-design.md`).
It holds no Nasq credential: it receives a message and the caller's tool catalog, decides, and
stops at every tool with an `interrupt`; the Nuxt server executes tools and resumes it.

## Run locally

    python3 -m venv .venv && .venv/bin/pip install -e '.[dev]'
    AI_PROVIDER=ollama AI_MODEL=qwen2.5:7b AI_BASE_URL=http://localhost:11434 \
    AI_DATABASE_URL=postgresql://localhost/nasq_ai_dev \
    .venv/bin/uvicorn nasq_ai_service.service:app --port 8600

`AI_DATABASE_URL` is required: without it the service refuses to start. For local development only, set
`AI_ALLOW_MEMORY_STATE=true` (exactly) to keep the state in memory; the service then logs a warning at startup.

## Environment

| Variable | Meaning |
|---|---|
| `AI_PROVIDER` | `anthropic`, `openai` or `ollama` |
| `AI_MODEL` | provider model id |
| `AI_API_KEY` | required for anthropic/openai |
| `AI_BASE_URL` | optional; Ollama host or an OpenAI-compatible endpoint |
| `AI_DATABASE_URL` | Postgres for run state (checkpoints + runs); required unless `AI_ALLOW_MEMORY_STATE=true` |
| `AI_ALLOW_MEMORY_STATE` | `true` (exactly) lets the service start without a database, keeping state in memory (development only) |
| `AI_RUN_RETENTION_DAYS` | default 30; `python -m nasq_ai_service.cleanup` deletes older runs |
| `AI_DEFAULT_TIMEOUT_SECONDS` | default 120 |
| `AI_SERVICE_TOKEN` | optional for development (the service logs a warning at startup when unset), at least 24 characters (it refuses to start with a shorter one) |

## Service token

When `AI_SERVICE_TOKEN` is set, every route except `GET /healthz` requires the header `X-Nasq-Service-Token` to equal it
(constant-time comparison); anything else answers 401 with a fixed body. Without it the service is open (development only).
The token is never logged or sent in an event. The Nuxt server sends it from `NUXT_AI_SERVICE_TOKEN`.

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
    AI_TEST_DATABASE_URL=postgresql://localhost/nasq_ai_test .venv/bin/pytest -q tests/test_postgres_state.py

## Notes

The service is developed and tested on Python 3.14 (installed locally; `requires-python` stays `>=3.12`
and the Dockerfile uses 3.12). All lower bounds in `pyproject.toml` resolved without being lowered
(langgraph 1.2.15, langgraph-checkpoint-postgres 3.2.0, langchain-core 1.6.11).

A startup failure names the offending variable only (for example `SettingsError: AI_DATABASE_URL`) and never a value, so connection strings and keys cannot leak through the server log. The expected value of each variable is in the table above.
