# webvue_finance

The Finance application over stock `account`, `base_vat` and `l10n_sa`: reads of the books, the company
setup and the VAT summary.

## Routes (`/api/v1/finance`, lists use `{items, total}` envelopes)

- `/invoices` and `/invoices/<id>`: `finance.invoices.read`
- `/payments`: `finance.payments.read`
- `/accounts`: `finance.accounts.read`
- `/journals`: `finance.journals.read`
- `GET /setup`: `finance.setup.read`. Chart, company tax identity, fiscal settings, journal and tax counts,
  ZATCA readiness, `ready` and stable `blockers` codes (`chart_not_loaded`, `vat_15_tax_missing`,
  `company_vat_missing`, `company_registry_missing`, `company_address_incomplete`, `zatca_not_onboarded`)
- `POST /setup/chart` (loads the Saudi `sa` chart, 422 `chart_already_loaded` when one is loaded),
  `PATCH /setup/company` (`vat`, `company_registry`, `street`, `city`, `state_id`, `country_id`) and
  `PATCH /setup/fiscal` (`fiscalyear_last_day`, `fiscalyear_last_month`, the sale, purchase, tax and
  global lock dates; never the irreversible hard lock date): `finance.setup.manage` (needs
  `finance.setup.read`); each returns the full setup status
- `GET /reports/vat?date_from&date_to`: `finance.reports.read`. Per tax base and tax amount for sales
  and purchases of the posted entries of the current company, and `net_payable` (output minus input VAT)

Every route also requires the `finance.enabled` feature. The built-in `finance_manager`
role (and `webvue_core`'s vendor support role) holds every capability.

## Deliberate ORM grant

Each capability group implies stock `account.group_account_readonly`. The routes read in the
caller's own environment (no `sudo()`), so the caller needs ORM read rights; stock ACLs and
multi-company record rules scope the data. Consequence: any one finance capability grants ORM
read of all accounting data, and only the route gates per capability
(`tests/test_finance_capability_isolation.py`). The same approach is used by `webvue_hr`
(`hr.group_hr_user`). Future write capabilities must not imply `account.group_account_invoice`
or `account.group_account_manager` without a review.

## Setup elevation (documented `sudo()` cases)

Stock refuses `account.chart.template` loads to non-administrators and `res.company` writes without the
Access Rights group. After the route's `finance.setup.manage` check, `webvue.finance.setup` elevates in
exactly two methods, the R7 case "finance setup (chart load, company tax identity)":

1. `_webvue_load_chart`: loads the Saudi template `sa` only, into the current company (`env.company`).
   It refuses (422) when a chart is loaded (`chart_already_loaded`), the company has branches
   (`company_has_branches`, stock recurses into them) or it already has journal entries.
2. `_webvue_write_company`: writes the current company only, restricted to a field whitelist
   (`vat`, `company_registry`, `street`, `city`, `state_id`, `country_id` and the fiscal year day/month and
   the four non-hard lock dates). Any other field, including `hard_lock_date`, raises `AccessError`.

Through `PATCH /setup/fiscal` a lock date can only be tightened (set, or moved later); removing or
moving one earlier is 422 `lock_date_loosening`, done by an accounting administrator in Odoo. Stock
`RedirectWarning`s (for example unreconciled bank lines before a lock date) become 422 `invalid`
without the action link. Changing only `country_id` re-validates the existing `state_id` (422 on `state_id`).

Both re-check that the record is the current company. Reads, validation and serializers stay in the
caller's environment. A caller without `finance.setup.manage` gets 403 and nothing changes
(`tests/test_finance_setup.py`).

## VAT report scope

`GET /reports/vat` groups posted journal items per individual tax: a group tax appears as its child
taxes, cash-basis taxes count at the invoice date, and only the current company is read (not branches).

## ZATCA readiness is read-only

`serializers/zatca.py` reports, from stock `l10n_sa_edi` data when that module is installed
(`{installed: false}` otherwise): the API mode, whether a private key exists, and per sale journal
`onboarded` and `state` (`not_started`, `compliance_checked`, `onboarded`). Key material, CSR, CSIDs
and tokens are never read into the shape (`tests/test_finance_zatca.py` scans every output for
secret-like keys and values). No onboarding action and no network call exist here.

## VAT summary source

The Saudi 'VAT Return' (`l10n_sa.tax_report_vat_filing`) is data only in Community: the `account.report`
engine that evaluates its `tax_tags` expressions ships with Enterprise `account_reports`. The summary
therefore groups posted `account.move.line` rows with `_read_group` (base by `tax_ids` on product lines,
tax by `tax_line_id`), signed as a return reads. A reverse-charge tax shows its base and a net tax of
zero.
