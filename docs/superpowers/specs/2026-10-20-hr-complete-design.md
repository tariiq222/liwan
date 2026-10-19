# HR complete: recruitment, shifts, onboarding, offboarding, assets — design spec

Date: 2026-10-20. Status: binding for the `hr-complete` team. Base: `main` @ `aea18077`,
integration branch `codex/hr-complete` (`.worktrees/hr-complete`).

## 1. Goal and owner decisions

Add five HR capabilities to the HR application `webvue_hr`, each a thin WebVue surface over a
ready-made engine. No engine is written from scratch.

| # | Capability | Engine (internal) | Source verified |
|---|---|---|---|
| 1 | Recruitment | stock `hr_recruitment` (`hr.job`, `hr.applicant`, `hr.recruitment.stage`, `hr.applicant.refuse.reason`, `applicant.get.refuse.reason` wizard, `create_employee_from_applicant`) | `/Users/tariq/code/odoo/addons/hr_recruitment` |
| 2 | Shifts (work schedules) | OCA `hr_employee_calendar_planning` 19.0.1.2.2 (AGPL-3, `hr.employee.calendar` date-ranged `resource.calendar` rows) on stock `resource.calendar` | OCA/hr 19.0 @ `23e948031779315958c3897652d04da813a058fb` |
| 3 | Onboarding plans | stock `hr` + `mail` activity plans (`mail.activity.plan`, `mail.activity.plan.template`, `mail.activity.schedule.action_schedule_plan`) | `addons/hr/models/mail_activity_plan*.py`, `addons/hr/wizard/mail_activity_schedule.py` |
| 4 | Resignation / departure clearance | stock `hr.departure.reason` + `hr.departure.wizard.action_register_departure` (`departure_date`, `departure_reason_id`, `departure_description` on `hr.version`) + an offboarding activity plan as the clearance checklist | `addons/hr/wizard/hr_departure_wizard.py`, `addons/hr/models/hr_version.py:145-148` |
| 5 | Employee assets / custody | stock `hr_maintenance` (`maintenance.equipment.employee_id`, `equipment_assign_to`, `assign_date`) on stock `maintenance` | `addons/hr_maintenance/models/equipment.py` |

Owner decisions applied: ready-made modules only; OCA AGPL-3 modules accepted as internal engines;
everything lives in the single addon `webvue_hr`; no timesheets; no payroll in this work; no `sudo()` in
`webvue_hr`; the customer never opens Odoo (the `ir.http` guard stays as is).

What is *not* the engine: OCA `hr_attendance_employee_calendar_planning` (attendance is out of scope).

## 2. Out of scope (deferred, not rejected)

- **Attendance** (check-in/out, `hr_attendance`, the attendance planning bridge).
- **Timesheets**: AGENTS.md: "do not add `hr_timesheet` or timesheet fields/endpoints to the customer UI".
- **Payroll**: AGENTS.md (owner decision 2026-10-19): payroll is a section of `webvue_hr` behind dedicated
  `hr.payroll.*` capabilities "that no other HR capability implies, and behind the `hr.payroll` sub-feature;
  they never appear in general employee, directory or people views or serializers." This work adds no payroll
  module, group, field or route. Applicant salary fields (`salary_proposed*`, `salary_expected*`) and equipment
  `cost` are compensation/finance data and are excluded from every serializer and payload here.
- **Warnings / disciplinary actions, loans, medical insurance, appraisal**.
- Recruitment extras: CV/attachment upload, interview scheduling (`calendar.event`), job publishing/website,
  refusal e-mails (`send_mail` is always `False`), talent pools, recruitment sources/UTM, applicant properties.
- Assets extras: maintenance requests, asset depreciation (finance `account_asset_management`), vendor/cost data,
  custody history route (tracking stays in Odoo chatter, unread by the UI in this phase).
- Self-service resignation *request* by the employee: a departure is registered by HR with reason
  "Resigned" (`hr.departure_resigned`). A request workflow would be a new engine.
- Vendor-admin labels for the new feature keys (`apps/vendor-admin/app/utils/vendorPackages.ts`) — separate owner;
  the integrator reports it as a follow-up.

## 3. Common rules for every route

- Path prefix `/api/v1/hr/<area>/…` with `<area>` ∈ `recruitment`, `shifts`, `onboarding`, `offboarding`, `assets`.
- Decorators, in this order: `@http.route(path, type='json2', auth='user', methods=[<one>], readonly=<GET>)`,
  `@api_handler`, `@hr_rule_handler` (when the handler raises `WebVueHrRule`),
  `@requires_feature('hr.enabled', 'hr.<area>', operation='read'|'write')` (default `match='all'`: **both** keys),
  then `@requires_capability(...)` (or a top-level `_require(...)` call that `tools/route_gate_policy.py` credits).
- Lists return exactly `{items, total}`; `limit/offset` through `parse_page`; ids through `parse_positive_int`.
- Errors: 403 `forbidden` (capability, self-decision), 403 `feature_not_included` (feature gate), 404 `not_found`
  (unknown id, or a record of another company — never 403 for another company's record), 422 `invalid` with
  `field` (unknown/unwritable payload key, bad value, engine `UserError`/`ValidationError`).
- Unknown payload keys → 422 naming the first key (sorted). Payload whitelists below are exhaustive.
- Every search adds `('company_id', '=', request.env.company.id)` (or `in [company, False]` where stated);
  every id lookup is a company-scoped `search([...], limit=1)`, not `browse`.
- Serializers are explicit dict builders in `serializers/<area>/…`; the key sets below are exact and are
  matched by `.strict()` zod schemas.
- Refs are `{id, name}` (`HrRefSchema`); user refs are `{id, name}` of `res.users`; employee refs are
  `hr.employee` ids. `/api/v1/people` is untouched.
- Dates `YYYY-MM-DD`, datetimes ISO 8601 UTC. Html engine fields are not exposed except where stated as plain text.
- **No `sudo()`**, no new SQL on Odoo tables, no override of a private access method, no copied Odoo method (R7, R9).

## 4. Capabilities, groups and roles (catalog additions)

Ten new capabilities, owner `webvue_hr`, appended to `HR_PERMISSIONS` (10 → 20). `EMPLOYEE_HR_PERMISSIONS` is
**unchanged**: the employee role gets no new capability; self-service reads use the existing `hr.employees.read`
plus an own-record filter (§6.2, §6.5).

| Key | Depends on | Group xmlid (`webvue_hr.`) | Stock group implied | Sensitive | Roles |
|---|---|---|---|---|---|
| `hr.recruitment.read` | — | `group_cap_hr_recruitment_read` | none (own read ACLs) | no | hr_manager, vendor_support |
| `hr.recruitment.manage` | `hr.recruitment.read` | `group_cap_hr_recruitment_manage` | `hr_recruitment.group_hr_recruitment_user` | yes | hr_manager, vendor_support |
| `hr.shifts.read` | `hr.employees.read` | `group_cap_hr_shifts_read` | none | no | hr_manager, vendor_support |
| `hr.shifts.manage` | `hr.shifts.read`, `hr.employees.manage` | `group_cap_hr_shifts_manage` | none | yes | hr_manager, vendor_support |
| `hr.onboarding.read` | `hr.employees.read` | `group_cap_hr_onboarding_read` | none (own read ACL on the run model) | no | hr_manager, vendor_support |
| `hr.onboarding.manage` | `hr.onboarding.read` | `group_cap_hr_onboarding_manage` | none (own plan ACLs + rules) | yes | hr_manager, vendor_support |
| `hr.offboarding.read` | `hr.employees.read` | `group_cap_hr_offboarding_read` | none (own ACLs + departure field groups) | yes | hr_manager, vendor_support |
| `hr.offboarding.manage` | `hr.offboarding.read`, `hr.employees.manage` | `group_cap_hr_offboarding_manage` | none | yes | hr_manager, vendor_support |
| `hr.assets.read` | `hr.employees.read` | `group_cap_hr_assets_read` | none (own read rule) | no | hr_manager, vendor_support |
| `hr.assets.manage` | `hr.assets.read` | `group_cap_hr_assets_manage` | `maintenance.group_equipment_manager` | yes | hr_manager, vendor_support |

Extra route-level requirements: hiring (`POST …/applicants/<id>/hire`) needs `hr.recruitment.manage` **and**
`hr.employees.manage` (it creates an `hr.employee` through the WebVue-guarded model).

Permission records (`data/hr_access_permissions.xml`, `domain=hr`, `custom_role_allowed=True`,
`project_contextual=False`, `sensitive` as above). `resource`/`action`/names:

| Key | resource | action | name_ar | name_en |
|---|---|---|---|---|
| hr.recruitment.read | recruitment | read | قراءة التوظيف | Read recruitment |
| hr.recruitment.manage | recruitment | manage | إدارة التوظيف | Manage recruitment |
| hr.shifts.read | shifts | read | قراءة الورديات | Read shifts |
| hr.shifts.manage | shifts | manage | إدارة الورديات | Manage shifts |
| hr.onboarding.read | onboarding | read | قراءة خطط التهيئة | Read onboarding |
| hr.onboarding.manage | onboarding | manage | إدارة خطط التهيئة | Manage onboarding |
| hr.offboarding.read | offboarding | read | قراءة إنهاء الخدمة | Read offboarding |
| hr.offboarding.manage | offboarding | manage | إدارة إنهاء الخدمة والإخلاء | Manage offboarding and clearance |
| hr.assets.read | assets | read | قراءة العهد | Read assets |
| hr.assets.manage | assets | manage | إدارة العهد | Manage assets |

`description_ar/en` equal the names. `role_hr_manager.permission_ids` (`Command.set`) lists all 20;
`group_hr_manager.implied_ids` (`Command.set`) adds the ten new groups. The existing
`_webvue_repair_builtin_role_grants` hook relinks grants on upgrade (role is `noupdate`).

### 4.1 Group implication proof (no `hr.group_hr_user`, no payroll leak)

Verified in stock source:

- `hr_recruitment.group_hr_recruitment_user` → `group_hr_recruitment_interviewer` → `base.group_user`
  (`hr_recruitment/security/hr_recruitment_security.xml:17-30`). It does **not** imply `hr.group_hr_user`.
  It grants: CRUD `hr.applicant`, `hr.job`, `hr.talent.pool`, `hr.recruitment.degree`, refuse reasons, sources,
  `res.partner`, `calendar.event`; `mail_message_user_rule` (a `(1,=,1)` rule — it never widens beyond
  mail.message's document-based check). Salary fields are gated to this group in Odoo and excluded by WebVue.
- `maintenance.group_equipment_manager` → `base.group_user` only (`maintenance/security/maintenance.xml:9-16`).
  It grants CRUD on equipment, categories, teams, stages, requests and `mail.activity.type`.
  (`hr_maintenance` makes `hr.group_hr_user` imply it — the opposite direction, no leak.)
- No new WebVue group implies `hr.group_hr_user`, `hr.group_hr_manager`, `hr_holidays.group_hr_holidays_user`
  or any payroll group, and no payroll module is installed by this work.
- `hr.shifts.manage` and `hr.offboarding.manage` **depend on** `hr.employees.manage`, whose group already implies
  `hr.group_hr_user` (existing, accepted in `hr_capability_groups.xml`). Their own groups imply nothing. Reason:
  the engines write `hr.version` (`resource_calendar_id` in OCA `_regenerate_calendar`; departure fields and
  `contract_date_end` in the departure wizard), and `hr.departure.wizard` ACL is `hr.group_hr_user` only. These
  writes are employee-record mutations and stay behind the employee-management capability instead of a new
  privileged path. No stock group needs narrowing (unlike `hr_leave_officer_group.xml`); if a later engine group
  is found to imply `hr.group_hr_user`, it is narrowed with the same noupdate rewrite + migration pattern.
- Tests (§10) assert `hr.group_hr_user ∉ group.all_implied_ids` for the eight groups whose capability does not
  depend on `hr.employees.manage`, and `implied_ids` empty for `group_cap_hr_shifts_manage` /
  `group_cap_hr_offboarding_manage`.

### 4.2 ACLs and record rules (foundation, `security/ir.model.access.csv` + `security/hr_engine_rules.xml`)

| ACL id | model | group | r w c u |
|---|---|---|---|
| access_webvue_hr_applicant_reader | hr_recruitment.model_hr_applicant | group_cap_hr_recruitment_read | 1 0 0 0 |
| access_webvue_hr_recruitment_stage_reader | hr_recruitment.model_hr_recruitment_stage | group_cap_hr_recruitment_read | 1 0 0 0 |
| access_webvue_hr_refuse_reason_reader | hr_recruitment.model_hr_applicant_refuse_reason | group_cap_hr_recruitment_read | 1 0 0 0 |
| access_webvue_hr_plan_run_onboarding_reader | model_webvue_hr_plan_run | group_cap_hr_onboarding_read | 1 0 0 0 |
| access_webvue_hr_plan_run_onboarding_manager | model_webvue_hr_plan_run | group_cap_hr_onboarding_manage | 1 1 1 0 |
| access_webvue_hr_plan_onboarding_manager | mail.model_mail_activity_plan | group_cap_hr_onboarding_manage | 1 1 1 1 |
| access_webvue_hr_plan_template_onboarding_manager | mail.model_mail_activity_plan_template | group_cap_hr_onboarding_manage | 1 1 1 1 |
| access_webvue_hr_plan_run_offboarding_reader | model_webvue_hr_plan_run | group_cap_hr_offboarding_read | 1 0 0 0 |
| access_webvue_hr_plan_run_offboarding_manager | model_webvue_hr_plan_run | group_cap_hr_offboarding_manage | 1 1 1 0 |
| access_webvue_hr_plan_offboarding_manager | mail.model_mail_activity_plan | group_cap_hr_offboarding_manage | 1 1 1 1 |
| access_webvue_hr_plan_template_offboarding_manager | mail.model_mail_activity_plan_template | group_cap_hr_offboarding_manage | 1 1 1 1 |
| access_webvue_hr_departure_reason_reader | hr.model_hr_departure_reason | group_cap_hr_offboarding_read | 1 0 0 0 |

`hr.job`, `resource.calendar(.attendance)`, `hr.employee.calendar`, `maintenance.equipment(.category)` and
`mail.activity.plan(.template)` are already readable by `base.group_user`.

Record rules (new file `security/hr_engine_rules.xml`):

- `rule_hr_plan_onboarding_manage` / `rule_hr_plan_offboarding_manage` on `mail.activity.plan`, groups the
  matching manage group, `perm_read=False`, domain `[('res_model','=','hr.employee'),('hr_purpose','=','onboarding'|'offboarding')]`;
  same pair on `mail.activity.plan.template` with `plan_id.` prefixes (mirrors stock `mail_plan_rule_group_hr_manager`).
- `rule_hr_plan_run_company` (global): `[('company_id','in',company_ids)]` on `webvue.hr.plan.run`.
- `rule_hr_plan_run_onboarding` / `rule_hr_plan_run_offboarding` (group rules, all perms):
  `[('plan_id.hr_purpose','=','onboarding'|'offboarding')]` for the read groups (managers inherit through
  dependency, so their users are in the read group too).
- `rule_hr_equipment_assets_read` on `maintenance.equipment`, group `group_cap_hr_assets_read`, read only,
  `[(1,'=',1)]` (stock base rule only shows followed equipment; rules of a user's groups are OR-ed; the global
  multi-company rule still applies).

## 5. Sub-features (R10)

`models/feature_registry.py` appends five boolean definitions, each
`{'key': 'hr.<area>', 'type': 'boolean', 'owner': 'webvue_hr', 'module': 'webvue_hr'}` for
`hr.recruitment`, `hr.shifts`, `hr.onboarding`, `hr.offboarding`, `hr.assets`.

- Every new route is gated by `requires_feature('hr.enabled', 'hr.<area>', …)` (both must hold).
- Fresh install: `_webvue_legacy_features_for` grants every `webvue_hr` key when HR is selected.
- Upgrade: `_webvue_register_missing_features` closes new keys (`False`). Pre-release only (no tenants),
  `migrations/19.0.1.6.0/post-hr_complete.py` sets each of the five keys to the stored value of `hr.enabled`
  for every profile (dev data carried forward; documented in the README).
- Catalog: `tools/catalog_check.py` requires every feature of a release module in exactly one tier of each
  schema-3 solution, so the five `boolean:hr.<area>` entries are added to the `people` tier of
  `deploy/catalog/solutions/platform_v3.json` and `platform_v4.json`.
- Web: `apps/web/app/modules/registry.ts` maps a capability to `<prefix>.enabled` only. Foundation adds an
  optional `subFeatures?: Record<string, string>` to `AppManifest` (`types.ts`) — capability prefix → feature
  key, e.g. `{'hr.recruitment.': 'hr.recruitment'}` — and `canUse` requires **both** the application feature and
  the matched sub-feature with the same read/write semantics (`capabilityAliases` is unsuitable: it forces
  read semantics). Tests in `app/modules/__tests__/registry.test.ts`. The HR manifest entry is integrator-owned (§9).

## 6. Per-capability contracts

### 6.1 Recruitment — `hr.recruitment`

Engine: `hr_recruitment` (+ its auto-installed bridges, recorded by the foundation lane from the scratch DB:
`hr_calendar`, and `calendar_sms`/`hr_recruitment_sms` when `sms` is installed).

| Method | Path | Capability | Payload / query | Response |
|---|---|---|---|---|
| GET | `/api/v1/hr/recruitment/jobs` | read | `q, department_id, active(true/false/all, default true), limit, offset` | `{items: RecruitmentJob[], total}` |
| POST | `/api/v1/hr/recruitment/jobs` | manage | `{name, department_id?, no_of_recruitment?, description?}` | `RecruitmentJob` 201-style json |
| GET | `/api/v1/hr/recruitment/jobs/<id>` | read | — | `RecruitmentJob` |
| PATCH | `/api/v1/hr/recruitment/jobs/<id>` | manage | `{name?, department_id?, no_of_recruitment?, description?, active?}` (≥1 key) | `RecruitmentJob` |
| GET | `/api/v1/hr/recruitment/stages` | read | `job_id?` | `{items: RecruitmentStage[], total}` |
| GET | `/api/v1/hr/recruitment/refuse-reasons` | read | — | `{items: HrRef[], total}` |
| GET | `/api/v1/hr/recruitment/applicants` | read | `q, job_id, stage_id, status(ongoing/hired/refused/archived), limit, offset` | `{items: Applicant[], total}` |
| POST | `/api/v1/hr/recruitment/applicants` | manage | `{partner_name, job_id, email_from?, partner_phone?, availability?}` | `Applicant` |
| GET | `/api/v1/hr/recruitment/applicants/<id>` | read | — | `Applicant` |
| PATCH | `/api/v1/hr/recruitment/applicants/<id>` | manage | `{partner_name?, email_from?, partner_phone?, availability?, stage_id?, priority?}` | `Applicant` |
| POST | `/api/v1/hr/recruitment/applicants/<id>/refuse` | manage | `{refuse_reason_id}` → stock `applicant.get.refuse.reason` wizard, `send_mail=False` | `Applicant` |
| POST | `/api/v1/hr/recruitment/applicants/<id>/reset` | manage | `{}` → stock `reset_applicant()` | `Applicant` |
| POST | `/api/v1/hr/recruitment/applicants/<id>/hire` | manage + `hr.employees.manage` | `{}` → stock `create_employee_from_applicant()`; 422 if `employee_id` already set or applicant refused | `{applicant: Applicant, employee: HrRef}` |

Serializers:
- `RecruitmentJob`: `id, name, department: HrRef|null, no_of_recruitment:int≥0, application_count:int≥0`
  (WebVue `search_count` of ongoing applicants in the company, not the stock group-gated field),
  `description: string` (plain text of the Html, '' when empty), `active`.
- `RecruitmentStage`: `id, name, sequence, hired_stage, fold`.
- `Applicant`: `id, partner_name, email_from, partner_phone, job: HrRef|null, department: HrRef|null,
  stage: HrRef|null, status: 'ongoing'|'hired'|'refused'|'archived'` (stock `application_status`),
  `priority: '0'|'1'|'2'|'3', availability: date|null, refuse_reason: HrRef|null, employee: HrRef|null,
  applied_on: datetime` (`create_date`), `active`.
- Never: salary fields, `linkedin_profile`, properties, attachments, notes, interviewers, UTM fields.

Rules: `job_id`, `department_id`, `stage_id` must be in the current company (stage: global or linked to the job)
→ else 422 with field. Company scoping: `hr.job.company_id = current`, `hr.applicant.company_id = current`.

Zod: `packages/contracts/src/hr/recruitment.ts` — `HrRecruitmentJobSchema`, `HrRecruitmentJobListSchema`,
`HrRecruitmentJobCreateSchema`, `HrRecruitmentJobPatchSchema`, `HrRecruitmentStageSchema`(+List),
`HrRecruitmentRefuseReasonListSchema`, `HrApplicantSchema`(+List), `HrApplicantCreateSchema`,
`HrApplicantPatchSchema`, `HrApplicantRefuseSchema`, `HrApplicantHireResultSchema`, `HrApplicantStatusSchema`.

Web: `/hr/recruitment` (applicants list, filters job/stage/status in the URL), `/hr/recruitment/new`
(SharedCreatePanel, applicant), `/hr/recruitment/<applicantId>` (record page: stage, refuse, reset, hire
with inline confirmation), `/hr/recruitment/jobs`, `/hr/recruitment/jobs/new` (SharedCreatePanel),
`/hr/recruitment/jobs/<jobId>`. Locale `apps/web/i18n/locales/{ar,en}/hr-recruitment.json`, top key `hrRecruitment`.

### 6.2 Shifts — `hr.shifts`

Engine: OCA `hr_employee_calendar_planning` (its `post_init_hook` creates one planning row per existing
employee from the current calendar). A "schedule" is a non-auto-generated `resource.calendar`; an "assignment" is an
`hr.employee.calendar` row; OCA regenerates the employee's auto calendar.

| Method | Path | Capability | Payload / query | Response |
|---|---|---|---|---|
| GET | `/api/v1/hr/shifts/schedules` | read | `active(default true), limit, offset` | `{items: ShiftSchedule[], total}` |
| POST | `/api/v1/hr/shifts/schedules` | manage | `{name, tz, two_weeks:false, attendances: Attendance[]≥1}` | `ShiftSchedule` |
| GET | `/api/v1/hr/shifts/schedules/<id>` | read | — | `ShiftSchedule` |
| PATCH | `/api/v1/hr/shifts/schedules/<id>` | manage | `{name?, tz?, attendances?}` (attendances replace the set) | `ShiftSchedule` |
| POST | `/api/v1/hr/shifts/schedules/<id>/archive` | manage | `{}` (OCA `_check_active` → 422 when in use) | `ShiftSchedule` |
| GET | `/api/v1/hr/shifts/assignments` | read | `employee_id, schedule_id, on_date, limit, offset` | `{items: ShiftAssignment[], total}` |
| POST | `/api/v1/hr/shifts/assignments` | manage | `{employee_id, schedule_id, date_start?, date_end?}` (OCA overlap → 422) | `ShiftAssignment` |
| PATCH | `/api/v1/hr/shifts/assignments/<id>` | manage | `{schedule_id?, date_start?, date_end?}` | `ShiftAssignment` |
| DELETE | `/api/v1/hr/shifts/assignments/<id>` | manage | — | `{id}` |
| GET | `/api/v1/hr/shifts/me` | `hr.employees.read` (own record only) | — | `{items: ShiftAssignment[], total}` of the caller's employee in this company; 422 when none |

Serializers:
- `ShiftSchedule`: `id, name, tz, two_weeks: bool, hours_per_week: number, active,
  attendances: [{dayofweek:'0'..'6', day_period:'morning'|'lunch'|'afternoon'|'full_day', hour_from, hour_to, week_type:'0'|'1'|null}]`
  (section lines excluded). Only `company_id = current` and `auto_generate = False`.
- `ShiftAssignment`: `id, employee: HrRef, schedule: HrRef, date_start: date|null, date_end: date|null`.
- Never: auto-generated calendars, leaves/global leaves, work-time rate, payroll fields.

Rules: `schedule_id` must be a current-company non-auto calendar; `employee_id` a current-company active employee;
`date_start ≤ date_end` (422). **Self-decision:** a caller cannot create/patch/delete an assignment of their own
employee (403). Writes run as the caller (the dependency `hr.employees.manage` supplies the engine ACLs).

Zod: `packages/contracts/src/hr/shifts.ts` — `HrShiftAttendanceSchema`, `HrShiftScheduleSchema`(+List,
Create, Patch), `HrShiftAssignmentSchema`(+List, Create, Patch).

Web: `/hr/shifts` (assignments list), `/hr/shifts/new` (SharedCreatePanel, assignment), `/hr/shifts/schedules`,
`/hr/shifts/schedules/new` (SharedCreatePanel), `/hr/shifts/schedules/<scheduleId>`. The caller's own schedule
appears on `/hr/shifts` when they lack `hr.shifts.read` (from `/me`). Locale `hr-shifts.json`, top key `hrShifts`.

### 6.3 Onboarding — `hr.onboarding`

Engine: stock employee activity plans. Schema (foundation): `mail.activity.plan.hr_purpose` Selection
`[('onboarding','Onboarding'),('offboarding','Offboarding')]`, allowed only when `res_model == 'hr.employee'`
(`@api.constrains`); stock `hr.onboarding_plan` → onboarding, `hr.offboarding_plan` → offboarding (data XML on
install, migration on upgrade). New model `webvue.hr.plan.run` (one launch of a plan on one employee):
`employee_id` (m2o `hr.employee`, required, `ondelete='cascade'`, index), `plan_id` (m2o `mail.activity.plan`,
required, `ondelete='restrict'`), `company_id` (related `employee_id.company_id`, stored, index), `plan_date`
(Date, required), `launched_by_id` (m2o `res.users`, required, default current user), `activity_ids` (m2m
`mail.activity`, relation `webvue_hr_plan_run_activity_rel`). Purpose and progress are derived, never stored.

Plan routes (identical shape under `/api/v1/hr/offboarding/…`, purpose fixed by the area):

| Method | Path | Capability | Payload / query | Response |
|---|---|---|---|---|
| GET | `/api/v1/hr/onboarding/plans` | read | `active(default true)` | `{items: ActivityPlan[], total}` |
| POST | `/api/v1/hr/onboarding/plans` | manage | `{name, department_id?, steps: PlanStepInput[]≥1}` | `ActivityPlan` |
| GET | `/api/v1/hr/onboarding/plans/<id>` | read | — | `ActivityPlan` |
| PATCH | `/api/v1/hr/onboarding/plans/<id>` | manage | `{name?, department_id?, active?, steps?}` (steps replace templates) | `ActivityPlan` |
| GET | `/api/v1/hr/onboarding/runs` | read | `employee_id, state(open/done), limit, offset` | `{items: PlanRun[], total}` |
| POST | `/api/v1/hr/onboarding/runs` | manage | `{employee_id, plan_id, plan_date?}` | `PlanRunDetail` |
| GET | `/api/v1/hr/onboarding/runs/<id>` | read | — | `PlanRunDetail` |
| POST | `/api/v1/hr/onboarding/runs/<id>/steps/<activity_id>/done` | manage, or the step's assignee | `{feedback?}` → stock `action_feedback` | `PlanRunDetail` |

Launch: `mail.activity.schedule` created as the caller with `res_model='hr.employee'`, `res_ids=[employee]`,
`plan_id`, `plan_date` (default: stock compute), then `action_schedule_plan()`; the run stores the activities
that appeared on the employee during the call (`active_test=False` set difference). Plans are those with
`company_id in [current, False]`, `res_model='hr.employee'`, matching `hr_purpose`.

Serializers:
- `ActivityPlan`: `id, name, department: HrRef|null, active, steps: PlanStep[]`.
- `PlanStep`: `id, summary, responsible_type: 'manager'|'coach'|'employee'|'other', responsible: {id,name}|null`
  (user, only for `other`), `delay_count:int≥0, delay_unit:'days'|'weeks'|'months', delay_from:'before_plan_date'|'after_plan_date'`.
  `PlanStepInput` = the same without `id`, `responsible_user_id` instead of `responsible` (required iff `other`).
  Activity type is always stock `mail.mail_activity_data_todo`.
- `PlanRun`: `id, employee: HrRef, plan: HrRef, plan_date, launched_by: {id,name}, done:int, total:int, state:'open'|'done'`.
- `PlanRunDetail`: `PlanRun` + `steps: [{id (activity id), summary, assignee: {id,name}|null, date_deadline,
  state:'planned'|'today'|'overdue'|'done', date_done: date|null, can_complete: bool}]`.

Rules: the assignee (`activity.user_id == caller`) may complete their own step without manage; others need manage;
a done step → 422.

Zod: `packages/contracts/src/hr/onboarding.ts` — `HrActivityPlanSchema`(+List, Create, Patch),
`HrPlanStepSchema`, `HrPlanStepInputSchema`, `HrPlanRunSchema`(+List), `HrPlanRunDetailSchema`,
`HrPlanRunCreateSchema`, `HrPlanStepDoneSchema`. Offboarding imports these shared plan/run schemas from
`./onboarding` (one source of truth).

Web: `/hr/onboarding` (runs), `/hr/onboarding/new` (SharedCreatePanel, launch), `/hr/onboarding/<runId>`,
`/hr/onboarding/plans`, `/hr/onboarding/plans/new` (SharedCreatePanel), `/hr/onboarding/plans/<planId>`.
Locale `hr-onboarding.json`, top key `hrOnboarding`.

### 6.4 Offboarding (resignation / departure clearance) — `hr.offboarding`

Engine: stock `hr.departure.wizard.action_register_departure` + `hr.departure.reason` + an offboarding plan run as
the clearance checklist. Schema (foundation): `departure_reason_id`, `departure_description`, `departure_date`
redeclared on `hr.version` (and on `hr.employee` with `inherited=True` if the `_inherits` copy needs it, proven by
test) with `groups='hr.group_hr_user,webvue_hr.group_cap_hr_offboarding_read'` (same pattern as `CONTRACT_GROUPS`).
Archiving stays the existing `POST /api/v1/hr/employees/<id>/archive` (`hr.employees.archive`); this area never
archives employees or users (`employee_termination` context is never set, `remove_related_user=False`).

| Method | Path | Capability | Payload / query | Response |
|---|---|---|---|---|
| GET | `/api/v1/hr/offboarding/reasons` | read | — | `{items: HrRef[], total}` (`country_id in [company country, False]`) |
| GET | `/api/v1/hr/offboarding/departures` | read | `q, cleared(true/false), limit, offset` | `{items: Departure[], total}` |
| POST | `/api/v1/hr/offboarding/departures` | manage | `{employee_id, departure_date, departure_reason_id, description?, set_contract_end?=true, plan_id?}` | `Departure` |
| GET | `/api/v1/hr/offboarding/departures/<employee_id>` | read | — | `Departure` |
| PATCH | `/api/v1/hr/offboarding/departures/<employee_id>` | manage | `{departure_date?, departure_reason_id?, description?}` | `Departure` |
| plans/runs | `/api/v1/hr/offboarding/plans…`, `/runs…` | read / manage | as §6.3, purpose `offboarding` | as §6.3 |

POST creates `hr.departure.wizard` (as the caller, `allowed_company_ids=[current]`) with `employee_ids=[employee]`,
reason, description (stored as escaped plain text in the Html field), date, `set_date_end`, then
`action_register_departure()`; when `plan_id` is given (offboarding purpose) it launches a clearance run in the
same request (§6.3 launch). Already has a `departure_date` → 422; contract start after date → 422 (stock UserError).

`Departure`: `employee: HrRef, active: bool (employee), departure_date, reason: HrRef|null, description: string,
clearance: {run_id: int|null, done:int, total:int}` (latest offboarding run of the employee).
Departures list searches `hr.employee` with `active_test=False`, `departure_date != False`, current company.

**Self-decision:** a caller cannot register/patch their own departure, launch an offboarding run on themselves,
or complete any step of their own clearance run — even as the assignee (403).

Zod: `packages/contracts/src/hr/offboarding.ts` — `HrDepartureSchema`(+List), `HrDepartureCreateSchema`,
`HrDeparturePatchSchema`, `HrDepartureReasonListSchema`, re-exporting plan/run schemas from `./onboarding`.

Web: `/hr/offboarding` (departures), `/hr/offboarding/new` (SharedCreatePanel, register departure with optional
clearance plan), `/hr/offboarding/<employeeId>` (departure record + clearance steps; link to
`/hr/assets?employee_id=<id>` for outstanding custody), `/hr/offboarding/plans`, `/hr/offboarding/plans/new`,
`/hr/offboarding/plans/<planId>`. Locale `hr-offboarding.json`, top key `hrOffboarding`.

### 6.5 Assets / custody — `hr.assets`

Engine: stock `maintenance` + `hr_maintenance` (`auto_install` with `hr` + `maintenance`; `stock_maintenance`
only if `stock` is installed). Equipment is scoped to `company_id = current`; categories to `[current, False]`.

| Method | Path | Capability | Payload / query | Response |
|---|---|---|---|---|
| GET | `/api/v1/hr/assets/categories` | read | — | `{items: HrRef[], total}` |
| POST | `/api/v1/hr/assets/categories` | manage | `{name}` | `HrRef` |
| GET | `/api/v1/hr/assets/equipment` | read | `q, category_id, employee_id, assigned(true/false), active(default true), limit, offset` | `{items: Equipment[], total}` |
| POST | `/api/v1/hr/assets/equipment` | manage | `{name, category_id?, serial_no?, model?, warranty_date?}` | `Equipment` |
| GET | `/api/v1/hr/assets/equipment/<id>` | read | — | `Equipment` |
| PATCH | `/api/v1/hr/assets/equipment/<id>` | manage | `{name?, category_id?, serial_no?, model?, warranty_date?}` | `Equipment` |
| POST | `/api/v1/hr/assets/equipment/<id>/assign` | manage | `{employee_id, assign_date?}` → `equipment_assign_to='employee'` | `Equipment` |
| POST | `/api/v1/hr/assets/equipment/<id>/return` | manage | `{}` → `employee_id=False` (chatter tracking keeps history) | `Equipment` |
| POST | `/api/v1/hr/assets/equipment/<id>/archive` | manage | `{scrap_date?}` → `active=False` | `Equipment` |
| GET | `/api/v1/hr/assets/me` | `hr.employees.read` (own record only) | — | `{items: Equipment[], total}` of the caller's employee |

`Equipment`: `id, name, category: HrRef|null, serial_no, model, employee: HrRef|null, assign_date: date|null,
warranty_date: date|null, scrap_date: date|null, active`. Never: `cost`, vendor (`partner_id`, `partner_ref`),
technician, maintenance team/requests, properties, note.

Rules: assigning already-assigned equipment → 422 (return first); `employee_id` must be an active current-company
employee. **Self-decision:** a caller cannot assign equipment to, or return it from, their own employee (403).
`/me` reads as the caller through the stock follower rule (`hr_maintenance` subscribes the assignee) plus the
company filter — no elevated read.

Zod: `packages/contracts/src/hr/assets.ts` — `HrAssetCategoryListSchema`, `HrAssetCategoryCreateSchema`,
`HrEquipmentSchema`(+List, Create, Patch), `HrEquipmentAssignSchema`, `HrEquipmentArchiveSchema`.

Web: `/hr/assets` (equipment list, `?employee_id=` filter), `/hr/assets/new` (SharedCreatePanel),
`/hr/assets/<equipmentId>` (record: assign/return/archive with inline confirmation), `/hr/assets/categories`,
`/hr/assets/categories/new` (SharedCreatePanel). Locale `hr-assets.json`, top key `hrAssets`.

### 6.6 Web rules common to all five

Pages are pages; `/new` routes open `SharedCreatePanel`; records/edits are pages; destructive actions confirm
inline; filters live in the URL and survive back/refresh; Arabic default, RTL. Pages compose only shared components
that have stories under `apps/web/stories/**` (`SharedListPage`, `SharedDataTable`, `SharedRecordPage`,
`SharedFilterBar`, `SharedStatusBadge`, `SharedInlineConfirm`, `SharedFormSection`, `SharedFormActions`,
`SharedPageState`, `SharedForbiddenState`, `SharedEmptyState`, `SharedDateField`, `SharedPersonPicker`, …).
Area components live in `apps/web/app/components/hr/<area>/` and build only on those; a 403 `feature_not_included`
or `forbidden` renders `SharedPageState`/`SharedForbiddenState`. Data access goes through
`apps/web/app/composables/useHr<Area>.ts` with the zod schemas (`useApi().$api(url, {schema})`).
User strings use `t('hr<Area>.…')` only from the area's own namespace (nav labels come from `common.json`, §9).

## 7. Manifest, version, migration, OCA pin (foundation)

`odoo-addons/webvue_hr/__manifest__.py`:
- `version`: `19.0.1.5.0` → `19.0.1.6.0` (one bump for the whole work).
- `summary`: `'webvue platform: the HR pillar — /api/v1/hr departments, employees, leave, recruitment, shifts, onboarding, offboarding, assets'`.
- `depends`: `['webvue_api', 'hr', 'mail', 'hr_holidays', 'hr_work_entry_holidays', 'hr_recruitment',
  'hr_employee_calendar_planning', 'maintenance', 'hr_maintenance']` (comment updated: engines are internal).
- `data` (order): `security/hr_leave_officer_group.xml`, `security/hr_capability_groups.xml`,
  `security/ir.model.access.csv`, `security/hr_engine_rules.xml`, `data/hr_access_permissions.xml`,
  `data/hr_leave_type_data.xml`, `data/hr_plan_purpose_data.xml`.

`migrations/19.0.1.6.0/`: `README.md` (what and why) and `post-hr_complete.py`
(`if not version: return`; sets `hr_purpose` on `hr.onboarding_plan`/`hr.offboarding_plan` — stock noupdate
records — and copies `hr.enabled` to the five sub-feature keys of every tenant profile, §5). Idempotent.

`deploy/oca-addons.json`: add `{"repo": "OCA/hr", "branch": "19.0", "commit": "23e948031779315958c3897652d04da813a058fb"}`
(no `python_requirements`: the module declares no external dependency). `docs/oca-addons.md`: add the module to
"What uses them" (`hr_employee_calendar_planning` — `webvue_hr` shifts; AGPL-3 internal engine, owner-accepted;
only this module of OCA/hr is installed). `python3 -B tools/oca_addons.py check` must pass, then `fetch`.

## 8. Frozen foundation contract (lane `codex/hr-foundation`, merged before feature lanes start)

Delivered and frozen; feature lanes may not edit these files. A change needs a captain contract amendment.

1. Manifest version/summary/depends/data (§7); `migrations/19.0.1.6.0/{README.md,post-hr_complete.py}`.
2. `models/access_service.py`: `HR_PERMISSIONS` 20 keys; `HR_PERMISSION_DEPENDENCIES` adds the ten entries of §4;
   `EMPLOYEE_HR_PERMISSIONS` unchanged; role grants unchanged in code (constant-driven).
3. `models/feature_registry.py`: five sub-features (§5).
4. `models/mail_activity_plan.py` (new, `hr_purpose` + constraint), `models/hr_plan_run.py` (new
   `webvue.hr.plan.run`), `models/hr_version.py` (+ `hr_employee.py` if needed) departure field groups,
   `models/__init__.py`.
5. `security/hr_capability_groups.xml` (ten groups + `group_hr_manager` implications),
   `security/ir.model.access.csv` (§4.2 rows), `security/hr_engine_rules.xml` (new, §4.2).
6. `data/hr_access_permissions.xml` (ten permissions + `role_hr_manager` set of 20),
   `data/hr_plan_purpose_data.xml` (new).
7. Package skeletons so lanes never touch shared `__init__` files: `controllers/__init__.py` imports
   `recruitment, shifts, lifecycle, assets`; `serializers/__init__.py` likewise; empty-bodied
   `controllers/{recruitment,shifts,lifecycle,assets}/__init__.py` and `serializers/{…}/__init__.py`
   (header comment only; ownership passes to the lane, which fills them).
8. Tests: `tests/common.py` gains `set_hr_feature(case, key, enabled)` (tenant-profile write under the operator
   context, like `webvue_api.tests.common.set_probe_feature`); `tests/test_hr_access_composition.py` counts 20,
   renames `…ten…` → `…twenty…`, asserts role/vendor grants and that `EMPLOYEE_HR_PERMISSIONS` is unchanged;
   new `tests/test_hr_engine_groups.py` (§4.1 implication asserts, `hr_purpose` constraint, run model company
   rule, departure field readable with `hr.offboarding.read` + `hr.employees.read` and not with
   `hr.employees.read` alone, sub-features registered with owner `webvue_hr`).
   `odoo-addons/webvue_api/tests/test_access_composition.py`: `HR` set +10 keys, `DEPENDENCIES` +10 entries,
   `EMPLOYEE` unchanged.
9. Contracts: `packages/contracts/src/hr/{recruitment,shifts,onboarding,offboarding,assets}.ts` with every schema of
   §6 (exact keys, `.strict()`), `hr/index.ts` re-exports the five, tests `hr/__tests__/<area>.test.ts`;
   `packages/contracts/src/access/access.ts` capability enum +10 keys (+ its test).
10. Catalog: `deploy/catalog/solutions/platform_v3.json` and `platform_v4.json` `people` tier +5 features.
11. OCA: `deploy/oca-addons.json`, `docs/oca-addons.md`.
12. Web shared: `apps/web/app/modules/types.ts`, `apps/web/app/modules/registry.ts`,
    `apps/web/app/modules/__tests__/registry.test.ts` (`subFeatures`, §5).

Foundation verify: `python3 -B tools/oca_addons.py check`, `python3 -B tools/catalog_check.py`,
`python3 -B tools/arch_policy.py --base main`, `python3 -B tools/git_policy.py --base main`, `npm test`,
`npm -w apps/web run lint` (from `apps/web`), Odoo `-i webvue_hr --test-tags /webvue_hr,/webvue_api` on a fresh
scratch DB, plus `-u webvue_hr` on a DB installed at `main` (upgrade path), all in `.worktrees/hr-complete`.

## 9. Lane ownership (disjoint)

| Lane (branch) | Owns exactly |
|---|---|
| foundation (`codex/hr-foundation`) | all files of §8 |
| recruitment (`codex/hr-recruitment`) | `odoo-addons/webvue_hr/controllers/recruitment/**`, `serializers/recruitment/**`, `tests/test_hr_recruitment.py`; `apps/web/app/pages/hr/recruitment.vue`, `pages/hr/recruitment/**`, `components/hr/recruitment/**`, `composables/useHrRecruitment.ts`, `i18n/locales/{ar,en}/hr-recruitment.json`, their `__tests__` |
| shifts (`codex/hr-shifts`) | `controllers/shifts/**`, `serializers/shifts/**`, `tests/test_hr_shifts.py`; `pages/hr/shifts.vue`, `pages/hr/shifts/**`, `components/hr/shifts/**`, `composables/useHrShifts.ts`, `hr-shifts.json` (ar, en), their tests |
| lifecycle (`codex/hr-lifecycle`) | `controllers/lifecycle/**`, `serializers/lifecycle/**`, `tests/test_hr_onboarding.py`, `tests/test_hr_offboarding.py`; `pages/hr/onboarding.vue`, `pages/hr/onboarding/**`, `pages/hr/offboarding.vue`, `pages/hr/offboarding/**`, `components/hr/lifecycle/**`, `composables/useHrOnboarding.ts`, `composables/useHrOffboarding.ts`, `hr-onboarding.json`, `hr-offboarding.json` (ar, en), their tests |
| assets (`codex/hr-assets`) | `controllers/assets/**`, `serializers/assets/**`, `tests/test_hr_assets.py`; `pages/hr/assets.vue`, `pages/hr/assets/**`, `components/hr/assets/**`, `composables/useHrAssets.ts`, `hr-assets.json` (ar, en), their tests |
| integrator only (`codex/hr-complete`) | merges; `apps/web/app/modules/hr/manifest.ts` (nav, landing, contextLinks, commands, routeCapabilities, `subFeatures`, `isNavActive` for the five areas); `apps/web/i18n/locales/{ar,en}/common.json` (`nav.recruitment`, `nav.shifts`, `nav.onboarding`, `nav.offboarding`, `nav.assets`); conflict resolution; final checks. Never commits `docs/api/openapi.json` / `route-capabilities.json` (git_policy allows them only on `codex/tools-integrate-*`). |

`odoo-addons/webvue_hr/{controllers,serializers}/` paths above are relative to `odoo-addons/webvue_hr/`; web paths to
`apps/web/app/` except locales (`apps/web/i18n/locales/`). Composable names match `tools/arch_layers.json`
`web_apps.hr` (`composables/useHr*`), so no arch change. No lane edits `tools/arch_layers.json`,
`tools/arch_baseline.json`, `tools/arch_documented_sudo.json` or `tools/route_gate_allowlist.json`.

Integrator manifest entries (all capability-gated, sub-feature through `subFeatures`): nav
`/hr/recruitment` (`hr.recruitment.read`), `/hr/shifts` (`hr.shifts.read`), `/hr/onboarding`
(`hr.onboarding.read`), `/hr/offboarding` (`hr.offboarding.read`), `/hr/assets` (`hr.assets.read`); route
capabilities for every `/new` and record route (manage for `/new`); commands for the five `/new` routes.

## 10. Security

- **No new `sudo()`**: no `webvue_hr` file calls `sudo()`; `tools/arch_documented_sudo.json` unchanged; reviewers
  grep `sudo(` in the diff. Stock/OCA engine code keeps its own internal `sudo()` (e.g. OCA
  `_get_planning_calendars`, stock `_get_employee_create_vals`); WebVue never adds one.
- **No privilege leak**: §4.1; new groups never imply `hr.group_hr_user` or payroll groups; the two dependencies on
  `hr.employees.manage` are explicit and enforced by the catalog dependency check.
- **Company scoping**: every route filters the current company (§3); other-company ids → 404; plan-run global
  company rule; stock multi-company rules on applicants, equipment and categories stay active.
- **Self-decision**: shifts (own assignment), offboarding (own departure, own clearance run and steps), assets (own
  custody assign/return). Recruitment/onboarding have no self-decision case beyond assignee-only completion.
- **Serializer whitelists** exclude compensation (salary, equipment cost), private employee fields and bank data.
- **Feature gating**: `hr.enabled` + `hr.<area>` on every route (route_gate_policy) and in the web through
  `subFeatures`.
- R1–R10 hold: no new addon, no cross-application import, no control-plane reference, works in `saas` and `non_saas`.

## 11. Odoo test plan (each lane, `WebVueHrCase` from `webvue_hr/tests/common.py`, extends `WebVueApiCase`)

Every lane test file covers, per route group:
1. 403 `forbidden` without the capability (user with `webvue_core.group_employee` only), and with read-only on write routes.
2. 403 `feature_not_included` when `hr.<area>` is off while `hr.enabled` is on (`set_hr_feature`).
3. 404 for a record of a second company (create a second `res.company` fixture through Odoo).
4. 422 with `field` for an unknown payload key and for a bad relation id.
5. `{items, total}` envelope and exact serializer key set (`assertEqual(set(item), {...})`).
6. Engine effect through the ORM (e.g. applicant stage/refuse reason, `hr.employee` created by hire;
   `hr.employee.calendar` row and regenerated calendar; activities created by a plan launch and archived when done;
   `departure_*` written and `contract_date_end` set; equipment `employee_id`/`assign_date`).
7. Self-decision 403 cases of §10.
8. Self-service `/me` routes return only the caller's own records (shifts, assets).
Recruitment additionally: hire needs `hr.employees.manage`; salary fields absent. Lifecycle additionally: onboarding
manager cannot read/launch offboarding plans/runs and vice versa (purpose rules). Assets additionally: `cost` absent.

Commands (lane verify, in `.worktrees/hr-complete` worktree layout, scratch DB, unique port):
`odoo-bin … --addons-path=<odoo>/addons,<worktree>/odoo-addons,$(python3 -B <worktree>/tools/oca_addons.py path) -d <scratch> -i webvue_hr --test-tags /webvue_hr --stop-after-init`,
`npm test`, `cd apps/web && npm run lint`, `python3 -B tools/route_gate_policy.py`, `python3 -B tools/arch_policy.py --base main`.

## 12. DAG

requirements (this spec) → foundation → {recruitment, shifts, lifecycle, assets} in parallel → independent
verification → per-lane review → integration on `codex/hr-complete` (manifest + common.json, merges, full checks)
→ independent Jev UI acceptance. No push, no merge into `main`, no deploy.
