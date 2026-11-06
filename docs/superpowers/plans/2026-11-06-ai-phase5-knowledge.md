# AI phase 5: knowledge retrieval (RAG) implementation plan

**Goal:** an agent answers from the company's real records: Odoo feeds an index of declared sources, the AI service
searches it, and Odoo returns record text only for records the asking user can read.

**Spec:** `docs/superpowers/specs/2026-11-04-liwan-ai-agents-design.md` §6.3, §6.6, §6.12, §8a item 5.

**Out of scope (recorded in the spec's §9):** chat attachments. They need a platform malware scanner that does not exist.

## Global constraints

- The index stores vectors and references only: `model`, `res_id`, `company_id`, `chunk_no`. It never stores record
  text. The queue that carries chunk text from Odoo to the service is transient: a row is deleted once it is indexed.
- Odoo cannot reach the service, and the service holds no Odoo credential. Odoo writes the queue
  (`liwan_ai.ai_knowledge_queue`, INSERT only, like `ai_outbox`), and the service drains it.
- Chunking happens in Odoo only. The resolve route rebuilds chunk `n` of a record with the same function, so the
  numbering in the index always matches.
- Text bound for any provider (an embedding or a chat) has passed the outbound data policy. Declared fields may not be in
  `SENSITIVE_FIELDS`, and chunk text is withheld by a Python port of `apps/web/server/utils/ai/outbound.ts` before it is
  queued. The Nuxt executor withholds the resolve result again, as it does for every tool.
- No `sudo()`. Odoo builds index text as the technical user `liwan_ai.user_ai_indexer`. That user's only group,
  `liwan_ai.group_ai_indexer`, gets read ACL rows on the declared models from the bridges that declare them. Group-bound
  record rules do not apply to it; the global multi-company rules do, and it is allowed every company.
- Search candidates come only from the request's current company. Odoo's resolve route checks the source feature, the
  current company, the record rules (`search` in the caller's environment) and the declared fields again.
- R8: everything works in `saas` and `non_saas`. Knowledge is the sub-feature `ai.knowledge` and the tenant setting
  `ai.knowledge_enabled` (default off), which applies only while the AI consent is valid.
- Clean codebase rules (AGENTS.md): no parallel paths, schema version bump with migration, locale keys for all strings.

## Contracts between the layers

### Queue (service owns the DDL, Odoo inserts)

`ai_knowledge_queue`:
- `id BIGSERIAL PRIMARY KEY`
- `kind TEXT CHECK (kind IN ('upsert', 'delete', 'reset'))`
- `model TEXT`, `res_id BIGINT`, `company_id BIGINT`
- `chunks JSONB`
- `created_at TIMESTAMPTZ DEFAULT now()`

Checks:
- `reset` has no model, record or chunks.
- `delete` has model and res_id, and no chunks.
- `upsert` has model, res_id, company_id and a JSON array of 1 to 20 strings, each 1 to 2000 characters.

The tenant bootstrap grants the database owner INSERT on the table and USAGE on its sequence, as `GRANT_OUTBOX` does.

### Index (service only)

`ai_knowledge_chunk`:
- `model TEXT`, `res_id BIGINT`, `company_id BIGINT`, `chunk_no INT`
- `embed_model TEXT`, `embedding vector`
- `PRIMARY KEY (model, res_id, chunk_no)`, plus an index on `company_id`.

The bootstrap also runs `CREATE EXTENSION IF NOT EXISTS vector`. The column has no fixed dimension: a search compares
only rows of the configured `embed_model`, as an exact scan. A tenant's index is small, so no ANN index in this phase.

### Embedding configuration (operator, service environment)

- `AI_EMBEDDING_PROVIDER`: `openai` (any OpenAI-compatible endpoint) or `ollama`. Unset means knowledge is unavailable.
- `AI_EMBEDDING_MODEL`, `AI_EMBEDDING_BASE_URL` (optional), `AI_EMBEDDING_API_KEY` (optional for `ollama`).

### Search tool

Odoo registers the read tool `ai.search_knowledge` in liwan_ai:
- capability `ai.use`, feature `ai.knowledge`.
- input `{query: string 1..500}`.
- route `POST /api/v1/ai/knowledge/resolve`, `input_map.body = {"refs": "$refs"}`, `result_summary = ["items[]"]`.

In the graph, a call to this tool is special-cased before the interrupt:
- The service embeds `query` and takes the 40 nearest chunks of the request's company.
- It sets `payload.input = {query, refs: [{model, res_id, chunk_no}, ...]}`.
- With no candidates, or knowledge unavailable, it answers in the graph with `{"items": []}` or the error
  `knowledge_unavailable`, and spends no tool call.

Resolve route, body `{refs: [...]}` (at most 40):
- Returns `{items: [{model, res_id, chunk_no, title, source, text}], total}`: at most 8 readable items, in the
  candidates' order.
- `source` is the source's app label. Unknown or hidden refs are silently dropped.
- 422 for a malformed body; 403 without `ai.use` or with the feature off.

### Odoo source declaration

Bridges extend `liwan.ai.knowledge.registry._liwan_ai_knowledge_sources()` (super() + list). Each item has:
- `model`, `owner`, `feature_key`
- `title_field`
- `fields` (char, text, html, selection, many2one only; none in `SENSITIVE_FIELDS`)
- `label_ar`, `label_en`

The registry validates on load. In this phase, `liwan_tasks_ai` declares `project.task` and `liwan_crm_ai` declares
`crm.lead`.

### Indexer (Odoo)

The cron runs every 5 minutes as `user_ai_indexer`. It does nothing unless:
- the queue is insertable,
- the consent is valid,
- `ai.knowledge_enabled` is on.

On each run:
- Per source, the cursor model `liwan.ai.knowledge.cursor` (model unique, `write_date`) bounds a batch of 200 records
  with `write_date > cursor`, ordered by `write_date, id`.
- An active record becomes an `upsert`; an archived one a `delete`.
- Each bridge overrides `unlink` of its model to queue a `delete`.
- The settings action "rebuild the index" (`ai.settings.manage`) clears the cursors and queues one `reset`.

### Service drain

A background loop runs every 30 seconds per tenant database from the tenant directory. Under the advisory lock
`ai_knowledge_queue`, it takes up to 100 rows in id order:
- `upsert` replaces the record's rows (delete, then embed and insert).
- `delete` removes them.
- `reset` removes all rows.

The rows are deleted in the same transaction. An embedding error rolls the batch back, logs, and the next tick retries.

## Ownership (one writer per file)

1. **Service worker:**
   - `apps/ai-service/**`: `knowledge.py`, `embeddings.py`, settings, graph special case, service loop, store table
     list, tests.
2. **Odoo worker:**
   - `odoo-addons/liwan_ai/**`: registry, cursor, indexer user/group, cron, chunker, outbound port, resolve route,
     tool, setting, version bump and migration, tests.
   - `odoo-addons/liwan_tasks_ai/**` and `odoo-addons/liwan_crm_ai/**`: source declarations, ACL rows, unlink hooks.
   - `tools/arch_documented_sudo.json`: not touched; no sudo is added.
3. **Web and deploy worker:**
   - `apps/web/**`: knowledge toggle and rebuild action on the AI settings page, locale keys, executor test for the
     refs body.
   - `packages/contracts/**`.
   - `deploy/docker-compose.yml`, `.github/workflows/ci.yml` (ai-service job image), `deploy/provision.sh` if it
     creates extensions, `deploy/OPERATIONS.md`.
   - `docs/api/openapi.json` regenerated by the coordinator after the Odoo part lands.
