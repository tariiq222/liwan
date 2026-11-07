# Projects

Pages: `/projects`, `/projects/dashboard`, `/projects/new`, `/projects/[id]` with `charter`,
`milestones`, `tasks`, `schedule`, `stakeholders`, `raci`, `register`, `updates`, `meetings`,
`finance`, `settings`; `/tasks`, `/tasks/[id]`; settings `/settings/apps/projects`.
Owners: `liwan_pmo`, `liwan_pmo_finance`. Personas and status values: [README](README.md).

Capability note: `ceo` holds `pmo_manager`; `pm` gets project-manager rights only on projects
where they are the project manager; employees read projects and create/write tasks.

How to read the rows: a "refused" case names the HTTP status and error `code` the route answers
with. `ceo` is the global manager, `pm (own)` is `pm` on a project where `pm` is the manager,
`pm (other)` is `pm` on a project someone else manages. The Covers column lists the surfaces a row
exercises; `python3 -B tools/e2e_scenario_coverage.py --app liwan_pmo` reports what is still
missing. Project routes answer 404 `not_found` for a project of another company or one the caller
cannot read, and 403 `forbidden` when the caller can read it but lacks the capability.

## Projects, charter, phases

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PMO-01 | Create a project and a task, change the task state | admin | Saved, state changes | `page /projects/new` `POST /api/v1/projects` `page /projects/[id]/tasks/new` `POST /api/v1/tasks` `POST /api/v1/tasks/<id>/transition` | automated | `e2e/tests/pmo-journey.e2e.ts` |
| PMO-03 | Employee creates a project | staff1 | Refused unless `project_creators=employees` | `POST /api/v1/projects` `cap pmo.projects.create` | automated | `e2e/tests/access-matrix.e2e.ts`: refusal with the default policy only |

## Tasks and completion review

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |

## Project finance

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |

## Project list and dashboard

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PMO-70 | Followers-only project in the list | staff2 | Hidden from non-followers, visible to followers, the manager and managers | `GET /api/v1/projects` | fail | private security advisory GHSA-9xq5-v9r4-xfxc; followers-only project: non-follower staff1/staff2 correctly do not see it in the list, followers do, BUT ceo (pmo_manager role) does not see it either, and direct GET answers 403 with the raw English Odoo text instead of 404; see findings |

## Creating and copying a project

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PMO-92 | Open `/projects/new` directly as an employee under policy `managers` | staff1 | Page shows no form (no create right); back link returns to the list | `page /projects/new` `GET /api/v1/settings/projects/create-defaults` | fail | #196; UI as staff1 under policy managers: /projects/new shows the 403 permission page «لا تملك صلاحية فتح هذه الصفحة» (no form); that page offers «العودة إلى الصفحة الرئيسية», not the list. Not changed: the route needs `pmo.projects.create` (the command palette relies on it), so the in-page notice of `projects/new.vue` is only reached by someone who holds the capability; an owner decision on the shared permission page is needed |
| PMO-100 | Copy of an invisible project | staff2 | 404 `not_found`; the copy link on the source summary is hidden when the caller cannot create | `POST /api/v1/projects/<id>/copy` | fail | private security advisory GHSA-9xq5-v9r4-xfxc; staff2 GET and copy of a followers-only project they cannot read answer 403 `forbidden` with the raw English Odoo AccessError, the contract says 404 `not_found` |

## Project summary, edit, archive, status

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PMO-105 | Open a followers-only project as a non-follower | staff2 | Same not-found page, nothing leaks about the project | `GET /api/v1/projects/<id>` | planned | #197; fixed in code: a project the caller cannot read answers 404 `not_found` (`records.get_record`), covered by `test_followers_and_visibility`; not yet re-run in the UI; private security advisory GHSA-9xq5-v9r4-xfxc |
| PMO-114 | Edit with empty name, bad date, start after end | pm (own) | 422 `invalid` on the field; start after end names `date_start` | `PATCH /api/v1/projects/<id>` | fail | private security advisory GHSA-9xq5-v9r4-xfxc; start after end via PATCH answers 422 with the raw Odoo ValidationError (English text and a full Python traceback in the body) instead of 422 invalid on date_start; see findings; API empty name 422, bad date 422 |

## Charter content

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PMO-146 | Charter currency and amount display | staff1 | Amount shown with the company currency; unknown budget shows no amount | `page /projects/[id]/charter` `GET /api/v1/project-charter/defaults` | fail | #243; UI staff1: amount 12345.5 shows «12345.5USD ($)» (no thousands separator or two decimals, no space before the currency); unknown budget shows no amount; the project type is not shown on the read-only charter |

## Charter approval workflow

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PMO-166 | Sponsor cannot see the project any more | ceo | Approve and return answer 403/404 rather than succeeding; the dashboard card drops the project | `POST /api/v1/projects/<id>/charter/approve` | planned | not reachable: the sponsor is protected from losing access (follower removal 409, PMO-171; private switch adds the sponsor, PMO-172), so approve/return cannot be refused for sight |

## Phases

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PMO-178 | Move executing → closing → closed | pm (own) | Each forward step accepted with no gate; at `closed` the notice «المشروع مغلق» replaces the forward button | `POST /api/v1/projects/<id>/phase` | decision | #164; Closing and closed have no gate (open tasks, pending completion): owner choice |

## Stages and followers

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |

## Milestones

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |

## Schedule and dependencies

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PMO-214 | Schedule scale switch | staff1 | «أسبوعي» / «شهري»; a long project groups columns and says so | `page /projects/[id]/schedule` | fail | #243; see findings: «شهري» columns step 30 days (1 أكتوبر, 31 أكتوبر, 30 نوفمبر ...) |
| PMO-217 | Schedule shows only visible dependencies | staff1 | Dependency ids the caller cannot read are left out | `GET /api/v1/projects/<id>/schedule` | planned | same as PMO-259: no dependency id is hidden from a reader of the project, schedule showed the task for staff2 |
| PMO-220 | Schedule start after end, or outside milestone and project bounds | pm (own) | 422 `invalid` with the matching message | `PATCH /api/v1/projects/<id>/schedule/tasks/<id>` | fail | #195; API run as the persona (pm on own project, project created by e2e_admin with pm as manager): start after end 422 works, but an end date far after the project end (2030 vs 2027-03-31) is accepted with 200; see findings |

## Updates

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |

## Stakeholders

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |

## RACI

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PMO-259 | RACI hides tasks the caller cannot read | staff2 | Rows for unreadable tasks are not listed and not counted | `GET /api/v1/projects/<id>/raci` | planned | not buildable: tasks of a project follow the project; a follower of a followers-only project (staff2) reads every task, so no unreadable task row can be linked on this stack |

## Risk and issue register

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PMO-262 | Register order puts critical items first | staff1 | Items sort by severity: critical, high, normal, low, then due date | `GET /api/v1/projects/<id>/register` | gap | #156; The model orders by the priority text, which sorts critical, high, low, normal |
| PMO-266 | Create an issue | pm (own) | 201; `score`, `probability` and `impact` are all null (the stored score of an issue stays 0 inside Odoo and is never returned) | `POST /api/v1/projects/<id>/register` | automated | `liwan_pmo` tests `test_an_issue_has_no_score_like_its_probability_and_impact` and `test_project_governance`; #196: the row text said score 0, the contract says null |
| PMO-273 | Jump straight from closed back to open, or open to closed | pm (own) | Accepted: the route has no transition rules | `PATCH /api/v1/projects/<id>/register/<id>` | decision | #164; Owner to decide whether the register needs a status machine |
| PMO-276 | Linked task the reader cannot see | staff2 | The item is listed without the task link | `GET /api/v1/projects/<id>/register` | planned | same as PMO-259: the register item with a linked task is shown with the task to a reader who follows the project |
| PMO-277 | Governance routes for a hidden project | staff2 | 404 `not_found` on every governance read and write | `GET /api/v1/projects/<id>/register/<id>` | planned | #197; fixed in code: governance reads and writes of a hidden project answer 404 `not_found` through the same helper; not yet re-run as staff2; private security advisory GHSA-9xq5-v9r4-xfxc |

## Project tasks list and board

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PMO-283 | Add a task from a column or the toolbar | pm (own) | `/projects/[id]/tasks/new` opens as the create panel preset with the column's stage or state | `page /projects/[id]/tasks/new` | fail | #216: toolbar «مهمة مشروع جديدة» opens the create panel (Escape returns) but «مهمة جديدة في هذا العمود» opens /tasks/new?view=board with no stage or state preset; #216 |

## Task list API

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PMO-288 | Filters persist per browser and appear in the URL | staff1 | Assignee, deadline and priority are stored and mirrored; a key in the URL wins over the stored value | `page /tasks` | fail | #217 still: priority 3 chosen -> URL ?priority=3 and localStorage `liwan.tasks.filters` {closed,priority}; coming back to /tasks the list is filtered (total 0, chip «عاجلة») but the URL stays /tasks without the key; assignee and deadline also stored; a URL key wins (?priority=0); #217 |
| PMO-301 | List sorting and paging | staff1 | Sort by id, deadline (undated last), priority, name, create or write date, asc or desc; limit default 50 capped at 200; bad project id or limit 422 | `GET /api/v1/tasks` | automated | staff1 `sort=<field> <asc\|desc>` works for date_deadline (undated last in both directions), priority, name, id, write_date; limit=abc and project_id=abc 422; an unknown key or direction is 422 `invalid` on `sort` (`test_unknown_sort_keys_and_directions_are_refused`) |

## Creating and editing a task

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |

## Task states

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |

## Completion review

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |

## Task archive

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PMO-363 | Archived list validation and search | staff1 | Bad project id 422; negative limit or offset 422; `q` filters by name | `GET /api/v1/tasks/archived` | fail | #217; `project_id=abc` 422 and `-1` 422 hold; `limit`, `offset` and `q` on `/api/v1/tasks/archived` answer 400 `unsupported_filter` "pass filter=mine and/or project_id" (findings2/projects.md) |

## Task comments, timeline and attachments

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PMO-374 | Upload an attachment | staff1 | 201 with name, size, download link; appears in the task | `POST /api/v1/tasks/<id>/attachments` | fail | #217; Upload 201 from the UI and API with name, mimetype and download url, but no size field in the response (findings2/projects.md) |

## Tags and personal stages

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |

## Bell rows for projects and tasks

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PMO-393 | Open the digest page | pm | `/notification-digests/[id]` lists the snapshot tasks still open and readable, sorted by deadline, paged, with the digest date | `page /notification-digests/[id]` `GET /api/v1/notification-digests/<id>` | fail | #217; Page lists the snapshot tasks sorted by deadline with the footer «6 مهام متأخرة» and API paging works, but the digest date is not shown anywhere on the page (findings2/projects.md) |
| PMO-401 | Bells switched off with the feature | ceo | With `pmo.enabled` off none of the project bell kinds are listed | `GET /api/v1/projects` | fail | #219; exclusive phase, pmo.enabled off with no retained read: staff1 GET /notifications still lists the pmo kinds (assignment 12, comment 2, deadline 3) and ceo lists overdue_digest and assignment; none of the project bell kinds is filtered out, see findings |

## Project finance

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PMO-406 | Over budget | pm (own) | Actual above planned flags `over_budget`; exact decimal sums (0.10 + 0.20 equals 0.30) | `GET /api/v1/projects/<id>/finance/summary` | planned | needs finance off: expenses cannot be entered here; exact decimal sum 0.10 + 0.20 = 0.3 verified on budget lines |
| PMO-408 | Add an expense | pm (own) | Needs positive amount and a date; may link a budget line of the same project | `POST /api/v1/projects/<id>/finance` | planned | needs finance off: expense POST is refused 422 "Expenses are recorded in the project's cost center, not here."; amount<=0 422 "amount must be between 0 and 1e12" and a missing date 422 "expense_date is required" checked |
| PMO-413 | Edit with empty body or forbidden field | pm (own) | 422 "no fields to update" / `unknown_field` "cannot be changed" | `PATCH /api/v1/projects/<id>/finance/<id>` | fail | #217; Empty body 422 "no fields to update" and `kind` 422 unknown_field "cannot be changed" hold, but `project_id` alone is silently dropped and answers "no fields to update" (findings2/projects.md) |
| PMO-414 | Delete an expense | pm (own) | Inline confirmation; token required; `{deleted: true}` | `DELETE /api/v1/projects/<id>/finance/<id>` | planned | needs finance off: no expense can be created to delete |
| PMO-415 | Delete a budget line that expenses reference | pm (own) | 409 `finance_entry_linked`; delete the expenses or unlink them first | `DELETE /api/v1/projects/<id>/finance/<id>` | planned | needs finance off: no expense can reference a budget line; budget line delete without token answered 200 {deleted:true} |

## Project meetings tab and direct links

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PMO-433 | Section pages of a project that does not exist | staff1 | Each tab URL for a missing project shows «المشروع غير موجود أو لا تملك صلاحية عرضه» without the workspace frame | `page /projects/[id]/finance` | fail | #243; UI staff1 on /projects/99999999: summary, tasks, milestones, charter, finance, updates, meetings show «المشروع غير موجود أو لا تملك صلاحية عرضه»; schedule, stakeholders, raci and register show the generic «هذا السجل غير متاح أو لم يعد موجودًا.» and the schedule and raci keep their controls |

## Project policy settings

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PMO-436 | Settings opened by the system administrator | it_admin | The role set has no `pmo.settings.manage`, so the page is refused although the API text says "customer administrator" | `page /settings/apps/projects` | decision | #164; Owner to confirm whether `system_admin` should manage project policies |
| PMO-442 | Settings per company | ceo | A save in one company does not change the policies another company shows | `PATCH /api/v1/settings/projects` | planned | needs a second company with PMO settings rights: dammam_manager has no pmo.settings.manage; Needs a second company |
| PMO-445 | Copy while an end date is required | ceo | Copy of a source with no end date fails with 422 "An end date is required to create a project." | `POST /api/v1/projects/<id>/copy` | decision | #164; Owner to decide whether copy should be exempt |

## Charter catalogs (types and owning units)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |

## Capabilities

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PMO-494 | Branch scope of a grant | custom role (branch-scoped pmo grants) | Capability applies to projects of that branch's company only; other branches answer 404 | `cap pmo.projects.read` | planned | assigning a role with scope company 3 from the root admin answers 422 unsupported_scope; Not run: assigning a role with scope company 3 from the root admin answers 422 `unsupported_scope`; the Dammam manager (employee role in the branch) sees only the branch records; Needs a second company |

## Feature switch, tenant state and company boundary

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PMO-506 | Project settings page is fully Arabic | ceo | Every label in «الربط مع التطبيقات الأخرى» is Arabic | `page /settings/apps/projects` | fail | #138; Found 2026-10-28: «Cost centers of projects», its English description, «Automatic» and «Manual» are shown in the Arabic UI |
