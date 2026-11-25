# Catalog, live entitlements and invoice-driven price

> Reviewed against the code on 2026-11-26. The first draft of this plan named a file that
> does not exist and treated four fallback queries as the entitlement source. Both are
> corrected below. Where a claim is not yet verified it is marked, not assumed.

**Branch family:** `cp-pricing-*`, one branch and one PR per part, in the order below.
**Owner decisions (final):** three console tabs; price and limits edited inside the
application record; catalog versions are plumbing and publish automatically; entitlements
follow the latest published release for the applications a customer already owns; price is
read at invoice time and applies from the next invoice with no retroactive charge; the
safety gates below.

## What the code does today (verified)

- A subscription names what it owns through `subscription_revisions.snapshot.bundle_revision_ids`
  (`commercial/orders.ts:232`). Each add-on bundle selects exactly one application; signup
  relies on that (`signup/offer.ts:29`).
- The entitlement is compiled against the release the owned bundles were built on
  (`bundles[0].catalog_release_id`). The four `ORDER BY created_at DESC` queries
  (`quotes.ts:57`, `plans.ts:49`, `quote-sources.ts:31`, `customer-http.ts:49`) are
  fallbacks used only when no bundle pins a release. They are not the entitlement source.
- Renewal reuses the frozen `snapshot.entitlement` and recompiles only on a trial checkout
  (`commercial/renewals.ts:59-60`).
- The tenant receives an entitlement through `enqueueAppliedDelivery`
  (`commercial/delivery-target.ts`), already used by `pushAiEntitlement` and `expiry-push.ts`.
  There is no `subscription-reconfigure.ts`.
- `computeQuote` prices a bundle from `b.prices`, and a customer's terms override that
  (`terms?.bundle_prices?.[b.id]`, `packages/commercial-contracts/.../quotes.ts:92`).
  `pricingBaseline` (`quote-sources.ts:40`) is what `owesAtRenewal` reads.
- Quote lines already have an `adjustment` kind (`commercial/billing.ts:21`). Invoice
  adjustments (`invoice_adjustments`) are a separate table for credit and debit notes and
  are not the place for a price-change line.
- `usage_snapshots` records per-tenant `metrics` and `limit_gates` (`commercial/usage.ts`).
- `COMPILER_VERSION` is `commercial-compiler/4` (`entitlements.ts:11`).

## The rule, in one table

| Change | Existing customer | When |
| --- | --- | --- |
| New feature in an owned application | Granted | On publish |
| New or raised limit | Granted | On publish |
| New application | Not granted; sold as an add-on | On purchase |
| Price raised | Next invoice, with a notice and its own line | Next invoice |
| Price lowered | Next invoice | Next invoice |
| Limit lowered below current use | Refused, naming the count | Never silent |
| Feature or limit removed that a published add-on, plan or entitlement uses | Refused | Never silent |
| Application removed from a plan with subscribers | Refused; keep for existing and deny to new, or schedule with notice | Owner's choice per case |

A customer's negotiated terms always win over the catalog price.

## Part 1 — Entitlements follow the latest release (sensitive)

Compile the entitlement against the latest published release for the applications the
subscription already owns, instead of the release its bundles were built on. This is a
behavior change, not a consolidation of the four fallbacks.

- `latestPublishedRelease(client)` in `commercial/catalog-releases.ts`.
- Renewal recompiles in `buildRenewalOn` against that release; plan, policy and terms stay
  pinned. The four fallback queries stay as they are unless a call site genuinely wants the
  latest; each touched site is named in the PR.
- Fan-out after publish, modelled on `expiry-push.ts`: re-deliver through
  `enqueueAppliedDelivery` for every subscription whose recomputed digest changed. No new
  writer, no new module.
- A new application is never added to `bundle_revision_ids`. Proven by a test.
- `COMPILER_VERSION` bumps so a stale compiled entitlement is recomputed.

Acceptance: a raised limit reaches an owning subscription after publish and not before; a
new application is never granted; the digest changes once. Price, invoice lines and notices
are untouched.

Verify: `npm -w apps/control-plane run build` and the commercial suites on a scratch database.

## Part 2 — Price follows the invoice (sensitive, money)

The invoice reads the latest published price of each owned add-on at invoice time. The
current period is never repriced.

- Substitution point: `computeQuote` (`quotes.ts:92`). At renewal, load the latest published
  revision of each owned `bundle_id` for pricing only. A customer's `terms.bundle_prices`
  still wins, so an agreed price is never overridden by the catalog.
- The visible line is a quote line of kind `adjustment` keyed `price_change:<bundle_id>`,
  not an `invoice_adjustments` row. `issueInvoiceFromQuote` copies quote lines, so no invoice
  schema change.
- Notice: a new `price_changed` value in the `BillingNoticeType` union
  (`billing-notices.ts:11`) with its sender, deduplicated per subscription, add-on and
  revision, queued in the same transaction as the renewal.
- `pricingBaseline` for the new period records the new price; the previous period's baseline
  is untouched, so `owesAtRenewal` and credit notes are unaffected.

Acceptance: a raised price invoices on the next cycle with one line and one notice, no
retroactive charge, and a terms-overridden price is unchanged.

Verify: the commercial billing and renewal suites on a scratch database.

## Part 3 — Automatic publish and the compatibility gate (sensitive)

Publishing runs in the release pipeline, not on boot: a boot job cannot fail a release and
races across instances.

- `commercial/catalog-gate.ts`, run inside the publish transaction after the repository
  checker. It refuses with a named code and a count:
  - `catalog_feature_removed`, `catalog_limit_removed`: a key used by a published add-on,
    plan or active entitlement is gone.
  - `catalog_limit_below_usage`: the new ceiling is below a current customer's recorded use.
    A missing or stale `usage_snapshots` row is treated as unknown and refuses, never as zero.
  - `catalog_app_in_use`: an application is dropped while a published add-on, plan or
    entitlement names it.
- Plan-level removal lives in `mutatePlan`: removing an add-on from a plan with subscribers
  is refused. The operator can keep it for existing customers and deny it to new ones
  (`available=false`, id kept in existing snapshots) or schedule the removal with notice.
- `control-admin catalog-sync <version>` imports, checks, publishes and creates the release
  idempotently (keyed by version), then queues the Part 1 fan-out. `deploy/release/release.py`
  runs it after migrations and fails the release on a non-zero exit. A failure is also an
  attention item.

Acceptance: each refusal names its code and count; a repeat sync is a no-op; a failed sync
fails the release.

Verify: the catalog suites on a scratch database, plus the release command's unit tests.

## Part 4 — Console: three tabs and the application settings (ordinary, money-adjacent)

- `CATALOG_TABS` becomes plans, add-ons, applications. "الحزم" becomes "الإضافات" in both
  locales with exact key parity.
- The application record gains the price and limits action, posting a new add-on revision
  and publish through the existing lifecycle, which already requires step-up.
- Routes move from `/bundles/*` to `/addons/*`, including the proxy allowlist and `returnTo`.

Verify: `npm -w apps/vendor-admin run lint` and `npm -w apps/vendor-admin run test`.

## Part 5 — Versions move to advanced settings (ordinary)

Read-only history. The manual validate and publish actions go once Part 3 lands.

## The parked branch

`cp-catalog-auto-validate` (PR #898, draft) keeps the application record, the version record
and the diff helper, which Parts 4 and 5 reuse. Its four-tab layout and manual publish
actions are rewritten or deleted. Its server half already landed separately as the import
gate. Do not merge #898 as it stands.

## Order

Part 1, then Part 2, then Part 3, in sequence: they share the compile path and the gate
reads Part 1's resolver. Part 4's rename can run beside Part 1; its removal of the publish
buttons and Part 5 wait for Part 3. Parts 1, 2 and 3 are sensitive and take the tester and
the critical reviewer before any push.

## What this does not change

The bundle tables stay the engine; the surface is renamed. Plans keep referencing add-on
revisions. No migration. Tenant isolation, capability checks, step-up and audit are
unchanged. Nothing here authorizes a release tag or a deployment.
