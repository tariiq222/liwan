# HR Saudi payroll linked to Finance — design

Date: 2026-10-20. Status: draft for owner approval. This is the payroll phase (phase 4) of
[HR and Finance for the Saudi market](2026-10-18-hr-and-finance-saudi-design.md) and the
"separately scoped request" for payroll that AGENTS.md requires. It does not change any
decision recorded there.

## 1. Intent

The target customer is a Saudi company of 50–100 employees. It buys an HR system first so
that **salaries come out right every month, with GOSI and WPS, and land in the accounts
without re-typing**. Payroll is therefore the core of the HR product, not an add-on, and it is
linked to the Finance application from day one (owner, 2026-10-20).

Success: an HR/payroll officer runs the month in WebVue — inputs, compute, review, approve —
and the accountant posts it, exports the bank salary file, uploads it to the bank portal,
records the payment and exports the WPS file, with no spreadsheet in between.

## 2. Owner decisions (2026-10-20)

1. Payroll is essential and is linked to Finance.
2. Payment method: WebVue **produces a bulk salary transfer file** for the bank's corporate
   portal; the accountant uploads it and then **records the payment** in WebVue. No direct
   bank API, no payment execution by WebVue.
3. First release has **no attendance**: overtime, absence and other monthly variables are
   entered by hand by the payroll officer. Attendance (`hr_attendance`) comes after payroll
   and later feeds the same monthly inputs.
4. Inherited from earlier decisions: payroll is a section of `webvue_hr` (one addon per
   application, 2026-10-19); OCA `payroll` is the internal engine (2026-10-18 fit test); the
   bridge `webvue_hr_finance` posts to accounting; no paid modules or licences.

## 3. Goals

1. **Compensation on the employee** (payroll-only): basic wage, housing, transport and other
   fixed allowances, IBAN (salary bank account), nationality, GOSI number and GOSI first
   registration date.
2. **Monthly payroll run** per company and month: monthly inputs per employee (overtime
   amount, absence days, one-off bonus, one-off deduction, advance recovery as a deduction
   line), unpaid leave pulled automatically from `hr_holidays`, compute, review, approve,
   lock.
3. **GOSI** employee deduction and employer contribution per employee, from a configurable,
   dated rate table (see §6.2).
4. **Outputs**: payslip per employee (visible to the employee in self-service), payroll
   register for the month, **bank salary transfer file**, **WPS file** for Mudad, GOSI
   statement for the month.
5. **Finance link** (bridge): one balanced journal entry per approved run, analytic
   distribution by the employee's department cost center, payment recording that clears
   salaries payable, and a monthly end-of-service provision entry.
6. **End of service**: award per Labor Law Articles 84, 85, 87; final settlement at
   offboarding (last salary days, award, unused annual leave encashment, open deductions).

## 4. Non-goals and anti-goals

- Non-goals (this phase): attendance/time capture; direct bank or Mudad/GOSI API
  integration; loans as a managed product (an advance is recovered via a deduction line
  only); multi-currency payroll; retroactive recalculation of locked months (a correction is
  an input in the next month); appraisals; expense claims; insurance.
- Anti-goal: payroll data visible anywhere outside `hr.payroll.*` capabilities — never in the
  directory, employee card, people picker, general employee serializers, reports or search.
- Anti-goal: hard-coded GOSI rates or bank layouts in code.
- Anti-goal: a second accounting engine; Finance stays stock `account` through the bridge.
- Anti-goal: OCA `payroll` menus, views or groups exposed to anyone (engine only).

## 5. Architecture

- **`webvue_hr` payroll section.** Depends additionally on OCA `payroll` (pin the OCA
  `payroll` repo at 19.0 in `deploy/oca-addons.json`; only the `payroll` module exists on
  19.0, `payroll_account` does not). Models, serializers and routes under
  `/api/v1/hr/payroll/*`. Engine usage: salary structure and rules of OCA `payroll`; WebVue
  ships one Saudi structure as data (basic, housing, transport, other allowances, overtime,
  absence, bonus, deduction, unpaid leave, GOSI employee, GOSI employer, net). If a rule
  cannot be expressed cleanly in the OCA engine, compute it in a WebVue service and feed
  the engine an input line — the builder decides per rule, without copying Odoo methods (R9).
- **`webvue_hr_finance` bridge** (rank 5, `auto_install`, depends `webvue_hr` +
  `webvue_finance`): payroll account mapping, journal entry creation, payment recording,
  EOS provision, department → analytic account mapping. Registered in `tools/arch_layers.json`.
  UI for the finance side of payroll lives in the HR web area (`components/hr/payroll/`,
  `pages/hr/payroll/`) like `webvue_pmo_finance` lives under pmo; Finance pages do not use
  HR components (R3).
- **Capabilities** (R2, R10), owned by `webvue_hr`, implied by no other HR capability and not
  by `group_hr_manager`:
  - `hr.payroll.read` — see runs, payslips, compensation.
  - `hr.payroll.manage` — edit compensation, monthly inputs, compute runs.
  - `hr.payroll.approve` — approve/lock a run (cannot approve a run containing own payslip).
  - `hr.payroll.config` — rate table, structure parameters, bank file profiles.
  - Bridge actions additionally require Finance capabilities: posting the entry needs
    `finance.entries.post`; recording payment needs `finance.payments.manage`. So HR prepares
    and approves, the accountant posts and pays. This keeps the bridge free of `sudo()`
    (AGENTS.md: HR bridges have no `sudo()` path).
  - Self-service: an employee sees **own** payslips with `hr.employees.read` + sub-feature
    `hr.payroll`, like «عهدي».
- **Sub-feature** `hr.payroll` registered in `webvue.feature.registry` (owner `webvue_hr`);
  every payroll route checks it. Works in `saas` and `non_saas` (R8).
- **Security risk carried from the fit test**: OCA `payroll` Officer group implies
  `hr.group_hr_manager`. Never assign that group; grant engine ACLs to WebVue capability
  groups directly, with a test proving no HR capability implies payroll and payroll implies
  no broader HR write.
- **Contracts**: new `packages/contracts/src/hr/payroll.ts`; compensation is a separate
  schema from `HrEmployeeContractSchema` (which stays salary-free).

## 6. Domain rules

### 6.1 Wage definitions
- GOSI contributory wage = basic + housing (cash), bounded by the configured minimum and
  maximum (currently understood as SAR 1,500 min for annuities, SAR 45,000 max).
- EOS wage = last actual wage = basic + regular fixed allowances (Article 2 "actual wage");
  overtime, bonuses and one-off items excluded.
- Day rate for absence / unpaid leave / partial month = monthly wage ÷ 30 (my call; a common
  Saudi practice, configurable divisor in the rate settings).

### 6.2 GOSI rate table (configuration, not code)
Dated rows keyed by (insurance branch, nationality class, registration regime) with employee
% and employer %. Branches: annuities, SANED, occupational hazards. Classes: Saudi registered
before 2024-07-03, Saudi registered on/after 2024-07-03 (rate steps every July), non-Saudi
(employer occupational hazards only). GCC nationals: out of seed data until verified; the
table can hold them. Seed values must be checked against gosi.gov.sa before release (the
2024 reform schedule was only confirmed from secondary sources); the seed is marked
"verify" in data comments and in the release checklist.

### 6.3 End of service (Articles 84, 85, 87)
- Award: half a month's EOS wage per year for the first 5 years, one month per later year,
  pro-rated for part years.
- Resignation: <2 years 0; 2–<5 years ⅓; 5–<10 years ⅔; ≥10 years full.
- Full award regardless of length: termination by employer, fixed-term expiry, force majeure,
  female worker ending the contract within 6 months of marriage or 3 months of childbirth.
- The departure reason (existing offboarding `departure_reason_id`) maps to one of these
  cases; the mapping is configuration.
- Final settlement adds unused annual leave encashment (balance from `hr_holidays` × day
  rate), last partial month, and open deductions.
- Formulas reviewed by a Saudi CPA before release (open question 3 of the 2026-10-18 spec).

### 6.4 Run lifecycle
`draft` (inputs open) → `computed` (recompute allowed) → `approved` (locked, payslips
visible to employees) → `posted` (bridge entry posted) → `paid` (payment recorded).
One run per company per month. Only `draft`/`computed` can be edited or cancelled; a
mistake after approval is corrected by an input in the next month.

### 6.5 Files
- **Bank salary file**: one internal salary-line model, export through **bank file
  profiles** (column order, delimiter, encoding, header/footer). Ship a generic CSV profile
  (employee id/iqama, name, IBAN, basic, housing, other allowances, deductions, net, value
  date) plus profiles for specific banks only when a customer provides the bank's portal
  spec. Western digits, UTF-8, no Arabic-locale semicolons.
- **WPS file**: Mudad template columns (name, national ID/iqama, IBAN, contracted salary
  components, actual paid, deductions) with the totals rule basic + housing + other −
  deductions = net enforced before export. Exact column spec to be taken from Mudad's
  current template before release.
- Files are generated on demand from an approved run; not stored as attachments unless the
  builder needs that for audit.

## 7. Finance posting (bridge)

- **Mapping** (configuration per company, set in payroll settings): expense accounts for
  basic, allowances, overtime/bonus; GOSI employer expense; GOSI payable; salaries payable;
  other deductions payable/receivable (advances); EOS expense and EOS provision; the
  payroll journal.
- **Entry detail setting** (owner, 2026-10-21): a company setting in the bridge's payroll
  finance settings, edited with a Finance capability, chooses **aggregated** (lines per
  account and department cost center, no individual salaries visible in Finance) or
  **per employee** (one line per employee per account, with the employee as partner/label).
  Default aggregated. The setting applies to runs posted after it changes; posted runs are
  not rewritten.
- **Entry on post**: one balanced entry per run: Dr salary/allowance/GOSI-employer expenses,
  Cr salaries payable (net), Cr GOSI payable (employee + employer), Cr/Dr deduction accounts.
  Expense lines carry `analytic_distribution` from the employee's department cost center
  (department → analytic account mapping in the bridge; employees without a mapped
  department go to the company default with a warning before posting).
- **Payment**: records one payment (or a single entry) from the chosen bank journal clearing
  salaries payable for the run total; GOSI payment is a normal Finance payment later.
- **EOS provision**: monthly entry of the change in accrued EOS liability per employee
  (my call: standard accrual practice; the CPA review may change the method).
- Posting respects Finance period locks (`write_support.is_period_locked`) and the existing
  balanced-entry helpers; no direct SQL.

## 8. UI (DESIGN.md; Storybook components only; Arabic, RTL-first)

HR sidebar gets a titled section **«الرواتب»**, shown only with `hr.payroll.read`:
- **المسيّرات** `/hr/payroll` — list of monthly runs with state; `/hr/payroll/new` opens
  `SharedCreatePanel` (company month); `/hr/payroll/{runId}` is the run page: inputs table
  (inline editable while draft), totals, review, approve, then post, bank file, record
  payment, WPS file, GOSI statement as state-dependent actions with inline confirmation.
- **قسيمة** `/hr/payroll/{runId}/payslips/{payslipId}` — printable page.
- **نهاية الخدمة** — calculator and final settlement on the offboarding record
  (`/hr/offboarding/{employeeId}`), shown only with payroll capability.
- **إعدادات الرواتب** `/hr/payroll/settings` (`hr.payroll.config`) — GOSI rate table, day
  divisor, departure-reason → EOS case mapping, bank file profiles, account mapping (bridge
  part, needs a Finance capability to edit accounts).
- Employee record: a **«التعويضات»** tab/section visible only with `hr.payroll.read`
  (edit with `hr.payroll.manage`); the general employee page stays salary-free for everyone
  else, including HR managers without payroll access.
- Self-service: **«قسائمي»** under «خدماتي» (`/hr/payroll/mine`), own approved payslips only.

## 9. Constraints

AGENTS.md in full: R1–R10, no new `sudo()`, clean pre-release codebase (no parallel paths,
one source per fact), `{items, total}` envelopes, `json2` routes with `api_handler`,
403/404/422, current-company checks, zod parity, Odoo tests on scratch DBs only, version
bumps and migrations per `docs/migrations.md`, worktrees via `npm run wt -- new`.

## 10. Verification

- Odoo tests (`WebVueHrCase`): compensation visibility matrix (who can and cannot read
  salary/IBAN, including HR manager without payroll), GOSI per class and rate date, min/max
  wage caps, unpaid-leave and absence day math, EOS per Article case and service length
  boundaries (1.99, 2, 4.99, 5, 9.99, 10 years), run state machine and self-approval
  refusal, entry balance and analytic split, period lock refusal, bank/WPS file totals rule.
- Web: `npm test`, `cd apps/web && npm run lint`, stories for new components, mock-stack
  screenshots of run page and payslip (RTL, light/dark, mobile).
- `odoo-reviewer` on addon and contract changes; arch and git policy checks.
- Release gate (not dev gate): GOSI seed rates confirmed on gosi.gov.sa, Mudad template
  confirmed, EOS and posting reviewed by a Saudi CPA.

## 11. Suggested build order (the builder plans the details)

1. Foundation: OCA pin, capabilities, sub-feature, compensation fields and «التعويضات».
2. Rate table, Saudi structure, run lifecycle, inputs, compute, payslip, self-service.
3. Bridge: mapping, posting, payment recording, analytic split.
4. Bank file profiles and WPS file, GOSI statement.
5. End of service: calculator, provision entry, final settlement in offboarding.

## 12. Left to the builder

Model and field names, how much of the computation runs inside the OCA engine versus a
WebVue service (§5), file layout within the owning folders, serializer shapes, test
fixtures, the OCA commit pin, whether generated files are stored, and component choices
from the Storybook catalog.

## 13. Calls made by the author (owner to check)

- Day rate divisor 30, configurable.
- Monthly EOS provision entry.
- HR approves, the accountant posts and records payment (separate capabilities, no `sudo()`).
- One run per company per month; corrections go to the next month.
- Generic CSV bank profile first; bank-specific profiles on customer request.
- Employee documents and expiry alerts stay in the HR core phase of the 2026-10-18 spec, not here.
- Compensation (wages, allowances, IBAN link, GOSI data) lives in a **separate payroll-owned
  model keyed to the employee** (ACL only for payroll capability groups), not as extra fields
  on `hr.employee`/`hr.version`, so no general employee read path can reach it. The stock
  `hr.version.wage` used by the OCA engine is written only from that model.
- Default of the posting detail setting (§7) is **aggregated**, the privacy-safe choice.
- Compute **refuses with a clear 422** naming the employee when no GOSI rate row matches
  (e.g. a GCC national before that class is configured); no silent default rate.
- Joiners and leavers are **prorated automatically** from contract start/end and departure
  date within the month; the officer does not enter days for that.
- EOS provision: each month the full accrued award per employee is **recomputed from
  scratch** and only the delta to the last posted accrual is posted; the last posted
  accrual is stored per employee.
- Advances are paid out by the accountant in Finance to an employee receivable account;
  payroll only **recovers** them through a deduction line posted against that receivable.
- Dev uses the researched GOSI values as seed, marked "verify"; release needs confirmation
  on gosi.gov.sa and the CPA review already listed as open question 3 of the 2026-10-18 spec.
- OCA `payroll` 19.0 installed and computed a payslip in the 2026-10-18 fit test; if a rule
  later proves awkward in the engine, the §5 fallback applies per rule.

## 14. Owner answers (2026-10-21)

1. Entry detail is **both, as a company setting** in the payroll finance settings (§7):
   aggregated per account and department, or one line per employee.

## 15. Implementation decisions (recorded after the build)

The build recorded 29 rulings that changed or interpreted this spec. The working ledger that held them
is not part of the branch, so they are kept here for the maintainer. Five of them (R13, R21, R26, R27,
R29) carried no cost in the ledger; their cost below was assessed at documentation time.

1. **R1 — worktree claim scopes are advisory.** `npm run wt -- new` records the paths a task expects
   to touch, but that registry warns, it does not block, so a builder may edit a path its plan names
   outside the claim. Code: `tools/wt.py`, `docs/parallel-work.md`. Cost if wrong: two sessions edit
   one file at once and the overlap surfaces only at review or integration.
2. **R2 — approval blockers are structured dicts.** `_webvue_approval_blockers()` returns
   `{code, message, field?, details?}` entries (Task 8 first, extended by Task 18 with
   `settlement_missing`), while a negative net and approving one's own payslip stay inline refusals.
   Code: `odoo-addons/webvue_hr/models/hr_payslip_run.py`. Cost if wrong: the approval path needs
   small rework to read plain blockers.
3. **R3 — the payslip `lines` payload excludes the codes it carries as their own fields.** The
   serializer drops `NET` and the employer GOSI share (`SEPARATE_CODES`); the statistical rule
   `GOSI_BASE` was the second code when this was decided and was removed from the structure in
   Task 16 fix 2. Code: `odoo-addons/webvue_hr/serializers/payroll/payslip.py`. Cost if wrong: the UI
   shows the net or the employer share twice.
4. **R4 — a shared file is editable only when the task step names it.** The worktree's single-writer
   rule allows a builder to edit a shared file its own task step lists, with no extra agreement, and
   commits on the payroll branch were authorized by the owner's «نفذ». Code: `docs/parallel-work.md`.
   Cost if wrong: none beyond the normal review of those shared files.
5. **R5 — `hr.version.wage` is never written.** The OCA engine reads wages from WebVue's own
   compensation model, so the HR version model never opens `wage`, which overrides §13's wording that
   `wage` is written from that model. Code: `odoo-addons/webvue_hr/models/hr_version.py`. Cost if
   wrong: the engine needs a hook that feeds it the wage value.
6. **R6 — payroll keys are a set of their own in the catalog tests.** The composition test keeps
   `PAYROLL_PERMISSIONS` separate from `HR_PERMISSIONS` and the four keys were added to the
   unpublished catalog `platform_v3` with their count-pinning tests. Code:
   `odoo-addons/webvue_hr/tests/test_hr_access_composition.py`, `deploy/catalog/solutions/platform_v3.json`.
   Cost if wrong: a reviewer flags the extra test and catalog edits.
7. **R7 — the `payroll_manager` built-in role keeps exactly four keys.** It is
   `hr.payroll.read|manage|approve|config`; `hr.employees.read` reaches payroll users through the
   employee role, and payroll routes gate on `hr.payroll.*` plus `hr.employees.read` only where the
   plan says. Code: `odoo-addons/webvue_hr/data/hr_access_permissions.xml`,
   `odoo-addons/webvue_hr/models/access_service.py`. Cost if wrong: a payroll-only user without the
   employee role cannot open employee pages.
8. **R8 — the payslip child tables and the run carry global company rules of their own.** OCA scopes
   only the payslip and its configuration by company, so WebVue adds the company domain to
   `hr.payslip.line`, `hr.payslip.input`, `hr.payslip.worked_days` and `hr.payslip.run`. Code:
   `odoo-addons/webvue_hr/security/hr_payroll_rules.xml`. Cost if wrong: none (the rule is stricter).
9. **R9 — the IBAN check is WebVue's own.** `stdnum.iban` breaks under Odoo's import hook and
   `base_iban` would pull stock `account` into HR-only tenants, so a compact ISO 13616 mod-97 check
   with an `SA` prefix and 24-character length lives in the compensation model. Code:
   `odoo-addons/webvue_hr/models/hr_compensation.py`. Cost if wrong: a mis-validated IBAN is caught by
   the bank at upload instead of at entry.
10. **R10 — the compensation form has no bank picker.** The bank on the record is shown read-only
    (the Saudi IBAN carries the bank code) and setting the bank name waits for a lookup route. Code:
    `apps/web/app/components/hr/payroll/CompensationForm.vue`. Cost if wrong: officers cannot set the
    bank name until the lookup is added.
11. **R11 — money input is shared.** `parseMoneyInput` (Arabic digits, two decimals) moved out of
    `apps/web/app/utils/projectFinance.ts` into `apps/web/app/utils/moneyInput.ts`, used by PMO and by
    the compensation form and the inputs table, with no duplicate. Code:
    `apps/web/app/utils/moneyInput.ts`. Cost if wrong: a PMO import path has to change with it.
12. **R12 — the default annual leave type is `hr_holidays.leave_type_paid_time_off`.** The xml id the
    spec assumed (`holiday_status_cl`) does not exist in Odoo 19, so the settings default points at
    the stock paid-time-off type. Code: `odoo-addons/webvue_hr/models/payroll_settings.py`. Cost if
    wrong: none (the fallback is the stock type).
13. **R13 — GOSI rates are read in the payslip's company.** The calculator switches to
    `with_company(payslip.company_id)` before the rate lookup, so a company row wins over the shared
    seed row for the payslip being computed. Code: `odoo-addons/webvue_hr/models/payroll_calculator.py`.
    Cost assessed at documentation time: a company-specific rate row would be invisible to that
    company's runs, which would fall back to the shared seed row or raise `gosi_rate_missing`, and it
    would contribute at the wrong rate.
14. **R14 — Saudi values are injected only into the company's own structure.** The rules run when the
    payslip's structure is the one in payroll settings, and `structure_saudi` belongs to the main
    company because OCA requires a `company_id`, so a second company in the same database needs its
    own copy. Code: `odoo-addons/webvue_hr/data/hr_payroll_structure_data.xml`,
    `odoo-addons/webvue_hr/models/payroll_settings.py`. Cost if wrong: multi-company tenants cannot
    compute or create a run until that copy exists.
15. **R15 — an hourly unpaid leave counts its fraction of a day.** A leave requested in hours for a
    single day counts `number_of_days` (its fraction), not a whole day. Code:
    `odoo-addons/webvue_hr/models/payroll_calculator.py`. Cost if wrong: a small proration difference
    on part-day unpaid leave.
16. **R16 — an empty structure is a named refusal, never a silent zero.** Compute raises the 422
    `structure_missing`, and the input-code mapping is one constant. Code:
    `odoo-addons/webvue_hr/models/hr_payslip_run.py`. Cost if wrong: a run would silently pay zeros
    until the guard is restored.
17. **R17 — the run summary shape is `{id, month, state, employee_count, totals, approved_at}`.**
    The contract in `packages/contracts/src/hr/payroll.ts` must keep exact key parity with it. Code:
    `odoo-addons/webvue_hr/serializers/payroll/run.py`. Cost if wrong: the Zod contract has to change
    with the serializer.
18. **R18 — the paid days are a stored snapshot on the payslip.** `webvue_paid_days` is written when
    the payslip is created and computed, like the department snapshot, because an employee cannot read
    `hr.version`. Code: `odoo-addons/webvue_hr/models/hr_payslip.py`. Cost if wrong: the payslip shows
    stale paid days until it is recomputed.
19. **R19 — the annual leave type is required and HR names its own run states.** The settings refuse
    to clear the leave type (EOS encashment needs it), the register prints every row with search, and
    the HR state filter accepts `draft`, `computed` and `approved` until the bridge widens the list.
    Code: `odoo-addons/webvue_hr/models/payroll_settings.py`,
    `odoo-addons/webvue_hr/serializers/payroll/run.py`. Cost if wrong: settings cannot be cleared back
    to no leave type.
20. **R20 — payroll readers get read-only accounting vocabulary.** The bridge grants them read ACLs on
    `account.account`, `account.journal` and `account.analytic.account` so the finance settings can be
    shown; company rules still apply. Code:
    `odoo-addons/webvue_hr_finance/security/ir.model.access.csv`. Cost if wrong: a payroll reader can
    see the chart of accounts' names.
21. **R21 — the run state filter reads the field selection at runtime.** HR lists the states the
    `webvue_state` selection actually holds instead of naming bridge states, so a state added by
    `webvue_hr_finance` is accepted without editing `webvue_hr`. Code:
    `odoo-addons/webvue_hr/controllers/payroll/runs.py`,
    `odoo-addons/webvue_hr/serializers/payroll/run.py`. Cost assessed at documentation time: a bridge
    state the HR addon does not know would be rejected by the filter and unreachable from the list.
22. **R22 — the bridge guards writes to the run.** `hr.payslip.run.write` lets a user without
    `hr.payroll.manage` only move `approved → posted` (with `webvue_move_id`) and `posted → paid`
    (with `webvue_payment_id`); the posting preview refuses a non-approved run and
    `_webvue_finance_refs` merges `super()`. Code:
    `odoo-addons/webvue_hr_finance/models/hr_payslip_run.py`. Cost if wrong: a small extra review
    scope in the bridge task.
23. **R23 — payment and approval guards were folded into the bridge task.** The approver guard is
    narrowed to the meeting fields, payment refuses a foreign-currency journal (422 `journal_id`),
    asserts the payable lines are reconciled and refuses a payment date before the posting date.
    Code: `odoo-addons/webvue_hr_finance/models/payroll_posting.py`,
    `odoo-addons/webvue_hr_finance/models/payroll_finance_link.py`. Cost if wrong: extra scope in that
    task.
24. **R24 — accounts and analytic accounts are paged in 200-row chunks.** The settings page follows
    the server's page cap until the total is reached, with no per-role narrowing. Code:
    `apps/web/app/composables/useHrPayrollFinance.ts`. Cost if wrong: a few extra requests when the
    settings page lists accounts.
25. **R25 — file routes accept every state except `draft` and `computed`.** HR names no bridge state,
    and text columns are neutralised against CSV formula injection before export. Code:
    `odoo-addons/webvue_hr/controllers/payroll/files.py`,
    `odoo-addons/webvue_hr/models/payroll_export.py`. Cost if wrong: an unapproved run could export
    figures that were never approved.
26. **R26 — `main` was merged into the branch by the orchestrator without an owner request.** Main
    (`eebab3e2`, the finance completion) reached `codex/hr-payroll` at merge commit `043ea463` right
    after the salary-files task, before any owner request, and was accepted afterwards because the
    final integration needs current `main` anyway; the merge touched no payroll file and a combined
    Odoo run covered `webvue_hr`, `webvue_hr_finance` and `webvue_finance`. Code: repository history
    (merge `043ea463`), against the merge authorization rule in `AGENTS.md`. Cost assessed at
    documentation time: the branch would be missing the finance completion from `main`, and the final
    integration would have to redo the merge and re-review the combined result.
27. **R27 — parallel lanes ran in one worktree on disjoint files.** Three lanes (HR settlement, bridge
    hardening, web contracts) edited disjoint paths with serialized Odoo runs and explicit staged
    paths on commit. Code: `docs/parallel-work.md`. Cost assessed at documentation time: two lanes
    would edit one file and one lane's work would be lost before integration.
28. **R28 — the settlement was first unique per employee; the repair wave narrowed that.**
    The original ruling recorded "one settlement per employee, no re-hire redo" as a phase limit in the
    migration README; the repair wave replaced it with uniqueness per employee **and departure date**,
    so a re-hire that leaves again gets a new settlement and the earlier one stays as locked history.
    Code: `odoo-addons/webvue_hr/models/eos_settlement.py`,
    `odoo-addons/webvue_hr/migrations/19.0.1.7.0/README.md`. Cost if wrong: a re-hired leaver would
    need the earlier settlement handled by hand.
29. **R29 — service start is one helper with the stock no-gap rule.** The settlement and the monthly
    provision both read the service start through `_webvue_service_start`, which applies Odoo's rule
    that a gap of four days or more starts a new service, on the versions payroll may read. Code:
    `odoo-addons/webvue_hr/models/eos_settlement.py`,
    `odoo-addons/webvue_hr_finance/models/eos_accrual.py`. Cost assessed at documentation time: the
    settlement and the provision would count different service lengths, so the accrued liability would
    not match the award paid on departure.

### 15.1 Repair-wave facts (2026-10-21)

- **Final settlement is unique per employee and departure date.** A re-hire that leaves again gets a
  new settlement while the confirmed settlement of the earlier departure stays as locked history
  (`_employee_departure_unique`, `_webvue_current`). Code:
  `odoo-addons/webvue_hr/models/eos_settlement.py`.
- **Approval refuses an empty run and a stale one.** `run_empty` for a run with no payslip and
  `run_stale` for a run whose figures changed after the last compute, alongside the existing
  `settlement_missing` and negative-net refusals. Code:
  `odoo-addons/webvue_hr/models/hr_payslip_run.py`.
- **Shared GOSI rate rows are read-only and a company's own row wins.** The shared seed rows carry no
  company and are writable by none; a company row with the same (or a later) start date wins over the
  shared one for that company. Code: `odoo-addons/webvue_hr/security/hr_payroll_rules.xml`,
  `odoo-addons/webvue_hr/models/gosi_rate.py`, `odoo-addons/webvue_hr/data/hr_gosi_rate_data.xml`.
- **The end-of-service provision nets payouts since the last accrual.** The posted delta is
  `target − (last accrual − paid)`, so an EOS amount paid out of the provision is not provisioned
  again, whichever month it was paid in. Code:
  `odoo-addons/webvue_hr_finance/models/eos_accrual.py`.
