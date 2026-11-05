# LiwanOS AI agents: tenant-contained state, memory, knowledge and per-app agents

Status: design approved in discussion with the owner on 2026-11-04; awaiting review of this document.
Builds on: [2026-10-15 LiwanOS AI design](2026-10-15-liwan-ai-design.md) (phase 1, merged). This document amends that spec where stated in §11; the amendments are applied to the 2026-10-15 file in the same change that implements them, so one reference stays authoritative.

## 1. Intent

LiwanOS AI moves from one chat assistant to a set of agents that know the company and each employee:

- a **specialized agent per application** (projects, HR, CRM, ...), each with its own instructions and tools;
- a **core setup agent**, free for every customer, that helps configure the system and every application's settings;
- **long-term memory** of the company's identity and style and of each employee's way of working;
- **knowledge retrieval (RAG)** over the company's records, so an agent answers from real data.

Why: every company has its own identity and tone, and every employee their own style. An agent that forgets everything between conversations, or knows only one application, cannot serve that. The setup agent lowers the cost of onboarding a customer, which serves the product goal of reducing the total cost of running a company.

A second driver is tenant isolation. Today the AI service keeps all tenants' conversations in one shared Postgres database in the shared SaaS model, separated only by a `tenant` column in application code. That contradicts the architecture rule in `AGENTS.md` ("database-per-tenant, no shared-database tenant layer"). This design fixes it before memory and RAG add more tenant data to the service.

## 2. Goals

1. All AI state of a tenant (runs, checkpoints, memory, RAG index) lives inside that tenant's own database.
2. The AI never reads Odoo tables directly. All company data reaches a model only through named tools executed by the Nuxt server with the user's own session.
3. An agent never sees more than its user can see in the UI; it may see less.
4. Company administrators control every agent from settings, within fixed platform limits, enforced on the server.
5. A new application joins the AI by declaring one file; nothing else needs to remember to change.
6. Employees can trust that their administrator does not read their conversations.

## 3. Non-goals

- Agents acting in the background without a user session (reminders, daily digests). Later phase; it needs a different authorization model.
- A shared knowledge layer across tenants.
- Replacing LangGraph, the tool executor or the claim-before-write flow of phase 1.
- Payroll operations through AI.

## 4. Anti-goals (a failure even if it works)

- Any path by which one tenant's data, memory or index can be read under another tenant.
- An agent setting that can widen what a user may see or do.
- A permission check that exists only in the model's instructions.
- Copies of company record text accumulating in the AI schema.
- A model provider outside Saudi Arabia receiving a tenant's data without that tenant's signed consent.

## 5. Current state (verified 2026-11-04)

- `liwan_ai` (rank 3): tool registry `liwan.ai.tool.registry`, audit `liwan.ai.audit`, usage `liwan.ai.usage`, routes `/api/v1/ai/{tools,audit,usage}`, capability `ai.use`, features `ai.enabled`, `ai.messages.monthly`, `ai.tool_calls.per_run`. No `sudo()`.
- `liwan_pmo_ai`: the only tool provider (4 read, `pmo.update_task_state` write_light, `pmo.draft_project` draft).
- Nuxt `server/utils/ai/*`: runs the tools with the request cookie; counts the message before reaching the service.
- `apps/ai-service`: FastAPI + LangGraph; one Postgres database per deployment (`ai_runs`, LangGraph checkpoint tables keyed by `run_id`); owner from `x-liwan-tenant`/`x-liwan-user`; `AI_SERVICE_TOKEN` optional (service accepts any caller when unset, `service.py:395`); provider, model and key are deployment-wide environment variables.
- `deploy/provision.sh:141-145` revokes CONNECT on every tenant database from the `liwan_ai` role.

## 6. Decided architecture

### 6.1 AI state inside the tenant database

- Each tenant database gets a schema `liwan_ai`. Every table holding tenant content moves there: runs, checkpoints, memory, RAG index. The run table loses its `tenant` column: the database is the tenant.
- Release control state that holds no tenant content (`ai_state_schema` with the deployment `state_id`, and `ai_generations` draining flags) stays in the small service database `liwan_ai`, so the blue/green release coordinator keeps one `sharedStateId`.
- The service maps a tenant to its database from the deployment, never from a request: dedicated reads one `AI_TENANT_DATABASE`; shared reads the same read-only tenant registry the guard and Nuxt read (`LIWAN_TENANT_REGISTRY_PATH`, `targets[].tenantId -> database`). An unknown tenant is refused.
- Postgres role `liwan_ai`: CONNECT on tenant databases; USAGE and CREATE on schema `liwan_ai` only; no privilege on `public` or any Odoo table. This replaces the CONNECT revoke in `provision.sh`.
- The service selects the connection by `owner.tenant` (database name validated against a strict pattern; never interpolated unvalidated), with `search_path=liwan_ai` and a bounded per-database pool that closes idle connections.
- Migrations, the blue/green release fencing and the retention job run per tenant database.
- Dedicated and sovereign deployments: the same code with one database.
- Consequence: tenant backup, restore and deletion include AI state with no separate path.

### 6.2 Access to company data

- Only through tools in `liwan.ai.tool.registry`, executed by the Nuxt server with the caller's cookie; Odoo applies capabilities, record rules and the current company.
- Tool kinds stay as in phase 1: `read` runs directly; `write_light` runs only after the user approves in the chat; `draft` prefills the real page and the user submits and attests.

### 6.3 Knowledge retrieval (RAG)

- The index in `liwan_ai` stores vectors and record references only (`model`, `res_id`, `company_id`, chunk number). It never stores record text.
- Query flow: the service finds candidate references by vector similarity; the Nuxt server sends them to an Odoo route (e.g. `/api/v1/ai/knowledge/resolve`) with the user's session; Odoo returns chunk text only for records the user can read, rebuilt from the source record; the model sees only those.
- Indexing: Odoo emits change events for indexed sources; the service chunks and embeds with the tenant's provider (local embedding model in sovereign deployments). Deleting a record deletes its vectors. Permission changes need no reindex.
- Which models are indexable is declared by each application (§6.6). Fields behind `hr.payroll.*`, bank data and private contact data are never indexed.
- Requires the `pgvector` extension in the deployment's Postgres image (to verify before work starts).

### 6.4 Memory

- **Employee memory:** the employee's style and preferences, keyed by tenant and user, in `liwan_ai`. Only that employee sees it; the employee can view and delete it. Contains references, never record copies.
- **Company memory:** identity, tone, terminology, per company inside the tenant. Proposed by agents, used only after an administrator approves it.

### 6.5 Agents

- New `liwan.ai.agent.registry` (composed through `super()` like the tool registry). Each agent: key, owner addon, instructions, its tools, RAG sources, sensitive fields.
- Each application registers its agent in its `liwan_<app>_ai` bridge (rank 5, auto_install), keeping R3.
- **One smart conversation (owner decision 2026-11-04):** the user talks to one conversation, in `/ai` and in the header sheet. A router inside the run picks the specialist agent for each request and hands over between agents automatically within the same run; the user does not choose an agent. The current page is a routing hint, not a restriction. Each specialist uses its own app's tools plus the read tools of other apps the user can use; a write in another app is performed by that app's specialist after the same approval. The monthly message limit counts user messages, not agent turns.
- Agents and their tools exist only for applications the tenant has enabled (`<app>.enabled` entitlement); a disabled application contributes no agent, tool, setting or RAG source.
- **Settings registry (owner direction 2026-11-04):** a new registry where each application declares its settings (key, type, allowed values, default, scope, impact text, required capability), composed through `super()`. Only enabled applications appear. The first release covers the applications that declare; the rest join as they are touched, and `tools/new_app.py` generates the declaration.
- **Setup agent** (`core.setup`, owned by `liwan_ai`): reads the settings registry of the enabled applications, proposes changes showing current value, new value and impact, and applies a change only after approval by a user holding that setting's capability. Roles and permissions: proposes only, never applies. Always runs on the platform provider, outside package message and token limits, against a vendor-managed budget; on the local model in sovereign deployments.

### 6.6 One file per application

A new application declares, in `liwan_<app>_ai`: its agent, its tools, its RAG sources and its sensitive fields. `tools/new_app.py` generates this bridge with a ready test proving that a user without the capability neither sees nor runs the tool. A CI check fails on a tool without a registered capability, a route that does not exist, or a sensitive field appearing in a `result_summary`.

### 6.7 Control: two layers

**Platform constants (code, not settings):**
- never beyond the user's own permissions; never another tenant;
- no delete tools; no granting roles or permissions;
- no individual payroll, bank accounts or private phone numbers;
- every write needs a human approval; when any content from an external source (a customer message, an uploaded file, an inbound email) is in the run's context, every write tool needs approval regardless of the administrator's per-tool setting;
- the AI never executes code; if code execution is ever added, it runs only in a per-run isolated sandbox (gVisor or Firecracker class) with no network and no database access, destroyed after the run;
- administrators see agent actions (tools called, approvals, changes), never conversation text; employees are told so in `/ai`.

**Administrator settings (can only narrow), per agent:** enabled; which roles may use it; each tool: allowed, read only, needs approval, off; RAG sources; memory on/off; style instructions; monthly messages per user within the package; sensitivity switches (payroll aggregates for payroll-capable users, project finance visibility). General: provider, model, retention, data residency.

Enforced on the server: tools turned off are never sent to the model and are refused by the executor if requested. Managed by a new capability `ai.settings.manage`; every change is audited. Scope: enablement, provider, limits and privacy per tenant; style, identity and company memory per company.

### 6.8 Provider, residency and cost

- Per tenant: platform provider (default) or the tenant's own key. The key is written encrypted into the tenant's `liwan_ai` schema with a deployment encryption key, write-only (only `configured` and the last 4 characters are returned), set through a Nuxt route that first checks `ai.settings.manage` in Odoo. A failing tenant key is reported; the service never falls back silently to the platform key.
- **Platform provider and liability (owner decision 2026-11-04):** the platform provider is an international provider, so the AI, including the free setup agent, stays off for a tenant until an authorized user signs the residency acknowledgement and liability disclaimer below. Liwan's responsibility for data leaving the Kingdom is disclaimed by that signed consent. A provider inside Saudi Arabia (a model on Oracle Jeddah or a Saudi vendor) may be added later as a platform option that needs no consent. Sovereign deployments use their local model and need no consent. Which international provider is used is an operator choice.
- Data residency per tenant, default "inside Saudi Arabia only". Each provider in `provider_registry.py` carries its processing location. Allowing a provider outside the Kingdom requires an acknowledgement and liability disclaimer signed digitally by an authorized user; the signer, time, text version and its hash are stored. A new text version voids the consent and returns the setting to "inside" until signed again.
- Monthly token limit `ai.tokens.monthly` and a per-run output token cap, on the platform provider only; checked before a run starts (a tenant may exceed by at most one run). Tenants on their own key keep the message limit only.

### 6.9 Other decided policies

| Topic | Decision |
|---|---|
| Service token | `AI_SERVICE_TOKEN` mandatory outside explicit development mode; compose fails without it; `deploy/provision.sh` generates it (and `AI_DB_PASSWORD`) into `deploy/.env` (mode 600) when empty, never prints it, never rotates an existing one. One token per deployment, shared by Nuxt and the AI service; it is not a tenant identity |
| External channels (WhatsApp, email) | Per channel setting; default "draft only": the agent prefills the channel page, the employee sends |
| Employee leaves | Employee memory deleted at once; conversations after a configurable period, default 30 days |
| Monitoring | Short dashboard: usage per agent and user, bell alert at 80% of a limit, most used tools; actions only, no text |
| Chat attachments | For the conversation only, deleted with it, never in RAG; saved to a project or documents only on the user's request through that app's flow and permissions; type and size limits per tenant; scanned for malware before any use (see §9) |
| Multiple companies in one tenant | Enablement, provider, limits, privacy per tenant; style, identity, company memory per company |

### 6.10 Calls made by the design author (owner to check)

- **Schema bootstrap:** a privileged provisioning step (`deploy/provision.sh` and the operator `tenant.create` in `tools/liwan_cli/operator.py`, never the control plane) creates schema `liwan_ai` and its grants (and later `pgvector`), then runs the service's explicit operator bootstrap for that database. The runtime keeps its existing rule: it validates state and never runs DDL. The retention job and release readiness iterate the tenant databases from the same tenant directory the service uses.
- **Indexing identity:** Odoo builds index text with a dedicated technical user that holds read ACLs on the declared indexable models only; no `sudo()`. Only fields an application declares indexable are sent. Embedding calls obey the tenant's data residency setting like chat calls.
- **Odoo to service events:** one durable outbox in the tenant database (`liwan_ai` schema), written by Odoo and drained by the service, carries both index changes and user deactivation; employee memory deletion uses it.
- **Encryption key:** an operator secret per deployment, versioned; each ciphertext stores its key id; rotation re-encrypts; restoring a tenant needs the matching key version, documented in `deploy/OPERATIONS.md`.
- **Setup agent budget:** a per-tenant monthly limit `ai.setup.monthly` in the feature registry, set by the vendor through the package and counted in the tenant database (no control-plane dependency, R5). In `non_saas` it runs on the local model with the same per-tenant limit.

### 6.11 Network egress (owner decision 2026-11-04)

- Finding: in the dedicated compose the `ai` container sits on the default network and can reach any internet host; in the shared compose it sits on internal networks only and cannot reach an external model provider at all.
- Decision: the `ai` container is on internal networks only in every deployment. All outbound traffic goes through an open-source forward proxy (`ai-egress`) that allows HTTPS CONNECT only to an explicit host allowlist (the configured provider hosts) and denies everything else, with each denial logged by host. The AI service uses it through `HTTPS_PROXY`; a local model host (Ollama) is reached on the internal network and listed in `NO_PROXY`.
- Security layers, broad to narrow: region (inside the Kingdom), server (restricted containers), network (egress allowlist), AI service (mandatory token), data (database per tenant, `liwan_ai` schema), tools (user session and approval), model (proposes only). Governance (agent settings, action audit, limits, kill switch) spans all layers.

## 7. Constraints

- `AGENTS.md`: R1–R10, no new `sudo()` without a documented reason, clean pre-release codebase (replace, do not layer: the old shared-database store is removed, not kept beside the new one), configurable policies with explicit settings and server enforcement.
- No paid licenses. Open engines only (pgvector, ClamAV, local models).
- R8: every feature works in `saas` and `non_saas`.
- Arabic default, RTL, locale keys for all strings.

## 8. Left to the builder

- Exact table layouts, chunking strategy and embedding model choice.
- Connection pool sizes and idle timeouts.
- The Odoo change-event mechanism for indexing (queue model, cron, or bus).
- UI layout of the settings and monitoring pages, following DESIGN.md and Storybook.
- Order of applications for new tools, starting with tasks, HR, CRM, meetings, finance (read only first), operations.

## 8a. Delivery phases (owner decision 2026-11-04)

Each phase is one PR, independently mergeable and releasable:
1. **Isolation:** mandatory service token generated by provisioning; AI state moved to schema `liwan_ai` in each tenant database; the shared store removed; egress gateway.
2. **Settings, provider and limits:** general AI settings, tenant key, residency with signed consent, token limit, monitoring dashboard.
3. **Agents and tools:** agent registry, router, one file per application, `new_app.py` and CI check, agent settings page, tools for the enabled applications, external channel policy.
4. **Memory and setup agent:** employee and company memory, settings registry, setup agent and its limit, employee offboarding.
5. **Knowledge:** pgvector image change, indexing outbox, RAG resolve route, chat attachments (needs the platform malware scanner).

## 9. Related work outside this design

Recorded as separate problems in `.scratch/` because they are not AI-specific:
- No malware scanning exists for any upload in the platform. Chat attachments depend on a platform-level scanner.
- The project finance summary route requires only `pmo.projects.read` (`liwan_pmo/controllers/project_finance.py:30`), so every project member sees budget and spend.

## 10. Open items

- Legal text of the residency acknowledgement and disclaimer: to be drafted by a legal specialist.
- Default values proposed in discussion and not yet explicitly confirmed: setup agent applies with approval; company memory needs admin approval; employee memory saved automatically and deletable; payroll aggregates off by default; project finance visible to project manager and finance by default.

## 11. Amendments to the 2026-10-15 spec

- §2 "Providers": per tenant setting (§6.8), not deployment-wide only.
- §2 "Memory and knowledge" and §3.2 "Memory": long-term memory and RAG as in §6.3–6.4.
- §5 "never does": settings changes are allowed to the setup agent with approval (§6.5); the rest stands as platform constants.
- §8 "shared model: one service, isolation by tenant in state": replaced by §6.1.
