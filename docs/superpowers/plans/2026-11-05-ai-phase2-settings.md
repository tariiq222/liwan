# AI phase 2: settings, provider, residency consent, limits, monitoring — implementation plan

**Goal:** a tenant administrator controls the AI from one settings page: platform provider or the tenant's own key,
data residency with a signed consent, retention, monthly token limit, and a short monitoring view; the server
enforces every choice.

**Spec:** [2026-11-04 LiwanOS AI agents](../specs/2026-11-04-liwan-ai-agents-design.md) §6.7 (administrator settings,
general part), §6.8, §6.9 (monitoring), §8a phase 2. Phase 1 (tenant isolation, PR #388) is merged.

**Architecture:** Odoo (`liwan_ai`) owns the policy facts a run needs before it starts: provider mode, consent
records, limits and usage. The AI service owns the facts that live with AI state in the tenant schema: the tenant's
own provider key (encrypted) and the run retention window. Nuxt joins both: it reads the policy from Odoo with the
user's session, passes it in every run request, and proxies key and retention changes to the service only after Odoo
confirms `ai.settings.manage`. The service enforces residency and the output cap itself, so a wrong Nuxt never sends
tenant data abroad without consent.

## Global constraints

- AGENTS.md R1–R10, R7 (no new `sudo()`), clean pre-release codebase (replace, never layer), Arabic default + RTL,
  every user string in locale files, `{items, total}` list envelopes, structured errors (403 `forbidden`, 404, 422 `invalid`, 409).
- No new package dependency: encryption uses PostgreSQL `pgcrypto` (shipped in the official `postgres:16` image's contrib).
- Pre-release: the tenant AI schema changes in place; `AI_STATE_VERSION` stays `"1"` (no tenant holds AI state yet).
  A developer database bootstrapped by phase 1 is re-created by dropping schema `liwan_ai` and re-running the bootstrap.
- No conversation text ever reaches Odoo or the monitoring view: actions and counts only.

## Decisions (design author's calls, recorded for the owner)

1. **Consent text** is a versioned constant in `liwan_ai` (`CONSENT_VERSION = "2026-11-05-draft"`), Arabic and English,
   marked as a draft pending legal review (spec §10). Its hash is `sha256(ar + "\n" + en)`. Signing requires the client
   to echo the current version and hash, proving the signer saw that exact text. A new version voids every consent.
2. **Residency** is not a stored field: data may leave the Kingdom exactly when a non-revoked consent of the current
   version exists. Revoking returns the tenant to "inside only".
3. **Provider location** is a property of each provider in the service registry: `ollama` = `inside` (runs in the
   deployment), `anthropic`, `openai`, `openrouter` = `outside`. Any `outside` provider, platform or tenant key, needs consent.
4. **Tenant key mode** supports the registry providers that need an API key. The model name is chosen with the key.
5. **Token limit** counts input + output tokens of `billing = platform` usage rows in the current UTC month. A run starts
   only while used < limit, so a tenant may exceed by at most one run. Tenant-key runs count messages only.
6. **Output cap per run** (`ai.output_tokens.per_run`, platform runs only): the plan loop stops with
   `limit_reached` reason `output_tokens` once the run's output tokens reach the cap; the call that crosses it completes.
7. **80% bell**: a bridge `liwan_ai_notify` (rank 5, auto_install; `liwan_ai` and `liwan_notify` are both rank 3 and
   may not depend on each other) notifies holders of `ai.settings.manage` once per month per limit when messages or
   tokens reach 80%.
8. **Monitoring** shows the current month: totals, per user (messages, tokens, tool calls), and the ten most used tools.
   Per-agent rows arrive with agents in phase 3.

---

## Task 1 — Odoo: settings, consent, limits, monitoring (`odoo-addons/liwan_ai`, `liwan_ai_notify`, catalog)

**Files:** `odoo-addons/liwan_ai/**` (version bump 19.0.1.3.0 + `migrations/19.0.1.3.0/` only if a stored field of an
existing model changes), new `odoo-addons/liwan_ai_notify/**`, `tools/arch_layers.json` (add `"liwan_ai_notify": 5`),
`deploy/catalog/solutions/platform_v4.json` (seed the two new limits on every plan that has `ai.messages.monthly`).

**Interfaces produced:**
- Capability `ai.settings.manage` (owner `liwan_ai`, sensitive, custom-role allowed, granted to the built-in
  system-admin role the way `crm.settings.manage` is granted to its admin role; not to employees).
- Features: `ai.tokens.monthly` (limit), `ai.output_tokens.per_run` (limit).
- `liwan.ai.settings`: one record per tenant (no company field), fields `provider_mode` selection
  `platform|tenant_key` default `platform`, `revision` integer. Helper `_liwan_current()` creates it on first read.
- `liwan.ai.consent`: `user_id`, `signed_at`, `text_version`, `text_hash`, `revoked_at`, `revoked_by_id`; no write after
  create except the revoke fields; helper `_liwan_valid()` returns the non-revoked consent of `CONSENT_VERSION` or empty.
- `liwan.ai.usage`: new selection `billing` `platform|tenant_key`, required, wire key `billing`.
- Routes (all `json2`, `auth='user'`, `api_handler`, `requires_feature('ai.enabled')`):
  - `GET /api/v1/ai/settings` and `PATCH /api/v1/ai/settings` (`{provider_mode, revision}` → 409 `conflict` on a wrong
    revision) — `ai.settings.manage`. Shape:
    `{provider_mode, revision, consent: {required_version, text_ar, text_en, text_hash, signed: null|{user:{id,name}, signed_at, text_version}}, usage: {month, messages_used, messages_limit, tokens_used, tokens_limit, output_tokens_per_run}}`.
  - `POST /api/v1/ai/consent` `{text_version, text_hash}` — `ai.settings.manage`; 422 `invalid` when either differs
    from the current text; idempotent while a valid consent exists. `POST /api/v1/ai/consent/revoke` — same capability.
  - `GET /api/v1/ai/monitoring` — `ai.settings.manage`. Shape:
    `{month, totals: {messages, input_tokens, output_tokens, tool_calls}, users: {items: [{user: {id, name}, messages, tokens, tool_calls}], total}, tools: {items: [{tool_name, calls}], total}}`; tool rows are audit rows of kind `read|write_light|draft`; top 10 tools.
  - `GET /api/v1/ai/tools` `limits` gains `policy: {provider_mode, outside_allowed, tokens_monthly, tokens_used, output_tokens_per_run}` (null limits mean unlimited).
- Message audit (`kind='message'`) additionally refuses with 403 `limit_reached` reason `tokens_monthly` when
  `provider_mode == 'platform'` and platform tokens used this month ≥ `ai.tokens.monthly`.
- Record rules: holders of `ai.settings.manage` read every audit and usage row of their companies.
- `liwan_ai_notify`: registers notify kind `ai.limit_warning`, extends the message-audit create: after a successful
  message audit, when messages or platform tokens reach ≥ 80% of their limit, delivers one bell per limit per month
  (idempotency key `ai.limit_warning:<limit>:<YYYY-MM>:<user id>`) to every user holding `ai.settings.manage`.

**Tests (`liwan_ai/tests`, `liwan_ai_notify/tests`, `LiwanApiCase`):** settings read/patch forbidden without the
capability, 409 on stale revision; consent sign with wrong hash → 422, sign then version change voids it
(`outside_allowed` false), revoke; token limit refusal at the boundary (used == limit refused, limit − 1 allowed);
tenant-key mode is not refused by the token limit; monitoring totals and top tools, no message text in the response;
an ordinary `ai.use` user cannot read another user's usage; 80% bell delivered once per month.

**Check:** the scratch-database command block in `docs/agents/odoo-rules.md`, `-i liwan_ai,liwan_ai_notify --test-tags /liwan_ai,/liwan_ai_notify`;
`python3 -B tools/arch_policy.py`; `python3 -B tools/sudo_gate.py`.

## Task 2 — AI service: tenant config, own key, residency, output cap (`apps/ai-service`, `deploy/ai`)

**Files:** `apps/ai-service/src/liwan_ai_service/{provider_registry,providers,settings,store,service,graph,usage,contracts,cleanup}.py`,
new `apps/ai-service/src/liwan_ai_service/tenant_config.py`, tests under `apps/ai-service/tests/`,
`deploy/ai/tenant_schema.sql` (`CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA liwan_ai`, guarded like the rest),
`deploy/ai/ensure_secrets.sh` + `deploy/ai/.env.example` (generate `AI_KEY_ENCRYPTION_KEYS` and `AI_KEY_ENCRYPTION_KEY_ID`),
`deploy/docker-compose.yml` and `deploy/docker-compose.shared.yml` (pass both to `ai`), `deploy/OPERATIONS.md`,
`apps/ai-service/README.md`.

**Interfaces produced:**
- `ProviderSpec.location: Literal["inside", "outside"]`.
- Tenant table `ai_tenant_config` (singleton): `retention_days INTEGER NOT NULL` (1–365, bootstrap value from
  `AI_RUN_RETENTION_DAYS`, default 30), `key_provider TEXT`, `key_model TEXT`, `key_ciphertext BYTEA`, `key_id TEXT`,
  `key_last4 TEXT`, `key_updated_at TIMESTAMPTZ`; a CHECK keeps the key columns all null or all set. Created by
  `initialize_tenant`, required by `validate_tenant`.
- Encryption with `pgp_sym_encrypt(key, secret, 'cipher-algo=aes256')` / `pgp_sym_decrypt`; the secret of `key_id`
  comes from `AI_KEY_ENCRYPTION_KEYS` (`id:secret,id:secret`), new writes use `AI_KEY_ENCRYPTION_KEY_ID`. A ciphertext
  whose key id is unknown answers 503 `ai_key_unavailable`. CLI `python -m liwan_ai_service.tenant_config --rotate`
  re-encrypts every served tenant to the current key id and reports counts only.
- Service routes (service token, `x-liwan-tenant` + `x-liwan-user`, tenant from the directory as today):
  - `GET /v1/tenant/config` → `{retention_days, key: {configured, provider, model, last4, updated_at}, platform: {provider, model, location}, providers: [{name, location, needs_api_key}]}`.
  - `PUT /v1/tenant/config/retention` `{retention_days}` → the config; 422 out of range.
  - `PUT /v1/tenant/config/key` `{provider, model, api_key}` → the config (never the key); 422 for an unknown provider,
    a provider without `needs_api_key`, a bad model name, or an empty key.
  - `DELETE /v1/tenant/config/key` → the config.
- `RunRequest` and the resume request gain a required `policy: {provider_mode: "platform"|"tenant_key", outside_allowed: bool, max_output_tokens: int|null}`.
  The run's model: platform → the deployment model; tenant_key → built from the tenant config (cached per tenant and
  `key_updated_at`); missing key → 409 `ai_tenant_key_missing`. A provider with `location == "outside"` and
  `outside_allowed == false` → 403 `ai_consent_required`, before any provider call. A failing tenant key surfaces as the
  existing provider error; there is no fallback to the platform key.
- The graph reads the model and identity from `config["configurable"]` (one compiled graph per tenant state); state
  gains `output_tokens`; the plan node ends with `limit_reached` and `limit: "output_tokens"` when
  `max_output_tokens` is set and reached.
- `ModelCallEvent.billing: "platform"|"tenant_key"`.
- Retention: `cleanup.run()` deletes each tenant's runs older than that tenant's `retention_days`.

**Tests:** key put/get/delete never returns the key and stores ciphertext only (Postgres test reads the column);
rotation re-encrypts; unknown key id → 503; consent refusal happens before any model call (scripted model sees no call);
tenant key run uses the tenant model identity and `billing = tenant_key`; missing tenant key → 409; output cap stops the
loop; per-tenant retention in cleanup; validate refuses a schema without `ai_tenant_config`.

**Check:** `apps/ai-service/.venv/bin/python -m pytest -q -p no:cacheprovider apps/ai-service/tests` (with
`AI_TEST_DATABASE_URL` on a `liwan_scratch_` database), `ruff check apps/ai-service`, `python3 -B -m pytest -q -p no:cacheprovider deploy`.

## Task 3 — contracts and Nuxt server (`packages/contracts/src/ai`, `apps/web/server`)

**Files:** `packages/contracts/src/ai/**`, `apps/web/server/utils/ai/{session,upstream,usage}.ts`,
`apps/web/server/api/ai/runs/**`, new `apps/web/server/api/ai/config/{index.get,retention.put,key.put,key.delete}.ts`,
their tests.

**Interfaces produced:**
- Zod: `AiPolicySchema`, `AiSettingsSchema`, `AiSettingsPatchSchema`, `AiConsentSignSchema`, `AiMonitoringSchema`,
  `AiTenantConfigSchema`, `AiRetentionPutSchema`, `AiKeyPutSchema`; `AiLimitsSchema` gains `policy`; usage records gain
  `billing`; the limit reason enum gains `tokens_monthly`, `output_tokens`, `consent_required`, `tenant_key_missing`.
- `runSession` returns `policy` from `/api/v1/ai/tools`; run and resume send `policy` with
  `max_output_tokens = provider_mode == 'platform' ? output_tokens_per_run : null`.
- `/api/ai/config/*`: each first calls Odoo `GET /api/v1/ai/settings` with the user's cookie (403 passes through), then
  the service route of the same name; the key body is sent to the service only and never logged.
- Service 403 `ai_consent_required` and 409 `ai_tenant_key_missing` reach the browser as limit events the `/ai` page shows.

**Check:** `npm test`, `cd apps/web && npx vue-tsc --build --noEmit` (via `npm -w apps/web run lint`).

## Task 4 — settings page and `/ai` notices (`apps/web/app`, locales)

**Files:** `apps/web/app/modules/ai/manifest.ts` (`settings` entry, parts `general`, `residency`, `limits`, `monitoring`,
capability `ai.settings.manage`), new `apps/web/app/pages/settings/apps/ai/index.vue`, new
`apps/web/app/components/ai/settings/*` cards, `apps/web/app/composables/ai/useAiSettings.ts`,
`apps/web/app/components/ai/AiLimitNotice.vue`, `apps/web/app/pages/ai/index.vue` (one line: administrators see
actions, never conversation text), `apps/web/i18n/locales/{ar,en}/ai.json` (or the AI namespace in use), unit tests.

**Behavior:** built from `SharedSettingsPage` and Storybook components only (DESIGN.md). Cards: provider (mode switch;
in tenant-key mode provider select, model input, write-only key input showing `configured` and last 4, remove with
inline confirmation), residency (status, full consent text in the reader's locale, sign button, revoke with inline
confirmation), retention (days), limits (messages and tokens used/limit), monitoring (users table, top tools). All
writes go through the routes of tasks 1 and 3. The `/ai` composer explains `consent_required` and `tenant_key_missing`
with a link to the settings page for users who hold `ai.settings.manage`.

**Check:** `npm test`, `npm -w apps/web run lint`, Playwright proof on the isolated mock stack (RTL, light/dark).

## Review focus

1. Consent version change mid-month: runs must stop immediately for outside providers (service check, not only UI).
2. A tenant key typed into the page never appears in any log, response, audit `input` or usage row.
3. Token counting must ignore tenant-key usage rows and rows from previous months (UTC boundary).
4. Resume after a policy change: resume carries the current policy, so a revoked consent blocks the resumed run.
5. Retention changed to a smaller value deletes older runs at the next sweep only, never inside the request.
