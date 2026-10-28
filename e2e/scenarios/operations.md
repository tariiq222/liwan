# Operations (requests and approvals)

Pages: `/operations`, `/operations/new`, `/operations/[id]`, `/operations/pending`,
`/operations/monitoring`, `/operations/self/*` (served at `/account/requests`), settings
`/settings/apps/operations/processes`. Owners: `webvue_operations` (approvals through OCA
`base_tier_validation`, one sequential tier per stage), `webvue_operations_pmo`.
Personas and status values: [README](README.md).

Role note: `ops_manager` designs processes and monitors but cannot review; `pm` is a reviewer;
every employee may submit. Built-in grants: employee = `operations.requests.read` + `create`;
operations_manager = those + `operations.monitoring.read` + `operations.processes.manage`;
operations_reviewer = read + create + `operations.requests.review`. Every operations capability
depends on `operations.requests.read`. `system_admin` and vendor support hold no operations
capability by default.

Token note: the publish and archive actions of a process share one route, and the five request
actions (submit, approve, reject, return, withdraw) share another; the Covers column names that
route and the Scenario column says which action. API errors quoted below are the server messages;
the UI shows its own Arabic text for them.

## Roles and capabilities

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| OPS-16 | Employee opens `/operations` | staff1 | Sees only own work requests; nav shows «طلباتي» only, no «بانتظار موافقتي», no «متابعة التنفيذ», no «إعداد الإجراءات» | `page /operations` `cap operations.requests.read` | planned | |
| OPS-17 | Employee reads the process list and one published process | staff1 | `GET /api/v1/operations/processes` lists published processes only; a draft or archived process id answers 404 `not_found` | `GET /api/v1/operations/processes` `GET /api/v1/operations/processes/<id>` `cap operations.requests.read` | planned | The record rule hides unpublished processes and their stages from non-managers |
| OPS-18 | User without `operations.requests.read` calls any operations route | custom role (no operations capability) | 403 `forbidden`, message `operations.requests.read capability is required`; `/operations` shows the forbidden state | `GET /api/v1/operations/requests` `GET /api/v1/operations/requests/<id>` `cap operations.requests.read` | planned | |
| OPS-19 | User with read but not create opens `/operations/new` and posts a request | custom role (operations.requests.read only) | No «طلب جديد» button; the new page shows the forbidden state; POST answers 403 `forbidden` | `page /operations/new` `POST /api/v1/operations/requests` `cap operations.requests.create` | planned | |
| OPS-20 | Reviewer without `operations.processes.manage` opens process settings | pm | Settings has no «إعداد الإجراءات» part; `/settings/apps/operations/processes` shows «ليس لديك صلاحية لهذا الإجراء»; execution-kinds answers 403 | `page /settings/apps/operations/processes` `GET /api/v1/operations/execution-kinds` `cap operations.processes.manage` | automated | `e2e/tests/access-matrix.e2e.ts` |
| OPS-21 | Process manager creates a process and cannot review | ops_manager | `/operations/pending` is refused; scope=pending answers 403 `operations.requests.review capability is required` | `page /operations/pending` `cap operations.requests.review` | planned | See OPS-11 for the decision itself |
| OPS-22 | Employee without `operations.monitoring.read` opens monitoring | staff1 | `/operations/monitoring` shows the forbidden state; scope=monitoring answers 403 `operations.monitoring.read capability is required` | `page /operations/monitoring` `cap operations.monitoring.read` | automated | `e2e/tests/access-matrix.e2e.ts` |
| OPS-23 | Monitoring capability allows reading every company request | ops_manager | Detail of a request the user did not submit and does not review opens (no 404) and shows its stages and history | `page /operations/[id]` `cap operations.monitoring.read` `GET /api/v1/operations/requests/<id>` | planned | Without the capability the same id is 404 for a non-participant |
| OPS-24 | Custom role with only `operations.monitoring.read` | custom role (monitoring.read) | Read dependency is added automatically; can monitor but has no create button and no review actions | `cap operations.monitoring.read` `cap operations.requests.read` | planned | |
| OPS-25 | System administrator has no implicit operations rights | it_admin | Cannot create processes, review or monitor unless a role grants it; routes answer 403 | `cap operations.processes.manage` `cap operations.requests.review` | planned | Odoo test `test_system_admin_and_vendor_support_gain_no_implicit_operation_capabilities` |
| OPS-26 | Reviewer loses `operations.requests.review` after a request was submitted to them | pm | Cannot approve, reject or return (403); the request leaves their `/operations/pending` list | `POST /api/v1/operations/requests/<id>/<id>` `cap operations.requests.review` | planned | Odoo test `test_current_capability_is_required_after_submission` |
| OPS-27 | Reviewer account is deactivated after submission | pm | Cannot decide; resubmission skips this user and fails if the stage has no other eligible reviewer | `POST /api/v1/operations/requests/<id>/<id>` | planned | Odoo test `test_disabled_reviewer_and_empty_return_reason_are_denied` |
| OPS-28 | Custom role grants `operations.processes.manage` to an employee | custom role (employee + processes.manage) | Process list, create and edit work; the same user cannot see other users' requests | `cap operations.processes.manage` `page /settings/apps/operations/processes` | planned | |

## Process list in settings

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| OPS-29 | Open the process list with data | ops_manager | Columns number, «العنوان», «مراحل الموافقة» (stage count), «الحالة»; draft, published and archived all listed; heading «إعداد الإجراءات» | `page /settings/apps/operations/processes` `GET /api/v1/operations/processes` | planned | |
| OPS-30 | Empty process list | ops_manager | «لا توجد إجراءات بعد» | `page /settings/apps/operations/processes` | planned | Needs a fresh company or a search with no match for the no-results text |
| OPS-31 | Search processes | ops_manager | Search «البحث في الإجراءات» filters by name; no match shows the no-results text; clear resets; `q` is kept in the URL | `page /settings/apps/operations/processes` `GET /api/v1/operations/processes` | planned | |
| OPS-32 | Process list pagination | ops_manager | 20 per page; footer «عرض n من total نتيجة»; `page` kept in URL; refresh stays on the page | `page /settings/apps/operations/processes` | planned | Needs more than 20 processes |
| OPS-33 | List API filters and paging | ops_manager | `purpose=work` and `purpose=employee` narrow the list; `published=1` returns only published; `limit` capped at 200; `offset` works | `GET /api/v1/operations/processes` | planned | |
| OPS-34 | List API refuses a bad filter | ops_manager | `purpose=other` answers 422 `invalid` field `purpose`; `limit=abc` or `offset=-1` answers 422 | `GET /api/v1/operations/processes` | planned | |
| OPS-35 | Open a process, go back | ops_manager | Row opens the detail with `returnTo`; back returns to the list with search and page preserved | `page /settings/apps/operations/processes/[id]` `page /settings/apps/operations/processes` | planned | |
| OPS-36 | Process detail content | ops_manager | Description (or «لم يُضف وصف»), numbered stages with reviewer names, aside shows «نتيجة الاعتماد» («اعتماد الطلب» / «إكمال مهمة مشروع») and stage count; tag shows the state | `page /settings/apps/operations/processes/[id]` `GET /api/v1/operations/processes/<id>` | planned | |
| OPS-37 | Open a non-numeric or unknown process id | ops_manager | `/settings/apps/operations/processes/abc` and `/9999999` show the 404 state with retry | `page /settings/apps/operations/processes/[id]` | planned | |
| OPS-38 | Open a process of another company | ops_manager | 404 `not_found` | `GET /api/v1/operations/processes/<id>` | planned | Odoo test `test_process_record_matrix` |
| OPS-39 | Process buttons by state | ops_manager | Draft: «تعديل», «نشر», «أرشفة»; published: «تعديل», «أرشفة»; archived: «تعديل» only | `page /settings/apps/operations/processes/[id]` | planned | |
| OPS-40 | Process list seen by a user without manage | staff1 | Forbidden state «ليس لديك صلاحية لهذا الإجراء»; no create button | `page /settings/apps/operations/processes` | planned | |

## Process designer: create and edit

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| OPS-01 | Create a process with three stages and reviewers, publish | ops_manager | `published`; visible in `/operations/new` | `page /settings/apps/operations/processes/new` `POST /api/v1/operations/processes` `POST /api/v1/operations/processes/<id>/<id>` `page /operations/new` `cap operations.processes.manage` | planned | |
| OPS-04 | Stage limits: 0 stages, 21 stages | ops_manager | Refused | `POST /api/v1/operations/processes` `PATCH /api/v1/operations/processes/<id>` | planned | API answers 422 `invalid`, `Add between one and twenty approval stages.`; the form keeps at least one row |
| OPS-41 | Open «إجراء جديد» from the list | ops_manager | Create panel over the list with name, description, purpose, result kind and one empty stage; cancel returns to the list with filters kept | `page /settings/apps/operations/processes/new` | planned | |
| OPS-42 | Create saves as draft and opens the detail | ops_manager | Redirect to the new process page, state «مسودة», revision 1 | `page /settings/apps/operations/processes/new` `POST /api/v1/operations/processes` | planned | |
| OPS-43 | Submit the create form empty | ops_manager | Inline «هذا الحقل مطلوب» on name and stage name, «اختر مراجعًا واحدًا على الأقل» on reviewers; nothing is sent | `page /settings/apps/operations/processes/new` | planned | |
| OPS-44 | Add, move up, move down and remove stages | ops_manager | Stage numbers follow the order; first row cannot move up, last cannot move down; saved order is the review order | `page /settings/apps/operations/processes/new` `page /settings/apps/operations/processes/[id]/edit` | planned | |
| OPS-45 | Pick several reviewers for one stage | ops_manager | Picker lists company users; duplicates are removed on save; detail shows every reviewer | `POST /api/v1/operations/processes` | planned | |
| OPS-46 | Create with an unknown body field | ops_manager | 422 `invalid`, `Invalid request fields.` | `POST /api/v1/operations/processes` | planned | |
| OPS-47 | Create with a blank or over-long name or description | ops_manager | 422 `invalid` (`Invalid name.` over 200 characters or blank, `Invalid description.` over 20000) | `POST /api/v1/operations/processes` | planned | Verify a missing `name` key: the process row is created before configuration (`controllers/operations.py:97`) and could hit the not-null constraint instead of answering 422 |
| OPS-48 | Stage payload errors | ops_manager | 422 for a stage that is not an object or has keys other than `name` and `reviewer_ids` (`Invalid approval stage.`), blank or over-200-character stage name (`Invalid stage.`) | `POST /api/v1/operations/processes` | planned | |
| OPS-49 | Reviewer list errors | ops_manager | 422 `Choose at least one valid reviewer.` for empty, over 20, non-integer or boolean ids; `Reviewers must be active users of the current company.` for an archived user, a portal user or a user of another company | `POST /api/v1/operations/processes` `PATCH /api/v1/operations/processes/<id>` | planned | |
| OPS-50 | Choose an invalid purpose | ops_manager | 422 `invalid`, field `purpose` | `POST /api/v1/operations/processes` | planned | |
| OPS-51 | Choose an unavailable execution kind | ops_manager | 422 `This execution action is not available.` (for example `pmo_completion` while PMO is switched off) | `POST /api/v1/operations/processes` `GET /api/v1/operations/execution-kinds` | planned | |
| OPS-52 | Execution kinds list | ops_manager | `{items:[approval], total:1}`; `pmo_completion` is added only when the PMO feature is on; a user without manage gets 403 | `GET /api/v1/operations/execution-kinds` | planned | |
| OPS-53 | Edit a draft process | ops_manager | Form pre-filled; save keeps the state `draft`, revision +1, stages replaced | `page /settings/apps/operations/processes/[id]/edit` `PATCH /api/v1/operations/processes/<id>` | planned | |
| OPS-54 | Edit a published process | ops_manager | Warning «حفظ التعديل يعيد الإجراء إلى مسودة تحتاج النشر…»; after save the state is `draft` and new requests cannot use it until republished | `page /settings/apps/operations/processes/[id]/edit` `PATCH /api/v1/operations/processes/<id>` | planned | |
| OPS-55 | Edit an archived process | ops_manager | Decision needed: saving returns the process to `draft` (un-archives it). Confirm that is intended | `PATCH /api/v1/operations/processes/<id>` | decision | `models/process.py:83` always writes `state: draft` |
| OPS-56 | Stale revision on edit | ops_manager | Second editor sees 409 `conflict`; banner «تغيّر السجل منذ فتحه…» with «تحديث البيانات»; reload asks «تحديث البيانات واستبدال المسودة؟» when the form is dirty | `PATCH /api/v1/operations/processes/<id>` `page /settings/apps/operations/processes/[id]/edit` | planned | |
| OPS-57 | Missing or non-integer revision on PATCH | ops_manager | Answered 409 `conflict` (not 422) | `PATCH /api/v1/operations/processes/<id>` | planned | `models/common.py:check_revision` treats a missing revision as a conflict; confirm that is intended |
| OPS-58 | Unsaved changes guard | ops_manager | Leaving the create or edit form with changes asks to confirm; saving clears the guard | `page /settings/apps/operations/processes/new` `page /settings/apps/operations/processes/[id]/edit` | planned | |
| OPS-59 | Double click on save | ops_manager | One request is sent; the button shows loading | `page /settings/apps/operations/processes/new` | planned | |
| OPS-60 | Edit page for a user without manage, and for a bad id | staff1 | Forbidden alert; `/settings/apps/operations/processes/abc/edit` shows 404 | `page /settings/apps/operations/processes/[id]/edit` | planned | |
| OPS-61 | PATCH a process of another company or a hidden one | ops_manager | 404 `not_found` | `PATCH /api/v1/operations/processes/<id>` | planned | |
| OPS-62 | PATCH without the manage capability | pm | 403 `forbidden`, `operations.processes.manage capability is required` | `PATCH /api/v1/operations/processes/<id>` | planned | |
| OPS-63 | Processes cannot be deleted | ops_manager | No delete route or button; ORM unlink is refused (`Archive processes to preserve their history.`) | `page /settings/apps/operations/processes/[id]` | planned | |

## Process lifecycle (draft, published, archived)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| OPS-64 | Publish a draft from the detail page | ops_manager | Inline «نشر الإجراء؟», confirm; state «منشور»; process appears in `/operations/new` | `page /settings/apps/operations/processes/[id]` `POST /api/v1/operations/processes/<id>/<id>` | planned | |
| OPS-65 | Cancel the publish confirmation | ops_manager | Nothing changes | `page /settings/apps/operations/processes/[id]` | planned | |
| OPS-66 | Publish a process whose reviewer lacks the review capability | ops_manager | 422 `Every reviewer needs the operations review capability.`; the process stays draft (save of such a reviewer is allowed, publish is not) | `POST /api/v1/operations/processes/<id>/<id>` | planned | For example choosing ops_manager himself as the reviewer |
| OPS-67 | Publish a process that is already published or archived | ops_manager | 422 `Configure the stages before publishing.` | `POST /api/v1/operations/processes/<id>/<id>` | planned | |
| OPS-68 | Publish with a stale revision | ops_manager | 409 `conflict` and the page shows the conflict alert with «تحديث البيانات» | `POST /api/v1/operations/processes/<id>/<id>` | planned | |
| OPS-03 | Archive a published process | ops_manager | No new requests; existing ones continue | `page /settings/apps/operations/processes/[id]` `POST /api/v1/operations/processes/<id>/<id>` | planned | |
| OPS-69 | Archive confirmation | ops_manager | Inline «أرشفة الإجراء؟» with help «لن يكون الإجراء متاحًا لطلبات جديدة…»; state «مؤرشف»; archived process disappears from the request create picker | `page /settings/apps/operations/processes/[id]` `page /operations/new` | planned | |
| OPS-70 | Archive a draft process | ops_manager | Allowed; state `archived` | `POST /api/v1/operations/processes/<id>/<id>` | planned | |
| OPS-71 | Archive an already archived process through the API | ops_manager | Doubtful: accepted again and the revision grows; the UI hides the button | `POST /api/v1/operations/processes/<id>/<id>` | decision | `models/process.py:action_archive` has no state check |
| OPS-72 | Unknown process action | ops_manager | `POST .../processes/<id>/delete` answers 404 `Unknown process action.` | `POST /api/v1/operations/processes/<id>/<id>` | planned | |
| OPS-73 | Process action with extra body fields | ops_manager | 422 `Invalid request fields.` | `POST /api/v1/operations/processes/<id>/<id>` | planned | |
| OPS-74 | Process action without the manage capability | pm | 403 `forbidden` | `POST /api/v1/operations/processes/<id>/<id>` | planned | |
| OPS-75 | Publish creates one approval definition per stage and freezes them | ops_manager | Reviewer order matches stage order; later edits create a new draft revision and leave published definitions untouched | `POST /api/v1/operations/processes/<id>/<id>` | planned | Odoo tests `test_process_reconfiguration_does_not_change_submitted_reviewers`, `test_manager_cannot_create_or_mutate_raw_approval_definitions` |
| OPS-76 | Reconfiguring a process while a request is pending | ops_manager, pm | The pending request keeps its original stages and reviewers; its process name and revision are snapshots | `PATCH /api/v1/operations/processes/<id>` `GET /api/v1/operations/requests/<id>` | planned | |
| OPS-77 | Republish after edit, then resubmit an old returned request | ops_manager, staff2 | Resubmission uses the current published stages, not the old ones | `POST /api/v1/operations/requests/<id>/<id>` | planned | |

## Process options and their effects

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| OPS-02 | Process purpose `work` vs `employee` | ops_manager | Employee processes listed under `/operations/self` | `page /operations/self` `page /operations/self/new` `GET /api/v1/operations/processes` | planned | |
| OPS-78 | Purpose «طلبات العمل» | ops_manager | Process offered at `/operations/new` and not at `/account/requests/new` | `page /operations/new` `page /operations/self/new` | planned | |
| OPS-79 | Purpose «شؤون الموظفين الشخصية» | ops_manager | Process offered at `/account/requests/new` only; its requests are excluded from «طلباتي» in `/operations` | `page /operations/self/new` `page /operations/new` | planned | |
| OPS-80 | Change a process purpose after requests exist | ops_manager | Old requests keep their original purpose; only new ones follow the new purpose (hint «تبقى الطلبات السابقة ضمن تصنيفها الأصلي») | `PATCH /api/v1/operations/processes/<id>` | planned | Odoo test `test_self_service_purpose_is_server_owned_snapshot_through_reconfiguration` |
| OPS-81 | Result kind «اعتماد الطلب» (approval) | ops_manager | Final approval marks the request `done` with no side effect; request form shows no linked-record picker | `GET /api/v1/operations/execution-kinds` | planned | |
| OPS-82 | Result kind «إكمال مهمة مشروع» (pmo_completion) | ops_manager | Only offered with PMO on; see the PMO section for the request flow | `GET /api/v1/operations/execution-kinds` | planned | |
| OPS-83 | One stage with one reviewer | ops_manager, staff2, pm | Single approval finishes the request | `POST /api/v1/operations/processes` | planned | |
| OPS-84 | Twenty stages | ops_manager | Saved and publishable; request page lists twenty stages in order | `POST /api/v1/operations/processes` | planned | Upper bound |
| OPS-85 | One stage with two reviewers | ops_manager, pm, ceo | Either reviewer can approve the stage; once approved the other reviewer can no longer decide it | `POST /api/v1/operations/requests/<id>/<id>` | planned | Review type is individual |
| OPS-86 | Same reviewer on two consecutive stages | ops_manager, pm | The reviewer approves stage 1, then stage 2 as a separate decision | `POST /api/v1/operations/requests/<id>/<id>` | planned | |

## Creating a request (mine)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| OPS-87 | Open «طلباتي» with data | staff2 | Columns number, «العنوان», «الإجراء», «مقدم الطلب», «الحالة», «تاريخ الطلب»; own work requests only; KPI strip «طلباتي / بانتظار الاعتماد / معادة للتعديل / مكتملة» | `page /operations` `GET /api/v1/operations/requests` | planned | |
| OPS-88 | Empty list | staff1 | «لا توجد طلبات في هذه القائمة» | `page /operations` | planned | |
| OPS-89 | Open the create panel | staff2 | `/operations/new` over the list; process picker lists published work processes only; cancel returns with filters | `page /operations/new` `GET /api/v1/operations/processes` | planned | |
| OPS-90 | No published process exists | staff2 | Warning «لا توجد إجراءات منشورة متاحة. يلزم نشر إجراء قبل إنشاء الطلب.» | `page /operations/new` | planned | |
| OPS-91 | Create a request | staff2 | Saved as `draft`, requester is the caller, redirect to `/operations/<id>` with «إرسال للموافقة» available; purpose and process name are copied from the process | `page /operations/new` `POST /api/v1/operations/requests` `page /operations/[id]` | planned | |
| OPS-92 | Required fields | staff2 | «هذا الحقل مطلوب» for title and process; nothing is sent | `page /operations/new` | planned | |
| OPS-93 | Create with a bad process id | staff2 | 422 `invalid` field `process_id` for `0`, a string or a boolean | `POST /api/v1/operations/requests` | planned | |
| OPS-94 | Create against a draft, archived or other-company process | staff2 | 422 `Choose a published process from the current company.` | `POST /api/v1/operations/requests` | planned | |
| OPS-95 | Create with unknown or control fields | staff2 | 422 `Invalid request fields.` for `state`, `requester_id`, `purpose`, `revision` | `POST /api/v1/operations/requests` | planned | Odoo test `test_json_default_context_cannot_forge_control_fields` |
| OPS-96 | Create with a blank or over-long name or description | staff2 | 422 `Invalid name.` / `Invalid description.` | `POST /api/v1/operations/requests` | planned | |
| OPS-97 | Link a record to an approval-only process | staff2 | 422 `This process does not accept a linked record.` | `POST /api/v1/operations/requests` | planned | |
| OPS-98 | Unsaved changes guard on the create form | staff2 | Leaving with typed text asks to confirm | `page /operations/new` | planned | |
| OPS-99 | Create a request as ops_manager | ops_manager | Allowed (employee create right); the user then cannot approve it | `POST /api/v1/operations/requests` | planned | |
| OPS-100 | Create while the user is in another company session | staff2 | Request belongs to the current company only; other company users get 404 on its id | `POST /api/v1/operations/requests` | planned | Odoo test `test_operations_lists_exclude_other_companies` |

## Editing a draft and attachments

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| OPS-101 | Edit a draft request | staff2 | «تعديل» opens `/operations/<id>/edit`; title and description saved, revision +1; process cannot be changed | `page /operations/[id]/edit` `PATCH /api/v1/operations/requests/<id>` | planned | |
| OPS-102 | Edit a returned request | staff2 | Allowed, same as a draft | `PATCH /api/v1/operations/requests/<id>` | planned | |
| OPS-103 | Edit a pending, done, rejected or withdrawn request | staff2 | No «تعديل» button; the edit page shows «يمكن لمقدم الطلب تعديل مسودته أو الطلب المعاد إليه فقط.»; API 403 | `page /operations/[id]/edit` `PATCH /api/v1/operations/requests/<id>` | planned | |
| OPS-104 | Someone else edits the request | staff1 | 404 for a non-participant; 403 `Only the requester can edit an open draft.` for a participant | `PATCH /api/v1/operations/requests/<id>` | planned | |
| OPS-105 | Edit with stale revision | staff2 | 409 `conflict`; form offers «تحديث البيانات» and asks before replacing a dirty draft | `PATCH /api/v1/operations/requests/<id>` | planned | |
| OPS-106 | Edit with unknown field or blank title | staff2 | 422 `Invalid request fields.` / `Invalid name.` | `PATCH /api/v1/operations/requests/<id>` | planned | |
| OPS-107 | Upload an attachment to a draft | staff2 | Listed under «المرفقات» with a download link; allowed types: text, pdf, png, jpeg, docx, xlsx | `POST /api/v1/operations/requests/<id>/attachments` `page /operations/[id]` | planned | |
| OPS-108 | Upload validation | staff2 | 422 for name with `/`, empty file, invalid base64, over 10 MB (`attachment exceeds 10MB`), disallowed type such as an executable or zip (`file type is not allowed`), unknown body field | `POST /api/v1/operations/requests/<id>/attachments` | planned | The sniffed content decides the type, not the file name |
| OPS-109 | Upload to a pending or finished request | staff2 | 403; the upload control is hidden | `POST /api/v1/operations/requests/<id>/attachments` | planned | Odoo test `test_pending_request_attachments_cannot_be_changed_via_orm` |
| OPS-110 | Upload by a non-requester | pm | 403 or 404; control hidden | `POST /api/v1/operations/requests/<id>/attachments` | planned | |
| OPS-111 | Remove an attachment | staff2 | Inline «إزالة المرفق؟», then removed; remove is unavailable once pending | `DELETE /api/v1/operations/requests/<id>/attachments/<id>` | planned | |
| OPS-112 | Remove an attachment of a different request | staff2 | 404 `Attachment not found.` | `DELETE /api/v1/operations/requests/<id>/attachments/<id>` | planned | |
| OPS-113 | Requester and reviewer download an attachment | staff2, pm | File downloads with the original name; attachment of another request id answers 404 | `GET /api/v1/operations/requests/<id>/attachments/<id>/download` | planned | Odoo tests `test_requester_downloads_and_the_wire_url_is_the_download_route`, `test_attachment_of_another_request_is_not_served` |
| OPS-114 | Download without access to the request | staff1 | 404 | `GET /api/v1/operations/requests/<id>/attachments/<id>/download` | planned | |
| OPS-115 | Attachments stay visible after final decision | staff2 | Download link still works on `done` and `rejected` requests | `GET /api/v1/operations/requests/<id>/attachments/<id>/download` | planned | |

## Submission

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| OPS-05 | Submit a request | staff2 | `pending` at stage 1; in the reviewer's `/operations/pending` | `POST /api/v1/operations/requests/<id>/<id>` `page /operations/pending` | planned | |
| OPS-116 | Submit confirmation | staff2 | Inline «إرسال الطلب للموافقة؟»; stages and reviewers are listed after submit; history shows «أُرسل للموافقة» | `page /operations/[id]` | planned | |
| OPS-13 | Submit to an unpublished process; stage whose only reviewer is the requester | staff2 | Refused | `POST /api/v1/operations/requests/<id>/<id>` | planned | 422 `The process must be published before submission.` / `A stage has no eligible reviewer other than the requester.` |
| OPS-117 | Submit when a stage reviewer lost the review capability or was deactivated | staff2 | Refused with `A stage has no eligible reviewer other than the requester.` unless another eligible reviewer remains | `POST /api/v1/operations/requests/<id>/<id>` | planned | |
| OPS-118 | Requester is also a listed reviewer of a stage | pm | The requester is excluded from that stage; other reviewers of the stage can still decide | `POST /api/v1/operations/requests/<id>/<id>` | planned | |
| OPS-119 | Submit by someone other than the requester | pm | 403 `Only the requester can edit an open draft.`; the button is hidden | `POST /api/v1/operations/requests/<id>/<id>` | planned | |
| OPS-120 | Submit twice | staff2 | Second submit (pending) is refused 403; the page shows no submit button | `POST /api/v1/operations/requests/<id>/<id>` | planned | |
| OPS-121 | Submit with a stale revision | staff2 | 409 `conflict` | `POST /api/v1/operations/requests/<id>/<id>` | planned | |
| OPS-122 | Process becomes unpublished between create and submit | staff2 | 422 `The process must be published before submission.`; requester can still withdraw | `POST /api/v1/operations/requests/<id>/<id>` | planned | |
| OPS-123 | Submission creates the stage snapshot and a new cycle | staff2 | Cycle number +1; stage names, reviewers and the process revision are frozen; detail shows each stage as waiting or pending | `GET /api/v1/operations/requests/<id>` | planned | |
| OPS-124 | Personal request submit | staff1 | Employee-purpose request submitted from `/account/requests/<id>` | `page /operations/self/[id]` `POST /api/v1/operations/requests/<id>/<id>` | planned | See self-service section |

## Stage approvals

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| OPS-06 | Stage reviewer approves; next stage reviewer approves; final approval | pm → hr_manager → ceo | `done`; audit trail lists each decision | `POST /api/v1/operations/requests/<id>/<id>` `page /operations/[id]` | planned | |
| OPS-125 | Open the request as the current reviewer | pm | Section «قرارك مطلوب على هذا الطلب» with «اعتماد», «رفض», «إعادة للتعديل» | `page /operations/[id]` `GET /api/v1/operations/requests/<id>` | planned | |
| OPS-126 | Approve with and without a comment | pm | Inline «اعتماد هذه المرحلة؟»; comment is optional and stored in history; stage turns approved and the next stage becomes pending | `POST /api/v1/operations/requests/<id>/<id>` | planned | |
| OPS-127 | Comment longer than 4000 characters | pm | 422 `Invalid comment.` | `POST /api/v1/operations/requests/<id>/<id>` | planned | |
| OPS-128 | Final approval executes once | pm | State `done`, history «اعتمد مرحلة» then «اكتمل الطلب», `execution_count` is 1; no more actions | `POST /api/v1/operations/requests/<id>/<id>` | planned | Odoo test `test_two_stages_execute_once_after_final_approval` |
| OPS-12 | Reviewer of a later stage acts early | ceo | Refused | `POST /api/v1/operations/requests/<id>/<id>` | planned | 403 `Only the current stage reviewer can decide this request.`; the request is absent from the later reviewer's pending list until its turn |
| OPS-10 | Requester reviews own request | reviewer who submitted | Refused | `POST /api/v1/operations/requests/<id>/<id>` | planned | 403 `This request is not available for your decision.` |
| OPS-11 | Operations manager tries to review | ops_manager | Refused | `POST /api/v1/operations/requests/<id>/<id>` `cap operations.requests.review` | automated | `e2e/tests/access-matrix.e2e.ts`: /operations/pending refused for ops_manager; 403 `forbidden` |
| OPS-129 | Approve a request that is not pending | pm | 403 for draft, returned, rejected, withdrawn or done requests | `POST /api/v1/operations/requests/<id>/<id>` | planned | |
| OPS-130 | Approve twice | pm | Second call is refused; the stage is already approved | `POST /api/v1/operations/requests/<id>/<id>` | planned | |
| OPS-131 | Two reviewers of the same stage decide at once | pm, ceo | One decision wins; the other receives 409 `conflict` or a 403 and sees the refreshed state | `POST /api/v1/operations/requests/<id>/<id>` | planned | |
| OPS-132 | Approve with a stale revision | pm | 409 `conflict`; page shows «تغيّر السجل منذ فتحه…» with «تحديث البيانات» | `POST /api/v1/operations/requests/<id>/<id>` | planned | |
| OPS-133 | Unknown request action | pm | `POST .../requests/<id>/cancel` answers 404 `Unknown request action.` | `POST /api/v1/operations/requests/<id>/<id>` | planned | |
| OPS-134 | Decision on a hidden request | staff1 | 404 | `POST /api/v1/operations/requests/<id>/<id>` | planned | |
| OPS-135 | Decision after the reviewer was removed from the company | pm | Refused; request cannot proceed until resubmitted with eligible reviewers | `POST /api/v1/operations/requests/<id>/<id>` | planned | |
| OPS-136 | Raw engine buttons are blocked | pm | Direct calls to the generic tier validation methods answer 403 (`Use the operations approve action.`) | `POST /api/v1/operations/requests/<id>/<id>` | planned | Odoo test `test_raw_writes_tokens_and_generic_engine_buttons_are_denied` |

## Return, reject and withdraw

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| OPS-07 | Reviewer returns for change; requester edits and resubmits | pm → staff2 | `returned` then `pending` again | `POST /api/v1/operations/requests/<id>/<id>` `PATCH /api/v1/operations/requests/<id>` | planned | |
| OPS-08 | Reviewer rejects | pm | `rejected`; no further stages | `POST /api/v1/operations/requests/<id>/<id>` | planned | |
| OPS-137 | Reject and return require a reason | pm | Client shows «هذا الحقل مطلوب» on the comment; API 422 `Invalid comment.` for blank | `POST /api/v1/operations/requests/<id>/<id>` | planned | Odoo test `test_disabled_reviewer_and_empty_return_reason_are_denied` |
| OPS-138 | Reject confirmation | pm | Inline «رفض الطلب؟»; history shows «رفض الطلب» with the reason; requester sees the state «مرفوض» | `page /operations/[id]` | planned | |
| OPS-139 | Return confirmation | pm | Inline «إعادة الطلب إلى مقدمه؟»; state «معاد للتعديل»; requester's account summary raises attention | `page /operations/[id]` | planned | |
| OPS-140 | Rejected request is final | staff2 | No edit, submit or withdraw; withdraw API answers 403 `Only the requester can withdraw an open request.` | `POST /api/v1/operations/requests/<id>/<id>` | planned | |
| OPS-141 | Returned request resubmitted starts a new cycle | staff2, pm | Reviews restart from stage 1; cycle +1; earlier decisions remain in history | `POST /api/v1/operations/requests/<id>/<id>` | planned | Odoo test `test_return_restarts_cycle_and_preserves_audit` |
| OPS-142 | Return at stage 2 then resubmit | staff2, pm, hr_manager | Stage 1 reviewer must approve again | `POST /api/v1/operations/requests/<id>/<id>` | planned | |
| OPS-09 | Requester withdraws while pending | staff2 | `withdrawn` | `POST /api/v1/operations/requests/<id>/<id>` | planned | |
| OPS-143 | Withdraw confirmation and comment | staff2 | Inline «سحب الطلب؟»; optional comment stored; request leaves reviewers' pending list | `page /operations/[id]` | planned | |
| OPS-144 | Withdraw a draft or a returned request | staff2 | Allowed; state `withdrawn` | `POST /api/v1/operations/requests/<id>/<id>` | planned | |
| OPS-145 | Withdraw a done, rejected or withdrawn request | staff2 | 403 | `POST /api/v1/operations/requests/<id>/<id>` | planned | |
| OPS-146 | Reviewer or other user withdraws | pm | 403; no «سحب الطلب» button | `POST /api/v1/operations/requests/<id>/<id>` | planned | |
| OPS-147 | Review evidence kept after withdraw | staff2 | History still lists the earlier approvals | `GET /api/v1/operations/requests/<id>` | planned | Odoo test `test_withdrawal_preserves_review_evidence` |
| OPS-148 | Withdrawn request cannot be resubmitted | staff2 | No edit or submit; a new request is required | `PATCH /api/v1/operations/requests/<id>` | planned | |

## Lists, scopes and visibility

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| OPS-149 | Open «بانتظار موافقتي» | pm | Only pending requests whose current stage includes the user; columns include the requester; KPI «بانتظار مراجعتي» | `page /operations/pending` `GET /api/v1/operations/requests` | planned | |
| OPS-150 | Empty pending list | pm | «لا توجد طلبات في هذه القائمة» | `page /operations/pending` | planned | |
| OPS-151 | Pending list follows the stage | pm, ceo | A later-stage reviewer sees the request only after the earlier stage is approved; it leaves the list after the reviewer decides | `page /operations/pending` | planned | Odoo test `test_pending_queue_follows_current_stage_and_monitoring_needs_its_capability` |
| OPS-152 | State filter | staff2 | «كل الحالات», draft, pending, returned, rejected, withdrawn, done each narrow the list; state is kept in the URL; invalid state answers 422 field `state` | `page /operations` `GET /api/v1/operations/requests` | planned | |
| OPS-153 | Search by title | staff2 | `q` matches the request title; clearing restores the list; no match shows the no-results text | `page /operations` | planned | |
| OPS-154 | Pagination | staff2 | 20 per page; `page` kept in URL; disabled while fetching | `page /operations` | planned | |
| OPS-155 | Direct link, refresh and back keep filters | staff2 | Opening a request from a filtered list and going back returns to the same search, state and page; back label follows the origin («طلباتي», «بانتظار موافقتي», «متابعة التنفيذ») | `page /operations/[id]` `page /operations` | planned | |
| OPS-156 | Request detail of a hidden request | staff1 | 404 state | `page /operations/[id]` `GET /api/v1/operations/requests/<id>` | planned | Odoo test `test_hidden_request_and_other_company_request_are_404` |
| OPS-157 | Non-numeric request id | staff2 | `/operations/abc` shows the 404 state | `page /operations/[id]` | planned | |
| OPS-158 | Request of another company | staff2 | 404 `not_found` on detail, patch and transitions | `GET /api/v1/operations/requests/<id>` | planned | Odoo test `test_request_patch_of_foreign_request_is_rejected` |
| OPS-159 | List API scope and paging errors | staff2 | `scope=all` answers 422 field `scope`; `purpose=x` 422; `limit=0` uses the default, `limit=abc` 422, limit capped at 200 | `GET /api/v1/operations/requests` | planned | |
| OPS-160 | Detail page content | staff2 | Tags (state and process), description, stages with per-stage status, attachments, history, aside with requester and date | `page /operations/[id]` | planned | |
| OPS-161 | Request detail shows only allowed actions | staff2, pm | `allowed_actions` decides the buttons: requester gets edit, submit, withdraw on draft; reviewer gets approve, reject, return on a pending request | `GET /api/v1/operations/requests/<id>` | planned | Odoo test `test_serializer_has_only_contract_keys_and_server_actions` |
| OPS-162 | Rail attention for reviewers | pm | Pending requests appear in the attention area with «من <requester>» linking to `/operations/<id>` | `page /operations/pending` | planned | `modules/operations/attention.ts` |

## Monitoring

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| OPS-14 | Monitoring page | ops_manager | Every request with its stage; staff1 refused | `page /operations/monitoring` `cap operations.monitoring.read` | planned | |
| OPS-163 | Monitoring KPIs | ops_manager | Tiles «بانتظار الاعتماد / معادة للتعديل / مرفوضة / مكتملة» equal the list totals per state; KPI visibility toggle persists | `page /operations/monitoring` | planned | |
| OPS-164 | Monitoring filters and search | ops_manager | State filter and search work and are kept in the URL | `page /operations/monitoring` | planned | |
| OPS-165 | Monitoring includes employee-affairs requests | ops_manager | Doubtful: monitoring and pending lists do not filter on purpose, so personal service requests appear to the process manager and reviewers | `page /operations/monitoring` `GET /api/v1/operations/requests` | decision | UI sends no `purpose` for these scopes (`composables/operations/useOperations.ts:9`) |
| OPS-166 | Monitoring access removed | ops_manager | After the capability is revoked the list is empty or refused and other users' request ids answer 404 | `GET /api/v1/operations/requests` | planned | Odoo test `test_monitoring_and_configuration_rules_use_selected_company` |
| OPS-167 | Monitoring is company scoped | ops_manager | Requests of another company never appear | `GET /api/v1/operations/requests` | planned | |

## Self-service requests (employee affairs)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| OPS-168 | Open «طلباتي» in the account area | staff1 | `/account/requests` lists only employee-purpose requests, without the requester column; description «طلبات خدماتك الوظيفية…» | `page /operations/self` `GET /api/v1/operations/requests` | planned | |
| OPS-169 | Link to leave requests | staff1 | «متابعة طلبات الإجازة» appears when HR is enabled and opens the leave list | `page /operations/self` | planned | |
| OPS-170 | Create a personal request | staff1 | «طلب خدمة وظيفية» opens `/account/requests/new`; picker lists published employee processes only; saved request opens `/account/requests/<id>` | `page /operations/self/new` `POST /api/v1/operations/requests` | planned | |
| OPS-171 | Personal record page offers only submit and withdraw | staff1 | Approve, reject and return are hidden even for a reviewer opening their own personal request | `page /operations/self/[id]` | planned | |
| OPS-172 | Personal edit | staff1 | `/account/requests/<id>/edit` works on a draft or returned request; blocked otherwise | `page /operations/self/[id]/edit` | planned | |
| OPS-173 | Own employee request by id | staff1 | Opens; a work request id or another user's request answers 404 | `GET /api/v1/operations/requests/employee/me/<id>` | planned | Odoo test `test_self_service_request_detail_requires_own_employee_purpose` |
| OPS-174 | Work requests do not appear under personal requests | staff1 | Lists are separated by purpose: «طلباتي» in `/operations` sends `purpose=work`, the account list sends `purpose=employee` | `GET /api/v1/operations/requests` | planned | Odoo test `test_self_service_purpose_filters_do_not_change_own_and_pending_scope` |
| OPS-175 | Returned personal request raises attention | staff1 | Account summary shows «أُعيد إليك الطلب لاستكماله.» linking to the request | `page /operations/self` | planned | `modules/operations/personal.ts` |
| OPS-176 | Personal pages without create capability | custom role (operations.requests.read only) | No «طلب خدمة وظيفية» button; `/account/requests/new` and `/edit` forbidden | `page /operations/self/new` | planned | |

## PMO completion (webvue_operations_pmo)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| OPS-177 | Create a completion process | ops_manager | Result kind «إكمال مهمة مشروع»; final stage reviewer must be the designated PMO completion reviewer | `POST /api/v1/operations/processes` | planned | |
| OPS-178 | Final stage is not the designated reviewer | staff1 | Submit refused: `The final stage must use the designated PMO completion reviewer.` | `POST /api/v1/operations/requests/<id>/<id>` | planned | |
| OPS-179 | Request form asks for a linked task | staff1 | «البحث في السجلات المرتبطة» and «السجل المرتبط» appear; only own open tasks of projects with completion approval are offered; empty result shows «لا توجد سجلات متاحة لهذا الإجراء.» | `page /operations/new` `GET /api/v1/operations/processes/<id>/targets` | planned | Targets limited to 50 and need `pmo.tasks.read` |
| OPS-180 | Targets for an approval-only process | staff1 | Empty list | `GET /api/v1/operations/processes/<id>/targets` | planned | |
| OPS-181 | Targets without `operations.requests.create` or PMO off | custom role (operations.requests.read only) | 403 `forbidden`; PMO off answers 403 `feature_not_included` | `GET /api/v1/operations/processes/<id>/targets` | planned | |
| OPS-182 | Missing target on create | staff1 | Client shows required; API 422 `Choose a valid task.` for a bad id; 403 `The task is not available.` for a hidden or other-company task | `POST /api/v1/operations/requests` | planned | Odoo test `test_other_company_or_hidden_target_is_not_allowed` |
| OPS-183 | Task the caller cannot request completion for | staff1 | 403 `You cannot request completion for this task.` | `POST /api/v1/operations/requests` | planned | |
| OPS-184 | Submit marks the task as completion-pending | staff1 | Project task shows the pending completion; detail page shows a link to the task | `page /operations/[id]` `POST /api/v1/operations/requests/<id>/<id>` | planned | |
| OPS-185 | Final approval completes the task once | pm | Task is accepted and done; request `done` | `POST /api/v1/operations/requests/<id>/<id>` | planned | Odoo test `test_completion_uses_original_pmo_policy_once` |
| OPS-186 | Independent PMO decision makes the operation stale | pm | Approval fails with 422 `execution_failed`; the decision is rolled back; history shows «تعذر إكمال الطلب»; UI text «تعذر إكمال الطلب، ولم تُحفظ الموافقة النهائية…» | `POST /api/v1/operations/requests/<id>/<id>` | planned | Odoo tests `test_an_independent_pmo_decision_makes_operation_stale`, `test_approval_failure_rolls_back_decision_effect_and_execution_claim` |
| OPS-187 | Withdraw releases the task completion | staff1 | Task is no longer pending completion | `POST /api/v1/operations/requests/<id>/<id>` | planned | |
| OPS-188 | Another user submits a pending completion | staff2 | 403 `Only the original completion requester can submit this operation.` | `POST /api/v1/operations/requests/<id>/<id>` | planned | |
| OPS-189 | Task link hidden after access is lost | staff1 | Detail shows no target link instead of an error | `GET /api/v1/operations/requests/<id>` | planned | |

## Feature, tenant and company boundaries

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| OPS-190 | Operations feature switched off | staff2 | Rail and nav hide Operations; every route answers 403 `feature_not_included`; writes and decisions blocked | `GET /api/v1/operations/requests` `POST /api/v1/operations/requests` | planned | Odoo test `test_feature_closure_blocks_orm_and_http_decisions` |
| OPS-191 | Read-only tenant (expired) | staff2 | Lists and detail open; create, edit, submit, decide answer 403 `tenant_read_only` | `POST /api/v1/operations/requests/<id>/<id>` | planned | See SaaS scenarios |
| OPS-192 | Suspended tenant | staff2 | 403 `tenant_suspended` | `GET /api/v1/operations/requests` | planned | |
| OPS-193 | Non-SaaS mode | staff2 | Operations works without any vendor connection | `page /operations` | planned | |
| OPS-194 | Unknown fields and paging rejected by every route | staff2 | 422 `Invalid request fields.` for bodies, 422 for bad `limit` and `offset` | `GET /api/v1/operations/requests` | planned | Odoo test `test_http_rejects_unknown_fields_and_invalid_pagination` |
| OPS-195 | Permission and revision status codes | pm | 403 for capability, 404 for hidden, 409 for stale revision | `GET /api/v1/operations/requests/<id>` | planned | Odoo test `test_http_permissions_and_revision_status` |
| OPS-196 | Parent-company privilege does not leak to a child company | custom role (parent company manager) | Private child-company requests and unpublished child processes stay hidden | `GET /api/v1/operations/processes` | planned | Odoo tests in `test_owning_company_access.py` |

## Audit trail and notifications

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| OPS-197 | History lists every decision | staff2 | «سجل الطلب» shows actor, time and comment for submitted, approved, rejected, returned, withdrawn, executed and execution_failed events, oldest first | `page /operations/[id]` | planned | |
| OPS-198 | History is empty before submit | staff2 | «يبدأ سجل الموافقة عند إرسال الطلب.» | `page /operations/[id]` | planned | |
| OPS-199 | Audit cannot be edited | it_admin | No route edits or removes events; ORM write and unlink are refused | `GET /api/v1/operations/requests/<id>` | planned | |
| OPS-200 | Each event carries evidence | pm | Process revision, stage list, review statuses and execution count are recorded per event (visible to testers through the Odoo shell only) | `GET /api/v1/operations/requests/<id>` | planned | |
| OPS-15 | Notifications at each stage | all | Owner check: no bell kinds registered for operations today | `page /operations/pending` | decision | Reviewers may never learn a request is waiting; the rail attention (OPS-162) is the only prompt |
| OPS-201 | Requester is told of the decision | staff2 | Requester learns of approval, rejection or return only by opening the request or the account summary | `page /operations` | decision | Same owner decision as OPS-15 |
