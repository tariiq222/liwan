# Phase 4 — Automatic renewal on the agreed price

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A customer who accepts automatic renewal is charged on its renewal date with no manual step, and a customer who does not, receives an invoice with a payment link. Either way, nobody is surprised by a charge or a price.

**Architecture:** The charge path, the consent columns and the UI all exist; what is missing is the **token**: nothing in the repository ever writes `provider_token_ref`, so the console's "enable automatic renewal" button is refused with `409 token_required` forever. This phase stores the token once, at payment confirmation, behind a narrow adapter seam so the real gateway can arrive later. It also adds the pre-charge notice, which current code lacks entirely.

**Tech Stack:** `apps/control-plane` (`payments.ts`, `renewals.ts`, `payment-adapter.ts`), Postgres 16, `apps/web`, `apps/vendor-admin`.

**Spec:** [docs/superpowers/specs/2026-10-24-self-service-pricing-and-trial-design.md](../specs/2026-10-24-self-service-pricing-and-trial-design.md) §8, §8.1.

**Phase 2 is a prerequisite** only for a trial that converts; renewal itself works for a subscription whose first invoice is paid.

## Global Constraints

- The renewal price is the **pinned snapshot** (plan, bundles, policy, terms). A new list price never reaches an existing renewal without an explicit re-quote (spec §8.1).
- **Only a reference is stored.** Never a PAN, never a CVV, never the provider's full response. The column is `provider_token_ref` and it holds the provider's opaque token id.
- A token is per subscription, not per customer: a second subscription does not inherit it.
- Automatic renewal needs three conditions together — `auto_renew_enabled`, `auto_renew_consent_at`, and a token — and the DB already enforces the first two (`schema_013.sql:30`).
- A refused or failed charge never retries more than the dunning window allows; it lands `past_due` inside `grace_days`.
- The customer may turn automatic renewal off at any time and the next charge must not happen.
- No secret is logged (`redact()` already exists in the mail adapter; mirror the pattern).

## Review Focus

- **A customer who pays once, then never returns** — the first payment must establish the token, or automatic renewal can never be enabled.
- **Double opt-in** — turning renewal on must be a consented action, not a default smuggled in at purchase.
- **A notice that arrives after the charge** — useless; the notice must precede the charge by the plan's lead time.
- **A price change between purchase and renewal** — must not alter the charge.
- **A token the provider has revoked** — `getToken(...).active === false` must fall back to a hosted payment link, never silently fail the renewal.

---

### Task 1: Capture the token at payment confirmation

**Files:**
- Modify: `apps/control-plane/src/commercial/payment-adapter.ts` (add `tokenize` to the interface)
- Modify: `apps/control-plane/src/commercial/moyasar-adapter.ts`, `apps/control-plane/src/commercial/payment-simulator.ts`
- Modify: `apps/control-plane/src/commercial/payments.ts` (store on confirmation)
- Test: `apps/control-plane/src/__tests__/commercial-payments.test.ts`

**Interfaces:**
- Produces: `PaymentAdapter.captureToken?(paymentRef: string): Promise<{ token_ref: string } | null>`; on a **confirmed** payment for a subscription order, `subscriptions.provider_token_ref` is set once.
- Consumes: the existing confirmation path in `payments.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
it('stores the provider token once a subscription payment is confirmed', async () => {
  await confirmPayment(pool, { adapter: tokenizingAdapter, order_id: order.id })
  expect((await getSubscription(pool, c.id)).auto_renew.token_ref_present).toBe(true)
})
it('never overwrites an existing token', async () => {
  await confirmPayment(pool, { adapter: tokenizingAdapter, order_id: secondOrder.id })
  expect(await tokenRef(pool, sub.id)).toBe('tok_first')
})
it('stores nothing when the provider cannot tokenize', async () => {
  await confirmPayment(pool, { adapter: plainAdapter, order_id: order.id })
  expect(await tokenRef(pool, sub.id)).toBeNull()
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm -w apps/control-plane run test -- -t "stores the provider token"`
Expected: FAIL — no such field, no such call.

- [ ] **Step 3: Implement**

Add the optional adapter method. In the confirmation transaction, after the payment is marked succeeded and the order has a `subscription_id`, call `captureToken` outside the transaction boundary (it is I/O), then `UPDATE subscriptions SET provider_token_ref=$1 WHERE id=$2 AND provider_token_ref IS NULL`. Accept only a string of 8–255 characters matching `^[\w:.-]+$`; reject anything else and log nothing about its content.

- [ ] **Step 4: Run the tests**

Run: `npm -w apps/control-plane run test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(cp): capture the payment token at confirmation"
```

---

### Task 2: A pre-charge notice that actually precedes the charge

**Files:**
- Create: `apps/control-plane/src/commercial/renewal-notices.ts`
- Modify: `apps/control-plane/src/commercial/scheduler.ts`
- Modify: `apps/control-plane/src/schema_026.sql` → use the existing `commercial_outbox` dedupe key, no new table
- Test: `apps/control-plane/src/__tests__/commercial-renewals.test.ts`

**Interfaces:**
- Produces: `sendRenewalNotices(pool, { now, mail, lead_days }): Promise<number>` writing one outbox row per `(subscription_id, renewal_at)` with `dedupe_key = 'renewal-notice:<subscription_id>:<renewal_at>'`.

- [ ] **Step 1: Write the failing test**

```ts
it('notices each upcoming renewal once and before it fires', async () => {
  await activeAt(now, { renewalInDays: 5 })
  expect(await sendRenewalNotices(pool, { now, mail, lead_days: 7 })).toBe(1)
  expect(await sendRenewalNotices(pool, { now, mail, lead_days: 7 })).toBe(0)
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm -w apps/control-plane run test -- -t "upcoming renewal once"`
Expected: FAIL.

- [ ] **Step 3: Implement**

Select `state IN ('active','past_due') AND renewal_at <= today + lead_days` and `auto_renew_enabled`, write the notice with the exact amount of the next invoice (computed with `computeQuote` from the pinned snapshot, so the customer sees the real number), and mention how to turn it off. `lead_days` comes from the env (`WEBVUE_RENEWAL_NOTICE_DAYS`, default 7) and is asserted to be greater than zero.

- [ ] **Step 4: Run the tests**

Run: `npm -w apps/control-plane run test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(cp): notify before an automatic renewal"
```

---

### Task 3: The charge itself, with a safe fallback

**Files:**
- Modify: `apps/control-plane/src/commercial/renewals.ts` (`generateRenewals`, the token branch)
- Test: `apps/control-plane/src/__tests__/commercial-renewals.test.ts`

**Interfaces:**
- Consumes: `provider_token_ref` (Task 1), the existing `chargeToken` call at `renewals.ts:95`.
- Produces: on a token that is missing, inactive or whose charge throws, the renewal keeps its invoice and receives a hosted payment attempt instead of a dead end; a `payment_attempts` row with `status='unknown'` is created exactly once.

- [ ] **Step 1: Write the failing tests**

```ts
it('falls back to a hosted link when the token is inactive', async () => {
  await inactiveTokenAt(now, { renewalInDays: 0 })
  await generateRenewals(pool, { now, adapter, allowedOrigin, return_path: '/subscription/status' })
  const attempts = await attemptsOf(pool, sub.id)
  expect(attempts.some(a => a.redirect_url)).toBe(true)
})
it('records one unknown attempt when the charge throws', async () => {
  await throwingAdapterAt(now, { renewalInDays: 0 })
  await generateRenewals(pool, { now, adapter: throwingAdapter, allowedOrigin, return_path: '/x' })
  expect((await attemptsOf(pool, sub.id)).filter(a => a.status === 'unknown')).toHaveLength(1)
})
it('charges the pinned amount even after a list price change', async () => {
  await repriceEveryPublishedPlan(pool)
  await generateRenewals(pool, { now, adapter, allowedOrigin, return_path: '/x' })
  expect(await lastInvoiceTotal(pool, c.id)).toBe(originalTotal)
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm -w apps/control-plane run test -- -t "hosted link when the token is inactive"`
Expected: FAIL — the current code treats only `active === false`, and a throwing `getToken` is swallowed into the same branch without recording the attempt.

- [ ] **Step 3: Implement**

Tighten the existing branch: treat `getToken` throwing the same as `active === false`; ensure the `unknown` state is written once and only for a thrown `chargeToken`; never create a second live attempt while one is in `unknown` (the unique index `payment_attempts_one_live` already supports this).

- [ ] **Step 4: Run the tests**

Run: `npm -w apps/control-plane run test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "fix(cp): fall back to a hosted link when a renewal charge cannot run"
```

---

### Task 4: Customer control over automatic renewal

**Files:**
- Modify: `apps/web/app/components/subscription/AutoRenewControl.vue` (show the next amount and date)
- Modify: `apps/web/i18n/locales/{ar,en}/subscription.json`
- Test: `apps/web/app/components/subscription/__tests__/autoRenew.test.ts`

**Interfaces:**
- Consumes: `POST /api/commercial/v1/auto-renew` (exists), `GET /api/commercial/v1/subscription` (exists).
- Produces: the control states plainly what will be charged, when, and that turning it off stops the charge. When no token exists the button explains that the first payment must complete before automatic renewal is available, instead of failing silently.

- [ ] **Step 1: Write the failing test**

```ts
it('explains why automatic renewal is unavailable without a token', () => {
  const wrapper = mount(AutoRenewControl, { props: { enabled: false, canManage: true, pending: false, hydrated: true, tokenPresent: false, nextAmount: null } })
  expect(wrapper.text()).toContain('بعد أول دفعة')
})
it('shows the next charge amount and date when enabled', () => {
  const wrapper = mount(AutoRenewControl, { props: { enabled: true, canManage: true, pending: false, hydrated: true, tokenPresent: true, nextAmount: { minor: 28635, currency: 'SAR', exponent: 2 }, nextDate: '2026-11-24' } })
  expect(wrapper.text()).toContain('286.35')
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm -w apps/web run test -- -t "automatic renewal is unavailable"`
Expected: FAIL.

- [ ] **Step 3: Implement**

Pass `tokenPresent` from the subscription payload (`auto_renew.token_ref_present` already exists). Keep the flow server-confirmed: pending until the response, no optimistic flip.

- [ ] **Step 4: Run the checks**

Run: `npm -w apps/web run lint && npm -w apps/web run test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(web): show the next charge before enabling automatic renewal"
```

---

### Task 5: Console visibility on renewals

**Files:**
- Modify: `apps/vendor-admin/app/pages/customers/[id].vue`
- Create: `apps/vendor-admin/app/components/vendor/RenewalPanel.vue` + story
- Test: `apps/vendor-admin/app/utils/__tests__/vendorSubscriptions.test.ts`

**Interfaces:**
- Consumes: `GET /v1/commercial/subscriptions/:id` (exists) — it already returns `auto_renew` and `next_renewal_at`.
- Produces: a panel showing state, next charge date and amount, whether a token exists, and a toggle that requires a reason and is audited.

- [ ] **Step 1: Write the failing test**

```ts
it('marks a subscription without a token as unable to auto-renew', () => {
  expect(renewalRisk({ auto_renew: { enabled: true, token_ref_present: false } })).toBe('token_missing')
  expect(renewalRisk({ auto_renew: { enabled: true, token_ref_present: true } })).toBe('ok')
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm -w apps/vendor-admin run test -- -t "unable to auto-renew"`
Expected: FAIL.

- [ ] **Step 3: Implement**

The panel warns when `enabled && !token_ref_present` — a state the database permits but which can only mean a token was revoked or lost.

- [ ] **Step 4: Run the checks**

Run: `npm -w apps/vendor-admin run lint && npm -w apps/vendor-admin run test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(cp): renewal panel in the vendor console"
```

---

**What this phase does not deliver:** 3DS, webhook reconciliation and refunds — those remain #10. This phase makes automatic renewal work with whichever adapter is configured and degrades to a hosted link otherwise.
