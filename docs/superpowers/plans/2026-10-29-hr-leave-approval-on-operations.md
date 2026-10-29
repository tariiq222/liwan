# Implementation plan: HR-60 leave approval on the operations workflow engine (new bridge `webvue_hr_operations`)

Status: plan, 2026-10-29. Owner decision: tariiq222/webvue#165 (HR-60), comments «قرارات المالك 2026-10-29» and
«تكملة قرار المالك 2026-10-29». No code exists yet. Task 1 starts after the #163 operations change merges,
because both edit `webvue_operations/models/process.py` and `operation_request.py`.


The engine already supports most of what this needs. Requests keep the stages of the process revision they were submitted on, so a process change only affects new requests. What it lacks: a reviewer worked out from the request's record, a rejection hook, and a trusted way to create the default process. The biggest risk is not the dynamic reviewer. It is that stock `hr.leave` lets only some users refuse a leave, so a refusal at an early stage may fail (see section 5, question 1).

## 1. Current state

**Leave in `webvue_hr`**
- `models/hr_leave.py:9-12`: the only override. It blocks a direct `state='cancel'` write. Approval is fully stock.
- `controllers/hr_leave.py:249-264`: `POST /api/v1/hr/leave/requests` (needs `hr.leave.request`) creates a stock `hr.leave`, which starts in `confirm`. Types set to `no_validation` are approved automatically inside stock `create` (`hr_holidays/models/hr_leave.py:939-942`).
- `controllers/hr_leave.py:266-289`: approve and refuse (needs `hr.leave.approve`, never on your own request) call stock `action_approve()` and `action_refuse()`.
- `controllers/hr_leave.py:291-304`: withdrawing a `confirm` leave calls `leave.unlink()`.
- `controllers/hr_leave.py:50-65`: visibility is your own requests, plus staff in companies where you hold approve or manage.
- `serializers/hr_leave.py:39-81` (`dump_leave`): `can_approve` and `can_refuse` come from stock `can_approve`, `can_validate` and `can_refuse`.
- `security/hr_capability_groups.xml:24-25`: `hr.leave.approve` and `hr.leave.manage` imply `hr_holidays.group_hr_holidays_user` (the stock "officer" group).
- `models/leave_settings.py`: a per-company leave settings model that holds only the cancellation policy.
- `models/res_company.py:20-25`: the precedent for seeding data when a company is created.

**Stock rules that limit the design** (`/Users/tariq/code/odoo/addons/hr_holidays/models/hr_leave.py`)
- `write` (`:948-975`) runs `_check_approval_update`, which allows a state change only to officers or to the employee's `leave_manager_id`, and only per `validation_type` (`:1373-1418`).
- An officer can go straight from `confirm` to `validate` for every type, so one officer `action_approve()` finishes any type (`:1149-1163`, `:1396-1403`).
- A `leave_manager_id` who is not an officer can refuse only when `validation_type != 'hr'` (`:1404-1410`).
- Nobody else can refuse without superuser rights.

**Self-service UI**
- `apps/web/app/pages/hr/self/leave.vue`, `leave/new.vue` and `leave/[leaveId].vue` serve `/account/leave*` through `definePageMeta` path overrides.
- `components/hr/LeaveRecord.vue` (149 lines) is shared with `/hr/leave/:id` and shows approve and refuse buttons.
- `pages/settings/apps/hr/index.vue` holds `LeaveSettingsForm.vue`. Its header comment sets a precedent: the finance-bridge card appears only when the bridge route answers, and a 404 or 403 hides it.

**Operations engine (`webvue_operations`)**
- `models/process.py:22,29-34`: `execution_kind` is a Char field, extended through `_operations_execution_kinds()`. `_operations_targets(q)` is the target picker hook.
- `process.py:62-84` (`action_configure`): rebuilds the steps and sets `state='draft'`, then `revision+1`. Each step must be exactly `{name, reviewer_ids}`, and `reviewer_ids` is required (`:134`, `common.py:36-42`).
- `process.py:86-111` (`action_publish`): checks that every reviewer holds `operations.requests.review`. It creates one immutable `tier.definition` per step, scoped by `definition_domain` to the process and revision (`:104`). Definitions can never be deleted (`:188-194`).
- `process.py:200-205`: `tier.review._get_reviewers` reads the fixed `definition.operations_reviewer_ids`.
- `operation_request.py:48-58`: hooks `_operations_target_values`, `_operations_prepare_submission` and `_operations_target`.
- `operation_request.py:126-157` (`action_submit`): requires a published process. It snapshots `process_revision` and `stage_snapshot` (the eligible reviewers per stage, filtered by `operations.requests.review`) before `request_validation()`. This snapshot is why pending requests stay on the stages they started with.
- `operation_request.py:159-170`: the decision guard needs `operations.requests.review` and membership of the stage in the snapshot.
- `operation_request.py:172-200`: `_execute_approved()` runs only on final approval, inside a savepoint. A failure becomes `OperationExecutionError`, the approval is rolled back and an audit event is written.
- `operation_request.py:202-215`: reject and return have **no execution hook**.
- `operation_request.py:253-260`: `_operations_allowed_actions()`.
- `models/ir_rule.py:23-26`: the requester and `participant_ids` can read their requests.
- `controllers/operations.py:52-58`: the execution kinds route.
- `controllers/operations.py:68-83`: the process list. It has no filter for "creatable by hand".
- `access_service.py:5-7`: `role_employee` has `requests.read` and `requests.create`. Review is only in the reviewer role.
- `test_operations_workflow.py:322` shows that even the superuser needs a role assignment to pass the `processes.manage` check.

**PMO bridge pattern** (`webvue_operations_pmo/models/operations.py`)
- It registers the kind only when `pmo.enabled` can be written (`:9-14`).
- It resolves and authorizes the target in the caller's own identity (`:28-45`).
- At submission it checks that the final stage is the designated reviewer and creates the native pending state (`:47-61`).
- On final approval it calls the native method in the approver's own identity; a stale target fails safely (`:63-72`, test `:43-50`).
- It mirrors withdraw (`:83-90`).
- There are no data files and no `sudo()`.

## 2. Target design

### 2a. Generic changes in the engine (`webvue_operations`, must not mention HR, per R3)

1. **Reviewer resolver per stage.** This mirrors how `execution_kind` already works.
   - Add `reviewer_resolver = fields.Char()` to `webvue.operation.process.step`, with no value meaning a fixed list of users. Drop `required=True` from `reviewer_ids`. A constraint requires either a resolver or at least one user, never both.
   - Add `process._operations_reviewer_resolvers()`, which returns `()` by default and is filtered by `self.execution_kind`. Each entry is `{'key', 'label', 'capability'}`.
   - Add `request._operations_resolve_reviewers(key)`, which raises `ValidationError` by default.
   - The step payload becomes `{name, reviewer_ids, resolver}`. Configure validates the resolver against the hook. Publish copies it to a new `tier.definition.operations_reviewer_resolver` and skips the "named users need review" check for resolver stages.
2. **Snapshot is the only source of reviewers.** At submit, each snapshot entry gains `resolver` and `capability`. Resolver stages get their users from `_operations_resolve_reviewers`. The existing filters (active, internal, in the company, not the requester) and the stage capability still apply. `tier.review._get_reviewers` reads `stage_snapshot[sequence-1]['reviewer_ids']` for every operations definition, fixed and resolver alike.
3. **Capability per stage.** The decision guard, `action_approve`, `_operations_allowed_actions` and the `pending` list scope check the current stage's snapshot `capability`. This is `operations.requests.review` for fixed stages, so today's behavior is unchanged. A resolver states its own capability, because the resolver itself is the authorization (for example, "is this employee's leave approver").
4. **Rejection hook.** Add `_execute_rejected()`, a no-op by default, called inside the `_negative_decision` savepoint when the state is `rejected`. It fails the same way as approval does (`OperationExecutionError` plus an audit event).
5. **Kinds that their own application creates.**
   - Add `_operations_application_kinds()`, returning `()` by default.
   - `GET /operations/processes?requestable=1` leaves these kinds out. The self-service and new-request pages use this parameter.
   - Bridges remove `edit`, `return` and `withdraw` from `_operations_allowed_actions` and refuse those actions on the server.
6. **Trusted seed.** Add `process._operations_seed(company, vals, steps)`, which requires `self.env.su` (the install or migration operator, with no `sudo()` call). It creates, configures and publishes without the capability check and is used only by install hooks. Version bump to 19.0.1.3.0 with a migration README; the `reviewer_ids` change is schema-only, no data.

### 2b. New bridge `webvue_hr_operations`

- Rank 5, `auto_install`, depends on `webvue_hr` and `webvue_operations`, version 19.0.1.0.0, `post_init_hook`, no `sudo()`.
- **Execution kind `hr_leave`.** Registered when both `hr.enabled` and `operations.enabled` can be written. It is in `_operations_application_kinds`, and `_operations_targets` returns `[]`. Process purpose is `employee`.
- **Resolvers for `hr_leave`:**
  - `hr_leave_approver`: the employee's stock `leave_manager_id` ("Time Off approver"; stock Odoo fills it from the direct manager's user). Capability `operations.requests.read`.
  - `hr_leave_officers`: active users holding `hr.leave.approve` in the leave's company. Found by searching `group_cap_hr_leave_approve` and then checking `_webvue_has_capability(..., company=)`. Capability `hr.leave.approve`.
  - Labels are translated server-side through the bridge's `i18n`.
- **Which process governs.** The company's single published `hr_leave` process. Override `action_publish` (a public method, then `super`) to refuse a second one. Publish also checks:
  - the final stage is `hr_leave_officers`, or fixed users who all hold `hr.leave.approve` (stock lets only officers validate);
  - every other stage is one of the resolvers or fixed officers (see section 5, question 1).
- **Submission.**
  - `webvue_hr` gains a neutral hook `hr.leave._webvue_request_approval()`, a no-op in HR, called by `create_request` after `create`.
  - The bridge overrides it. If the leave is `confirm`, the company has a governing process and operations is enabled, it creates the request in the caller's identity under a bridge-private context token that the bridge's `_operations_target_values` requires.
  - Request values: `name` = "type: employee, dates" and `description` = the leave notes. This gives managers the details without reading HR.
  - `target_ref` = `{'id', 'write_date'}`. The request is then submitted (`action_submit(0)`).
  - It all runs in one transaction, so if no approver can be resolved the leave creation fails with 422.
  - Without a governing process the hook does nothing, and today's HR-role path applies.
- **Governed flag.**
  - Neutral hook `hr.leave._webvue_approval_governed()`, `False` in HR. The bridge returns `True` when an open (`pending`) request targets the leave.
  - HR approve and refuse routes answer 409 `approval_governed` for governed leaves, and `dump_leave` sets `can_approve` and `can_refuse` to false.
  - As a second line of defence, the bridge overrides the public stock `action_approve` and `action_refuse` to refuse governed leaves unless the bridge's execution token is present.
- **Final approval.** `_execute_approved` for `hr_leave` re-reads the leave in the approver's own identity, checks it is still `confirm` and unchanged (`write_date`, otherwise a stale error), then calls stock `leave.with_context(token).action_approve()`. An officer goes `confirm` to `validate` for every type.
- **Rejection.** `_execute_rejected` calls stock `action_refuse()` as the rejecting reviewer, then posts the comment on the leave.
- **Withdraw.** HR's withdraw route calls the neutral hook `_webvue_withdraw_approval()`. The bridge withdraws the request as the requester first, then HR deletes the leave as today.
- **Default process seeding.**
  - `post_init_hook`: for each company where `operations.enabled` can be written and no `hr_leave` process exists, call `_operations_seed` with "Leave approval": stage 1 "Direct manager" (`hr_leave_approver`), stage 2 "HR" (`hr_leave_officers`).
  - The bridge also overrides `res.company.create` and seeds only when `env.su` (provisioning).
  - For companies created interactively, an explicit `POST .../approval-process/default` for holders of `operations.processes.manage` creates the default process. Until then the HR-role default path applies.
- **Editing.** Uses the existing operations editor. Requests already submitted keep their revision's definitions and snapshot, which the engine already guarantees. The editor should configure and publish in one save for `hr_leave`, so new leaves never meet a draft process and fall back by accident.
- **Without the bridge (operations not installed) or with operations disabled.** The HR hooks are no-ops, and stock HR-role approval stays as it is.

## 3. Features (R10), routes, contracts and UI

- **Features.** The bridge registers no feature of its own, following the `webvue_hr_finance` precedent. Its routes use `@requires_feature('hr.enabled', 'operations.enabled')`. Capabilities are reused: `hr.leave.read` and `hr.leave.config` (HR), `operations.processes.manage` and `operations.requests.read` (operations).
- **Engine route changes:**
  - Process steps gain `resolver: string|null` and `resolver_label`.
  - New `GET /api/v1/operations/processes/<id>/reviewer-resolvers`, or with `?execution_kind=` (needs `operations.processes.manage`), returns `{items:[{key,label}], total}`.
  - `requestable=1` filter on the process list.
  - Request detail steps gain `resolver`.
- **New bridge routes:**
  - `GET /api/v1/hr/leave/requests/<id>/approval`: own leave or staff visibility, using the HR lookup helpers. Returns `{request_id, state, href, steps:[{sequence,name,reviewers,status}]}`. 404 when the leave is not governed.
  - `GET /api/v1/hr/leave/approval-process` (`hr.leave.config`): `{process|null, href, can_manage}`.
  - `POST /api/v1/hr/leave/approval-process/default` (`operations.processes.manage`).
  - Add each route to the route-gate tooling only if its gate is a top-level `require_capability` call.
- **Contracts:**
  - `packages/contracts/src/operations/index.ts`: step `resolver`, the resolvers schema, `OperationProcessBody.steps[].resolver`.
  - `packages/contracts/src/hr/index.ts`: `HrLeaveApprovalSchema` and `HrLeaveApprovalProcessSchema`, with fixtures.
- **UI:**
  - `components/operations/ProcessForm.vue` and `forms.ts`: each stage picks "Named reviewers" or a resolver from the route. Validation requires users only for named stages.
  - `RequestRecord.vue` and `OperationStepRow.vue`: show the resolver label.
  - Request-creation pages use `requestable=1`.
  - Replace the hard-coded `pmo_completion` label check (`ProcessForm.vue:33`, `processes/[id]/index.vue:59`) with server labels, to avoid naming another app (R3).
  - HR (shared components only, no operations components, per R3): `LeaveRecord.vue` gets a stages section fed by a new `useHrLeaveApproval(id)` in `composables/useHrLeave.ts`. A 404 hides it. It links to the request page for the current reviewer, and the approve and refuse buttons follow the server flags.
  - `pages/settings/apps/hr/index.vue` gets a "Leave approval stages" card. It reads the bridge route and is hidden on 404 or 403. It lists the stages and links to `/settings/apps/operations/processes/<id>/edit`. When there is no process it shows the HR default and a "Use default process" action.
  - Arabic and English locale keys.

## 4. Ordered tasks

1. **Engine extension points.**
   - Files: `webvue_operations/models/process.py`, `operation_request.py`, `common.py`, `controllers/operations.py`, `serializers/operations.py`, manifest and `migrations/19.0.1.3.0/README.md`.
   - Tests in `tests/test_operations_workflow.py`, plus a new `tests/test_reviewer_resolvers.py`: a test resolver kind defined in the test, snapshot used for reviewers, per-stage capability, a revision change leaves pending requests on old stages, reject hook rollback, `requestable` filter, seed refuses without `su`, existing fixed-stage behavior unchanged.
2. **Neutral HR hooks.**
   - Files: `webvue_hr/models/hr_leave.py`, `controllers/hr_leave.py` (call the hooks, 409 when governed), `serializers/hr_leave.py`.
   - Tests in `tests/test_hr_leave.py`: hooks are no-ops and today's path still passes.
3. **Bridge addon.**
   - Files: `odoo-addons/webvue_hr_operations/` (manifest, `__init__` with `post_init_hook`, `models/operations.py`, `models/hr_leave.py`, `models/res_company.py`, `controllers/leave_approval.py`, `serializers/`, `i18n/*.pot`, `tests/`).
   - Register it in `tools/arch_layers.json` (rank 5) and the module lists: `deploy/provision.sh:133`, `deploy/verification-checks.json:53,55`, `deploy/check_isolated.py`, `tools/webvue_cli/operator.py`, `tools/shared_acceptance_live/up.sh`, `docs/agents/repository-layout.md`.
   - Tests:
     - install seeds two stages;
     - employee submits, manager approves, officer approves, leave is `validate`;
     - manager refuses, leave is `refuse`;
     - leave changed elsewhere, approval fails as stale and rolls back;
     - HR approve route returns 409 when governed;
     - no process, HR path;
     - operations disabled, HR path;
     - no direct manager, 422;
     - a second published `hr_leave` process is refused;
     - final stage must be officers;
     - other-company leave is not found;
     - withdraw from HR withdraws the request;
     - HTTP tests for the three routes.
4. **Contracts.**
   - Files: `packages/contracts/src/operations/index.ts`, `src/hr/index.ts`, the fixtures.
   - Test: `npm test`.
5. **Operations UI.**
   - Files: `components/operations/ProcessForm.vue`, `RequestRecord.vue`, `OperationStepRow.vue`, `composables/operations/forms.ts` and `useOperations.ts`, operations locale.
   - Tests: update `ProcessForm.test.ts` and `RequestForm.test.ts`.
6. **HR UI.**
   - Files: `components/hr/LeaveRecord.vue`, `LeaveSettingsForm.vue` or a new `LeaveApprovalCard.vue`, `composables/useHrLeave.ts`, `pages/settings/apps/hr/index.vue`, HR locale.
   - Tests: `pages/hr/__tests__/self-service-leave-record.test.ts`, plus a Storybook story for any new shared-looking component.
7. **Docs and scenarios.**
   - Files: `docs/superpowers/specs/2026-10-14-webvue-operations-approvals-design.md` (resolver section), `e2e/scenarios/hr.md` and `operations.md`.
   - Coordinate with the untracked WIP `e2e/tests/hr-leave-journey.e2e.ts`, which has an unknown owner.

**Verification**
- `ruff check odoo-addons`
- `python3 -B tools/arch_policy.py`
- `npm test` (includes `sudo_gate` and the route-gate policy)
- `npm -w apps/web run lint`
- Odoo on a scratch database per `docs/agents/odoo-rules.md`, with `-i webvue_hr_operations` and `--test-tags /webvue_operations,/webvue_hr,/webvue_hr_operations,/webvue_operations_pmo`
- `deploy/ci/odoo-bridge` stage locally
- `cd apps/web && npm run test:e2e`

## 5. Implementation defaults

The owner settled the outcome (stages per company, default manager then HR, pending requests keep
their stages) and asked not to be asked again. These implementation details follow from that
decision; each is recorded here so review can judge it.

1. **Refusal by an early stage: option A.** `hr_leave` stage reviewers are the employee's leave
   approver or HR officers only; at install the bridge sets `leave_validation_type='both'` on the
   tenant's validating leave types, so a manager-stage refusal passes stock `_check_approval_update`
   without elevation or a private-method override (R9).
2. **"Direct manager" is stock `leave_manager_id`**, which Odoo fills from the manager's user and HR may edit.
3. **No resolvable approver** (no manager, or the manager is the requester): submission fails with 422 and a
   clear message; no stage is skipped silently.
4. **Who edits the leave process:** holders of `operations.processes.manage`. Employees submit through the
   bridge with `operations.requests.create`, which the built-in employee role already holds.
5. **No published process, or operations disabled:** new leaves use today's HR-role path. A leave whose
   request is still pending stays governed only while operations is enabled; when it is disabled the
   HR approve/refuse routes apply again, because "governed" checks an open request with operations enabled.
6. **A leave HR creates on someone's behalf** is governed too, with the HR actor as requester.
7. **One process per company** in this phase; per leave type is a later setting.
8. **Return for edit and edit are disabled** for leave requests (HR has no leave-edit route).
9. HR officers are resolved once at submission (the snapshot), as for every operations request.
10. Execution-kind labels come from the server (task 5), replacing the hard-coded `pmo_completion` label.

Each item becomes part of one implementation issue per task in section 4.

### Critical files for implementation
- /Users/tariq/code/webvue/odoo-addons/webvue_operations/models/process.py
- /Users/tariq/code/webvue/odoo-addons/webvue_operations/models/operation_request.py
- /Users/tariq/code/webvue/odoo-addons/webvue_operations_pmo/models/operations.py
- /Users/tariq/code/webvue/odoo-addons/webvue_hr/controllers/hr_leave.py
- /Users/tariq/code/webvue/apps/web/app/components/hr/LeaveRecord.vue