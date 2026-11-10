# LiwanOS AI plans, trial allowance, task router and conversation cost

Status: owner decisions taken in discussion on 2026-11-10. Nothing in this document is implemented in any branch. Cost figures in §4 are one local measurement plus estimates, and each is marked.

Builds on: [2026-11-04 LiwanOS AI agents](2026-11-04-liwan-ai-agents-design.md). It replaces that spec's monthly token limit (§6.8) and its deferred model routing (§6.14); see §9.

## 1. Intent

Tenants get three ways to use the assistant, and the vendor keeps the cost of each under control:

1. Free help and setup agents on the vendor's provider (exists; budget `ai.assist.monthly`).
2. Paid AI plans on the vendor's provider, sold as a number of messages with a weekly and a monthly limit.
3. The tenant's own provider key (exists; consumes no plan messages).

A task router sends each message to the cheapest model that suits it, and long conversations stop resending their whole history.

## 2. Owner decisions (2026-11-10)

| # | Decision |
| --- | --- |
| D1 | Build both the paid plans and the tenant's own key. Own key stays as it is. |
| D2 | Paid plans ship before the launch target (2026-12-06). |
| D3 | The customer sees messages only: no currency amount and no "credit" wording in the usage display. One user message counts as one. |
| D4 | One pool per company, with a monthly allowance and a weekly limit inside it. |
| D5 | The AI plan is not part of the packages shown at sign-up or on the plan-change page. It is bought from inside the product. |
| D6 | When a limit is reached the paid assistant stops until the window resets or the tenant upgrades. Help and setup agents keep working; the tenant's own key remains an alternative. |
| D7 | Four plans named Start, Pro, Max and Ultra (ستارت، برو، ماكس، ألترا). |
| D8 | A trial allowance during the first 14 days that renews every 5 days, so a new tenant can try the strong models. After the trial the tenant falls back to the permanent free allowance, which the vendor sets and may set to zero. |
| D9 | Build the full task router now, controlled from the vendor's provider panel. |
| D10 | Long conversations are handled by summarising old history, shortening old tool results, provider prompt caching and a "start a new conversation" prompt. |

Defaults chosen by the design author, open to the owner (§7): annual billing rule, weekly share, cost unit, classification call accounting.

## 3. Current state (verified 2026-11-10)

- Limits `ai.messages.monthly`, `ai.tokens.monthly`, `ai.assist.monthly`, `ai.tool_calls.per_run` are registered in `odoo-addons/liwan_ai/models/feature_registry.py`. Enforcement is hand-written with a UTC calendar month in `ai_audit.py` and `ai_usage.py`, repeated in `liwan_ai_notify/models/limit_warning.py`. No weekly or other window exists.
- The platform provider is one provider and one model: `apps/ai-service/src/liwan_ai_service/platform_provider.py`, table `ai_platform_provider` (`apps/control-plane/src/schema_032.sql`), page `apps/vendor-admin/app/pages/ai-provider.vue`.
- The model is chosen once per request in `run_model_for` (`service.py`) and invoked in one place, the `plan` node (`graph.py`). Call kinds are `plan` and `title`.
- No price or cost exists anywhere. No provider prompt caching. The service never shortens history; the only guard is the per-request input ceiling, which stops the run.
- Chat attachments are not supported (2026-11-04 spec §6.9 keeps them out until the malware scanner exists).
- Commerce: one subscription per customer with one cadence (`subscriptions.customer_id` unique). Priced quantities (users, storage, branches) are hard-wired on `plan_revisions`, quoted in `packages/commercial-contracts/src/commercial/quotes.ts`, compiled to entitlements in `entitlements.ts`, and delivered to `liwan.tenant.profile.features`. AI limits are plan-level values no customer can buy.
- The development database holds no AI usage rows, so there is no real usage to measure yet.

## 4. Cost: what is measured and what is estimated

Measured locally on 2026-11-10 from the tool registry of the development database (21 tools, 9 agents), counted with the `o200k_base` tokenizer:

| Part sent with every model call | Tokens |
| --- | --- |
| System prompt, Arabic | 1,075 |
| Tool schemas | 2,425 |
| Fixed prefix including the handoff and memory tools | about 3,700 |

Other providers tokenize differently, and the prefix grows as applications add tools.

Estimated, not measured: a conversation of 30 messages with a 10-page document (about 8,000 tokens) kept in history, 60% of messages using one tool. Prices are assumptions taken from third-party comparisons, not official price pages: a cheap model at 0.12 / 0.35 USD per million input / output tokens, a mid model at 3 / 15, 3.75 SAR per USD.

| Case | Conversation cost | Per message |
| --- | --- | --- |
| Cheap model | 0.47 SAR | 0.016 |
| Mid model, no caching | 11.95 SAR | 0.40 |
| Mid model, ideal caching | 1.74 SAR | 0.06 |
| Mid model with §5.7 applied, no caching | about 4.3 SAR | 0.14 |
| Mid model with §5.7 and caching | about 2.6 SAR | 0.09 |
| One isolated message, mid model | 0.11 SAR | 0.11 |

Consequences for the design:

- The mid model costs about 26 times the cheap one, so the share of messages the router sends to the cheap model decides the margin more than any other number.
- Without §5.7 a message inside a long conversation costs about four times an isolated one. Counting plain messages (D3) is only safe once §5.7 exists.
- The plan prices in §5.1 break even at about 0.06 SAR per message. They need the router and §5.7 before launch; they are not optional improvements.

## 5. Design

### 5.1 Plans

Vendor-editable values, never hard-coded. Starting values:

| Plan | Monthly price | Messages per month | Weekly limit |
| --- | --- | --- | --- |
| Start | 29 SAR | 500 | 175 |
| Pro | 99 SAR | 1,500 | 525 |
| Max | 249 SAR | 4,000 | 1,400 |
| Ultra | 499 SAR | 8,500 | 3,000 |

- Prices are fixed for launch. Message counts are provisional until the measurement in slice 12.
- The weekly limit is one vendor-set share of the monthly allowance (35% at launch), so it can never exceed it.
- Monthly allowance = permanent free allowance + plan messages.
- A plan counts only messages of ordinary conversations on the platform provider. Help and setup messages keep their own budget. Messages on the tenant's own key are limited only by the administrator's per-user setting.
- The customer sees the plan name, its price, its message count, and two usage bars (this week, this month) with reset times.

### 5.2 Trial allowance

- For 14 days from the tenant's creation, the tenant gets a vendor-set number of messages per 5-day window (windows start on day 1, 6 and 11).
- The trial runs on the same router as paid plans, so the tenant sees the strong models.
- At the end of the trial the tenant has the permanent free allowance, or the plan it bought. Buying a plan during the trial replaces the trial allowance.
- The seeded free plan carries no commercial trial today, so the trial allowance is anchored to the tenant's creation date. Where that date is read from is settled in slice 6.

### 5.3 Selling

- The plan is a priced selection on the plan revision, bought through the existing quote, order, invoice and fulfilment chain. A second subscription object is rejected: it would duplicate invoices, renewals, dunning and suspension.
- New plan revision data: the permanent free allowance, the trial allowance, the weekly share, and a list of steps (code, Arabic and English name, messages, price per cadence).
- Because a subscription has one cadence, the AI plan follows the main subscription's cadence. An annual subscriber pays the annual AI price up front under the existing catalog rule (pay 10 months, get 12); the allowance still resets monthly and weekly.
- An upgrade takes effect at once and is charged for the remaining period (the existing proration). A downgrade takes effect at renewal.
- Purchase page: `apps/web/app/pages/subscription/ai.vue`, the only location rule R5 allows for customer commerce. `/ai`, the AI settings page and the limit notice link to it and import nothing commercial.
- A tenant with no paid subscription must be able to buy. The proposed path is a zero-priced base plan revision that carries the AI steps; whether the quote and plan validators accept it is the first task of slice 7.
- Non-payment suspends the whole tenant today, and the AI plan shares that. A lock for the AI plan alone is out of scope.

### 5.4 Limits and enforcement (Odoo)

- Remove `ai.tokens.monthly` everywhere. Add `ai.messages.weekly` and the trial allowance key. `ai.messages.monthly` becomes a value derived by the entitlement compiler, like `users.limit`.
- One window helper in `liwan_platform` returns the start and reset time of the month, the week and the trial window in the company timezone. Month starts on the 1st. Week starts on Sunday and is clipped to the month start, so a weekly stop in the last days of a month does not carry into the next one. The three hand-written month starts are replaced by it.
- The pre-run check in `ai_audit.create` tests the applicable windows. A refusal carries which window stopped the run and when it resets.
- The policy sent with each run and the limits route drop the token fields and carry the message counts, limits and reset times.
- Warnings at 80% and 95% cover both windows, with the window start in the dedupe key.
- Per-request guards stay: output cap, input ceiling, tool calls per run.

### 5.5 Task router

- Unit: one classification per user message. The whole tool loop of that message stays on one model, so a tool call and its result never cross providers.
- Capabilities, each tied to what the agents do: `quick` (greetings, simple lookups, help and setup, titles, classification), `standard` (ordinary multi-tool work; also the fallback), `analysis` (numbers, comparisons, reports), `writing` (long Arabic or English text, translation).
- Classifier: one `route` call on the `quick` model with the last user message, the active agent and the previous capability; no history and no tools. One attempt with a short timeout. Any failure selects `standard`, never a failed run.
- No classification call when it cannot change the outcome: setup and help runs use `quick`, titles use `quick`, own-key runs have one model, and a vendor who maps only a default model gets no extra call. The last case is the kill switch and the shape of a dedicated single-model install.
- The capability is stored in the run state as a plain string and reset on each new message. The model object never enters state.
- Vendor mapping: several providers with their keys, a list of models with input and output price per million tokens, and a map from capability to model with a required default. The singleton table, the single-model file and the single-model page are replaced in place. An invalid model entry is dropped and its routes fall to the default; only a structural error or a bad default rejects the file, and then the last valid configuration stays.
- Fallback: when the routed model exhausts its retries on a transient provider error, one attempt runs on the default model and the rest of that message stays on the default.
- Egress: the hosts of every configured provider are published for the allowlist proxy.
- History portability: a pure function normalises checkpointed history before every model call (plain text plus tool calls, provider metadata dropped, tool-call ids remapped where a provider would refuse them). The checkpoint is not rewritten. This is the riskiest part of the design and is built first.

### 5.6 Cost recording (vendor only)

- Every model call records its capability and an integer cost computed in the AI service from the vendor's prices. One cost unit is 0.00001 USD. A price entered in USD per million tokens is first converted to units per million tokens (`price × 100,000`, an integer), then `cost = ceil((input_tokens × input_units + output_tokens × output_units) / 1,000,000)`. Example: 1,000 input tokens at 3 USD per million cost 0.003 USD and are stored as 300 units. A call with no reported tokens or no price stores no cost.
- The cost is for the vendor: what each tenant cost against what it paid, and calls, tokens and cost per capability and model. It never appears to the customer and takes no part in limits.
- Wire changes reach all three strict contract copies (service, `packages/contracts`, Odoo `liwan.ai.usage`) in one release.

### 5.7 Long conversations

1. Rolling summary. The last few exchanges stay verbatim; older ones are replaced by a short summary written by the `quick` model. It runs in batches (about every 10 messages), not on every message, so the cached prefix survives between batches.
2. Old tool results are replaced by a one-line stub once the model has answered from them. The model reads again through the tool when it needs the data, which the existing rule "you know nothing except through tools" already requires.
3. Provider prompt caching: a stable order of rules, tools and summary, with the volatile parts after them, and cache markers where the provider needs them. The cost formula in §5.6 needs the cached-input price before caching is switched on, or it overstates cost.
4. After a set length the conversation offers "start a new conversation", carrying the summary over.

Attachments, when they are built, do not enter history: the file text is extracted once, indexed, and only the passages relevant to each question are sent, through the existing `retrieve` step. Attachments stay out of launch scope and keep their malware-scanner prerequisite.

### 5.8 Customer-hosted and dedicated (`non_saas`)

- Limits come from the operator's local policy; an unset limit is unlimited.
- The purchase page and every upgrade action are hidden. The stopped state says to contact the administrator.
- A single-model platform file stays valid: every capability falls to the default.

## 6. Delivery slices

One owner per file; a slice that shares a file with an earlier one merges after it.

| # | Slice | Depends on | Launch |
| --- | --- | --- | --- |
| 1 | Portable history, with a cross-provider test matrix and one live two-provider check | none | yes, first |
| 2 | Usage wire: capability and cost on every call (service, web, Odoo) | none | yes |
| 3 | Platform file with several models, per-request model map, egress hosts | 2 | yes |
| 4 | Classifier and fallback | 1, 3 | yes |
| 5 | Control plane provider tables and routes; vendor provider page | 3 | yes |
| 6 | Odoo message limits: weekly and trial windows, window helper, policy, warnings; `ai.tokens.monthly` removed | none | yes |
| 7 | Commerce: AI steps on the plan revision, quote line, entitlements, renewals; free-tenant purchase check first | none | yes |
| 8 | Vendor plan form: allowances, weekly share, steps and prices | 7 | yes |
| 9 | Customer UI: purchase page, usage bars, stopped state | 6, 7 | yes |
| 10 | Rolling summary, tool-result stubs, new-conversation prompt | 4 | yes |
| 11 | Prompt caching and the cached-input price | 10 | yes |
| 12 | Cost measurement on the chosen models with long conversations; final message counts | 4, 10, 11 | yes, owner gate |
| 13 | Vendor cost report per tenant, capability and model | 2 | after launch |
| 14 | Attachments through retrieval | scanner | after launch |

Slices 1, 2, 6 and 7 start in parallel. If time runs short, the router ships with only a default model mapped and the mapping is switched on afterwards with no code change.

## 7. Open items

| Item | Default in this document |
| --- | --- |
| Annual subscribers and the AI plan | Follows the subscription cadence, pay 10 months and get 12 |
| Weekly share | 35%, one value for all plans |
| Cost unit | USD, as providers publish prices |
| Classification call | Counted in the vendor's cost; never counted as a customer message |
| Mid-month purchase | Full month's allowance for the prorated price |
| Final message counts | Set after slice 12 |
| Tenant with no paid subscription buying a plan | Zero-priced base plan revision, to verify in slice 7 |
| Source of the tenant creation date for the trial | To verify in slice 6 |

## 8. Risks

- Switching provider between messages on provider-shaped history has no tests today. Slice 1 exists to remove this risk before anything depends on it.
- A cheap model may call tools badly across a growing catalog. An offline evaluation on real prompts per capability comes before any mapping is switched on.
- A summary can drop a number or a name. The tool-first rule limits the damage; slice 10 tests that the model reads again instead of answering from the summary.
- Plan prices assume most messages reach the cheap model and caching works. If slice 12 shows otherwise, the message counts change, not the prices.
- Twelve slices before 2026-12-06 next to the rest of the launch scope. The kill switch in §5.5 keeps the launch independent of the router mapping.

## 9. Amendments to the 2026-11-04 spec

- §6.8: the monthly token limit `ai.tokens.monthly` is replaced by the message limits of §5.4 here. The per-run output cap stays.
- §6.14: model routing is no longer deferred; §5.5 here is the design. Routing is per message, with four capabilities, instead of per step.
- §6.9, chat attachments: unchanged, with the added rule in §5.7 that an attachment never enters conversation history.
