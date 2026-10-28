# Personal tasks

Pages: `/my-tasks` (`new`, `[id]`, `edit`). Owners: `webvue_tasks`, `webvue_tasks_pmo`.
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
| TSK-01 | Create a personal task with assignees | staff1 | Saved; bell `tasks.assigned` to new assignees, not the actor | `POST /api/v1/my-tasks`, `page /my-tasks/new`, `cap tasks.tasks.create` | planned | |
| TSK-02 | Sub-task, and a sub-task of a sub-task | staff1 | One level allowed; second level refused | `POST /api/v1/my-tasks` | planned | |
| TSK-03 | Done, reopen, cancel | staff1 | Each state saved | `POST /api/v1/my-tasks/<id>/done`, `POST /api/v1/my-tasks/<id>/reopen`, `POST /api/v1/my-tasks/<id>/cancel` | planned | |
| TSK-04 | Archive an open task; archive a done one; edit archived; restore | staff1 | Open refused; done archived read-only; restore works | `POST /api/v1/my-tasks/<id>/archive`, `POST /api/v1/my-tasks/<id>/unarchive`, `PATCH /api/v1/my-tasks/<id>` | planned | |
| TSK-05 | Comments and attachments | staff1, staff2 | Visible to creator and assignees | `POST /api/v1/my-tasks/<id>/comments`, `GET /api/v1/my-tasks/<id>/comments`, `POST /api/v1/my-tasks/<id>/attachments`, `GET /api/v1/my-tasks/<id>/attachments` | planned | |
| TSK-06 | Outsider opens the task by link | staff2 (not assigned) | 404 | `GET /api/v1/my-tasks/<id>`, `page /my-tasks/[id]` | planned | |
| TSK-07 | Convert an open top-level task with sub-tasks to a project task | staff1 | Moves with sub-tasks; opens `/projects/{p}/tasks/{t}`; irreversible | `POST /api/v1/my-tasks/<id>/convert`, `GET /api/v1/my-tasks/convert-targets` | planned | Also J-09 |
| TSK-08 | Convert a sub-task, a done task, or into a project needing approval with a done sub-task | staff1 | Refused | `POST /api/v1/my-tasks/<id>/convert` | planned | |

## List

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| TSK-09 | Open `/my-tasks` | staff1 | Heading «مهامي» with a count tag; tab «المفتوحة»; rows with title, state, deadline, assignees; own personal tasks and tasks assigned to the user | `page /my-tasks`, `GET /api/v1/my-tasks`, `cap tasks.tasks.read` | planned | |
| TSK-10 | Empty open tab | staff2 | «لا توجد مهام مفتوحة. ابدأ بإضافة مهمة جديدة.» with a create button | `page /my-tasks`, `GET /api/v1/my-tasks` | planned | |
| TSK-11 | Tabs «المفتوحة», «المغلقة», «المؤرشفة» | staff1 | Closed holds done and cancelled («تشمل المهام المنجزة والملغاة.»); archived holds archived done or cancelled tasks, sub-tasks included, with hint «استعد أي مهمة…»; empty texts per tab | `page /my-tasks`, `GET /api/v1/my-tasks` | planned | |
| TSK-12 | Scope «الكل» / «المسندة إليّ» / «التي أنشأتها» | staff1 | Filters by assignee or creator; `scope` in the URL; empty scope text «لا توجد مهام في هذا النطاق. يمكنك عرض الكل.» | `page /my-tasks`, `GET /api/v1/my-tasks` | planned | |
| TSK-13 | Sort «الأقرب موعدًا», «الأحدث», «الاسم» | staff1 | Deadline ascending with no-deadline last; newest created first; name ascending | `page /my-tasks`, `GET /api/v1/my-tasks` | planned | |
| TSK-14 | Search | staff1 | Matches the title literally (`%` and `_` are not wildcards); empty result «لا توجد مهام تطابق بحثك.»; clear button | `page /my-tasks`, `GET /api/v1/my-tasks` | planned | |
| TSK-15 | KPI strip | staff1 | «إجمالي المهام», «المهام المفتوحة», «المهام المتأخرة», «المهام المنجزة» under the scope and search; overdue counts open tasks whose deadline day is before today; cancelled count only in the total; open tile returns to the open tab | `page /my-tasks`, `GET /api/v1/my-tasks/summary` | planned | |
| TSK-16 | Table and card views | staff1 | View switch keeps filters; card grid navigable with row shortcuts | `page /my-tasks` | planned | |
| TSK-17 | Overdue styling | staff1 | Open task with a past deadline marked «متأخرة»; not applied during server render; refreshed when the tab becomes visible | `page /my-tasks` | planned | |
| TSK-18 | Paging, 50 a page | staff1 | Footer total and pager; an offset beyond the last page jumps to the last page | `page /my-tasks`, `GET /api/v1/my-tasks` | planned | |
| TSK-19 | Row of a project task | staff1 | Row shows the project, links to `/projects/{p}/tasks/{t}`, and offers no personal actions; hidden when the user lacks PMO read | `page /my-tasks`, `GET /api/v1/my-tasks` | planned | |
| TSK-20 | List parameters | api | 422 for `closed`/`archived` not 0 or 1, both together («closed and archived are exclusive»), `assigned`/`created` not `me`, `sort` outside deadline, created, name, `limit` below 1 or non-numeric, negative `offset`; `limit` capped at 100 | `GET /api/v1/my-tasks`, `GET /api/v1/my-tasks/summary` | planned | |
| TSK-21 | Failed background refresh | staff1 | Previous rows stay with the alert «تعذّر تحميل المهام المطلوبة…» and a retry button | `page /my-tasks` | planned | |
| TSK-22 | Back from a task keeps filters | staff1 | Returns to the list with tab, scope, sort, search and page | `page /my-tasks`, `page /my-tasks/[id]` | planned | |
| TSK-23 | Direct link and refresh with filters | staff1 | Controls show the URL values; unknown values fall back to defaults | `page /my-tasks` | planned | |
| TSK-24 | Tasks of another company | api | Never listed or readable | `GET /api/v1/my-tasks`, `GET /api/v1/my-tasks/<id>` | planned | |

## Create and edit

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| TSK-30 | Create with title only | staff1 | Task opens at `/my-tasks/{id}`; toast «تم إنشاء المهمة»; state open, priority normal, creator staff1, no assignees | `page /my-tasks/new`, `POST /api/v1/my-tasks` | planned | |
| TSK-31 | Create with description, deadline, priority «مرتفعة» and assignees | staff1 | All saved; description kept as plain text; deadline is a date | `page /my-tasks/new`, `POST /api/v1/my-tasks` | planned | |
| TSK-32 | Title missing or over 255 characters | staff1 | Form «عنوان المهمة مطلوب» / «عنوان المهمة لا يتجاوز {max} حرفًا»; API 422 «name is required, at most 255 characters and without NUL or unpaired surrogates» | `page /my-tasks/new`, `POST /api/v1/my-tasks` | planned | |
| TSK-33 | Invalid field values | api | 422: «date_deadline must be an ISO 8601 UTC date or datetime string», «priority must be one of ['high', 'normal']», «description must be plain text without NUL or unpaired surrogates», unknown field «x is not supported», body that is not an object | `POST /api/v1/my-tasks` | planned | |
| TSK-34 | Assignees invalid | api | 422 «assignees must be a list of user ids» / «assignees must be active people of this company»; duplicates collapsed | `POST /api/v1/my-tasks` | planned | |
| TSK-35 | Assignee picker | staff1 | Search «ابحث عن شخص»; chosen people shown; an assignee can read the task and finds it in «المسندة إليّ» | `page /my-tasks/new`, `POST /api/v1/my-tasks` | planned | |
| TSK-36 | Double submit | staff1 | One task created | `page /my-tasks/new` | planned | |
| TSK-37 | Leave the form with input | staff1 | Unsaved-changes guard; none after saving | `page /my-tasks/new` | planned | |
| TSK-38 | Create without `tasks.tasks.create` | custom role (tasks.tasks.read) | Button and route hidden or refused; `POST` 403 `forbidden` | `page /my-tasks/new`, `POST /api/v1/my-tasks`, `cap tasks.tasks.create` | planned | |
| TSK-39 | Bell to new assignees | staff1 → staff2 | `tasks.assigned` row «{actor} assigned you the task {task}» links to `/my-tasks/{id}`; the creator who assigns themselves gets none | `POST /api/v1/my-tasks`, `cap tasks.tasks.read` | planned | |
| TSK-40 | Edit page | staff1 | Prefilled form; only changed fields sent; save returns to the task | `page /my-tasks/[id]/edit`, `PATCH /api/v1/my-tasks/<id>` | planned | |
| TSK-41 | Edit link without write rights or for an archived task | staff2 | Forbidden state; archived task answers 422 «an archived task must be restored first» | `page /my-tasks/[id]/edit`, `PATCH /api/v1/my-tasks/<id>` | planned | |
| TSK-42 | Patch validation | api | 422 «nothing to update» for an empty body; `parent_id` not editable («parent_id is not supported»); same field rules as create | `PATCH /api/v1/my-tasks/<id>` | planned | |
| TSK-43 | Change assignees on edit | staff1 | Only newly added people are notified; removed people lose access and stop receiving comments | `PATCH /api/v1/my-tasks/<id>`, `cap tasks.tasks.write` | planned | |
| TSK-44 | Assignee edits a task someone else created | staff2 (assignee) | Allowed (creator or assignee may write) | `PATCH /api/v1/my-tasks/<id>`, `cap tasks.tasks.write` | planned | |
| TSK-45 | Edit without `tasks.tasks.write` | custom role (tasks.tasks.read) | 403 `forbidden`; no edit button | `PATCH /api/v1/my-tasks/<id>`, `cap tasks.tasks.write` | planned | |
| TSK-46 | Edit link with an invalid id | staff1 | Not-found state | `page /my-tasks/[id]/edit` | planned | |

## Task page and state machine

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| TSK-50 | Open a task | staff1 | State badge, description, deadline, priority, assignees, creator, created and updated times; sections sub-tasks, attachments, comments | `page /my-tasks/[id]`, `GET /api/v1/my-tasks/<id>`, `cap tasks.tasks.read` | planned | |
| TSK-51 | Invalid id or a task of another application | staff1 | Not-found state; a project task id answers 404 on `/api/v1/my-tasks/<id>` | `page /my-tasks/[id]`, `GET /api/v1/my-tasks/<id>` | planned | |
| TSK-52 | Done an open task | staff1 | «إنجاز»; badge «منجزة»; focus moves to the next primary action | `POST /api/v1/my-tasks/<id>/done` | planned | |
| TSK-53 | Done a task that is not open | api | 422 «a done task cannot be moved by done» (same for cancelled) | `POST /api/v1/my-tasks/<id>/done` | planned | |
| TSK-54 | Cancel an open task | staff1 | Menu «إلغاء المهمة» asks «إلغاء هذه المهمة؟» then «نعم، ألغِ المهمة»; «إبقاء المهمة» keeps it | `POST /api/v1/my-tasks/<id>/cancel` | planned | |
| TSK-55 | Cancel a closed task | api | 422 «a done task cannot be moved by cancel» | `POST /api/v1/my-tasks/<id>/cancel` | planned | |
| TSK-56 | Reopen a done or cancelled task | staff1 | «إعادة فتح»; back to open | `POST /api/v1/my-tasks/<id>/reopen` | planned | |
| TSK-57 | Reopen an open task | api | 422 «a open task cannot be moved by reopen» | `POST /api/v1/my-tasks/<id>/reopen` | planned | |
| TSK-58 | Transition by an outsider | staff2 | 404 `not_found` | `POST /api/v1/my-tasks/<id>/done` | planned | |
| TSK-59 | Transition without write rights | custom role (tasks.tasks.read) | 403 `forbidden`; buttons hidden | `POST /api/v1/my-tasks/<id>/cancel`, `cap tasks.tasks.write` | planned | |
| TSK-60 | Transition on an archived task | staff1 | 422 «an archived task must be restored first» | `POST /api/v1/my-tasks/<id>/reopen` | planned | |
| TSK-61 | Allowed actions | api | `allowed_actions`: open gives write, done, cancel, convert; closed gives write, reopen, archive; archived gives unarchive only | `GET /api/v1/my-tasks/<id>` | planned | |
| TSK-62 | Buttons while saving or while a draft exists | staff1 | Controls disabled during a request; an unsent comment or sub-task draft blocks state changes with «أرسل المسودة أو امسحها قبل تغيير حالة المهمة.» | `page /my-tasks/[id]` | planned | |
| TSK-63 | Archive a done or cancelled task | staff1 | Menu «أرشفة»; leaves the closed tab, appears under «المؤرشفة» with the badge; comments, files and sub-tasks stay | `POST /api/v1/my-tasks/<id>/archive` | planned | |
| TSK-64 | Archive an open task | api | 422 «only a done or cancelled task can be archived» | `POST /api/v1/my-tasks/<id>/archive` | planned | |
| TSK-65 | Archive an already archived task; restore a task that is not archived | api | 422 «an archived task must be restored first» / «the task is not archived» | `POST /api/v1/my-tasks/<id>/archive`, `POST /api/v1/my-tasks/<id>/unarchive` | planned | |
| TSK-66 | Restore | staff1 | «استعادة» returns it to the closed tab; editable again | `POST /api/v1/my-tasks/<id>/unarchive` | planned | |
| TSK-67 | Archived task is read-only | staff1 | No edit, comment, attachment or state change until restored | `PATCH /api/v1/my-tasks/<id>`, `POST /api/v1/my-tasks/<id>/comments` | planned | |

## Sub-tasks

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| TSK-70 | Add a sub-task | staff1 | Checklist row appears; progress «{done} من {total} منجزة»; sub-task is a full task with its own page and a link «مهمة فرعية من» back | `POST /api/v1/my-tasks`, `page /my-tasks/[id]` | planned | |
| TSK-71 | Tick a sub-task | staff1 | Calls done or reopen; cancelled ones counted separately and labelled | `POST /api/v1/my-tasks/<id>/done`, `POST /api/v1/my-tasks/<id>/reopen` | planned | |
| TSK-72 | Sub-task of a sub-task | api | 422 «a sub-task cannot have sub-tasks» on `parent_id` | `POST /api/v1/my-tasks` | planned | |
| TSK-73 | Parent invalid | api | 422 «parent_id must be a readable personal task of this company» / «parent_id must not be an archived task» | `POST /api/v1/my-tasks` | planned | |
| TSK-74 | Sub-task page has no sub-task section | staff1 | The section is shown only for top-level tasks; sub-tasks never offer convert | `page /my-tasks/[id]` | planned | |
| TSK-75 | Sub-task visibility | staff2 (parent assignee) | Participants of the parent read its sub-tasks; archived sub-tasks are left out of the parent | `GET /api/v1/my-tasks/<id>` | planned | |
| TSK-76 | Sub-task appears in lists | staff1 | Not in the open or closed list as its own row; found in the archived tab once archived | `GET /api/v1/my-tasks` | planned | |

## Comments and attachments

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| TSK-80 | Post a comment | staff1 | Plain text comment with author and time; list oldest first; no mention or extra bell | `POST /api/v1/my-tasks/<id>/comments`, `GET /api/v1/my-tasks/<id>/comments` | planned | |
| TSK-81 | Comment refusals | api | 422 for empty, over 5000 characters («التعليق أطول من 5000 حرف.»), NUL characters, extra keys («x is not supported») | `POST /api/v1/my-tasks/<id>/comments` | planned | |
| TSK-82 | Comment by an outsider or on an archived task | staff2 | 404; archived 422 | `POST /api/v1/my-tasks/<id>/comments`, `GET /api/v1/my-tasks/<id>/comments` | planned | |
| TSK-83 | Comment reaches only readers | staff1 → staff2 | A removed assignee is not mailed the comment | `POST /api/v1/my-tasks/<id>/comments` | planned | |
| TSK-84 | Upload a file | staff1 | PDF, PNG, JPEG, text, DOCX, XLSX up to 10 MB; count updates; download works | `POST /api/v1/my-tasks/<id>/attachments`, `GET /api/v1/my-tasks/<id>/attachments/<id>/download` | planned | |
| TSK-85 | Refused uploads | staff1 | Browser «نوع الملف غير مسموح…», «الملف فارغ.», «حجم الملف أكبر من 10 ميغابايت.»; API 422 for type, base64, size, name with a slash or NUL | `POST /api/v1/my-tasks/<id>/attachments` | planned | |
| TSK-86 | Delete a file | staff1 | Inline «حذف هذا المرفق نهائيًا؟» then «نعم، احذف المرفق»; 204; a file of another task answers 404 | `DELETE /api/v1/my-tasks/<id>/attachments/<id>` | planned | |
| TSK-87 | Attachments of a task the user cannot read | staff2 | List and download answer 404 | `GET /api/v1/my-tasks/<id>/attachments`, `GET /api/v1/my-tasks/<id>/attachments/<id>/download` | planned | |
| TSK-88 | Upload and delete without write rights | custom role (tasks.tasks.read) | 403 `forbidden`; controls hidden | `POST /api/v1/my-tasks/<id>/attachments`, `DELETE /api/v1/my-tasks/<id>/attachments/<id>` | planned | |

## Conversion to a project task

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| TSK-90 | Convert targets | staff1 | Menu «تحويل إلى مهمة مشروع» lists active projects of the company where the user may create tasks (search «ابحث عن مشروع», at most 20); none gives «لا توجد مشاريع يمكنك إضافة مهام إليها.» | `GET /api/v1/my-tasks/convert-targets`, `page /my-tasks/[id]` | planned | |
| TSK-91 | Convert | staff1 | Warning «لا يمكن التراجع عن هذا التحويل.»; confirm «نعم، حوّل المهمة»; task moves with assignees, deadline, description, sub-tasks and files; opens the project task; the personal list no longer holds it | `POST /api/v1/my-tasks/<id>/convert` | planned | |
| TSK-92 | Draft text before converting | staff1 | Prompt «سيتم تجاهل النصوص غير المرسلة…» with «تجاهل المسودة والتحويل» or «متابعة الكتابة» | `page /my-tasks/[id]` | planned | |
| TSK-93 | Convert refusals | api | 422 «only an open task can be converted», «a sub-task cannot be converted; convert its parent», «this task already belongs to a project», «project_id must be an active project of this company», «done sub-tasks need approval in this project» | `POST /api/v1/my-tasks/<id>/convert` | planned | |
| TSK-94 | Convert without PMO rights | custom role (tasks only) | 403 `forbidden`; convert action hidden and targets answer 403 | `POST /api/v1/my-tasks/<id>/convert`, `GET /api/v1/my-tasks/convert-targets` | planned | |
| TSK-95 | Convert by an outsider | staff2 | 404 `not_found` | `POST /api/v1/my-tasks/<id>/convert` | planned | |
| TSK-96 | Convert twice (second tab) | staff1 | Second attempt meets the converted task: 422 or 404, never a duplicate | `POST /api/v1/my-tasks/<id>/convert` | planned | |
| TSK-97 | Projects application off | staff1 | Convert routes 403 `feature_not_included`; no convert action | `GET /api/v1/my-tasks/convert-targets`, `POST /api/v1/my-tasks/<id>/convert` | planned | |
| TSK-98 | A sub-task the user cannot change blocks the convert | staff1 | 422 «a sub-task of this task cannot be changed by you; convert after it is removed» | `POST /api/v1/my-tasks/<id>/convert` | planned | |

## Capabilities, features and bell

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| TSK-100 | `tasks.tasks.read` held and refused | staff1 | Holder lists, opens, summarizes, reads comments and files; without it every route 403 `forbidden` and the navigation entry disappears | `cap tasks.tasks.read`, `GET /api/v1/my-tasks`, `GET /api/v1/my-tasks/summary` | planned | |
| TSK-101 | Tasks switched off for the tenant | staff1 | Entry hidden; every route 403 `feature_not_included`; no `tasks.assigned` bell rows are produced | `GET /api/v1/my-tasks` | planned | |
| TSK-102 | Read-only tenant | staff1 | Reads work; create, edit, transitions, archive, comments and files answer 403 `tenant_read_only` | `POST /api/v1/my-tasks`, `PATCH /api/v1/my-tasks/<id>` | planned | |
| TSK-103 | Bell row | staff2 | `tasks.assigned` shows the task title and opens the task; hidden when the task is archived, no longer assigned, or unreadable | `cap tasks.tasks.read` | planned | |
| TSK-104 | Assignment replaces the earlier row | staff1 → staff2 | Re-assigning the same person gives one row per task and person | `PATCH /api/v1/my-tasks/<id>` | planned | |
| TSK-105 | Attention panel | staff1 | Open tasks assigned to the user that are overdue or due today appear; overdue first with the suggestion «ابدأ بالمهمة المتأخرة.» | `GET /api/v1/my-tasks` | planned | |
| TSK-106 | Navigation | staff1 | «مهامي» entry, landing page and the «مهمة شخصية جديدة» context link; direct `/my-tasks/new` needs create | `page /my-tasks/new`, `cap tasks.tasks.create` | planned | |
| TSK-107 | Personal tasks never leak into project views | pm | A personal task of staff1 is not reachable through project routes by pm | `GET /api/v1/my-tasks/<id>` | planned | |
