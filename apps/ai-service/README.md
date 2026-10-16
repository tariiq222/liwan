# Nasq AI service

The isolated agent service of Nasq AI (spec: `docs/superpowers/specs/2026-10-15-nasq-ai-design.md`).
It holds no Nasq credential: it receives a message and the caller's tool catalog, decides, and
stops at every tool with an `interrupt`; the Nuxt server executes tools and resumes it.

## Run locally

    python3 -m venv .venv && .venv/bin/pip install -e '.[dev]'
    AI_PROVIDER=ollama AI_MODEL=qwen2.5:7b AI_BASE_URL=http://localhost:11434 \
    AI_DATABASE_URL=postgresql://localhost/nasq_ai_dev \
    .venv/bin/uvicorn nasq_ai_service.service:app --port 8600

Without `AI_DATABASE_URL` the state lives in memory (development only).

## Environment

| Variable | Meaning |
|---|---|
| `AI_PROVIDER` | `anthropic`, `openai` or `ollama` |
| `AI_MODEL` | provider model id |
| `AI_API_KEY` | required for anthropic/openai |
| `AI_BASE_URL` | optional; Ollama host or an OpenAI-compatible endpoint |
| `AI_DATABASE_URL` | Postgres for run state (checkpoints + runs) |
| `AI_RUN_RETENTION_DAYS` | default 30; `python -m nasq_ai_service.cleanup` deletes older runs |
| `AI_DEFAULT_TIMEOUT_SECONDS` | default 120 |

## Tests

    .venv/bin/pytest -q
    AI_TEST_DATABASE_URL=postgresql://localhost/nasq_ai_test .venv/bin/pytest -q tests/test_postgres_state.py

## Notes

The service is developed and tested on Python 3.14 (installed locally; `requires-python` stays `>=3.12`
and the Dockerfile uses 3.12). All lower bounds in `pyproject.toml` resolved without being lowered
(langgraph 1.2.15, langgraph-checkpoint-postgres 3.2.0, langchain-core 1.6.11).
