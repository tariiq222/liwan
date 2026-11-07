# Personal tasks

Pages: `/my-tasks` (`new`, `[id]`, `edit`). Owners: `liwan_tasks`, `liwan_tasks_pmo`.
Personas and status values: [README](README.md).

Notes: every employee holds `tasks.tasks.read`, `tasks.tasks.create` and `tasks.tasks.write`
through the employee role, so all business personas can use personal tasks. A personal task is
a task with no project. It is visible to its creator, its assignees and, for a sub-task, the
people of its parent; everyone else gets 404 `not_found` (never 403). The list also shows the
project tasks assigned to the user when the projects application is on and the user holds
`pmo.tasks.read` and `pmo.projects.read`. The only bell kind is `tasks.assigned`. Wire states
are `open`, `done`, `cancelled`; priorities `normal` and `high`.

## Core flow

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |

## List

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| TSK-18 | Paging, 50 a page | staff1 | Footer total and pager; an offset beyond the last page jumps to the last page | `page /my-tasks`, `GET /api/v1/my-tasks` | fail | #243; UI: 86 tasks show «86 مهمة \| صفحة 1 من 2» and next page sets ?offset=50, but /my-tasks?offset=500 shows «لا توجد نتائج ظاهرة في هذه الصفحة.» and «صفحة 11 من 2» instead of jumping to the last page (see findings3) |

## Create and edit

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |

## Task page and state machine

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |

## Sub-tasks

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |

## Comments and attachments

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| TSK-83 | Comment reaches only readers | staff1 → staff2 | A removed assignee is not mailed the comment | `POST /api/v1/my-tasks/<id>/comments` | planned | only read access checked: after removal as assignee staff2 gets 404 on the task; mail delivery cannot be observed (crons off, no mail sink) |

## Conversion to a project task

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| TSK-94 | Convert without PMO rights | custom role (tasks only) | 403 `forbidden`; convert action hidden and targets answer 403 | `POST /api/v1/my-tasks/<id>/convert`, `GET /api/v1/my-tasks/convert-targets` | fail | #217; Role with tasks.tasks.* but no pmo: convert-targets 403 (text "forbidden") but POST convert answers 422 "project_id must be an active project of this company" instead of 403 (findings2/projects.md) |
| TSK-98 | A sub-task the user cannot change blocks the convert | staff1 | 422 «a sub-task of this task cannot be changed by you; convert after it is removed» | `POST /api/v1/my-tasks/<id>/convert` | planned | could not reproduce: a sub-task created by staff2 under staff1's parent was still changeable and convertible by staff1 (PATCH 200, convert 200) |

## Capabilities, features and bell

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| TSK-107 | Personal tasks never leak into project views | pm | A personal task of staff1 is not reachable through project routes by pm | `GET /api/v1/my-tasks/<id>` | planned | #197; fixed in code: GET /api/v1/my-tasks/<id> as a non-assignee answers 404 `not_found`, covered by `test_a_personal_task_of_others_is_not_found_through_pmo_routes`; not yet re-run as pm |
