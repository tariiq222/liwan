# WebVue CRM phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `webvue_crm`, a sector-flexible, tenant-configurable CRM application (file import, call
follow-up engine, packages, server-enforced visibility) with its Nuxt UI under `/crm`.

**Architecture:** A rank-4 Odoo addon `webvue_crm` extends stock `crm.lead`, `product.template` and OCA
`crm.phonecall`, adds a per-company settings row and small owned models, and exposes everything through
`/api/v1/crm/*` json2 routes with zod contracts in `packages/contracts/src/crm`. The Nuxt app module
`crm` renders dashboard, opportunities, imports and one settings page under Settings > Applications.

**Tech Stack:** Odoo 19 Community (`crm`, `product`, `phone_validation`, `utm`), OCA `crm_phonecall`
(19.0), Python `openpyxl` (already an Odoo requirement), Nuxt 4 + Nuxt UI, zod, vitest, Playwright/e2e.

**Spec:** `docs/superpowers/specs/2026-10-28-webvue-crm-phase1-design.md` (owner-approved 2026-10-28).
Read it before any task; this plan only adds the implementation decisions.

## Global Constraints

- AGENTS.md R1–R10, "Clean pre-release codebase", "User-facing decisions and configurable customer
  policies" and "Configurable, sector-flexible applications — owner constitution 2026-10-28".
- Follow `.claude/skills/webvue-new-app/SKILL.md` and `.claude/skills/webvue-api-endpoint` for every route.
- Every route: `type='json2'`, `auth='user'`, explicit `methods`, `@api_handler`,
  `@requires_feature('crm.enabled', ...)`, `@requires_capability(...)`; lists return `{items, total}`
  and use `parse_page`; errors 403 `forbidden`, 404 `not_found`, 409 `conflict`, 422 `invalid`.
- No `sudo()` in `webvue_crm`. No edits outside the files the new-app recipe allows plus
  `deploy/oca-addons.json` and this plan.
- No word naming the first customer's sector anywhere (code, data, locale, fixtures, presets, commits).
- Arabic first; every string through `t()` in the `crm` namespace; logical Tailwind classes.
- Settings defaults (exact): `followup_attempts=2`, `followup_interval_hours=24`, `after_attempts='lost'`,
  `recycle_enabled=True`, `recycle_after_days=30`, `recycle_cycles=1`, `distribution_mode='round_robin'`,
  `visibility='own'`, `view_log_enabled=False`, `discount_allowed=False`, `discount_max_percent=0`,
  `preset='general'`; terms عميل/عملاء (m), فرصة/فرص (f), باقة/باقات (f); English customer/customers,
  opportunity/opportunities, package/packages.
- Ranges (422 outside): attempts 0–10, interval 1–720 h, recycle days 1–365, cycles 0–5, discount 0–100.
- Import limits: 5,000 rows, 5 MB, `.csv` (UTF-8, UTF-8 BOM) and `.xlsx` only.
- Odoo tests run on a fresh `webvue_scratch_crm_*` database from `/Users/tariq/code/odoo`, never `odoo19`.
- Commits `feat(crm): ...` (scope becomes valid once `webvue_crm` is in `tools/arch_layers.json`),
  ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Phone inputs in local shapes (`05xxxxxxxx`, `5xxxxxxxx`, `+966 5x xxx xxxx`, `00966…`,
   Arabic-Indic digits `٠٥…`, spaces/dashes) must normalise to the same E.164 value and be detected as
   duplicates. Test in Task 7.
2. A settings change after follow-ups are scheduled must not move existing `webvue_next_call_at` values.
   Test in Task 5.
3. Two concurrent imports under round robin must not assign the same pointer slot twice. Test in Task 4.
4. A CSV saved by Excel in Arabic Windows (`cp1256`) or with blank trailing rows/columns must give a
   clear 422 (encoding) or skip blank rows, never a 500. Test in Task 7.
5. An agent whose `crm.leads.work` is removed keeps no write access to their former opportunities,
   and their due follow-ups go back to distribution on the next cron run. Test in Task 6.

---

### Task 1: Scaffold `webvue_crm`, dependencies, capabilities and features

**Files:**
- Create (via `python3 -B tools/new_app.py crm --name-ar "العملاء" --name-en "CRM"`): the scaffold set
  listed by `--dry-run` (addon, contracts, manifest, page, locales).
- Delete from the scaffold: `models/crm_record.py`, `serializers/crm_record.py`,
  `controllers/crm_records.py`, `tests/test_crm_records.py` and the placeholder contract schema
  (replaced by real resources in later tasks; no placeholder survives).
- Modify: `odoo-addons/webvue_crm/__manifest__.py`, `models/access_service.py`,
  `models/feature_registry.py`, `security/*`, `data/crm_access_permissions.xml`,
  `deploy/oca-addons.json` (add `{"repo": "OCA/crm", "branch": "19.0", "commit": "6051e0bfffd1c89b1a52585aaf322b6c2bcff6f2"}`
  and the module `crm_phonecall` in the same shape as the other entries).
- Test: `odoo-addons/webvue_crm/tests/test_crm_access_composition.py`, `tests/test_crm_features.py`.

**Interfaces:**
- Produces: capability keys `crm.leads.read`, `crm.leads.work`, `crm.leads.assign`, `crm.leads.import`,
  `crm.leads.export`, `crm.discount.approve`, `crm.settings.read`, `crm.settings.manage`, `crm.audit.read`;
  roles `webvue_crm.role_crm_agent` (read, work) and `webvue_crm.role_crm_manager` (all); features
  `crm.enabled`, `crm.import`, `crm.export` (owner `webvue_crm`); test base `WebVueCrmCase` in
  `tests/common.py` with users `crm_agent`, `crm_agent2`, `crm_manager`, `crm_outsider` (passwords
  `<login>_pass_123`), `cls.company`, `cls.other_company`.
- Group mapping: `role_crm_agent` implies `sales_team.group_sale_salesman`; `role_crm_manager` implies
  `sales_team.group_sale_salesman_all_leads`.

- [ ] **Step 1:** Clone OCA/crm at the pinned commit to `/Users/tariq/code/oca-19.0/crm` and append it to
  the scratch `--addons-path` used in `docs/agents/odoo-rules.md`.
- [ ] **Step 2:** Run the scaffold dry run, then the real scaffold; delete the placeholder files above.
- [ ] **Step 3: Write the failing tests**

```python
def test_capability_catalog_lists_crm_keys(self):
    keys = {c['key'] for c in self.env['webvue.access.service']._webvue_capability_definitions() if c['owner'] == 'webvue_crm'}
    self.assertEqual(keys, {'crm.leads.read', 'crm.leads.work', 'crm.leads.assign', 'crm.leads.import',
                            'crm.leads.export', 'crm.discount.approve', 'crm.settings.read',
                            'crm.settings.manage', 'crm.audit.read'})

def test_agent_role_grants_only_read_and_work(self):
    self.assertEqual(self.capabilities_of(self.agent) & CRM_KEYS, {'crm.leads.read', 'crm.leads.work'})

def test_manager_role_grants_every_crm_key(self):
    self.assertEqual(self.capabilities_of(self.manager) & CRM_KEYS, CRM_KEYS)

def test_membership_alone_grants_no_crm_key(self):
    self.assertFalse(self.capabilities_of(self.outsider) & CRM_KEYS)

def test_features_registered_with_owner(self):
    defs = {d['key']: d for d in self.env['webvue.feature.registry']._webvue_feature_definitions()}
    for key in ('crm.enabled', 'crm.import', 'crm.export'):
        self.assertEqual(defs[key]['owner'], 'webvue_crm')
```

- [ ] **Step 4:** Run `-i webvue_crm --test-tags /webvue_crm` on a scratch DB. Expected: FAIL (keys missing).
- [ ] **Step 5:** Implement the manifest depends `['webvue_api', 'webvue_notify', 'crm', 'product', 'crm_phonecall']`,
  the capability/role/feature definitions and groups.
- [ ] **Step 6:** Re-run. Expected: PASS. Run `python3 -B tools/arch_policy.py --base main` and
  `python3 -B tools/catalog_check.py`. Expected: no violation.
- [ ] **Step 7:** Commit `feat(crm): scaffold the CRM application and its capabilities`.

### Task 2: Settings model, presets and settings API

**Files:**
- Create: `models/crm_settings.py`, `serializers/settings.py`, `controllers/settings.py`,
  `packages/contracts/src/crm/settings.ts`.
- Test: `tests/test_crm_settings.py`, `packages/contracts/src/crm/__tests__/schemas.test.ts`.

**Interfaces:**
- Produces model `webvue.crm.settings` (`_webvue_scope='company'`, unique `company_id`, `revision`
  Integer, the fields of the spec settings table, `term_<customer|opportunity|package>_<singular|plural>_<ar|en>`
  Char + `term_<…>_gender` Selection `m|f`, `distribution_user_ids` Many2many `res.users`,
  `round_robin_index` Integer).
- `@api.model _webvue_current() -> record` (empty recordset when no row);
  `@api.model _webvue_effective() -> dict` (row values or exact defaults; never writes).
- `PRESETS: dict[str, dict]` in `models/crm_settings.py`: `general` = defaults with `followup_attempts=0`,
  `distribution_mode='manual'`; `phone_packages` = the Global Constraints defaults.
- Routes: `GET /api/v1/crm/settings` (`crm.settings.read`) → `{values, options, revision}` where `options`
  maps each enum field to its allowed values and each numeric field to `{min, max}`;
  `PATCH /api/v1/crm/settings` (`crm.settings.manage`) takes `{revision, values}` (partial) or
  `{revision, preset}`; stale revision → 409 `conflict`.
- Zod: `CrmSettingsSchema`, `CrmSettingsPatchSchema`.

- [ ] **Step 1: Write the failing tests**

```python
def test_get_without_row_returns_defaults_at_revision_zero_and_writes_nothing(self):
    body = self.as_manager().api('GET', '/api/v1/crm/settings').json()
    self.assertEqual(body['revision'], 0)
    self.assertEqual(body['values']['followup_attempts'], 2)
    self.assertEqual(body['values']['visibility'], 'own')
    self.assertFalse(self.env['webvue.crm.settings'].search([('company_id', '=', self.company.id)]))

def test_options_describe_every_enum_and_range(self):
    options = self.as_manager().api('GET', '/api/v1/crm/settings').json()['options']
    self.assertEqual(options['visibility'], ['own', 'team', 'all'])
    self.assertEqual(options['followup_interval_hours'], {'min': 1, 'max': 720})

def test_patch_with_stale_revision_is_409(self): ...          # revision 0 twice → second 409 conflict
def test_out_of_range_value_is_422(self): ...                 # followup_attempts=11 → 422 invalid, field
def test_preset_phone_packages_sets_its_values(self): ...     # preset → followup_attempts 2, round_robin
def test_agent_cannot_patch(self): ...                        # 403 forbidden
def test_other_company_row_is_untouched(self): ...
```

- [ ] **Step 2:** Run; expected FAIL (route 404).
- [ ] **Step 3:** Implement model, `PRESETS`, serializer `dump_settings(effective, revision)` /
  `parse_settings_patch(payload) -> dict`, controller with savepoint + `UniqueViolation` → 409 as in
  `webvue_hr/controllers/shifts/settings.py`. Zod schemas mirror `dump_settings` exactly.
- [ ] **Step 4:** Run Odoo tests and `npm test -w packages/contracts`. Expected PASS.
- [ ] **Step 5:** Commit `feat(crm): add company CRM settings and presets`.

### Task 3: Configurable lists (stages, outcomes, lost reasons, sources, packages)

**Files:**
- Create: `models/call_outcome.py` (`webvue.crm.call.outcome`), `models/product_template.py`
  (`webvue_crm_package` Boolean), `data/crm_seed.xml`, `serializers/lists.py`, `controllers/lists.py`,
  `packages/contracts/src/crm/lists.ts`.
- Test: `tests/test_crm_lists.py`.

**Interfaces:**
- Seed XML ids: stages `stage_new` (جديد), `stage_contacted` (تم التواصل), `stage_interested` (مهتم),
  `stage_won` (تم البيع, `is_won`); outcomes `outcome_no_answer`, `outcome_thinking`, `outcome_call_later`
  (`follow_up`), `outcome_sold` (`won`), `outcome_not_interested`, `outcome_wrong_number` (`lost`);
  lost reason `lost_reason_attempts_exhausted` ("انتهت محاولات التواصل") — protected.
- Routes (read `crm.settings.read`, write `crm.settings.manage`):
  `GET|POST /api/v1/crm/{stages,outcomes,lost-reasons,sources,packages}`,
  `PATCH|DELETE /api/v1/crm/<list>/<id>` (DELETE archives). Stages also `POST /api/v1/crm/stages/order`
  `{ids: number[]}`. Package shape `{id, name, price, description, active}`.
- Package read is also allowed with `crm.leads.read` (agents pick packages).

- [ ] **Step 1: Write the failing tests:** seed present after install; exactly one won stage
  (archiving or un-flagging the last won stage → 422); archiving the protected lost reason → 422;
  an outcome with `effect='lost'` and a reason referencing an archived reason → 422; package CRUD with
  `price >= 0` (negative → 422); agent reads packages (200) but POST → 403; translated names for `ar`/`en`.
- [ ] **Step 2:** Run; FAIL. **Step 3:** Implement. **Step 4:** Run; PASS.
- [ ] **Step 5:** Commit `feat(crm): add configurable CRM lists and packages`.

### Task 4: Distribution service

**Files:**
- Create: `models/distribution.py` (AbstractModel `webvue.crm.distribution`).
- Test: `tests/test_crm_distribution.py`.

**Interfaces:**
- `_webvue_eligible_agents(company) -> res.users` — active users in `distribution_user_ids` (or every
  holder of `crm.leads.work` in the company when empty) who still hold `crm.leads.work`, ordered by id.
- `_webvue_assign(leads, mode=None, agent=None) -> None` — applies the company mode: `round_robin` takes
  locks the company settings row (our own table, so R9 allows it) with `row.flush_recordset()` then
  `self.env.cr.execute(SQL('SELECT 1 FROM %s WHERE id = %s FOR UPDATE', SQL.identifier(row._table), row.id))`,
  and advances `round_robin_index`. `manual` leaves `user_id` empty; `on_import` sets `agent` (must be eligible,
  else 422). No eligible agent → unassigned and returns without error.
- Creates the settings row on first assignment if missing (pointer needs a row).

- [ ] **Step 1: Write the failing tests:** three agents, six leads → two each in id order; an agent losing
  `crm.leads.work` is skipped; empty eligibility → all unassigned; `on_import` with an ineligible agent →
  `ApiError` 422; two cursors (`self.registry.cursor()`) assigning concurrently never pick the same index
  (Review Focus 3).
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(crm): distribute new opportunities to agents`.

### Task 5: Opportunities, visibility policy, duplicates and view log

**Files:**
- Create: `models/crm_lead.py`, `models/view_log.py` (`webvue.crm.view.log`), `models/visibility.py`,
  `security/crm_rules.xml` (replace scaffold content), `serializers/opportunity.py`,
  `controllers/opportunities.py`, `packages/contracts/src/crm/opportunity.ts`.
- Test: `tests/test_crm_visibility.py`, `tests/test_crm_opportunities.py`.

**Interfaces:**
- `crm.lead` fields per spec (`webvue_package_id`, `webvue_list_price`, `webvue_discount_percent`,
  `webvue_final_price`, `webvue_attempt_count`, `webvue_next_call_at`, `webvue_cycle`,
  `webvue_recycle_at`, `webvue_needs_manager`, `webvue_import_batch_id`); `expected_revenue` computed
  stored from `webvue_final_price`; tracking on the spec's tracked fields.
- `webvue.crm.visibility._webvue_domain(user) -> list` — the read domain for the effective mode;
  `_webvue_check_write(leads, user) -> None` raises `AccessError` unless own or `crm.leads.assign`.
  Every route and every later task reads through these two; record rules mirror them so ORM paths
  (attachments, messages) cannot widen access. Unassigned → only `crm.leads.assign`.
- `crm.lead._webvue_normalize_phone(raw, company) -> str | False` (stock `phone_validation`, country
  `company.country_id or base.sa`, Arabic-Indic digits mapped first).
- `crm.lead._webvue_find_duplicate(phone_e164, company) -> bool` (searches `active_test=False`, no read
  of the found record is returned).
- Routes: `GET /api/v1/crm/opportunities` (filters `stage_id, user_id, source_id, due, unassigned,
  needs_manager, q`), `POST` (forces `type='opportunity'`, duplicate → 422 with message
  `"duplicate phone"`, no id), `GET|PATCH /api/v1/crm/opportunities/<id>` (detail writes a view log row
  when `view_log_enabled`), `GET /api/v1/crm/audit/views` (`crm.audit.read`).

- [ ] **Step 1: Write the failing tests** (`test_crm_visibility.py`), one class per mode, each with
  read list, read detail, PATCH, attachment read via `ir.attachment` search as the user, and the export
  domain helper:
  - `own`: agent sees own only; agent2's record → detail 404; unassigned invisible; manager sees all.
  - `team`: agents of one `crm.team` see each other's records, PATCH on a teammate's → 403.
  - `all`: everyone reads; PATCH on another's → 403 unless manager.
  - other-company record → 404 for everyone; stock salesman rule never widens `own` (agent in
    `group_sale_salesman_all_leads` via a direct group add still sees own only).
- [ ] **Step 2: Write the failing tests** (`test_crm_opportunities.py`): create forces opportunity type;
  duplicate across lost/archived records → 422 without leaking id or agent; view log written only when
  enabled; `outsider` → 403; feature closed → refused; settings change does not rewrite existing
  `webvue_next_call_at` (Review Focus 2).
- [ ] **Step 3–5:** FAIL → implement → PASS (Odoo + contracts).
- [ ] **Step 6:** Commit `feat(crm): add opportunities with server-enforced visibility`.

### Task 6: Calls, follow-up engine, sale and lost flows, cron and bell

**Files:**
- Create: `models/phonecall.py` (`webvue_outcome_id` on `crm.phonecall`), `models/followup.py`
  (AbstractModel `webvue.crm.followup`), `models/notification_types.py`, `data/crm_cron.xml`,
  `serializers/call.py`, `controllers/calls.py`, `controllers/sale.py`,
  `packages/contracts/src/crm/call.ts`.
- Test: `tests/test_crm_followup.py`, `tests/test_crm_sale.py`, `tests/test_crm_cron.py`.

**Interfaces:**
- `webvue.crm.followup._webvue_record_call(lead, outcome, note=None, duration=None) -> crm.phonecall`
  implements spec "Follow-up engine" steps 2–3 exactly; `_webvue_cron_tick(now=None) -> None` implements
  steps 4–5 and Review Focus 5 (due follow-ups whose agent lost `crm.leads.work` → `_webvue_assign`).
- `crm.lead._webvue_mark_won(package, final_price, discount_percent, user) -> None`,
  `_webvue_mark_lost(reason, user) -> None`, `_webvue_reopen(user) -> None`,
  `_webvue_reassign(agent, user) -> None`; all clear `webvue_next_call_at`/`webvue_needs_manager` as the
  spec says.
- Discount rule: `discount_allowed=False` and discount > 0 → 422; discount > `discount_max_percent`
  without `crm.discount.approve` → 403 `forbidden`.
- Bell kinds `crm.assigned` and `crm.followup_due` registered in `webvue.notify.registry`
  (`owner='webvue_crm'`, `feature_key='crm.enabled'`), readable ids from `_webvue_domain`.
- Cron every 15 minutes, `model_webvue_crm_followup`, `_webvue_cron_tick`.
- Routes: `POST /api/v1/crm/opportunities/<id>/calls` `{outcome_id, note?, duration_minutes?}`,
  `GET …/calls`, `POST …/won` `{package_id, final_price, discount_percent?}`, `POST …/lost` `{lost_reason_id}`,
  `POST …/reopen`, `POST …/assign` `{user_id}` (`crm.leads.assign`).

- [ ] **Step 1: Write the failing tests** with a frozen clock (`freezegun` is not available; pass `now`
  explicitly and set `create_date`/fields directly):
  - no answer ×1 → attempt 1, next call +24 h, same agent; ×2 → +24 h; ×3 with `after_attempts='lost'`
    → lost with `lost_reason_attempts_exhausted`, `webvue_recycle_at = now + 30 d`;
  - same with `after_attempts='manager'` → still assigned, `webvue_needs_manager=True`, no recycle,
    a `crm.followup_due` is not sent but managers get `crm.assigned`;
  - `recycle_cycles=1`: tick at +30 d reopens to `stage_new`, cycle 1, attempts 0, same agent;
    exhausting again → lost with no `webvue_recycle_at`;
  - sold outcome without package → 422; won clears next call; discount rules both cases;
  - agent losing `crm.leads.work` → tick redistributes their due follow-ups and they get 404 on detail;
  - bell rows visible only to the owning agent under `own`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(crm): add the call follow-up engine and sale flow`.

### Task 7: Import pipeline

**Files:**
- Create: `models/import_batch.py` (`webvue.crm.import.batch`, `webvue.crm.import.mapping`),
  `models/intake.py` (AbstractModel `webvue.crm.intake`), `serializers/imports.py`,
  `controllers/imports.py`, `packages/contracts/src/crm/imports.ts`.
- Test: `tests/test_crm_import.py`, fixtures `tests/data/*.csv|*.xlsx` (generic names only).

**Interfaces:**
- `webvue.crm.intake._webvue_read_rows(filename: str, content: bytes) -> list[dict[str, str]]`
  (CSV via `csv` with `utf-8-sig`, `UnicodeDecodeError` → 422 `invalid` field `file`; XLSX via
  `openpyxl.load_workbook(read_only=True, data_only=True)`; blank rows dropped; limits from Global
  Constraints → 422).
- `_webvue_preview(rows, mapping, company) -> {new, duplicate, invalid, invalid_rows: [{row, reason}], duplicate_rows: [int]}`.
- `_webvue_commit(rows, mapping, source, agent, company, user) -> import.batch` — creates opportunities in
  `stage_new`, then `_webvue_assign`. Rows are any source's rows (file now; Sheets/website later).
- Routes (feature `crm.import`, capability `crm.leads.import`): `POST /api/v1/crm/imports/preview`
  and `POST /api/v1/crm/imports` with `{file_name, content_base64, mapping: {name, phone, email?, notes?, package?},
  source_id, user_id?, mapping_profile?}`; `GET /api/v1/crm/imports`; `GET|POST|DELETE
  /api/v1/crm/import-mappings`.

- [ ] **Step 1: Write the failing tests:** CSV and XLSX produce identical rows; BOM handled; cp1256
  file → 422 (Review Focus 4); blank trailing rows skipped; 5,001 rows → 422; phone variants from Review
  Focus 1 all normalise to `+9665…` and in-file repeats count as duplicates; existing lost record's phone
  counts as duplicate; preview lists duplicate row numbers only; commit counts match preview; source
  required → 422; `on_import` agent applied; agent (no `crm.leads.import`) → 403; `crm.import` closed → refused.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(crm): import customers from CSV and XLSX files`.

### Task 8: Export and dashboard

**Files:**
- Create: `controllers/export.py`, `controllers/dashboard.py`, `serializers/dashboard.py`,
  `packages/contracts/src/crm/dashboard.ts`.
- Test: `tests/test_crm_export.py`, `tests/test_crm_dashboard.py`.

**Interfaces:**
- `GET /api/v1/crm/export` (feature `crm.export`, `crm.leads.export`) → `text/csv` of `_webvue_domain`
  rows, columns: name, phone, email, stage, agent, source, package, final price, created.
- `GET /api/v1/crm/dashboard` (`crm.leads.read`) → `{agent: {due_now, new_today, won_this_month: {count, value}},
  manager: null | {unassigned, needs_manager, due_follow_ups, won_this_month: {count, value},
  conversion_by_source: [{source_id, name, total, won}], agents: [{user_id, name, open, won, due}]}}`;
  `manager` only for `crm.leads.assign`; every count uses `_webvue_domain`.

- [ ] **Step 1: Write the failing tests:** export follows each visibility mode and is 403 for agents;
  dashboard agent counts only own; manager block null for agents; conversion numbers on a known fixture.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(crm): add CRM export and dashboard`.

### Task 9: Web module, terms and settings page

**Files:**
- Modify: `apps/web/app/modules/crm/manifest.ts`, `apps/web/i18n/locales/{ar,en}/crm.json`.
- Create: `apps/web/app/composables/crm/useCrmSettings.ts`, `useCrmTerms.ts`,
  `apps/web/app/pages/settings/apps/crm.vue` (or the folder form used by `settings/apps/hr`),
  `apps/web/app/components/crm/settings/*.vue`, stories `apps/web/stories/crm/settings/*.stories.ts`.
- Test: `apps/web/app/modules/crm/__tests__/manifest.test.ts`, `composables/crm/__tests__/useCrmTerms.test.ts`.

**Interfaces:**
- Manifest: rail `{id:'crm', icon:'i-lucide-handshake', to:'/crm', order: <next free above 50>}`; nav
  `/crm` (dashboard, `crm.leads.read`), `/crm/opportunities` (`crm.leads.read`), `/crm/imports`
  (`crm.leads.import`); `routeCapabilities` for `/crm/opportunities/new` (`crm.leads.work`) and
  `/crm/imports/new` (`crm.leads.import`); `settings: {id:'crm', to:'/settings/apps/crm', parts:[preset,
  terms, followup, distribution, privacy, pricing, packages, stages, outcomes, lostReasons, sources]}`;
  bell kinds `crm.assigned` → `/crm/opportunities/<id>`, `crm.followup_due` → same.
- `useCrmTerms()` returns `term(key: 'customer'|'opportunity'|'package', form: 'one'|'other') -> string`
  and `gender(key) -> 'm'|'f'`; locale messages use ICU `select` on gender and `plural` on count, e.g.
  `"newRecord": "{gender, select, f {{term} جديدة} other {{term} جديد}}"`.
- Settings page: one card per part, each saving through `PATCH /settings` with the current revision;
  409 shows the reload message; lists use their own routes.

- [ ] **Step 1: Write the failing tests:** manifest shape test; `useCrmTerms` renders "حالة جديدة" for a
  feminine renamed term and "عميل جديد" by default; plural forms for 0, 1, 2, 11.
- [ ] **Step 2–4:** FAIL → implement → PASS (`npm test`, `cd apps/web && npm run lint`).
- [ ] **Step 5:** Commit `feat(crm): add the CRM module and settings page`.

### Task 10: Opportunities UI (list, board, detail, create, call, sale)

**Files:**
- Create: `apps/web/app/composables/crm/useOpportunities.ts`, `pages/crm/opportunities/index.vue`,
  `pages/crm/opportunities/[id].vue`, `pages/crm/opportunities/new.vue` (`SharedCreatePanel`),
  `components/crm/opportunity/*.vue` (call form, sale form inline, lost form inline, call log),
  stories under `apps/web/stories/crm/opportunity/`.
- Test: component tests next to the composable; `apps/web/e2e/crm-opportunities.spec.ts` against the mock.

**Interfaces:** consumes Task 5/6 routes and zod schemas; list filters live in the URL query and survive
back navigation; `?view=board` shows stages; phone renders as `tel:` link; destructive actions confirm
inline.

- [ ] **Step 1:** Add the CRM routes to the mock API used by `apps/web/e2e` (see `docs/testing.md` §3).
- [ ] **Step 2: Write the failing spec:** open list → filter "due" → open record → record "no answer" →
  next call shown → record "sold" with a package → won badge; board view lists four stages.
- [ ] **Step 3–5:** FAIL → implement → PASS (`cd apps/web && npm run test:e2e -- crm-opportunities`).
- [ ] **Step 6:** Commit `feat(crm): add opportunity pages and the call flow`.

### Task 11: Imports UI and dashboard UI

**Files:**
- Create: `composables/crm/useCrmImports.ts`, `useCrmDashboard.ts`, `pages/crm/index.vue` (replace the
  scaffold page), `pages/crm/imports/index.vue`, `pages/crm/imports/new.vue`,
  `components/crm/imports/*.vue`, `components/crm/dashboard/*.vue`, stories.
- Test: `apps/web/e2e/crm-imports.spec.ts`.

**Interfaces:** upload → mapping (reuse a saved profile) → preview counts with invalid reasons and
duplicate row numbers → confirm; dashboard agent and manager blocks from Task 8.

- [ ] **Step 1: Write the failing spec:** upload fixture CSV → map columns → preview shows 3 new,
  1 duplicate, 1 invalid → confirm → list shows 3 new records; dashboard shows "due now".
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(crm): add the import flow and CRM dashboard`.

### Task 12: Journey test, gates and review

**Files:**
- Create: `e2e/tests/crm-journey.e2e.ts`.

- [ ] **Step 1:** Write the journey: import a file, call, "no answer", follow-up due, "sold" with a package.
  Run `npm run e2e -- e2e/tests/crm-journey.e2e.ts`. Expected PASS.
- [ ] **Step 2:** Run the gates from the new-app recipe §8: `npm test`, `(cd apps/web && npm run lint)`,
  `python3 -B tools/arch_policy.py --base main`, `python3 -B tools/git_policy.py --base main`,
  `python3 -B tools/catalog_check.py`, `ruff check odoo-addons`, scratch install + tests of all release
  modules. Expected: all green except the known foundation pins named in the recipe, which are reported,
  not edited.
- [ ] **Step 3:** Sector-word check: `git diff main --name-only | xargs rg -n -i -f .scratch/crm/forbidden-words.txt`
  (the word list stays in git-ignored `.scratch/`). Expected: no match.
- [ ] **Step 4:** Run the `odoo-reviewer` agent and `tools/jev_review.mjs --base main --task "webvue_crm phase 1"`;
  fix blocking findings.
- [ ] **Step 5:** Commit `test(crm): add the CRM journey test`, then publish per the PR flow.
