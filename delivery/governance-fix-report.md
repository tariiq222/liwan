# Governance correction pass

Source ready for coordinator integration; broad/runtime acceptance remains pending. The original governance-report.md records the earlier implementation and must not be treated as current acceptance evidence.

## Corrections

- Model create/write allowlists reject unknown and machine-only values, including context defaults for computed fields. Permitted defaults are resolved before validation. Optional active/internal/current-company user and same-project task checks apply to defaults, copies and multi-create. All governance unlink paths require authoritative project management, readable records and active current-company projects. RACI and register now guard unlink directly.
- RACI has an authoritative PostgreSQL partial UniqueIndex `(task_id) WHERE role = 'A'`, in addition to pair uniqueness and the existing computed mirror unique. Direct writes/defaults cannot change that mirror. Model savepoints translate SQL uniqueness failures to ValidationError, preserving real HTTP 422 responses. Stakeholder deletion retains 409 when a restricted assignment is invisible to the caller: the known FK error is caught and translated without reading hidden rows or using sudo.
- Mixed issue/risk batch writes preserve risk metrics. Register due dates accept only real YYYY-MM-DD calendar strings, native Python date, or clearing values; reject datetime and invalid dates. Wire contracts reject JS Date/datetime strings, issue metrics, missing risk metrics and falsified scores. Item detail/patch/delete missing ids now return 404.
- All governance query keys use the actual shared prefix. Mutations invalidate active lists, replace detail responses and RACI rows with complete server shapes, and remove deleted detail cache. Failed mutations preserve cached data.
- Both detail route parents render NuxtPage and hide the detail on child routes. Direct new/edit pages and edit/create controls consume authoritative useProject.can_manage. Saved user, owner, due date, probability and impact appear in details. Forms reset dirty state and await nextTick before successful navigation; errors preserve form values.
- Stakeholder search and register q/kind/status/priority/offset are query-backed and keep the current filtered URL as returnTo. Lists expose total and 50-record paging. Delete errors are visible; inline confirmation has Cancel; controls use useHydrated.
- RACI is now a readable task × stakeholder matrix with inline add/change/remove role controls, legends and accessible cell names. Task pages hold 50 rows; stakeholder pages hold 10 columns. Searches and a closed-task toggle reach all records. Matrix queries fetch its viewport (at most 500 assignments) in bounded 200-record HTTP pages. Removal needs inline confirmation, failed edits retain the server role and display an alert. Register task picker has search, completed-task toggle and load-more.

## Files and registration

Owned changes include the 20 paths listed in governance-integrated.json plus:

- apps/web/app/components/project/governance/state.ts
- apps/web/app/components/project/governance/__tests__/state.test.ts
- apps/web/app/components/project/governance/__tests__/mutations.test.ts
- delivery/governance-ar.json and governance-en.json (updated fragments)
- delivery/governance-vitest.config.ts (standalone focused runner, avoids generating Nuxt state)
- delivery/governance-fix-report.md

Shared registrations stay as originally specified: import models/controllers/tests project_governance; import serializers module if using its barrel; load security/ir.model.access-governance.csv and project_governance_rules.xml; export pmo/governance.ts; merge the governance object from each locale fragment inside projects; retain project navigation links. New helper/tests need no addon or Nuxt registration.

HTTP endpoints remain project-scoped stakeholders/register collections and item routes, RACI collection and PATCH/DELETE item routes. RACI GET additionally accepts comma-separated task_ids (max 50) and stakeholder_ids (max 10), alongside limit/offset. No RACI item GET was added because the matrix consumes collection rows. No shared files, dependencies, commits, runtime or database were changed by this worker.

## Fresh focused verification

- `npm -w packages/contracts test -- src/pmo/__tests__/governance.test.ts`: 5 tests passed. The two new date/metric tests first failed against the old schema and passed after correction.
- `./node_modules/.bin/vitest run --config delivery/governance-vitest.config.ts`: 6 tests passed across state and real vue-query mutation hooks. RACI full-response replacement assertion first failed and passed after correction.
- Python ast.parse: model/controller/serializer/test files parse.
- Vue compiler-sfc parse/compileScript/compileTemplate: all 11 governance Vue files parse/compile.
- The default web Vitest command could not run without generated .nuxt/tsconfig.app.json; the narrow standalone config above ran the focused tests successfully, without generating shared/runtime state.

## Runtime verification still required

The Odoo suite now has 13 methods covering HTTP CRUD/filters/errors, direct ORM write/unlink/default/copy/batch guards, capability-based contextual owners, private/archived/companyless/foreign projects, optional users, mixed metrics, dates, uniqueness and records beyond 200. These tests were written and syntax-checked, not executed by this worker. The concurrency method clones the **installed** RACI SQL table/index definitions into a uniquely named disposable table and races two independent connections (A versus A with the mirror null, and duplicate task/stakeholder pairs), then drops it. This proves arbitration by installed SQL constraints without committing HttpCase business fixtures; it is not a full ORM multi-transaction integration test. The coordinator must run it on the authorized scratch database only.

Coordinator must run actual Odoo tests, TypeScript/lint/build, authenticated browser CRUD/refresh/back/dirty-state/pagination and independent security rereview. Passing focused unit/syntax checks is not runtime or production proof. The source is uncommitted in codex/phase1-governance.

## Runtime correction follow-up — final source freeze

The coordinator's first registered Odoo run found a **real visibility defect**, not a fixture problem: stock Odoo19 `_search` evaluates ir.rule security domains through `self.sudo()`, and its full optimizer rewrites `any` to `any!`. The relational global rules alone therefore do not inherit parent project/task visibility. The new abstract `nasq.governance.visibility` mixin in the existing model file fixes this through caller-built project/task SQL subqueries in `_search`, and the same caller query in `_check_access` for direct read, field fetch, has_access and cached records. No sudo is added. The existing rules remain the active/current-company floor. The private-project test now establishes that the project itself is unreadable before checking all three governance models.

Foreign user validation previously enumerated `user.company_ids`, whose Odoo conversion reads company active fields and raises AccessError for inaccessible companies. It now performs an ordinary `res.users` membership search, applying exactly the current-company/internal/active condition without reading foreign company records; invalid references consistently produce ValidationError.

**Fresh coordinator Odoo proof:** `/Users/tariq/code/nasq-phase1-artifacts/odoo-governance-visibility.log`, inspected by this worker, reports **0 failed, 0 errors of 13 tests** against `nasq_phase1_20260907`. It covers these corrections and the installed-SQL-index concurrency test. This supersedes the earlier “Odoo execution pending” status above; no Odoo process was run by this worker.

The matrix now persists `task_q`, `stakeholder_q`, `closed` (1), `task_page`, and `stakeholder_page` in the URL, validating unknown/negative/noninteger page values. Tasks use a bounded page query directly at offset = task_page × 50, so a refreshed task-page-one URL does not need to fetch page zero first. Return links preserve the full viewport URL. A focused hook test asserts the actual page-50 query and returned list; viewport parsing has its own regression test.

People options are explicitly projected to `{id,name}` before adding the existing selection, avoiding the `PersonRef.user_id` type mismatch. All missing shared keys (`app.delete`, `app.all`, `app.saving`) have been replaced by translated feature-local governance keys. `in_progress` is present alongside `inProgress`.

Final fresh worker checks: **5 contract tests + 8 web tests passed**, all 11 Vue SFCs parse/compile, corrected Python and locale JSON parse. Full TypeScript/lint/build and final browser/review acceptance remain coordinator-owned. The new abstract model is registered by the existing project_governance import and needs no separate ACL/table registration.

A final focused Odoo regression method was added at the reviewer's request: an archived task hides its RACI and linked register through search_count, search_read, cached id-only read and has_access while the same readable project's unlinked register and stakeholder remain visible. The model implementation is unchanged. Suite source now contains 14 methods; the new method awaits coordinator execution, and the 13-test runtime proof above remains the actual evidence until rerun.
