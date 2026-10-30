# ZATCA: what is ready, and what only the owner can release

Status: **preparation only** (2026-10-20). Nothing here changes the sandbox confinement of `liwan_finance`
(`models/zatca_service.py`, `_liwan_require_sandbox`). The production policy
([draft](../superpowers/specs/2026-10-20-zatca-production-policy.md)) is not approved and the owner deferred its decisions
D2 to D6 until before the first production server deployment, so production invoicing for real tenants stays a release blocker.

## Ready and tested (sandbox)

| Need | Where | Evidence |
| --- | --- | --- |
| Onboarding per sales journal (compliance CSID, compliance checks, production CSID) | `POST /zatca/journals/<id>/onboard`, `models/zatca_service.py` | `tests/test_finance_zatca_flow.py` against a fake gateway that only answers the sandbox URL |
| Submission, retry, no double submission, state kept on the document | `POST /invoices/<id>/zatca/submit`, `/retry` | same file; a document already accepted is `invalid_state` |
| Rejection, outage and local failure told apart | `serializers/zatca.py` (`rejected`, `retry`, `blocked`, `unauthorized`) | same file |
| Standard (clearance) and simplified (reporting) invoices, with their credit and debit notes | stock `l10n_sa_edi`, `mode` in the submission | `tests/test_finance_zatca.py` |
| Backlog counts and the **work list of stuck documents** | `GET /zatca/status` (`backlog`), `GET /zatca/documents?state=` | `TestFinanceZatcaWorkList` |
| Keys, CSR, CSIDs and raw responses never leave the service | `secret_keys` assertions on every response and on the logs | `tests/test_finance_zatca*.py` |
| Connection status per company | `liwan_integrations_sa` | onboarding updates it |

Secrets are per company already: the private key and the CSIDs live on the company and its journals in stock models, one
database per tenant.

## What a move to simulation and production needs

These are the changes, listed so the owner can approve them; none is made.

1. **Policy decisions D2 to D6** of the draft (environments, who may switch them, key custody and renewal, submission timing,
   evidence before go-live). Until approved, `zatca_mode_not_allowed` stays.
2. **A per-company environment switch** in the finance setup, behind a new capability that no built-in role other than the
   manager holds and that is not granted to custom roles by default, writing `l10n_sa_api_mode` (`sandbox`, `preprod`, `prod`)
   and logging an audit event. Leaving the sandbox must drop the onboarding of every sales journal (a device onboarded in one
   environment is not onboarded in another).
3. **`_liwan_require_sandbox` becomes a policy check** of the allowed modes of that company; `preprod` first, `prod` only
   after a recorded go-live evidence step.
4. **The `sudo()` case** in `tools/arch_documented_sudo.json` for `zatca_service.py` is worded "sandbox api mode only": widening
   it needs the owner's `Architecture-approved-by:` trailer.
5. **A real-gateway test lane** that is never part of CI (it needs a real OTP and taxpayer): a documented manual procedure with
   its evidence, run by the owner or a delegate against the simulation environment.
6. **A tax review** by a qualified Saudi accountant of the seller and buyer data, the document types and the tax categories the
   company uses.

## What stays outside the code

Passing the sandbox or the SDK is not ZATCA approval; each taxpayer completes onboarding and the compliance checks in
production. LiwanOS never claims compliance because the code is complete.
