# nasq — Phase 2: Projects List & Project Screen — Design Spec

**Date:** 2026-09-04
**Target:** nasq `main` @ `48017fa` (phase 1 delivered as `v0.2.0-phase1`, pillar
split merged)
**Status:** Delivered 2026-09-05
**Parent spec:** `2026-09-03-nasq-platform-design.md` (binding). This document
refines the parent's Phase 2 row after two decisions taken with the product
owner on 2026-09-04: (1) nasq is a four-pillar suite and the project pillar
is finished first; (2) **there is no time logging anywhere in the product**.

## Goal

The second daily surface after مهامي: **المشاريع** (a table of the projects
the user can read) and **one project** (header with status + progress, tabs
قائمة / لوحة of that project's tasks by *project* stage, one primary action
إنشاء مهمة). Managers set the project's status from the header. Creating a
task and opening a task stay on the phase-1 contracts; this phase adds a
project-scoped way to reach them and a project-stage board.

Milestones, project updates (rich text), create/archive project, Today,
Settings, reports and Gantt are phase 3 or later.

## Decisions (2026-09-04)

| Question | Decision |
|---|---|
| Time logging | **None, product-wide.** No timesheets, no "time" tab, no time reports. `nasq_core` drops its `hr_timesheet` dependency and implied group. `allocated_hours` (planned effort, a manager-only estimate already shipped in phase 1) stays; it is an estimate, not a log. |
| `initiative_id` | Not in this phase. The initiatives pillar (`nasq_initiatives`, phase 4) adds it to `project.project` with `_inherit`; the project pillar reserves nothing for it. |
| Projects table | `/projects`: name · status badge · progress (`closed/total`, percentage). Row click → `/projects/{id}`. No create-project action (phase 3, Settings). |
| Project screen | `/projects/{id}`: header (name, status, progress, task counts) + tabs **قائمة** (default) / **لوحة**. Tab in `?tab=list|board`. |
| Board columns | The project's stages (`project.project.type_ids`, `project.task.type`, ordered by `sequence`), i.e. `task.stage_id`. **Not** personal stages. |
| Board move | Drag between columns → `PATCH /api/v1/tasks/{id} {stage_id}`. Optimistic, replaced by the server task. In-column order is visual only. |
| Project status write | **Yes, managers only.** Header control → `POST /api/v1/projects/{id}/status {status}`. Server writes `last_update_status` on the project, which makes Odoo create the `project.update` record itself (`project.project.write`). Pending → confirmed, like task transitions. No free-text update in this phase. |
| Who is a manager | Same rule as task approval: `project.group_project_manager` or `nasq_core.group_customer_admin` (`_nasq_can_manage`). Exposed as `can_manage` on `ProjectDetail`. |
| Progress | `task_completion_percentage` = `closed_task_count / task_count`; `0` when there are no tasks. Not `project.update.progress`. |
| Task detail from a project | Same `TaskDetailModal` mounted on a nested route `/projects/{id}/tasks/{taskId}`; close returns to the project with `?tab` and filters intact; J/K and prev/next walk that project's list. `/tasks/{id}` stays the canonical shareable URL. |
| Wire | **Extend** phase-1 `GET /projects?minimal=1` and `GET /tasks?filter=mine`; never replace them. |
| Access | Odoo ACL + `ir.rule` only. No `sudo()`. A missing project is a 404; an existing project the user cannot read is a 403 `forbidden`, exactly as tasks behave through `get_record` in phase 1. Lists simply omit unreadable projects. |

## Status and progress (project)

Community Odoo 19 stores project health on `project.project.last_update_status`
(selection, stored) and progress as a ratio of closed tasks.

| Wire `status` | Odoo `last_update_status` | UI badge |
|---|---|---|
| `on_track` | `on_track` | على المسار |
| `at_risk` | `at_risk` | معرض للخطر |
| `off_track` | `off_track` | خارج المسار |
| `on_hold` | `on_hold` | معلّق |
| `done` | `done` | منجز |
| `null` | `to_define` | غير محدد (muted, no colour) |

`to_define` is "unset", never a status a manager can pick. Writable values are
the five named ones.

| Metric | Definition | Where shown |
|---|---|---|
| `progress` | `round(task_completion_percentage * 100)`, 0–100 integer; `0` when `task_count == 0` | table column, project header |
| `task_count`, `closed_task_count` | Odoo's computed counts | header ("12 / 20"), table tooltip |
| `status` | mapped `last_update_status` | table column, header |

Project-level dates, overdue counts and cycle time are **not** in this phase.

## Screens

### المشاريع — table (`/projects`)

- Columns: الاسم · الحالة (badge) · التقدم (progress bar + percentage).
- Rows: projects the session user can read. Sort: name asc. No filters in
  this phase. No pagination (a customer has tens of projects, not thousands;
  the endpoint caps at 200 and the table says so if capped).
- Row click → `/projects/{id}`.
- Empty state: "لا مشاريع بعد" with no action.
- Primary action: none.
- Skeleton rows while loading; hydration gate on the row click as in phase 1.

### المشروع — header + tabs (`/projects/{id}`)

- **Header:** name, status badge, progress bar with "closed / total", and —
  for `can_manage` users — a status **Select** in place of the badge
  (pending state while the POST is in flight; on error the previous value
  returns and a toast shows the message).
- **Tabs:** **قائمة** (default) and **لوحة**, `?tab=list|board`.
- **Primary action:** **إنشاء مهمة** (the one black button). Opens the phase-1
  `CreateTaskDialog` with the project locked (no project picker). Success
  invalidates the project's task lists and the project itself (counts), and
  opens the new task at `/projects/{id}/tasks/{taskId}`.
- Unknown / unreadable id (404 or 403) → not-found empty state with a link back to `/projects`.

### قائمة (project task table)

- Columns: العنوان · الحالة · المرحلة · الموعد · الأولوية · المكلّفون. No
  project column. No personal-stage column.
- Filters: open / closed tabs (default open), state multi-select, free-text
  `q`. Same toolbar component as مهامي with the project filter hidden.
  Filters persist per project in the URL query (not localStorage): they are
  part of what "close the modal restores".
- Pagination 50 + "تحميل المزيد".
- Row click → `/projects/{id}/tasks/{taskId}` (the task modal above this
  table). Inline state and priority controls as in phase 1.

### لوحة (project stage board)

- One column per project stage in `sequence` order. A leading "بلا مرحلة"
  column appears only when at least one listed task has no `stage` (a project
  with no stages shows just that column and a hint that stages are managed in
  Settings later).
- Folded stages render collapsed with a count and expand on click (phase-1
  behaviour, reused).
- Card: title, deadline badge, priority flag, assignee avatars. No project
  chip (already scoped).
- Drag between columns → `PATCH {stage_id}`; keyboard fallback "نقل إلى…"
  in the card menu listing the project's stages.
- Board cap 200 tasks, as in phase 1.
- Card click → the same nested task modal.

### Task modal on the project

`pages/projects/[id]/tasks/[taskId].vue` renders `TaskDetailModal` with two
new props: `closeTo` (the project route + current query) and the list params
used for siblings (`{project_id, closed, state, q}`) so J/K and prev/next
follow the project's list order. `pages/tasks/[id].vue` keeps its current
behaviour (localStorage filters, close to `/tasks`).

## API v1 (extensions of phase 1)

Phase-1 endpoints stay. This phase widens three and adds three.

```
GET    /api/v1/projects?minimal=1
       → ProjectRef[] {id, name}                    KEEP

GET    /api/v1/projects
       → Project[]                                  NEW (no minimal=1)
       order name asc, limit 200. Unknown query keys still 400
       unsupported_filter.

GET    /api/v1/projects/{id}
       → ProjectDetail                              NEW
       404 {code:'not_found'} when missing, 403 {code:'forbidden'} when unreadable.

POST   /api/v1/projects/{id}/status  {status}       NEW, managers only
       → ProjectDetail
       422 invalid_status for anything but the five writable values
       403 status_forbidden when not can_manage

GET    /api/v1/tasks?project_id=…&…                NEW allowed scope
GET    /api/v1/tasks?filter=mine&project_id=…      AND (kept)
       400 unsupported_filter if neither filter=mine nor project_id.
       project_id must be an int → 422 invalid field=project_id.
       An unreadable project_id yields an empty list, not a 404 (ACL).

POST   /api/v1/tasks {name, project_id}             KEEP

PATCH  /api/v1/tasks/{id}  {…phase-1 fields…, stage_id?}   KEEP + stage_id
       stage_id must be one of the task's project stages → else 422
       invalid field=stage_id. Employees may set it (it is a workflow
       column, not an approval).
```

Shapes (zod in `packages/contracts/src/pmo/project.ts`, mirrored by
`nasq_pmo/serializers/project.py`; whitelist only, `.strict()`):

```
ProjectStatus  'on_track'|'at_risk'|'off_track'|'on_hold'|'done'|null
Project        { id, name, status: ProjectStatus, progress: int 0–100,
                 task_count: int, closed_task_count: int }
ProjectStage   { id, name, sequence, fold }
ProjectDetail  Project + { stages: ProjectStage[], can_manage: boolean }
ProjectStatusBody { status: 'on_track'|'at_risk'|'off_track'|'on_hold'|'done' }
```

`ProjectRefSchema` moves from `personal-stage.ts` into `project.ts`
(re-exported from the pillar index; no consumer changes).

Task shapes change in one place: `Task` (list item and detail) gains
`stage: {id, name} | null` — the project stage. `personal_stage` stays.
`TaskPatch` gains `stage_id?: number`. The Odoo test `TASK_KEYS` set and the
contract test fixtures follow.

Rules (unchanged from phase 1): `type='json2'`, `auth='user'`, real HTTP
status, error body `{code, message, field?}`, serializers whitelist, no
`sudo()`, never `read()` a record onto the wire.

## Odoo side

- `nasq_core`: manifest `depends` → `['base', 'project', 'hr']`;
  `group_employee` no longer implies `hr_timesheet.group_hr_timesheet_user`;
  the group comment drops "timesheets". Existing databases keep
  `hr_timesheet` installed (Odoo never auto-uninstalls); provisioning of new
  customers no longer pulls it in. `nasq_core` tests assert the implied
  groups.
- `nasq_pmo/models/project_project.py` (new `_inherit`): `_nasq_can_manage()`
  (same rule as `_nasq_can_approve`), `_nasq_set_status(status)` → checks the
  rule (AccessError otherwise), validates the value, writes
  `last_update_status` so Odoo creates the `project.update`. Hook pattern as
  in `_nasq_transition` so a customer overlay can override one step.
- `nasq_pmo/serializers/project.py`: `STATUS_TO_API`, `dump_project`,
  `dump_project_detail`, `dump_stage`.
- `nasq_pmo/serializers/task.py`: `stage` in `dump_task`; `stage_id` in
  `EMPLOYEE_FIELDS` with `_parse_stage(task, value)` checking membership in
  `task.project_id.type_ids`.
- `nasq_pmo/controllers/projects.py`: list (minimal or full), detail, status.
- `nasq_pmo/controllers/tasks.py`: `filter=mine` **or** `project_id`;
  `project_id` parsed as int (422 on garbage, today's `int()` is unguarded).
- Bus: no new channel. `nasq/task` already fires on task create/write; the
  web app additionally invalidates `['projects']` and `['project', id]` on
  it so header counts and progress catch up. A status change made in another
  session is not pushed live (acceptable; refresh shows it).

## Frontend

- **Routes:** `pages/projects/index.vue` (table), `pages/projects/[id].vue`
  (header + tabs, hosts `<NuxtPage>`), `pages/projects/[id]/tasks/[taskId].vue`
  (modal). The phase-0 placeholder `pages/projects.vue` goes away.
- **Data:** `useProjects()` (full list, key `['projects','list']`),
  `useProjectsMinimal()` (the phase-1 picker query, key
  `['projects','minimal']`), `useProject(id)` (key `['project', id]`),
  `useSetProjectStatus()` (non-optimistic, pending → confirmed, replaces the
  detail cache with the response). `useTasks` unchanged in shape; its
  `TaskListParams` gains `mine?: boolean` (default true) so a project list
  can ask for every task of the project. `applyPatchToTask` handles
  `stage_id` + `resolved.stage`.
- **Components:** `project/ProjectTable.vue`, `project/ProjectHeader.vue`,
  `project/ProjectStatusBadge.vue`, `project/ProjectStatusSelect.vue`,
  `project/ProjectProgress.vue`. `TaskBoard` gets a stage source prop
  (`{ kind: 'personal' } | { kind: 'project', stages }`) and moves via
  `personal_stage_type_id` or `stage_id` accordingly; `TaskCard` takes the
  stages to list in its menu and the current stage id. `TaskTable` gets
  `hideProject` and an optional stage column. `TaskToolbar` gets
  `hideProjectFilter`. `CreateTaskDialog` gets an optional `projectId` that
  locks the picker. `TaskDetailModal`/`TaskDetailPanel` get `closeTo` and
  `siblingParams` props with phase-1 defaults.
- **i18n:** new namespace `projects.*` in
  `apps/web/i18n/locales/{ar,en}/projects.json` (one line each in
  `nuxt.config.ts`); task-side strings that are new (stage column, "نقل إلى…"
  already exists) go in `tasks.json`. Status vocabulary above. Everything via
  `$t()`.
- **RTL / tokens:** logical properties only; no new colours beyond the
  badge tones already used for task states (green / amber / red / muted).
- **⌘K:** projects appear in the command menu (name → `/projects/{id}`),
  fed by the minimal list.

## Real-time

No new channel. On `nasq/task` events the client invalidates `['tasks']`
(already), plus `['projects']` and `['project', id]`. Project status changes
invalidate locally on mutation success.

## Testing

- **Odoo (`nasq_core`)**: `group_employee` implies `project.group_project_user`
  and not `hr_timesheet.*`; manifest depends has no `hr_timesheet`.
- **Odoo (`nasq_pmo`, `NasqPmoCase`)**: `GET /projects?minimal=1` unchanged;
  `GET /projects` returns the whitelisted keys, `status` null for
  `to_define`, `progress` 50 for one closed of two; `GET /projects/{id}`
  includes ordered `stages` and `can_manage` (false for employee, true for
  manager); 404 for a missing id, 403 for a project with
  `privacy_visibility='followers'` the employee does not follow, and that
  project is absent from the employee's `GET /projects`; `POST
  status` 403 `status_forbidden` for the employee, 200 for the manager and
  a `project.update` now exists with that status, 422 `invalid_status` for
  `to_define`/garbage; `GET /tasks` with neither param → 400;
  `project_id=abc` → 422; `project_id` alone lists every readable task of
  the project (including tasks not assigned to me); `filter=mine&project_id`
  is the intersection; `PATCH stage_id` moves the task, 422 for a stage of
  another project; `stage` present in list and detail payloads.
- **Contracts (vitest)**: new schemas parse fixtures; `to_define` never
  appears on the wire; `ProjectStatusBody` rejects `to_define`.
- **Web unit (vitest)**: `applyPatchToTask` with `stage_id`; status → badge
  key mapping; progress formatting.
- **Contract e2e (Playwright)**: live round trip for the three new endpoints
  and the widened `GET /tasks?project_id`.
- **e2e (Playwright)**: projects table shows a project with status and
  progress; row opens `/projects/{id}`; قائمة lists a task created via API
  for that project, including one not assigned to admin; لوحة shows the
  project's stages and a drag persists after reload; إنشاء مهمة with the
  locked project opens the nested modal; closing returns to
  `/projects/{id}?tab=board`; status Select as admin changes the badge and
  survives reload.

Gate: Odoo suite on a fresh `-i nasq_core,nasq_api,nasq_pmo` scratch DB,
`ruff`, `vue-tsc --build`, `npm test`, e2e — all green, as in phase 1.

## Out of scope (later)

Time logging (**never**), milestones, project updates with text, create /
archive / edit project, project members, server-side card reorder, Today,
Settings, People beyond the assignee picker, project dates and duration
metrics, attachment upload, dependency editing, `@mentions`, Gantt, reports,
portal users, `initiative_id`.

## Open items (decided by default; revisit only if the user objects)

- Create-task lands in Odoo's default stage for the project (first
  unfolded stage via `_compute_stage_id`); the client does not send
  `stage_id` on `POST /tasks`.
- The projects table has no filters or search; ⌘K covers "find a project by
  name".
