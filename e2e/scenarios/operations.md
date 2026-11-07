# Operations (requests and approvals)

Pages: `/operations`, `/operations/new`, `/operations/[id]`, `/operations/pending`,
`/operations/monitoring`, `/operations/self/*` (served at `/account/requests`), settings
`/settings/apps/operations/processes`. Owners: `liwan_operations` (approvals through OCA
`base_tier_validation`, one sequential tier per stage), `liwan_operations_pmo`.
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
| OPS-20 | Reviewer without `operations.processes.manage` opens process settings | pm | Settings has no «إعداد الإجراءات» part; `/settings/apps/operations/processes` shows «ليس لديك صلاحية لهذا الإجراء»; execution-kinds answers 403 | `page /settings/apps/operations/processes` `GET /api/v1/operations/execution-kinds` `cap operations.processes.manage` | automated | `e2e/tests/access-matrix.e2e.ts` |
| OPS-21 | Process manager creates a process and cannot review | ops_manager | The pending list opens (it needs `operations.requests.read`, which every employee role holds); the review ACTION is refused: scope=pending answers 403 `operations.requests.review capability is required` | `page /operations/pending` `cap operations.requests.review` | automated | `e2e/tests/access-matrix.e2e.ts` (2026-11-06): the list opens for all 11 personas and no review action is offered to ops_manager; corrected 2026-11-06 — the row claimed the page itself was refused, which neither the code (`routeCapabilities` gates /operations/pending on `operations.requests.read`) nor the seeded groups do; the review decision itself is OPS-11 |
| OPS-22 | Employee without `operations.monitoring.read` opens monitoring | staff1 | `/operations/monitoring` shows the forbidden state; scope=monitoring answers 403 `operations.monitoring.read capability is required` | `page /operations/monitoring` `cap operations.monitoring.read` | automated | `e2e/tests/access-matrix.e2e.ts` |

## Process list in settings

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |

## Process designer: create and edit

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| OPS-01 | Create a process with three stages and reviewers, publish | ops_manager | `published`; visible in `/operations/new` | `page /settings/apps/operations/processes/new` `POST /api/v1/operations/processes` `POST /api/v1/operations/processes/<id>/<id>` `page /operations/new` `cap operations.processes.manage` | automated | `e2e/tests/operations-approval-journey.e2e.ts`; ops_manager created «عنوان تجربة» with 3 stages and published it after the reviewer fix (see OPS-66); listed in /operations/new |
| OPS-47 | Create with a blank or over-long name or description | ops_manager | 422 `invalid` (`Invalid name.` over 200 characters or blank, `Invalid description.` over 20000) | `POST /api/v1/operations/processes` | automated | #197; blank or 201-char name 422 Invalid name. and over-long description 422 Invalid description.; a missing name key now answers 422 Invalid name. before any row is created (`test_a_process_without_a_name_key_answers_the_name_message`) |
| OPS-55 | Edit an archived process | ops_manager | Refused: saving an archived process answers 422 `invalid` «An archived process cannot be changed.»; the process stays archived with the same revision. The process page hides «تعديل» for an archived process and its edit page shows «لا يمكن تعديل إجراء مؤرشف.» | `PATCH /api/v1/operations/processes/<id>` | planned | #163 owner decision 2026-10-29: refusal instead of un-archiving; `models/process.py:action_configure`; Odoo test `test_archived_process_cannot_be_reconfigured` |

## Process lifecycle (draft, published, archived)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| OPS-66 | Publish a process whose reviewer lacks the review capability | ops_manager | 422 `reviewer_not_eligible`; the page shows that message and the process stays draft (save of such a reviewer is allowed, publish is not) | `POST /api/v1/operations/processes/<id>/<id>` | automated | #134 closed 2026-10-31; `test_publishing_with_an_ineligible_reviewer_answers_a_specific_code`; the reviewer picker marking ineligible people (`ineligible_reviewer_ids`) is in the same payload; not re-run in the UI |
| OPS-71 | Archive an already archived process through the API | ops_manager | Refused: a second archive answers 422 `invalid` «This process is already archived.» and the revision does not grow; the UI hides the button | `POST /api/v1/operations/processes/<id>/<id>` | planned | #163 owner decision 2026-10-29; `models/process.py:action_archive`; Odoo test `test_archiving_an_archived_process_is_refused_without_a_revision_bump` |

## Process options and their effects

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| OPS-86 | Same reviewer on two consecutive stages | ops_manager, pm | The reviewer approves stage 1, then stage 2 as a separate decision | `POST /api/v1/operations/requests/<id>/<id>` | fail | #163; round 2: process with two consecutive stages both reviewed by pm: one approve moved BOTH stages to approved and the request to done; the second approve answered 403 «This request is not available for your decision.»; see findings2 |

## Creating a request (mine)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| OPS-94 | Create against a draft, archived or other-company process | staff2 | 422 `Choose a published process from the current company.` | `POST /api/v1/operations/requests` | automated | #197; `test_a_process_the_requester_cannot_see_is_refused_with_the_request_message`: a draft, archived or missing process answers 422 with the message, never the engine access text |
| OPS-100 | Create while the user is in another company session | staff2 | Request belongs to the current company only; other company users get 404 on its id | `POST /api/v1/operations/requests` | automated | #197; round 2: root request created by staff2 answers 404 for the Dammam manager (detail, patch, submit); Dammam request answers 404 for ops_manager, staff2 and the Jeddah user; a request on a process the caller cannot see answers the structured 422 (`test_a_process_the_requester_cannot_see_is_refused_with_the_request_message`); Odoo test `test_operations_lists_exclude_other_companies` |

## Editing a draft and attachments

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |

## Submission

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| OPS-05 | Submit a request | staff2 | `pending` at stage 1; in the reviewer's `/operations/pending` | `POST /api/v1/operations/requests/<id>/<id>` `page /operations/pending` | automated | `e2e/tests/operations-approval-journey.e2e.ts`; staff2 request #1 went pending at stage 1 and appeared in pm's «بانتظار موافقتي» and home «للقرار 1» |
| OPS-13 | Submit to an unpublished process; stage whose only reviewer is the requester | staff2 | Refused | `POST /api/v1/operations/requests/<id>/<id>` | automated | #197; `test_submitting_after_the_process_went_back_to_draft_is_a_validation_error` covers the unpublished process; only-reviewer-is-requester already gave 422 A stage has no eligible reviewer other than the requester. |
| OPS-122 | Process becomes unpublished between create and submit | staff2 | 422 `The process must be published before submission.`; requester can still withdraw | `POST /api/v1/operations/requests/<id>/<id>` | automated | #197; `test_submitting_after_the_process_went_back_to_draft_is_a_validation_error`: 422 `The process must be published before submission.`; withdraw still works |

## Stage approvals

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| OPS-06 | Stage reviewer approves; next stage reviewer approves; final approval | pm → hr_manager → ceo | `done`; audit trail lists each decision | `POST /api/v1/operations/requests/<id>/<id>` `page /operations/[id]` | automated | `e2e/tests/operations-approval-journey.e2e.ts`: three distinct reviewers approve in order |
| OPS-12 | Reviewer of a later stage acts early | ceo | Refused | `POST /api/v1/operations/requests/<id>/<id>` | automated | `e2e/tests/operations-approval-journey.e2e.ts`: request absent from the stage-3 reviewer's pending list while stage 1 is open; 403 `Only the current stage reviewer can decide this request.`; the request is absent from the later reviewer's pending list until its turn |
| OPS-11 | Operations manager tries to review | ops_manager | Refused | `POST /api/v1/operations/requests/<id>/<id>` `cap operations.requests.review` | automated | `e2e/tests/access-matrix.e2e.ts`: /operations/pending refused for ops_manager; 403 `forbidden` |
| OPS-131 | Two reviewers of the same stage decide at once | pm, ceo | One decision wins; the other receives 409 `conflict` or a 403 and sees the refreshed state | `POST /api/v1/operations/requests/<id>/<id>` | fail | #213; round 2: pm and ceo approved the same single-stage request at once: ceo 200 done, pm 422 invalid «Cannot grab a lock on records» (raw English engine text, 422 instead of 409 conflict); a later approval with the stale revision correctly answers 409 conflict «This record changed. Refresh and try again.»; see findings2 |

## Return, reject and withdraw

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| OPS-07 | Reviewer returns for change; requester edits and resubmits | pm → staff2 | `returned` then `pending` again | `POST /api/v1/operations/requests/<id>/<id>` `PATCH /api/v1/operations/requests/<id>` | automated | `e2e/tests/operations-approval-journey.e2e.ts`; return needs a comment («هذا الحقل مطلوب» when empty); edited and resubmitted; history lists each step; but see OPS-203 |

## Lists, scopes and visibility

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |

## Monitoring

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| OPS-165 | Monitoring includes employee-affairs requests | ops_manager | One list stays, with a type filter «كل الأنواع» / «طلبات العمل» / «شؤون الموظفين الشخصية» on «بانتظار موافقتي» and «متابعة التنفيذ»; it sends `purpose` to the API and stays in the URL (`?purpose=work\|employee`) across refresh, back and the record return link. Without a filter both types are listed | `page /operations/monitoring` `GET /api/v1/operations/requests` | planned | #163 owner decision 2026-10-29; `components/operations/RequestList.vue`; an invalid `purpose` answers 422; Odoo test `test_shared_lists_filter_by_purpose` |

## Self-service requests (employee affairs)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |

## PMO completion (liwan_operations_pmo)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |

## Feature, tenant and company boundaries

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |

## Audit trail and notifications

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| OPS-15 | Notifications at each stage | all | Owner check: no bell kinds registered for operations today | `page /operations/pending` | decision | #158; Confirmed 2026-10-28: no bell to either side; after a return the requester's home shows nothing to do (للتنفيذ 0); the reviewer sees the request under «للقرار»; Reviewers may never learn a request is waiting; the rail attention (OPS-162) is the only prompt |
| OPS-201 | Requester is told of the decision | staff2 | Requester learns of approval, rejection or return only by opening the request or the account summary | `page /operations` | decision | #158; Same owner decision as OPS-15 |
| OPS-202 | The same reviewer sits on several consecutive stages | pm | Follows the process setting «المراجع المتكرر في أكثر من مرحلة»: «اعتماد لكل مرحلة» (default) approves only the current stage per decision; «اعتماد واحد يكفي» approves all of that reviewer's consecutive stages at once. A submitted request keeps the mode it was submitted under; reject and return are unchanged | `POST /api/v1/operations/requests/<id>/<id>` | planned | #163 owner decision 2026-10-29; `stage_approval_mode` on the process, snapshotted on the request at submission; Odoo tests `test_per_stage_mode_is_the_default_and_needs_one_decision_per_stage`, `test_single_mode_covers_the_reviewers_consecutive_stages`, `test_pending_request_keeps_the_mode_it_was_submitted_under` |
| OPS-203 | Stage labels after a return for change | staff2 | Stages show they are waiting for resubmission | `page /operations/[id]` | automated | #135 closed 2026-10-31; `dump_request` shows stage statuses only for an open, rejected or finished request, covered by `test_stage_statuses_match_the_request_state_in_every_state` (returned and withdrawn included) |
