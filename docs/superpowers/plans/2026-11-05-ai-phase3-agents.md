# AI phase 3: agents and tools — implementation plan

**Goal:** one smart conversation that routes each request to a specialist agent per application, under administrator settings that can only narrow what an agent does.

**Spec:** [2026-11-04 LiwanOS AI agents](../specs/2026-11-04-liwan-ai-agents-design.md) §6.5–6.7, §6.9 (external channels, monitoring), §8a phase 3.

**Architecture:** Odoo `liwan_ai` owns the agent registry, the agent and tool settings and their enforcement in the catalog it returns from `/api/v1/ai/tools`. The AI service receives the agents with the tools and runs one graph whose active agent changes through an in-graph hand-off. Nuxt passes the agents through, forwards approval-gated reads to the browser like writes, and audits the active agent with each tool call.

## Global constraints

- R2/R3/R10: each application declares its agent and tools in its own `liwan_<app>_ai` bridge (rank 5, `auto_install`); `liwan_ai` names no application.
- No `sudo()`. Settings writes require `ai.settings.manage` held in the tenant's root company (as in phase 2).
- Administrator settings only narrow: no setting can add a tool, a capability or a record the user cannot reach.
- Platform constants stay in code: every write needs approval; no delete tools; sensitive fields never appear in a `result_summary`.
- Clean codebase: replace in place, no compatibility paths.

## Decisions made by the builder (owner to check in the PR)

1. **Agent key = application id** (`pmo`, `hr`, …), the same prefix tools already carry; an agent's tools are the tools of its owner, so there is no second list to keep in sync.
2. **Coordinator `core`** is a platform agent defined in the AI service (instructions are platform constants). It holds the read tools of every agent plus the hand-off; it starts a run when the current page matches no agent.
3. **Hand-off** is a synthetic tool `liwan_handoff` executed inside the graph (no interrupt, no audit row, no tool-call budget); at most 3 hand-offs per request.
4. **Specialist tool set:** its own tools of every kind + the read tools of the other agents + the hand-off. A write of another application happens only after a hand-off to its owner.
5. **Tool modes:** `on` (default), `approval`, `off`. `approval` on a read tool sends it to the browser for confirmation like a write; on a write it is the platform default anyway. "Read only" is an agent switch that drops the agent's write and draft tools.
6. **Per-user monthly messages** is a general setting (`messages_per_user_monthly`, 0 = no per-user cap): the user does not choose an agent, so a per-agent message count has no meaning.
7. **External channels:** a tool that reaches an outside party declares `external: True` (must be `write_light` or `draft`). General setting `external_send` = `draft_only` (default) removes external `write_light` tools from the catalog; `approve` keeps them under approval.
8. **Roles per agent:** empty = every user with `ai.use`; otherwise the user needs an assignment of one of the roles in the current company.
9. **Per-agent monitoring:** audit rows carry `agent_key` (the active agent); the monitoring payload adds counts per agent.

## Tasks

### 1. Odoo agent registry, settings and catalog (`liwan_ai`, version 19.0.1.4.0)

- `models/agent_registry.py`: `liwan.ai.agent.registry` with `_liwan_ai_agent_definitions()` (pure tuple, composed through `super()`); `_liwan_ai_agent_map()` validates key = owner id, feature key, Arabic and English name/description/instructions, `pages` (absolute path prefixes), `sensitive_fields`.
- `models/tool_registry.py`: tools may declare `external`; validation rejects any `result_summary` segment in the platform sensitive list or the owner agent's `sensitive_fields`, and a tool whose owner has no agent. `_liwan_ai_tools_for_user` applies agent enabled, roles, read only, tool mode and external policy; dumped tools carry `agent` and `requires_approval`.
- `models/ai_agent_setting.py` (`liwan.ai.agent.setting`, tenant scope, unique `agent_key`, `enabled`, `read_only`, `role_ids`) and `models/ai_tool_setting.py` (`liwan.ai.tool.setting`, unique `tool_name`, `mode`). A missing row means the default.
- `models/ai_settings.py`: `messages_per_user_monthly`, `external_send`.
- `models/ai_audit.py`: wire key `agent` → `agent_key` (registered agent or `core`); the per-user monthly cap.
- Routes: `/api/v1/ai/tools` adds `agents`; `GET /api/v1/ai/agents` (all agents of enabled applications with their tools and settings, plus assignable roles); `PATCH /api/v1/ai/agents/<key>`; general settings PATCH accepts the two new fields. Monitoring adds `agents`.
- Tests: registry validation, catalog narrowing per setting, roles, routes (403 without capability, root-company rule), per-user cap, catalog test that every installed tool's route exists in the routing map with its method and its capability exists in the capability catalog.

### 2. Application bridges

- `liwan_pmo_ai`: register the `pmo` agent (pages `/projects`, `/tasks`).
- New bridges with an agent and read tools over existing routes: `liwan_hr_ai`, `liwan_crm_ai`, `liwan_meetings_ai`, `liwan_tasks_ai`, `liwan_operations_ai`, `liwan_finance_ai` (finance read only). Registered in `tools/arch_layers.json` (rank 5) and the module lists.
- Each bridge test: a user without the capability neither sees nor runs the tool.

### 3. `tools/new_app.py`

- Templates for `liwan_<app>_ai` (agent + one read tool over the generated records route + the access test); registration of the bridge in `tools/arch_layers.json`.

### 4. AI service

- Contracts: `AgentSpec`; `ToolSpec.agent`, `ToolSpec.requires_approval`; `RunRequest.agents`; tool requests carry `agent` and `requires_approval`; an `agent` stream event on each hand-off.
- Graph: state `agent`, `handoffs`; start agent from the page; per-agent tool set and prompt; `liwan_handoff`.
- Tests: start agent by page, hand-off switches tools, hand-off limit, unknown agent refused, write of another app invisible to a specialist.

### 5. Nuxt and contracts

- Contracts for agents, tool `agent`/`requires_approval`, agent settings, monitoring per agent, general settings fields.
- Session passes agents to the service; pump forwards an approval-gated read to the browser; resume executes it on approval and answers a rejection; audit sends `agent`.
- Settings page: an "Agents" card (enable, read only, roles, tool modes) and the two general fields; monitoring shows per-agent counts; the chat shows which specialist answered.

## Review focus

- A tool turned off or a disabled agent must be refused by the executor even if the service requests it (catalog is per request).
- A read tool in `approval` mode must never run before the browser approves.
- A user without the role of an agent sees none of its tools, including through another agent's read set.
- A hand-off loop must end (limit) and must not consume the tool-call budget.
- Sensitive fields declared by an agent must fail validation at load, not at run time.
