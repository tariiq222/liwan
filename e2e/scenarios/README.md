# End-user test scenarios

This folder is the register of every end-user scenario LiwanOS is tested against: what is
covered, by which persona, with what expected result, and whether it is automated, checked by
hand, failing or still planned. Anyone testing the product starts here; anyone adding a test
updates the matching row in the same change.

The scenarios exercise the real customer UI (`apps/web`) the way customers use it: a vendor
sells a subscription, the customer's administrator receives the tenant, staff with different
jobs sign in and work, and requests move between people and applications.

## Files

| File | Covers |
| --- | --- |
| [saas.md](saas.md) | Selling, provisioning, invitation, subscription, limits, suspension, `non_saas` |
| [access.md](access.md) | Users, roles, branches, access log, employee accounts |
| [hr.md](hr.md) | Employees, departments, leave, payroll, shifts, onboarding/offboarding, custody, recruitment |
| [finance.md](finance.md) | Invoices, bills, payments, entries, bank, assets, budgets, reports, closing, ZATCA |
| [documents.md](documents.md) | Documents, visibility and grants, employee and department documents |
| [projects.md](projects.md) | Projects, charter, phases, milestones, tasks, completion review, project finance |
| [tasks.md](tasks.md) | Personal tasks and conversion to project tasks |
| [meetings.md](meetings.md) | Meetings, series, minutes, resolutions |
| [chat.md](chat.md) | Conversations and messages |
| [operations.md](operations.md) | Process builder and multi-stage requests |
| [platform.md](platform.md) | Notifications (bell), people picker, assistant, feature switches |
| [inbox.md](inbox.md) | Customer inbox: conversations, channels (WhatsApp), departments, tags, canned replies, contacts, export |
| [appointments.md](appointments.md) | Appointments: bookings, types, settings |
| [crm.md](crm.md) | CRM: pipeline board, opportunities, contacts and follow-ups, won/lost, assignment, import/export, settings |
| [payments.md](payments.md) | Payment providers, payment links, the public invoice payer pages and gateway callbacks |
| [journeys.md](journeys.md) | Journeys that cross applications (requests, approvals, money, people) |

## Completeness

The register must name every customer surface the code exposes: every page of `apps/web`
and `apps/vendor-admin`, every Odoo route under `odoo-addons/liwan_*/controllers` and every
capability. Each row lists what it exercises in its Covers column as backticked tokens:

| Token | Surface |
| --- | --- |
| `` `page /hr/leave/[id]` `` | A page of `apps/web` (file route, every parameter written `[id]`) |
| `` `vendor /customers/new` `` | A page of `apps/vendor-admin` |
| `` `POST /api/v1/hr/leaves/<id>/approve` `` | An Odoo route (every parameter written `<id>`) |
| `` `cap hr.leave.approve` `` | A capability, allowed or refused |

`python3 -B tools/e2e_scenario_coverage.py` reads the surfaces from the code and prints, per
application, how many have a scenario and which do not (`--app hr` narrows the report,
`--check` exits 1 on any gap or on a token that names no surface). A new page, route or
capability gets its scenarios here in the same change, so the report stays complete.

## Scenario IDs

Each scenario has a stable ID (`HR-12`, `J-05`). IDs are never reused or renumbered; a dropped
scenario keeps its row with status `dropped` and a reason. Test titles and finding reports cite
the ID.

## Status

| Status | Meaning |
| --- | --- |
| `planned` | Written here, not yet exercised |
| `manual YYYY-MM-DD` | Passed by hand on the isolated stack on that date (evidence in the Notes column) |
| `automated` | Covered by the e2e test named in the Test column |
| `fail` | Last run failed; the Notes column says what and links the report |
| `gap` | The product does not implement it yet; the row records the expected behaviour |
| `decision` | Expected behaviour needs an owner decision before it can be tested |
| `dropped` | No longer applies (reason in Notes) |

## Personas

The demo company «شركة نخبة الأعمال للتقنية» and its personas are seeded through Odoo by
[tools/e2e_seed.py](../../tools/e2e_seed.py) into the disposable `liwan_scratch_e2e`
database. Login is `e2e_<key>`; the credentials are declared in
[e2e.config.ts](../../e2e.config.ts) (`credentials.user('<key>')` in a test).

| Key | Persona | Department | Manager | Roles |
| --- | --- | --- | --- | --- |
| `ceo` | خالد العتيبي, المدير العام | الإدارة العامة | — | employee, pmo_manager, operations_reviewer |
| `it_admin` | فهد الشمري, مسؤول النظام | تقنية المعلومات | ceo | employee, system_admin |
| `hr_manager` | نورة القحطاني, مديرة الموارد البشرية | الموارد البشرية | ceo | employee, hr_manager, documents_manager, operations_reviewer |
| `payroll` | ريم الدوسري, أخصائية الرواتب | الموارد البشرية | hr_manager | employee, payroll_manager |
| `cfo` | عبدالله الحربي, المدير المالي | المالية | ceo | employee, finance_manager |
| `accountant` | سلمان الزهراني, محاسب | المالية | cfo | employee, finance_accountant |
| `auditor` | هند المطيري, مدققة مالية | المالية | cfo | employee, finance_auditor |
| `pm` | ماجد الغامدي, مدير مشاريع | المشاريع | ceo | employee, operations_reviewer |
| `ops_manager` | لمى السبيعي, مديرة العمليات | العمليات | ceo | employee, operations_manager |
| `staff1` | يوسف المالكي, مطور برمجيات | تقنية المعلومات | pm | employee |
| `staff2` | سارة العمري, منسقة عمليات | العمليات | ops_manager | employee |
| `crm_manager` | أحمد السهلي, مدير المبيعات | المبيعات | ceo | employee, crm_manager |
| `crm_agent` | مها الثبيتي, موظفة مبيعات | المبيعات | crm_manager | employee, crm_agent |
| `crm_agent2` | نايف العسيري, موظف مبيعات | المبيعات | crm_manager | employee, crm_agent |
| `users_reader` | رامي القرني | تقنية المعلومات | it_admin | employee + custom «قراءة المستخدمين فقط» (`access.users.read`) |
| `ops_monitor` | دانة الزهراني | العمليات | ops_manager | employee + custom «متابعة العمليات فقط» (`operations.monitoring.read`) |
| `docs_editor` | تركي البقمي | الموارد البشرية | hr_manager | employee + custom «تحرير المستندات بلا إدارة الوصول» (`documents.items.manage`) |
| `fin_reader` | أمل الجهني | المالية | cfo | employee + custom «قراءة المدفوعات فقط» (`finance.payments.read`) |
| `no_ai` | بدر الرشيدي | العمليات | ops_manager | custom «موظف بلا مساعد ذكي» (employee without `ai.use`) |
| `payroll_finance` | جواهر العنزي | المالية | cfo | employee, payroll_manager, finance_manager |
| `no_roles` | سعد الحربي | تقنية المعلومات | it_admin | none (internal user without any role) |
| `jeddah_staff` | وليد الحارثي | branch «فرع جدة» only | — | employee (in the branch) |
| `dammam_manager` | منيرة الشهري | branch «فرع الدمام» only | — | employee, hr_manager, documents_manager, operations_manager, finance_manager (in the branch) |
| `admin` | E2E Admin (technical) | — | — | legacy admin groups, used by the older journeys |
| `employee` | E2E Employee (technical) | — | — | employee |

The seed creates structure only (company, departments, people, roles). Business records are
created by the scenarios through the UI, with a timestamp in every name because the database
is reused between runs.

## Running

- Scratch Odoo stack: `npm run e2e:odoo -- e2e/tests/<file>.e2e.ts`. Re-seed with
  `E2E_ODOO_SEED=1`, rebuild with `E2E_ODOO_RESET=1`. Details in
  [docs/testing.md](../../docs/testing.md#4-agentic-e2e).
- Scheduled jobs do not run on the scratch stack (`max_cron_threads = 0`). Reminder, digest and
  auto-validation scenarios trigger them with `tools/e2e_cron.py` (see its docstring; `E2E_CRONS`
  selects jobs by XML id).
- The two branches are child companies of the root, so «another company» scenarios use a branch
  persona and its records.
- Never against `:3000`, `:8069` or the `odoo19` database; test data only.
- A passing scenario proves the local isolated stack, not staging or production.

## Problems found

Every `fail`, `gap` and `decision` row names its GitHub issue (`#132`) in the notes; security
findings are tracked in a private security advisory instead, never in a public issue. Fixes
wait until the whole register has been run once; then each issue is fixed, its scenarios are
run again and their rows updated.

## Running the register

The `user-test` skill (`.claude/skills/user-test/SKILL.md`) runs the register end to end: shared
stack, area agents, tenant-state phase, issues and re-tests. Record outcomes with
`tools/e2e_scenario_status.py` (stdin `ID<TAB>STATUS<TAB>NOTE`); change plan, limit or
subscription state only with `tools/e2e_tenant_state.py`, which restores its saved baseline.

## Adding or changing a scenario

1. Add or edit the row in the application's file (new ID at the end of its prefix), with
   its Covers tokens, then run the coverage report.
2. When a test covers it, put the test file in the Test column and the ID in the test title,
   for example `test('[HR-12] employee withdraws a pending leave request', ...)`.
3. A manual pass records the date and evidence (screenshot path or run id) in Notes.
4. A failure records `fail` and a short description; the full report lives with the fix.
