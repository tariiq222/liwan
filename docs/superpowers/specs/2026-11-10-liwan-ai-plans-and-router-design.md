# LiwanOS AI prepaid balance, free allowance, task router and conversation cost

Status: owner decisions taken in discussion on 2026-11-10 and reviewed against the code the same day. The owner first chose four fixed message plans, then replaced them with a prepaid balance charged at provider cost plus a margin; this document describes only the final model. Nothing here is implemented in any branch. Cost figures in §4 are one local measurement plus estimates, and each is marked.

Builds on: [2026-11-04 LiwanOS AI agents](2026-11-04-liwan-ai-agents-design.md). It replaces that spec's monthly limits (§6.8) and its deferred model routing (§6.14); see §9.

## 1. Intent

Tenants get three ways to use the assistant, and the vendor carries no usage risk on the paid one:

1. Free help and setup agents on the vendor's provider (exists; budget `ai.assist.monthly`).
2. A prepaid balance on the vendor's provider: the tenant tops up, and each request is charged what it cost the vendor plus a margin.
3. The tenant's own provider key (exists). It never touches the balance.

A task router sends each message to the cheapest model that suits it, and long conversations stop resending their whole history. Both now lower the customer's bill directly.

## 2. Owner decisions (2026-11-10)

| # | Decision |
| --- | --- |
| D1 | Keep both paths: paid use of the vendor's provider and the tenant's own key. |
| D2 | Paid use ships before the launch target (2026-12-06). |
| D3 | No fixed plans. The tenant pays for what it uses: provider cost plus a vendor-set margin of 15 to 25%. |
| D4 | Prepaid: the tenant tops up a balance, usage is deducted from it, and the assistant stops at zero until the next top-up. |
| D5 | The customer sees the balance and the usage in US dollars and in riyals, switched by a control on the display. Payment is in riyals. |
| D6 | One balance per tenant. It is bought from inside the product, not with the packages shown at sign-up. |
| D7 | When the balance and the free allowance are used up, the paid assistant stops. Help and setup agents keep working; the tenant's own key remains an alternative. |
| D8 | A free allowance during the trial that renews every 5 days, so a new tenant can try the strong models. After the trial there is a permanent free allowance, which the vendor sets and may set to zero. |
| D9 | Build the full task router now, controlled from the vendor's provider panel. |
| D10 | Long conversations are handled by summarising old history, shortening old tool results, provider prompt caching and a "start a new conversation" prompt. |
| D11 | Margin: 20%, one rate for every model, vendor-editable. |
| D12 | Free allowance: the equivalent of 5 SAR per 5-day window during the trial, and zero after it. Help and setup agents stay free. |
| D13 | Top-ups of 25, 50, 100, 250 and 500 SAR, minimum 25. Unused balance does not expire while the tenant is active and is refunded only inside the existing 14-day window and only if untouched. |
| D14 | The tenant chooses a quality level for the assistant: economical, balanced (default) or best. |
| D15 | Chat attachments (PDF, Word) come after launch. |
| D16 | If time runs short before launch: ship the balance, the long-conversation controls and two models (a cheap one and a mid one), and switch the rest of the mapping on afterwards. |

D11 to D16 are the design author's recommendations, which the owner accepted on 2026-11-10. The amounts in D11 to D13 are vendor settings and can change without code.

## 3. Current state (verified 2026-11-10)

- Limits `ai.messages.monthly`, `ai.tokens.monthly`, `ai.assist.monthly`, `ai.tool_calls.per_run` are registered in `odoo-addons/liwan_ai/models/feature_registry.py`. Enforcement is hand-written with a UTC calendar month in `ai_audit.py` and `ai_usage.py`, repeated in `liwan_ai_notify/models/limit_warning.py`.
- The message counter counts every `kind='message'` audit row in the tenant database, across provider modes, so own-key messages count against `ai.messages.monthly` today. Per-call rows in `liwan.ai.usage` do carry `billing` (`platform`, `setup`, `tenant_key`).
- A message is counted in `apps/web/server/api/ai/runs/index.post.ts` before the AI service is reached, so it is counted even when the provider fails.
- The platform provider is one provider and one model: `apps/ai-service/src/liwan_ai_service/platform_provider.py`, table `ai_platform_provider` (`apps/control-plane/src/schema_032.sql`), page `apps/vendor-admin/app/pages/ai-provider.vue`.
- The model is chosen once per request in `run_model_for` (`service.py`) and invoked in one place, the `plan` node (`graph.py`). Call kinds are `plan` and `title`.
- No price or cost exists anywhere. No provider prompt caching. The service never shortens history; the only guard is the per-request input ceiling, which stops the run.
- Chat attachments are not supported (2026-11-04 spec §6.9 keeps them out until the malware scanner exists).
- Commerce: one subscription per customer with one cadence. Everything sold is a recurring line; the only one-time line is the onboarding fee. There is no prepaid balance and no top-up. Limits reach the tenant as entitlement values in `liwan.tenant.profile.features`.
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

Estimated, not measured: a conversation of 30 messages with a 10-page document (about 8,000 tokens) kept in history, 60% of messages using one tool, about one million input tokens in total. Prices were read on 2026-11-10 from the providers' own pricing pages through a page summariser, so they are second-hand readings: a cheap model at 0.10 / 0.50 USD per million input / output tokens, a mid model at 2 / 10 with cached input at 0.10, and 3.75 SAR per USD. The customer columns add a 20% margin.

| Case | Vendor cost per message | Customer pays per message | 30-message conversation, customer |
| --- | --- | --- | --- |
| Cheap model, nothing applied | 0.013 SAR | 0.016 | 0.48 SAR |
| Cheap model with §5.7 | 0.005 | 0.006 | 0.17 SAR |
| Mid model, nothing applied | 0.27 | 0.32 | 9.56 SAR |
| Mid model with §5.7, no caching | 0.095 | 0.11 | 3.41 SAR |
| Mid model with §5.7 and caching | 0.055 | 0.066 | 1.98 SAR |

What 100 SAR of balance buys with 80% of messages on the cheap model and 20% on the mid model:

| Case | Messages |
| --- | --- |
| Nothing applied | about 1,300 |
| With §5.7 | about 3,600 |
| With §5.7 and caching | about 5,900 |

Consequences for the design:

- The vendor's margin no longer depends on the mix of models: it is the margin rate on whatever was used. The router and §5.7 now decide how far the customer's money goes, which decides whether customers keep topping up.
- A long conversation on the mid model with nothing applied costs the customer about 10 SAR. §5.7 is still launch scope, for the customer's bill rather than the vendor's margin.
- Charging real cost needs real numbers: a model whose provider reports no token counts cannot be used for charged runs, and the cached-input price must be known before caching is switched on.
- The margin has to cover what is given away: payment gateway fees (not verified; commonly quoted at 1 to 2.5% plus a fixed fee per transaction), the trial and free allowances, and the free help and setup agents.

## 5. Design

### 5.1 Balance and charging

- Every model call on the vendor's provider in an ordinary conversation is charged: planning calls, the classification call, titles and summaries. Help and setup conversations are never charged. Own-key calls are never charged.
- Charge per call = the call's cost (§5.6) plus the margin in force when the call ran, rounded up to the cost unit. The margin is one vendor-set rate, 20% at launch (D11).
- A provider attempt that fails reports no tokens and is not charged, so a request that fails on LiwanOS's side costs the customer nothing.
- The balance is a ledger in the tenant database: grants (top-ups, delivered by the control plane as one cumulative total) minus charges (the usage rows). The tenant enforces it locally; nothing asks the control plane at run time (R5).
- A run starts only when the tenant has free allowance or balance left. A run in progress may overdraw by at most its own cost, which the per-request output cap, input ceiling and tool-call limit bound.
- The administrator's per-user monthly message cap stays as the way to share the balance between users. `ai.messages.monthly` and `ai.tokens.monthly` as tenant-wide limits are removed.
- The customer sees the balance, this month's spend, an estimate of messages left based on the tenant's own average, and the top-up history. Amounts show in USD or SAR by a switch on the display (D5), converted at a vendor-set rate that starts at the 3.75 peg.

### 5.2 Free allowance

- The free allowance is a value, not a message count, in the same cost unit as the balance. It is used before the balance and does not accumulate: what is left when a window ends is gone.
- During the trial: a vendor-set allowance per 5-day window, counted from the trial start, the equivalent of 5 SAR at launch (about 200 to 300 messages with §5.7 applied). After the trial: a vendor-set allowance per calendar month, zero at launch (D12).
- One clock: the control plane pushes the trial start and end into the tenant profile through the existing revisioned delivery, and the check reads only that. A vendor extension of the trial extends the allowance with it.
- The free allowance runs on the same router as paid use, so a new tenant sees the strong models.
- The seeded free plan carries no commercial trial today. Whether sign-up always opens a trial, or the delivery carries an AI trial period of its own, is settled in slice 6 (§7).

### 5.3 Selling a top-up

- A top-up is a one-time line in the existing quote, order, invoice and payment chain, like the onboarding fee. It is not a recurring line and takes no part in renewals, proration or cadence.
- The vendor sets the top-up amounts on offer and a minimum (at launch: 25, 50, 100, 250 and 500 SAR, minimum 25). The customer pays in SAR.
- Unused balance does not expire while the tenant is active. A top-up is refunded only inside the existing 14-day refund window and only if none of it was used (D13).
- On payment, the control plane adds the amount to the customer's cumulative granted total and delivers the new total to the tenant with the entitlement. A refunded top-up lowers the total.
- Purchase page: `apps/web/app/pages/subscription/ai.vue`, the only location rule R5 allows for customer commerce. `/ai`, the AI settings page and the stopped notice link to it and import nothing commercial.
- A tenant with no paid subscription buys through a zero-priced base plan revision. Slice 7 tests a top-up as the first order on such a tenant, including the rule that a paid first order needs a reachable manager.
- The free and trial allowances and the margin are vendor-level settings, not plan-revision fields, because a renewal reuses the pinned revision and they must be changeable for every tenant.

### 5.4 Enforcement and warnings (Odoo)

- Remove `ai.tokens.monthly` and the tenant-wide `ai.messages.monthly`. Add the delivered keys: granted total, trial allowance, monthly free allowance, trial start and end. In `non_saas` the operator's local policy sets them directly; unset means unlimited.
- One window helper in `liwan_platform` returns the start and reset time of the current free-allowance window (5-day trial window or calendar month) in the timezone of the tenant's root company. The hand-written month starts are replaced by it.
- The pre-run check in `ai_audit.create` tests the free allowance of the current window, then the balance. A refusal says the balance is used up and, when a free allowance exists, when it renews.
- Charges come from `liwan.ai.usage` rows with `billing='platform'`. Those rows are the ledger and are kept for the life of the tenant.
- The policy sent with each run and the limits route drop the token and message fields and carry the balance, the free allowance left and its reset time.
- Warnings: a bell and an e-mail to the administrators when the balance falls below a threshold, and again when it reaches zero. The tenant may set a monthly spend ceiling in the AI settings (scope: tenant; default: none; changed by `ai.settings.manage`); reaching it stops the assistant like an empty balance.
- Per-request guards stay: output cap, input ceiling, tool calls per run.

### 5.5 Task router

- Unit: one classification per user message. The whole tool loop of that message stays on one model, so a tool call and its result never cross providers.
- Capabilities, each tied to what the agents do: `quick` (greetings, simple lookups, help and setup, titles, classification, summaries), `standard` (ordinary multi-tool work; also the fallback), `analysis` (numbers, comparisons, reports), `writing` (long Arabic or English text, translation).
- Classifier: one `route` call on the `quick` model with the last user message, the active agent and the previous capability; no history and no tools. One attempt with a short timeout. Any failure selects `standard`, never a failed run.
- No classification call when it cannot change the outcome: setup and help runs use `quick`, titles use `quick`, own-key runs have one model, and a vendor who maps only a default model gets no extra call. The last case is the kill switch and the shape of a dedicated single-model install.
- The capability is stored in the run state as a plain string and reset on each new message. A resume after a tool result or an approval reads it from state and never classifies again. The model object never enters state. New state keys are read with defaults; whether `AI_STATE_VERSION` changes is decided in slice 3.
- Vendor mapping: several providers with their keys, a list of models with input, cached-input and output price per million tokens, and a map from capability to model with a required default. A model can be mapped for charged runs only after a test call that reports token counts. The singleton table, the single-model file and the single-model page are replaced in place. An invalid model entry is dropped and its routes fall to the default; only a structural error or a bad default rejects the file, and then the last valid configuration stays.
- Quality level (D14): a tenant setting with three values, economical, balanced and best (scope: tenant; default: balanced; changed by `ai.settings.manage`; applies to the next message). The vendor's map has one model per capability and quality level; an empty cell falls back to the balanced one. The setting is sent with the run policy, so the service picks the column and the customer pays what that column costs.
- Fallback: when the routed model exhausts its retries on a transient provider error, one attempt runs on the default model and the rest of that message stays on the default.
- Egress: the hosts of every configured provider are published for the allowlist proxy.
- History portability: a pure function normalises checkpointed history before every model call (plain text plus tool calls, provider metadata dropped, tool-call ids remapped where a provider would refuse them). The checkpoint is not rewritten. This is the riskiest part of the design and is built first.

### 5.6 Cost and charge per call

- One unit is 0.00001 USD. A price entered in USD per million tokens is first converted to units per million tokens (`price × 100,000`, an integer), then `cost = ceil((input_tokens × input_units + cached_tokens × cached_units + output_tokens × output_units) / 1,000,000)`. Example: 1,000 input tokens at 3 USD per million cost 0.003 USD and are stored as 300 units.
- `charge = ceil(cost × (1 + margin))`. Both values are computed in the AI service, which holds the prices and the margin, and both are stored on the usage row with the capability.
- A call with no reported tokens stores no cost and no charge.
- The vendor sees cost against charge per tenant, capability and model. The customer sees charges only.
- Wire changes reach all three strict contract copies (service, `packages/contracts`, Odoo `liwan.ai.usage`) in one release.

### 5.7 Long conversations

1. Rolling summary. The last few exchanges stay verbatim; older ones are replaced by a short summary written by the `quick` model. It runs in batches (about every 10 messages), not on every message, so the cached prefix survives between batches. The summary is stored in the run state; the checkpointed messages stay complete.
2. Old tool results are replaced by a one-line stub in what is sent to the model, once the model has answered from them. Tool-call ids stay paired. The model reads again through the tool when it needs the data, which the existing rule "you know nothing except through tools" already requires.
3. Provider prompt caching: rules and tools first in a stable order, then the summary, then the volatile parts, with cache markers where the provider needs them.
4. After a set length the conversation offers "start a new conversation", carrying the summary over.

Security rules for the summary:

- The summary is written from tool results, which are untrusted record text. It is sent as framed data in the same frame as record text, never inside the system rules, and the summary prompt quotes no instructions.
- Guards that inspect history keep reading the complete checkpointed messages, not the shortened view. The guard that withholds the memory tools once data has been read (`has_read_data`) is the known case.

Attachments, when they are built, do not enter history: the file text is extracted once, indexed, and only the passages relevant to each question are sent, through the existing `retrieve` step. Attachments stay out of launch scope and keep their malware-scanner prerequisite.

### 5.8 Customer-hosted and dedicated (`non_saas`)

- There is no balance: the operator pays its own provider. Limits come from the operator's local policy; an unset limit is unlimited.
- The top-up page and every purchase action are hidden. The stopped state says to contact the administrator.
- A single-model platform file stays valid: every capability falls to the default.

## 6. Delivery slices

One owner per file; a slice that shares a file with an earlier one merges after it. Slices 2, 3 and 4 share `service.py`, `graph.py` and `usage.py` and merge in that order; slice 10 follows slice 4 on `graph.py`.

| # | Slice | Depends on | Launch |
| --- | --- | --- | --- |
| 1 | Portable history, with a cross-provider test matrix and one live two-provider check | none | yes, first |
| 2 | Usage wire: capability, cost and charge on every call (service, web, Odoo) | none | yes |
| 3 | Platform file with several models, prices and margin; per-request model map; egress hosts | 2 | yes |
| 4 | Classifier and fallback | 1, 3 | yes |
| 5 | Control plane provider tables and routes; vendor provider page with prices and margin | 3 | yes |
| 6 | Odoo ledger: balance and free-allowance check, window helper, spend ceiling setting, warnings, policy; tenant-wide message and token limits removed | 2 | yes |
| 7 | Commerce: one-time top-up line, cumulative granted total, refund, delivery to the tenant; vendor-level allowances and trial dates | none | yes |
| 8 | Vendor console: top-up amounts, allowances, conversion rate | 7 | yes |
| 9 | Customer UI: top-up page, balance with the USD and SAR switch, usage, stopped state | 6, 7 | yes |
| 10 | Rolling summary, tool-result stubs, new-conversation prompt, with the security rules of §5.7 | 4 | yes |
| 11 | Prompt caching and the cached-input price | 10 | yes |
| 12 | Measurement on the chosen models with long conversations, to publish what a top-up buys | 4, 10, 11 | yes |
| 13 | Vendor report: cost against charge per tenant, capability and model | 2 | after launch |
| 14 | Attachments through retrieval | scanner | after launch |

Slices 1, 2 and 7 start in parallel. If time runs short (D16), launch needs slices 1 to 3, 5 to 11 and a map of two models (cheap for `quick`, mid as the default); the classifier, the other capabilities and the quality levels are switched on afterwards through the vendor panel.

## 7. Open items

| Item | Default in this document |
| --- | --- |
| Conversion rate | 3.75 SAR per USD, vendor-editable |
| Automatic top-up from a saved card | Not at launch |
| Trial clock for a tenant that signs up on the free plan | To settle in slice 6 |
| Payment gateway fee | Not verified; to confirm with the chosen gateway before fixing the minimum top-up |
| Arabic quality and tool calling of the cheap models | To verify in the evaluation before any mapping is switched on |

## 8. Risks

- Switching provider between messages on provider-shaped history has no tests today. Slice 1 exists to remove this risk before anything depends on it.
- A cheap model may call tools badly across a growing catalog. An offline evaluation on real prompts per capability comes before any mapping is switched on.
- Charging errors are now billing errors. A wrong price in the vendor panel, a provider that changes prices, or a miscounted cached token overcharges or undercharges every tenant. The vendor report in slice 13 compares charges with the provider's own invoice; until it exists the check is manual.
- A variable bill is harder to sell to a small company than a fixed plan. The balance display, the estimate of messages left and the spend ceiling are what make it predictable.
- A summary can drop a number or a name, and it carries untrusted text forward. The tool-first rule and §5.7's security rules limit both.
- Twelve slices before 2026-12-06 next to the rest of the launch scope. The kill switch in §5.5 keeps the launch independent of the router mapping.

## 9. Amendments to the 2026-11-04 spec

- §6.8: the monthly token limit `ai.tokens.monthly` and the tenant-wide monthly message limit are replaced by the prepaid balance and the free allowance here. The per-run output cap and the input ceiling stay.
- §6.7: the administrator's monthly messages per user stays as it is.
- §6.13: the free help and setup agents and their `ai.assist.monthly` budget are unchanged.
- §6.14: model routing is no longer deferred; §5.5 here is the design. Routing is per message, with four capabilities, instead of per step.
- §6.9, chat attachments: unchanged, with the added rule in §5.7 that an attachment never enters conversation history.
