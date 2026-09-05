# nasq

Project & task management product on Odoo 19 CE. See
`docs/superpowers/specs/2026-09-03-nasq-platform-design.md`.

## Dev

    # Odoo (engine + vendor console)
    cd ~/code/odoo && .venv/bin/python odoo-bin -c odoo.conf --dev=all
    # Product UI
    cd ~/code/nasq && npm install && npm run dev      # http://localhost:3000

Real-time task updates connect over `/websocket`. The Nitro dev proxy does
not upgrade websockets, so in dev `useBus()` connects straight to Odoo's
`ws://localhost:8069/websocket` (`runtimeConfig.public.wsUrl`, overridable
with `NUXT_PUBLIC_WS_URL`); in prod it's same-origin, routed through Caddy.

## Phase 1

Phase 1 ("my tasks") shipped on the `phase-1` branch:

- **My tasks table** (`/tasks`) — open/closed tabs, project/state filters, title
  search, sort, pagination ("load more"), inline stage/priority edits, a
  closed-specific empty state.
- **Board view** (`/tasks?tab=board`) — drag-and-drop between personal stages,
  folded stages past a card-count threshold, and a keyboard fallback (a
  per-card "…" menu with "move to…") for moving cards without a mouse drag.
- **Task detail** at a real route, `/tasks/{id}` — a large two-column modal
  (full-screen below `md`) with header, details column (assignees, deadline,
  priority, tags, allocated hours, personal stage, description editor,
  sub-tasks, dependencies, attachments, duration metrics) and an activity
  column; `J`/`K` (and prev/next buttons) step through the list without
  closing the modal. Nested layers (e.g. the deadline date picker) open
  inside the modal and dismiss on their own without closing it.
- **Activity timeline** — comments (sanitised HTML) interleaved with Odoo
  tracking entries (state/field changes), a composer that posts inline.
- **Real-time** — task and comment changes from another session arrive over
  the Odoo bus (`useBus()`, partner channels) and update the table/board/modal
  live, no reload, no `ir.websocket` override.
- **Auth** — session login plus a TOTP step when MFA is enabled
  (`/api/auth/totp`), CSRF-protected auth endpoints.
- **i18n** — Arabic default, RTL layout; nav labels are `nav.*` keys resolved
  by `useNav()` per role.

See `docs/superpowers/specs/2026-09-04-nasq-phase-1-my-tasks-design.md` for
the full design and `docs/superpowers/specs/2026-09-03-nasq-platform-design.md`
for where phase 1 sits in the four-pillar platform.

## Phase 2

Phase 2 ("projects") shipped on the `phase-2` branch. nasq has **no time
logging anywhere in the product** — no allocated-vs-logged-hours reporting,
no timesheet endpoints or fields, a deliberate product decision, not a gap.

- **Projects table** (`/projects`) — every project the user can read, with
  status badge and progress; opens a project by row.
- **Project screen** (`/projects/{id}`) — header (name, status — a `Select`
  for managers, a read-only badge otherwise — and progress), list/board tabs
  (`?tab=list|board`, task filters kept in the query too), and its own
  create-task action (project locked to the current one). A non-numeric or
  unreadable/nonexistent id renders a not-found state instead of querying.
- **Project-scoped task list** — the board groups by the project's own
  stages (not personal stages); the table adds a project-stage column and
  hides the per-row project filter.
- **Nested task modal** at `/projects/{id}/tasks/{taskId}` — the same task
  detail modal as مهامي, opened over the project screen; closing it restores
  the project screen's filters and tab from the URL.
- **⌘K** — projects are searchable alongside tasks.
- **API**: `GET /api/v1/projects` (`?minimal=1` for `{id, name}` pairs used
  by pickers, full project shape otherwise, capped at 200, sorted by name),
  `GET /api/v1/projects/{id}` (adds `stages`), `POST /api/v1/projects/{id}/status`
  (managers only, 403 `status_forbidden` otherwise). `GET /api/v1/tasks` takes
  `project_id` (paired with `filter=mine` and/or on its own — at least one of
  the two is required); `PATCH /api/v1/tasks/{id}` takes `stage_id` to move a
  task between its project's stages.
- **Locale** — `projects.json` alongside `tasks.json` in each pillar's
  namespace (see Layout below).

See `docs/superpowers/specs/2026-09-04-nasq-phase-2-projects-design.md` for
the full design.

## Phase 3a

Phase 3a ("project administration") shipped on the `phase-3a` branch. A
customer runs the project pillar end to end without ever opening Odoo:
create a project, shape its stages, keep its settings, follow milestones,
post status updates, tag and retire tasks.

- **Projects table** (`/projects`) — a **مشروع جديد** action gated on
  `can_create` (policy below); an **النشطة / المؤرشفة** filter (managers/
  `customer_admin` only, gated on `can_list_archived`) that lists archived
  projects with an **إلغاء الأرشفة** row action.
- **Project screen** (`/projects/{id}?tab=list|board|milestones|updates`) —
  two new tabs after قائمة / لوحة: **المعالم** (milestones) and
  **التحديثات** (status updates). A `⋯` menu for managers opens
  **إعدادات المشروع** (dialog, tabs عام / المراحل / المتابعون) and
  **أرشفة المشروع** (confirm, then navigates back to `/projects`).
- **Settings** (`/settings/projects`) — sidebar entry visible to `admin`/
  `vendor` roles only (see manager rule and `nav.settings` below); sets the
  two company-wide project policies (below). 403s (empty state) for anyone
  else who reaches the page directly.
- **The manager rule**, `_nasq_can_manage(project)`
  (`odoo-addons/nasq_pmo/models/project_project.py`): the
  `project.group_project_manager` group, `nasq_core.group_customer_admin`,
  **or the project's own `user_id`** — a manager by assignment even outside
  the group. This replaces the phase-2 group-only rule everywhere a
  project-level write happens: status, settings, stages, followers,
  milestones, updates, archive.
- **Archive semantics** — projects and tasks are archived (`active = False`),
  **never deleted**. There is no unarchive UI for tasks in 3a (vendor
  console only); projects unarchive from the **المؤرشفة** filter.
- **Company policies** (`odoo-addons/nasq_pmo/models/nasq_settings.py`,
  `nasq.pmo.settings`), stored in `ir.config_parameter`, read/written only by
  `nasq_core.group_customer_admin`:
  - `nasq_pmo.project_creators` — `managers` (default) or `employees`; when
    `employees`, every employee may create a project.
  - `nasq_pmo.default_stages` — JSON `[{name, fold}]` copied onto every new
    project's stages (seed: جديد · قيد التنفيذ · مراجعة · منجز مطوي).
- **API** (all `type='json2'`, `auth='user'`, whitelisted serializers):
  - Projects: `GET /api/v1/projects` (now `{items, can_create,
    can_list_archived}` when not `?minimal=1`; `?archived=1` for managers),
    `POST /api/v1/projects {name}` (201; 403 `create_forbidden`),
    `PATCH /api/v1/projects/{id}` (name/description/user_id/
    privacy_visibility/date_start/date/tag_ids; 403 `forbidden`, 422 per
    field), `POST /api/v1/projects/{id}/archive`,
    `POST /api/v1/projects/{id}/unarchive`.
  - Stages: `POST|PATCH|DELETE /api/v1/projects/{id}/stages[/{stage_id}]`,
    `PUT /api/v1/projects/{id}/stages/order` (422 if `ids` isn't a
    permutation of the project's stage ids; delete 422s `stage_not_empty`
    `{count}` when the stage still holds tasks).
  - Followers: `GET|POST /api/v1/projects/{id}/followers`,
    `DELETE /api/v1/projects/{id}/followers/{user_id}` — internal users only.
  - Milestones: `GET|POST /api/v1/projects/{id}/milestones`,
    `PATCH|DELETE /api/v1/projects/{id}/milestones/{mid}` (delete 422s
    `milestone_has_tasks` when tasks are still linked); tasks gain a
    `milestone_id`.
  - Updates: `GET|POST /api/v1/projects/{id}/updates` — status + title +
    rich-text body, prepended chronologically.
  - Tags: `GET|POST /api/v1/tags` — managers may create a tag by name.
  - Settings: `GET|PATCH /api/v1/settings/projects` — the two policies above.
  - Tasks: `POST /api/v1/tasks/{id}/archive`.
- **Documented `sudo()` cases in `nasq_pmo`** (every other write goes through
  the caller's own ACL — see CLAUDE.md's routes rule):
  1. `nasq.pmo.settings` reads/writes `ir.config_parameter` (config, not
     business data; every caller is gated on `group_customer_admin` first).
  2. `_nasq_create_from_policy` runs the `create()` call in sudo only when
     the company policy is `employees` (Odoo's ACL reserves project creation
     to managers; `create_uid`/`user_id` still record the employee).
  3. `_nasq_write_sudo` (used by `_nasq_write_as_manager` and the archive/
     status/stage/milestone *do* steps) and `message_(un)subscribe` in
     `_nasq_add_follower`/`_nasq_remove_follower` — all for the
     assigned-`user_id`-as-manager case, which Odoo's own project ACL (grants
     write only to the manager *group*) doesn't know about; the caller's own
     `_nasq_check_manage()` has already run first.
  4. Display-name / stage / milestone lookups in `serializers/task.py`
     (`_project_ref`, `_milestone_ref`, `_parse_stage`, `_parse_milestone`, …) — mirrors
     the Odoo web client resolving many2one display names in sudo, not an
     access dodge on task data itself.
  5. `_nasq_stage_task_count` / `_nasq_milestone_task_counts` in
     `models/project_project.py` return integer-only task counts — never task
     records — so this cannot leak data; without it, `ir.rule` on a
     followers-only project would under-count hidden tasks and let a stage or
     milestone that still holds them be deleted.
- **Locale** — `settings.json` joins `{common,tasks,projects}.json`.

See `docs/superpowers/specs/2026-09-05-nasq-phase-3a-project-admin-design.md`
for the full design.

## Layout

Ownership rule: shared plumbing lives in `nasq_api`, each pillar lives in its
own addon, and each pillar owns its own locale namespace and contract
namespace — so two pillar teams never write the same file.

- `apps/web` — Nuxt 4 product UI. Messages are per-pillar namespace files,
  `i18n/locales/<locale>/{common,tasks,projects,settings}.json`, merged by
  `@nuxtjs/i18n`'s per-locale `files: [...]` (key paths are flat:
  `$t('tasks.state.done')`).
- `packages/contracts` — zod schemas shared with the UI: `src/common/`
  (branding, error envelope, me) and `src/pmo/` (state, task, timeline,
  personal stage, project, milestone, project-update, settings, tag), each
  with its own `index.ts`; `src/index.ts` re-exports them, so consumers keep
  importing from `@nasq/contracts`.
- `odoo-addons`
  - `nasq_core` — groups and branding defaults.
  - `nasq_api` — shared `/api/v1` plumbing only: `controllers/common.py`
    (`ApiError`, `api_handler`, `get_record`, `parse_nonneg_int`),
    `auth`/`branding`/`me`, the company/user serializers and `iso()`, and the
    `NasqApiCase` test fixture the pillars subclass. It never imports a pillar.
  - `nasq_pmo` — the project pillar: the task/timeline/personal-stage/project/
    people endpoints, their serializers, the `project.task` transition hooks
    and bus notifier, and their tests.
  - `web_theme_shadcn` — vendor console theme.
- `deploy` — per-customer docker-compose + provisioning

A second team working a second pillar: see `docs/parallel-work.md`.

## Patched generated files

shadcn-vue copies components into the repo, so these hand-edits are lost on a
regenerate — re-apply after `npx shadcn-vue add … --overwrite`:

- `apps/web/app/components/ui/sidebar/SidebarProvider.vue` — `useMediaQuery(…, { ssrWidth: 1024 })` so the mobile branch does not mismatch during hydration.
- `apps/web/app/components/ui/sidebar/index.ts` — `text-left` → `text-start` in `sidebarMenuButtonVariants` (RTL).
- `apps/web/app/components/ui/command/CommandShortcut.vue` — `ml-auto` → `ms-auto` (RTL).
- `apps/web/app/components/ui/calendar/Calendar.vue` — `pl-2`/`pr-6` → `ps-2`/`pe-6`, and the native-select icon override `right-1` → `end-1` (RTL).
- `apps/web/app/components/ui/native-select/NativeSelect.vue` — `pr-9` → `pe-9` and the chevron's `right-3.5` → `end-3.5` (RTL; the Calendar override above only works if the base is logical too).
- `apps/web/app/components/ui/dropdown-menu/DropdownMenuCheckboxItem.vue` — `pr-2 pl-8` → `pe-2 ps-8` and the indicator's `absolute left-2` → `absolute start-2` (RTL).
- `apps/web/app/components/ui/dialog/DialogHeader.vue` — `sm:text-left` → `sm:text-start` (RTL).
- `apps/web/app/components/ui/dialog/DialogContent.vue` — the close button's `right-4` → `end-4` (RTL).

## SSR hydration and interactive controls

Nuxt SSR renders interactive controls (reka-ui Tabs, buttons with attached
listeners, …) as visible, clickable markup before the client has hydrated
and attached their event listeners — a click made in that window lands on
the DOM node but is silently dropped since nothing is listening yet. Measured
in dev on `/login` and `/tasks`, this window is on the order of 100–200ms
(a production build is faster, but not zero).

Ruling: gate any control whose first interaction must not be lost on
`useHydrated()` (`apps/web/app/composables/useHydrated.ts`) — `:disabled="!hydrated"`
until the component has hydrated. This replaced login.vue's phase-0
per-component `mounted` workaround and now also gates every interactive
control in `TaskToolbar.vue`, the `/tasks` table/board tabs, the ⌘K button,
the account menu trigger, and the table row/StateMenu/PrioritySelect/"load
more" controls in `TaskTable.vue`. Do not re-introduce a per-component
`mounted`/`onMounted` flag for this purpose; use the shared composable.
`ssr: false` for the whole authenticated app was considered and rejected —
it would trade the fast SSR first paint (the product's whole premise) for a
client-only blank/spinner load on every navigation, for a problem the
composable already solves without that cost.

`hydration.spec.ts`'s tests assert the disabled → enabled transition and
only click afterward, rather than racing a click immediately on page load.
That's deliberate, not a gap: a disabled element cannot receive a real
click, so under this gate an unguarded pre-hydration click is structurally
impossible to provoke — the disabled → enabled → click sequence is the
actual contract being protected, and is what these tests prove.

## Tests

    # Odoo addons (fresh scratch DB) — 0 failed, 0 error(s) of 115 tests
    cd ~/code/odoo && .venv/bin/python odoo-bin -c odoo.conf -d nasq_test -i nasq_core,nasq_api,nasq_pmo,nasq_hr --test-tags /nasq_core,/nasq_api,/nasq_pmo,/nasq_hr
    # tip: if a dev server already holds :8069, add --http-port=8169 to the command above
    # lint
    ruff check odoo-addons deploy/seed_branding.py     # clean
    npm -w apps/web run lint                           # vue-tsc --build --noEmit, 0 errors
    # contracts + web unit — 28 + 130 = 158 tests passing
    npm test
    # e2e (needs Odoo on :8069 with nasq_core, nasq_api and nasq_pmo installed and `npm run dev` on :3000) — 39 passed
    cd apps/web && npm run test:e2e
