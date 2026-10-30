# ZATCA simulation and production policy

Status: **draft** (2026-10-20). D1 is decided; D2-D6 are **deferred by the owner until before the first production
server deployment** and are decided then, together with the approval of this policy. Until the owner approves it, the sandbox-only
confinement in `liwan_finance` stays in force and production invoicing for real tenants remains a release
blocker (AGENTS.md, `odoo-addons/liwan_finance/README.md`).

Scope: when and how a LiwanOS company leaves the ZATCA developer-portal sandbox for the Fatoora simulation
environment and then production, through stock `l10n_sa_edi` driven by `liwan_finance`. It covers the
environments, who may switch them, key and certificate custody, renewal, revocation, submission timing, chain
integrity, responsibility, and the evidence required before a tenant goes live. It does not cover Zakat or income
tax filing (out of scope in the HR and finance design).

## 1. Official sources

The process follows ZATCA's own publications. Everything in section 2 is taken from these documents. The guidelines
page was last updated 10 Aug 2026; before go-live, check it for newer versions of each document (rule P12).

| Document | Version read | Source |
|---|---|---|
| Developer Portal User Manual | Version 3, Nov 2022 | <https://zatca.gov.sa/en/E-Invoicing/Introduction/Guidelines/Documents/DEVELOPER-PORTAL-MANUAL.pdf> |
| FATOORA Portal User Manual | Version 3, May 2023 | <https://zatca.gov.sa/en/E-Invoicing/Introduction/Guidelines/Documents/Fatoora_Portal_User_Manual_English.pdf> |
| E-invoicing Detailed Technical Guidelines | Version 2, Nov 2022 | <https://zatca.gov.sa/en/E-Invoicing/Introduction/Guidelines/Documents/E-invoicing-Detailed-Technical-Guideline.pdf> |
| XML Implementation Standard | 1.2, 19 May 2023 (not read for this policy) | <https://zatca.gov.sa/ar/E-Invoicing/SystemsDevelopers/Documents/20230519_ZATCA_Electronic_Invoice_XML_Implementation_Standard_%20vF.pdf> |
| Security Features Implementation Standards | 1.2, 19 May 2023 (not read for this policy) | <https://zatca.gov.sa/ar/E-Invoicing/SystemsDevelopers/Documents/20230519_ZATCA_Electronic_Invoice_Security_Features_Implementation_Standards_vF.pdf> |
| Compliance and Enablement Toolbox (SDK) | page updated 28 May 2025 | <https://zatca.gov.sa/en/E-Invoicing/SystemsDevelopers/ComplianceEnablementToolbox> |
| Guidelines index | updated 10 Aug 2026 | <https://zatca.gov.sa/en/E-Invoicing/Introduction/Guidelines/Pages/default.aspx> |

## 2. What ZATCA requires (from the sources)

### 2.1 Three independent environments

| Environment | Purpose | Gateway base | Portal | Stock `l10n_sa_api_mode` |
|---|---|---|---|---|
| Developer portal (Integration Sandbox) | Integration tests for solution developers. Inputs are not acknowledged by ZATCA, invoices are not stored, sandbox CSIDs cannot be used in the core solution, dummy VAT numbers allowed. | `https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal/` | `https://sandbox.zatca.gov.sa/` (developer account) | `sandbox` |
| FATOORA simulation | Optional end-to-end functional testing for taxpayers, not for load testing. Requires accepting its terms and conditions. | `https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation/` | FATOORA portal, "FATOORA Portal Simulation" switch (ERAD credentials) | `preprod` |
| FATOORA production (core solution) | Legal submission. Applies extra validations (security features, prohibited functionalities, seller and buyer referential checks, checks against earlier documents). | `https://gw-fatoora.zatca.gov.sa/e-invoicing/core/` | `https://fatoora.zatca.gov.sa/` (ERAD credentials) | `prod` |

The simulation and production portals are independent: a device onboarded in one is not onboarded in the other
(FATOORA manual §2.G). The CSR certificate template differs: `PREZATCA-Code-Signing` for simulation,
`ZATCA-Code-Signing` for production (FATOORA manual §3). The stock gateway URLs and CSR templates in
`l10n_sa_edi` (`models/account_journal.py` `ZATCA_API_URLS`, `models/certificate.py`) match these values.

Passing the sandbox or the SDK does not mean ZATCA approval. Each taxpayer must still complete onboarding and
the compliance checks in production (Developer Portal manual, Integration Sandbox FAQ 5).

### 2.2 Onboarding (per EGS unit; in LiwanOS one EGS unit is one sales journal)

1. The taxpayer logs into the FATOORA portal (or the simulation portal) with ERAD credentials and generates one or
   more OTPs. **An OTP is valid for one hour** (FATOORA manual §1.B, §2.E).
2. The EGS unit generates a key pair and a CSR and sends the CSR with the OTP to the compliance API. It receives a
   compliance CSID (CCSID), a secret and a request id.
3. The EGS unit passes the compliance checks (standard and/or simplified invoices, credit and debit notes) through
   the compliance invoices API. The production CSID request returns an invalid response until they pass (Developer
   Portal manual §2.3.9).
4. The EGS unit requests the production CSID (PCSID) with the request id. All reporting and clearance calls then
   authenticate with HTTP Basic, the PCSID as user and its secret as password, plus `accept-version: V2`
   (Developer Portal manual §3).

The CSR's functionality map limits what the unit may submit: `1000` standard only, `0100` simplified only,
`1100` both (Technical Guidelines p45).

### 2.3 Renewal, revocation

- Renewal must happen **before** the existing CSID expires and follows the same OTP, CSR and compliance-check path.
  The old CSID is revoked and a new one issued (Technical Guidelines p13, p16).
- The taxpayer can revoke a unit in the FATOORA portal (compromised key, lost or sold unit, unauthorized
  onboarding). **Revocation is irreversible**; the unit can only be onboarded again as a new device (FATOORA
  manual §2.G). ZATCA also revokes automatically on VAT de-registration or suspension, for example when the
  taxpayer joins a VAT group, which then re-onboards under the group TRN (Technical Guidelines p18, p46).
- A unit may submit only while its CSID is neither expired nor revoked (Technical Guidelines p45).

### 2.4 Submission

- **Standard (B2B) documents are cleared before they reach the buyer.** ZATCA stamps them and returns the updated
  QR code; they are valid only once cleared (Technical Guidelines p50). When ZATCA disables clearance, the clearance
  API answers 303 and standard documents go to the reporting API (Developer Portal manual §2.3.11).
- **Simplified (B2C) documents are reported within 24 hours** of the transaction; the seller stamps them itself
  (Technical Guidelines p49).
- Outcomes are rejected, accepted with warnings, or accepted (Technical Guidelines p47-48). Warnings must be
  corrected in future submissions.
- **The previous document hash chains every document to the last generated one, rejected documents included**
  (Technical Guidelines p48).
- The FATOORA portal shows twelve months of submission statistics per outcome, with CSV detail for warnings and
  rejections (FATOORA manual §1.E).

### 2.5 Not found in the official text

- The validity period of a compliance or production CSID. Policy: read it from the issued certificate
  (`l10n_sa_production_csid_validity`, the certificate's `date_end`), never hard-code it.
- Rate limits and retry guidance for the gateway.

## 3. Current LiwanOS state

- `res.company` constraint (`liwan_finance/models/res_company.py`) refuses any `l10n_sa_api_mode` but `sandbox`.
- `liwan.finance.zatca` refuses onboarding, submit and retry outside `sandbox` (422 `zatca_mode_not_allowed`)
  before the documented `sudo()`; no route changes the mode.
- The stock EDI cron is active with a one-day interval; posting or retrying triggers it immediately, so the daily
  run is a fallback. It skips documents blocked with `error`.
- Responses never carry a key, CSR, CSID, secret or raw ZATCA answer.

## 4. Gaps between stock `l10n_sa_edi` and ZATCA's rules

| # | Stock behavior | ZATCA rule | Consequence |
|---|---|---|---|
| G1 | A production CSID can be renewed **only after it expires** (`account_journal.py`: "can only be renewed upon expiry"). | Renew before expiry. | Between expiry and renewal the journal cannot submit; clearance invoices cannot be issued. |
| G2 | Changing `l10n_sa_api_mode` resets the certificates and the chain head (`l10n_sa_latest_submission_hash`) of every journal of the company. | Environments are independent; each needs its own onboarding. | A mode change is a full re-onboarding of every sales journal, with OTPs from the matching portal. |
| G3 | Leaving `prod` is refused once a production submission succeeded (`l10n_sa_edi_is_production`). | Production is the legal record. | Production is one-way; a mistaken switch to `prod` must be caught before the first submission. |
| G4 | The cron's fallback interval is one day and it processes 20 jobs per run. | Simplified documents within 24 hours. | If the immediate trigger fails and ZATCA stays unreachable, the daily fallback alone can miss the 24-hour window. |
| G5 | The chain head lives in the tenant database. | The chain includes every generated document. | Restoring a tenant database to an earlier point rewinds the chain behind what ZATCA already received. |

## 5. Policy (proposed rules)

**P1. Environment ladder.** A company moves `sandbox` → `preprod` (simulation) → `prod`, never skipping a step,
except as decided in D1. Each step re-onboards every sales journal with OTPs from that environment's portal.

**P2. Who switches, and how.** Only a dedicated capability (D2) may change the mode, through one new
`/api/v1/finance/zatca/mode` route with an explicit inline confirmation that names the target environment. Before
switching it requires: a complete company identity (`GET /setup` ready), no `rejected` or `blocked` backlog, and, for
`prod`, a completed simulation (unless D1 waives it). Every switch is written to the finance audit log with the user,
the old and new mode, and the time. Switching back from `prod` stays impossible (G3).

**P3. OTP handling.** The OTP is typed by the customer, used once inside the request, never stored or logged. The UI
says it comes from the matching portal (simulation or production) and expires one hour after it is generated.

**P4. Key and certificate custody.** The private key (`certificate.key`) and the CSID secrets stay in the tenant
database, readable only by the documented `sudo()` path in `zatca_service.py`, never serialized. They are part of
the tenant's encrypted backups. No LiwanOS staff member exports them. A suspected key leak triggers revocation by the
customer in the FATOORA portal and a new onboarding (P6).

**P5. Renewal.** LiwanOS shows each journal's certificate expiry and warns the finance managers 30 days, 7 days and
1 day before it. Because stock renews only after expiry (G1), D3 decides whether LiwanOS adds renewal before
expiry through stock's public methods (R9) or accepts the gap.

**P6. Revocation and re-onboarding.** Revocation is done by the customer in the FATOORA portal; LiwanOS never
revokes. When ZATCA answers that a certificate is not authorized (`unauthorized` state), the journal is marked
not onboarded and the managers are told to onboard it again. A VAT group change needs re-onboarding under the
group TRN.

**P7. Submission timing and monitoring.** Standard invoices are not sent or printed to the buyer before clearance
succeeds. Simplified documents are tracked against the 24-hour window: LiwanOS alerts the finance managers when any
document has waited more than 12 hours or is `rejected` or `blocked`, and shows the backlog on the ZATCA status page.
D4 decides the cron fallback interval.

**P8. Chain integrity and restores.** After a company's first production submission, restoring its database to an
earlier point is forbidden except to recover from data loss, and then only with an operations runbook that
re-reads the last accepted document hash from the restored data, compares it with the FATOORA portal statistics,
and re-submits documents generated after the restore point in their original order. Point-in-time restores of other
tables do not touch the ZATCA documents.

**P9. Responsibility.** The customer is the taxpayer and owns its FATOORA access, OTPs, revocations and the
correctness of its invoices. LiwanOS is the solution provider and owns the EGS behavior (XML, signing, chain,
submission). The SaaS terms of service must state this split before production is enabled (D5).

**P10. Customer-hosted (`non_saas`).** The same rules apply with the customer operating the server; ZATCA traffic
goes straight from the customer's Odoo to the gateway with no vendor connection (R5, R8). The customer's operations
team owns P8 there.

**P11. Go-live evidence.** Production is enabled for real tenants only after:
1. The reference taxpayer (D1: the first pilot customer, a VAT-registered company with its own ERAD account, in its
   own tenant database, with its written consent to run the simulation; it generates the simulation OTPs and accepts
   the simulation terms itself) has onboarded a journal in simulation and submitted, through the LiwanOS UI, at
   least: a standard invoice (cleared), a simplified invoice (reported), a credit note and a debit note of
   each kind, one rejected document followed by a corrected one, and a renewal.
2. The FATOORA simulation statistics show those documents with the expected outcomes; the pilot customer shares a
   screenshot or the CSV export, kept as release evidence. Simulation documents have no tax effect for the pilot
   customer, which later onboards again in production (P1).
3. The Odoo tests of `liwan_finance` cover the mode route, the audit entry, the alerts and the refusals.
4. An `odoo-reviewer` review of the change passes.

**P12. Keeping current.** Before each release that touches ZATCA, and at least every quarter, the guidelines page is
checked for newer versions of the documents in section 1, and this policy is updated.

## 6. Decisions for the owner

D2-D6 are deferred (owner, 2026-10-20) until before the first production server deployment; the recommendations
below are proposals, not decisions.

| # | Decision | Options | Recommendation |
|---|---|---|---|
| D1 | Is simulation mandatory before production? | (a) per tenant; (b) once for the product with a reference taxpayer, optional per tenant; (c) never | **Decided (owner, 2026-10-20): (b), with the first pilot customer as the reference taxpayer.** LiwanOS is not VAT-registered, so it has no ERAD account and cannot open the FATOORA simulation portal itself. ZATCA calls simulation optional, and a per-tenant step adds an OTP round per journal. |
| D2 | Which capability switches the mode? | reuse `finance.zatca.manage`; new `finance.zatca.environment` | New `finance.zatca.environment`, not implied by any other capability, because the switch to `prod` is one-way. |
| D3 | Renewal before expiry | (a) add pre-expiry renewal in `liwan_finance` through stock's public API; (b) accept the gap and renew right after expiry | (a), if it can be done without overriding stock's private methods (R9); otherwise (b) with the P5 warnings and an owner-accepted risk. |
| D4 | Cron fallback interval | keep 1 day; change to 1 hour | 1 hour, so a failed immediate trigger is retried well inside the 24-hour window. |
| D5 | Terms of service | add the P9 split to the SaaS terms | Yes, before the first production tenant. |
| D6 | Who may approve a production switch for a tenant in SaaS | the customer alone; the customer plus a LiwanOS operations check | The customer alone through P2, with the P11 gates already met by the product. |

## 7. Implementation that follows approval (not started)

- Replace the sandbox-only constraint in `liwan_finance/models/res_company.py` and the
  `_liwan_require_sandbox` check in `zatca_service.py` with the P1/P2 rules (no parallel old path).
- Add the mode route, capability (D2), audit entry, expiry and backlog alerts (P5, P7) and the contracts in
  `packages/contracts`, with Odoo and web tests.
- Update the documented `sudo()` reason in `tools/arch_documented_sudo.json` and the ZATCA lines in AGENTS.md and the
  `liwan_finance` README. The `arch_documented_sudo.json` change needs the owner's `Architecture-approved-by:`
  trailer.
- Write the P8 restore runbook under `docs/operations/`.
- Tests keep mocking the gateway; the fake must also cover the simulation base URL.
