# WebVue CRM, phase 1

Status: design for owner approval, 2026-10-28. Nothing here is implemented yet.

## Intent

WebVue gets a CRM application, `webvue_crm`, built on stock Odoo 19 Community `crm` (LGPL-3) and
presented only through the Nuxt UI under `/crm`. It is the first application designed under the owner
constitution of 2026-10-28 (AGENTS.md, "Configurable, sector-flexible applications"): one product that
serves many sectors, where each tenant shapes the CRM from its own settings, with good defaults, and
where an assistant can later read those settings and recommend values.

The first expected customer sells service packages priced from 700 SAR to 30,000 SAR by phone. Their
sector is sensitive: it is never named in code, data, fixtures, locale strings, presets or documents.
Everything that customer needs is expressed as generic settings; nothing branches on a customer name or
type (R6).

### Why

- Many sectors sell differently; a rigid CRM fits one kind of company only.
- The owner wants each tenant to have "the options that fit it" without code changes or forks.
- Later, the AI assistant (`webvue_ai`) will propose settings per tenant, so settings must be explicit,
  structured and readable through the API.

## Goals

1. Import customers from a CSV or XLSX file with column mapping, duplicate detection by phone and a
   source per batch.
2. Distribute new customers to the sales team (round robin, manual or chosen at import).
3. A call workflow: the agent calls (a `tel:` link), records the outcome; a sale closes the opportunity
   as won; any other outcome schedules automatic follow-up attempts.
4. Automatic follow-up: by default two extra attempts, 24 hours apart; when they are exhausted the
   opportunity is lost with the reason "contact attempts exhausted" (or handed to the manager), and it
   comes back after 30 days for one more cycle.
5. Packages with prices; the opportunity value comes from the chosen package; discounts are bounded.
6. Strict privacy by default: each agent sees only their own customers; managers see all.
7. A CRM settings page under Settings > Applications that holds every option above.
8. A manager and agent dashboard on the CRM landing page.

## Non-goals (phase 1)

- Telephony (Asterisk, `voip_oca`, softphone, call recording): a later `webvue_telephony` shared
  service. Phase 1 only offers `tel:` links and manual call logging.
- Google Sheets sync and the website form: phase 1b, built on the same import pipeline (see Import).
- Payments, invoices, quotations: a later `webvue_crm_finance` bridge.
- Converting a won deal into a project (`webvue_crm_pmo`), marketing campaigns, email sequences,
  WhatsApp.
- A separate "lead" stage before the opportunity (stock `crm` lead/opportunity split). Phase 1 has one
  record type: the opportunity. See "What is left to the builder".
- Free renaming of every UI string.

## Anti-goals (a failure even if it works)

- The sector of the first customer appears anywhere in the product or repository.
- Customer contact data leaks: to other agents under the default policy, to global search, to the
  people/directory pickers, to `res.partner` lists of other applications, or through exports.
- A settings page so long or technical that a manager gives up. Every option has a working default and
  the page works untouched.
- Any customer-specific condition in code, or a second copy of Odoo's CRM logic.
- The Odoo web client being needed for any step.

## Constraints

- AGENTS.md rules R1–R10, the clean pre-release codebase rules, the user-facing decisions and
  configurable policies section and the 2026-10-28 constitution.
- `webvue_crm` is a rank-4 application created with `tools/new_app.py` (`.claude/skills/webvue-new-app`).
  Depends on `webvue_api`, `webvue_notify`, stock `crm`, `product`, and OCA `crm_phonecall` (AGPL-3,
  used unmodified; our additions live in `webvue_crm`). `crm_phonecall` is present on OCA `crm` branch
  19.0 (manifest depends `crm`, `calendar`; checked 2026-10-28 at commit
  `6051e0bfffd1c89b1a52585aaf322b6c2bcff6f2`). `OCA/crm` is added to `deploy/oca-addons.json` pinned to
  that commit, and to the addons path and deploy images like the other OCA repositories; the owner's
  standing authorization covers this under `docs/UPDATE_POLICY.md`.
- The constitution section is added to AGENTS.md by PR tariiq222/webvue#130 (branch
  `codex/docs-configurable-apps`); this design already follows it.
- No `sudo()` anywhere in `webvue_crm` (none is expected; document any case per R7 if one is truly
  needed).
- Every route: `type='json2'`, `auth='user'`, `@api_handler`, `requires_feature('crm.enabled')`,
  capability checks, current-company scope, `{items, total}` list envelopes, 403/404/422 structured
  errors.
- Arabic first, RTL; locale namespace `crm`. UI components from Storybook; presentation per DESIGN.md
  (pages, `SharedCreatePanel` for `/new`, board view via `?view=board`, inline destructive confirmation).
- Works in `saas` and `non_saas` (R8). Nothing commercial.
- Known gap from the new-app recipe: about 11 foundation tests pin the current app set; they are
  generalised in a separate foundation change, not edited inside this application.

## Decisions made with the owner

| Topic | Decision |
| --- | --- |
| Terms | Default words are العميل / الفرصة / الباقة. A tenant may rename exactly these three terms in settings, each with singular, plural and grammatical gender. Display only; data, API and reports keep fixed keys. |
| Sales flow | The team calls; a sale closes as won. Otherwise automatic follow-up. |
| Follow-up | Two extra attempts, 24 hours apart (three calls in total). Count and interval are settings. |
| After attempts | Default: close as lost with the reason "contact attempts exhausted". Alternative setting: hand to the manager. Re-attempt after 30 days (setting, on by default), one cycle (setting); then the opportunity stays lost. A manager can reopen or reassign at any time. |
| Intake | File import (CSV/XLSX) in phase 1; Google Sheets right after (read-only, OAuth, never "publish to web"); website later. |
| Distribution | Setting: round robin (default), manual pool, or chosen at import. The manager picks who takes part. Follow-ups stay with the same agent. The manager can reassign. |
| Visibility | Setting: own records (default, managers see all), team, everyone. Always: CRM customers stay out of global search and people lists for users without CRM capabilities; export has its own capability (managers by default); edit history always on. |
| View audit log | A setting (off by default); when on, every opening of a customer record is logged for managers. |
| Packages | A list of packages with name, price, short description, active flag. The opportunity value comes from the chosen package. |
| Discount | Setting: allowed or not, and a maximum percentage; above it, only a holder of the discount-approval capability can save. |
| Win | "Sold" requires a package and a final price; closes as won and cancels pending follow-ups. |
| Everything else | Left to Claude's judgment "as long as it has settings" (owner, 2026-10-28). Those calls are marked *(Claude's call)* below. |

## Design

### Data model

- **Opportunity** = stock `crm.lead` with `type='opportunity'`, forced by every WebVue create path
  (manual, import, recycle); the stock lead setting stays off. *(Claude's call.)* The customer's name and phone live on
  the opportunity (`contact_name`, `phone`, `phone_sanitized`, `email_from`); phase 1 creates **no
  `res.partner`** for a CRM customer, so customers never appear in other applications' partner lists.
  *(Claude's call: privacy by construction; the finance bridge will create the partner on win later.)*
- `webvue_crm` adds to `crm.lead`: `webvue_package_id`, `webvue_list_price` (from the package at
  selection), `webvue_discount_percent`, `webvue_final_price`, `webvue_attempt_count` (calls in the
  current cycle), `webvue_next_call_at`, `webvue_cycle` (recycle count), `webvue_import_batch_id`,
  `webvue_recycle_at`. `expected_revenue` is computed from the final price (one source of truth).
- **Package** = `product.template` with a boolean `webvue_crm_package`; price in `list_price`.
  *(Claude's call: the later finance bridge invoices the same product without a mapping table.)*
- **Call** = OCA `crm.phonecall`, linked to the opportunity, with an added `webvue_outcome_id`.
  Duration and notes are optional.
- **Call outcome** = new `webvue.crm.call.outcome` (name translated, sequence, active, `effect`
  selection: `follow_up`, `won`, `lost`, `none`, and for `lost` an optional `lost_reason_id`).
  Seeded: no answer (follow_up), will think (follow_up), asked to call later (follow_up), sold (won),
  not interested (lost), wrong number (lost). Editable in settings.
- **Stages** = stock `crm.stage`; seeded: جديد، تم التواصل، مهتم، تم البيع (is_won). Editable in settings
  (rename, reorder, add, archive; exactly one won stage). Stock stages and lost reasons have no
  company; in a database-per-tenant deployment they are tenant-wide lists. *(Claude's call.)*
- **Lost reasons** = stock `crm.lost.reason`; seeded list plus the protected system reason "contact
  attempts exhausted" (cannot be archived, referenced by XML id).
- **Sources** = stock `utm.source` (the `source_id` of the opportunity); editable list in settings.
- **Settings** = `webvue.crm.settings`, one row per company (unique `company_id`, `revision` for
  optimistic concurrency), following `webvue.hr.shift.settings`. A missing row reads defaults at
  revision 0 without writing.
- **Import batch** = `webvue.crm.import.batch` (company, user, file name, source, counts, state) and
  **mapping profile** = `webvue.crm.import.mapping` (company, name, column map). The file itself is not
  kept after processing.
- **View log** = `webvue.crm.view.log` (company, user, opportunity, datetime); written only while the
  setting is on.
- Every new model declares `_webvue_scope = 'company'` where it carries a company.

### Settings (`webvue.crm.settings`)

Every field has a default so the page works untouched. GET returns each value plus, for enumerations,
its allowed options, so an assistant can read and propose settings.

| Group | Field | Default |
| --- | --- | --- |
| Preset | `preset` (`general`, `phone_packages`) | `general` |
| Terms | `term_customer`, `term_opportunity`, `term_package`: each `{singular, plural, gender}` per language | عميل/عملاء/m, فرصة/فرص/f, باقة/باقات/f |
| Follow-up | `followup_attempts` (0–10) | 2 |
| | `followup_interval_hours` (1–720) | 24 |
| | `after_attempts` (`lost`, `manager`) | `lost` |
| | `recycle_enabled` | true |
| | `recycle_after_days` (1–365) | 30 |
| | `recycle_cycles` (0–5) | 1 |
| Distribution | `distribution_mode` (`round_robin`, `manual`, `on_import`) | `round_robin` |
| | `distribution_user_ids` (users holding `crm.leads.work`) | all agents |
| Privacy | `visibility` (`own`, `team`, `all`) | `own` |
| | `view_log_enabled` | false |
| Pricing | `discount_allowed` | false |
| | `discount_max_percent` (0–100) | 0 |
| Lists | stages, call outcomes, lost reasons, sources, packages: managed on the same settings page, each its own card | seeded |

A **preset** applies a group of values at once (follow-up, distribution, visibility, discount and the
seeded lists) and the manager can change any value afterwards; the preset only records the starting
point. Presets change the company settings row only; the tenant-wide lists (stages, outcomes, lost
reasons, sources) are seeded once at install and edited by any holder of `crm.settings.manage`, and a
preset never rewrites them. *(Claude's call.)* Phase 1 ships `general` (follow-up off: `followup_attempts` 0; manual distribution) and
`phone_packages` (the owner's flow above). Preset names and descriptions are generic.
*(Claude's call; matches the constitution's "sector presets".)*

The terms setting feeds the locale layer: CRM strings that mention a term use an ICU message with the
term's singular/plural and gender (Arabic agreement such as "حالة جديدة"), so a renamed term reads
correctly. Terms change display only.

### Capabilities and roles

Capabilities (owner `webvue_crm`): `crm.leads.read`, `crm.leads.work` (call, log outcomes, edit own
customers), `crm.leads.assign` (reassign, manual pool, reopen), `crm.leads.import`, `crm.leads.export`,
`crm.discount.approve`, `crm.settings.read`, `crm.settings.manage`, `crm.audit.read`.
Roles: `role_crm_agent` (read, work) and `role_crm_manager` (all). Membership alone grants nothing.
Sub-features in the registry: `crm.enabled`, `crm.import`, `crm.export`.

### Visibility, enforced on the server

- `own`: an agent reads and writes opportunities where `user_id` is the agent; holders of
  `crm.leads.assign` read all opportunities of the current company.
- `team`: an agent reads opportunities of the sales teams (`crm.team`) they belong to; write remains
  own-only.
- `all`: every CRM user of the company reads all; write remains own-only unless `crm.leads.assign`.
- The policy applies to list, detail, calls, attachments, export and the dashboard counts. Tests cover
  each mode for read, write, export and attachments, plus other-company isolation.
- Unassigned opportunities are visible only to holders of `crm.leads.assign`, in every mode
  (stock `crm`'s "Personal Leads" rule shows unassigned leads to salesmen; WebVue does not).
  *(Claude's call.)* `role_crm_agent` implies `sales_team.group_sale_salesman` and `role_crm_manager`
  implies `sales_team.group_sale_salesman_all_leads`, only so the stock ACLs allow the ORM calls; the
  visibility policy above is enforced by `webvue_crm` on top of them (a rule or route domain, builder's
  choice) and tests prove that the stock group rules never widen it. The Odoo web client and generic
  endpoints stay closed, so stock menus and chatter are reachable only through the CRM routes.
- No global search provider and no people/directory exposure for users without `crm.leads.read`;
  the CRM search provider returns only records visible under the policy.
- Edit history uses stock mail tracking. Tracked fields: stage, agent, contact name, phone, email,
  package, final price, discount, lost reason, source. The view log is written by the detail route when
  `view_log_enabled` is on, and is readable only with `crm.audit.read`.

### Follow-up engine

1. The agent records a call with an outcome.
2. `won` → the sale flow below. `lost` → closes as lost with the outcome's reason. `none` → nothing.
3. `follow_up` → `webvue_attempt_count += 1`. If the count is at most `followup_attempts`,
   `webvue_next_call_at = now + followup_interval_hours`, same agent. Otherwise:
   - `after_attempts = lost`: close as lost with "contact attempts exhausted"; if recycling is on and
     `webvue_cycle < recycle_cycles`, set `webvue_recycle_at = now + recycle_after_days`.
   - `after_attempts = manager`: keep the agent, set the boolean `webvue_needs_manager`, and notify
     holders of `crm.leads.assign`; it appears in its own "needs a decision" list and dashboard count,
     separate from the "unassigned" pool of manual distribution. A manager reassigns, reopens a cycle or
     closes it; no automatic recycle. *(Claude's call.)*
4. A cron (every 15 minutes) reopens due recycles: restores the same opportunity, stage back to the
   first stage, `webvue_cycle += 1`, attempt count reset, back to the same agent if still eligible,
   otherwise distributed under the current mode, history kept. *(Claude's call: reopen the same record instead of creating a new one, so the
   customer keeps one history and one source of truth.)*
5. The same cron sends a bell notification (`crm.followup_due`) when a follow-up becomes due; new
   assignments send `crm.assigned`. Both are registered in `webvue.notify.registry`.
6. Won, lost or manual reassignment clears pending follow-up times.
Settings changes apply to future scheduling only; already scheduled times are not rewritten.

### Sale flow

"Sold" (or a `won` outcome) opens an inline form: package (required), final price prefilled from the
package, optional discount. The server rejects a discount when `discount_allowed` is false, and a
discount above `discount_max_percent` unless the caller holds `crm.discount.approve`. On success the
opportunity moves to the won stage, `expected_revenue` equals the final price, pending follow-ups are
cleared.

### Import

1. Upload CSV or XLSX (limit 5,000 rows and 5 MB per file; *Claude's call*).
2. Map columns: name (required), phone (required), email, notes, package, source; an existing mapping
   profile can be reused and the mapping can be saved.
3. Choose the source (required) and, when `distribution_mode = on_import`, the agent.
4. Preview: counts of new, duplicate and invalid rows, with the first invalid rows and their reasons.
   Phones are normalised with stock `phone_validation` using `company.country_id` (Saudi Arabia when
   unset); a number without a country code is read as local; a number that cannot be normalised is
   invalid. A duplicate is a normalised phone that already exists on any opportunity of the company,
   open, won or lost, or appears twice in the file; duplicates are skipped, never merged. The preview
   lists duplicates by file row number only, never the existing record or its agent, so an importer
   learns nothing about records hidden by the visibility policy. *(Claude's call.)* Manual
   `POST /opportunities` uses the same duplicate check and answers 422 `invalid` with the same
   non-disclosing message.
5. Confirm: opportunities are created in the first stage, distributed, and the batch keeps the counts.
6. The parser and mapper sit behind one intake service, so Google Sheets (phase 1b) and the website
   form become new sources of rows, not new pipelines.

### Distribution

- `round_robin`: the next agent among `distribution_user_ids` in a stable order. The pointer is a
  column on the company settings row, advanced under a row lock (`SELECT ... FOR UPDATE` through the
  ORM's `_lock_for_update` or `flush` + `lock`) so concurrent imports stay fair. Users who no longer hold
  `crm.leads.work` or are archived are skipped; when nobody is eligible the opportunity goes to the
  unassigned pool and the import summary says so (not an error). *(Claude's call.)*
- `manual`: new opportunities stay unassigned in the "unassigned" list for holders of
  `crm.leads.assign`.
- `on_import`: the importer picks one agent for the whole batch.
Follow-ups and recycled opportunities follow the rule in the follow-up engine.

### API (all under `/api/v1/crm`)

- `GET /opportunities` (filters: stage, agent, source, due, unassigned, q; `{items, total}`),
  `POST /opportunities`, `GET/PATCH /opportunities/<id>`, `POST /opportunities/<id>/calls`,
  `POST /opportunities/<id>/won`, `POST /opportunities/<id>/lost`, `POST /opportunities/<id>/reopen`,
  `POST /opportunities/<id>/assign`.
- `POST /imports/preview`, `POST /imports`, `GET /imports`, mapping profiles CRUD.
- `GET /export` (CSV of the caller's visible list, `crm.leads.export`).
- `GET /dashboard`.
- `GET/PATCH /settings` (revision CAS, 409 on stale) and CRUD for stages, outcomes, lost reasons,
  sources, packages.
- `GET /audit/views` (`crm.audit.read`).
- Zod contracts in `packages/contracts/src/crm/` mirror every serializer exactly.

### UI (Nuxt, `apps/web/app/{pages,components,modules}/crm`)

- `/crm`: dashboard. Agent: "calls due now" list (with `tel:` link), today's new customers, my won
  this month. Manager: unassigned count, due follow-ups, won count and value this month, conversion
  by source, per-agent table. *(Claude's call.)*
- `/crm/opportunities`: list with filters; `?view=board` for the stage board.
- `/crm/opportunities/<id>`: customer details, package and price, call log, record-call form with
  outcomes, sale and lost actions inline, history.
- `/crm/opportunities/new`: `SharedCreatePanel`.
- `/crm/imports` and `/crm/imports/new`: import flow (upload, mapping, preview, confirm).
- `/settings/apps/crm`: one settings page with cards: preset, terms, follow-up, distribution,
  privacy, pricing, packages, stages, outcomes, lost reasons, sources.
- Rail entry and nav per the manifest recipe; bell kinds `crm.assigned`, `crm.followup_due`.

## Acceptance

- Odoo tests (`WebVueApiCase`): every route for 200, 403, 404, 422, feature closed, other company;
  each visibility mode for read, write, export, attachments; follow-up scheduling, exhaustion in both
  `after_attempts` modes, recycle cron and cycle limit; discount rules; import preview and commit with
  duplicates and invalid rows; round robin fairness; settings defaults without a row, CAS conflict,
  validation ranges; view log on and off; protected lost reason.
- Contracts and web unit tests; `vue-tsc` lint; Storybook stories for new shared components.
- One journey test `e2e/tests/crm.e2e.ts`: import a file, call, record "no answer", see the follow-up
  due, record "sold" with a package.
- Gates from the new-app recipe: `npm test`, web lint, `arch_policy`, `git_policy`, `catalog_check`,
  `ruff`, scratch-database install and tests of all release modules.
- A grep of the diff finds no word that names the first customer's sector.

## What is left to the builder

- Exact field names and serializer shapes, within the contracts rules.
- How the visibility policy is enforced (record rules reading the company setting, or route-level
  domains plus rules), provided it is server-side for every path listed above and tested per mode.
- The ICU message structure for the renamable terms.
- Dashboard query shapes and chart choices from the Storybook catalog.
- Whether phase 1 also enables the stock lead stage as a later setting: not in phase 1; keep the data
  model compatible with adding it as a setting.
