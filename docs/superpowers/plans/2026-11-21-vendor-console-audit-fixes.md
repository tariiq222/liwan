# Vendor console and control plane: audit fixes plan

> Source: an external audit of `apps/vendor-admin`, `apps/control-plane` and `packages/commercial-contracts`
> (run on `main` at `506dca1dc`), checked claim by claim against the code on 2026-11-21. Status: built on
> 2026-11-21 and 2026-11-22 on branch `claude/gallant-gauss-gxh9lh`, one commit per task; section 5 lists what is
> built, what is not, and the checks that ran. Not merged; nothing here is verified on a server.

## 1. What was checked

Thirty-five numbered claims and two operator gaps were read against the code by four independent reviewers. Nothing
was run: every verdict is from reading code, so each task starts by reproducing its failure in a test.

| Verdict | Claims |
| --- | --- |
| Confirmed | 1, 2, 7, 8, 9, 12, 14, 16, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 34, 35; no later catalog release; no recover button |
| Partly (the defect exists, narrower than described) | 3, 4, 5, 10, 11, 15, 17, 32, 33 |
| Refuted (no task) | 6, 13 |
| Checked in the second round (section 2, last table) | 36, the operator-gap table, the UI and locale items |

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

### Second verification round (claim 36, operator gaps, UI and locale)

Checked on 2026-11-21 the same way: 18 confirmed, 4 partly, none refuted.

| # | Task | Main files | Needs |
| --- | --- | --- | --- |
| T37 | Analytics: a suspended or cancelled customer no longer blanks the MRR and ARR history; an invoice due later today is not counted as overdue; an AI top-up paid during a trial is not a paid conversion. | `CP/commercial/analytics-model.ts`, `analytics.ts`, `signup-funnel.ts` | |
| T38 | Attention list: a resume that did not reach the workspace is reported like a failed suspension; the provider payment review item links to its payment. | `CP/commercial/attention.ts`, `VA/app/components/vendor/AttentionList.vue` | |
| T39 | A disabled team account can be enabled again from `/team`. | `CP/admin-auth/accounts.ts`, `VA/app/pages/team/index.vue` | |
| T40 | Console forms: no skeleton flash on the operation page poll; the reason field is not marked wrong after a successful billing-settings save; a pasted IBAN with spaces is accepted; a decimal comma in a price is refused instead of read as thousands; audit retry reloads the customer name; local state (pay link, open forms) resets when the customer id changes; the one-time team invitation link cannot be dismissed before it is copied; a cancelled step-up shows its own message everywhere; the customer search waits for typing to pause. | `VA/app/pages/**`, `VA/app/utils/vendorCommercial.ts` | |
| T41 | Missing texts: invoice line kinds `onboarding` and `ai_topup`, operation stage `failed`; the role list separator follows the locale. | `VA/i18n/locales/{ar,en}/vendor.json`, `VA/app/components/AdminHeader.vue` | |
| T42 | Free-base (0 SAR) customers in ARPC and renewal counts. | `CP/commercial/analytics.ts` | D4 |
| T43 | Start a backup and approve and run a restore for a shared workspace from the console. | new `VA` flow over the existing `CP/http.ts` shared routes | D5 |
| T44 | Void an unpaid renewal invoice from the console. | new route and action | D6 |

## 3. Owner decisions

| # | Question | Recommended default | Alternative |
| --- | --- | --- | --- |
| D1 | Public sign-up is bound to one plan revision id in the environment (claim 25). | Bind it to the plan: the latest published, available revision. | Keep the fixed id and warn in the console before a publish that would withdraw it. |
| D2 | Who sees payment-review and charge-refusal attention items (claim 4). | Only roles with `vendor.billing.manage`. | Keep them visible to every role with `vendor.read`, without card details. |
| D3 | Reopening an invitation link after the passkey was stored (claim 5). | Continue at the TOTP step. | Keep the restart and explain that the passkey is already registered. |
| D4 | Do free-base customers count in ARPC and renewals (T42)? | Count them as customers, exclude them from ARPC and renewal value. | Keep today's figures. |
| D5 | Shared backup and restore from the console (T43): a new operator flow with its own design. | Design it as its own spec before building. | Leave it to the server command line. |
| D6 | Voiding an unpaid renewal invoice (T44): who may do it and what happens to the subscription. | Design it as its own spec before building. | No console action. |

The owner said on 2026-11-21 to build every task; D1 to D3 follow the recommended default. T42 to T44 wait for
D4 to D6 and are not built.

## 4. Delivery

- T01 to T06 and T12 to T14 are sensitive changes (authorization and money): each gets its own pull request
  ([definition](../../agents/integration-rules.md#sensitive-change-and-batching-single-definitions)). The others
  batch by section.
- Every task follows [the clean pre-release rule](../../../AGENTS.md): the behaviour is replaced in place, with
  its tests, locale keys in both languages and no compatibility path.
- Verification per task: `apps/control-plane` and `apps/vendor-admin` unit tests for the files it touches,
  `npm -w apps/vendor-admin run lint`, and the vendor-admin e2e spec of the changed page
  ([testing guide](../../testing.md)).

## 5. Outcome (2026-11-22)

Built, each reproduced in a failing test first: T01 to T31, T33 to T35, T38 to T41, the settings page of T36, the
recover action of T32, and two of the three T37 defects (overdue clamp, AI top-up conversion). Built after the owner
decisions of 2026-11-22: the recovery of a job in `needs_intervention` (T32, D7), the history of a departed customer
(T37, D9), free-base customers in ARPC and renewals (T42, D4) and the AI top-up refund in the console (T36, D8); see
"Decisions taken" below.

Not built, with the reason:

| Item | Reason | Decision |
| --- | --- | --- |
| T40, state kept between two customers | Not reproduced: Nuxt remounts the page when the id changes. | none |
| T43, T44 | Wait for D5, D6. | D5, D6 |

| # | Question | Recommended default | Alternative |
| --- | --- | --- | --- |
| D7 | May an operator recovery complete a job in `needs_intervention` when the effect is present and verified? | Yes, in `recoverSharedJob` only. | Keep it sticky and change the abandon refusal text, which today says to recover. |
| D8 | The AI top-up refund route. | Remove it; the invoice refund is the one path. | Expose it as a second action on the invoice page. Taken (2026-11-22, second answer). |
| D9 | Leaving-service time for analytics history. | Add `left_service_at`, written at each departure; history is exact from then on. | Keep the blank. |

Decisions taken on 2026-11-22: D7 yes: only the operator's recovery request (`recoverSharedJob`) completes a job whose
journal is in `needs_intervention`, and only when a fresh readback shows the effect present, verified and matching the
job's key and digest; the automatic worker never does, an absent effect keeps the job, and a mismatch is refused
(`shared/INTEGRATION.md` step 7 states the one exception). D9 yes: migration `schema_074.sql` adds
`subscriptions.left_service_at`, written by a trigger on the state column (every departure to suspended or cancelled,
manual suspension and workspace deletion included, and cleared on return to service, so no code path can miss it);
analytics history is exact from the recorded time, and a row that left before the column existed keeps no time and
stays unknown. D4 yes: customer totals still count a free-base customer; ARPC divides recurring revenue by paying
customers (`owesAtRenewal` on the applied revision) and the upcoming renewals count and value only paying
subscriptions. D8, second answer: keep the route and expose it as a second action on the invoice page, and make it send
the refund to the payment provider; the general refund keeps its first-payment-only rule. The route now queues the same
`reconcile.refund` row the invoice refund request queues (one shared `queueProviderRefund`, keyed by the credit note, so a
repeat or concurrent request refunds once; a bank transfer is left to the operator's form); its capability
(`vendor.billing.manage`) and fresh step-up are the same as the invoice refund's. The console forwards it (POST only) and the
invoice page offers "refund this AI top-up" only for a paid invoice that bought only an AI top-up, is not the customer's
first payment, is inside the window and has no credit note; one form serves either action, so both are never offered.

Decisions taken while building: public sign-up reads `LIWAN_SIGNUP_PLAN_ID` (a plan id; the old revision-id
variable is gone); a resume that did not reach the workspace needed a clock, so migration `schema_073.sql` renames
`suspension_pending_since` to `tenant_status_pending_since`; an enabled team account starts a fresh enrolment and
keeps only its roles; a price accepts a comma only as a thousands mark between groups of three digits, and the AI
top-up list is separated by `،` or `;`.

Checks that ran on the final tree: control plane suites in the four CI groups on scratch PostgreSQL (2,420 passed,
2 skipped, none failed) and its type check; commercial contracts (240); vendor console unit tests (956) and type
check; `tools/arch_policy.py`, `tools/git_policy.py`, `tools/ui_policy.py`. The vendor console e2e specs of the
changed pages ran per batch against the mock control plane with a temporary Playwright config (the installed
browser does not match the repository's Playwright version); the full e2e suite did not run on the final tree.
Not run: the mail suites (no Mailpit here), the real control plane, CI. Two independent reviews of the whole
branch (control plane, vendor console) found no blocking defect; their seven smaller findings are fixed.

Found outside the tasks and left: anonymous quote previews are stored under the customer `preview`; the invitation
panel does not know an invitation was accepted until the server refuses; `view.issues` in the plan and bundle view
is always empty; `requested_storage_mb` in a quote is not bounded by what the workspace accepts; a bundle restore
is not re-checked; hardcoded list separators in `ai-provider.vue` and `packages/ui` `PersonAvatar.vue`.
