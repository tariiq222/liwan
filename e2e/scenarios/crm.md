# CRM (customers and opportunities)

Pages: `/crm` (dashboard), `/crm/opportunities` (list and `?view=board`), `/crm/opportunities/new` (create
panel over the list), `/crm/opportunities/[id]` (record page: calls, sale, loss, reopen, assign),
`/crm/imports` and `/crm/imports/new` (file import in three steps), `/settings/apps/crm` (eleven cards:
preset, terms, follow-up, distribution, privacy, pricing, packages, stages, call outcomes, lost reasons,
sources). Owner: `liwan_crm` (rank-4 application on stock `crm`; contracts in `packages/contracts`).
Routes sit under `/api/v1/crm`. The export (`GET /api/v1/crm/export`) and the view log
(`GET /api/v1/crm/audit/views`) have no page yet; they are API-only scenarios. Personas and status
values: [README](README.md).

Capability note: nine capabilities. The built-in role «موظف العملاء» (`crm_agent`) holds
`crm.leads.read` and `crm.leads.work`; «مدير العملاء» (`crm_manager`) holds all nine. Dependencies are
added automatically: every key except `crm.settings.read` needs `crm.leads.read`; `crm.leads.import`
also needs `crm.leads.assign`; `crm.settings.manage` needs `crm.settings.read` and `crm.leads.assign`.
No seeded persona holds a CRM role, so the rows name `custom role (...)`: give a seeded employee the
built-in role, or a custom role with the keys listed. `system_admin` holds no CRM capability, and vendor
support is stripped of every CRM key. Features: `crm.enabled`, and the sub-features `crm.import` (import
routes) and `crm.export` (export route).

Error note: API errors quoted below are the server messages. A missing capability answers 403
`forbidden` «<key> capability is required» (a route that accepts either key answers «one of <keys>
capability is required»); feature off answers 403 `feature_not_included` «this feature is not included».
A hidden, foreign (another company) or missing opportunity answers the same 404 `not_found` «Record does
not exist». Paging is `limit` (default 50, at most 200) and `offset`; a bad value answers 422 `invalid`
«limit and offset must be non-negative integers». Settings defaults (no saved row): preset
`phone_packages`, 2 follow-up attempts every 24 hours, after attempts `lost`, recycle on after 30 days for
1 cycle, distribution `round_robin`, visibility `own`, view log off, discount off with a 0% maximum. The
seed lists are the stages New, Contacted, Interested, Won (won), the lost reason «Contact attempts
exhausted» (protected) and six call outcomes (No answer, Will think about it, Asked to call later:
follow-up; Sold: won; Not interested, Wrong number: lost).

## Access and features

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |

## Dashboard

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |

## Opportunities list

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |

## Visibility

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |

## Create an opportunity

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |

## Record page and changes

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |

## Calls and follow-up

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| CRM-55 | Call validation | custom role (crm_agent «موظف العملاء») | No outcome: UI «اختر نتيجة الاتصال», API 422 «field is required»; missing outcome 422 «outcome does not exist»; note over 2000 422 «must be text of up to 2000 characters»; duration 1500 422 «must be a number from 0 to 1440» | `POST /api/v1/crm/opportunities/<id>/calls` | automated | 2026-11-03: the button is disabled only before hydration or while pending, so a click with no outcome shows «اختر نتيجة الاتصال» and records nothing; the t4 claim that the button stays disabled was wrong \| apps/web/e2e/crm-opportunities.spec.ts: recording a call without an outcome shows the required message instead of sending; 2026-11-02 code check: since ae029b3e3 the submit button is disabled only before hydration or while pending (CrmOpportunityCallForm.vue:33,83) and «اختر نتيجة الاتصال» shows after an attempt (line 62); the t4 claim that the button stays disabled contradicts the code, so this row needs a real re-run before it can pass; #285; API validation messages match; UI: submit is disabled until an outcome is chosen so اختر نتيجة الاتصال never appears; see findings4 |

## Sale, loss and reopening

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |

## Distribution

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |

## Import

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |

## Export and view log

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |

## Settings page and values

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| CRM-111 | Privacy card | custom role (crm_manager «مدير العملاء») | «من يرى الفرص» فرصه فقط / فريقه / الجميع with hints and «سجل الاطلاع» switch; the chosen mode takes effect at once for agents (CRM-26..28) | `page /settings/apps/crm` `PATCH /api/v1/crm/settings` | automated | 2026-11-03: the privacy card offers only «فرصه فقط» and «الجميع» (team removed) and saves the view log switch, which survives a reload; the read/write effect of each mode is covered by liwan_crm test_crm_visibility.py \| apps/web/e2e/crm-settings.spec.ts; 2026-11-03: the privacy card now offers «فرصه فقط» and «الجميع» only (the team mode is removed end-to-end); the card options are asserted in apps/web/e2e/crm-settings.spec.ts, and each mode's read/write effect is covered by liwan_crm tests/test_crm_visibility.py; the view-log switch on the card is still not re-verified end-to-end; partial run 2026-10-29, the unchecked part keeps this row planned: visibility own, team, all took effect at once for agents (CRM-26 to 28); card UI not exercised; visibility own, team, all took effect at once for agents (CRM-26 to 28); card UI not exercised |
| CRM-112 | Pricing card | custom role (crm_manager «مدير العملاء») | «السماح بالخصم» and «أعلى نسبة خصم (%)» 0–100; the sale rules follow (CRM-69..72) | `page /settings/apps/crm` `PATCH /api/v1/crm/settings` | automated | 2026-11-03: the pricing card saves «السماح بالخصم» with a ceiling and the above-list policy, and the saved ceiling survives a reload \| apps/web/e2e/crm-settings.spec.ts; partial run 2026-10-29, the unchecked part keeps this row planned: discount_allowed and max 10 saved and rules followed (CRM-69 to 72); restored; card UI not exercised; discount_allowed and max 10 saved and rules followed (CRM-69 to 72); restored; card UI not exercised |

## Settings lists

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| CRM-134 | Sector presets apply a whole policy at once | custom role (crm_manager «مدير العملاء») | The settings page offers عام، اتصال وباقات، خدمات احترافية، مشاريع وعقود، تعليم وتدريب; choosing one and confirming sets its twelve documented values and leaves the terms, the distribution users and the five lists untouched | `page /settings/apps/crm` `PATCH /api/v1/crm/settings` `cap crm.settings.manage` | automated | liwan_crm test_crm_settings.py + apps/web/e2e/crm-settings.spec.ts |
| CRM-135 | Chance to win | custom role (crm_agent «موظف العملاء») | The record shows «الاحتمال», an agent can save 0–100 (422 on field `probability` outside it or for a non-number), the value survives a reload and the list shows it per row | `page /crm/opportunities/[id]` `PATCH /api/v1/crm/opportunities/<id>` | automated | liwan_crm test_crm_opportunities.py + apps/web/e2e/crm-probability.spec.ts |
