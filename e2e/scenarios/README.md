# End-user test scenarios

This folder is the register of every end-user scenario WebVue is tested against: what is
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
| [journeys.md](journeys.md) | Journeys that cross applications (requests, approvals, money, people) |

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
[tools/e2e_seed.py](../../tools/e2e_seed.py) into the disposable `webvue_scratch_e2e`
database. Login is `e2e_<key>`; the credentials are declared in
[e2e.config.ts](../../e2e.config.ts) (`credentials.user('<key>')` in a test).

| Key | Persona | Department | Manager | Roles |
| --- | --- | --- | --- | --- |
| `ceo` | خالد العتيبي, المدير العام | الإدارة العامة | — | employee, pmo_manager |
| `it_admin` | فهد الشمري, مسؤول النظام | تقنية المعلومات | ceo | employee, system_admin |
| `hr_manager` | نورة القحطاني, مديرة الموارد البشرية | الموارد البشرية | ceo | employee, hr_manager, documents_manager |
| `payroll` | ريم الدوسري, أخصائية الرواتب | الموارد البشرية | hr_manager | employee, payroll_manager |
| `cfo` | عبدالله الحربي, المدير المالي | المالية | ceo | employee, finance_manager |
| `accountant` | سلمان الزهراني, محاسب | المالية | cfo | employee, finance_accountant |
| `auditor` | هند المطيري, مدققة مالية | المالية | cfo | employee, finance_auditor |
| `pm` | ماجد الغامدي, مدير مشاريع | المشاريع | ceo | employee, operations_reviewer |
| `ops_manager` | لمى السبيعي, مديرة العمليات | العمليات | ceo | employee, operations_manager |
| `staff1` | يوسف المالكي, مطور برمجيات | تقنية المعلومات | pm | employee |
| `staff2` | سارة العمري, منسقة عمليات | العمليات | ops_manager | employee |
| `admin` | E2E Admin (technical) | — | — | legacy admin groups, used by the older journeys |
| `employee` | E2E Employee (technical) | — | — | employee |

The seed creates structure only (company, departments, people, roles). Business records are
created by the scenarios through the UI, with a timestamp in every name because the database
is reused between runs.

## Running

- Scratch Odoo stack: `npm run e2e:odoo -- e2e/tests/<file>.e2e.ts`. Re-seed with
  `E2E_ODOO_SEED=1`, rebuild with `E2E_ODOO_RESET=1`. Details in
  [docs/testing.md](../../docs/testing.md#4-agentic-e2e).
- Never against `:3000`, `:8069` or the `odoo19` database; test data only.
- A passing scenario proves the local isolated stack, not staging or production.

## Adding or changing a scenario

1. Add or edit the row in the application's file (new ID at the end of its prefix).
2. When a test covers it, put the test file in the Test column and the ID in the test title,
   for example `test('[HR-12] employee withdraws a pending leave request', ...)`.
3. A manual pass records the date and evidence (screenshot path or run id) in Notes.
4. A failure records `fail` and a short description; the full report lives with the fix.
