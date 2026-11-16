# liwan_helpdesk_tasks

A rank-5 bridge (`auto_install`) between the two applications `liwan_helpdesk` and `liwan_tasks`. It owns one
column and the two routes of a ticket's follow-up tasks; neither application imports the other (R3).

The column is `project.task.liwan_helpdesk_ticket_id` (`Many2one helpdesk.ticket`, `ondelete='set null'`,
`index='btree_not_null'`, `copy=False`). It is registered in `project.task._liwan_task_link_fields()`, so the
tasks service accepts it only from the bridge as a link value and no client write reaches it. Deleting the
ticket leaves the task as a plain personal task of `liwan_tasks`.

| Method and path | Features | Capabilities |
| --- | --- | --- |
| `GET /api/v1/helpdesk/tickets/{id}/tasks` | `helpdesk.enabled` and `tasks.enabled` (read) | `helpdesk.tickets.read` and `tasks.tasks.read` |
| `POST /api/v1/helpdesk/tickets/{id}/tasks` | `helpdesk.enabled` and `tasks.enabled` | `helpdesk.tickets.write` and `tasks.tasks.create` |

Both routes find the ticket through `liwan_helpdesk.controllers.tickets.find`: the list asks for the desk's read
or requests-read capability, the create for `helpdesk.tickets.write`, and either then applies the desk's own
visibility (404 for a hidden, foreign or missing one). The list is
`{items, total}` of the personal tasks (`liwan_personal`) linked to the ticket in the working company, ordered
by the tasks application's deadline sort and paged with the shared `parse_page`. A create takes `name`,
`description`, `date_deadline`, `priority` and `assignees` only and is refused without a `date_deadline` (422
`invalid`); the default assignee is the ticket's assignee, else the caller. A closed ticket takes no new task
(422). The task is created through `liwan.my.task.service._create_task`, so the tasks application's own
validation, personal-task rule and assignment bell apply, and the bridge uses no `sudo()`.
`tests/test_ticket_tasks.py` covers both routes.
