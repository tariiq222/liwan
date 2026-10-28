# Personal tasks

Pages: `/my-tasks` (`new`, `[id]`, `edit`). Owners: `webvue_tasks`, `webvue_tasks_pmo`.
Personas and status values: [README](README.md).

| ID | Scenario | Persona | Expected | Status | Test / notes |
| --- | --- | --- | --- | --- | --- |
| TSK-01 | Create a personal task with assignees | staff1 | Saved; bell `tasks.assigned` to new assignees, not the actor | planned | |
| TSK-02 | Sub-task, and a sub-task of a sub-task | staff1 | One level allowed; second level refused | planned | |
| TSK-03 | Done, reopen, cancel | staff1 | Each state saved | planned | |
| TSK-04 | Archive an open task; archive a done one; edit archived; restore | staff1 | Open refused; done archived read-only; restore works | planned | |
| TSK-05 | Comments and attachments | staff1, staff2 | Visible to creator and assignees | planned | |
| TSK-06 | Outsider opens the task by link | staff2 (not assigned) | 404 | planned | |
| TSK-07 | Convert an open top-level task with sub-tasks to a project task | staff1 | Moves with sub-tasks; opens `/projects/{p}/tasks/{t}`; irreversible | planned | Also J-09 |
| TSK-08 | Convert a sub-task, a done task, or into a project needing approval with a done sub-task | staff1 | Refused | planned | |
