# Phase 3 — A VAT rate the owner can change from the console

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The owner changes the VAT rate from the vendor console; new quotations use the new rate, and every already-issued invoice keeps the rate it was issued with.

**Architecture:** A rate change is a **new row** in `pricing_policy_revisions`. Three locks that today make any other rate impossible are opened together: the table `CHECK` that admits only `1500`, the contract's `z.literal(1500)`, and the missing write route. The immutability trigger stays, so history cannot be rewritten. Quoting stops reading the policy pinned on the plan and reads the newest approved revision instead; renewals keep reading the pinned one.

**Tech Stack:** Postgres 16, `packages/commercial-contracts`, `apps/control-plane`, `apps/vendor-admin`.

**Spec:** [docs/superpowers/specs/2026-10-24-self-service-pricing-and-trial-design.md](../specs/2026-10-24-self-service-pricing-and-trial-design.md) §4.4, and reviewer finding 4.

## Global Constraints

- `pricing_policy_revisions` rows are immutable: no `UPDATE`, no `DELETE`. The trigger stays exactly as it is.
- Historical invoices must remain reproducible: an issued invoice's tax line is stored, never recomputed.
- A renewal keeps the rate pinned on its subscription snapshot. A new rate never silently re-prices an agreed subscription.
- Rules and rounding (`Asia/Riyadh`, `half_up_per_line`) are not editable in this phase.
- The rate is basis points, an integer `0…10000`; `tax_kind='none'` requires `tax_rate_bps IS NULL`.
- Only `vendor.pricing.manage` with a fresh step-up may create a revision; every creation is audited with a reason.

## Review Focus

- **A rate of 0** meaning "no tax" rather than "the field is unset" — must be expressible without colliding with `tax_kind='none'`.
- **A quote started before the change and accepted after it** — the amount the customer saw must be what it pays, so the policy is captured into the quote, not re-read at acceptance.
- **A renewal invoice issued the same day as a rate change** — must use the pinned rate, not the new one.
- **The tax line on an existing invoice** — must not move when the rate changes.
- **A rate change with a plan still pointing at the old policy** — must not make the plan unquotable.

---

### Task 1: Loosen the rate in the schema and the contract

**Files:**
- Create: `apps/control-plane/src/schema_027.sql`
- Modify: `apps/control-plane/src/db.ts` (register 27)
- Modify: `packages/commercial-contracts/src/commercial/schemas.ts` (`pricingPolicySchema`)
- Test: `packages/commercial-contracts/src/__tests__/commercial-entitlements.test.ts`

**Interfaces:**
- Produces: `tax_rate_bps` admits any integer `0…10000`; `pricingPolicySchema.rate_bps` is `z.number().int().min(0).max(10000)`.

- [ ] **Step 1: Write the failing test**

```ts
it('accepts a rate other than 15 percent', () => {
  expect(pricingPolicySchema.safeParse({ ...policy, tax: { kind: 'vat_exclusive', rate_bps: 500 } }).success).toBe(true)
  expect(pricingPolicySchema.safeParse({ ...policy, tax: { kind: 'vat_exclusive', rate_bps: 10001 } }).success).toBe(false)
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm -w packages/commercial-contracts run test -- -t "other than 15 percent"`
Expected: FAIL — literal 1500.

- [ ] **Step 3: Implement**

Migration drops the old constraint and adds a general one:

```sql
ALTER TABLE pricing_policy_revisions DROP CONSTRAINT pricing_policy_revisions_check;
ALTER TABLE pricing_policy_revisions ADD CONSTRAINT pricing_policy_revisions_check CHECK (
  (tax_kind = 'vat_exclusive' AND tax_rate_bps BETWEEN 0 AND 10000) OR
  (tax_kind = 'none' AND tax_rate_bps IS NULL)
);
```

(The seeded constraint is the unnamed `CHECK ((tax_kind='vat_exclusive' AND tax_rate_bps=1500) OR …)` from `schema_012.sql`, which Postgres named `pricing_policy_revisions_check`; the replacement reuses that name so a later `DROP … IF EXISTS` stays idempotent. The `rounding`, `status`, `tax_kind` and `timezone` checks are separate and untouched.)

Replace `z.literal(1500)` with the range. The trigger is untouched.

- [ ] **Step 4: Run the tests**

Run: `npm -w packages/commercial-contracts run test && npm -w apps/control-plane run test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(cp): admit a configurable VAT rate"
```

---

### Task 2: Create a policy revision from the console

**Files:**
- Modify: `apps/control-plane/src/commercial/policies.ts` (`createPolicy`)
- Modify: `apps/control-plane/src/commercial/http.ts` (`POST /policies`)
- Test: `apps/control-plane/src/__tests__/commercial-policies.test.ts`

**Interfaces:**
- Produces: `createPolicy(pool, actor, { tax_kind, tax_rate_bps, currency, approval_note, reason })`; route gated by `vendor.pricing.manage` + step-up; returns the new `PricingPolicy`.
- Consumes: `listPolicies` (already returns newest first by `created_at`).

- [ ] **Step 1: Write the failing tests**

```ts
it('creates a new policy revision and keeps the old one', async () => {
  const created = await vendor('POST', '/v1/commercial/policies', { tax_kind: 'vat_exclusive', tax_rate_bps: 500, currency: 'SAR', approval_note: 'rate change', reason: 'ministry announcement' })
  expect(created.status).toBe(201)
  const all = (await vendor('GET', '/v1/commercial/policies')).data.items
  expect(all).toHaveLength(2)
  expect(all[0].tax.rate_bps).toBe(500)          // newest first
})
it('refuses a rate without a reason', async () => {
  expect((await vendor('POST', '/v1/commercial/policies', { tax_kind: 'vat_exclusive', tax_rate_bps: 500, currency: 'SAR', approval_note: 'x' })).status).toBe(422)
})
it('still refuses to rewrite a policy revision in place', async () => {
  await expect(pool.query("UPDATE pricing_policy_revisions SET tax_rate_bps=0 WHERE id=$1", [existing.id]))
    .rejects.toThrow(/pricing_policy_immutable/)
})
```

The third test is the regression guard for the immutability trigger (`pricing_policy_guard`, installed by `schema_012.sql`): the new write route must never tempt anyone to loosen it.

- [ ] **Step 2: Run to confirm failure**

Run: `npm -w apps/control-plane run test -- -t "new policy revision"`
Expected: FAIL — route missing.

- [ ] **Step 3: Implement**

`createPolicy` inserts a row with a fresh UUID, `status='approved'`, `approval_note` from the caller and an audit row `policy.created` carrying the reason and both rates. Refuse `currency` that differs from the existing policies' currency unless the caller explicitly confirms (`replace_currency: true`) — a currency change re-prices every future invoice and must not be accidental.

- [ ] **Step 4: Run the tests**

Run: `npm -w apps/control-plane run test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(cp): create a pricing policy revision from the console"
```

---

### Task 3: Quote with the newest approved policy

**Files:**
- Modify: `apps/control-plane/src/commercial/quotes.ts` (`loadQuoteSources`, `createQuoteForCustomer`)
- Test: `apps/control-plane/src/__tests__/commercial-quotes.test.ts`

**Interfaces:**
- Produces: `loadQuoteSources` takes `policy_revision_id?: string | null`; when absent it selects `SELECT * FROM pricing_policy_revisions WHERE status='approved' ORDER BY created_at DESC, id DESC LIMIT 1`. Quotes record the chosen revision in `quote.policy_revision_id` as today.
- Consumes: `renewals.ts` keeps passing `snapshot.policy_revision_id`, so renewals are unaffected.

- [ ] **Step 1: Write the failing tests**

```ts
it('a new quote uses the newest policy after a rate change', async () => {
  await createPolicy(pool, actor, { tax_kind: 'vat_exclusive', tax_rate_bps: 500, currency: 'SAR', approval_note: 'x', reason: 'rate change' })
  const q = await createQuoteForCustomer(pool, { customer_id: c.id, request }, now)
  expect(q.lines.find(l => l.kind === 'tax')!.amount.minor).toBe(Math.round(299 * 100 * 0.05))
})
it('a renewal keeps the pinned policy', async () => {
  // subscription created before the change
  await generateRenewals(pool, { now: later, adapter, allowedOrigin, return_path: '/x' })
  const invoice = await firstInvoice(pool, c.id)
  expect(invoiceTaxRate(pool, invoice.id)).toBe(1500)
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm -w apps/control-plane run test -- -t "newest policy after a rate change"`
Expected: FAIL — still reads the plan's policy.

- [ ] **Step 3: Implement**

Change the `policyResult` query in `loadQuoteSources` to prefer an explicit `policy_revision_id` and fall back to the newest approved row. Leave `plan.policy_revision_id` in place: it stays the *plan's declared* policy for validation, but it no longer forces the quote's rate. Update `planIssues`' policy check to accept any approved revision.

- [ ] **Step 4: Run the tests**

Run: `npm -w apps/control-plane run test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(cp): quote with the newest approved policy"
```

---

### Task 4: Move one subscription onto a new policy, deliberately

**Files:**
- Modify: `apps/control-plane/src/commercial/routes-b.ts` (`POST /v1/commercial/subscriptions/:id/policy`)
- Test: `apps/control-plane/src/__tests__/commercial-policies.test.ts`

**Interfaces:**
- Produces: route taking `{ policy_revision_id, reason }`, gated by `vendor.subscriptions.manage` + step-up; it re-quotes at the subscription's pinned everything-else, records the new revision in a new `subscription_revisions` snapshot, and audits `subscription.policy_moved`.

- [ ] **Step 1: Write the failing test**

```ts
it('moves a subscription onto a new policy with a new snapshot', async () => {
  const res = await vendor('POST', `/v1/commercial/subscriptions/${sub.id}/policy`, { policy_revision_id: newPolicy.id, reason: 'annual review' })
  expect(res.status).toBe(200)
  const snap = await snapshotOf(pool, sub.id)
  expect(snap.policy_revision_id).toBe(newPolicy.id)
  expect((await lastAudit(pool)).action).toBe('subscription.policy_moved')
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm -w apps/control-plane run test -- -t "onto a new policy"`
Expected: FAIL — 404.

- [ ] **Step 3: Implement**

Reuse the quote builder with an explicit `policy_revision_id`, write a new `subscription_revisions` row (it is immutable, so this is a new revision, not an edit), and leave the current period's invoice untouched. The change applies from the next renewal.

- [ ] **Step 4: Run the tests**

Run: `npm -w apps/control-plane run test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(cp): move a subscription to a new policy revision"
```

---

### Task 5: Console — a policy screen

**Files:**
- Create: `apps/vendor-admin/app/pages/policies.vue` + `app/components/vendor/PolicyForm.vue` + story
- Modify: `apps/vendor-admin/server/utils/proxy.ts` (allow `POST /v1/commercial/policies`)
- Modify: `apps/vendor-admin/i18n/locales/{ar,en}/vendor.json`
- Test: `apps/vendor-admin/app/utils/__tests__/vendorCommercial.test.ts`

**Interfaces:**
- Consumes: `GET`/`POST /v1/commercial/policies`.
- Produces: a read-only list of revisions with rate, effective date and note, and one action that opens a form asking rate and reason behind step-up.

- [ ] **Step 1: Write the failing test**

```ts
it('formats basis points as a percentage for the console', () => {
  expect(rateLabel(1500)).toBe('15')
  expect(rateLabel(500)).toBe('5')
  expect(parseRate('7.5')).toBe(750)
  expect(parseRate('abc')).toBeNull()
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm -w apps/vendor-admin run test -- -t "basis points"`
Expected: FAIL.

- [ ] **Step 3: Implement**

The page lists revisions newest first with a warning that the newest applies to new quotations only. The form takes a percentage with two decimals, converts to basis points, requires a reason of at least three characters, and shows the previous rate beside the new one before confirming.

- [ ] **Step 4: Run the checks**

Run: `npm -w apps/vendor-admin run lint && npm -w apps/vendor-admin run test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(cp): policy screen in the vendor console"
```

---

**What this phase does not deliver:** other tax kinds, per-customer rate overrides, and tax reporting. Only one national rate at a time.
