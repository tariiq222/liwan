# Projects

Pages: `/projects`, `/projects/dashboard`, `/projects/new`, `/projects/[id]` with `charter`,
`milestones`, `tasks`, `schedule`, `stakeholders`, `raci`, `register`, `updates`, `meetings`,
`finance`, `settings`; `/tasks`, `/tasks/[id]`; settings `/settings/apps/projects`.
Owners: `webvue_pmo`, `webvue_pmo_finance`. Personas and status values: [README](README.md).

Capability note: `ceo` holds `pmo_manager`; `pm` gets project-manager rights only on projects
where they are the project manager; employees read projects and create/write tasks.

How to read the rows: a "refused" case names the HTTP status and error `code` the route answers
with. `ceo` is the global manager, `pm (own)` is `pm` on a project where `pm` is the manager,
`pm (other)` is `pm` on a project someone else manages. The Covers column lists the surfaces a row
exercises; `python3 -B tools/e2e_scenario_coverage.py --app webvue_pmo` reports what is still
missing. Project routes answer 404 `not_found` for a project of another company or one the caller
cannot read, and 403 `forbidden` when the caller can read it but lacks the capability.

## Projects, charter, phases

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PMO-01 | Create a project and a task, change the task state | admin | Saved, state changes | `page /projects/new` `POST /api/v1/projects` `page /projects/[id]/tasks/new` `POST /api/v1/tasks` `POST /api/v1/tasks/<id>/transition` | automated | `e2e/tests/pmo-journey.e2e.ts` |
| PMO-02 | Create a project with `pm` as manager | ceo | Saved; manager and end date required | `page /projects/new` `POST /api/v1/projects` | planned | |
| PMO-03 | Employee creates a project | staff1 | Refused unless `project_creators=employees` | `POST /api/v1/projects` `cap pmo.projects.create` | automated | `e2e/tests/access-matrix.e2e.ts`: refusal with the default policy only |
| PMO-04 | Setting `project_creators=employees` | ceo | staff1 can create | `PATCH /api/v1/settings/projects` `page /settings/apps/projects` | planned | |
| PMO-05 | Edit, archive, unarchive, copy a project | pm (own) | Allowed on own project; refused on another | `PATCH /api/v1/projects/<id>` `POST /api/v1/projects/<id>/archive` `POST /api/v1/projects/<id>/unarchive` `POST /api/v1/projects/<id>/copy` | planned | |
| PMO-06 | Set status on_track / at_risk / off_track / on_hold / done | pm | Saved; staff1 refused (`status_forbidden`) | `POST /api/v1/projects/<id>/status` | planned | |
| PMO-07 | Stages: add, rename, reorder, delete; delete non-empty | pm | Saved; non-empty refused `stage_not_empty` | `POST /api/v1/projects/<id>/stages` `PATCH /api/v1/projects/<id>/stages/<id>` `PUT /api/v1/projects/<id>/stages/order` `DELETE /api/v1/projects/<id>/stages/<id>` | planned | |
| PMO-08 | Milestones: create, edit, reached, delete; dates outside the project; delete with tasks | pm | Saved; out-of-range and `milestone_has_tasks` refused | `POST /api/v1/projects/<id>/milestones` `PATCH /api/v1/projects/<id>/milestones/<id>` `DELETE /api/v1/projects/<id>/milestones/<id>` `GET /api/v1/projects/<id>/milestones` | planned | |
| PMO-09 | Followers, stakeholders, RACI | pm | Saved; employee refused | `POST /api/v1/projects/<id>/followers` `POST /api/v1/projects/<id>/stakeholders` `POST /api/v1/projects/<id>/raci` | planned | |
| PMO-10 | Register: risk and issue open → in_progress → resolved → closed | pm | Each state saved | `POST /api/v1/projects/<id>/register` `PATCH /api/v1/projects/<id>/register/<id>` | planned | The route accepts any status jump, see PMO-273 |
| PMO-11 | Project updates and schedule with dependencies | pm | Saved; dependency order respected | `POST /api/v1/projects/<id>/updates` `GET /api/v1/projects/<id>/schedule` `PUT /api/v1/tasks/<id>/dependencies` | planned | |
| PMO-12 | Charter with approval off: submit | pm | Approved immediately | `POST /api/v1/projects/<id>/charter/submit` | planned | |
| PMO-13 | Charter with approval on: submit, sponsor approves | pm → ceo | `submitted` then `approved`; bell to sponsor and back | `POST /api/v1/projects/<id>/charter/submit` `POST /api/v1/projects/<id>/charter/approve` | planned | |
| PMO-14 | Sponsor returns the charter with a note | ceo | Back to draft; note required (1–2000) | `POST /api/v1/projects/<id>/charter/return` | planned | |
| PMO-15 | Edit a submitted charter; withdraw | pm | Edit refused until withdrawn | `POST /api/v1/projects/<id>/charter/withdraw` `PATCH /api/v1/projects/<id>` | planned | |
| PMO-16 | Non-sponsor approves | staff1 | Refused | `POST /api/v1/projects/<id>/charter/approve` | planned | |
| PMO-17 | Edit an approved charter when approval is required | pm | Charter reopened | `PATCH /api/v1/projects/<id>` | planned | |
| PMO-18 | Phases initiating → planning → executing → closing → closed | pm | One step at a time; planning needs an approved charter | `POST /api/v1/projects/<id>/phase` | planned | |
| PMO-19 | Catalogs: project types and owning units; delete one in use | ceo | Saved; in-use delete refused (409) | `POST /api/v1/project-charter/catalogs/<id>` `DELETE /api/v1/project-charter/catalogs/<id>/<id>` | planned | |
| PMO-20 | Archived projects list | ceo / pm | Global manager only | `GET /api/v1/projects` `page /projects` | planned | |

## Tasks and completion review

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PMO-30 | Create a task, assign, comment, mention, attach a file | pm, staff1 | Bell `assignment`, `comment`, `mention` to the right people | `POST /api/v1/tasks` `PATCH /api/v1/tasks/<id>` `POST /api/v1/tasks/<id>/comments` `POST /api/v1/tasks/<id>/attachments` | planned | |
| PMO-31 | Board view `?view=board` and back with filters kept | staff1 | Filters preserved in the URL | `page /tasks` `GET /api/v1/tasks` | planned | |
| PMO-32 | Archive a task as creator / as someone else | staff1 | Creator or approver only | `POST /api/v1/tasks/<id>/archive` | planned | |
| PMO-33 | Completion approval `none`: assignee sets done | staff1 | Done directly | `POST /api/v1/tasks/<id>/transition` | planned | |
| PMO-34 | Completion approval `project_manager`: request, PM accepts | staff1 → pm | Direct done refused; accepted by PM | `POST /api/v1/tasks/<id>/completion/request` `POST /api/v1/tasks/<id>/completion/accept` | planned | |
| PMO-35 | PM returns completion with a note; requester withdraws | pm, staff1 | Note required; withdraw by requester only | `POST /api/v1/tasks/<id>/completion/return` `POST /api/v1/tasks/<id>/completion/withdraw` | planned | |
| PMO-36 | Completion approval `specific_user` with an ineligible user | pm | Task shows `reviewer_ineligible` / `no_reviewer` | `GET /api/v1/tasks/<id>` | planned | |
| PMO-37 | Non-reviewer accepts | staff2 | Refused | `POST /api/v1/tasks/<id>/completion/accept` `cap pmo.tasks.approve` | planned | |
| PMO-38 | All tasks done → project done; reopen a task → status reverts | pm | Automatic both ways | `POST /api/v1/tasks/<id>/transition` `GET /api/v1/projects/<id>` | planned | |
| PMO-39 | Deadline reminder and overdue digest | pm | Bell `deadline`; digest after 09:00 opens `/notification-digests/[id]` | `page /notification-digests/[id]` `GET /api/v1/notification-digests/<id>` | planned | |

## Project finance

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PMO-50 | Budget and expense entries with finance off | pm | Saved; summary updated | `POST /api/v1/projects/<id>/finance` `GET /api/v1/projects/<id>/finance/summary` | planned | |
| PMO-51 | Manual expense with finance on | pm | Refused (costs come from the cost center) | `POST /api/v1/projects/<id>/finance` | planned | |
| PMO-52 | Link a cost center; one already linked; other company | cfo | Linked; `account_linked` (409); other company 422 | `PATCH /api/v1/projects/<id>/finance/actual-account` | planned | |
| PMO-53 | Cost center mode `auto` | cfo | New project gets a cost center when the creator may create one | `PATCH /api/v1/settings/projects` | planned | |

## Project list and dashboard

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PMO-54 | Open «كل المشاريع» with projects of several statuses | staff1 | Cards view by default (bare URL); count tag, KPI strip, one card per project with name, manager, status, progress | `page /projects` `GET /api/v1/projects` | planned | |
| PMO-55 | Switch to the table view | staff1 | URL gets `?view=table`; same rows as a table; refresh keeps the view; `?view=list` rewrites to `?view=table` | `page /projects` | planned | |
| PMO-56 | Search by name | staff1 | Debounced; URL gets `?q=`; list narrows; clear button empties it; refresh and back keep it | `page /projects` `GET /api/v1/projects` | planned | |
| PMO-57 | Filter by each status (on_track, at_risk, off_track, on_hold, done) and «غير محدد» | staff1 | URL `?status=`; only matching projects; `unset` shows projects never given a status | `page /projects` `GET /api/v1/projects` | planned | |
| PMO-58 | Sort by name and by «نسبة الإنجاز» | staff1 | `?sort=name` alphabetical, `?sort=progress` highest first with name tie-break, applied before paging | `page /projects` `GET /api/v1/projects` | planned | |
| PMO-59 | Paging of more than one page (offset step is the page size) | staff1 | Footer shows shown/total and page n of m; next page changes `?offset=`; a search resets the offset | `page /projects` | planned | |
| PMO-60 | No projects at all | staff1 | Empty state «لا مشاريع بعد» with its hint; create button only for those who may create | `page /projects` | planned | |
| PMO-61 | Filters match nothing | staff1 | Empty state «لا مشاريع تطابق الفلاتر»; «مسح الفلاتر» resets q, status and sort | `page /projects` | planned | |
| PMO-62 | «مشاريعي» entry (`?mine=1`) | pm | Heading becomes «مشاريعي»; only projects where pm is the manager | `page /projects` `GET /api/v1/projects` | planned | |
| PMO-63 | Open a project, press back | staff1 | Returns to `/projects` with the same filters, view and page | `page /projects` `page /projects/[id]` | planned | |
| PMO-64 | Open the page directly with a stale `?archived=1` link as an employee | staff1 | Scope switch is not shown; the active list is shown, not an empty table | `page /projects` `GET /api/v1/projects` | planned | |
| PMO-65 | Archived scope | ceo | Segmented control «النشطة» / «المؤرشفة» appears; archived rows shown; no KPI strip; empty state «لا مشاريع مؤرشفة» | `page /projects` `GET /api/v1/projects` | planned | |
| PMO-66 | Archived list requested by a project manager of one project only | pm | Scope switch hidden; the API answers 403 `forbidden` "Only a project manager can list archived projects." | `GET /api/v1/projects` | planned | `can_list_archived` follows the global manage capability, so pm (own) never sees it |
| PMO-67 | List query validation | ceo | Unknown parameter 400 `unsupported_filter`; bad `archived`, `mine`, `charter_review`, `sort` or `status` 422 `invalid`; `limit=0` or above 200 is capped to 200; negative limit or offset 422 | `GET /api/v1/projects` | planned | |
| PMO-68 | `minimal=1` list for pickers | staff1 | Returns only id and name of the readable projects (a bare array, not the `{items, total}` envelope) | `GET /api/v1/projects` | planned | Envelope exception, see report |
| PMO-69 | `charter_review=1` | ceo | Only projects whose charter is submitted and whose sponsor is the caller | `GET /api/v1/projects` | planned | |
| PMO-70 | Followers-only project in the list | staff2 | Hidden from non-followers, visible to followers, the manager and managers | `GET /api/v1/projects` | planned | |
| PMO-71 | List KPI strip follows the filters | staff1 | Counts reflect q, mine and status across all pages; hidden while the KPI toggle is off | `page /projects` `GET /api/v1/reports/projects/summary` | planned | |
| PMO-72 | Summary report validation | staff1 | Unknown parameter 400 `unsupported_filter`; bad `status`/`mine` 422 `invalid`; only active projects of the current company | `GET /api/v1/reports/projects/summary` | planned | |
| PMO-73 | Open «نظرة عامة على المشاريع» | ceo | Metrics, recent projects and charts for the visible projects; status filter and search kept in the URL | `page /projects/dashboard` `GET /api/v1/reports/projects/analytics` | planned | |
| PMO-74 | Dashboard with no matching projects | ceo | Empty state; with a filter active the «مسح الفلاتر» action resets it | `page /projects/dashboard` | planned | |
| PMO-75 | Dashboard analytics validation and task visibility | staff1 | Same query rules as the summary; a reader without `pmo.tasks.read` gets project figures without task counts | `GET /api/v1/reports/projects/analytics` `cap pmo.tasks.read` | planned | |
| PMO-76 | Pending charter reviews card | ceo | Lists the projects waiting for this sponsor; a click opens the project charter | `page /projects/dashboard` `GET /api/v1/projects` | planned | |
| PMO-77 | Dashboard error and retry | ceo | Failed analytics show an error state with a retry that reloads | `page /projects/dashboard` | planned | |

## Creating and copying a project

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PMO-78 | Create form for a project manager | ceo | `/projects/new` opens as the create panel; manager defaults to the caller; required marks follow the settings; Escape and cancel return to the list with filters | `page /projects/new` `GET /api/v1/settings/projects/create-defaults` | planned | |
| PMO-79 | Create succeeds | ceo | 201; project has a unique code, the default stages from settings, the default completion approval, privacy «employees»; user lands on the new project | `POST /api/v1/projects` `page /projects/[id]` | planned | |
| PMO-80 | Create with empty name | ceo | 422 `invalid` "name must not be empty" on `name` | `POST /api/v1/projects` | planned | |
| PMO-81 | Create with an unknown field | ceo | 422 `unknown_field` naming the field | `POST /api/v1/projects` | planned | |
| PMO-82 | Create without manager while `require_manager_on_create` is on | ceo | 422 `invalid` on `user_id` "manager is required to create a project" | `POST /api/v1/projects` | planned | |
| PMO-83 | Create without end date while `require_end_date_on_create` is on | ceo | 422 `invalid` on `date_end` "end date is required to create a project" | `POST /api/v1/projects` | planned | |
| PMO-84 | Create with both requirements switched off | ceo | Saved with no end date; manager may be empty only when `user_id` is sent as null | `POST /api/v1/projects` `PATCH /api/v1/settings/projects` | planned | |
| PMO-85 | Create with both `date` and `date_end` | ceo | 422 `invalid` "date and date_end cannot both be provided" | `POST /api/v1/projects` | planned | |
| PMO-86 | Create with start after end | ceo | 422 `invalid` "date_start must be on or before date" | `POST /api/v1/projects` | planned | |
| PMO-87 | Create with a manager who is inactive, external or in another company | ceo | 422 `invalid` on `user_id` | `POST /api/v1/projects` | planned | |
| PMO-88 | Create with a charter block (type, unit, sponsor, budget) | ceo | Charter fields saved in the same request; read-only charter keys (code, state, sponsor object) refused with `unknown_field` | `POST /api/v1/projects` | planned | |
| PMO-89 | Create with tags and the dependency toggle | ceo | Tags attached; unknown tag id 422 `invalid`; `allow_task_dependencies` must be a boolean | `POST /api/v1/projects` `GET /api/v1/tags` | planned | |
| PMO-90 | Employee creates when the policy is `employees` | staff1 | 201; the employee becomes the manager; defaults still apply | `POST /api/v1/projects` `cap pmo.projects.create` | planned | |
| PMO-91 | Employee creates when the policy is `managers` | staff1 | 403 `create_forbidden` "You are not allowed to create projects."; the create link is absent in the list | `POST /api/v1/projects` `page /projects/new` | planned | |
| PMO-92 | Open `/projects/new` directly as an employee under policy `managers` | staff1 | Page shows no form (no create right); back link returns to the list | `page /projects/new` `GET /api/v1/settings/projects/create-defaults` | planned | |
| PMO-93 | Create-defaults route refuses someone who cannot create | staff1 | 403 `forbidden` "You are not allowed to create projects." | `GET /api/v1/settings/projects/create-defaults` | planned | |
| PMO-94 | Project quota reached | ceo | 403 `feature_not_included` with limit `projects.max_projects` when the tenant limit is reached | `POST /api/v1/projects` | planned | Needs a tenant profile with a small limit |
| PMO-95 | Copy form from a project | ceo | «نسخ المشروع» appears only for someone who can create and read tasks; name defaults to «<name> (نسخة)» | `page /projects/[id]` `page /projects/new` | planned | |
| PMO-96 | Copy succeeds | ceo | 201; stages, milestones, top-level active tasks, dependencies, tags, type and unit copied; dates shifted to the new start; assignees, followers, state, finance not copied | `POST /api/v1/projects/<id>/copy` | planned | |
| PMO-97 | Copy validation | ceo | Name empty or over 255 chars, bad or non-ISO `start_date`, unknown field, non-object body: 422 `invalid`/`unknown_field` | `POST /api/v1/projects/<id>/copy` | planned | |
| PMO-98 | Copy of a project above the limits | ceo | 422 `invalid` when it has more than 500 top-level tasks or 100 milestones | `POST /api/v1/projects/<id>/copy` | planned | |
| PMO-99 | Copy refused without the rights | staff1 | 403 `forbidden` when the caller may not create projects or cannot read tasks | `POST /api/v1/projects/<id>/copy` `cap pmo.projects.create` | planned | |
| PMO-100 | Copy of an invisible project | staff2 | 404 `not_found`; the copy link on the source summary is hidden when the caller cannot create | `POST /api/v1/projects/<id>/copy` | planned | |
| PMO-101 | Copy keeps dependencies only when the source allows them | ceo | A source with dependencies switched off copies no links | `POST /api/v1/projects/<id>/copy` | planned | |

## Project summary, edit, archive, status

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PMO-102 | Open a project summary | staff1 | Frame shows name, status, phase, manager and dates; tabs «الملخص», «المهام», «التخطيط», «الحوكمة», «المالية», «التحديثات»; phase stepper card; overview tiles | `page /projects/[id]` `GET /api/v1/projects/<id>` | planned | |
| PMO-103 | Settings gear and copy link by role | pm | Gear «إعدادات المشروع» only when `can_manage`; staff1 sees neither gear nor edit actions | `page /projects/[id]` | planned | |
| PMO-104 | Open a missing or foreign-company project id | staff1 | Page shows «المشروع غير موجود أو لا تملك صلاحية عرضه» with a back button; API 404 `not_found` | `page /projects/[id]` `GET /api/v1/projects/<id>` | planned | |
| PMO-105 | Open a followers-only project as a non-follower | staff2 | Same not-found page, nothing leaks about the project | `GET /api/v1/projects/<id>` | planned | |
| PMO-106 | Reader without `pmo.projects.read` | custom role (tasks read only) | `/api/v1/projects` and project pages answer 403 `forbidden`; the Projects tabs other than tasks are hidden | `GET /api/v1/projects/<id>` `cap pmo.projects.read` | planned | |
| PMO-107 | Back from the summary keeps its origin | staff1 | Back control returns to the list or dashboard the user came from, with its filters | `page /projects/[id]` | planned | |
| PMO-108 | Archived project workspace | ceo | «المهام» and «الحوكمة» tabs and the milestones planning tab are hidden; no governance sub-strip | `page /projects/[id]` `POST /api/v1/projects/<id>/archive` | planned | |
| PMO-109 | Open project settings | pm (own) | Settings page with the general form, followers, stages and completion policy | `page /projects/[id]/settings` | planned | |
| PMO-110 | Open project settings without manage rights | staff1 | Page shows «لا تملك صلاحية إدارة هذا المشروع» and no form | `page /projects/[id]/settings` | planned | |
| PMO-111 | Edit name, description, manager, dates, visibility | pm (own) | Saved with the write token; `description` must be a string; visibility only `employees` or `followers`; revision bumps | `PATCH /api/v1/projects/<id>` | planned | |
| PMO-112 | Edit with no fields | pm (own) | 422 `invalid` "no fields to update" | `PATCH /api/v1/projects/<id>` | planned | |
| PMO-113 | Edit with an unknown or read-only field | pm (own) | 422 `unknown_field` naming the field | `PATCH /api/v1/projects/<id>` | planned | |
| PMO-114 | Edit with empty name, bad date, start after end | pm (own) | 422 `invalid` on the field; start after end names `date_start` | `PATCH /api/v1/projects/<id>` | planned | |
| PMO-115 | Change manager to an ineligible user | pm (own) | 422 `invalid` on `user_id`; a manager who is not the project manager anymore loses contextual rights on reload | `PATCH /api/v1/projects/<id>` | planned | |
| PMO-116 | Shrink project dates around a milestone or a task | pm (own) | 422 `invalid` "Milestone deadline must be on or before the project end date" (or the start-date variant) | `PATCH /api/v1/projects/<id>` | planned | |
| PMO-117 | Stale edit with an old token | pm (own) | 409 `stale_write` on `expected_updated_at`; the form tells the user the project changed | `PATCH /api/v1/projects/<id>` | planned | Two sessions of the same manager |
| PMO-118 | Malformed write token | pm (own) | 422 `invalid` "expected_updated_at is not a valid write token" | `PATCH /api/v1/projects/<id>` | planned | |
| PMO-119 | Employee edits a project | staff1 | 403 `forbidden` "Only the project manager can change this project." | `PATCH /api/v1/projects/<id>` `cap pmo.projects.manage` | planned | |
| PMO-120 | Set the dependency toggle | pm (own) | `allow_task_dependencies` boolean saved; a non-boolean is 422; turning it off keeps stored links hidden from the picker | `PATCH /api/v1/projects/<id>` | planned | |
| PMO-121 | Set tags on a project | pm (own) | Existing tags attach; an unknown tag id is 422 `invalid` "unknown tag id" | `PATCH /api/v1/projects/<id>` `GET /api/v1/tags` | planned | |
| PMO-122 | Change completion approval to `specific_user` with a valid approver | pm (own) | Saved; pending completion requests are invalidated | `PATCH /api/v1/projects/<id>` | planned | |
| PMO-123 | `specific_user` without an approver, or an approver without approve rights or who cannot see the project | pm (own) | 422 `invalid` "A specific approver is required." / "The selected approver must already have approval capability." / "The selected approver cannot see this project." | `PATCH /api/v1/projects/<id>` | planned | |
| PMO-124 | Approver set while the mode is not `specific_user`, or an inactive or external approver | pm (own) | 422 `invalid` "A specific approver is only valid for specific_user mode." / on `webvue_completion_approver_id` "must be an active internal user" | `PATCH /api/v1/projects/<id>` | planned | |
| PMO-125 | Archive a project | pm (own) | Inline confirmation «أرشفة المشروع؟»; project leaves the active list; pending completion requests invalidated; quota slot freed | `POST /api/v1/projects/<id>/archive` | planned | |
| PMO-126 | Archive as an employee | staff1 | 403 `forbidden` | `POST /api/v1/projects/<id>/archive` | planned | |
| PMO-127 | Unarchive a project | ceo | Project returns to the active list and keeps its tasks; counts against the quota again | `POST /api/v1/projects/<id>/unarchive` | planned | |
| PMO-128 | Unarchive as an employee, or past the project quota | staff1 | 403 `forbidden`; with the quota full 403 `feature_not_included` | `POST /api/v1/projects/<id>/unarchive` | planned | |
| PMO-129 | Set each of the five statuses | pm (own) | Saved as a project update row; the status tag in the frame changes; a manual choice clears automatic completion bookkeeping | `POST /api/v1/projects/<id>/status` | planned | |
| PMO-130 | Set an unknown status | pm (own) | 422 `invalid_status` "status must be one of …" on `status` (`to_define` and `unset` are not settable) | `POST /api/v1/projects/<id>/status` | planned | |
| PMO-131 | Set status as an employee | staff1 | 403 `status_forbidden` "Only a project manager can set the project status." | `POST /api/v1/projects/<id>/status` | planned | |
| PMO-132 | Set status `done` by hand while tasks are open | pm (own) | Accepted; no gate on open tasks; later task changes do not revert a manual done | `POST /api/v1/projects/<id>/status` | planned | |
| PMO-133 | Archive, status and edit on a project of another company | pm (other) | 404 `not_found` with the same wording as a missing id | `POST /api/v1/projects/<id>/status` `POST /api/v1/projects/<id>/archive` | planned | |

## Charter content

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PMO-134 | Open the charter read-only | staff1 | `/projects/[id]/charter` shows the state badge (مسودة / بانتظار الاعتماد / معتمد) and all sections; no edit button | `page /projects/[id]/charter` | planned | |
| PMO-135 | Open the charter as the manager | pm (own) | «متابعة المسودة» (draft) or «تعديل» button opens `?edit=1` | `page /projects/[id]/charter` | planned | |
| PMO-136 | Charter wizard steps follow the project type | pm (own) | Basics and review always; justification, scope, schedule, budget, risks only as the type lists them | `page /projects/[id]/charter` `GET /api/v1/project-charter/catalogs/<id>` | planned | |
| PMO-137 | Save the charter as a draft | pm (own) | Toast «حُفظ الميثاق كمسودة»; state stays draft; revision bumps | `PATCH /api/v1/projects/<id>` | planned | |
| PMO-138 | Charter save without a write token | pm (own) | 422 `invalid` on `expected_updated_at` "is required when charter is present" | `PATCH /api/v1/projects/<id>` | planned | |
| PMO-139 | Charter text fields | pm (own) | Authority, rationale, benefits, scope, exclusions, requirements, success, assumptions, constraints, closure accept strings; a non-string is 422 `invalid` on the field | `PATCH /api/v1/projects/<id>` | planned | |
| PMO-140 | Objectives and deliverables rows | pm (own) | Rows need exactly goal/metric/target and name/description/acceptance, all strings, at least one non-blank; otherwise 422 `invalid` on the list | `PATCH /api/v1/projects/<id>` | planned | |
| PMO-141 | Priority values | pm (own) | low, normal, high, critical or null; anything else 422 `invalid` | `PATCH /api/v1/projects/<id>` | planned | |
| PMO-142 | Budget state and amount | pm (own) | `unknown` forces amount 0; `estimate` needs a non-negative amount; negative, NaN, string or boolean amount 422; amount alone on an unknown budget 422 "changing an unknown budget requires budget_state" | `PATCH /api/v1/projects/<id>` | planned | |
| PMO-143 | Type and owning unit references | pm (own) | Active values of the current company accepted; inactive, foreign-company or unknown id 422 `invalid`; an already assigned inactive value is kept | `PATCH /api/v1/projects/<id>` `GET /api/v1/project-charter/catalogs/<id>` | planned | |
| PMO-144 | Sponsor reference | pm (own) | Active internal user of the company; otherwise 422 `invalid` on `sponsor_id` | `PATCH /api/v1/projects/<id>` | planned | |
| PMO-145 | Charter defaults route | pm (own) | Returns the company currency; a caller with none of read, create or settings rights gets 403 | `GET /api/v1/project-charter/defaults` | planned | |
| PMO-146 | Charter currency and amount display | staff1 | Amount shown with the company currency; unknown budget shows no amount | `page /projects/[id]/charter` `GET /api/v1/project-charter/defaults` | planned | |
| PMO-147 | Cancel charter edit | pm (own) | Returns to the read-only charter; nothing saved | `page /projects/[id]/charter` | planned | |
| PMO-148 | Charter milestones panel | staff1 | The charter lists the project milestones, with loading and retry states | `page /projects/[id]/charter` `GET /api/v1/projects/<id>/milestones` | planned | |

## Charter approval workflow

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PMO-149 | Submit with approval off | pm (own) | State goes draft → approved at once; submitter recorded as approver; no bell | `POST /api/v1/projects/<id>/charter/submit` | planned | |
| PMO-150 | Submit with approval on and a sponsor | pm (own) | State `submitted`; banner «بانتظار …»; bell `charter_review` to the sponsor | `POST /api/v1/projects/<id>/charter/submit` | planned | |
| PMO-151 | Submit when the manager is the sponsor | ceo | Approved at once even with approval on | `POST /api/v1/projects/<id>/charter/submit` | planned | |
| PMO-152 | Submit with approval on and no sponsor, or a sponsor who cannot open projects | pm (own) | 422 `invalid` on `sponsor_id` "Choose a sponsor who can open projects before submitting the charter." | `POST /api/v1/projects/<id>/charter/submit` | planned | |
| PMO-153 | Submit to a sponsor of a followers-only project | pm (own) | Sponsor is added as follower so they can read it | `POST /api/v1/projects/<id>/charter/submit` | planned | |
| PMO-154 | Submit an already submitted or approved charter | pm (own) | 409 `charter_state` "The charter is not in the expected state." | `POST /api/v1/projects/<id>/charter/submit` | planned | |
| PMO-155 | Submit by someone who does not manage the project | staff1 | 403 `forbidden` | `POST /api/v1/projects/<id>/charter/submit` | planned | |
| PMO-156 | Sponsor approves | ceo | State approved; approver and time shown «اعتمده … في …»; bell `charter_approved` to the submitter | `POST /api/v1/projects/<id>/charter/approve` | planned | |
| PMO-157 | Approve a charter that is not submitted | ceo | 409 `charter_state` | `POST /api/v1/projects/<id>/charter/approve` | planned | |
| PMO-158 | Approve by a manager who is not the sponsor | pm (own) | 403 `forbidden` "Only the project sponsor can review the charter." | `POST /api/v1/projects/<id>/charter/approve` | planned | |
| PMO-159 | Sponsor returns with a note | ceo | Back to draft with the note in the «أعاد الراعي الميثاق للتعديل» banner; bell `charter_returned` carrying the note | `POST /api/v1/projects/<id>/charter/return` | planned | |
| PMO-160 | Return with empty, blank or over-2000-character note | ceo | 422 `invalid` on `note` ("note is required" / "A return note of 1 to 2000 characters is required.") | `POST /api/v1/projects/<id>/charter/return` | planned | |
| PMO-161 | Return button stays disabled until a note is typed | ceo | Confirm button disabled while the note is blank | `page /projects/[id]/charter` | planned | |
| PMO-162 | Manager withdraws a submitted charter | pm (own) | Inline confirmation «سحب الطلب وإعادة الميثاق مسودة؟»; state back to draft | `POST /api/v1/projects/<id>/charter/withdraw` | planned | |
| PMO-163 | Withdraw a charter that is not submitted | pm (own) | 409 `charter_state` | `POST /api/v1/projects/<id>/charter/withdraw` | planned | |
| PMO-164 | Charter action with a stale token | pm (own) | 409 `stale_write` on all four actions; panel shows a warning and reloads | `POST /api/v1/projects/<id>/charter/withdraw` | planned | |
| PMO-165 | Charter action with a bad body | ceo | Unknown key 422 `unknown_field`; missing or malformed token 422 `invalid` | `POST /api/v1/projects/<id>/charter/return` | planned | |
| PMO-166 | Sponsor cannot see the project any more | ceo | Approve and return answer 403/404 rather than succeeding; the dashboard card drops the project | `POST /api/v1/projects/<id>/charter/approve` | planned | |
| PMO-167 | Edit charter content while submitted | pm (own) | 409 `charter_state` "The charter is waiting for approval; withdraw it to edit."; an edit that changes nothing is accepted | `PATCH /api/v1/projects/<id>` | planned | |
| PMO-168 | Swap the sponsor while submitted | pm (own) | Refused like any charter content change, so a manager cannot self-approve | `PATCH /api/v1/projects/<id>` | planned | |
| PMO-169 | Edit an approved charter with approval on | pm (own) | State resets to draft, approver cleared; toast «تغيّر الميثاق المعتمد فعاد مسودة» | `PATCH /api/v1/projects/<id>` | planned | |
| PMO-170 | Edit an approved charter with approval off | pm (own) | State stays approved | `PATCH /api/v1/projects/<id>` | planned | |
| PMO-171 | Remove the sponsor from the followers while the charter waits on a followers-only project | pm (own) | 409 `charter_state` "The sponsor is reviewing the charter; withdraw it before removing the sponsor." | `DELETE /api/v1/projects/<id>/followers/<id>` | planned | |
| PMO-172 | Turn a project private while the charter waits | pm (own) | Sponsor is added as follower so the review stays possible | `PATCH /api/v1/projects/<id>` | planned | |
| PMO-173 | Charter approval panel for a read-only viewer | staff1 | Sees the waiting banner but no approve, return or withdraw buttons | `page /projects/[id]/charter` | planned | |

## Phases

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PMO-174 | Phase stepper and gate card | pm (own) | Stepper البدء → التخطيط → التنفيذ → الإغلاق → مغلق; gate card lists «اعتماد الميثاق» as met or unmet | `page /projects/[id]` | planned | |
| PMO-175 | Move to planning with an approved charter | pm (own) | Phase becomes `planning`; revision bumps; button «الانتقال إلى التخطيط» | `POST /api/v1/projects/<id>/phase` | planned | |
| PMO-176 | Move to planning without an approved charter | pm (own) | 409 `phase_gate` with `details.checks` listing `charter_approved` not ok; the gate card offers «استكمال» | `POST /api/v1/projects/<id>/phase` | planned | |
| PMO-177 | Skip a phase | pm (own) | 409 `phase_step` "A project moves one phase at a time." | `POST /api/v1/projects/<id>/phase` | planned | |
| PMO-178 | Move executing → closing → closed | pm (own) | Each forward step accepted with no gate; at `closed` the notice «المشروع مغلق» replaces the forward button | `POST /api/v1/projects/<id>/phase` | decision | Closing and closed have no gate (open tasks, pending completion): owner choice |
| PMO-179 | Step back one phase | pm (own) | Inline confirmation «الرجوع إلى مرحلة …؟»; phase moves back without a gate check | `POST /api/v1/projects/<id>/phase` | planned | |
| PMO-180 | Move to the current phase or to an unknown phase | pm (own) | Current phase 409 `phase_step`; unknown value 422 `invalid` on `phase` | `POST /api/v1/projects/<id>/phase` | planned | |
| PMO-181 | Phase change with a stale token | pm (own) | 409 `stale_write`; UI says «تغيّر المشروع أثناء الانتقال» | `POST /api/v1/projects/<id>/phase` | planned | |
| PMO-182 | Phase change by an employee | staff1 | 403 `forbidden`; no phase buttons are drawn | `POST /api/v1/projects/<id>/phase` | planned | |
| PMO-183 | Phase body validation | pm (own) | Unknown key 422 `unknown_field`; missing token 422 `invalid` | `POST /api/v1/projects/<id>/phase` | planned | |

## Stages and followers

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PMO-184 | Add a stage | pm (own) | 201 with sequence after the last; appears as a board column | `POST /api/v1/projects/<id>/stages` | planned | |
| PMO-185 | Add a stage with an empty name or non-boolean fold | pm (own) | 422 `invalid` on `name` / `fold` | `POST /api/v1/projects/<id>/stages` | planned | |
| PMO-186 | Rename a stage and fold it | pm (own) | Saved; folded stage is collapsed in the board | `PATCH /api/v1/projects/<id>/stages/<id>` | planned | |
| PMO-187 | Patch a stage with nothing, or a stage of another project | pm (own) | 422 `invalid` "no fields to update" / "stage_id must be one of the project's stages" | `PATCH /api/v1/projects/<id>/stages/<id>` | planned | |
| PMO-188 | Reorder stages | pm (own) | Keyboard and drag reorder; ids must be a permutation of the project's stages, otherwise 422 `invalid` on `ids` | `PUT /api/v1/projects/<id>/stages/order` | planned | |
| PMO-189 | Delete an empty stage | pm (own) | Inline confirmation «حذف هذه المرحلة؟»; 204; a stage shared with other projects is only detached | `DELETE /api/v1/projects/<id>/stages/<id>` | planned | |
| PMO-190 | Delete a stage that still holds tasks | pm (own) | 422 `stage_not_empty` "This stage still holds N task(s)."; counts include tasks the caller cannot see | `DELETE /api/v1/projects/<id>/stages/<id>` | planned | |
| PMO-191 | Stage edits by an employee | staff1 | 403 `forbidden` on add, rename, reorder and delete | `POST /api/v1/projects/<id>/stages` | planned | |
| PMO-192 | List followers | staff1 | Project followers sorted by name; empty state «لا متابعين بعد» | `GET /api/v1/projects/<id>/followers` | planned | |
| PMO-193 | Add a follower | pm (own) | Follower listed; a followers-only project becomes visible to them | `POST /api/v1/projects/<id>/followers` | planned | |
| PMO-194 | Add an inactive, external or unknown user as follower | pm (own) | 422 `invalid` on `user_id` "must be an active internal user" | `POST /api/v1/projects/<id>/followers` | planned | |
| PMO-195 | Remove a follower | pm (own) | Inline confirmation «إزالة … من المتابعين؟»; follower gone | `DELETE /api/v1/projects/<id>/followers/<id>` | planned | |
| PMO-196 | Follower changes by an employee | staff1 | 403 `forbidden` on add and remove | `POST /api/v1/projects/<id>/followers` | planned | |

## Milestones

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PMO-197 | Milestones list | staff1 | `/projects/[id]/milestones` lists milestones ordered by deadline with undated ones last; with progress; empty state «لا معالم بعد» | `page /projects/[id]/milestones` `GET /api/v1/projects/<id>/milestones` | planned | |
| PMO-198 | New milestone button by role | pm (own) | «معلم جديد» only for managers; employee sees none | `page /projects/[id]/milestones/new` | planned | |
| PMO-199 | Create a milestone | pm (own) | 201; milestones are enabled on the project automatically | `POST /api/v1/projects/<id>/milestones` | planned | |
| PMO-200 | Create with an empty name, bad date or bad deliverables | pm (own) | 422 `invalid` on `name`, `deadline`, `start_date` or `deliverables` | `POST /api/v1/projects/<id>/milestones` | planned | |
| PMO-201 | Deliverable rows | pm (own) | Each row exactly name (non-empty) and done (boolean); otherwise 422 `invalid` on `deliverables` | `PATCH /api/v1/projects/<id>/milestones/<id>` | planned | |
| PMO-202 | Milestone dates versus the project | pm (own) | Start after deadline, or a date before the project start or after the project end: 422 `invalid` with the matching message | `POST /api/v1/projects/<id>/milestones` | planned | |
| PMO-203 | Milestone dates versus its tasks | pm (own) | Shrinking a milestone around a linked task (planned start or deadline): 422 `invalid` | `PATCH /api/v1/projects/<id>/milestones/<id>` | planned | |
| PMO-204 | Open a milestone | staff1 | `/projects/[id]/milestones/[id]` shows dates, deliverables and linked tasks | `page /projects/[id]/milestones/[id]` | planned | |
| PMO-205 | Edit a milestone | pm (own) | `/projects/[id]/milestones/[id]/edit` saves; unknown field 422 `unknown_field`; empty body 422 "no fields to update"; non-boolean `is_reached` 422 | `page /projects/[id]/milestones/[id]/edit` `PATCH /api/v1/projects/<id>/milestones/<id>` | planned | |
| PMO-206 | Mark a milestone reached and unreached | pm (own) | `is_reached` toggles; the list state «تم» follows | `PATCH /api/v1/projects/<id>/milestones/<id>` | planned | |
| PMO-207 | Create form route | pm (own) | `/projects/[id]/milestones/new` opens as the create panel and returns to the list | `page /projects/[id]/milestones/new` | planned | |
| PMO-208 | Delete a milestone without tasks | pm (own) | Inline confirmation; 204 | `DELETE /api/v1/projects/<id>/milestones/<id>` | planned | |
| PMO-209 | Delete a milestone with tasks | pm (own) | 422 `milestone_has_tasks` "N task(s) are linked to this milestone." | `DELETE /api/v1/projects/<id>/milestones/<id>` | planned | |
| PMO-210 | Milestone of another project | pm (own) | 422 `invalid` on `milestone_id` "milestone must belong to this project" (no 403 existence leak) | `PATCH /api/v1/projects/<id>/milestones/<id>` | planned | |
| PMO-211 | Milestone changes by an employee | staff1 | 403 `forbidden` on create, patch and delete | `POST /api/v1/projects/<id>/milestones` | planned | |
| PMO-212 | Milestones of an archived project | ceo | Planning tab «المعالم» is hidden; reading the list still works | `GET /api/v1/projects/<id>/milestones` | planned | |

## Schedule and dependencies

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PMO-213 | Open the schedule | staff1 | `/projects/[id]/schedule` shows the Gantt, week or month scale, today line, milestones row; empty state when no tasks have dates | `page /projects/[id]/schedule` `GET /api/v1/projects/<id>/schedule` | planned | |
| PMO-214 | Schedule scale switch | staff1 | «أسبوعي» / «شهري»; a long project groups columns and says so | `page /projects/[id]/schedule` | planned | |
| PMO-215 | Tasks without dates | staff1 | Listed under «بلا تواريخ»; end-only tasks show «ينتهي في …» | `page /projects/[id]/schedule` | planned | |
| PMO-216 | Archived project schedule | ceo | API answers 404 `not_found` "Project does not exist." | `GET /api/v1/projects/<id>/schedule` | planned | |
| PMO-217 | Schedule shows only visible dependencies | staff1 | Dependency ids the caller cannot read are left out | `GET /api/v1/projects/<id>/schedule` | planned | |
| PMO-218 | Set start and end of a task | pm (own) | Both saved; deadline is set to the end date; a bell-free write | `PATCH /api/v1/projects/<id>/schedule/tasks/<id>` | planned | |
| PMO-219 | Schedule with one date, a bad format, unknown key | pm (own) | 422 `invalid` "start and end are required" / "must be a YYYY-MM-DD date" / `unknown_field` | `PATCH /api/v1/projects/<id>/schedule/tasks/<id>` | planned | |
| PMO-220 | Schedule start after end, or outside milestone and project bounds | pm (own) | 422 `invalid` with the matching message | `PATCH /api/v1/projects/<id>/schedule/tasks/<id>` | planned | |
| PMO-221 | Clear a task schedule | pm (own) | Start and end both null clears the planned start and the deadline | `PATCH /api/v1/projects/<id>/schedule/tasks/<id>` | planned | |
| PMO-222 | Schedule a task of another project | pm (own) | 404 `not_found` "Task does not exist in this project." | `PATCH /api/v1/projects/<id>/schedule/tasks/<id>` | planned | |
| PMO-223 | Schedule edit by an employee | staff1 | 403 `forbidden` "Only the project manager can change task scheduling."; the editor is read-only | `PATCH /api/v1/projects/<id>/schedule/tasks/<id>` | planned | |
| PMO-224 | Dependencies panel of a task | staff1 | Lists prerequisites with states; `enabled` follows the project toggle | `GET /api/v1/tasks/<id>/dependencies` | planned | |
| PMO-225 | Dependency candidates | pm (own) | Tasks of the same project except itself, name search, paged; unknown parameter 400 `unsupported_filter` | `GET /api/v1/tasks/<id>/dependencies/candidates` | planned | |
| PMO-226 | Replace the prerequisites | pm (own) | Set saved; the schedule draws the links | `PUT /api/v1/tasks/<id>/dependencies` | planned | |
| PMO-227 | Dependencies body validation | pm (own) | Non-list, non-positive, boolean or duplicate ids: 422 `invalid` on `ids` | `PUT /api/v1/tasks/<id>/dependencies` | planned | |
| PMO-228 | Dependencies refused by project rules | pm (own) | 422 `invalid` for: toggle off with ids, itself, a task of another project, an inactive task, a cycle | `PUT /api/v1/tasks/<id>/dependencies` | planned | |
| PMO-229 | Dependency changes by an employee | staff1 | 403 `forbidden` "Only the project manager can change task dependencies."; `can_manage` false in the panel | `PUT /api/v1/tasks/<id>/dependencies` | planned | |

## Updates

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PMO-230 | Updates list | staff1 | `/projects/[id]/updates` shows the latest 50, newest first, author and status; empty state «لا تحديثات بعد» | `page /projects/[id]/updates` `GET /api/v1/projects/<id>/updates` | planned | |
| PMO-231 | Publish an update | pm (own) | `/projects/[id]/updates/new` opens as the create panel; toast «تم نشر التحديث»; the update carries the current status unchanged | `page /projects/[id]/updates/new` `POST /api/v1/projects/<id>/updates` | planned | |
| PMO-232 | Update with a status or an empty title | pm (own) | 422 `invalid` on `status` ("status is set in project settings") / on `name` | `POST /api/v1/projects/<id>/updates` | planned | |
| PMO-233 | Update by an employee | staff1 | 403 `status_forbidden`; no publish button | `POST /api/v1/projects/<id>/updates` | planned | |
| PMO-234 | Automatic updates | pm (own) | A status change and the automatic "all tasks are complete" completion appear in the list | `GET /api/v1/projects/<id>/updates` | planned | |
| PMO-235 | Long update text | staff1 | «عرض المزيد» / «عرض أقل» toggles the body | `page /projects/[id]/updates` | planned | |

## Stakeholders

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PMO-236 | Stakeholders list | staff1 | `/projects/[id]/stakeholders` lists name, organization, role, contact ordered by name; search by name, organization, role or contact; paged | `page /projects/[id]/stakeholders` `GET /api/v1/projects/<id>/stakeholders` | planned | |
| PMO-237 | Stakeholders list query validation | staff1 | Unknown parameter 400 `unsupported_filter`; negative limit or offset 422; limit capped at 200 | `GET /api/v1/projects/<id>/stakeholders` | planned | |
| PMO-238 | Empty stakeholders | pm (own) | Empty state with an add action; employee sees no add action | `page /projects/[id]/stakeholders` | planned | |
| PMO-239 | Open a stakeholder | staff1 | Detail page with all fields; a stakeholder of another project answers 404 `not_found` "governance record not found" | `page /projects/[id]/stakeholders/[id]` `GET /api/v1/projects/<id>/stakeholders/<id>` | planned | |
| PMO-240 | Create a stakeholder | pm (own) | `/projects/[id]/stakeholders/new` saves; 201; may link an internal user | `page /projects/[id]/stakeholders/new` `POST /api/v1/projects/<id>/stakeholders` | planned | |
| PMO-241 | Create with empty name, non-string text, unknown field | pm (own) | 422 `invalid` on the field / `unknown_field` | `POST /api/v1/projects/<id>/stakeholders` | planned | |
| PMO-242 | Link a stakeholder to an inactive, external or other-company user | pm (own) | 422 `invalid` on `user_id` "must be an active internal user in the current company" | `POST /api/v1/projects/<id>/stakeholders` | planned | |
| PMO-243 | Edit a stakeholder | pm (own) | `/projects/[id]/stakeholders/[id]/edit` saves; empty patch 422 "no fields to update" | `page /projects/[id]/stakeholders/[id]/edit` `PATCH /api/v1/projects/<id>/stakeholders/<id>` | planned | |
| PMO-244 | Delete a stakeholder with no RACI rows | pm (own) | Inline confirmation; 204 | `DELETE /api/v1/projects/<id>/stakeholders/<id>` | planned | |
| PMO-245 | Delete a stakeholder used in the RACI matrix | pm (own) | 409 `stakeholder_assigned` "Remove this stakeholder's RACI assignments first." | `DELETE /api/v1/projects/<id>/stakeholders/<id>` | planned | |
| PMO-246 | Stakeholder changes by an employee | staff1 | 403 `forbidden` on create, patch and delete; edit and add controls absent | `POST /api/v1/projects/<id>/stakeholders` | planned | |
| PMO-247 | Stakeholders of an archived project | ceo | All governance routes answer 404 `not_found` | `GET /api/v1/projects/<id>/stakeholders` | planned | |

## RACI

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PMO-248 | Open the RACI matrix | staff1 | `/projects/[id]/raci` shows tasks as rows and stakeholders as columns with R/A/C/I cells and the legend; tasks and stakeholders paged separately | `page /projects/[id]/raci` `GET /api/v1/projects/<id>/raci` | planned | |
| PMO-249 | RACI filters | staff1 | Task and stakeholder search; open/closed task scope; at most 50 task ids and 10 stakeholder ids in a request, else 422 `invalid` "too many matrix ids" | `GET /api/v1/projects/<id>/raci` | planned | |
| PMO-250 | RACI with no tasks or no stakeholders | pm (own) | Empty state explains which is missing, with links to the tasks or «إضافة صاحب مصلحة» | `page /projects/[id]/raci` | planned | |
| PMO-251 | Assign a role in a cell | pm (own) | 201 with role R, A, C or I; the cell updates | `POST /api/v1/projects/<id>/raci` | planned | |
| PMO-252 | Assignment missing a field or with a bad role | pm (own) | 422 `invalid` "task_id, stakeholder_id and role are required" / "role must be R, A, C or I" | `POST /api/v1/projects/<id>/raci` | planned | |
| PMO-253 | Assign with a task or stakeholder of another project | pm (own) | 422 `invalid` "task_id must belong to this project" (or stakeholder_id) | `POST /api/v1/projects/<id>/raci` | planned | |
| PMO-254 | Second row for the same task and stakeholder | pm (own) | 422 `invalid` "Each task/stakeholder pair must be unique and each task permits only one A." | `POST /api/v1/projects/<id>/raci` | planned | |
| PMO-255 | Two accountable stakeholders on one task | pm (own) | The second A is refused with the same 422 message | `PATCH /api/v1/projects/<id>/raci/<id>` | planned | |
| PMO-256 | Change a role | pm (own) | Role updated; moving A away frees the accountable slot | `PATCH /api/v1/projects/<id>/raci/<id>` | planned | |
| PMO-257 | Remove a RACI row | pm (own) | Inline confirmation; 204; unknown row 404 `not_found` | `DELETE /api/v1/projects/<id>/raci/<id>` | planned | |
| PMO-258 | RACI changes by an employee | staff1 | 403 `forbidden`; cells are read-only | `POST /api/v1/projects/<id>/raci` | planned | |
| PMO-259 | RACI hides tasks the caller cannot read | staff2 | Rows for unreadable tasks are not listed and not counted | `GET /api/v1/projects/<id>/raci` | planned | |

## Risk and issue register

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PMO-260 | Register list | staff1 | `/projects/[id]/register` lists risks and issues with kind, priority, status, score, owner, due date; paged | `page /projects/[id]/register` `GET /api/v1/projects/<id>/register` | planned | |
| PMO-261 | Register filters | staff1 | kind (risk or issue), status, priority and search in title, description and response; an unknown value is 422 `invalid`; unknown parameter 400 `unsupported_filter` | `GET /api/v1/projects/<id>/register` | planned | |
| PMO-262 | Register order puts critical items first | staff1 | Items sort by severity: critical, high, normal, low, then due date | `GET /api/v1/projects/<id>/register` | gap | The model orders by the priority text, which sorts critical, high, low, normal |
| PMO-263 | Empty register | pm (own) | Empty state; employee sees no add action | `page /projects/[id]/register` | planned | |
| PMO-264 | Open a register item | staff1 | Detail with description, plan/response, linked task link, priority, status, score, owner, due date | `page /projects/[id]/register/[id]` `GET /api/v1/projects/<id>/register/<id>` | planned | |
| PMO-265 | Create a risk | pm (own) | `/projects/[id]/register/new`; 201; score = probability × impact; priority defaults to normal, status to open | `page /projects/[id]/register/new` `POST /api/v1/projects/<id>/register` | planned | |
| PMO-266 | Create an issue | pm (own) | 201; score 0; probability and impact are not stored | `POST /api/v1/projects/<id>/register` | planned | |
| PMO-267 | Issue with probability or impact | pm (own) | 422 `invalid` on `kind` "issues cannot include probability or impact" | `POST /api/v1/projects/<id>/register` | planned | |
| PMO-268 | Risk with probability or impact outside 1–5, missing, boolean | pm (own) | 422 `invalid` "probability must be an integer from 1 to 5" (or impact) | `POST /api/v1/projects/<id>/register` | planned | |
| PMO-269 | Create without kind or title, bad kind, priority or status | pm (own) | 422 `invalid` "kind and title are required" / "kind must be risk or issue" / "priority is invalid" / "status is invalid" | `POST /api/v1/projects/<id>/register` | planned | |
| PMO-270 | Owner, due date and linked task validation | pm (own) | Owner must be an active internal user; due date `YYYY-MM-DD`; task must be a readable task of this project | `POST /api/v1/projects/<id>/register` | planned | |
| PMO-271 | Edit a register item | pm (own) | `/projects/[id]/register/[id]/edit` saves; changing the kind is refused; empty patch 422 | `page /projects/[id]/register/[id]/edit` `PATCH /api/v1/projects/<id>/register/<id>` | planned | |
| PMO-272 | Walk a risk open → in_progress → resolved → closed | pm (own) | Each status saved and shown with its badge | `PATCH /api/v1/projects/<id>/register/<id>` | planned | |
| PMO-273 | Jump straight from closed back to open, or open to closed | pm (own) | Accepted: the route has no transition rules | `PATCH /api/v1/projects/<id>/register/<id>` | decision | Owner to decide whether the register needs a status machine |
| PMO-274 | Delete a register item | pm (own) | Inline confirmation; 204 | `DELETE /api/v1/projects/<id>/register/<id>` | planned | |
| PMO-275 | Register changes by an employee | staff1 | 403 `forbidden`; add and edit controls absent | `POST /api/v1/projects/<id>/register` | planned | |
| PMO-276 | Linked task the reader cannot see | staff2 | The item is listed without the task link | `GET /api/v1/projects/<id>/register` | planned | |
| PMO-277 | Governance routes for a hidden project | staff2 | 404 `not_found` on every governance read and write | `GET /api/v1/projects/<id>/register/<id>` | planned | |

## Project tasks list and board

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PMO-278 | Project task list | staff1 | `/projects/[id]/tasks` shows the project's open tasks in a table with KPI strip and toolbar; closed scope «منجزة» shows done and cancelled | `page /projects/[id]/tasks` `GET /api/v1/tasks` | planned | |
| PMO-279 | Project task board | staff1 | `?view=board` shows one column per project stage; cards open the task; switching back removes the key | `page /projects/[id]/tasks` | planned | |
| PMO-280 | Drag a card to another stage | staff1 | Task `stage_id` changes; refused for a task the caller cannot write | `PATCH /api/v1/tasks/<id>` | planned | |
| PMO-281 | Task filters keep the URL | staff1 | State, priority, assignee, deadline and search are in the URL; refresh, back and a shared link reproduce them | `page /projects/[id]/tasks` | planned | |
| PMO-282 | Open a task from the list and go back | staff1 | `/projects/[id]/tasks/[id]` opens; back returns to the same view and filters | `page /projects/[id]/tasks/[id]` | planned | |
| PMO-283 | Add a task from a column or the toolbar | pm (own) | `/projects/[id]/tasks/new` opens as the create panel preset with the column's stage or state | `page /projects/[id]/tasks/new` | planned | |
| PMO-284 | Task list of a project the caller cannot read | staff2 | Empty list rather than another project's rows; the page shows the project not-found state | `page /projects/[id]/tasks` `GET /api/v1/tasks` | planned | |
| PMO-285 | Project task list on an archived project | ceo | The tasks tab is hidden; the direct link still renders read-only | `page /projects/[id]/tasks` | planned | |

## Task list API

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PMO-286 | Open «مهام المشاريع المسندة إليّ» | staff1 | `/tasks` lists open tasks assigned to the caller across projects with KPI strip; heading, create button, table by default | `page /tasks` `GET /api/v1/tasks` | planned | |
| PMO-287 | Board view of my tasks | staff1 | `?view=board` shows the board; detail and back keep `?view=board` and the filters | `page /tasks` | planned | |
| PMO-288 | Filters persist per browser and appear in the URL | staff1 | Assignee, deadline and priority are stored and mirrored; a key in the URL wins over the stored value | `page /tasks` | planned | |
| PMO-289 | Archived scope | staff1 | `?scope=archived` swaps the list for «المهام المؤرشفة» with search and «استعادة» | `page /tasks` `GET /api/v1/tasks/archived` | planned | |
| PMO-290 | Empty list | staff1 | «لا مهام مسندة إليك» with an «إنشاء مهمة» action; closed scope shows «لا مهام منجزة بعد» | `page /tasks` | planned | |
| PMO-291 | Open `/tasks/new` | staff1 | Create panel over the list; Escape returns to the same list state | `page /tasks/new` | planned | |
| PMO-292 | Open a task by id | staff1 | `/tasks/[id]` shows the task detail with the same data as the project task page | `page /tasks/[id]` `GET /api/v1/tasks/<id>` | planned | |
| PMO-293 | Open a task id that is missing or of another company | staff1 | 404 `not_found`; the page shows its not-found state | `page /tasks/[id]` `GET /api/v1/tasks/<id>` | planned | |
| PMO-294 | List without a scope | staff1 | 400 `unsupported_filter` "pass filter=mine, project_id and/or assignee" | `GET /api/v1/tasks` | planned | |
| PMO-295 | List with an unsupported `filter` value | staff1 | 400 `unsupported_filter` "filter must be 'mine'" | `GET /api/v1/tasks` | planned | |
| PMO-296 | List by project, with `assignee=none` | staff1 | Unassigned tasks of the readable projects; an unreadable project yields an empty list | `GET /api/v1/tasks` | planned | |
| PMO-297 | List with assignee `me`, `none` and a user id | staff1 | Matching tasks; an unreadable user id 422 `invalid` on `assignee` | `GET /api/v1/tasks` | planned | |
| PMO-298 | List with each deadline filter | staff1 | overdue (open tasks before today), today, week (to the end of the user's week), none; anything else 422 `invalid` | `GET /api/v1/tasks` | planned | |
| PMO-299 | List with priority 0–3 or a comma list | staff1 | Matching priorities; an unknown value 422 `invalid` | `GET /api/v1/tasks` | planned | |
| PMO-300 | List with states and with an unknown state | staff1 | Comma list of in_progress, changes_requested, approved, waiting, done, cancelled; unknown 422 `invalid` "unknown state" | `GET /api/v1/tasks` | planned | |
| PMO-301 | List sorting and paging | staff1 | Sort by id, deadline (undated last), priority, name, create or write date, asc or desc; limit default 50 capped at 200; bad project id or limit 422 | `GET /api/v1/tasks` | planned | |
| PMO-302 | List excludes personal to-dos without a project | staff1 | The welcome to-do created by Odoo never shows up | `GET /api/v1/tasks` | planned | |
| PMO-303 | Task summary counts | staff1 | total, open, overdue, done follow the same filters; cancelled counts in total only; `closed` is ignored | `GET /api/v1/tasks/summary` | planned | |
| PMO-304 | Summary scope validation | staff1 | Same 400/422 answers as the list; an unreadable project gives zeros | `GET /api/v1/tasks/summary` | planned | |
| PMO-305 | Task list needs `pmo.tasks.read` | custom role (projects read only) | 403 `forbidden` "pmo.tasks.read capability is required" | `GET /api/v1/tasks` `cap pmo.tasks.read` | planned | |

## Creating and editing a task

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PMO-306 | Create a task in a project | staff1 | 201; creator is assigned; state in progress; goes to the project's first stage; page opens the new task | `POST /api/v1/tasks` `page /projects/[id]/tasks/new` | planned | |
| PMO-307 | Create without name, or without project | staff1 | 422 `invalid` on `name` / `project_id` | `POST /api/v1/tasks` | planned | |
| PMO-308 | Create in a project the caller cannot read | staff2 | 404 `not_found` | `POST /api/v1/tasks` | planned | |
| PMO-309 | Create without the create right | custom role (tasks read and write only) | 403 `forbidden` "pmo.tasks.create" | `POST /api/v1/tasks` `cap pmo.tasks.create` | planned | |
| PMO-310 | Create a subtask | staff1 | `parent_id` set; a parent of another project is refused with 403 "Parent task must belong to the same project." | `POST /api/v1/tasks` | planned | |
| PMO-311 | Create with a milestone | pm (own) | Milestone must belong to the project, else 422 `invalid` on `milestone_id` | `POST /api/v1/tasks` | planned | |
| PMO-312 | Create with a deadline | staff1 | ISO UTC instant or `YYYY-MM-DD`; an offset or malformed value 422 `invalid` on `date_deadline` | `POST /api/v1/tasks` | planned | |
| PMO-313 | Create with a planned start | pm (own) | Needs a deadline too (422 on `date_deadline` otherwise); employees get 403 "Only the project manager can change task scheduling." | `POST /api/v1/tasks` | planned | |
| PMO-314 | Create with description and deliverables | staff1 | Description string; deliverables list of name/done rows; otherwise 422 on the field | `POST /api/v1/tasks` | planned | |
| PMO-315 | Create reopens an auto-completed project | staff1 | Project status falls back to the one before the automatic done | `POST /api/v1/tasks` | planned | |
| PMO-316 | Task detail | staff1 | Description, deliverables, subtasks, dependencies, attachments, activity timeline, properties panel, allowed actions | `page /projects/[id]/tasks/[id]` `GET /api/v1/tasks/<id>` | planned | |
| PMO-317 | Edit title, description, priority | staff1 | Saved; priority only 0–3; empty name 422 | `PATCH /api/v1/tasks/<id>` | planned | |
| PMO-318 | Edit with no fields or an unknown field | staff1 | 422 `invalid` "no fields to update" / 422 `unknown_field` | `PATCH /api/v1/tasks/<id>` | planned | |
| PMO-319 | Employee sends `allocated_hours` | staff1 | 422 `unknown_field`; the project manager may set it (number, else 422) | `PATCH /api/v1/tasks/<id>` | planned | |
| PMO-320 | Assign and unassign people | staff1 | `user_ids` replaces the set; bell `assignment` only to people added; none to the actor | `PATCH /api/v1/tasks/<id>` | planned | |
| PMO-321 | Tags on a task | staff1 | Existing tags only; unknown id 422 `invalid` | `PATCH /api/v1/tasks/<id>` `GET /api/v1/tags` | planned | |
| PMO-322 | Change project stage and personal stage | staff1 | Stage must belong to the task's project; personal stage must be the caller's own; otherwise 422 `invalid` | `PATCH /api/v1/tasks/<id>` | planned | |
| PMO-323 | Set and clear a milestone | pm (own) | Milestone of the same project; null clears it; a deadline outside the milestone bounds 422 | `PATCH /api/v1/tasks/<id>` | planned | |
| PMO-324 | Deadline before the planned start | pm (own) | 422 `invalid` "Schedule start must be on or before the end date." | `PATCH /api/v1/tasks/<id>` | planned | |
| PMO-325 | Edit a task the caller cannot write | custom role (tasks read only) | 403 `forbidden` "You are not allowed to change this task." | `PATCH /api/v1/tasks/<id>` `cap pmo.tasks.write` | planned | |
| PMO-326 | Edit a task of another company | staff1 | 404 `not_found` | `PATCH /api/v1/tasks/<id>` | planned | |
| PMO-327 | Task prev/next and returning | staff1 | The detail page offers previous and next within the filtered list and returns with the list's query | `page /tasks/[id]` | planned | |

## Task states

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PMO-328 | in_progress → waiting → in_progress | staff1 | Both allowed; `allowed_transitions` lists every state except the current one the caller may enter | `POST /api/v1/tasks/<id>/transition` | planned | |
| PMO-329 | Task to done with no completion approval | staff1 | State done; `date_end` set; the task leaves the open scope | `POST /api/v1/tasks/<id>/transition` | planned | |
| PMO-330 | Task to cancelled | staff1 | State cancelled; closed; counts in total but not in done | `POST /api/v1/tasks/<id>/transition` | planned | |
| PMO-331 | Reopen a done or cancelled task | staff1 | Back to in progress; `date_end` cleared; project auto-done reverts | `POST /api/v1/tasks/<id>/transition` | planned | |
| PMO-332 | Employee sets `approved` or `changes_requested` | staff1 | 403 `transition_forbidden` "Only a project manager can approve or request changes."; those states are not offered | `POST /api/v1/tasks/<id>/transition` `cap pmo.tasks.approve` | planned | |
| PMO-333 | Project manager sets `approved` and `changes_requested` | pm (own) | Allowed even on a task the manager does not write | `POST /api/v1/tasks/<id>/transition` | planned | |
| PMO-334 | Unknown state | staff1 | 422 `invalid_state` "unknown state" on `state` | `POST /api/v1/tasks/<id>/transition` | planned | |
| PMO-335 | Direct done when completion approval is required | staff1 | 403 `transition_forbidden` "This task requires completion approval."; `done` is not offered | `POST /api/v1/tasks/<id>/transition` | planned | |
| PMO-336 | State change by someone who cannot write the task | custom role (tasks read only) | 403 `transition_forbidden` | `POST /api/v1/tasks/<id>/transition` | planned | |
| PMO-337 | State menu on the task | staff1 | The menu shows only `allowed_transitions`; choosing one updates the badge without leaving the page | `page /projects/[id]/tasks/[id]` | planned | |
| PMO-338 | Closing the last open task completes the project | pm (own) | Project gets status done with an automatic update «All tasks are complete»; a project with no done task never completes | `POST /api/v1/tasks/<id>/transition` `GET /api/v1/projects/<id>/updates` | planned | |
| PMO-339 | Cancelled tasks do not block completion | pm (own) | One done and one cancelled task: project done | `POST /api/v1/tasks/<id>/transition` | planned | |
| PMO-340 | A manual done is not reverted | pm (own) | After setting done by hand, reopening a task keeps the manual status | `POST /api/v1/projects/<id>/status` `POST /api/v1/tasks/<id>/transition` | planned | |

## Completion review

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PMO-341 | Approval card for `project_manager` mode | staff1 | Task detail shows «اعتماد إكمال المهام» with «طلب اعتماد الإكمال» for an assignee | `page /projects/[id]/tasks/[id]` | planned | |
| PMO-342 | Request completion | staff1 | Task stays open and pending; revision increments; card reads «بانتظار المراجع المعيّن» | `POST /api/v1/tasks/<id>/completion/request` | planned | |
| PMO-343 | Request when not an assignee, already pending, closed or approval off | staff2 | 403 `transition_forbidden` "You cannot request completion for this task." | `POST /api/v1/tasks/<id>/completion/request` | planned | |
| PMO-344 | Request when the reviewer is missing or ineligible | staff1 | 422 `invalid` "There is no eligible reviewer for this task."; card explains `no_reviewer` / `reviewer_ineligible` | `POST /api/v1/tasks/<id>/completion/request` | planned | |
| PMO-345 | Request with an extra body key | staff1 | 422 `unknown_field` | `POST /api/v1/tasks/<id>/completion/request` | planned | |
| PMO-346 | Reviewer accepts | pm (own) | Task becomes done; pending cleared; project completion check runs | `POST /api/v1/tasks/<id>/completion/accept` | planned | |
| PMO-347 | Accept with a missing, wrong or stale revision | pm (own) | 422 `invalid` on `revision` ("A completion revision is required." / "This completion request is stale.") | `POST /api/v1/tasks/<id>/completion/accept` | planned | |
| PMO-348 | Accept with nothing pending, or on a closed task | pm (own) | 422 `invalid` "There is no pending completion request." / "This task is not open for a completion decision." | `POST /api/v1/tasks/<id>/completion/accept` | planned | |
| PMO-349 | Accept by someone who is not the reviewer | staff2 | 403 `transition_forbidden` "Only the designated reviewer can decide this request." | `POST /api/v1/tasks/<id>/completion/accept` | planned | |
| PMO-350 | Return with a note | pm (own) | Pending cleared; assignee sees «أُعيدت: <note>» | `POST /api/v1/tasks/<id>/completion/return` | planned | |
| PMO-351 | Return without a note | pm (own) | 422 `invalid` on `note` "A return note is required." | `POST /api/v1/tasks/<id>/completion/return` | planned | |
| PMO-352 | Return by a non-reviewer or with a stale revision | staff2 | 403 `transition_forbidden`; stale revision 422 on `revision` | `POST /api/v1/tasks/<id>/completion/return` | planned | |
| PMO-353 | Requester withdraws | staff1 | Pending cleared; a new request is possible | `POST /api/v1/tasks/<id>/completion/withdraw` | planned | |
| PMO-354 | Withdraw by someone else, stale, or nothing pending | staff2 | 403 `transition_forbidden` "Only the requester can withdraw this completion request."; others 422 `invalid` | `POST /api/v1/tasks/<id>/completion/withdraw` | planned | |
| PMO-355 | `specific_user` mode with a valid approver | pm (own) | Only that approver can accept or return; the project manager cannot unless named | `POST /api/v1/tasks/<id>/completion/accept` | planned | |
| PMO-356 | Pending request is invalidated | pm (own) | Changing the approval mode or the manager, archiving the project or the task, changing the task state, or removing the requester from the assignees clears it and bumps the revision | `PATCH /api/v1/projects/<id>` | planned | A stale accept afterwards answers 422 |
| PMO-357 | Default approval mode comes from settings | pm (own) | New projects start with the company's default; existing ones keep theirs | `PATCH /api/v1/settings/projects` `POST /api/v1/projects` | planned | |

## Task archive

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PMO-358 | Archive as the creator | staff1 | Task leaves the lists; detail returns the archived task | `POST /api/v1/tasks/<id>/archive` | planned | |
| PMO-359 | Archive as the project manager | pm (own) | Allowed for any task of the project | `POST /api/v1/tasks/<id>/archive` | planned | |
| PMO-360 | Archive by an assignee who is not the creator | staff2 | 403 `forbidden` "Only the project manager or the task's creator can archive it." | `POST /api/v1/tasks/<id>/archive` | planned | |
| PMO-361 | Archived list needs a scope | staff1 | `filter=mine` and/or `project_id`; otherwise 400 `unsupported_filter`; unknown parameter 400 | `GET /api/v1/tasks/archived` | planned | |
| PMO-362 | Archived list is limited to tasks the caller may restore | staff1 | Employees see tasks they created; project managers see their project's; global managers see all; tasks of archived projects are omitted | `GET /api/v1/tasks/archived` | planned | |
| PMO-363 | Archived list validation and search | staff1 | Bad project id 422; negative limit or offset 422; `q` filters by name | `GET /api/v1/tasks/archived` | planned | |
| PMO-364 | Restore a task | staff1 | «تمت استعادة المهمة»; task returns to the open list | `POST /api/v1/tasks/<id>/unarchive` | planned | |
| PMO-365 | Restore into an archived project | ceo | 422 `archived_project` "Tasks cannot be restored while the project is archived." | `POST /api/v1/tasks/<id>/unarchive` | planned | |
| PMO-366 | Restore a task the caller may not restore, or unknown | staff2 | 404 `not_found` "task not found" | `POST /api/v1/tasks/<id>/unarchive` | planned | |

## Task comments, timeline and attachments

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PMO-367 | Activity timeline | staff1 | Comments of the whole task family plus this task's change log, newest first | `GET /api/v1/tasks/<id>/timeline` | planned | |
| PMO-368 | Post a comment | staff1 | 201; plain text kept with line breaks; HTML in the text is escaped | `POST /api/v1/tasks/<id>/comments` | planned | |
| PMO-369 | Comment with empty body | staff1 | 422 `invalid` on `body` | `POST /api/v1/tasks/<id>/comments` | planned | |
| PMO-370 | Mention a colleague | staff1 | `@name` becomes bold; colleague gets bell `mention` instead of `comment` | `POST /api/v1/tasks/<id>/comments` | planned | |
| PMO-371 | Mention validation | staff1 | More than 20, duplicate, non-integer or foreign-company ids: 422 `invalid` on `mentions` | `POST /api/v1/tasks/<id>/comments` | planned | |
| PMO-372 | Reference another task with `/` | staff1 | `/name` becomes a link to `/tasks/<id>`; only tasks of this family; others 422 `invalid` on `task_refs` | `GET /api/v1/tasks/<id>/thread-tasks` `POST /api/v1/tasks/<id>/comments` | planned | |
| PMO-373 | Comment on a task the caller cannot read | staff2 | 404 `not_found` | `POST /api/v1/tasks/<id>/comments` | planned | |
| PMO-374 | Upload an attachment | staff1 | 201 with name, size, download link; appears in the task | `POST /api/v1/tasks/<id>/attachments` | planned | |
| PMO-375 | Upload validation | staff1 | Empty or path-like name, missing data, over 10 MB, disallowed mimetype or unknown key: 422 `invalid`/`unknown_field` | `POST /api/v1/tasks/<id>/attachments` | planned | |
| PMO-376 | Upload past the storage limit | staff1 | 403 `feature_not_included` for `storage.limit_mb` | `POST /api/v1/tasks/<id>/attachments` | planned | |
| PMO-377 | Upload to a task the caller cannot write | custom role (tasks read only) | 403 `forbidden` "You are not allowed to change this task." | `POST /api/v1/tasks/<id>/attachments` | planned | |
| PMO-378 | List and download attachments | staff1 | List shows total; the download link returns the file; an attachment of another task 404 | `GET /api/v1/tasks/<id>/attachments` `GET /api/v1/tasks/<id>/attachments/<id>/download` | planned | |
| PMO-379 | Delete an attachment | staff1 | Inline confirmation; 204; an id not linked to the task answers 404 "Attachment N is not linked to task M" | `DELETE /api/v1/tasks/<id>/attachments/<id>` | planned | |

## Tags and personal stages

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PMO-380 | Tag search | staff1 | Up to 100 tags by name; works with either projects read or tasks read | `GET /api/v1/tags` | planned | |
| PMO-381 | Tag list without either read right | custom role (no pmo read) | 403 `forbidden` "one of pmo.projects.read, pmo.tasks.read capability is required" | `GET /api/v1/tags` | planned | |
| PMO-382 | Create a tag | ceo | 201 with name and colour | `POST /api/v1/tags` | planned | |
| PMO-383 | Create a tag with empty or duplicate name | ceo | 422 `invalid` on `name` ("name must not be empty" / "a tag with this name already exists", case-insensitive) | `POST /api/v1/tags` | planned | |
| PMO-384 | Create a tag as a project manager of one project | pm (own) | 403 `forbidden` "Only a project manager can create tags." | `POST /api/v1/tags` | planned | Needs the global manage right |
| PMO-385 | Personal stages are provisioned on first use | staff1 | The route returns the caller's own stages, creating the defaults the first time | `GET /api/v1/me/personal-stages` | planned | A GET that writes, see report |
| PMO-386 | Personal stages are private | staff2 | Each user sees only their own stages | `GET /api/v1/me/personal-stages` | planned | |

## Bell rows for projects and tasks

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PMO-387 | `assignment` on create and on adding an assignee | pm → staff1 | Row «<actor> assigned you to <task>» for each added internal user of the company; none to the actor; none when the assignee is already assigned | `POST /api/v1/tasks` | planned | |
| PMO-388 | `comment` goes to assignees except the author | staff1 → pm | Assignees get `comment` with the comment text; the author gets none | `POST /api/v1/tasks/<id>/comments` | planned | |
| PMO-389 | `mention` replaces `comment` for a mentioned person | staff1 → pm | A mentioned assignee gets one `mention` row, not two; a mentioned person who cannot read the task gets nothing | `POST /api/v1/tasks/<id>/comments` | planned | |
| PMO-390 | `deadline` reminder | pm | Open tasks due within the configured days: one row per assignee, once per deadline value; none after the task closes; none when reminders are off | `GET /api/v1/tasks/<id>` | planned | Cron `webvue: deadline notifications`; run with a frozen clock |
| PMO-391 | `deadline` reminder window and days | pm | With days_before 0 only tasks due today notify; 3 includes the next three days; an assignee in another time zone is judged by their own day | `PATCH /api/v1/settings/projects` | planned | |
| PMO-392 | `overdue_digest` after 09:00 local | pm | One digest per manager and local day with the count of overdue open tasks of managed projects; none before 09:00; none when the digest is off or nothing is overdue | `GET /api/v1/notification-digests/<id>` | planned | |
| PMO-393 | Open the digest page | pm | `/notification-digests/[id]` lists the snapshot tasks still open and readable, sorted by deadline, paged, with the digest date | `page /notification-digests/[id]` `GET /api/v1/notification-digests/<id>` | planned | |
| PMO-394 | Digest shrinks as tasks close | pm | A task closed, archived or hidden after the digest drops out; later deadline edits do not add tasks; with none left the row disappears | `GET /api/v1/notification-digests/<id>` | planned | |
| PMO-395 | Digest of someone else, or a non-digest bell row | staff1 | 404 `not_found` "Notification does not exist" | `GET /api/v1/notification-digests/<id>` | planned | |
| PMO-396 | Digest needs task read | custom role (no tasks read) | 403 `forbidden` | `GET /api/v1/notification-digests/<id>` | planned | |
| PMO-397 | `charter_review` to the sponsor | pm → ceo | Row names the submitter and project; it disappears once the charter is no longer waiting; none when the sponsor is the submitter | `POST /api/v1/projects/<id>/charter/submit` | planned | |
| PMO-398 | `charter_approved` to the submitter | ceo → pm | Row on approval; none when the approver is the submitter | `POST /api/v1/projects/<id>/charter/approve` | planned | |
| PMO-399 | `charter_returned` to the submitter | ceo → pm | Row carries the return note; replaces an older decision row for the same project | `POST /api/v1/projects/<id>/charter/return` | planned | |
| PMO-400 | Bell rows of a hidden project or task | staff2 | Rows of tasks or projects the user can no longer read are not shown | `GET /api/v1/tasks/<id>` | planned | |
| PMO-401 | Bells switched off with the feature | ceo | With `pmo.enabled` off none of the project bell kinds are listed | `GET /api/v1/projects` | planned | |

## Project finance

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PMO-402 | Finance tab | staff1 | `/projects/[id]/finance` shows summary cards (charter estimate, planned, actual, remaining, utilization, over budget) and the entry table | `page /projects/[id]/finance` `GET /api/v1/projects/<id>/finance` | planned | |
| PMO-403 | Finance filters | staff1 | `?kind=budget` or `expense`, search in the title; paged; bad kind 422; limit outside 1–200 422; unknown parameter 400 | `GET /api/v1/projects/<id>/finance` | planned | |
| PMO-404 | Finance empty state | staff1 | «لا قيود مالية بعد» with its hint; add buttons only for managers | `page /projects/[id]/finance` | planned | |
| PMO-405 | Summary route | staff1 | planned is null with no budget lines; remaining and utilization follow; `actual_source` manual | `GET /api/v1/projects/<id>/finance/summary` | planned | |
| PMO-406 | Over budget | pm (own) | Actual above planned flags `over_budget`; exact decimal sums (0.10 + 0.20 equals 0.30) | `GET /api/v1/projects/<id>/finance/summary` | planned | |
| PMO-407 | Add a budget line | pm (own) | `/projects/[id]/finance/new` saves; 201; budget lines carry no date and no link | `page /projects/[id]/finance/new` `POST /api/v1/projects/<id>/finance` | planned | |
| PMO-408 | Add an expense | pm (own) | Needs positive amount and a date; may link a budget line of the same project | `POST /api/v1/projects/<id>/finance` | planned | |
| PMO-409 | Finance create validation | pm (own) | Bad kind, empty or over-200 title, amount non-finite, negative, above 1e12 or finer than the currency, budget with a date or a link, expense without date or with non-positive amount, unknown field, link to a missing or other-project budget: 422 on the field | `POST /api/v1/projects/<id>/finance` | planned | |
| PMO-410 | Open an entry | staff1 | `/projects/[id]/finance/[id]` shows the entry; an entry of another project answers 404 | `page /projects/[id]/finance/[id]` `GET /api/v1/projects/<id>/finance/<id>` | planned | |
| PMO-411 | Edit an entry | pm (own) | `/projects/[id]/finance/[id]/edit`; kind, project and currency cannot change; revision bumps | `page /projects/[id]/finance/[id]/edit` `PATCH /api/v1/projects/<id>/finance/<id>` | planned | |
| PMO-412 | Edit with a stale or missing token | pm (own) | 409 `stale_write` / 422 `invalid` on `expected_updated_at` | `PATCH /api/v1/projects/<id>/finance/<id>` | planned | |
| PMO-413 | Edit with empty body or forbidden field | pm (own) | 422 "no fields to update" / `unknown_field` "cannot be changed" | `PATCH /api/v1/projects/<id>/finance/<id>` | planned | |
| PMO-414 | Delete an expense | pm (own) | Inline confirmation; token required; `{deleted: true}` | `DELETE /api/v1/projects/<id>/finance/<id>` | planned | |
| PMO-415 | Delete a budget line that expenses reference | pm (own) | 409 `finance_entry_linked`; delete the expenses or unlink them first | `DELETE /api/v1/projects/<id>/finance/<id>` | planned | |
| PMO-416 | Finance changes by an employee | staff1 | 403 `forbidden` on create, edit, delete | `POST /api/v1/projects/<id>/finance` | planned | |
| PMO-417 | Finance of an archived or hidden project | ceo | 404 `not_found` "project not found" | `GET /api/v1/projects/<id>/finance` | planned | |
| PMO-418 | External actual cost with finance on | cfo | Expenses hidden from the list; actual and expense count come from the cost center; summary says `actual_source` external | `GET /api/v1/projects/<id>/finance/summary` | planned | |
| PMO-419 | Actual lines of the cost center | cfo | Posted expense lines newest first, paged; a project without a cost center returns an empty list | `GET /api/v1/projects/<id>/finance/actual-lines` | planned | |
| PMO-420 | Actual lines for a manual project, or without the finance right | pm (own) | 404 `not_found` "project has no external actual cost" / 403 `forbidden` | `GET /api/v1/projects/<id>/finance/actual-lines` | planned | |
| PMO-421 | Link a cost center | cfo | Choice saved; the previous link released; null unlinks | `PATCH /api/v1/projects/<id>/finance/actual-account` | planned | |
| PMO-422 | Cost center validation | cfo | Non-positive or boolean id 422; unknown key 422 `unknown_field`; account of another company 422; already on another project 409 `account_linked` | `PATCH /api/v1/projects/<id>/finance/actual-account` | planned | |
| PMO-423 | Cost center choice without the right | pm (own) | 403 `forbidden`; with finance switched off 404 | `PATCH /api/v1/projects/<id>/finance/actual-account` | planned | |
| PMO-424 | Cost center mode `auto` creates one per project | cfo | A new project gets a cost center named after it and its code when the creator may create one; otherwise none | `POST /api/v1/projects` | planned | |

## Project meetings tab and direct links

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PMO-425 | Meetings tab of a project | staff1 | `/projects/[id]/meetings` lists the meetings linked to the project (number, title, date, organizer, state, open resolutions), paged by 25 | `page /projects/[id]/meetings` | planned | |
| PMO-426 | New meeting from the tab | ceo | «اجتماع جديد» opens `/meetings/new` with the project preselected; hidden without `meetings.create` or on an archived project | `page /projects/[id]/meetings` | planned | |
| PMO-427 | Meetings tab without the meetings right | custom role (projects read only) | The tab is not in the strip | `page /projects/[id]/meetings` | planned | |
| PMO-428 | Direct link and refresh on every project page | staff1 | Reloading summary, tasks, schedule, milestones, charter, stakeholders, RACI, register, finance, updates and meetings keeps the page, its filters and the frame | `page /projects/[id]` | planned | |
| PMO-429 | Back keeps list filters from any record page | staff1 | Back from a task, milestone, stakeholder, register item or finance entry returns to its list with the same filters and page | `page /projects/[id]/tasks/[id]` | planned | |
| PMO-430 | Workspace remembers the last section | staff1 | Opening a project from the list lands on the section last used in that project | `page /projects/[id]` | planned | |
| PMO-431 | Planning and governance sub-strips | staff1 | Schedule and milestones share the planning strip; charter, stakeholders, RACI and risks share the governance strip | `page /projects/[id]/schedule` | planned | |
| PMO-432 | Page ids that are not positive integers | staff1 | `/projects/abc` and `/projects/0` show the not-found state, no request fails with a stack trace | `page /projects/[id]` | planned | |
| PMO-433 | Section pages of a project that does not exist | staff1 | Each tab URL for a missing project shows «المشروع غير موجود أو لا تملك صلاحية عرضه» without the workspace frame | `page /projects/[id]/finance` | planned | |

## Project policy settings

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PMO-434 | Open «المشاريع» settings | ceo | `/settings/apps/projects` shows creation policy, defaults, completion approval, reminders, charter approval and the shared catalogs links | `page /settings/apps/projects` `GET /api/v1/settings/projects` | planned | |
| PMO-435 | Settings read by a non-manager | staff1 | Page shows «لا تملك صلاحية» and no form; API 403 `forbidden` "Only a customer administrator can read project policies." | `GET /api/v1/settings/projects` `cap pmo.settings.manage` | planned | |
| PMO-436 | Settings opened by the system administrator | it_admin | The role set has no `pmo.settings.manage`, so the page is refused although the API text says "customer administrator" | `page /settings/apps/projects` | decision | Owner to confirm whether `system_admin` should manage project policies |
| PMO-437 | Save a setting | ceo | Toast «تم حفظ الإعدادات»; the response carries every policy; the policy revision bumps so other sessions refresh | `PATCH /api/v1/settings/projects` | planned | |
| PMO-438 | Settings body validation | ceo | Empty body 422 "no fields to update"; unknown key 422 `unknown_field`; non-boolean flag, bad creators value, bad approval mode, reminder days outside 0–30 or not an integer, stages empty or over 20 or a nameless stage: 422 `invalid` on the field | `PATCH /api/v1/settings/projects` | planned | |
| PMO-439 | Settings write by a non-manager | staff1 | 403 `forbidden` "Only a customer administrator can change project policies." | `PATCH /api/v1/settings/projects` | planned | |
| PMO-440 | `project_creators` managers → employees → managers | ceo | Employees can create only in `employees`; `can_create` in the list flips; project quota still applies | `PATCH /api/v1/settings/projects` `GET /api/v1/projects` | planned | |
| PMO-441 | Default stages | ceo | New projects get exactly these stages in order and fold flags; projects that exist are untouched; before any save the built-in four stages «جديد», «قيد التنفيذ», «مراجعة», «منجز» apply | `PATCH /api/v1/settings/projects` `POST /api/v1/projects` | planned | |
| PMO-442 | Settings per company | ceo | A save in one company does not change the policies another company shows | `PATCH /api/v1/settings/projects` | planned | Needs a second company |
| PMO-443 | `require_manager_on_create` off | ceo | A project can be created with an empty manager; the overdue digest skips projects without a manager | `PATCH /api/v1/settings/projects` `POST /api/v1/projects` | planned | |
| PMO-444 | `require_end_date_on_create` off | ceo | A project can be created without an end date; existing projects are unaffected | `PATCH /api/v1/settings/projects` `POST /api/v1/projects` | planned | |
| PMO-445 | Copy while an end date is required | ceo | Copy of a source with no end date fails with 422 "An end date is required to create a project." | `POST /api/v1/projects/<id>/copy` | decision | Owner to decide whether copy should be exempt |
| PMO-446 | `default_completion_approval` none and project_manager | ceo | New projects start with the chosen mode; `specific_user` is not a default option; existing projects keep theirs | `PATCH /api/v1/settings/projects` | planned | |
| PMO-447 | `deadline_reminders_enabled` off | ceo | No `deadline` rows are produced; the overdue digest is independent | `PATCH /api/v1/settings/projects` | planned | |
| PMO-448 | `deadline_reminders_days_before` | ceo | 0 to 30 days; saved value is used by the cron | `PATCH /api/v1/settings/projects` | planned | |
| PMO-449 | `overdue_digest_enabled` off | ceo | No digest row is produced | `PATCH /api/v1/settings/projects` | planned | |
| PMO-450 | `require_charter_approval` on and off | ceo | On: submit goes to the sponsor and approved charters reopen on edit; off: submit approves at once | `PATCH /api/v1/settings/projects` | planned | |
| PMO-451 | Cost center mode setting with finance on | cfo | The «الربط مع التطبيقات الأخرى» section shows «Cost centers of projects» with automatic and manual; saved through the same route | `PATCH /api/v1/settings/projects` | planned | |
| PMO-452 | Cost center mode setting with finance off | ceo | The section and the key are absent; sending the key is 422 `unknown_field` | `PATCH /api/v1/settings/projects` | planned | |
| PMO-453 | Invalid extension value | cfo | 422 `invalid` "not one of the allowed options" / "must be a boolean" on the extension key | `PATCH /api/v1/settings/projects` | planned | |
| PMO-454 | Settings back link from catalogs | ceo | Catalog pages return to the settings page with its scroll anchor | `page /settings/apps/projects` | planned | |

## Charter catalogs (types and owning units)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PMO-455 | Open «أنواع المشاريع» | ceo | `/settings/apps/projects/catalogs/types` lists the four seeded types (تقني, تشغيلي, إنشائي, تطويري) with order, charter-step count and status | `page /settings/apps/projects/catalogs/[id]` `GET /api/v1/project-charter/catalogs/<id>` | planned | |
| PMO-456 | Open «الوحدات المالكة» | ceo | Same list for owning units, without the steps column; empty state «لا قيم في هذه القائمة بعد.» | `page /settings/apps/projects/catalogs/[id]` | planned | |
| PMO-457 | Catalog search, scope and paging | ceo | Search by name, «النشطة» / «الكل» scope, 50 per page; URL keeps `q`, `active`, `offset` | `GET /api/v1/project-charter/catalogs/<id>` | planned | |
| PMO-458 | Catalog list validation | ceo | Unknown parameter 400 `unsupported_filter`; `active` other than 1, 0 or all 422; limit capped at 100; unknown resource 404 `not_found` | `GET /api/v1/project-charter/catalogs/<id>` | planned | |
| PMO-459 | Inactive values are hidden from non-managers | pm (own) | `active=0` or `all` answers 403 `forbidden` "Only a settings manager can list inactive catalog values."; the charter picker lists active values | `GET /api/v1/project-charter/catalogs/<id>` | planned | |
| PMO-460 | Catalog read by a caller with no pmo rights | custom role (no pmo) | 403 `forbidden` | `GET /api/v1/project-charter/catalogs/<id>/<id>` | planned | |
| PMO-461 | Open one catalog value | ceo | Returns name, order, active and, for types, the charter steps; an inactive value is 404 for non-managers; a value of another company is 404 | `GET /api/v1/project-charter/catalogs/<id>/<id>` | planned | |
| PMO-462 | Create a project type | ceo | `/settings/apps/projects/catalogs/types/new` saves; 201; toast «تم الإنشاء»; charter steps default to all five | `page /settings/apps/projects/catalogs/[id]/new` `POST /api/v1/project-charter/catalogs/<id>` | planned | |
| PMO-463 | Create an owning unit | ceo | 201; the `charter_steps` key is refused with `unknown_field` for units | `POST /api/v1/project-charter/catalogs/<id>` | planned | |
| PMO-464 | Catalog create validation | ceo | Missing or blank name, non-integer order, steps not a list, repeated or unknown step: 422 on the field | `POST /api/v1/project-charter/catalogs/<id>` | planned | |
| PMO-465 | Catalog create by a non-manager | staff1 | 403 `forbidden` "Only a settings manager can change this catalog." | `POST /api/v1/project-charter/catalogs/<id>` | planned | |
| PMO-466 | Edit a catalog value | ceo | `/settings/apps/projects/catalogs/types/[id]/edit` saves name, order and steps; empty patch 422; non-boolean `active` 422 | `page /settings/apps/projects/catalogs/[id]/[id]/edit` `PATCH /api/v1/project-charter/catalogs/<id>/<id>` | planned | |
| PMO-467 | Disable and enable a value | ceo | Inline confirmation; a disabled value stays on charters that use it and cannot be picked for another project | `PATCH /api/v1/project-charter/catalogs/<id>/<id>` | planned | |
| PMO-468 | Change the steps of a type | ceo | Charters of that type show the new wizard steps on next open | `PATCH /api/v1/project-charter/catalogs/<id>/<id>` | planned | |
| PMO-469 | Delete an unused value | ceo | Inline confirmation; `{deleted: true}`; toast «تم الحذف» | `DELETE /api/v1/project-charter/catalogs/<id>/<id>` | planned | |
| PMO-470 | Delete a value a project (even archived) uses | ceo | 409 `conflict` "This catalog value is still in use."; the row shows «لا يمكن حذف قيمة ما زالت مستخدمة.» | `DELETE /api/v1/project-charter/catalogs/<id>/<id>` | planned | |
| PMO-471 | Catalog pages without settings rights | staff1 | List, new and edit pages show «لا تملك صلاحية» and no controls | `page /settings/apps/projects/catalogs/[id]/new` | planned | |
| PMO-472 | Catalog page with an unknown resource or value id | ceo | «هذه القيمة غير موجودة.» | `page /settings/apps/projects/catalogs/[id]` | planned | |
| PMO-473 | Catalog return path | ceo | After create or edit the user returns to the list the action started from, with its filters | `page /settings/apps/projects/catalogs/[id]/[id]/edit` | planned | |

## Capabilities

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PMO-474 | `pmo.projects.read` held by every employee | staff1 | Lists and opens projects of the company that record rules show; followers-only projects only to followers | `cap pmo.projects.read` `GET /api/v1/projects` | planned | |
| PMO-475 | Read refused without `pmo.projects.read` | custom role (tasks read only) | 403 `forbidden`; project pages show no data | `cap pmo.projects.read` | planned | A role that holds the create right gets read with it (dependency) |
| PMO-476 | `pmo.projects.create` held by the PMO manager | ceo | Create link in the list; create route works | `cap pmo.projects.create` `POST /api/v1/projects` | planned | |
| PMO-477 | `pmo.projects.create` through the policy for employees | staff1 | Only while `project_creators=employees`; granted as the contextual role «سياسة إنشاء المشاريع» | `cap pmo.projects.create` | planned | |
| PMO-478 | Create refused without `pmo.projects.create` | pm (own) | 403 `create_forbidden`; being a manager of one project does not allow creating | `cap pmo.projects.create` | planned | |
| PMO-479 | `pmo.projects.manage` globally | ceo | Edits, archives, sets status and phase and manages structure on any project; lists archived projects; creates tags | `cap pmo.projects.manage` | planned | |
| PMO-480 | `pmo.projects.manage` on the managed project only | pm (own) | Same actions on own project; 403 on another; no archived list; no tag creation | `cap pmo.projects.manage` | planned | |
| PMO-481 | Manage refused for a plain employee | staff1 | Every structure, charter, governance, schedule, finance and settings write answers 403 `forbidden` | `cap pmo.projects.manage` | planned | |
| PMO-482 | Contextual project owner role | pm (own) | The project manager holds manage, task write and task approve on that project and nowhere else; the role disappears when the manager is replaced | `cap pmo.projects.manage` `cap pmo.tasks.approve` | planned | |
| PMO-483 | `pmo.settings.manage` | ceo | Reads and writes project policies and catalogs | `cap pmo.settings.manage` | planned | |
| PMO-484 | Settings refused without `pmo.settings.manage` | pm (own) | Policies and catalog writes answer 403; being a project manager does not help | `cap pmo.settings.manage` | planned | |
| PMO-485 | `pmo.tasks.read` | staff1 | Task lists, summary, detail, timeline and attachments readable; the tasks tab appears | `cap pmo.tasks.read` `GET /api/v1/tasks` | planned | |
| PMO-486 | Task reads refused without `pmo.tasks.read` | custom role (projects read only) | 403 on list, summary, detail and digest; the tasks tab is hidden; project pages still open | `cap pmo.tasks.read` | planned | |
| PMO-487 | `pmo.tasks.create` | staff1 | May create tasks in any project the user reads | `cap pmo.tasks.create` `POST /api/v1/tasks` | planned | |
| PMO-488 | Create task refused without `pmo.tasks.create` | custom role (tasks read and write only) | 403 `forbidden`; no create button in `/tasks` | `cap pmo.tasks.create` | planned | |
| PMO-489 | `pmo.tasks.write` | staff1 | Edits, transitions, comments, uploads on tasks they can see | `cap pmo.tasks.write` `PATCH /api/v1/tasks/<id>` | planned | |
| PMO-490 | Write refused without `pmo.tasks.write` | custom role (tasks read only) | 403 on patch, transition, attachment upload; state menu shows no choices | `cap pmo.tasks.write` | planned | |
| PMO-491 | `pmo.tasks.approve` | pm (own) | May use approved and changes_requested, decide completion, archive any task of the project, and write `allocated_hours` | `cap pmo.tasks.approve` | planned | |
| PMO-492 | Approve refused without `pmo.tasks.approve` | staff1 | Approved and changes_requested are refused; completion decisions refused; `allocated_hours` is not writable | `cap pmo.tasks.approve` | planned | |
| PMO-493 | Custom role grant of each capability | custom role (pmo grants only) | Each key can be granted on its own; a dependent key pulls in its base (create needs read, task write needs task read) | `cap pmo.tasks.write` `cap pmo.projects.create` | planned | Role editor lives in access.md |
| PMO-494 | Branch scope of a grant | custom role (branch-scoped pmo grants) | Capability applies to projects of that branch's company only; other branches answer 404 | `cap pmo.projects.read` | planned | Needs a second company |

## Feature switch, tenant state and company boundary

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PMO-495 | Projects feature switched off | ceo | Project and task write routes answer 403 `feature_not_included` with `details.feature = pmo.enabled`; the Projects navigation and pages are hidden | `POST /api/v1/projects` `POST /api/v1/tasks` | planned | Needs a tenant profile without `pmo.enabled` |
| PMO-496 | Feature off keeps retained reads | ceo | Reads allowed by the retained-read policy still answer; others 403 `feature_not_included` | `GET /api/v1/projects` `GET /api/v1/tasks` | planned | |
| PMO-497 | Feature off for every other write route | ceo | Settings, catalogs, governance, finance, schedule, comments and attachments writes all answer 403 `feature_not_included` | `PATCH /api/v1/settings/projects` | planned | |
| PMO-498 | Read-only or expired tenant | ceo | Writes answer 403 `tenant_read_only`; reads still work | `PATCH /api/v1/projects/<id>` | planned | |
| PMO-499 | Suspended tenant | ceo | Every route answers 403 `tenant_suspended` | `GET /api/v1/projects` | planned | |
| PMO-500 | Project and task of another company | staff1 | 404 `not_found` with the wording of a missing record on every project and task route | `GET /api/v1/projects/<id>` `GET /api/v1/tasks/<id>` | planned | |
| PMO-501 | Payload names another company | ceo | A write carrying a `company_id` outside the session companies answers 404 and writes nothing | `POST /api/v1/projects` | planned | |
| PMO-502 | Archived and inactive records do not leak | staff1 | Archived projects are absent from lists, reports, schedule, governance and finance for non-managers | `GET /api/v1/reports/projects/summary` | planned | |
| PMO-503 | Pages with the feature off | staff1 | `/projects`, `/tasks`, `/projects/dashboard` show the unavailable state rather than empty data | `page /projects/dashboard` | planned | |
| PMO-504 | `non_saas` deployment | ceo | Projects, tasks, charter, governance and project finance behave the same without any vendor connection | `GET /api/v1/projects` | planned | R8: PMO has no commercial-only part |
