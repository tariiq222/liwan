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
The first administrator of a tenant with `crm.enabled` holds «مدير العملاء» (`crm_manager`) like every
other application's manager role. The seeded personas hold no CRM role, so the rows name `custom role (...)`:
give a seeded employee the built-in role, or a custom role with the keys listed. `system_admin` itself holds
no CRM capability, and vendor support is stripped of every CRM key. Features: `crm.enabled`, and the sub-features `crm.import` (import
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

## Quotations from an opportunity (the Sales bridge)

Owner: `liwan_sales_crm`. Routes: `GET` and `POST /api/v1/crm/opportunities/<id>/orders`.

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| CRM-136 | Write a quotation from an opportunity that has a customer | custom role (crm_agent «موظف العملاء» plus «مندوب مبيعات») | The panel «عروض الأسعار والطلبات» lists the opportunity's quotations and orders with a link to each; «عرض سعر جديد» creates a draft for the opportunity's customer and opens it in Sales; a reader of the opportunity without the quotations right sees the list and no button; an opportunity of another agent is a 404 | `page /crm/opportunities/[id]` `POST /api/v1/crm/opportunities/<id>/orders` `GET /api/v1/crm/opportunities/<id>/orders` `cap crm.leads.read` `cap sales.quotations.manage` | automated | apps/web/e2e/sales-crm.spec.ts; liwan_sales_crm test_opportunity_orders.py |
| CRM-137 | An opportunity without a customer, or a lost one, takes no quotation | custom role (crm_agent «موظف العملاء» plus «مندوب مبيعات») | The panel says to link a customer first, or that a closed or archived opportunity takes none, and offers no button; the API answers 422 `crm_opportunity_without_customer` or `crm_opportunity_closed` | `POST /api/v1/crm/opportunities/<id>/orders` | automated | apps/web/e2e/sales-crm.spec.ts; liwan_sales_crm test_opportunity_orders.py |
| CRM-138 | Confirming an order wins the opportunity | custom role (crm_agent «موظف العملاء» plus «مندوب مبيعات») | The opportunity shows «تم البيع» with «مبلغ الربح», the untaxed total of its confirmed orders (the taxed total by setting); a second confirmed order adds to it; cancelling the order afterwards leaves it won; whoever confirms it (staff, the customer's acceptance, a payment) wins it; a lost or archived opportunity stays as it is | `POST /api/v1/sales/orders/<id>/confirm` `POST /api/v1/public/sales/quotations/<id>/accept` | automated | apps/web/e2e/sales-crm.spec.ts (staff confirm); liwan_sales_crm test_opportunity_win.py and test_opportunity_win_by_payment.py (the other paths, second order, cancel, lost) |
| CRM-139 | With Sales in the plan the package form steps aside | custom role (crm_agent «موظف العملاء» plus «مندوب مبيعات») | The opportunity page has no sale action and no «تم البيع» outcome in the call form, and offers «ربح بعرض سعر»; in a tenant without Sales, or with the setting «يدويًا», the package form is back; the API still accepts a package win | `page /crm/opportunities/[id]` `GET /api/v1/crm/opportunities/<id>` | automated | apps/web/e2e/sales-crm.spec.ts; liwan_sales_crm test_opportunity_win.py |

## Conversation to opportunity (the Inbox bridge)

Owner: `liwan_crm_inbox`. Routes: `POST`, `PUT`, `DELETE /api/v1/inbox/conversations/<id>/opportunity`, `GET /api/v1/crm/opportunities/<id>/conversations`.

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| CRM-140 | Create an opportunity from a WhatsApp conversation | custom role (crm_agent «موظف العملاء» plus inbox_agent «موظف رسائل العملاء») | «إنشاء فرصة» on the conversation card creates the opportunity with the source «واتساب» and the contact's linked customer; the conversation card then shows the opportunity and the opportunity page lists the conversation | `page /inbox/[id]/[[id]]` `page /crm/opportunities/[id]` `POST /api/v1/inbox/conversations/<id>/opportunity` `GET /api/v1/crm/opportunities/<id>/conversations` | automated | e2e/tests/inbox-opportunity.e2e.ts (npm run e2e:odoo, green 2026-11-19; persona `inbox_crm_agent` and the WhatsApp channel with two conversations are seeded by tools/e2e_seed.py); the source «واتساب» is read from the opportunity API and the conversation list on the opportunity page links back to the thread |
| CRM-141 | A conversation whose phone already has an opportunity opens the picker | custom role (crm_agent «موظف العملاء» plus inbox_agent «موظف رسائل العملاء») | «إنشاء فرصة» answers 422 `invalid` with reason `duplicate_phone`, no second opportunity is created, the card opens the picker with the existing opportunity listed and linking it shows it on the card | `page /inbox/[id]/[[id]]` `POST /api/v1/inbox/conversations/<id>/opportunity` `PUT /api/v1/inbox/conversations/<id>/opportunity` | automated | e2e/tests/inbox-opportunity.e2e.ts (npm run e2e:odoo, green 2026-11-19); the test removes a link left by an earlier run on the reused database and checks the opportunity total is unchanged |

## Customers directory privacy (PDPL)

Owner: `liwan_customers`. Erase and export are for the system administrator; routes under `odoo-addons/liwan_customers/controllers/privacy.py`.

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| CUS-1 | Privacy entry on the customer record | it_admin | The «⋯» menu on /customers/[id] lists «الخصوصية والبيانات الشخصية» and opens the privacy page with the export and erase sections | `page /customers/[id]`, `page /customers/[id]/privacy`, `cap customers.erase`, `cap customers.privacy.export` | manual 2026-11-14 | menu item present; no direct link on the page |
| CUS-2 | Export one customer's personal data | it_admin | A reason is required; «تصدير الملف» downloads customer-<id>-<date>.xlsx whose sheets include Customer, Bank accounts, Tags, Messaging contacts, Messages, CRM opportunities and Payments, and which holds the phone and IBAN | `POST /api/v1/customers/<id>/privacy/export`, `page /customers/[id]/privacy` | manual 2026-11-14 | file opens, 12 sheets incl. Not included; it works only while the administrator has no CRM role, see CUS-4 |
| CUS-3 | Erase review blocked when the administrator cannot reach every record | it_admin | The review lists what will be erased and kept, and an error panel «لا يمكن تنفيذ المسح الآن» naming CRM and customer-messages records the role cannot reach; the confirm step does not appear | `POST /api/v1/customers/<id>/privacy/erase-preview`, `page /customers/[id]/privacy` | manual 2026-11-14 | retest: it_admin alone is blocked as designed (panel says ask a wider role); a UI-created user with system_admin + crm_manager + inbox_manager reviews and erases such a customer, so the way out works |
| CUS-4 | Administrator who also holds crm_manager can still review and export | it_admin with crm_manager | Preview and export answer 200 as before (more reach, not less) | `POST /api/v1/customers/<id>/privacy/erase-preview`, `POST /api/v1/customers/<id>/privacy/export` | manual 2026-11-14 | retest: earlier 403 was an artifact of roles added through the shell; user created at /settings/team/users/new with the three roles gets 200 on preview and export and completes a full erase (CRM lead, inbox contact and message cleared; contact shown as «Erased contact 3») |
| CUS-5 | Erase a customer through the UI | it_admin | Review, reason and the customer's name typed; a wrong name shows «الاسم غير مطابق…» and keeps the button off; the right name erases; «مُسحت البيانات الشخصية للعميل»; the record shows the erased customer; a new review says «هذا العميل ممسوح» | `POST /api/v1/customers/<id>/privacy/erase`, `page /customers/[id]`, `page /customers/[id]/privacy` | manual 2026-11-14 | on a customer with a tag, bank account and attachment; the erased record is named «Erased customer 40» in English inside the Arabic UI |
| CUS-6 | Erase validation | it_admin | Wrong confirmation 422 field `confirmation` (token stays usable), empty reason 422 field `reason`, 501 characters 422, extra field 422 `unknown_field`, unknown customer 404 | `POST /api/v1/customers/<id>/privacy/erase` | manual 2026-11-14 | all five answers as expected; a wrong confirmation does not spend the token (the same token then erased) |
| CUS-7 | Erase token: expired, other customer, already used | it_admin | Each answers 422 `invalid_token` and nothing is erased | `POST /api/v1/customers/<id>/privacy/erase` | manual 2026-11-14 | expired (row aged in the database), token of another customer and a reused token all 422 invalid_token |
| CUS-8 | Privacy routes and page refused without the capabilities | staff1, crm_manager, hr_manager, cfo | Preview, export and erase answer 403 `forbidden`; the page shows the forbidden state; no privacy entry exists | `POST /api/v1/customers/<id>/privacy/erase-preview`, `POST /api/v1/customers/<id>/privacy/export`, `cap customers.read` | manual 2026-11-14 | four personas: 403 on three routes, forbidden page; the customer detail is itself forbidden for them so there is no entry |
| CUS-9 | Privacy and customer pages in light and dark at desktop and phone | it_admin | No horizontal scroll, readable contrast, RTL, no raw keys | `page /customers/[id]/privacy` | manual 2026-11-14 | no overflow at 390 and 1440, light and dark |
| CUS-10 | Customer privacy export and review while the tenant is read-only for non-payment | it_admin | Owner decision needed: the tenant export stays open as a read, the per-customer export and review answer 403 `tenant_read_only` | `POST /api/v1/customers/<id>/privacy/export` | decision | #719; non-payment suspension: both routes answer 403 tenant_read_only although they only read; owner to say whether a subject export must stay open |
