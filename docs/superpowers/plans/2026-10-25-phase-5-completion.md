# Phase 5 — Closing the loop: applications catalogue, the launch sellable list, and the operator runbook

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every application the owner intends to sell has a published bundle with a price and the right granted keys, the console refuses to publish a half-configured catalogue, and one document tells the operator exactly how to onboard a paying customer end to end.

**Architecture:** This phase is mostly completeness and guard rails, not new machinery. The catalog release already lists ten applications; the database has six bundles, which select only `*.enabled` and carry no prices. It fills the gaps, adds the publish-time check that would have caught every Phase 1–4 omission, and writes the runbook that replaces tribal knowledge.

**Tech Stack:** `apps/control-plane`, `packages/commercial-contracts`, `apps/vendor-admin`, `deploy/catalog/solutions/platform_v4.json`.

**Spec:** [docs/superpowers/specs/2026-10-24-self-service-pricing-and-trial-design.md](../specs/2026-10-24-self-service-pricing-and-trial-design.md) §2, §6, and reviewer findings 6 and 9.

**Phases 1–4 are prerequisites.** This phase assumes metered pricing, trial, VAT policy and renewal already work.

## Global Constraints

- The catalog release file `deploy/catalog/solutions/platform_v4.json` is shared with the Odoo side; any change runs `python3 -B tools/catalog_check.py --sync-release-copies` in the same commit.
- An application sold as one unit must ship a bundle whose `selections` cover it, and the compiler (Phase 1, Task 3) derives the granted keys from the application — so the bundle's `feature_keys` list is documentation, not the grant.
- A bundle with no price for a cadence the plan offers must not be publishable.
- **Payroll is granted commercially although its release gates are open** (owner decision 2026-10-25, reviewer finding 9). The HR application grants `hr.payroll`; the payroll screens keep their own gate and may refuse to operate. The commercial grant and the operational readiness are different questions and the UI must not imply otherwise.
- No `/register`. The customer is created from the vendor console.

## Review Focus

- **An application the customer bought that grants nothing** because its bundle lists only `*.enabled` while the compiler expects the full set.
- **A bundle priced in a currency the plan does not use** — must be refused at publish, not at checkout.
- **A customer whose HR purchase shows a working menu but a refusing payroll screen** — must be told why, in Arabic, not shown a broken page.
- **An operator following the runbook from a cold start** — every step must name the exact console page and the exact expected result.
- **A new application added to the catalog later** — must not silently become free or silently become unbuyable.

---

### Task 1: Every sellable application gets a complete bundle

**Files:**
- Modify: `apps/control-plane/src/schema_028.sql` (create; seeds the missing bundles and prices)
- Modify: `apps/control-plane/src/db.ts` (register 28)
- Test: `apps/control-plane/src/__tests__/commercial-catalog.test.ts`

**Interfaces:**
- Produces: one published bundle per sellable application, each with `selections` covering that application and `prices` for every cadence the plan offers.

- [ ] **Step 1: Write the failing test**

```ts
it('every selectable application has a published bundle with a price for each plan cadence', async () => {
  const release = await getRelease(pool, latestReleaseId)
  const plan = await getPlan(pool, planId, null)
  const cadences = plan.prices.map(key)
  const selectable = release.applications.filter(a => a.selectable).map(a => a.id)
  for (const appId of selectable) {
    const bundle = (await pool.query(
      "SELECT * FROM bundle_revisions WHERE status='published' AND available AND selections @> $1::jsonb",
      [JSON.stringify([{ app_id: appId }])])).rows[0]
    expect(bundle, `no bundle for ${appId}`).toBeTruthy()
    for (const c of cadences) expect(bundle.prices.map(key), `${appId} missing ${c}`).toContain(c)
  }
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm -w apps/control-plane run test -- -t "every selectable application"`
Expected: FAIL — six bundles, ten selectable applications, no prices.

- [ ] **Step 3: Implement**

Decide the launch list with the owner in one line each: which of the ten applications are **sold**, which are **always included free**, and which are **not sold**. Seed a published bundle per sold application, mark the free ones inside the base plan's `included_bundle_revision_ids`, and leave unsold ones without a bundle. Put the placeholders under a block comment `-- PLACEHOLDER prices, replaced by the owner from the console`.

- [ ] **Step 4: Run the tests**

Run: `npm -w apps/control-plane run test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/control-plane/src/schema_028.sql apps/control-plane/src/db.ts
git commit -m "feat(cp): seed a complete bundle for every sellable application"
```

---

### Task 2: Refuse to publish a half-configured catalogue

**Files:**
- Modify: `apps/control-plane/src/commercial/bundles.ts` (`bundleIssues`)
- Modify: `apps/control-plane/src/commercial/plans.ts` (`planIssues`)
- Test: `apps/control-plane/src/__tests__/commercial-plans.test.ts`, `apps/control-plane/src/__tests__/commercial-bundles.test.ts`

**Interfaces:**
- Produces: new issue codes `price_missing_for_cadence`, `currency_not_offered`, `selection_covers_nothing`, `free_application_without_selection`.

- [ ] **Step 1: Write the failing tests**

```ts
it('refuses a bundle with no price for an offered cadence', async () => {
  const issues = await bundleIssues(pool, row({ prices: [monthly(199)] }), { planCadences: ['month:1', 'year:1'] })
  expect(issues).toContainEqual({ code: 'price_missing_for_cadence', field: 'prices' })
})
it('refuses a published bundle whose selection names no application', async () => {
  const issues = await bundleIssues(pool, row({ selections: [] }), { planCadences: ['month:1'] })
  expect(issues).toContainEqual({ code: 'selection_covers_nothing', field: 'selections' })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm -w apps/control-plane run test -- -t "no price for an offered cadence"`
Expected: FAIL.

- [ ] **Step 3: Implement**

`bundleIssues` gains a `planCadences` argument supplied by the publishing path (the plan is known when a plan references the bundle; for a standalone bundle publish use the cadences of every published plan it could be sold with — if any plan offers a cadence the bundle does not price, refuse). Add a console warning before publishing a bundle that a published plan references, explaining that a new plan revision will be required (see Phase 1 Task 7's decision: bundles are never auto-withdrawn).

- [ ] **Step 4: Run the tests**

Run: `npm -w apps/control-plane run test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(cp): refuse to publish an unpriceable catalogue entry"
```

---

### Task 3: Tell the truth about payroll

**Files:**
- Modify: `apps/web/app/pages/hr/payroll/*` (the gate message)
- Modify: `apps/web/i18n/locales/{ar,en}/hr-payroll.json`
- Test: `apps/web/e2e/hr-payroll-mocked.spec.ts`

**Interfaces:**
- Consumes: the existing `hr.payroll` feature gate.
- Produces: when `hr.payroll` is granted but payroll release gates are still open, the screens render an explanatory state ("الرواتب قيد التحقق قبل الإطلاق") rather than an empty or failing page. When the feature is not granted at all, the existing "not included in your plan" state stays.

- [ ] **Step 1: Write the failing test**

```ts
test('a granted payroll feature with open release gates explains itself', async ({ page }) => {
  await openPayroll(page, { hrPayroll: true, releaseReady: false })
  await expect(page.getByText('الرواتب قيد التحقق قبل الإطلاق')).toBeVisible()
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd apps/web && npm run test:e2e -- hr-payroll-mocked`
Expected: FAIL.

- [ ] **Step 3: Implement**

One source of truth for that flag: the existing `features['hr.payroll']` grants access; a separate read of the payroll readiness state decides the message. Do not invent a second feature key.

- [ ] **Step 4: Run the checks**

Run: `cd apps/web && npm run test:e2e -- hr-payroll-mocked && npm -w apps/web run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(web): explain the payroll state when its release gates are open"
```

---

### Task 3b: The refund policy as written text and a manual procedure

The owner chose (spec §2.9) a written policy plus a documented manual procedure — no field, no automatic path. Today the machinery exists and is invisible: `processRefundOutbox` creates `credit_note` adjustment rows with `status='pending'` and `recordFulfillmentFailure` creates more, but no route lists them and no page shows them.

**Files:**
- Create: `docs/finance/refund-policy.md`
- Modify: `apps/control-plane/src/commercial/invoices.ts` (list adjustments with the invoice)
- Modify: `apps/vendor-admin/app/pages/invoices/[id].vue` (show pending credit notes)
- Test: `apps/control-plane/src/__tests__/commercial-invoices.test.ts`

**Interfaces:**
- Produces: `GET /v1/commercial/invoices/:id` includes an `adjustments` array `{ id, kind, reason, amount, currency, status }`; the console lists them read-only.

- [ ] **Step 1: Write the failing test**

```ts
it('lists the pending credit note of an invoice', async () => {
  await recordFulfillmentFailure(client, { order_id: order.id, reason: 'provisioning failed', actor: 'test' })
  const invoice = await vendor('GET', `/v1/commercial/invoices/${invoiceId}`)
  expect(invoice.data.adjustments).toEqual([expect.objectContaining({ kind: 'credit_note', status: 'pending' })])
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm -w apps/control-plane run test -- -t "pending credit note"`
Expected: FAIL — `adjustments` absent.

- [ ] **Step 3: Implement**

Read `invoice_adjustments` rows for the invoice in `getInvoice` and map them through a zod schema (`adjustmentSchema`) in the contracts package. Write the policy document: who may request a refund, the window, the method (same instrument via the gateway), who approves, what happens to a partially used period, and the exact console steps including the manual gateway refund. No code path issues a refund in this phase.

- [ ] **Step 4: Run the checks**

Run: `npm -w apps/control-plane run test && npm -w apps/vendor-admin run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(cp): show pending credit notes and document the refund policy"
```

---

### Task 4: The operator runbook

**Files:**
- Create: `docs/superpowers/plans/2026-10-25-commercial-operator-runbook.md`
- Modify: `docs/WORKSPACE.md` (one link)

**Interfaces:**
- Produces: the exact sequence an operator follows to onboard a paying customer, with the console page, the expected result, and the failure message that means stop.

- [ ] **Step 1: Write the runbook**

It must cover, in order: set the plan base price → set each application price → set the VAT rate → create the customer → send the invitation → the customer chooses applications and quantities in `/subscription` → start the trial (or pay) → verify the tenant entitlement matches what was chosen → verify the first invoice totals equal the quote → what to do when the tenant shows the wrong features. Each step names the console page and the button.

- [ ] **Step 2: Verify each step against a running stack**

Run: `PATH=/opt/homebrew/opt/node@22/bin:$PATH node tools/vendor_admin_local_check.mjs` and follow the runbook literally. Record every place the runbook and the product disagree, and fix the runbook (not the product) unless the product is wrong.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-10-25-commercial-operator-runbook.md docs/WORKSPACE.md
git commit -m "docs(docs): commercial operator runbook"
```

---

### Task 5: One end-to-end acceptance run

**Files:**
- Create: `docs/verification/2026-10-25-self-service-pricing-acceptance.md`
- Test: the acceptance list from the spec §11

**Interfaces:**
- Produces: a recorded run of all thirteen acceptance criteria, each with its command and its observed result, or an explicit "not verified" with the reason.

- [ ] **Step 1: Run each criterion**

For each of the thirteen items in the spec: run the scenario on a scratch stack, paste the command or click path, and record PASS / FAIL / BLOCKED with the evidence. Number them the same way the spec does.

- [ ] **Step 2: Fix what fails inside the owning phase's plan, not here**

If a criterion fails, the fix belongs to the phase that owns it. This task records, it does not repair. Re-run after the fix.

- [ ] **Step 3: Commit**

```bash
git add docs/verification/2026-10-25-self-service-pricing-acceptance.md
git commit -m "docs(docs): record the self-service pricing acceptance run"
```

---

**What this phase does not deliver:** self-service signup, a marketing site, or any deployment. Publication and merge stay with the owner under `docs/agents/integration-rules.md`.
