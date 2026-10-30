# Phase 2 — The 14-day trial, its counter, and its enforcement

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A customer starts a 14-day trial from `/subscription` with no payment method, receives the applications it chose, sees the days remaining, gets a warning before the end, and is moved to `past_due` — then `suspended` in Odoo — when it does not pay.

**Architecture:** A trial is an ordinary order whose `due_now` is zero, so it uses the existing provisioning and fulfillment path instead of a parallel one. Expiry is a scheduled job that both issues the first invoice and flips the state, because `applyDunning` only reacts to an overdue issued invoice. Suspension reaches Odoo through the existing `tenant.entitle` operation with a policy carrying `valid_until`, which Odoo already reads.

**Tech Stack:** as Phase 1, plus `apps/control-plane/src/commercial/scheduler.ts`, `tools/liwan_cli/operator.py` (policy shape), `odoo-addons/liwan_platform` (already enforces).

**Spec:** [docs/superpowers/specs/2026-10-24-self-service-pricing-and-trial-design.md](../specs/2026-10-24-self-service-pricing-and-trial-design.md) §7, §10.3, and reviewer findings 1 and 2.

**Phase 1 is a prerequisite.** Trial pricing uses the metered lines from Phase 1.

## Global Constraints

- A trial never issues an invoice at start; the first invoice covers the period **after** the trial ends (spec §7.3).
- `state='trialing'` must be reachable without a payment receipt; today only `fulfillment.ts:44` sets it, after applying a receipt (reviewer finding 1).
- One trial per customer (`customers.trial_used_at`).
- The expiry job is idempotent: running it twice on the same day produces one invoice and one state change.
- Notices are relative to `trial_days`: at `trial_days - 3` and `trial_days - 1`, not hard-coded day 11 and 13.
- Suspension is the existing whole-session block: Odoo answers `403 tenant_suspended` for every route except the support login path (`entitlement_service.py:112`). The customer is blocked from reading too, not just writing. Say so in the UI copy.
- No new `sudo()`; no Odoo source edits.
- Web and console strings in the owning locale namespaces.

## Review Focus

- **A customer who pays on day 14, hours before expiry** — must end `active` with no invoice for the trial period and no grace state.
- **A job that runs twice** because the previous run crashed mid-transaction — must not double-invoice or double-notify.
- **A customer suspended by expiry who then pays** — must be restored to `active` and regain the session without operator involvement.
- **A trial of an application the customer did not choose** — must not be granted, even accidentally through `included_bundle_revision_ids`.
- **Clock and timezone** — expiry uses Asia/Riyadh dates like the rest of the engine (`riyadhDate`), never the server's local time.

---

### Task 1: Record that a customer has used its trial

**Files:**
- Create: `apps/control-plane/src/schema_026.sql`
- Modify: `apps/control-plane/src/db.ts` (register version 26)
- Test: `apps/control-plane/src/__tests__/commercial-trial.test.ts`

**Interfaces:**
- Produces: `customers.trial_used_at timestamptz` (nullable).

- [ ] **Step 1: Write the failing test**

```ts
it('records the trial once per customer', async () => {
  await startTrial(pool, { customer_id: c.id, request, now })
  expect((await pool.query('SELECT trial_used_at FROM customers WHERE id=$1', [c.id])).rows[0].trial_used_at).toBeTruthy()
  await expect(startTrial(pool, { customer_id: c.id, request, now })).rejects.toMatchObject({ code: 'trial_already_used' })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm -w apps/control-plane run test -- -t "trial once per customer"`
Expected: FAIL — column missing.

- [ ] **Step 3: Write the migration**

```sql
ALTER TABLE customers ADD COLUMN trial_used_at timestamptz;
```

Register version 26 in the loop in `db.ts`.

- [ ] **Step 4: Run the tests**

Run: `npm -w apps/control-plane run test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/control-plane/src/schema_026.sql apps/control-plane/src/db.ts
git commit -m "feat(cp): record a consumed trial per customer"
```

---

### Task 2: Start a trial as a zero-due order

**Files:**
- Create: `apps/control-plane/src/commercial/trial.ts`
- Modify: `apps/control-plane/src/commercial/customer-http.ts` (`POST /v1/customer/trial`)
- Modify: `apps/web/server/utils/customer-commercial.ts` (allow `trial`)
- Test: `apps/control-plane/src/__tests__/commercial-trial.test.ts`

**Interfaces:**
- Produces: `startTrial(pool, { customer_id, request, principal, now }): Promise<{ order: Order; subscription: Subscription }>`; route `POST /v1/customer/trial` accepting `quoteRequestSchema` and returning `{ order, subscription }`.
- Consumes: the quote builder split done in Phase 1 Task 8 (`buildQuote` in memory, `createQuoteForCustomer` persisting), `trialEndsAt` (already exported at `renewals.ts:16` and dead until now), and the fulfillment outbox entry that `acceptQuote` already enqueues for a `not_required` order.

- [ ] **Step 1: Write the failing tests**

```ts
it('creates a zero-due order and sets trialing with trial_ends_at', async () => {
  const { order, subscription } = await startTrial(pool, { customer_id: c.id, request, principal, now })
  expect(order.due_now.minor).toBe(0)
  expect(order.payment_state).toBe('not_required')
  const sub = await getSubscription(pool, c.id)
  expect(sub.state).toBe('trialing')
  expect(daysBetween(now, new Date(sub.trial_ends_at!))).toBe(14)
})
it('does not write a quote amount during a trial', async () => {
  await startTrial(pool, { customer_id: c.id, request, principal, now })
  const invoices = await pool.query('SELECT count(*)::int AS n FROM invoices WHERE customer_id=$1', [c.id])
  expect(invoices.rows[0].n).toBe(0)
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm -w apps/control-plane run test -- -t "zero-due order"`
Expected: FAIL — `startTrial` does not exist.

- [ ] **Step 3: Implement**

`startTrial` runs in one transaction: refuse when `customers.trial_used_at` is set (`CommercialHttpError('trial_already_used', 409)`); build the quote through the non-persisting builder with `effective_date = today` and a period of `trial_days`; set `due_now` to zero and `payment_state='not_required'`; insert the order with an idempotency key `trial:<customer_id>`; set `subscriptions.state='trialing'` and `subscriptions.trial_ends_at = trialEndsAt(plan.trial_days, now)`; write `customers.trial_used_at = now()`; enqueue the existing fulfillment outbox entry so provisioning and entitlement happen exactly as for a paid order.

- [ ] **Step 4: Run the tests**

Run: `npm -w apps/control-plane run test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(cp): start a trial as a zero-due order"
```

---

### Task 3: End a trial — issue the first invoice and move the state

**Files:**
- Create: `apps/control-plane/src/commercial/trial-expiry.ts`
- Modify: `apps/control-plane/src/commercial/scheduler.ts` (new job `trial-expiry`)
- Test: `apps/control-plane/src/__tests__/commercial-trial.test.ts`

**Interfaces:**
- Produces: `expireTrials(pool, { now, adapter, allowedOrigin, return_path }): Promise<{ expired: string[] }>` — for every `trialing` subscription whose `trial_ends_at <= now`: set `state='active'` with `renewal_at = trial_ends_at`, then call the existing `generateRenewals` path so the **first** invoice is issued and, if no token exists, a hosted payment attempt is created.

- [ ] **Step 1: Write the failing tests**

```ts
it('ends a trial by issuing the first renewal invoice', async () => {
  const sub = await trialAt(now, { daysLeft: -1 })
  await expireTrials(pool, { now, adapter, allowedOrigin, return_path: '/subscription/status' })
  const after = await getSubscription(pool, c.id)
  expect(after.state).toBe('past_due')
  const invoices = await pool.query('SELECT count(*)::int AS n FROM invoices WHERE customer_id=$1', [c.id])
  expect(invoices.rows[0].n).toBe(1)
})
it('is idempotent across a repeated run', async () => {
  await expireTrials(pool, { now, adapter, allowedOrigin, return_path: '/x' })
  await expireTrials(pool, { now, adapter, allowedOrigin, return_path: '/x' })
  expect((await pool.query('SELECT count(*)::int AS n FROM invoices WHERE customer_id=$1', [c.id])).rows[0].n).toBe(1)
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm -w apps/control-plane run test -- -t "ends a trial by issuing"`
Expected: FAIL.

- [ ] **Step 3: Implement**

`expireTrials` selects `state='trialing' AND trial_ends_at <= $now FOR UPDATE SKIP LOCKED`, flips each to `active` with `renewal_at = date(trial_ends_at)`, then invokes `generateRenewals` in the same pass. Because `generateRenewals` is itself idempotent on `(subscription_id, period_start)` through the `renewals` unique index, a second run issues nothing new. Add the job to the scheduler beside `renewals`.

- [ ] **Step 4: Run the tests**

Run: `npm -w apps/control-plane run test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(cp): end a trial by issuing its first invoice"
```

---

### Task 4: Send Odoo the expiry date so suspension is real

**Files:**
- Modify: `apps/control-plane/src/commercial/fulfillment.ts` (reconfigure authority carries `valid_until`)
- Modify: `tools/liwan_cli/operator.py` (`_policy` writes `valid_until` into the policy document; `ENTITLE_SCRIPT` writes `profile.valid_until`)
- Test: `apps/control-plane/src/__tests__/commercial-trial.test.ts`, `tools/test_liwan_cli_operator.py`

**Interfaces:**
- Produces: the entitlement policy document gains `valid_until` (ISO date or `null`); `ENTITLE_SCRIPT` writes `{'features': …, 'valid_until': …}` on `liwan.tenant.profile`.
- Consumes: Odoo's existing read at `entitlement_service.py:51` — **no Odoo change is needed**.

- [ ] **Step 1: Write the failing tests**

```python
# tools/test_liwan_cli_operator.py — the policy document the operator writes
def test_policy_document_carries_the_expiry(self):
    payload = json.loads(_policy(self.policy_path(valid_until='2026-11-08')))
    self.assertEqual(payload['valid_until'], '2026-11-08')
def test_entitle_script_writes_valid_until(self):
    result = self.run_entitle_script(policy={'features': {...}, 'valid_until': '2026-11-08'})
    self.assertEqual(self.profile()['valid_until'], '2026-11-08')
```

Name the helpers after what already exists in that test module (`_policy`, the scratch-database runner); if neither exists, the task adds a minimal fixture rather than a new abstraction.

```ts
it('renews the tenant policy with the subscription expiry date', async () => {
  await expireTrials(pool, { now, adapter, allowedOrigin, return_path: '/x' })
  const op = await lastOperation(pool, 'tenant.entitle')
  expect(op.payload.policy.valid_until).toBe('2026-11-08')
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm -w apps/control-plane run test -- -t "subscription expiry date"` and `python3 -B -m unittest tools.test_liwan_cli_operator -k expiry`
Expected: FAIL.

- [ ] **Step 3: Implement**

Carry `valid_until = date(subscription.grace_ends_at ?? trial_ends_at + grace_days)` in the reconfigure authority payload. In `operator.py`, include it in the policy document; in `ENTITLE_SCRIPT`, write it beside `features` inside the same `OPERATOR_CONTEXT` write, and include it in the change comparison so an unchanged policy does not churn `policy_revision`.

- [ ] **Step 4: Run the tests**

Run: `npm -w apps/control-plane run test` and `python3 -B -m unittest tools.test_liwan_cli_operator`
Expected: PASS. Also run `npm run test:odoo -- --addons liwan_platform` on a scratch database to prove Odoo still refuses a suspended tenant.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(cp): send the tenant expiry date with the entitlement policy"
```

---

### Task 5: Trial notices, idempotent and relative to `trial_days`

**Files:**
- Create: `apps/control-plane/src/commercial/trial-notices.ts`
- Modify: `apps/web/app/pages/subscription/index.vue` (days-remaining banner)
- Modify: `apps/web/i18n/locales/{ar,en}/subscription.json`
- Test: `apps/control-plane/src/__tests__/commercial-trial.test.ts`

**Interfaces:**
- Produces: `sendTrialNotices(pool, { now, mail }): Promise<number>` writing one `commercial_outbox` row per `(subscription_id, threshold)` with `dedupe_key = 'trial-notice:<subscription_id>:<threshold>'`; the UI reads `trial_ends_at` from `GET /v1/customer/subscription` (already returned by `subscriptions.ts:27`).

- [ ] **Step 1: Write the failing test**

```ts
it('writes each notice threshold exactly once', async () => {
  await trialAt(now, { daysLeft: 2 })
  expect(await sendTrialNotices(pool, { now, mail })).toBe(1)
  expect(await sendTrialNotices(pool, { now, mail })).toBe(0)
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm -w apps/control-plane run test -- -t "each notice threshold"`
Expected: FAIL.

- [ ] **Step 3: Implement**

Thresholds are `trial_days - 3` and `trial_days - 1` days remaining. The mail body names the date and the amount of the first invoice; SMTP absence never blocks the state change. Add the days-remaining banner to `/subscription` using already-present data — no new endpoint.

- [ ] **Step 4: Run the checks**

Run: `npm -w apps/control-plane run test && npm -w apps/web run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(cp): send trial notices before expiry"
```

---

### Task 6: Console — extend, end, and convert a trial

**Files:**
- Modify: `apps/vendor-admin/app/pages/customers/[id].vue` (trial panel)
- Create: `apps/vendor-admin/app/components/vendor/TrialPanel.vue` + story
- Modify: `apps/control-plane/src/commercial/routes-b.ts` (`POST /v1/commercial/trials/:subscription_id/extend`, `.../end`)
- Test: `apps/control-plane/src/__tests__/commercial-trial.test.ts`

**Interfaces:**
- Produces: both routes require `vendor.subscriptions.manage` + step-up, take `{ days, reason }` / `{ reason }` and are audited.

- [ ] **Step 1: Write the failing tests**

```ts
it('extends a trial and audits it', async () => {
  const res = await vendor('POST', `/v1/commercial/trials/${sub.id}/extend`, { days: 7, reason: 'promised more time' })
  expect(res.status).toBe(200)
  expect((await lastAudit(pool)).action).toBe('trial.extended')
})
it('refuses an extension without a reason', async () => {
  expect((await vendor('POST', `/v1/commercial/trials/${sub.id}/extend`, { days: 7 })).status).toBe(422)
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm -w apps/control-plane run test -- -t "extends a trial"`
Expected: FAIL.

- [ ] **Step 3: Implement**

Both routes operate only on a `trialing` subscription of the current company. Extend adds days to `trial_ends_at`; end sets it to `now` and runs `expireTrials` for that one subscription. Panel shows state, `trial_ends_at`, days remaining, and the two actions behind an inline confirm.

- [ ] **Step 4: Run the checks**

Run: `npm -w apps/control-plane run test && npm -w apps/vendor-admin run lint && npm -w apps/vendor-admin run test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(cp): manage trials from the vendor console"
```

---

**What this phase does not deliver:** no automatic card charge (Phase 4), no VAT editing (Phase 3), no signup (out of scope).
