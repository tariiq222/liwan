# nasq — Phase 1: My Tasks & Task Drawer — Design Spec

**Date:** 2026-09-04
**Target:** nasq `main` @ `v0.1.0-phase0` (Odoo 19.0 CE engine, Nuxt 4 UI)
**Status:** Approved for planning
**Parent spec:** `2026-09-03-nasq-platform-design.md` (binding; this document refines its Phase 1 row)

## Goal

The first screens a customer's employee lives in every day: **مهامي** (my
tasks, as a table and as a personal-stage board) and the **task drawer**
(everything about one task without leaving the list), with a live activity
timeline and real-time updates. Time logging is deferred; what matters now is
**task and project duration** (deadlines, age, cycle time, overdue), not
per-user hours.

## Decisions (2026-09-04)

| Question | Decision |
|---|---|
| "My tasks" means | Tasks where the current user is in `user_ids`. |
| Presentation | Two tabs: **table** (default; sort/filter/search/group) and **board** by personal stage with drag-and-drop. |
| Description editor | Tiptap (bold, italic, bullet/ordered lists, links), RTL-aware; stores HTML compatible with Odoo's `Html` field. |
| Drawer relations | Sub-tasks (list + create by title), dependencies (read-only), attachments (read-only list). Upload and dependency editing → phase 2. |
| Activity | Comments (`mail.message` type `comment`) **and** field-tracking entries, merged into one timeline. |
| Time logging | **Deferred to phase 2.** Phase 1 shows duration metrics only. |
| Approvals | Employees may set `in_progress`, `waiting`, `done` on their tasks; `approved` and `changes_requested` require a project manager (`project.group_project_manager`) or `nasq_core.group_customer_admin`. Enforced server-side. |
| Real-time | No custom channel: on task write, notify the **partner channels** of every assignee (before and after the change) plus the writer — the channels Odoo already subscribes every logged-in user to. |
| Phase-0 debt | Wire `@tanstack/vue-query`; add `@nuxtjs/i18n` (`ar` default, `en` secondary); add the TOTP step to the custom login. |

## Duration model (task)

Community Odoo 19 has no planned start/end on tasks; it has `create_date`,
`date_assign`, `date_deadline`, `date_end` (set when the task closes) and the
computed `working_days_open` / `working_days_close`. Phase 1 exposes, per task:

| Metric | Definition | Where shown |
|---|---|---|
| `days_remaining` | `date_deadline − today` in calendar days; negative when overdue; `null` without a deadline | table column, board card, drawer header |
| `is_overdue` | `days_remaining < 0 and not is_closed` | badge |
| `age_days` | `today − create_date` | drawer |
| `cycle_days` | `date_end − (date_assign or create_date)` when closed, else `null` | drawer |
| `allocated_hours` | as stored (planning figure, not time spent) | drawer, editable by managers |

Project-level duration (`date_start`, `date`, open/closed counts, overdue count)
belongs to the project screen in phase 2; the drawer shows only the project name.

## Screens

### مهامي — table (default)

- Columns: العنوان · المشروع · الحالة (badge) · الموعد + `days_remaining` · الأولوية · المرحلة الشخصية.
- Filters (in the toolbar, persisted per browser): state (multi), project, "مفتوحة / منجزة" toggle (default: open), free-text search on title (server-side `ilike`).
- Sort: any column; default `date_deadline asc, priority desc`. Group-by: project or personal stage (client-side over the current page).
- Pagination: server-side, 50 per page, "تحميل المزيد".
- Row click → drawer. Inline state change from the badge (transition rules apply).
- Empty state: "لا مهام مسندة إليك" + action "إنشاء مهمة" (creates a task in a project the user picks).

### مهامي — board

- One column per personal stage of the current user (`project.task.stage.personal` → `project.task.type` with `user_id`), in stage sequence; Odoo creates the default set on first use.
- Card: title, project, deadline badge, priority flag, assignee avatars.
- Drag a card between columns → `PATCH /tasks/{id} {personal_stage_type_id}` (optimistic). Reorder inside a column is visual only (no server sequence) in phase 1.
- Same filters as the table.

### Task drawer (`Sheet`, right side in RTL)

Header: title (inline edit, autosave), state badge (transition menu), project chip, `days_remaining` / overdue badge.
Body tabs:
1. **التفاصيل** — assignees (multi, from `/people`), deadline (date-time picker), priority, tags, personal stage, allocated hours (managers), description (Tiptap, autosave debounced 800 ms), sub-tasks (list with state badges + "إضافة مهمة فرعية" title input), dependencies (read-only list with state), attachments (read-only list with `/web/content/<id>` links), metrics (age, cycle).
2. **النشاط** — merged timeline newest-first: comments (author avatar, body HTML sanitised, relative time) and tracking entries ("غيّر الحالة من X إلى Y"); composer at the bottom posts a comment.

Write semantics (platform rule): field edits are optimistic; **state transitions are pending → confirmed**; every write response returns the full task and replaces the cache.

## API v1 additions (`nasq_api`)

```
GET    /api/v1/tasks?filter=mine&state=…&project_id=…&closed=0|1&q=…&sort=…&limit=50&offset=0
       → { items: Task[], total: int }
POST   /api/v1/tasks               { name, project_id, parent_id? }      → Task            (201)
GET    /api/v1/tasks/{id}          → TaskDetail
PATCH  /api/v1/tasks/{id}          { name?, description?, date_deadline?, priority?, user_ids?, tag_ids?,
                                     personal_stage_type_id?, allocated_hours? (managers) } → TaskDetail
POST   /api/v1/tasks/{id}/transition   { state }                        → TaskDetail        (403 on rule breach)
GET    /api/v1/tasks/{id}/timeline     → TimelineEntry[]
POST   /api/v1/tasks/{id}/comments     { body }                          → TimelineEntry     (201)
GET    /api/v1/me/personal-stages      → PersonalStage[]  (creates the defaults when empty)
GET    /api/v1/people?q=               (exists in phase 3 plan; phase 1 ships the minimal
                                        { id, name, user_id } list needed by the assignee picker)
GET    /api/v1/projects?minimal=1      → { id, name }[] for the create-task picker
```

Shapes (zod in `packages/contracts`, mirrored by serializers):

```
Task          { id, name, project: {id,name}, state, priority: '0'|'1', date_deadline: string|null,
                days_remaining: number|null, is_overdue, is_closed, personal_stage: {id,name}|null,
                assignees: [{id,name}], tags: [{id,name,color}] }
TaskDetail    Task + { description_html, allocated_hours, age_days, cycle_days: number|null,
                subtasks: Task[], depends_on: [{id,name,state}], attachments: [{id,name,url,mimetype}],
                can_approve: boolean, created_at, updated_at }
TimelineEntry { id, kind: 'comment'|'tracking', author: {id,name}, at, body_html?,
                changes?: [{field, label, old, new}] }
PersonalStage { id, name, sequence, fold }
State         'in_progress'|'changes_requested'|'approved'|'waiting'|'done'|'cancelled'
```
Server state codes (`01_in_progress`, …) are mapped to these short names in the serializer both ways.

Rules:
- `filter=mine` is the only filter in phase 1; a request without it is a 400 (the projects screen adds `project_id`-scoped lists in phase 2).
- PATCH whitelist is enforced by the serializer's `parse()`; unknown keys → 422 `{code:'unknown_field', field}`.
- `/transition` calls `task._nasq_transition(state)` — a hook-decomposed method in `nasq_pmo`: `_nasq_check_transition_allowed(state)` (raises `AccessError` → 403), `_nasq_do_transition(state)`, `_nasq_post_transition_hook(state)`.
- Errors keep the platform shape `{code, message, field?}`.

## Real-time

- `nasq_api/models/project_task.py` overrides `write` and `create`: after the super call, `_sendone(partner, 'nasq/task', {id, event: 'updated'|'created'})` to the partner of each user in the union of old and new `user_ids` plus the writer. Odoo already subscribes every logged-in user to their partner channel — no `ir.websocket` override.
- Frontend `useBus()` opens `/websocket` (dev: Vite ws proxy `/websocket → ws://localhost:8069`; prod: Caddy), sends the standard `subscribe` event with `channels: []`, and on `nasq/task` notifications invalidates the `['tasks']` and `['task', id]` queries. Reconnect with backoff; no message replay in phase 1.

## Frontend

- **State**: `@tanstack/vue-query` becomes the server-state layer: `useTasks(params)`, `useTask(id)`, `useTimeline(id)`, `usePersonalStages()`, mutations with optimistic updates for PATCH and pending-confirm for `/transition`. `useMe`/`useBranding` stay on `useFetch` (SSR-critical).
- **Components**: `TaskTable` (shadcn DataTable), `TaskBoard` (`vue-draggable-plus`, keyboard-accessible fallback: a "نقل إلى…" menu on each card), `TaskDrawer` (`Sheet`), `StateBadge` + `StateMenu`, `DeadlineBadge`, `AssigneePicker` (`Combobox`), `DescriptionEditor` (Tiptap), `Timeline`, `CommentComposer`, `SubtaskList`.
- **i18n**: `@nuxtjs/i18n`, `strategy: 'no_prefix'`, `ar` default with `dir: 'rtl'`, `en` secondary; all phase-0 literals move to `i18n/locales/ar.json` / `en.json`.
- **TOTP**: the Nitro login handler detects Odoo's MFA requirement (`/web/session/authenticate` succeeds but `/web/session/check`/`get_session_info` reports `mfa` pending, or the TOTP challenge route) and returns `{ok:false, mfa:'totp'}`; the login page shows a 6-digit step that posts to a new `POST /api/auth/totp` proxying Odoo's `auth_totp` verification. Exact routes are verified against `addons/auth_totp/controllers` during planning.
- Design rules from the parent spec apply unchanged (tables default, drawer not page, one primary action, skeletons, badges vocabulary, ⌘K, empty states, tokens, logical properties).

## Odoo side

- `nasq_pmo` (new addon): `project.task` transition hooks + `can_approve` helper; `personal stage` default creation helper; nothing else in phase 1.
- `nasq_api`: `controllers/tasks.py`, `controllers/timeline.py`, `controllers/personal_stages.py`, `controllers/projects.py` (minimal), `controllers/people.py` (minimal); `serializers/task.py`, `serializers/timeline.py`; `models/project_task.py` (bus notifications).
- ACL stays Odoo's (`project.group_project_user` via `nasq_core.group_employee`); no new access CSV needed for existing models. `nasq_pmo` adds no models in phase 1.

## Testing

- `HttpCase` per endpoint + per rule (list scoped to me; PATCH whitelist; transition 403 for employee → approved, 200 for manager; timeline mixes comment + tracking; personal stages auto-created).
- Contract e2e (`contracts.spec.ts`) extended to every new endpoint.
- Vitest: query-key helpers, state mapping, `daysRemaining()` pure helper, optimistic reducers.
- Playwright: list renders my tasks; open drawer, edit title, see it persisted after reload; transition as employee to approved → error toast; drag a card to another stage; post a comment and see it in the timeline; real-time: a second browser context sees the update without reload.
- Odoo suite + ruff + vue-tsc + `npm test` + e2e stay the gate.

## Out of scope (phase 1)

Time logging, attachment upload, dependency editing, project screen, reports,
Gantt, portal users, settings section, mobile-specific layouts beyond the
responsive shell.

## Open items

- Board reordering within a column (server sequence) — phase 2 if requested.
- `@mentions` in comments — phase 2.
