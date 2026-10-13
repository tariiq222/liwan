# Tasks application split — design

**Date:** 2026-10-13. **Owner decision:** the base bundle («مساحة العمل») must
contain personal and team tasks that need no project; project management
stays a paid application. This spec splits them.

**Branch:** `codex/platform-tasks-app` from current `main`, own worktree.
No merge or push without the owner.

## 1. Goal

A customer who buys only the base bundle gets a working "my tasks" list:
personal to-dos and tasks assigned inside a team, with assignees, due
dates, priority, sub-tasks, comments and attachments. A customer who also
buys the PMO application sees project tasks in the same list and can turn
a personal task into a project task. Neither application imports the other.

Non-goals (v1): states beyond open/done/cancelled, approvals, dependencies,
milestones, timelines, recurring tasks, mentions or `/task` references in
comments, global search provider, Kanban board, digests.

## 2. Architecture

| Unit | Kind | Rank | Owns |
|---|---|---|---|
| `nasq_tasks` | application | 4 | personal tasks (`project.task` rows with `project_id = False`), `tasks.enabled`, the `tasks.*` capabilities, `/api/v1/my-tasks/*`, the `nasq.task.links` hook with its "no project" defaults, the `tasks.assigned` bell kind |
| `nasq_tasks_pmo` | bridge | 5, `auto_install` | project-task branch of `nasq.task.links`, conversion route, convert-target lookup |
| `apps/web/app/modules/tasks` | web application | — | `/my-tasks` pages, `components/my-tasks`, locale `my-tasks.json` |

Rules honoured: R1–R4 (new addon depends on `project`, `mail`, `nasq_core`,
`nasq_api`, `nasq_notify`, `nasq_directory`; never on `nasq_pmo`), R7 (no
`sudo()` except the two documented cases in §7), R9 (public extension points
only), R10 (feature + capabilities registered by the owning addon).

Scaffold with `python3 -B tools/new_app.py tasks --name-ar المهام --name-en Tasks`,
then the bridge by hand following `nasq_meetings_pmo`.

`nasq_pmo` is not refactored. Its `/api/v1/tasks/*` routes, `/tasks` web
routes, bell kinds and locale `tasks.json` stay as they are. The only PMO
change is in §6.3.

## 3. Data

Personal task = `project.task` with `project_id = False` (Odoo's own
"🔒 Private" value). No new model. `nasq_tasks` adds to `project.task`:

- `nasq_personal` — stored boolean, computed `not project_id`, indexed.
  Used by rules and domains so the two populations never overlap.
- Nothing else. Name, description, `user_ids`, `date_deadline`, `priority`,
  `parent_id`/`child_ids` (sub-tasks as the checklist), `state`,
  `company_id`, `create_uid`, attachments and `mail.message` are Odoo's.

Constraints enforced in the service layer:

- A personal task's `company_id` is the caller's current company.
- A personal sub-task's parent is a readable personal task in the same
  company; depth 1 only (a sub-task has no sub-tasks).
- Assignees come from the `/api/v1/people` population (active internal
  users of the current company); `nasq_tasks` registers its feature keys in
  `nasq.directory`.
- Welcome to-dos created by `project_todo` for `base.user_root` are excluded
  from every list (`create_uid != base.user_root`).

## 4. Wire contract

`packages/contracts/src/tasks/` with a barrel re-exported from `src/index.ts`.

States: `open | done | cancelled` ↔ `01_in_progress | 1_done | 1_canceled`.

`PersonalTask` (detail, returned by every write):

```
id, name, description (plain text), state, priority ('normal'|'high'),
date_deadline (ISO 8601 UTC datetime string `YYYY-MM-DDTHH:MM:SSZ`|null; a bare date is accepted on input),
assignees: PersonRef[], creator: PersonRef,
parent: {id, name}|null, is_subtask: bool (true for every sub-task, also when `parent` is null because the parent is unreadable), subtasks: [{id, name, state}], attachment_count,
created_at, updated_at, allowed_actions: {write, done, reopen, cancel, convert}
```

`MyTaskListItem` (unified list):

```
id, name, state, priority, date_deadline, assignees: PersonRef[],
source: 'personal'|'project', project: {id, name}|null, href
```

`href` is `/my-tasks/{id}` for personal rows and, for project rows, the
value the bridge supplies (`/projects/{project_id}/tasks/{id}`). The web
never builds a project URL itself.

`PersonRef` is the `/api/v1/people` shape `{id, name, user_id}` (`res.users` ids); comment `author`
is null when the author has no user. Personal sub-tasks use `nasq_parent_id` (Odoo forbids `parent_id`
on project-less tasks), and `subtasks` lists active, readable children only.

`TaskComment`: `id, body (plain text), author: PersonRef|null, created_at`.

## 5. API (`nasq_tasks`, all `type='json2'`, `auth='user'`, `@api_handler`, gated by `tasks.enabled`)

| Method | Route | Capability | Notes |
|---|---|---|---|
| GET | `/api/v1/my-tasks` | `tasks.tasks.read` | unified list; `closed=0|1`, `q`, `assigned=me|created=me` (default both), `sort`, `limit`≤100, `offset` |
| POST | `/api/v1/my-tasks` | `tasks.tasks.create` | `name`, optional `description`, `date_deadline`, `priority`, `assignees` (user ids), `parent_id` |
| GET | `/api/v1/my-tasks/<id>` | `tasks.tasks.read` | personal tasks only; a project task id answers 404 |
| PATCH | `/api/v1/my-tasks/<id>` | `tasks.tasks.write` | same fields as POST except `parent_id` |
| POST | `/api/v1/my-tasks/<id>/done` · `/reopen` · `/cancel` | `tasks.tasks.write` | returns detail |
| GET/POST | `/api/v1/my-tasks/<id>/comments` | read / write | plain-text `body`; stored as `mail.message` on the task |
| GET/POST/DELETE | `/api/v1/my-tasks/<id>/attachments[/<att_id>]` | read / write | `nasq_api/serializers/attachment.py` validator; storage counted by `_nasq_claim_storage` |

Errors: 403 `forbidden` / `feature_not_included`, 404 `not_found`, 422
`invalid` with `field`.

Unified list composition: domain =
`(nasq_personal AND visible-by-rule) OR links._nasq_project_task_domain(uid)`.
The default hook returns an always-false domain, so a base-only tenant lists
personal tasks only. Rows are serialised by `nasq_tasks`; the project column
comes from `links._nasq_project_ref(task)` (default `None`).

## 6. Bridge (`nasq_tasks_pmo`)

### 6.1 Hook `nasq.task.links`

Defined in `nasq_tasks/models/task_links.py` as an AbstractModel, mirroring
`nasq.meeting.links`:

- `_nasq_project_task_domain(uid)` → default `Domain.FALSE`; bridge returns
  `project_id != False AND uid in user_ids AND project active in company`
  (ordinary ACL and record rules still apply, no `sudo()`).
- `_nasq_project_ref(task)` → default `None`; bridge returns `{id, name}`
  and `href`.
- `_nasq_can_convert(task)` → default `False`; bridge returns whether the
  caller holds `pmo.tasks.create` on at least one active project.

### 6.2 Routes (gated by `tasks.enabled` **and** `pmo.enabled`)

| Method | Route | Check | Effect |
|---|---|---|---|
| GET | `/api/v1/my-tasks/convert-targets?q=` | `pmo.projects.read` | up to 20 `{id, name}` active projects where the caller holds `pmo.tasks.create` |
| POST | `/api/v1/my-tasks/<id>/convert` | `tasks.tasks.write` on the task, `pmo.tasks.create` on the project | sets `project_id`, keeps assignees, deadline, description, sub-tasks and attachments; state becomes PMO `01_in_progress`; returns `{href}` of the project task. Irreversible. |

The convert write is the bridge's only elevated write and is performed in
the caller's environment after both checks; no `sudo()`.

### 6.3 PMO change

Remove the `tasks` entry from `modules/pmo/manifest.ts` `nav` and `landing`
(the unified list replaces it). Keep `routePrefixes`, `/tasks/*` pages,
`/archived-tasks`, bell hrefs and context links unchanged. Everything else in
`nasq_pmo` is untouched.

## 7. Security

Capabilities registered through `nasq.access.service` with owner `nasq_tasks`:
`tasks.tasks.read`, `tasks.tasks.create`, `tasks.tasks.write`. Dependencies:
`create` and `write` require `read`. Built-in grants: `nasq_core.role_employee`
gets all three (every employee has a to-do list); `system_admin` gets none
implicitly, consistent with HR/PMO. No new role.

Groups and records in `nasq_tasks/security/`: three capability groups, ACLs
on `project.task` for those groups (read/create/write, no unlink), and
record rules:

- `rule_personal_task_visible` (group `tasks.tasks.read`):
  `[('nasq_personal','=',True), ('company_id','=',company_id),
    '|', ('create_uid','=',user.id), ('user_ids','in',[user.id])]`
- Write rule on the same domain for group `tasks.tasks.write`.

The implementer verifies Odoo 19's own private-task rules on `project.task`
in `/Users/tariq/code/odoo/addons/project/security/` and keeps the Nasq rule
at least as strict; a stranger must get 404 on a personal task even when
Odoo's rule would read it. Existing `nasq_pmo` rule
`rule_task_current_company` keeps applying globally.

Documented `sudo()` cases in `nasq_tasks`: (1) the `tasks.assigned` bell
delivery through `nasq.notify.service`, (2) the recipient-owned bell
candidate lookup, exactly as PMO's notification cases. Nothing else.

## 8. Entitlements and catalog

- `nasq_tasks/models/feature_registry.py`: `tasks.enabled` (boolean, owner
  `nasq_tasks`). No limit key in v1; attachments count against
  `storage.limit_mb`.
- `deploy/catalog/solutions/platform_v3.json` (still unpublished, edited in
  place): new tier `{"id":"tasks","name":"Tasks","modules":["nasq_tasks"],
  "features":["boolean:tasks.enabled"]}`. Composing it with messaging and
  meetings into the commercial "workspace" bundle is a plan/bundle decision
  in the vendor console, not a catalog change.
- `tools/arch_layers.json`: `nasq_tasks: 4`, `nasq_tasks_pmo: 5`, web app
  `tasks: {components: ["my-tasks"], pages: ["my-tasks"]}`.
- `nasq.tenant.profile._register_hook` registers `tasks.enabled` closed on
  existing tenants; operator scripts open it with the base bundle.

## 9. Notifications

`nasq_tasks` registers kind `tasks.assigned` in `nasq.notify.registry`:
sent when a user other than the recipient adds them to a personal task's
assignees. One row per (task, recipient), replaced on re-assignment. Bell
href `/my-tasks/{task_id}`. The web manifest lists it under `bell.kinds`.

## 10. Web

- `apps/web/app/modules/tasks/manifest.ts`: id `tasks`, feature
  `tasks.enabled`, `routePrefixes ['/my-tasks']`, rail entry «مهامي» at
  `/my-tasks` (order 15, before projects), nav `/my-tasks`
  (`tasks.tasks.read`), context link `new-task` (`tasks.tasks.create`,
  pinned), landing `/my-tasks`, `routeCapabilities`: `/my-tasks/new` →
  `tasks.tasks.create`; bell kinds as §9.
- Pages: `pages/my-tasks/index.vue` (list: open/done tabs, "assigned to me /
  created by me" filter, `q`; project rows show the project name and link to
  `href`), `pages/my-tasks/new.vue` (route-backed `SharedCreatePanel`),
  `pages/my-tasks/[id].vue` (detail with inline edit, done/reopen/cancel
  with explicit inline confirmation for cancel, sub-task list, comments,
  attachments, and a "convert to project task" action shown only when
  `allowed_actions.convert`; its project picker calls
  `/api/v1/my-tasks/convert-targets`).
- Components under `components/my-tasks/`; each shared one ships with a
  story and is listed in `STORYBOOK_COMPONENTS` before reuse. No import from
  `components/task` or `components/project`.
- Data layer: `composables/useMyTasks.ts` over `useApi()` with
  `@tanstack/vue-query`; writes replace the cache with the server shape;
  done/reopen/cancel stay pending until confirmed.
- Locale: `i18n/locales/{ar,en}/my-tasks.json`, namespace `myTasks`;
  `nav.myTasks` in `common.json`. Arabic first, logical Tailwind properties,
  `useHydrated()` on first-click controls.

## 11. Migration and compatibility

- Fresh install only; no data migration. Existing databases get
  `nasq_personal` computed on install (store + compute handles it).
- PMO's `GET /api/v1/tasks` keeps excluding project-less tasks; the two
  lists never show the same row twice except as a project row in
  `/my-tasks`, by design.
- Addon versions `19.0.1.0.0`; no schema change in existing addons.

## 12. Tests

Odoo (`NasqApiCase`, every `test_*.py` imported in `tests/__init__.py`):

- `nasq_tasks`: create/list/detail by creator; assignee sees and edits;
  stranger gets 404 on detail and no row in list; other company gets
  nothing; sub-task depth limit; state transitions and `allowed_actions`;
  comments and attachment validator/quota; feature gate 403 when
  `tasks.enabled` is false; `tasks.assigned` delivered once and replaced;
  Welcome to-do excluded.
- `nasq_tasks_pmo`: list shows an assigned project task with `source`
  `project` and the PMO href; convert requires `pmo.tasks.create` on the
  target project (403 otherwise), moves attachments and sub-tasks, and the
  row disappears from `/api/v1/my-tasks/<id>` (404) while appearing in PMO's
  `/api/v1/tasks/<id>`; convert-targets only lists eligible projects.
- Without `nasq_pmo` installed, `nasq_tasks` tests pass alone (hook defaults).

Web: vitest for the manifest, composable and list filters; a mock-backed
Playwright spec for list → create → done → detail; hydration test for the
create button.

Static: `ruff check odoo-addons`, `python3 -B tools/arch_policy.py --base main`,
`python3 -B tools/git_policy.py --base main`, `python3 -B tools/catalog_check.py`,
`npm test`, `npm -w apps/web run lint`.

## 13. Delivery order

1. Scaffold `nasq_tasks` + registration files; feature, capabilities,
   groups, rules; `nasq_personal`; service + tests (no routes yet).
2. Routes, serializers, contracts, comments, attachments, notification.
3. Bridge addon with hook, routes, tests.
4. Web module, pages, composable, locale, stories, tests; PMO manifest trim.
5. Catalog tier, arch baseline (`--write-baseline` only if a count shrinks),
   full gates, `odoo-reviewer` pass, report with evidence.

Each step is one or more `type(scope): subject` commits on the task branch;
scope `platform` for addon and catalog work, `web` for the web module.
