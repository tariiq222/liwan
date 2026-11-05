# AI phase 4a: employee memory, company memory and offboarding — implementation plan

**Goal:** the assistant remembers each employee's way of working and each company's identity and tone, under the
employee's and the administrator's control, and forgets a leaver.

**Spec:** [2026-11-04 LiwanOS AI agents](../specs/2026-11-04-liwan-ai-agents-design.md) §6.4, §6.7 (memory on/off per
agent), §6.9 (employee leaves), §6.10 (Odoo to service events), §10 (defaults). Phase 4b (settings registry and setup
agent) has its own plan.

## Global constraints

- All memory lives in the tenant database, schema `liwan_ai`; the service never reads an Odoo table.
- Memory holds short notes about style and preferences, never copies of company records.
- Employee memory: only its owner sees it; saved automatically, viewable and deletable by the owner (spec §10 default).
- Company memory: proposed by an agent, used only after a settings manager of that company approves it (spec §10 default).
- No `sudo()`; R3/R4 unchanged; clean codebase rules.

## Decisions made by the builder (owner to check in the PR)

1. One table `ai_memory` with a `scope` (`user` or `company`) instead of two tables of the same shape.
2. Notes are at most 300 characters; at most 20 notes per employee and 20 approved notes per company reach a prompt.
   A full employee memory refuses a new note (the model is told) rather than silently dropping an old one.
3. Two in-graph tools, offered only while the active agent's memory is on: `liwan_remember` (employee note, saved at
   once) and `liwan_propose_company_note` (company note, waits for approval). They are never audited as tool calls.
4. The coordinator's memory is always on; each specialist follows its agent setting `memory` (default on).
5. Offboarding goes through an outbox table `ai_outbox` in schema `liwan_ai`. Odoo inserts `user_deactivated` /
   `user_reactivated` when a user's `active` changes (only `INSERT` is granted to Odoo's database role, by the
   service's tenant bootstrap). The service drains it before every run and in the retention sweep: a leaver's memory
   is deleted at once; their conversations after `leaver_retention_days` (default 30, 0 to 365, tenant setting on the
   retention card); a reactivation before then keeps them.
6. The tenant bootstrap creates the new tables idempotently even on an existing schema, so upgrading is re-running
   `--initialize-tenant`; the runtime refuses a schema without them (`ai_state_incompatible`).
7. The employee manages memory on `/ai/memory`; company memory is a card in the AI settings page.

## Tasks

1. **AI service** — `memory.py` (store protocol, memory and Postgres stores, outbox drain), bootstrap tables and
   grants, `leaver_retention_days` in `ai_tenant_config`, graph tools and prompt sections, routes
   `/v1/memory`, `/v1/company-memory`, `/v1/tenant/config/leaver-retention`, sweep of leavers' runs.
2. **Odoo `liwan_ai`** — `memory` on agent settings and agents, `res.users` outbox events, route
   `POST /api/v1/ai/company-memory/authorize` (settings manager of the current company).
3. **Contracts and Nuxt** — company id and agent memory on runs; memory routes; company memory routes authorized by
   Odoo first; leaver retention route.
4. **UI** — `/ai/memory` page, company memory card, memory switch on the agent card, leaver days on the retention card.

## Review focus

- One employee can never read or delete another's notes (owner from the service headers, never from the body).
- A company manager sees and approves only their own company's notes.
- A proposed company note never reaches a prompt before approval.
- Odoo writes nothing when the AI schema is absent (deployments without AI, tests).
- Deactivating a user deletes their memory before their next run could read it.
