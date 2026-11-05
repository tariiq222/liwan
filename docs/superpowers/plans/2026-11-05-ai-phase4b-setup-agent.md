# AI phase 4b: settings registry and setup agent — implementation plan

**Goal:** a free setup assistant that reads the settings of the tenant's enabled applications, proposes changes with
their current value, new value and impact, and applies one only after a user who may change it approves.

**Spec:** [2026-11-04 LiwanOS AI agents](../specs/2026-11-04-liwan-ai-agents-design.md) §6.5 (settings registry, setup
agent), §6.10 (setup budget `ai.setup.monthly`), §10 (default: the setup agent applies with approval).

## Global constraints

- Settings only through each application's own settings model, as the caller, with its ACLs and constraints; no `sudo()`.
- Roles and permissions are never settings of the registry: the setup agent may suggest them in words, never apply them.
- The setup agent runs on the platform provider, outside the package's message and token limits, against the
  vendor-set monthly limit `ai.setup.monthly`; it still needs the residency consent when that provider is outside.

## Decisions made by the builder (owner to check in the PR)

1. A setting is declared as one field of an application's settings model (`model`, `field`) with its type
   (`selection`, `boolean`, `integer`), allowed values or bounds, scope (`tenant` or `company`), capability, label and
   impact text. Reading and writing are generic over the LiwanOS settings pattern (`_liwan_current()`, `revision`,
   one row per company or one tenant row), so a declaration needs no code. Settings that expand into several fields
   (sector presets) stay on their own pages in this release.
2. Keys are `<app>.<field>`; the registry checks at load that the field exists with the declared type and options.
3. A tenant-scoped setting needs its capability in the root company (as the AI settings do); a company-scoped one in
   the current company. Each application is declared in its own bridge (`liwan_<app>_ai`); this release declares the
   AI policy (`liwan_ai`) and three CRM policies (`liwan_crm_ai`).
4. The setup agent is registered by `liwan_ai` itself (key `ai`) with two tools: `ai.list_settings` (read) and
   `ai.apply_setting` (write: always waits for the user's approval). Every apply is written to the access audit.
5. A setup conversation is a run in `setup` mode, opened from the AI settings page: only the setup agent and its tools,
   always the platform provider, its user messages counted as `setup` audit rows against `ai.setup.monthly`, and its
   provider calls recorded with purpose `setup`, outside the monthly token limit.

## Tasks

1. **Odoo `liwan_ai`** — `liwan.ai.setting.registry`, routes `GET /api/v1/ai/setup/settings` and
   `POST /api/v1/ai/setup/settings/<key>`, setup agent and tools, `?mode=setup` on the tools route, audit kind
   `setup`, usage `purpose`, limit `ai.setup.monthly` in the feature registry and the catalog. `liwan_crm_ai` declares
   its settings.
2. **AI service** — nothing new: the setup agent is an ordinary agent; the request names the platform provider.
3. **Contracts and Nuxt** — `mode` on the start request; the session reads the setup catalog; the message audit and the
   usage rows carry the mode; the policy forces the platform provider in setup mode.
4. **UI** — a "setup assistant" entry on the AI settings page opening `/ai?mode=setup`; the limit notice for
   `setup_monthly`.

## Review focus

- No setting can be applied without its capability in the right company, or for an application the tenant lacks.
- A value outside the declared options or bounds is refused before any write.
- Setup messages never consume the package's messages or tokens, and normal runs never use the setup budget.
- A normal conversation never offers the setup tools; a setup conversation offers nothing else.
