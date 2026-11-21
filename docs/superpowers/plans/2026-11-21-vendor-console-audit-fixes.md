# Vendor console and control plane: audit fixes plan

> Source: an external audit of `apps/vendor-admin`, `apps/control-plane` and `packages/commercial-contracts`
> (run on `main` at `506dca1dc`), checked claim by claim against the code on 2026-11-21. Status: written on
> 2026-11-21, not approved, nothing built. Each row below is a requirement candidate, not implementation present
> in a branch.

## 1. What was checked

Thirty-five numbered claims and two operator gaps were read against the code by four independent reviewers. Nothing
was run: every verdict is from reading code, so each task starts by reproducing its failure in a test.

| Verdict | Claims |
| --- | --- |
| Confirmed | 1, 2, 7, 8, 9, 12, 14, 16, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 34, 35; no later catalog release; no recover button |
| Partly (the defect exists, narrower than described) | 3, 4, 5, 10, 11, 15, 17, 32, 33 |
| Refuted (no task) | 6, 13 |
| Not checked | 36, the rest of the operator-gap table, the UX, locale and performance section |

Refuted, with the reason:

- **6** (fallback sign-in users cannot step up): enrollment requires a passkey, so every account has one.
- **13** (alert flood every five minutes): `renewal_failure` is written only when a renewal or dunning attempt
  throws; there is no clear-then-rewrite cycle.

Already done on branch `claude/gallant-gauss-gxh9lh` (`201a59d88`, not pushed): the console page for catalog
versions with validate and publish, and the audit link for catalog entries (part of claim 32).

## 2. Tasks

One task is one logical change with its tests. The order is priority, not phases: any task can start once its
"needs" column is empty or decided. `CP` is `apps/control-plane/src`, `VA` is `apps/vendor-admin`.

### Security and authorization

| # | Task | Claim | Main files | Needs |
| --- | --- | --- | --- | --- |
| T01 | A quote stored for a customer requires `vendor.subscriptions.manage`; the read-only preview route never persists one. | 1 | `CP/commercial/http.ts`, `CP/commercial/quotes.ts` | |
| T02 | A `change` quote or order skips the published check only for the revisions already applied to that subscription; a draft or withdrawn revision is refused. | 2 | `CP/commercial/quotes.ts`, `orders.ts`, `quote-sources.ts` | |
| T03 | Vendor routes refuse a customer whose workspace is being deleted with 409 `tenant_retiring` (suspend, resume, custom terms, invitations included), instead of a trigger error answered as 503. | 19 | `CP/commercial/routes-b.ts` | |
| T04 | Deleting a workspace clears `cancel_requested_at`; "resume renewal" is refused and hidden for a deleted customer. | 19 | `CP/commercial/tenant-deletion-run.ts`, `cancellation.ts`, `VA/app/pages/customers/[id].vue` | |
| T05 | Workspace deletion strips `previous_admin_login`, `previous` and `current` from audit metadata and outbox payloads. | 20 | `CP/commercial/tenant-deletion-run.ts` | |
| T06 | Re-sending an invitation requires step-up and refuses a consumed invitation; changing the registered e-mail updates the onboarding address too, so acceptance finds the user and the panel shows one address. | 24 | `CP/commercial/invitation-http.ts`, `admin-login.ts`, `VA/app/components/vendor/WorkspacePanel.vue` | |
| T07 | The audit link on the customer page shows only with `vendor.audit.read`; the 403 error page offers a way back. | 7 | `VA/app/pages/customers/[id].vue`, `VA/app/error.vue` | |
| T08 | Sign-out clears page data and always ends the local session, also when the control plane answers 503. | 8 | `VA/app/composables/useAdminSession.ts`, `VA/server/utils/auth-route.ts` | |
| T09 | The vendor-context middleware skips public pages, lets `/login` render when the BFF answers 503, and clears the session on a 401 before redirecting. | 3 | `VA/app/middleware/10.vendor-context.global.ts`, `useVendorContext.ts` | |
| T10 | Payment-review and charge-refusal attention items follow the decided visibility. | 4 | `CP/commercial/attention.ts` | D2 |
| T11 | Reopening an invitation link after the passkey step continues at the TOTP step. | 5 | `CP/admin-auth/route-handlers.ts`, `VA/app/composables/useEnrollment.ts` | D3 |

### Money and the scheduler

| # | Task | Claim | Main files | Needs |
| --- | --- | --- | --- | --- |
| T12 | A saved-card attempt refused as `duplicate_transaction` is not charged again by the schedule. | 9 | `CP/commercial/saved-card-failure.ts`, `saved-card-charges.ts` | |
| T13 | Bank transfer: the value date is read as text, a concurrent duplicate reference answers 409, and the contract refuses amount 0. | 10 | `CP/commercial/bank-transfer.ts`, `packages/commercial-contracts` | |
| T14 | The failed-refund attention item has two texts: money left the provider, and no refund was ever asked of the provider. | 11 | `CP/commercial/attention.ts`, `VA/i18n/locales/{ar,en}/vendor.json` | |
| T15 | One failing subscription no longer stops cancellation locks for all the others. | 14 | `CP/commercial/free-base-lock.ts` | |
| T16 | Saving AI billing settings skips workspaces being deleted. | 15 | `CP/commercial/ai-billing-settings.ts`, `ai-ledger.ts` | |
| T17 | Recurring revenue includes paid users and paid storage. | 34 | `CP/commercial/analytics-model.ts` | |
| T18 | The churn rate stays within the contract when churned exceeds opening, so `/analytics` loads. | 35 | `CP/commercial/analytics.ts`, `packages/commercial-contracts/src/commercial/analytics.ts` | |

### Customers and subscriptions

| # | Task | Claim | Main files | Needs |
| --- | --- | --- | --- | --- |
| T19 | Starting a trial uses the subscription's real revision and requires a reachable administrator address. | 18 | `CP/commercial/trial.ts`, `orders.ts` | |
| T20 | A customer without a subscription can get a first paid subscription from the console; a retry reuses its idempotency key. | 21 | `VA/app/pages/customers/new.vue`, `customers/[id]/change.vue` | |
| T21 | The subscription change page offers cadence, optional bundles, users and storage, and sends the new plan's bundles. | 17 | `VA/app/pages/customers/[id]/change.vue`, `VA/app/utils/vendorSubscriptions.ts` | |
| T22 | Previewing a registered e-mail change needs no step-up; cancelling a step-up prompt does not lock the confirm button. | 16 | `CP/commercial/routes-b.ts`, `VA/app/pages/customers/[id].vue` | |
| T23 | Previewing custom terms stores no quote and compares with the applied terms revision. | 22 | `VA/app/pages/customers/[id]/terms/new.vue`, `CP/commercial/routes-b.ts` | |
| T24 | Plan pickers pass `customer_id`, so a plan made for one customer is not offered to another. | 29 | `VA/app/composables/useVendorCommercial.ts` | |
| T25 | No provisioning polling for a deleting or deleted workspace; the missing `vendor.customers.deletion.withdrawn` text is added. | 23 | `VA/app/composables/useWorkspaceProvisioning.ts`, `VA/i18n/locales` | |

### Catalog, bundles and plans

| # | Task | Claim | Main files | Needs |
| --- | --- | --- | --- | --- |
| T26 | A release can be created from a newer published catalog version after the first one exists. | gap | `VA/app/pages/catalog/[id].vue`, `VA/app/pages/bundles/new.vue` | |
| T27 | Publishing a new plan revision does not stop public sign-up and pricing. | 25 | `CP/http.ts`, `CP/signup/offer.ts`, `CP/commercial/plans.ts` | D1 |
| T28 | A validated plan or bundle can be edited from the console (it returns to draft, as the control plane already allows). | 26 | `VA/app/utils/vendorCommercial.ts`, `VA/app/pages/{plans,bundles}/[id]*.vue` | |
| T29 | The reasons of a refused validate or publish are shown; the customer count of a plan and of a bundle counts customers. | 27 | `VA/app/utils/vendorCommercial.ts`, `VA/app/components/vendor/LifecyclePanel.vue`, `CP/commercial/plans.ts`, `bundles.ts` | |
| T30 | Plan numbers are bounded by the column and by what the workspace accepts; storage steps are whole gigabytes at publish; restoring a withdrawn revision re-checks it and leaves one available revision. | 28 | `packages/commercial-contracts` schemas, `CP/commercial/plans.ts` | |
| T31 | `customers/new` and the tenant operations panel read catalog versions through `useVendorCatalogVersions`. | cleanup | `VA/app/pages/customers/new.vue`, `VA/app/components/vendor/TenantOperationsPanel.vue` | |

### Operations, audit and the AI provider

| # | Task | Claim | Main files | Needs |
| --- | --- | --- | --- | --- |
| T32 | A shared job in `needs_intervention` whose effect exists can be recovered: recovery verifies the effect, and the operation page has a recover action. | 30, gap | `CP/shared/provisioning.ts`, `job-recovery.ts`, `VA/app/pages/operations/[id].vue` | |
| T33 | `reconfigure` jobs have a type in the operations feed; stuck and failed shared jobs appear in the attention list. | 31 | `CP/operation-feed.ts`, `CP/commercial/attention.ts` | |
| T34 | The customer filter of the audit log includes invoices, invoice adjustments, backups and restore approvals. | 32 | `CP/audit-feed.ts` | |
| T35 | Provider errors answered as 502 by the AI provider routes reach the console with their own message. | 33 | `VA/server/utils/control.ts`, `VA/app/utils/aiProvider.ts` | |
| T36 | AI billing settings and the AI top-up refund are reachable from the console (proxy entry and page). | 12, 15 | `VA/server/utils/proxy.ts`, new `VA` pages | |

### Verify, then fix

| # | Task |
| --- | --- |
| T37 | Check claim 36, the remaining operator gaps and the UX, locale and performance section the same way (try to refute each against the code), and add one task per confirmed item to this plan. |

## 3. Owner decisions

| # | Question | Recommended default | Alternative |
| --- | --- | --- | --- |
| D1 | Public sign-up is bound to one plan revision id in the environment (claim 25). | Bind it to the plan: the latest published, available revision. | Keep the fixed id and warn in the console before a publish that would withdraw it. |
| D2 | Who sees payment-review and charge-refusal attention items (claim 4). | Only roles with `vendor.billing.manage`. | Keep them visible to every role with `vendor.read`, without card details. |
| D3 | Reopening an invitation link after the passkey was stored (claim 5). | Continue at the TOTP step. | Keep the restart and explain that the passkey is already registered. |

## 4. Delivery

- T01 to T06 and T12 to T14 are sensitive changes (authorization and money): each gets its own pull request
  ([definition](../../agents/integration-rules.md#sensitive-change-and-batching-single-definitions)). The others
  batch by section.
- Every task follows [the clean pre-release rule](../../../AGENTS.md): the behaviour is replaced in place, with
  its tests, locale keys in both languages and no compatibility path.
- Verification per task: `apps/control-plane` and `apps/vendor-admin` unit tests for the files it touches,
  `npm -w apps/vendor-admin run lint`, and the vendor-admin e2e spec of the changed page
  ([testing guide](../../testing.md)).
