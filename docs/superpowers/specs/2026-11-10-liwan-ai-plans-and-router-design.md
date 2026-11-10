# LiwanOS AI plans, trial allowance, task router and conversation cost

Status: owner decisions taken in discussion on 2026-11-10, then reviewed against the code the same day and corrected. Nothing in this document is implemented in any branch. Cost figures in §4 are one local measurement plus estimates, and each is marked.

Builds on: [2026-11-04 LiwanOS AI agents](2026-11-04-liwan-ai-agents-design.md). It replaces that spec's monthly token limit (§6.8) and its deferred model routing (§6.14); see §9.

## 1. Intent

Tenants get three ways to use the assistant, and the vendor keeps the cost of each under control:

1. Free help and setup agents on the vendor's provider (exists; budget `ai.assist.monthly`).
2. Paid AI plans on the vendor's provider, sold as a number of messages with a weekly and a monthly limit.
3. The tenant's own provider key (exists). Its messages must not consume plan messages; today they still count against the monthly limit, which §5.4 changes.

A task router sends each message to the cheapest model that suits it, and long conversations stop resending their whole history.

## 2. Owner decisions (2026-11-10)

| # | Decision |
| --- | --- |
| D1 | Build both the paid plans and the tenant's own key. Own key stays as it is. |
| D2 | Paid plans ship before the launch target (2026-12-06). |
| D3 | The customer sees messages only: no currency amount and no "credit" wording in the usage display. One user message counts as one. |
| D4 | One pool per tenant, with a monthly allowance and a weekly limit inside it. |
| D5 | The AI plan is not part of the packages shown at sign-up or on the plan-change page. It is bought from inside the product. |
| D6 | When a limit is reached the paid assistant stops until the window resets or the tenant upgrades. Help and setup agents keep working; the tenant's own key remains an alternative. |
| D7 | Four plans named Start, Pro, Max and Ultra (ستارت، برو، ماكس، ألترا). |
| D8 | A trial allowance during the trial that renews every 5 days, so a new tenant can try the strong models. After the trial the tenant falls back to the permanent free allowance, which the vendor sets and may set to zero. |
| D9 | Build the full task router now, controlled from the vendor's provider panel. |
| D10 | Long conversations are handled by summarising old history, shortening old tool results, provider prompt caching and a "start a new conversation" prompt. |
| D11 | An upgrade inside a period gives messages in proportion to the days left. A downgrade takes effect at renewal. |
| D12 | An unpaid AI plan returns the tenant to the free allowance. It never suspends the tenant's account. |
| D13 | A message is not counted when the request fails on LiwanOS's side. |
| D14 | A plan replaces the free allowance: the number the customer buys is the number the customer gets. |

Defaults chosen by the design author, open to the owner (§7): annual billing rule, weekly share, cost unit.

## 3. Current state (verified 2026-11-10)

- Limits `ai.messages.monthly`, `ai.tokens.monthly`, `ai.assist.monthly`, `ai.tool_calls.per_run` are registered in `odoo-addons/liwan_ai/models/feature_registry.py`. Enforcement is hand-written with a UTC calendar month in `ai_audit.py` and `ai_usage.py`, repeated in `liwan_ai_notify/models/limit_warning.py`. No weekly or other window exists.
- The message counter counts every `kind='message'` audit row in the tenant database, across companies and across provider modes. The audit row carries no provider mode, so own-key messages count against `ai.messages.monthly` today (`ai_audit.py`, the check and `_liwan_ai_count_messages`).
- A message is counted in `apps/web/server/api/ai/runs/index.post.ts` before the AI service is reached, so it is counted when the provider or the service fails. A handoff or a resume after an approval adds no count.
- The platform provider is one provider and one model: `apps/ai-service/src/liwan_ai_service/platform_provider.py`, table `ai_platform_provider` (`apps/control-plane/src/schema_032.sql`), page `apps/vendor-admin/app/pages/ai-provider.vue`.
- The model is chosen once per request in `run_model_for` (`service.py`) and invoked in one place, the `plan` node (`graph.py`). Call kinds are `plan` and `title`.
- No price or cost exists anywhere. No provider prompt caching. The service never shortens history; the only guard is the per-request input ceiling, which stops the run.
- Chat attachments are not supported (2026-11-04 spec §6.9 keeps them out until the malware scanner exists).
- Commerce: one subscription per customer with one cadence (`subscriptions.customer_id` unique). Priced quantities (users, storage, branches) are hard-wired on `plan_revisions`, quoted in `packages/commercial-contracts/src/commercial/quotes.ts`, compiled to entitlements in `entitlements.ts`, and delivered to `liwan.tenant.profile.features`. AI limits are plan-level values no customer can buy.
- A lowered quantity reaches the tenant at once; only its price waits for renewal (`quotes.ts` renewal-timed delta, `orders.ts` compiling the entitlement from the requested values). The usage guard on downgrades sees 0 for AI messages, so it never blocks one.
- A renewal re-quotes from the subscription's pinned snapshot and never selects a newer plan revision (`renewals.ts`). Whatever sits on the plan revision is frozen for existing subscribers.
- Non-payment suspends the whole tenant after grace (`renewals.ts` `applyDunning`), while the trial-end rule locks only paid applications and keeps the free base usable (`liwan_platform/tests/test_free_base_after_trial.py`).
- A zero-priced base plan revision is valid and can be quoted and ordered.
- `liwan.tenant.profile` has no creation or trial-start field. Commercial trials are started and extended in the control plane.
- The development database holds no AI usage rows, so there is no real usage to measure yet.

## 4. Cost: what is measured and what is estimated

Measured locally on 2026-11-10 from the tool registry of the development database (21 tools, 9 agents), counted with the `o200k_base` tokenizer:

| Part sent with every model call | Tokens |
| --- | --- |
| System prompt, Arabic | 1,075 |
| Tool schemas | 2,425 |
| Fixed prefix including the handoff and memory tools | about 3,700 |

Other providers tokenize differently, and the prefix grows as applications add tools.

Estimated, not measured: a conversation of 30 messages with a 10-page document (about 8,000 tokens) kept in history, 60% of messages using one tool, about one million input tokens in total. Prices were read on 2026-11-10 from the providers' own pricing pages through a page summariser, so they are second-hand readings: a cheap model at 0.10 / 0.50 USD per million input / output tokens, a mid model at 2 / 10 with cached input at 0.10, and 3.75 SAR per USD.

| Case | Conversation cost | Per message |
| --- | --- | --- |
| Cheap model, nothing applied | 0.40 SAR | 0.013 |
| Cheap model with §5.7 | 0.14 SAR | 0.005 |
| Mid model, nothing applied | 7.97 SAR | 0.27 |
| Mid model with §5.7, no caching | 2.84 SAR | 0.095 |
| Mid model with §5.7 and caching | 1.65 SAR | 0.055 |
| One isolated message, mid model | 0.07 SAR | 0.07 |

Pro plan (1,500 messages for 99 SAR) with 80% of messages on the cheap model and 20% on the mid model:

| Case | Provider cost | Share of price |
| --- | --- | --- |
| Nothing applied | 96 SAR | 97% |
| With §5.7 | 35 SAR | 35% |
| With §5.7 and caching | 21 SAR | 21% |

Consequences for the design:

- The mid model costs about 20 times the cheap one, so the share of messages the router sends to the cheap model decides the margin more than any other number.
- Without §5.7 a message inside a long conversation costs about four times an isolated one. Counting plain messages (D3) is only safe once §5.7 exists.
- Every plan in §5.1 sells a message for 0.058 to 0.066 SAR. With §5.7 and caching, even a tenant whose every message reaches the mid model costs less than it pays. Without §5.7 the plans have no margin.
- Not counted here: payment gateway fees (no official rate card was found), the annual discount (pay 10 months, get 12, which lowers revenue per message by 17%), and the trial and free allowances.

## 5. Design

### 5.1 Plans

Vendor-editable values, never hard-coded. Starting values:

| Plan | Monthly price | Messages per month | Weekly limit (35%) |
| --- | --- | --- | --- |
| Start | 29 SAR | 500 | 175 |
| Pro | 99 SAR | 1,500 | 525 |
| Max | 249 SAR | 4,000 | 1,400 |
| Ultra | 499 SAR | 8,500 | 2,975 |

- Prices are fixed for launch. Message counts are provisional until the measurement in slice 12.
- The weekly limit is derived: one vendor-set share of the monthly allowance (35% at launch), rounded down. It is never typed per plan.
- A plan replaces the permanent free allowance (D14). The monthly allowance of a subscribed tenant is the plan's message count.
- The pool is per tenant database. Splitting it between users is the administrator's existing per-user monthly cap; no new tenant setting is added.
- A plan counts only messages of ordinary conversations on the platform provider. Help and setup messages keep their own budget. Messages on the tenant's own key are limited only by the administrator's per-user cap.
- A message whose run ends in a service or provider failure is not counted (D13). A run the user cancels or a limit stops is counted.
- The customer sees the plan name, its price, its message count, and two usage bars (this week, this month) with reset times.

### 5.2 Trial allowance

- During the trial the tenant gets a vendor-set number of messages per 5-day window, counted from the trial start.
- One clock: the control plane pushes the trial start and end into the tenant profile through the existing revisioned delivery, and the limit check reads only that (R5). A vendor extension of the trial extends the allowance with it.
- During the trial the trial window replaces the weekly and monthly checks, so a permanent free allowance of zero does not block the trial.
- The trial runs on the same router as paid plans. Buying a plan during the trial replaces the trial allowance.
- The seeded free plan carries no commercial trial today. Whether sign-up always opens a trial, or the delivery carries an AI trial period of its own, is settled in slice 6 (§7).

### 5.3 Selling

- The plan is a priced selection on the plan revision, bought through the existing quote, order, invoice and fulfilment chain. A second subscription object is rejected: it would duplicate invoices, renewals, dunning and suspension.
- On the plan revision: the weekly share and the list of steps (code, Arabic and English name, messages, price per cadence). The AI step is added to the quote computation, the current-quote shape, the renewal lines and the subscription snapshot.
- Outside the plan revision: the permanent free allowance and the trial allowance are a vendor-level setting, delivered with the entitlement. A renewal reuses the pinned revision, so anything on the revision cannot be changed for existing subscribers.
- Changing message counts for existing subscribers is a vendor action that moves them to a newer revision. It never lowers the count inside a period the customer already paid for; an annual subscriber keeps its count until renewal.
- Because a subscription has one cadence, the AI plan follows the main subscription's cadence. An annual subscriber pays the annual AI price up front under the existing catalog rule (pay 10 months, get 12); the allowance still resets monthly and weekly.
- Upgrade (D11): charged for the remaining period by the existing proration, and the first allowance is prorated the same way. Without this, a tenant could raise to Ultra with one day left for about 16 SAR, use up to two weekly limits (about 6,000 messages), and lower the plan again every month.
- Downgrade (D11): recorded as pending and applied at renewal. Today a lowered quantity reaches the tenant at once, so the subscription needs a pending AI step.
- Non-payment (D12): an unpaid AI renewal drops the AI step from the entitlement and the tenant returns to the free allowance. The tenant is suspended only for its main subscription, never for the AI step alone.
- Purchase page: `apps/web/app/pages/subscription/ai.vue`, the only location rule R5 allows for customer commerce. `/ai`, the AI settings page and the limit notice link to it and import nothing commercial.
- A tenant with no paid subscription buys through a zero-priced base plan revision that carries the AI steps. Slice 7 tests an AI-only first order on such a tenant, including the rule that a paid first order needs a reachable manager.

### 5.4 Limits and enforcement (Odoo)

- Remove `ai.tokens.monthly` everywhere. Add `ai.messages.weekly` and the trial allowance key. `ai.messages.monthly` becomes a value derived by the entitlement compiler, like `users.limit`. In `non_saas` the operator's local policy sets these keys directly.
- The message audit row stores the provider mode it ran under. Plan limits count platform rows only; a mid-month switch of provider mode changes which rows count from that message on.
- A message row whose run fails on the service or provider side is removed from the count (D13).
- One window helper in `liwan_platform` returns the start and reset time of the month, the week and the trial window in the timezone of the tenant's root company. Month starts on the 1st. Week starts on Sunday and is clipped to the month start, so a weekly stop does not carry into the next month. The clipped week keeps the full weekly limit: at a month boundary up to two weekly limits can be used within a few days, which the monthly allowance still bounds.
- The pre-run check in `ai_audit.create` tests the applicable windows. A refusal carries which window stopped the run and when it resets.
- The policy sent with each run and the limits route drop the token fields and carry the message counts, limits and reset times.
- Warnings at 80% and 95% cover both windows, with the window start in the dedupe key.
- Per-request guards stay: output cap, input ceiling, tool calls per run. The administrator's per-user monthly cap stays.

### 5.5 Task router

- Unit: one classification per user message. The whole tool loop of that message stays on one model, so a tool call and its result never cross providers.
- Capabilities, each tied to what the agents do: `quick` (greetings, simple lookups, help and setup, titles, classification), `standard` (ordinary multi-tool work; also the fallback), `analysis` (numbers, comparisons, reports), `writing` (long Arabic or English text, translation).
- Classifier: one `route` call on the `quick` model with the last user message, the active agent and the previous capability; no history and no tools. One attempt with a short timeout. Any failure selects `standard`, never a failed run.
- No classification call when it cannot change the outcome: setup and help runs use `quick`, titles use `quick`, own-key runs have one model, and a vendor who maps only a default model gets no extra call. The last case is the kill switch and the shape of a dedicated single-model install.
- The capability is stored in the run state as a plain string and reset on each new message. A resume after a tool result or an approval reads it from state and never classifies again. The model object never enters state. New state keys are read with defaults; whether `AI_STATE_VERSION` changes is decided in slice 3.
- Vendor mapping: several providers with their keys, a list of models with input and output price per million tokens, and a map from capability to model with a required default. The singleton table, the single-model file and the single-model page are replaced in place. An invalid model entry is dropped and its routes fall to the default; only a structural error or a bad default rejects the file, and then the last valid configuration stays.
- Fallback: when the routed model exhausts its retries on a transient provider error, one attempt runs on the default model and the rest of that message stays on the default.
- Egress: the hosts of every configured provider are published for the allowlist proxy.
- History portability: a pure function normalises checkpointed history before every model call (plain text plus tool calls, provider metadata dropped, tool-call ids remapped where a provider would refuse them). The checkpoint is not rewritten. This is the riskiest part of the design and is built first.

### 5.6 Cost recording (vendor only)

- Every model call records its capability and an integer cost computed in the AI service from the vendor's prices. One cost unit is 0.00001 USD. A price entered in USD per million tokens is first converted to units per million tokens (`price × 100,000`, an integer), then `cost = ceil((input_tokens × input_units + output_tokens × output_units) / 1,000,000)`. Example: 1,000 input tokens at 3 USD per million cost 0.003 USD and are stored as 300 units. A call with no reported tokens or no price stores no cost.
- The cost is for the vendor: what each tenant cost against what it paid, and calls, tokens and cost per capability and model. It never appears to the customer and takes no part in limits.
- Wire changes reach all three strict contract copies (service, `packages/contracts`, Odoo `liwan.ai.usage`) in one release.

### 5.7 Long conversations

1. Rolling summary. The last few exchanges stay verbatim; older ones are replaced by a short summary written by the `quick` model. It runs in batches (about every 10 messages), not on every message, so the cached prefix survives between batches. The summary is stored in the run state; the checkpointed messages stay complete.
2. Old tool results are replaced by a one-line stub in what is sent to the model, once the model has answered from them. Tool-call ids stay paired. The model reads again through the tool when it needs the data, which the existing rule "you know nothing except through tools" already requires.
3. Provider prompt caching: rules and tools first in a stable order, then the summary, then the volatile parts, with cache markers where the provider needs them. The cost formula in §5.6 needs the cached-input price before caching is switched on, or it overstates cost.
4. After a set length the conversation offers "start a new conversation", carrying the summary over.

Security rules for the summary:

- The summary is written from tool results, which are untrusted record text. It is sent as framed data in the same frame as record text, never inside the system rules, and the summary prompt quotes no instructions.
- Guards that inspect history keep reading the complete checkpointed messages, not the shortened view. The guard that withholds the memory tools once data has been read (`has_read_data`) is the known case.

Attachments, when they are built, do not enter history: the file text is extracted once, indexed, and only the passages relevant to each question are sent, through the existing `retrieve` step. Attachments stay out of launch scope and keep their malware-scanner prerequisite.

### 5.8 Customer-hosted and dedicated (`non_saas`)

- Limits come from the operator's local policy; an unset limit is unlimited.
- The purchase page and every upgrade action are hidden. The stopped state says to contact the administrator.
- A single-model platform file stays valid: every capability falls to the default.

## 6. Delivery slices

One owner per file; a slice that shares a file with an earlier one merges after it. Slices 2, 3 and 4 share `service.py`, `graph.py` and `usage.py` and merge in that order; slice 10 follows slice 4 on `graph.py`.

| # | Slice | Depends on | Launch |
| --- | --- | --- | --- |
| 1 | Portable history, with a cross-provider test matrix and one live two-provider check | none | yes, first |
| 2 | Usage wire: capability and cost on every call (service, web, Odoo) | none | yes |
| 3 | Platform file with several models, per-request model map, egress hosts | 2 | yes |
| 4 | Classifier and fallback | 1, 3 | yes |
| 5 | Control plane provider tables and routes; vendor provider page | 3 | yes |
| 6 | Odoo message limits: provider mode on the message row, weekly and trial windows, window helper, failed messages not counted, policy, warnings; `ai.tokens.monthly` removed | none | yes |
| 7 | Commerce: AI steps in quote, snapshot and renewal; prorated first allowance; pending downgrade; AI-only lapse; vendor-level free and trial allowances; trial dates delivered to the tenant | none | yes |
| 8 | Vendor plan form: weekly share, steps and prices; allowances setting; move subscribers to a revision | 7 | yes |
| 9 | Customer UI: purchase page, usage bars, stopped state | 6, 7 | yes |
| 10 | Rolling summary, tool-result stubs, new-conversation prompt, with the security rules of §5.7 | 4 | yes |
| 11 | Prompt caching and the cached-input price | 10 | yes |
| 12 | Cost measurement on the chosen models with long conversations; final message counts | 4, 10, 11 | yes, owner gate |
| 13 | Vendor cost report per tenant, capability and model | 2 | after launch |
| 14 | Attachments through retrieval | scanner | after launch |

Slices 1, 2, 6 and 7 start in parallel. If time runs short, the router ships with only a default model mapped and the mapping is switched on afterwards with no code change. Slice 10 cannot be dropped: §4 shows the plans have no margin without it.

## 7. Open items

| Item | Default in this document |
| --- | --- |
| Annual subscribers and the AI plan | Follows the subscription cadence, pay 10 months and get 12 |
| Weekly share | 35%, one value for all plans |
| Cost unit | USD, as providers publish prices |
| Final message counts | Set after slice 12 |
| Trial clock for a tenant that signs up on the free plan | To settle in slice 6 |
| Payment gateway fee on a 29 SAR charge | Not verified; to confirm with the chosen gateway |
| Arabic quality and tool calling of the cheap models | To verify in the evaluation before any mapping is switched on |
| Large tenants | Ultra gives 85 messages per user a month at 100 users; a larger step or "contact us" may be needed |

## 8. Risks

- Switching provider between messages on provider-shaped history has no tests today. Slice 1 exists to remove this risk before anything depends on it.
- A cheap model may call tools badly across a growing catalog. An offline evaluation on real prompts per capability comes before any mapping is switched on.
- A summary can drop a number or a name. The tool-first rule limits the damage; slice 10 tests that the model reads again instead of answering from the summary.
- A summary carries untrusted text forward. §5.7 keeps it framed as data and keeps history guards on the full record.
- Plan prices assume most messages reach the cheap model and §5.7 works. If slice 12 shows otherwise, the message counts change for new periods, not the prices.
- Twelve slices before 2026-12-06 next to the rest of the launch scope. The kill switch in §5.5 keeps the launch independent of the router mapping.

## 9. Amendments to the 2026-11-04 spec

- §6.8: the monthly token limit `ai.tokens.monthly` is replaced by the message limits of §5.4 here. The per-run output cap and the input ceiling stay.
- §6.7: the administrator's monthly messages per user stays as it is.
- §6.14: model routing is no longer deferred; §5.5 here is the design. Routing is per message, with four capabilities, instead of per step.
- §6.9, chat attachments: unchanged, with the added rule in §5.7 that an attachment never enters conversation history.
