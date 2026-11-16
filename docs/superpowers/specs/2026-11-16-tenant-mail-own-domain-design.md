# Tenant mail from the tenant's own domain

Status: owner decisions D1 to D6 recorded on 2026-11-16. Nothing in this document is implemented in any branch. No environment is deployed and no tenant exists. Three claims stay separate throughout: what the owner decided (section 2), what was read in provider documentation or in code (sections 3 and 4), and what is built (nothing).

The hosting contract ([liwan-shared-saas-and-sovereign-deployment.md](liwan-shared-saas-and-sovereign-deployment.md)) owns the shared-SaaS requirements. [Odoo outgoing mail](../../operations/odoo-mail.md) and [Odoo outbound route](../../operations/odoo-egress.md) describe the current route. This file does not change them.

## 1. Problem

Every mail Odoo sends today leaves from one address, the platform sender, through one relay. A tenant's invoice, quote, meeting invite or appointment confirmation would therefore reach the tenant's customer from `no-reply@liwanos.com`. The owner rejected that: the customer must see the tenant's own domain.

Code facts that shape the answer:

- `odoo-addons/liwan_core/models/outbound_mail.py:28-32` reads the sender from `mail.default.from`, else the server-wide `email_from`. Nothing sets `mail.default.from` per tenant (`docs/operations/odoo-mail.md:19-22`).
- `outbound_mail.py:58-83` sends from a daemon thread after the commit. There is no queue row, no retry and no record of the attempt. A failure is logged with its exception class only (`:77-80`).
- `deploy/odoo-mail/relay.py:13-14` and `:205-220` refuse any message whose `From`, envelope sender or identity headers are not the one platform address. A tenant-domain message is rejected today.
- Even before the relay, Odoo itself rewrites the sender. With no `ir.mail_server` record (the shared overlay sets only `ODOO_SMTP_SERVER`, `deploy/docker-compose.shared.yml:123-127`), `_find_mail_server` falls to its last branch and, when the `From` does not match `from_filter`, sends under `notifications_email or email_from` (`/Users/tariq/code/odoo/odoo/addons/base/models/ir_mail_server.py:919-935`). The filter is read from the per-database parameter `mail.default.from_filter`, then the server config (`:650-662`). A verified tenant domain must therefore be written into that per-database parameter, or Odoo silently replaces the tenant's address with the platform's.
- `odoo-addons/liwan_hr/models/hr_payslip.py:235` already creates a `mail.mail` with `sudo()`, a second path beside the thread path. AGENTS.md ("Clean pre-release codebase") forbids two parallel paths, which is why section 5.1 plans one contract.

## 2. Owner decisions (2026-11-16)

| # | Decision |
| --- | --- |
| D1 | Mail a tenant sends to its own customers (invoices, quotes, meeting invites, appointment confirmations, notifications) leaves in the tenant's name from the tenant's own domain. Sending from the LiwanOS address with the company as display name is rejected. |
| D2 | Phase 1 mechanism is domain verification through OCI Email Delivery: the tenant adds DNS records. Tenant-supplied SMTP credentials are not built. Google removed password SMTP in 2025, and Microsoft 365 turns basic SMTP AUTH off by default at the end of December 2026. |
| D3 | Platform mail stays on the LiwanOS sender: sign-in code, invitations, password reset, subscription notices (`liwan.outbound.mail` in `liwan_core` and the `deploy/odoo-mail` relay). |
| D4 | The sender identity is scoped to the tenant root. Child companies inherit it. No per-company override is built and no schema room is left for one. |
| D5 | Email cost is included in the subscription and is not sold as an add-on. There is no monthly allowance or quota shown to the tenant, because the cost is negligible (section 8). The real risks are the shared sending IPs and the one account-wide OCI daily limit (50,000 a day on a paid account), so protection ceilings apply instead: (a) a daily ceiling of 2,000 emails per tenant per day, counted per recipient and per 2 MB chunk with the billing weights, not shown to the tenant until reached; at the ceiling messages are not lost, they wait in the queue and leave the next day, and the tenant admin sees a notice; the vendor can raise the ceiling for one tenant from the vendor side; (b) a per-minute ceiling of 60 emails per tenant, where the excess waits in the queue and nothing is shown; (c) an automatic pause when the bounce or complaint rate is high, with a clear reason shown to the admin (thresholds are a phase 2 decision). There are no 80% or 95% warnings, since there is no monthly quota. |
| D6 | This contract is for transactional mail: invoices, quotes, invites and notifications. Marketing campaigns are out of its scope and belong to the customer-messages application, with recipient opt-in. |

Assumption pending owner confirmation (coordinator, not an owner decision): a tenant with no verified domain, or with only a public mailbox domain such as `gmail.com`, cannot email its customers from LiwanOS. It keeps the share link and the PDF download. OCI itself refuses public mailbox domains. Open question Q1 asks for confirmation.

## 3. Verified provider facts (2026-11-16)

Read in the OCI console for `me-jeddah-1` and in Oracle documentation. No identifiers of the account are recorded here because the repository is public.

| Fact | Source |
| --- | --- |
| Control API host `ctrl.email.me-jeddah-1.oci.oraclecloud.com`, API version 20170907, resources `EmailDomain`, `Dkim`, `EmailReturnPath`, `Sender`, `Suppression`, `WorkRequest`. Exact operation names were not read. | https://docs.oracle.com/en-us/iaas/api/#/en/emaildelivery/20170907/ |
| Trial limits now: `email-domain-count` 2,000 (1 used), `approved-sender-count` 2,000 (1 used), `max-emails-day` 200, `sendrate` 10 per minute, `max-message-size` 2,008,192 bytes. Paid defaults: 50,000 per day, 18,000 per minute, 10,000 senders. Message size can be raised to 60 MB on request. Limits are raised only for domains that have SPF and DKIM. | https://docs.oracle.com/en-us/iaas/Content/General/service-limits/default.htm |
| Custom return path is a subdomain of the email domain, activated by a CNAME. It needs DKIM or a verified domain first. If DNS is not added within 72 hours the resource goes to `Failed` and must be deleted and recreated. It is what gives SPF and DMARC alignment. | https://docs.oracle.com/en-us/iaas/Content/Email/Tasks/managing_custom_return_path.htm |
| Metrics namespace `oci_emaildelivery`, dimension `resourceDomain`: accepted, relayed, hard bounced, soft bounced, suppressed, complaints. Kept 90 days. | https://docs.oracle.com/en-us/iaas/Content/Email/Reference/guide-to-metrics-logs.htm |
| Logs per email domain, categories `emaildelivery.emaildomain.outboundaccepted` and `outboundrelayed`, queryable for 14 days. Each record carries `messageId` (ours, when we set the `Message-Id` header), `recipient`, `sender`, `errorType`, `smtpStatus`. Logging must be enabled per domain. | https://docs.oracle.com/en-us/iaas/Content/Logging/Reference/details_for_emaildelivery.htm |
| The suppression list is automatic and regional (hard bounces, complaints, unsubscribes). Sending IPs are shared by default, so one abusive tenant can hurt every other tenant. This is the reason for the per-tenant protection ceilings (D5, section 7). | Console, 2026-11-16 |
| Billing counts per recipient and per 2 MB chunk. Price recorded on 2026-11-06 and not re-read today: the first 3,000 emails a month are free, then about 0.32 SAR per 1,000. | Recorded price |
| Existing setup: email domain `liwanos.com`, sender `no-reply@liwanos.com`, SMTP endpoint `smtp.email.me-jeddah-1.oci.oraclecloud.com` on port 587. | Console |

The tenant adds three DNS records: a DKIM CNAME, an SPF TXT include and a return-path CNAME.

Preconditions: the trial ends on 2026-11-19 and upgrading the account is the owner's manual step. No environment is deployed yet, so nothing here has been exercised against a live tenant domain. The first step of phase 2 is to confirm every control-plane operation name against the API reference above and to prove one full cycle (create, DNS, verify, send, delete) on a throwaway domain.

## 4. What the code gives us today (verified in source)

Odoo 19 `mail.mail` (`/Users/tariq/code/odoo/addons/mail/models/mail_mail.py`):

- States `outgoing`, `sent`, `received`, `exception`, `cancel` (`:69-75`). Failure types include `mail_smtp`, `mail_email_invalid`, `mail_from_invalid`, `unknown` (`:76-92`).
- No automatic retry. A failed message stays in `exception` and only `action_retry` (`:173-174`) moves it back to `outgoing`. The queue cron reads only `outgoing` rows (`process_email_queue`, `:194-248`) and runs hourly (`addons/mail/data/ir_cron_data.xml:4-12`). `send_after_commit` (`:674-694`) sends on a new cursor right after the commit, which is the fast path.
- A failure with any type other than invalid or missing address keeps the row even when `auto_delete` is set (`:287-288`), so the failure stays visible.
- The row links to its business record through `model` and `res_id`, holds recipients and attachments, and stores `message_id` on success (`:895`).

`ir.mail_server.send_email` (`ir_mail_server.py:783-852`): no retries, the caller must handle failure. It accepts our `message_id` (`:547-592`), so the `Message-Id` header can carry an id we generate. The SMTP timeout is 60 seconds (`:45`).

LiwanOS today:

- `liwan_notify` (rank 3, depends on `liwan_api` and `mail`, `odoo-addons/liwan_notify/__manifest__.py:12`) already wraps the thread path in `models/notify_mail.py:21-33`.
- `liwan_integrations_sa` (rank 3, `tools/arch_layers.json:34`) stores tenant-owned secrets in `liwan.integration.secret` (`models/secret.py`, ciphertext under the purpose `liwan_integrations`) and a company-scoped `liwan.integration.connection` (`models/connection.py:27-57`). Its manifest depends on `liwan_api` only.
- `tools/arch_policy.py:175-186`: an addon may depend only on a strictly lower rank. Two rank 3 addons cannot depend on each other.

## 5. Design

### 5.1 The send contract (`liwan_notify`, over `mail.mail`)

Decision: extend `mail.mail` with `_inherit` (a public extension point, R9) and add one service in `liwan_notify`. No new outbox table: `mail.mail` already is the queue, the failure record and the link to the business document, and a second table would duplicate it (AGENTS.md "Clean pre-release codebase", "reuse engines").

Where the delivery log lives: on the `mail.mail` row itself, with these added fields: `liwan_kind` (the sending feature, for example `meeting.invite`), `liwan_attempts` (integer), `liwan_provider_status` (selection: `submitted`, `accepted`, `relayed`, `bounced`, `complained`, `suppressed`) and `liwan_provider_checked_at`. The business record is `model` and `res_id`, which Odoo already provides. Reasons: one source of truth per fact, Odoo's own list and retry behaviour keeps working, and the daily and per-minute counts are reads over these rows, never a second stored counter. Rows are kept 90 days (the length of OCI metrics) by one cron and then removed. The counters read the current day and the last minute only.

What stock Odoo gives (section 4) and what LiwanOS adds on top:

| Need | Stock Odoo 19 | LiwanOS adds in `liwan_notify` |
| --- | --- | --- |
| Queue and send | `mail.mail` outgoing state, cron, `send_after_commit` | One entry point `liwan.mail.send` that creates the row and calls `send_after_commit`. It replaces the thread in `liwan_core` for tenant mail |
| Retry | None; manual `action_retry` | A cron that moves rows in `exception` with failure type `mail_smtp` or `unknown` back to `outgoing`, up to 3 attempts with growing delay through `scheduled_date`. Invalid-address failures are final |
| Sender and server choice | `_find_mail_server` by `from_filter` (see section 1) | The sender comes from the tenant's verified domain. The service writes the tenant's per-database `mail.default.from_filter` (platform domain plus verified domain) on verify and on removal |
| Attachments | `attachment_ids` | A size rule: above about 1.5 MB (trial `max-message-size` is 2,008,192 bytes, and base64 adds a third) send a download link instead of the file |
| Protection ceilings (D5) | None | A computed count over rows of the current day, weighted per recipient and per 2 MB chunk, checked when the row is created. Over the daily ceiling the row is still created in `outgoing` with `scheduled_date` set to the start of the next day, so it waits and is sent by the stock queue cron (`mail_mail.py:205-211` reads only `outgoing` rows whose `scheduled_date` is empty or past; the field is at `:97`). The per-minute ceiling uses the same mechanism with a date a minute ahead. That the cron honours a future `scheduled_date` is read in source; the whole deferral flow is unverified until it runs in phase 1 |
| Correlation | `message_id` stored after send | We generate the `Message-Id` before sending and store it, so OCI logs (`messageId`) match the row |
| Gate | None | Feature and capability checks (section 7), and the verified-domain rule on every send |

Platform mail (D3) stays on `liwan.outbound.mail`. The two paths differ in responsibility: platform mail is composed from a fixed bilingual template and needs no log row, no count and no retry because the user simply asks for another code; tenant mail is a business document with a record, a count and a retry. Whether platform mail should move to the same queue is open question Q3. `hr_payslip.py:235` moves to the contract in phase 1, which removes the `sudo()` there. The contract itself needs one elevated `mail.mail` create, documented in `tools/arch_documented_sudo.json` with the blocking ACL named, as R7 requires.

### 5.2 Domain model and ownership

| Model | Addon | Notes |
| --- | --- | --- |
| `liwan.mail.domain` | `liwan_notify` | One row per tenant root company: domain name, `from_local_part`, state (`not_started`, `pending_dns`, `verified`, `failed`), the three DNS records as a Json value, provider reference ids, `verified_at`, `last_error`. Scope: tenant root (D4). A unique constraint on the root company. No child-company column |
| `mail.mail` (inherit) | `liwan_notify` | Fields in section 5.1 |
| `liwan.mail.domain.provider` | `liwan_notify` | Abstract model, the provider interface: `create_domain`, `read_records`, `check`, `recreate_return_path`, `delete_domain`, `fetch_delivery_status` |

Disagreement with the settled direction, reported rather than silently changed: the brief puts the provider integration in `liwan_integrations_sa` with a bridge. Two code facts argue against it. `liwan_notify` and `liwan_integrations_sa` are both rank 3, and `tools/arch_policy.py:175-186` forbids a dependency between equal ranks, so the only way to join them is a new rank 5 bridge that, by R3, defines no model and so cannot own `liwan.mail.domain`. And the contents of `liwan_integrations_sa` are tenant-owned secrets and connections, while the OCI signing key is an operator secret (section 6.2); the module would contribute nothing the OCI client uses. So the OCI client is one implementation of `liwan.mail.domain.provider` inside `liwan_notify`, selected by operator configuration. If a second provider ever needs a separate addon, a bridge can be added then. No new addon is registered in `tools/arch_layers.json` by this plan; this is unverified against the owner's wish to keep `liwan_notify` free of vendor code, and is raised as Q4.

### 5.3 Domain verification flow (phase 2)

1. A user holding the mail-domain capability enters a domain they own (for example `example.com`) and a sender local part. The server rejects public mailbox domains (a maintained list in the module, plus OCI's own refusal) and a domain already held by another tenant (section 7.4).
2. The provider creates the `EmailDomain`, enables logging for it, creates DKIM and the custom return path, and the model stores the three records. The state is `pending_dns`.
3. The settings screen shows the records. The tenant adds them at their DNS host.
4. A verify button (and a cron every 15 minutes while `pending_dns`) asks the provider for the status. When DKIM is active, SPF is present and the return path is active, the state becomes `verified` and the service writes `mail.default.from_filter`.
5. If the return path has not activated within 72 hours it goes to `Failed` on OCI's side. The cron deletes and recreates it automatically, replaces the stored CNAME target, sets the state to `pending_dns` and shows the new record. Without this the tenant sees a stuck screen.
6. A test send goes to the acting user's own address, through the full contract, and records the result.

Removal deletes the OCI resources and clears the filter. A verified domain that later stops validating (the tenant removes the DNS record) moves to `failed` on the next check and sends are refused, with the reason shown.

### 5.4 Submission path: the relay, not direct SMTP

Chosen: keep the `odoo-mail` relay as the only way mail leaves Odoo, and change its sender rule. Today it accepts one address (`relay.py:205-220`). The new rule: the `From`, the envelope sender and the identity headers must name one address, whose domain is either the platform domain or any domain that is not listed in a reserved set (`ODOO_MAIL_RESERVED_DOMAINS`, default the platform domain). The platform address stays the only one allowed on the platform domain, so a tenant still cannot send as `liwanos.com`.

What the relay does not check, stated plainly: it has no database and cannot know which tenant owns which domain. OCI refuses a domain that is not verified in the tenancy, and Odoo checks the tenant's own verified domain on every send (section 7). A compromised Odoo process, which already reads every tenant database, could still send as another tenant's domain. That is the same logical-isolation limit the object-storage design accepts ([tenant object storage](2026-11-08-tenant-object-storage-design.md), section 3), and full isolation is the managed dedicated model.

Rejected: direct SMTP from Odoo to OCI. Odoo sits only on internal networks and its one route off the host is the HTTPS proxy (`docker-compose.shared.yml:118-119`, `docs/operations/odoo-egress.md`); SMTP is not HTTP. Direct SMTP would also put the SMTP credential into the Odoo container, where the relay holds it today (`docker-compose.shared.yml:195-197`), and would remove the relay's size, recipient and smuggling checks. Not evaluated: OCI's HTTPS submission API, which would pass through `odoo-egress`. It is unverified and is a candidate to compare in phase 2 if the relay change proves awkward.

Open technical point, unverified: the envelope sender. Odoo uses the bounce address or the `From` (`ir_mail_server.py:675-703`). Whether OCI accepts the tenant address as envelope sender while the custom return path rewrites it must be tested in phase 2.

### 5.5 Reaching the OCI control API

The Odoo process calls `ctrl.email.me-jeddah-1.oci.oraclecloud.com` over HTTPS through `odoo-egress`, which needs one new host line in its allow list and a row in the hosts table of `docs/operations/odoo-egress.md`. The request is signed with an OCI API key.

That key is an operator secret, not a tenant secret. It is supplied through `deploy/.env` to the Odoo service (the same mechanism that carries `ODOO_MAIL_UPSTREAM_PASSWORD` to the relay, `docker-compose.shared.yml:195-197`), never stored in a tenant database or the secret table, and never logged. The IAM policy for its user is limited to the email-family resources in one compartment. Trade-off: every tenant's Odoo database is served by a process that holds this key, so a compromised process can alter any tenant's OCI domains. The alternative is to let the control plane make the calls, but R5 forbids Odoo from depending on it and it would break the independent deployment, so it is rejected. The key rotates like the relay credential.

### 5.6 Customer-hosted `non_saas`

R5 and R8 require the product to run without the vendor. In `non_saas` the operator configures its own outbound server in the operator configuration (server-wide SMTP options, as the single-customer template does) and the platform sender and the tenant domain are the same domain or decided by the operator's `from_filter`. The OCI provider is not configured, so the domain-verification card is hidden in `non_saas` as a commercial SaaS path, like the subscription pages. The send contract, the log, the limit and the retry cron work unchanged on any SMTP server. The protection ceilings are not an entitlement, so they are not hidden in `non_saas` (R8): they are operator-configurable values with the same defaults, and the operator may raise or disable them. The bounce and complaint pause needs OCI metrics and applies only where the OCI provider is configured.

### 5.7 Settings screen and API

Page: a mail section under the tenant settings (`/settings/company`, a card with its own anchor, per DESIGN.md section on settings; the owner chooses the final place when the page is designed, no visual design here).

States and what each shows:

| State | Screen |
| --- | --- |
| `not_started` | Explanation, domain field, sender local part, start button |
| `pending_dns` | The three records with a copy button each, a verify button, the time left before the return path expires, any automatic recreation noted |
| `verified` | Sender address, a test-send button, a remove button. Today's usage appears only when it is near or at the daily ceiling, with a notice that queued messages leave the next day. There is no allowance bar. A pause for bounces or complaints shows its reason |
| `failed` | The reason and a retry or remove action |

API under `/api/v1/mail/domain` follows the product contracts in [AGENTS.md](../../../AGENTS.md): `type='json2'`, `auth='user'`, explicit methods, the shared `api_handler`, a capability check, serializer-whitelisted shapes, structured errors with real HTTP statuses (403 `forbidden`, 404 `not_found`, 422 `invalid`, plus 409 for a domain held by another tenant). Routes: read state, start, verify, recreate return path, test send, remove, and the usage read. Lists use `{items, total}`. Zod contracts live in `packages/contracts/src` with the others. No route returns a secret or the OCI key.

## 6. Security

### 6.1 Who may manage the domain

A dedicated capability, registered through `liwan.access.service` and held only by the roles that the tenant grants it to. Membership alone never grants it, and it is not implied by `system_admin`'s ordinary settings capabilities ([odoo-rules.md](../../agents/odoo-rules.md)). Changing the sending domain changes the identity of all outgoing mail, so it is a sensitive capability. Whether a shared service may register its own capability under R2 is unverified (R2 speaks of applications); if it may not, the capability is registered by the platform foundation. The gate for routes uses `requires_tenant_access` as the base services do (R10), because the feature is part of the base and not a tier choice.

### 6.2 Server-side rules on every send

- The `From` domain must equal the tenant's verified domain, read from `liwan.mail.domain` in the same database, on every send. A client-supplied `From` is never trusted.
- Display name is the company name. The local part is the one stored on the domain row, validated against a safe character set.
- The recipient list is validated and capped per message. The relay caps recipients (`ODOO_MAIL_MAX_RECIPIENTS`).
- Protection ceilings (D5): 2,000 per tenant per day and 60 per tenant per minute, checked when the row is created. Excess is deferred through `scheduled_date`, never refused and never lost. An automatic pause for a high bounce or complaint rate refuses sends with a structured error and a reason; nothing is recorded as sent.
- No secret appears in logs, in the row, or in an error shown to the user. Logs carry the exception class and the row id only, as `outbound_mail.py:77-80` does today.

### 6.3 Tenant isolation, uniqueness and conflict

Isolation stays database per tenant, with one OCI email domain per tenant. A domain name is unique across tenants. The provider call is the arbiter: OCI refuses a domain that already exists in the tenancy, and the control plane's tenant profile is not consulted. On conflict the tenant sees "this domain is already registered", with no hint of who holds it, and a support path for the real owner (proof by DNS) that is a vendor action and out of scope here.

### 6.4 Abuse, removal, offboarding and privacy

- Abuse: the suppression list is automatic. Complaint and hard-bounce counts per tenant come from OCI metrics (90 days). A tenant above a bounce or complaint threshold is paused (sends refused, reason shown) until reviewed. Because IPs are shared, the vendor can also pause a tenant's domain at OCI. Thresholds are a phase 2 decision with real numbers.
- Removal: deleting a domain deletes the EmailDomain, DKIM, return path and approved senders, then clears the filter.
- Offboarding: tenant deletion in the lifecycle code deletes the OCI resources before the database is dropped, and a failed deletion is reported, not ignored. Orphaned OCI domains are found by a reconciliation listing in the operator runbook.
- PDPL: recipient addresses and message content go to OCI in Jeddah, inside Saudi Arabia, on the same in-Kingdom basis as the rest of the hosting. Whether sending from a customer's own domain changes the controller and processor roles is unverified and goes to the compliance review ([PDPL transfer regulation](https://sdaia.gov.sa/Documents/RegulationonPersonalDataEN.pdf)).

## 7. Capabilities and gates, summarized

| Gate | Rule |
| --- | --- |
| Tenant lifecycle | `requires_tenant_access` on every route (base service, R10) |
| Manage domain | The dedicated capability in 6.1 |
| Send | The caller's own application capability and feature (for example the meetings feature for an invite), then the verified-domain check and the protection ceilings and pause of 6.2 |
| `non_saas` | The domain-verification routes and card are hidden. The contract works against the operator's server |

## 8. Cost

OCI counts per recipient and per 2 MB chunk. A 3 MB message to two recipients counts as four. Price recorded on 2026-11-06 and not re-read on 2026-11-16: 3,000 emails a month free for the account, then about 0.32 SAR per 1,000.

Worked example: 100 tenants at 500 emails each is 50,000 emails. After the 3,000 free, 47,000 at 0.32 per 1,000 is about 15 SAR a month for the whole platform.

There is no monthly allowance (D5). Typical expected use is a few hundred emails per tenant per month (invoices, quotes, invites, notifications), which costs a fraction of a riyal at list price. The theoretical maximum at the daily ceiling is 2,000 x 30 = 60,000 emails, about 19.2 SAR per tenant per month at list price (60,000 times 0.32 per 1,000). That figure is an abuse bound, not an expected cost. The budget line and its margin are recorded in [the 2027 launch year financial study](../../finance/2027-launch-year-financial-study.md); this file does not set them.

The count that matches billing is per recipient and per chunk, so the counters in 5.1 use the same weights, otherwise the ceilings and the invoice drift apart.

## 9. Phases

Release 1 targets about 2026-12-06 with CRM, customer messages and the base. Phases 1 and 2 ship together. Phase 3 is the first user-facing mail and belongs in release 1 only if the owner wants meeting invites at launch; the CRM quote email (phase 4, first half) is the one launch feature that needs tenant-domain mail, if quotes are emailed at launch (Q5). Phases 5 to 7 come after release 1.

Verification command families are the ones in [testing.md](../../testing.md) and the scratch-database block in [odoo-rules.md](../../agents/odoo-rules.md): layer 1 Odoo tests for models, rules and routes, layer 2 `npm test` and `npm -w apps/web run lint` for contracts and the web page, and the `tools` unittest suite after any addon Python edit. Never against `liwan_dev` or `odoo19`.

| # | Scope | Owner files | Size | Acceptance | Verify |
| --- | --- | --- | --- | --- | --- |
| 1 | Send contract over `mail.mail`: entry point, log fields, retry cron, per-tenant daily and per-minute protection ceilings with next-day deferral, attachment-link rule, feature and capability gates, documented `sudo()`, move the payslip mail onto it | `liwan_notify/models/` (mail inherit, service, cron), `liwan_hr/models/hr_payslip.py`, `tools/arch_documented_sudo.json` | Sensitive (authorization, tenant isolation) | A send creates one row with our `Message-Id`; a transient failure retries up to the cap and then stays visible; the count weights recipients and chunks; a send over the daily or per-minute ceiling is not lost, it stays in `outgoing` with a future `scheduled_date` and leaves later, and the admin sees a notice; the payslip mail uses the contract with no `sudo()` of its own | Layer 1 on a scratch database for `liwan_notify` and `liwan_hr`, `tools` unittests, `python3 -B tools/arch_policy.py` |
| 2 | Domain verification and the settings screen: provider interface, OCI implementation, state machine, 72-hour recreation, filter write, relay rule change, egress host, capability, routes, zod contracts, page | `liwan_notify/models/`, `liwan_notify/controllers/`, `deploy/odoo-mail/relay.py` and its test, `deploy/docker-compose.shared.yml`, `docs/operations/odoo-egress.md`, `docs/operations/odoo-mail.md`, `packages/contracts`, `apps/web` mail card | Sensitive (security, cross-layer, operator secret) | Full cycle on a throwaway domain; a message from the verified domain leaves under that address (checked on the received headers); a message from another domain, an unverified domain or the platform domain is refused at the contract; the relay refuses a reserved domain; no secret in logs or answers | Layer 1, relay protocol tests (`deploy/test_odoo_mail.py`), layer 2 and `vue-tsc` lint, then one live proof against OCI by the owner after the account upgrade |
| 3 | Meeting invite with an `.ics` attachment (Meetings is in the always-included base) | `liwan_meetings`, using the contract | Ordinary | An invite arrives from the tenant domain with a calendar file that opens in the common clients; a tenant without a verified domain sees the share link instead | Layer 1 for `liwan_meetings`, contracts tests |
| 4 | CRM quote email, then the Finance invoice when Finance is sold | `liwan_crm` (or its quote surface), `liwan_finance` | Ordinary for the quote; Sensitive for the invoice (money) | The document goes as a link above the size rule and as a PDF below it; the row links to the quote or invoice; a failed send shows on the record | Layer 1 per addon, layer 2 for the button |
| 5 | Appointment confirmation | `liwan_appointments` | Ordinary | A booking sends one confirmation from the tenant domain; a reschedule sends one update | Layer 1 |
| 6 | Tenant SMS on the same contract | `liwan_notify` channel switch, SMS provider module | Ordinary after a design decision on the provider | The same log, count and gate apply to SMS; the tenant's own sender id is required | Layer 1 |
| 7 | Per-application notification settings: which events mail whom, per application settings section | Each application's settings section | Ordinary per application | Each setting is typed, has a default and is readable through the API ([AGENTS.md](../../../AGENTS.md) "Configurable, sector-flexible applications") | Layer 1, contracts tests |

## 10. Out of scope

Tenant-supplied SMTP credentials, the Moyasar gateway, ZATCA production, bank feeds, Google and Outlook calendar sync, and inbound mail. Per-company sender override is out of scope by D4 and leaves no schema room.

## 11. Open questions for the owner

Each has a recommended default, per [AGENTS.md](../../../AGENTS.md) "User-facing decisions". Q2 (the monthly allowance) was decided on 2026-11-16 and is recorded as D5 in section 2.

| # | Question | Options | Recommended default |
| --- | --- | --- | --- |
| Q1 | A tenant with no verified domain, or a public mailbox domain only | (a) it cannot email its customers and keeps the share link and PDF; (b) it sends from the LiwanOS address with the company name (contradicts D1) | (a), as in section 2 |
| Q3 | Platform mail (sign-in code and the like) on the same queue | (a) keep `liwan.outbound.mail` for platform mail, justified as a different responsibility (no log, no count, no retry); (b) move platform mail to the queue and delete the thread path so one path remains | (a) for launch; revisit when the thread path needs a retry, because two paths is a standing cost |
| Q4 | OCI client inside `liwan_notify` versus a separate bridge addon | (a) inside `liwan_notify` behind a provider interface (section 5.2); (b) a rank 5 bridge with the provider logic and no model | (a), because of `tools/arch_policy.py:175-186` |
| Q5 | Which phases ship at release 1 | (a) phases 1 and 2 only (the capability exists, no business feature uses it); (b) phases 1 to 3 (meeting invites); (c) phases 1, 2 and the CRM quote email | (c) if quotes are emailed at launch, otherwise (a) |
