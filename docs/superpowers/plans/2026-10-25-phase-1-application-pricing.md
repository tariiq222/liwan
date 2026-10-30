# Phase 1 — Self-service application pricing, quantities and a live total

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A customer picks applications and quantities in one screen and sees a total that matches the server quote to the riyal, and buying HR grants every HR feature — with every price entered in the vendor console.

**Architecture:** The selling unit becomes the application (bundle) instead of the plan limit. The plan collapses to one platform record that carries the base price, the included minimums, and unit prices for users, storage and branches. `computeQuote` gains two metered lines beside the existing branch line, and `compileEntitlements` stops reading `platform_limits` for users and storage in favour of the quantities the customer chose.

**Tech Stack:** `packages/commercial-contracts` (zod + pure pricing), `apps/control-plane` (pg + http), `apps/vendor-admin` (Nuxt 4, `@liwan/commercial-ui`), `apps/web` (Nuxt 4, `/subscription`), Postgres 16.

**Spec:** [docs/superpowers/specs/2026-10-24-self-service-pricing-and-trial-design.md](../specs/2026-10-24-self-service-pricing-and-trial-design.md) §2, §3, §4, §5 (partial), §6 (items 1–2), §10.1

## Global Constraints

- Worktree: `codex/cp-self-service-pricing` at `.worktrees/cp-self-service-pricing`; never `git worktree add`.
- Nothing here changes auth, signup or enrollment. The customer is created by the vendor console, as today. `/register` is out of scope for all five phases (spec §10.5).
- Every price is a `prices`/`*_prices` array of `{cadence: {unit, count}, amount: {currency, exponent, minor}}` and comes from a published revision. No constant, no environment variable, no seed value in code paths (spec §2.5).
- The client sends ids and quantities only. Amounts, tax and totals are computed server-side (`quoteRequestSchema` comment; keep it true).
- Money is integer minor units; proration is `prorateMinor` (half-up, exact rational). Never float arithmetic.
- Plan and bundle revisions stay immutable once published; a change is a new revision.
- Database change: one new file `apps/control-plane/src/schema_025.sql`, registered in the `for (const [version, body] of …)` loop in `apps/control-plane/src/db.ts`.
- Every new contract field is `.strict()` on both sides: zod schema and the Postgres column, no extras.
- Vendor console writes need `vendor.catalog.manage` **and** `vendor.pricing.manage` plus a fresh step-up; the route already enforces this (`http.ts:97,104`).
- Web app strings live in `apps/web/i18n/locales/{ar,en}/subscription.json` under the `subscription` root key; vendor strings in `apps/vendor-admin/i18n/locales/{ar,en}/vendor.json` under `vendor`.
- Web components come from Storybook only; a new shared component ships a story and `node tools/ui_catalog.mjs`.
- Checks: `npm -w packages/commercial-contracts run test`, `npm -w apps/control-plane run test`, `npm -w apps/vendor-admin run lint`, `npm -w apps/web run lint`, `npm test`.
- Commit subjects `type(scope): imperative subject` ≤72 chars, scope from the AGENTS.md area list; one logical change per commit.

## Review Focus

- **A quantity below the included minimum** — the customer sets 1 user when the base includes 3. A reasonable person expects the base price, not a negative line and not a refusal.
- **A missing unit price for one cadence** — the owner priced monthly but not yearly. Expect that cadence to be offered as unavailable, never silently zero.
- **A plan whose price currency differs from a bundle's** — must be refused at publish time, not discovered by the customer.
- **Packages quoted with an application the customer did not select** — the entitlement must not leak a feature that was never paid for.
- **The total on screen drifting from the invoice by one halala** — this is the one error a customer will notice and report.

---

### Task 1: Extend the plan and quote contracts

**Files:**
- Modify: `packages/commercial-contracts/src/commercial/schemas.ts` (`planFields`, `planViewSchema`, `planRevisionSchema`, `quoteRequestSchema`, `quoteSchema`, `planCreateSchema`, `planEditSchema`)
- Modify: `packages/commercial-contracts/src/commercial/types.ts` (derived types)
- Test: `packages/commercial-contracts/src/__tests__/commercial-pricing.test.ts`

**Interfaces:**
- Produces: `PlanRevision` gains `included_users: number`, `included_storage_mb: number`, `user_prices: Price[]`, `storage_prices: Price[]`; `QuoteRequest` gains `requested_users: number`, `requested_storage_mb: number`; `Quote` gains `requested_users`, `requested_storage_mb`.
- Consumes: the existing `priceSchema`, `cadenceSchema`, `MAX`.

- [ ] **Step 1: Write the failing test**

```ts
it('accepts the metered fields on a plan', () => {
  const plan = plan({ included_users: 3, included_storage_mb: 5120, user_prices: [monthly(2500)], storage_prices: [monthly(500)] })
  expect(planRevisionSchema.safeParse(plan).success).toBe(true)
})
it('rejects a negative included minimum', () => {
  expect(planRevisionSchema.safeParse(plan({ included_users: -1 })).success).toBe(false)
})
it('rejects a non-integer unit price', () => {
  expect(planRevisionSchema.safeParse(plan({ user_prices: [{ cadence: M, amount: { currency: 'SAR', exponent: 2, minor: 12.5 } }] })).success).toBe(false)
})
```

`plan()` is the existing fixture helper in `commercial-quotes.test.ts`; export it or move it to a shared `__tests__/fixtures.ts` in the same task.

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm -w packages/commercial-contracts run test -- -t "metered fields on a plan"`
Expected: FAIL — unknown key `user_prices` in a strict object.

Whether a plan *must* price a cadence it offers is a publishing rule, not a schema rule; it is Step 3 of Task 6.

- [ ] **Step 3: Add the fields**

In `planFields` add `included_users: z.number().int().min(0).max(MAX)`, `included_storage_mb: z.number().int().min(0).max(MAX)`, `user_prices: z.array(priceSchema)`, `storage_prices: z.array(priceSchema)`. Add the same four to `planRevisionSchema`/`planViewSchema`. In `quoteRequestSchema` add `requested_users: z.number().int().min(0).max(MAX)` and `requested_storage_mb: z.number().int().min(0).max(MAX)`; add the echo fields to `quoteSchema`. Keep the schema permissive: a plan with an empty `user_prices` is valid until publishing, where Task 6 refuses it.

- [ ] **Step 4: Run the tests**

Run: `npm -w packages/commercial-contracts run test`
Expected: PASS, and the pre-existing pricing tests unchanged.

- [ ] **Step 5: Commit**

```bash
git add packages/commercial-contracts/src/commercial/schemas.ts packages/commercial-contracts/src/commercial/types.ts packages/commercial-contracts/src/__tests__/commercial-pricing.test.ts
git commit -m "feat(cp): add metered users and storage to the plan contract"
```

---

### Task 2: Price users and storage in the quote engine

**Files:**
- Modify: `packages/commercial-contracts/src/commercial/quotes.ts` (`computeQuote`)
- Modify: `packages/commercial-contracts/src/commercial/pricing.ts` (add `paidUnits`)
- Test: `packages/commercial-contracts/src/__tests__/commercial-pricing.test.ts`, `packages/commercial-contracts/src/__tests__/commercial-quotes.test.ts`

**Interfaces:**
- Consumes: `PlanRevision.user_prices`, `storage_prices`, `included_users`, `included_storage_mb` (Task 1); `ComputeQuoteInput.requested_users`, `requested_storage_mb`.
- Produces: `paidUnits(requested: number, included: number): number` in `pricing.ts`; two new quote lines with `kind: 'users'` and `kind: 'storage'`, `quantity` = paid units, `amount` = unit × paid.

- [ ] **Step 1: Write the failing tests**

Add to `commercial-pricing.test.ts` (unit arithmetic) and `commercial-quotes.test.ts` (quote lines):

```ts
it('prices paid users above the included minimum', () => {
  expect(paidUnits(10, 3)).toBe(7)
  expect(paidUnits(3, 3)).toBe(0)
  expect(paidUnits(1, 3)).toBe(0)            // below the minimum is the base price, never negative
  expect(() => paidUnits(-1, 3)).toThrow('invalid_quantity')
})
// commercial-quotes.test.ts, reusing the existing plan()/base() helpers
const metered = plan({ included_users: 3, included_storage_mb: 5120, user_prices: [{ cadence: M, amount: sar(2500) }], storage_prices: [{ cadence: M, amount: sar(500) }] })
it('adds one users line and one storage line to a new quote', () => {
  const q = computeQuote(base({ plan: metered, requested_users: 10, requested_storage_mb: 20480 }))
  expect(q.lines.filter(l => l.kind === 'users')).toHaveLength(1)
  expect(q.lines.find(l => l.kind === 'users')!.quantity).toBe(7)
  expect(q.lines.find(l => l.kind === 'users')!.amount.minor).toBe(7 * 2500)
  expect(q.lines.find(l => l.kind === 'storage')!.amount.minor).toBe(15 * 500)
})
it('omits the line entirely at the included minimum', () => {
  const q = computeQuote(base({ plan: metered, requested_users: 3, requested_storage_mb: 5120 }))
  expect(q.lines.some(l => l.kind === 'users' || l.kind === 'storage')).toBe(false)
})
it('refuses a paid quantity with no unit price', () => {
  expect(err(() => computeQuote(base({ plan: plan({ user_prices: [] }), requested_users: 10 })))).toBe('price_missing')
})
```

`base()` needs `requested_users`/`requested_storage_mb` added to its defaults (0), and the existing `plan()` fixture needs the four new fields with neutral defaults (0 / 0 / [] / []).

- [ ] **Step 2: Run to confirm failure**

Run: `npm -w packages/commercial-contracts run test -- -t "paid users above"`
Expected: FAIL — `paidUnits is not a function`.

- [ ] **Step 3: Implement**

`paidUnits` mirrors `paidExtraBranches`: refuse a negative or non-integer input with `invalid_quantity`, return `Math.max(0, requested - included)`. In `computeQuote`, after the branch line: pick the unit price for the cadence from `plan.user_prices` / `plan.storage_prices`, multiply by `paidUnits`, and push the line only when the paid quantity is positive. A paid quantity above zero with no matching unit price raises `CommercialError('price_missing', 'users')`. Add the same two deltas to the `change` branch beside `branchDelta`, prorated with `prorateMinor`.

- [ ] **Step 4: Run the tests**

Run: `npm -w packages/commercial-contracts run test`
Expected: PASS, including every existing quote test.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(cp): price metered users and storage in the quote engine"
```

---

### Task 3: Grant every feature of a selected application

**Files:**
- Modify: `packages/commercial-contracts/src/commercial/entitlements.ts` (`compileEntitlements`)
- Test: `packages/commercial-contracts/src/__tests__/commercial-entitlements.test.ts`

**Interfaces:**
- Consumes: `CatalogApplication.features` with `selectable` and `kind`.
- Produces: the entitlement's boolean set is the union of every selectable boolean of every selected application; `selections.feature_keys` is no longer a grant (it is still validated for shape so old rows parse).

- [ ] **Step 1: Write the failing test**

```ts
it('grants all seven HR features when the people application is selected', () => {
  const snap = compileEntitlements({ release, plan, bundles: [peopleBundle], terms: null })
  for (const k of ['hr.enabled','hr.recruitment','hr.shifts','hr.onboarding','hr.offboarding','hr.assets','hr.payroll'])
    expect(snap.features[k]).toBe(true)
})
it('does not grant a feature of an application that was not selected', () => {
  const snap = compileEntitlements({ release, plan, bundles: [peopleBundle], terms: null })
  expect(snap.features['finance.enabled']).toBeUndefined()
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm -w packages/commercial-contracts run test -- -t "seven HR features"`
Expected: FAIL — only `hr.enabled` is true.

- [ ] **Step 3: Implement**

**Owner decision 2026-10-25:** this grants `hr.payroll` too, while payroll's own release gates stay open (`docs/WORKSPACE.md` §"الرواتب السعودية"). The commercial grant and operational readiness are separate; Phase 5 Task 3 makes the screen say so.

Replace the `for (const key of sel.feature_keys)` loop with a loop over `app.features.filter(f => f.kind === 'boolean' && f.selectable)`. Keep the `feature_keys` shape validation so existing published rows still parse. Document in a one-line comment that the application is the grant unit (spec §4.2.7).

- [ ] **Step 4: Run the tests**

Run: `npm -w packages/commercial-contracts run test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "refactor(cp): grant every feature of a selected application"
```

---

### Task 4: Set the entitlement limits from the chosen quantities

**Files:**
- Modify: `packages/commercial-contracts/src/commercial/entitlements.ts`
- Modify: `packages/commercial-contracts/src/commercial/schemas.ts` (`entitlementSnapshotSchema` unchanged; `QuoteRequest` already carries the quantities)
- Test: `packages/commercial-contracts/src/__tests__/commercial-entitlements.test.ts`

**Interfaces:**
- Consumes: `requested_users`, `requested_storage_mb` on the quote.
- Produces: `compileEntitlements` takes `quantities: { users: number; storage_mb: number }` and writes `users.limit` / `storage.limit_mb` from it; `plan.platform_limits` no longer carries those two keys.

- [ ] **Step 1: Write the failing test**

```ts
it('writes the chosen quantities into the platform limits', () => {
  const snap = compileEntitlements({ release, plan, bundles, terms: null, quantities: { users: 10, storage_mb: 20480 } })
  expect(snap.features['users.limit']).toBe(10)
  expect(snap.features['storage.limit_mb']).toBe(20480)
})
it('refuses a plan that still carries a users limit', () => {
  const bad = { ...plan, platform_limits: { 'users.limit': 10, 'storage.limit_mb': 5120 } }
  expect(() => compileEntitlements({ release, plan: bad, bundles, terms: null, quantities: { users: 10, storage_mb: 20480 } }))
    .toThrow('platform_limit_derived')
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm -w packages/commercial-contracts run test -- -t "chosen quantities"`
Expected: FAIL — `compileEntitlements` ignores the new argument.

- [ ] **Step 3: Implement**

Add `quantities` to `CompileEntitlementsInput`. Reject `users.limit` or `storage.limit_mb` inside `platform_limits` with `CommercialError('platform_limit_derived', 'platform_limits')` — one source of truth. Write both keys from `quantities`. Keep `branches.extra_limit` behaving as today (still a plan limit).

This breaks every existing fixture whose plan carries those two keys — `commercial-entitlements.test.ts` builds its plan with `platform_limits: { 'users.limit': 20, 'storage.limit_mb': null }` and `commercial-quotes.test.ts` with both null. In the same step, move those fixtures to `quantities: { users: 20, storage_mb: 0 }` and empty `platform_limits`. Grep for `'users.limit'` across `packages/commercial-contracts/src/__tests__` and `apps/control-plane/src/__tests__` and fix every occurrence; a green test run is the proof nothing was missed.

- [ ] **Step 4: Run the tests**

Run: `npm -w packages/commercial-contracts run test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(cp): derive entitlement limits from the chosen quantities"
```

---

### Task 5: Add the plan columns and the seed

**Files:**
- Create: `apps/control-plane/src/schema_025.sql`
- Modify: `apps/control-plane/src/db.ts` (read + register version 25)
- Test: `apps/control-plane/src/__tests__/commercial-plans.test.ts`

**Interfaces:**
- Produces: columns `included_users integer NOT NULL DEFAULT 0`, `included_storage_mb integer NOT NULL DEFAULT 0`, `user_prices jsonb NOT NULL DEFAULT '[]'`, `storage_prices jsonb NOT NULL DEFAULT '[]'` on `plan_revisions`.

- [ ] **Step 1: Write the failing test**

```ts
it('reads back the new plan columns', async () => {
  const plan = await createPlan(pool, actor, planBody({ included_users: 3, included_storage_mb: 5120, user_prices: [monthly(2500)] }))
  const row = await getPlan(pool, plan.id, null)
  expect(row.included_users).toBe(3)
  expect(row.user_prices).toHaveLength(1)
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm -w apps/control-plane run test -- -t "new plan columns"`
Expected: FAIL — column does not exist.

- [ ] **Step 3: Write the migration**

```sql
ALTER TABLE plan_revisions
  ADD COLUMN included_users integer NOT NULL DEFAULT 0 CHECK (included_users >= 0),
  ADD COLUMN included_storage_mb integer NOT NULL DEFAULT 0 CHECK (included_storage_mb >= 0),
  ADD COLUMN user_prices jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN storage_prices jsonb NOT NULL DEFAULT '[]'::jsonb;
```

Register version 25 in the loop in `db.ts` exactly like 24.

- [ ] **Step 4: Run the tests against a scratch database**

Run: `npm -w apps/control-plane run migrate` against `liwan_control_scratch_*` only, then `npm -w apps/control-plane run test`
Expected: PASS. Never run this against `liwan_control_dev` while the running console points at it.

- [ ] **Step 5: Commit**

```bash
git add apps/control-plane/src/schema_025.sql apps/control-plane/src/db.ts
git commit -m "feat(cp): add metered plan columns"
```

---

### Task 6: Validate a plan and carry the new columns through create, edit and publish

**Files:**
- Modify: `apps/control-plane/src/commercial/plans.ts` (`PLAN_COLS`, `planWire`, `planContent`, `planIssues`, `mutatePlan`)
- Test: `apps/control-plane/src/__tests__/commercial-plans.test.ts`

**Interfaces:**
- Consumes: Task 1 contract, Task 5 columns.
- Produces: `planIssues` refuses a plan with a missing unit price for an offered cadence (`code: 'unit_price_missing'`, `field: 'user_prices'`), a plan that still carries `users.limit`/`storage.limit_mb` (`platform_limit_derived`), or a currency mismatch between the plan and any referenced bundle.

- [ ] **Step 1: Write the failing tests**

```ts
it('refuses a monthly plan with no monthly users unit price', async () => {
  const issues = await planIssues(pool, row({ prices: [monthly(299)], user_prices: [], included_users: 3 }))
  expect(issues).toContainEqual({ code: 'unit_price_missing', field: 'user_prices' })
})
it('refuses a plan that still carries a users limit', async () => {
  const issues = await planIssues(pool, row({ platform_limits: { 'users.limit': 10 } }))
  expect(issues.some(i => i.code === 'platform_limit_derived')).toBe(true)
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm -w apps/control-plane run test -- -t "monthly users unit price"`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add the four names to `PLAN_COLS` and to the `INSERT`/`UPDATE` column lists and argument arrays — the four columns move together everywhere. Add the three checks to `planIssues`.

**AI fair-use (reviewer finding a):** `ai.messages.monthly: null` means unlimited, so "a cap that is not a customer-facing quantity" has nowhere to live. Owner decision 2026-10-25: keep it out of this phase; the AI application is sold with `null` and the fair-use limit is a term of service, not a system value. Record that in the plan's own text here so nobody invents a hidden key later. Extend `entitlementIssues` to pass the chosen quantities, using the plan's own `included_users`/`included_storage_mb` as the validation quantities so a plan is always quotable at its minimum.

- [ ] **Step 4: Run the tests**

Run: `npm -w apps/control-plane run test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(cp): validate metered plan pricing"
```

---

### Task 7: Publishing a plan withdraws its predecessor

**Files:**
- Modify: `apps/control-plane/src/commercial/plans.ts` (`mutatePlan`, `publish` branch)
- Test: `apps/control-plane/src/__tests__/commercial-plans.test.ts`

**Interfaces:**
- Produces: publishing plan revision *N* sets `available=false` on every other published revision of the same `plan_id`, in the same transaction.

- [ ] **Step 1: Write the failing test**

```ts
it('leaves exactly one sellable revision after publishing a successor', async () => {
  const v2 = await mutatePlan(pool, actor, v1.id, 'revisions', { edit_revision: 3, reason: 'reprice' })
  await mutatePlan(pool, actor, v2.id, 'validate', { edit_revision: 1, reason: 'ok' })
  await mutatePlan(pool, actor, v2.id, 'publish', { edit_revision: 2, reason: 'ok' })
  const sellable = (await pool.query("SELECT id FROM plan_revisions WHERE plan_id=$1 AND status='published' AND available", [v1.plan_id])).rows
  expect(sellable).toHaveLength(1)
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm -w apps/control-plane run test -- -t "exactly one sellable"`
Expected: FAIL — two rows.

- [ ] **Step 3: Implement**

Inside the `publish` branch, before returning: `UPDATE plan_revisions SET available=false, edit_revision=edit_revision+1 WHERE plan_id=$1 AND id<>$2 AND status='published'`. Write an audit row `plan.withdrawn_by_publish` naming the predecessor. **Do not do this for bundles in this phase** — a withdrawn bundle strands every published plan that references it (spec §10.1, reviewer finding 5); bundle withdrawal stays manual and the console warns instead (Task 10).

- [ ] **Step 4: Run the tests**

Run: `npm -w apps/control-plane run test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "fix(cp): withdraw the previous plan revision on publish"
```

---

### Task 8: Expose the sellable catalog and a non-persisting preview to the customer

**Files:**
- Modify: `apps/control-plane/src/commercial/customer-http.ts` (`customerCatalog`, add `POST /v1/customer/preview`)
- Modify: `apps/web/server/utils/customer-commercial.ts` (add the route to `ROUTES`/`NEEDS`)
- Test: `apps/control-plane/src/__tests__/commercial-customer-http.test.ts`

**Interfaces:**
- Produces: `buildQuote(pool, { customer_id, request, now }): Promise<Quote>` — the in-memory half of `createQuoteForCustomer` — plus `POST /v1/customer/preview` accepting `quoteRequestSchema` (minus `subscription_id`) and returning that `Quote` **without writing `commercial_quotes`**; `GET /v1/customer/catalog` already returns plans and bundles, now including their prices. Phase 2 calls `buildQuote` to price a trial.
- Consumes: `createQuoteForCustomer` refactored into a pure `buildQuote` plus a persisting wrapper.

- [ ] **Step 1: Write the failing tests**

```ts
it('previews a quote without writing a quote row', async () => {
  const before = await count(pool, 'commercial_quotes')
  const res = await customer('POST', '/v1/customer/preview', request)
  expect(res.status).toBe(200)
  expect(await count(pool, 'commercial_quotes')).toBe(before)
})
it('refuses a preview for another customer', async () => {
  expect((await customer('POST', '/v1/customer/preview', { ...request, customer_id: other })).status).toBe(404)
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm -w apps/control-plane run test -- -t "without writing a quote row"`
Expected: FAIL — 404 unknown route.

- [ ] **Step 3: Implement**

Split `createQuoteForCustomer` at the line that inserts into `commercial_quotes`; the preview path returns the same `Quote` object built in memory. Add the route in `customer-http.ts` gated by `subscription.read`. Add `{ method: 'POST', pattern: /^preview$/ }` to `ROUTES` and map it to `subscription.read` in `NEEDS`.

- [ ] **Step 4: Run the tests**

Run: `npm -w apps/control-plane run test && npm -w apps/web run test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(cp): preview a quote without persisting it"
```

---

### Task 9: Vendor console — price applications and the plan

**Files:**
- Modify: `apps/vendor-admin/app/components/vendor/PlanForm.vue`
- Modify: `apps/vendor-admin/app/components/vendor/BundleForm.vue`
- Modify: `apps/vendor-admin/app/utils/vendorCommercial.ts` (`planFields`, `planDraftFromView`, `emptyPlanDraft`, `planCreatePayload`, `planEditPayload`)
- Modify: `apps/vendor-admin/i18n/locales/{ar,en}/vendor.json`
- Test: `apps/vendor-admin/app/utils/__tests__/vendorCommercial.test.ts`

**Interfaces:**
- Consumes: Task 1 contract fields.
- Produces: the plan form edits `included_users`, `included_storage_mb`, `user_prices`, `storage_prices`; the bundle form shows a read-only list of the feature keys the application grants, sourced from the catalog release.

- [ ] **Step 1: Write the failing test**

```ts
it('round-trips the metered fields through a draft', () => {
  const draft = planDraftFromView(view({ included_users: 3, user_prices: [monthly(2500)] }))
  expect(planEditPayload(draft, view.policy_revision_id, 1).included_users).toBe(3)
  expect(planEditPayload(draft, view.policy_revision_id, 1).user_prices).toEqual([monthly(2500)])
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm -w apps/vendor-admin run test -- -t "metered fields"`
Expected: FAIL.

- [ ] **Step 3: Implement**

Reuse `VendorPriceListEditor` for the two new price lists (it already handles cadence, amount and per-row errors). Add two numeric fields for the included minimums beside `included_extra_branches`. On `/bundles/{id}`, add a read-only panel listing `release.applications.find(a => a.id === selection.app_id).features` filtered to `selectable && kind === 'boolean'`, labelled "this application grants these features" — no editing, because the application is the grant unit.

- [ ] **Step 4: Run the checks**

Run: `npm -w apps/vendor-admin run lint && npm -w apps/vendor-admin run test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(cp): price applications and metered units in the console"
```

---

### Task 10: Customer page — one screen with a live total

**Files:**
- Modify: `apps/web/app/pages/subscription/change.vue` (becomes the single configuration screen)
- Modify: `apps/web/app/components/subscription/*` (quantities panel beside the applications panel)
- Modify: `packages/commercial-ui/app/components/shared/commerce/PriceBreakdown.vue` (render `users` and `storage` kinds)
- Modify: `apps/web/i18n/locales/{ar,en}/subscription.json`
- Modify: `apps/web/app/components/Subscription*`
- Test: `apps/web/app/components/subscription/__tests__/*`, `packages/commercial-ui/app/components/shared/commerce/__tests__/PriceBreakdown.test.ts`

**Interfaces:**
- Consumes: `POST /api/commercial/v1/preview` (Task 8).
- Produces: section 1 application checkboxes with prices, section 2 users and storage steppers with the included minimum and unit price shown, section 3 branches, and a sticky summary that re-previews on every change with a 350 ms debounce and a sequence guard (the pattern already in `plans/[id].vue`).

- [ ] **Step 1: Write the failing test**

```ts
it('renders the users and storage lines from the quote', () => {
  const wrapper = mount(PriceBreakdown, { props: { quote: quoteWith({ users: 175, storage: 75 }), pending: false } })
  expect(wrapper.text()).toContain('المستخدمون')
  expect(wrapper.text()).toContain('175')
})
it('shows the base price and never a negative line below the minimum', () => {
  const wrapper = mount(PriceBreakdown, { props: { quote: quoteAtMinimum(), pending: false } })
  expect(wrapper.text()).not.toContain('-')
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm -w packages/commercial-ui run test`
Expected: FAIL — unknown line kind.

- [ ] **Step 3: Implement**

Add the two line kinds to `PriceBreakdown` with Arabic labels from the locale file. Build the screen from Storybook components only (`SharedRecordSection`, `SharedFormSection`, `SharedPageContainer`, `SharedPageHeader`). Steppers use `UInputNumber` with `:min="included"` so the server never sees an invalid quantity. Keep the existing prescriptive comment: the shown amount always comes from the server quote, never computed in the browser — reviewer finding b is exactly this: mirroring `computeQuote`'s half-up-per-line rounding in the browser produces a one-halala drift that customers do notice. A debounced preview call is cheap now that Task 8 stopped persisting quotes; without that change every keystroke would write an immutable `commercial_quotes` row.

- [ ] **Step 4: Run the checks**

Run: `npm -w apps/web run lint && npm -w packages/commercial-ui run test && npm -w apps/web run test`
Expected: PASS, and `node tools/ui_catalog.mjs --check` clean.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(web): one subscription screen with a live total"
```

---

### Task 11: Seed one platform plan and real application prices

**Files:**
- Create: `docs/superpowers/plans/2026-10-25-pricing-seed.md` (operator runbook, not code)
- Modify: `apps/control-plane/src/schema_025.sql` (data statements)
- Test: `apps/control-plane/src/__tests__/commercial-plans.test.ts`

**Interfaces:**
- Produces: exactly one published plan named `LiwanOS` whose `prices` are the base and whose `included_bundle_revision_ids` is empty; the six bundles carry placeholder prices marked in `approval_note`-style text as **unapproved**, and `trial_days: 14`.

- [ ] **Step 1: Write the failing test**

```ts
it('seeds exactly one sellable plan with no included applications', async () => {
  const rows = (await pool.query("SELECT * FROM plan_revisions WHERE status='published' AND available")).rows
  expect(rows).toHaveLength(1)
  expect(rows[0].included_bundle_revision_ids).toEqual([])
  expect(rows[0].trial_days).toBe(14)
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm -w apps/control-plane run test -- -t "exactly one sellable plan"`
Expected: FAIL — three plans.

- [ ] **Step 3: Write the seed**

Mark the three seeded plans unavailable (`UPDATE plan_revisions SET available=false`), insert one `LiwanOS` plan with placeholder base prices and `included_users: 3`, `included_storage_mb: 5120`, `included_extra_branches: 0`, and one monthly + one yearly unit price for users, storage and branches. Insert `prices` for the six bundles. Put `-- PLACEHOLDER, not approved: the owner replaces every amount from the console` at the top of the block.

- [ ] **Step 4: Run against a fresh scratch database**

Run: `npm run test:odoo -- --addons liwan_platform` is **not** needed; run only `npm -w apps/control-plane run test`.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/control-plane/src/schema_025.sql docs/superpowers/plans/2026-10-25-pricing-seed.md
git commit -m "feat(cp): seed one platform plan and placeholder application prices"
```

---

**What this phase does not deliver:** no trial, no renewal change, no VAT editing, no signup. Until Phase 2 lands, a customer bought through this screen is activated by the vendor console exactly as today.
