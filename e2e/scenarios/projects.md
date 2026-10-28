# Projects

Pages: `/projects`, `/projects/dashboard`, `/projects/new`, `/projects/[id]` with `charter`,
`milestones`, `tasks`, `schedule`, `stakeholders`, `raci`, `register`, `updates`, `meetings`,
`finance`, `settings`; `/tasks`, `/tasks/[id]`; settings `/settings/apps/projects`.
Owners: `webvue_pmo`, `webvue_pmo_finance`. Personas and status values: [README](README.md).

Capability note: `ceo` holds `pmo_manager`; `pm` gets project-manager rights only on projects
where they are the project manager; employees read projects and create/write tasks.

## Projects, charter, phases

| ID | Scenario | Persona | Expected | Status | Test / notes |
| --- | --- | --- | --- | --- | --- |
| PMO-01 | Create a project and a task, change the task state | admin | Saved, state changes | automated | `e2e/tests/pmo-journey.e2e.ts` |
| PMO-02 | Create a project with `pm` as manager | ceo | Saved; manager and end date required | planned | |
| PMO-03 | Employee creates a project | staff1 | Refused unless `project_creators=employees` | planned | |
| PMO-04 | Setting `project_creators=employees` | ceo | staff1 can create | planned | |
| PMO-05 | Edit, archive, unarchive, copy a project | pm (own) | Allowed on own project; refused on another | planned | |
| PMO-06 | Set status on_track / at_risk / off_track / on_hold / done | pm | Saved; staff1 refused (`status_forbidden`) | planned | |
| PMO-07 | Stages: add, rename, reorder, delete; delete non-empty | pm | Saved; non-empty refused `stage_not_empty` | planned | |
| PMO-08 | Milestones: create, edit, reached, delete; dates outside the project; delete with tasks | pm | Saved; out-of-range and `milestone_has_tasks` refused | planned | |
| PMO-09 | Followers, stakeholders, RACI | pm | Saved; employee refused | planned | |
| PMO-10 | Register: risk and issue open → in_progress → resolved → closed | pm | Each state saved | planned | |
| PMO-11 | Project updates and schedule with dependencies | pm | Saved; dependency order respected | planned | |
| PMO-12 | Charter with approval off: submit | pm | Approved immediately | planned | |
| PMO-13 | Charter with approval on: submit, sponsor approves | pm → ceo | `submitted` then `approved`; bell to sponsor and back | planned | |
| PMO-14 | Sponsor returns the charter with a note | ceo | Back to draft; note required (1–2000) | planned | |
| PMO-15 | Edit a submitted charter; withdraw | pm | Edit refused until withdrawn | planned | |
| PMO-16 | Non-sponsor approves | staff1 | Refused | planned | |
| PMO-17 | Edit an approved charter when approval is required | pm | Charter reopened | planned | |
| PMO-18 | Phases initiating → planning → executing → closing → closed | pm | One step at a time; planning needs an approved charter | planned | |
| PMO-19 | Catalogs: project types and owning units; delete one in use | ceo | Saved; in-use delete refused (409) | planned | |
| PMO-20 | Archived projects list | ceo / pm | Global manager only | planned | |

## Tasks and completion review

| ID | Scenario | Persona | Expected | Status | Test / notes |
| --- | --- | --- | --- | --- | --- |
| PMO-30 | Create a task, assign, comment, mention, attach a file | pm, staff1 | Bell `assignment`, `comment`, `mention` to the right people | planned | |
| PMO-31 | Board view `?view=board` and back with filters kept | staff1 | Filters preserved in the URL | planned | |
| PMO-32 | Archive a task as creator / as someone else | staff1 | Creator or approver only | planned | |
| PMO-33 | Completion approval `none`: assignee sets done | staff1 | Done directly | planned | |
| PMO-34 | Completion approval `project_manager`: request, PM accepts | staff1 → pm | Direct done refused; accepted by PM | planned | |
| PMO-35 | PM returns completion with a note; requester withdraws | pm, staff1 | Note required; withdraw by requester only | planned | |
| PMO-36 | Completion approval `specific_user` with an ineligible user | pm | Task shows `reviewer_ineligible` / `no_reviewer` | planned | |
| PMO-37 | Non-reviewer accepts | staff2 | Refused | planned | |
| PMO-38 | All tasks done → project done; reopen a task → status reverts | pm | Automatic both ways | planned | |
| PMO-39 | Deadline reminder and overdue digest | pm | Bell `deadline`; digest after 09:00 opens `/notification-digests/[id]` | planned | |

## Project finance

| ID | Scenario | Persona | Expected | Status | Test / notes |
| --- | --- | --- | --- | --- | --- |
| PMO-50 | Budget and expense entries with finance off | pm | Saved; summary updated | planned | |
| PMO-51 | Manual expense with finance on | pm | Refused (costs come from the cost center) | planned | |
| PMO-52 | Link a cost center; one already linked; other company | cfo | Linked; `account_linked` (409); other company 422 | planned | |
| PMO-53 | Cost center mode `auto` | cfo | New project gets a cost center when the creator may create one | planned | |
