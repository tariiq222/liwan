# Self-service pricing, complete-application sales, and trial — design

Date: 2026-10-24. Status: draft for owner approval. Owner decisions taken in session on
2026-10-24 are recorded in §2. This document supersedes the pricing model implied by the
seeded `plan_revisions` rows (three fixed plans with internal caps) but does not by itself
change any code, database row, or published revision.

## 1. Intent

A Saudi company of any size opens `/subscription`, sees every application with its own
public price, ticks what it needs, sets how many users and how much storage it wants, and
watches the monthly total change with every click. (How the customer gets that far is an
open question: §10.5.) It pays, and exactly what it saw is what
is enforced in Odoo. Nothing inside a bought application is withheld.

The owner wants to run this commercially without a developer: every price, every included
minimum, and the trial length are fields in `apps/vendor-admin`, not constants in code.

Success: a new customer reaches a working tenant in one sitting, on a trial, without a
salesperson; and the owner changes a price between two customers without a deploy.

## 2. Owner decisions (2026-10-24)

1. **An application is the sellable unit.** HR is bought whole (recruitment, shifts,
   onboarding, offboarding, assets, payroll); PMO is bought whole (projects, meetings, no
   project cap); Finance whole. The customer never sees or buys an internal feature flag.
2. **No internal caps inside a bought application.** `projects.max_projects` and the
   Standard/Pro split disappear. Only metered resources (users, storage, branches) carry
   quantities.
3. **Branches are priced**, they are not out of scope: included count in the base plus a
   per-branch price above it.
4. **Application price is flat per application**, independent of company size. Size is
   priced through users, so pricing it again through the application would charge the same
   dimension twice.
5. **Every price lives in the admin console.** Seed values are marked unapproved; the
   owner fills the real numbers.
6. **Trial: 14 days**, the applications the customer chose only, the same limits as the paid
   subscription, and **no payment method required upfront**.
7. **AI in this phase runs on the platform provider key** (`AI_API_KEY`), one key for the
   whole service. "Bring your own key" and self-service credit purchase are a later phase.
8. **The subscription page is one screen** with a live, itemised total (visual option A in
   the 2026-10-24 brainstorm), not a wizard.
9. **Refund policy is written text plus a documented manual procedure**; no field, no
   automatic refund path in this phase.

## 3. What exists today, and what does not

Verified on `main` @ `6e355dce` unless stated. These are the gaps this design must close.

| Subject | Current state | Consequence |
| --- | --- | --- |
| App pricing | `bundle_revisions.prices` is `[]` for all six published bundles | Nothing is sellable; the catalog has no prices |
| App completeness | Bundle `People (HR)` selects only `hr.enabled`; the other six HR keys are never granted | Buying "HR complete" today would not grant payroll |
| Internal caps | `projects.max_projects` is a plan limit; two PMO bundles differ only by it (`20` vs `null`) | Contradicts §2.2 |
| Users / storage | Stored as plan `platform_limits`; enforced by `require_within_limit`; **not priced** | The engine bills base + bundle + branch only (`computeQuote`) |
| Branches | Already priced: `included_extra_branches`, `extra_branch_prices`, `requested_extra_branches`, prorated on change | Reusable as the model for users and storage |
| Trial | `trial_days` is stored on the plan and never read. **No code writes `trial_ends_at`.** No job ends a trial | Trial cannot start and, if started by hand, never ends |
| Tax | `pricing_policy_revisions` seeded at 15% and locked in **three** layers: a table `CHECK` that accepts only `1500`, a trigger rejecting `UPDATE`/`DELETE`, and `rate_bps: z.literal(1500)` in the contract | VAT cannot be changed from the console at all — not even by inserting a new row |
| Refund | `processRefundOutbox` writes `credit_note` rows with status `pending`; no route, no button | Refunds are invisible to the operator |
| Two revisions on sale | Publishing v2 leaves v1 `published AND available`; the customer query lists every such row | A plan shows twice at two prices (observed 2026-10-24) |
| Admin pricing surface | Plans/bundles forms exist; prices are editable only on a **draft** revision | Published prices need the revision flow, by design |

## 4. The model

### 4.1 What the customer chooses

```
base            : platform subscription, one price per cadence, includes MIN_USERS and MIN_STORAGE_MB
+ application   : one flat price per application per cadence; grants every key the app owns
+ users         : (chosen_users - MIN_USERS) x user_unit_price      when positive
+ storage       : (chosen_gb    - MIN_STORAGE_GB) x storage_unit_price  when positive
+ branches      : (chosen_branches - included_extra_branches) x branch_unit_price when positive
= subtotal -> VAT -> total
```

`Tasks` stays free and is always included with the base. Every other application is
optional and independently priced.

**A structural change the builder must make first:** the engine only prices a bundle that is
*optional* on the plan. `computeQuote` gives an included bundle a hard-coded amount of zero
(`quotes.ts:54`). Today every bundle sits in `included_bundle_revision_ids`, so even after the
prices are filled in the engine would still charge zero. The plan must therefore stop
pre-including applications: the customer's chosen applications are the plan's *optional*
bundles, and the base price covers only the platform.

### 4.2 Rules

1. `chosen_users >= MIN_USERS` and `chosen_gb >= MIN_STORAGE_GB`; the minimums are the base
   price, never an extra line.
2. Unit prices are per cadence (`month`, `year`); a missing unit price for a cadence makes
   that cadence unavailable for that line, never a zero.
3. Changing plan, quantity or app recalculates on the server. The client never sends
   amounts — the existing rule in `quoteRequestSchema` holds: ids and quantities only.
4. Mid-period increases are prorated (`prorateMinor`); decreases take effect at renewal.
   This is the existing `change` behaviour and must extend to users and storage.
5. Entitlement = base keys + every key of every chosen application, with metered limits set
   to the chosen quantities. **Customer terms may not override `users.limit` or
   `storage.limit_mb`** (owner decision 2026-10-25): capacity changes only through a new
   subscription quote the customer accepts, so the invoice, the enforced limit and the
   renewal all carry one number. Terms remain for prices, branch limits and term length.
6. A trial produces the same entitlements as the paid subscription for the same choices.
7. **Selecting an application grants every selectable boolean feature it owns.** Today a
   bundle must list each key explicitly in `selections.feature_keys`, so `People (HR)` selects
   `hr.enabled` alone and the other six HR keys are never granted. Under §2.1–2.2 the feature
   list is no longer a purchasing decision, so keeping it beside the application would be a
   second source of truth. *(Builder call, recorded here: the compiler derives the boolean set
   from the selected application; `feature_keys` stops being the grant mechanism and the six
   published bundles are migrated rather than left as a parallel path. A future opt-out
   feature would need its own explicit, named concept — not a resurrection of the list.)*

### 4.3 Where each number lives

| Value | Store | Editable by | Notes |
| --- | --- | --- | --- |
| Base price per cadence | `plan_revisions.prices` | `vendor.pricing.manage` + step-up | one plan, "LiwanOS" |
| Application price per cadence | `bundle_revisions.prices` | `vendor.pricing.manage` + step-up | was always empty |
| Included minimums | new plan columns: `included_users`, `included_storage_mb` | same | branches reuse `included_extra_branches` |
| Unit prices | new plan columns: `user_prices`, `storage_prices` (JSONB arrays of `{cadence, amount}`) | same | same shape as `extra_branch_prices` |
| Trial length | `plan_revisions.trial_days` | same | already stored, now honoured |
| Grace after paid period | `plan_revisions.grace_days` | same | already stored |
| VAT rate | `pricing_policy_revisions` | **new**: `vendor.pricing.manage`, creates a **new revision** | old revision stays immutable; see §4.4 |

Minimums are plan columns, not bundle columns: they are properties of the subscription, not
of an application.

**One plan, not three.** The database currently holds three published plans (Starter,
Business, Enterprise) whose only differences are `platform_limits` — numbers that become
customer-chosen quantities under this design. They therefore collapse into a single plan
named for the platform, whose `prices` are the base price and whose applications are optional.
The three seeded plans are development data with no live tenants; the migration replaces them
rather than keeping them alongside (AGENTS.md "Replace, do not layer").

### 4.4 Changing the VAT rate

Owner decision 2026-10-24: the rate is editable from the vendor console, and a change
applies to future invoices only. Three locks must be opened together; opening one is not
enough.

| Layer | Today | Change |
| --- | --- | --- |
| Table check | `CHECK(... tax_rate_bps=1500 ...)` accepts one value | Drop the 1500 literal; keep `tax_rate_bps` an integer between 0 and 10000, and require it NULL only when `tax_kind='none'` |
| Row guard | Trigger raises on every `UPDATE`/`DELETE` | Keep it. A revision is never edited or deleted; a change is always a **new row** |
| Contract | `rate_bps: z.literal(1500)` | `rate_bps: z.number().int().min(0).max(10000)` |
| Route | `GET /policies` only | Add `POST /policies` creating a new approved revision with a reason, gated by `vendor.pricing.manage` and step-up |

Rules:

1. A new policy revision never rewrites history. `plan_revisions.policy_revision_id` and
   `subscription_revisions.snapshot.policy_revision_id` keep pointing at the revision that
   was in force when they were created, so an issued invoice is always reproducible.
2. **New quotations** use the newest approved policy revision.
3. **Renewals stay pinned** to their subscription's snapshot (`renewals.ts:50`). A rate
   change does not silently re-price an agreed subscription; the customer's renewal amount
   changes only when they move to a new revision.
4. Moving an existing subscription onto the new policy is an explicit operator action, with
   a reason and an audit event, and it re-quotes before it commits.
5. The console shows the effective date and who changed the rate.

This resolves the contradiction with the renewal pinning rule: the owner changes the rate in
one place, and every existing subscription keeps its promise until it is deliberately
re-priced.

## 5. The customer journey

```
/register ──> /subscription (one page, live total)
                 │
                 ├─ pick applications
                 ├─ set users, storage, branches
                 ├─ see subtotal → VAT → total, updating on every change
                 └─ Start 14-day trial          (no payment method)
                        │
                        └─ trial_ends_at = now + trial_days
                           state = trialing
                           entitlements applied from the chosen snapshot
                              │
         ─────────────────────┴────────────────────┐
         │ day 11 and day 13: notice in the UI     │
         │ day 14: trial_ends_at reached           │
         └────────────────────┬────────────────────┘
                              │
              pays?  ── yes ──> active, renewal_at set
                     └─ no  ──> past_due  (grace_days)
                                     │
                                     └─ grace over + auto_suspend ──> suspended
                                                                      (Odoo enforces)
```

The customer can convert at any time during the trial; conversion is the existing
quote → order → payment → fulfillment path with `trial_ends_at` cleared.

## 6. The admin console

`apps/vendor-admin` needs four surfaces, all reusing the existing plan/bundle revision flow
(draft → validate → publish) and the existing step-up gate.

1. **Application pricing** — on `/bundles/{id}`: prices per cadence, and a read-only list of
   the feature keys the application grants. Publishing a bundle price change requires a new
   revision, and publishing withdraws the predecessor (§10.1).
2. **Subscription plan** — on `/plans`: base price, `included_users`, `included_storage_mb`,
   `user_prices`, `storage_prices`, `included_extra_branches`, `extra_branch_prices`,
   `trial_days`, `grace_days`, `auto_suspend`. This is where the owner sets every non-app
   number.
3. **Pricing policy** — a new `/policies` screen: current VAT rate and currency, read-only;
   a "new revision" action that asks for the rate and a reason. The old revision remains.
4. **Subscriptions** — on `/customers/{id}`: current state, `trial_ends_at`, `grace_ends_at`,
   days remaining, and a manual "end trial now" / "extend trial" action with a reason.
   Extending a trial is an owner-only capability.

The vendor console must warn when a published revision is about to be superseded (see §10.1).

## 7. Trial rules

1. Trial length is per plan (`trial_days`), default seed 14.
2. A trial grants the chosen applications and the chosen quantities. It does not grant
   applications the customer did not choose.
3. A trial does not require a payment method. No invoice is issued during the trial.
4. One trial per customer. A second trial on the same customer is refused unless an
   operator overrides it with a reason.
5. At `trial_ends_at`, without payment, the subscription moves to `past_due` and enters the
   existing `grace_days` window. At the end of grace with `auto_suspend` on, it becomes
   `suspended` and Odoo blocks writes.
6. The customer sees days remaining on `/subscription` from day 1, and a notice appears at
   day 11 and day 13 (scheduled, idempotent, one per threshold).
7. Trial expiry is a scheduled job, not a lazy check on request.
8. **Delivery channel.** `SmtpMailAdapter` already exists and the scheduler already runs an
   outbox sender for invitations (`scheduler.ts:89-91`), so a notice is a new outbox kind on
   an existing channel — not a new transport. In-app notice is the primary channel; email is
   sent when SMTP is configured, and its absence never blocks the state change.

## 8. Renewal (owner decision 2026-10-24)

Renewal is automatic where a payment token exists, and always on the **agreed price**: the
price the customer accepted at purchase, never today's list price.

```
renewal_at reached
  ├─ token present + auto-renew on + consent  -> charge the pinned snapshot, state stays active
  ├─ no token                                 -> issue the renewal invoice with a hosted payment link
  └─ charge fails                             -> past_due -> grace_days -> suspended (auto_suspend)
```

1. A renewal is priced from the subscription's own pinned revision — plan, bundles, policy,
   and terms (`renewals.ts:50` today). A new list price never reaches an existing renewal
   without the customer's explicit agreement.
2. Moving a customer to a new price is a deliberate re-quote, accepted by the customer, and
   recorded on the subscription timeline.
3. Moving a subscription onto a new VAT policy revision is likewise explicit (§4.4).
4. Auto-renew requires three conditions, all already enforced: `auto_renew_enabled`,
   `auto_renew_consent_at`, and a stored token.
5. The console can end or extend a trial and can disable auto-renew for one customer with a
   reason; both are audited.

### 8.1 Auto-renew is not wired today

Verified on `main` @ `6e355dce`:

| Piece | State |
| --- | --- |
| `auto_renew_enabled`, `auto_renew_consent_at`, check constraint | present `[كود]` |
| `AutoRenewControl.vue` + customer route | present `[كود]` |
| Charge path `adapter.chargeToken(...)` | present `[كود]` `renewals.ts:95` |
| **A writer of `provider_token_ref`** | **absent** — five references, all reads `[اختبار]` `grep` |
| Customer notice before a renewal | absent |

Consequence: the customer can tap "enable auto-renew" and is refused `409 token_required`
because no token is ever stored; every renewal therefore falls back to a hosted payment link.
This design requires: choose where the token is captured (at payment confirmation, from the
provider's stored-card response), store it once per subscription, and send a pre-renewal
notice with an opt-out.

## 9. Out of scope

- Payment provider completion (Moyasar live, 3DS, webhook, reconciliation, refunds) — #10.
- Public TLS, DNS, edge limits — #11.
- ZATCA production invoices — #16.
- Bring-your-own-key AI and prepaid AI credit — later phase, owner decision 2026-10-24.
- Per-seat discounts, coupons, and negotiated per-customer prices beyond the existing
  `customer_terms_revisions` mechanism.
- Annual prepay discount percentages: expressed as a separate yearly amount per line, not as
  a discount rate.

## 10. Known hazards this design must resolve

### 10.1 Two sellable revisions at once

Publishing a new revision leaves the previous one `published AND available`, and
`customer-http.ts` lists every such row. Observed on 2026-10-24: two `Starter` entries at
199 and 249. **Resolution: publishing a revision withdraws its predecessor atomically in the
same transaction.** The operator no longer depends on remembering a second click.

### 10.2 AI has a real marginal cost

`ai.messages.monthly` counts provider messages and is enforced at
`liwan_ai/models/ai_audit.py:198`. "No cap" on a flat-priced AI application means the vendor
pays for heavy users. Owner decision 2026-10-24: this phase keeps the platform key and a
flat AI price; the cap becomes an internal fair-use limit documented in the terms, not a
customer-facing quantity. **Risk accepted by the owner, recorded here.**

### 10.3 Trial that cannot end

See §3. This is the single largest functional gap: `trial_days` is inert and nothing writes
`trial_ends_at`. The job in §7.7 is mandatory, not optional.

### 10.4 Applying a published revision to an existing tenant

Withdrawing the predecessor must not disturb subscriptions already pinned to it.
`renewals.ts:50` already never selects a newer revision during renewal; the same must hold
when a revision is withdrawn.

### 10.5 There is no self-service registration (open question)

The journey in §5 begins at `/register`, but no such page exists and no customer can create
itself:

| Step | Today |
| --- | --- |
| A sign-up page | **absent** — every customer page requires a session |
| Creating a customer row | `POST /customers` requires `vendor.tenants.manage` — a **staff** capability `[كود]` `routes-b.ts:44` |
| Creating the tenant and its first administrator | also `vendor.tenants.manage`; the administrator is invited by the vendor console |
| Payment | not connected (#10) |

So today the vendor console is the only door, and every customer is created by the owner by
hand.

**Open decision for the owner:** keep Launch 1 invitation-only (the console creates each
customer), or build full self-service sign-up. The recommendation is invitation-only for
Launch 1: a 14-day trial with no payment method and no abuse control is an open invitation to
unlimited free tenants, and the hosting cost is the vendor's. Self-service becomes its own
project once demand is proven. **Until the owner answers, §5 must be read as starting at
`/subscription` for an existing customer, not at `/register` for a stranger.**

## 11. Acceptance criteria

1. A customer selects one application, 10 users and 20 GB, and the total on screen equals
   the server quote to the riyal, including VAT, and the same figures appear on the invoice.
2. Changing any quantity updates the total without a page reload.
3. Buying HR grants `hr.enabled` **and** all six sub-features; the HR payroll screen is
   reachable with no separate purchase.
4. Creating a project beyond any previous cap is never refused by an entitlement.
5. A 14-day trial starts with no payment method, grants exactly the chosen applications, and
   on day 15 (with no payment) the subscription is `past_due`, then `suspended` after grace,
   and Odoo refuses writes for the suspended tenant.
6. Extending a trial from the console is audited and appears on the customer's timeline.
7. The owner changes an application price from the console; new customers see the new price,
   and an existing customer's renewal still uses its pinned revision.
8. Publishing a new revision withdraws the previous one in the same transaction; the customer
   list never shows the same plan twice.
9. Changing the VAT rate creates a new policy revision; historical invoices still show 15%.
10. Every price shown to a customer came from a published revision, never from a constant in
    code or the seed file.
11. A renewal for a customer who bought at 199 charges 199 even after the list price becomes
    249; the re-price happens only after that customer accepts a re-quote.
12. Enabling auto-renew succeeds after a completed payment: a token is stored once, the
    renewal charge succeeds against it, and a charge failure lands the subscription in
    `past_due` inside `grace_days`.
13. A pre-renewal notice is sent before every automatic charge, and turning auto-renew off
    stops the next charge.

## 12. Left to the builder

- Whether `included_users` / `included_storage_mb` live on `plan_revisions` or on a new
  `subscription_terms` table. Plan columns are simpler and match `included_extra_branches`.
- The exact JSONB shape of `user_prices` / `storage_prices`: mirror `extra_branch_prices`.
- Whether trial conversion reuses the same quote row or creates a new one.
- Where the payment token is captured and how it is stored (reference only, never the PAN);
  the provider's stored-card response after a successful payment is the natural seam.
- The scheduled job's cadence for trial expiry (in-app notice first, then email when SMTP is
  configured; §7.8).
- Migration ordering and the version bump in `docs/migrations.md`.
- Whether the seed values are shipped as a migration or entered by the owner; §2.5 prefers a
  clearly marked seed.
