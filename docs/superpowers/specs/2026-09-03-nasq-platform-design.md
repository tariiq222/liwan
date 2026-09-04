# nasq — Platform Design Spec

**Date:** 2026-09-03
**Target:** Odoo 19.0 Community (pinned to `19.0` stable, never forked) + Nuxt 4
**Status:** Approved — phase 0 planned

## Goal

**nasq** (نَسَق) is a resellable, **full integrated enterprise management
suite** — initiatives, projects, HR (human resources), and meeting management
as core pillars — with a Stripe-level UI, built on Odoo 19 Community as its
engine. It is delivered in phases; **phase 1 delivers project/task management
only**, with initiatives, HR, and meetings following in later phases (see
Phases below). Customers' staff use a Nuxt web app and never see Odoo; Odoo's
own web client is reserved for the vendor (us). Each customer runs an
independent deployment (managed by us or on-premise). Erada is customer #1,
not the scope.

## Decisions (from brainstorming / grilling, 2026-09-03)

| Question | Decision |
|---|---|
| Business model | Productized enterprise software: annual platform license (Core / Professional / Enterprise packages by module set) + one-time implementation + managed hosting/support. No per-user pricing. No multi-tenant SaaS. |
| Delivery | One independent deployment per customer: own domain, Nuxt, Odoo, PostgreSQL, files, backups. Managed (we host) or On-prem (they host, we ship updates). |
| Engine | Odoo 19 CE pinned to `origin/19.0`, fixes pulled on our schedule. Zero modifications inside `odoo/` or `addons/`. Everything in our addons. Major migration every ~3 years via OpenUpgrade. |
| Frontend | Nuxt 4 + Vue 3 + TypeScript + Tailwind v4 + shadcn-vue. PWA. Arabic-first RTL, English secondary. |
| Topology | Single origin behind a reverse proxy. Nuxt at `/`, Odoo at `/api/v1`, `/web/content`, `/websocket`, `/odoo`. Session cookie only; no CORS, no bearer keys for humans. |
| API | Addon `nasq_api` (shared plumbing) plus one addon per pillar (`nasq_pmo`, …), routes `type='json2'`, `auth='user'`, versioned `/api/v1`. Serializers whitelist fields. Permissions stay in Odoo (ACL + `ir.rule`). |
| Login | Custom Nuxt login page calling `/web/session/authenticate`. Password + 2FA (TOTP) in v1. SSO deferred (Enterprise package). |
| Users | Internal employees only in v1. External/portal users deferred. |
| MVP scope | Projects + tasks + people (read) + settings. |
| Time logging | **None, product-wide** (decided 2026-09-04). No timesheets, no time tab, no time reports; `hr_timesheet` is not a dependency. `allocated_hours` on a task is a planned-effort estimate, not a log. |
| Deferred | Risks, initiatives, meetings, KPIs, Gantt, external users, SSO, native app. |
| Writes | Optimistic only for plain field edits; state transitions / approvals are pending → server-validated → confirmed. Every write response returns the full record; the client always replaces its cache with it. |
| Notifications | In-app real-time (bus) + daily email digest. No per-event email by default. |
| Roles | `employee` (Nuxt only) · `customer_admin` (Nuxt + Settings section) · `vendor_support` (full Odoo). Nobody at the customer opens Odoo. |
| Branding | Source of truth = DB (`res.company` + added fields). `branding.json` seeds it at provisioning. `GET /api/v1/branding` is public + cached (login page). |
| Repo | Monorepo `~/code/nasq/`: `apps/web`, `odoo-addons/`, `packages/contracts`, `deploy/`, `docs/`. `web_theme_shadcn` moves in from `~/code/odoo-addons`. |
| OCA | All 8 OCA modules currently installed are AGPL-3 → removed. `~/code/oca/*` leaves `addons_path`. |
| Odoo admin theme | `web_theme_shadcn` stays, for the vendor console and so branding CSS variables match the product. |
| Product name | `nasq` — addon prefix `nasq_*`, npm scope `@nasq/*`, domain `nasq.sa`. White-label: customers see their own brand. |

## Product surface

### Screens (employee)

| Screen | Shows | Primary action | Odoo source |
|---|---|---|---|
| Today | My due tasks, approvals waiting on me, what changed | Complete / approve | `project.task` (state, date_deadline, user_ids) |
| My tasks | Table with sort/filter/group + personal stages | Inline state change | `project.task` + personal stage |
| Projects | List with status (on_track / at_risk / off_track) and progress | Open | `project.project` + latest `project.update` |
| Project | Tabs: board · list · milestones · updates | Add task | `project.task`, `project.milestone`, `project.update` |
| Task (modal) | Title, state, assignee, deadline, description, subtasks, dependencies, comments | Autosave | `project.task`, `mail.message` |
| People | Employees, departments, load per person | Open | `hr.employee`, `hr.department` |
| Reports | Overdue, completion, workload per person | Export | aggregates over tasks |
| Login | Customer-branded, password + 2FA | Sign in | `/web/session/authenticate`, `auth_totp` |

### Settings section (customer_admin only)

| Page | Manages | Odoo source |
|---|---|---|
| Branding | Name, logo, primary colour, font, live preview of app + login | `res.company` + `nasq_core` fields |
| Users | Invite by email, role (employee / admin), deactivate, reset 2FA | `res.users`, groups |
| Departments | Structure, manager per department | `hr.department` |
| Projects | Default stages, states, tags, who may create projects | `project.task.type`, `project.tags`, groups |

Admin actions on people (invite, deactivate, change role) live inline on the
People page, visible to admins only; they are not duplicated in Settings.

### Design rules (binding)

1. Tables are the default; kanban is an optional tab.
2. Task detail is a drawer (`Sheet`), never a page. Context is never lost.
3. One primary action per screen (one black button); everything else secondary or in `⋯`.
4. Autosave + optimistic updates for field edits; no Save button.
5. Skeletons, not spinners.
6. State is one coloured badge with a fixed vocabulary: قيد التنفيذ · بانتظار · معتمد · منجز · ملغى.
7. `⌘K` for navigation, creation and state changes; keyboard is first-class.
8. Every empty state has an Arabic message and one action.
9. Tokens are law: zinc palette, one accent, IBM Plex Sans Arabic, 8px grid, `0.5rem` radius.
10. Native RTL: `dir="rtl"` + Tailwind logical properties; `ar-SA` numbers and dates.

## Roles and groups (`nasq_core`)

```
nasq_core.group_employee        ACL on projects, tasks, timesheets, own profile
nasq_core.group_customer_admin  + users, employees, departments, project settings, branding
nasq_core.group_vendor_support  = base.group_system
```

- The Settings link in the app renders only for `customer_admin` and `vendor_support`.
- `customer_admin` cannot install/upgrade modules or reach Settings › Technical.
- In on-prem deployments the customer may disable the vendor account and
  re-enable it when requesting support. All vendor actions are tracked in Odoo.

## Architecture

### Topology

```
https://app.customer.com
        │
   Caddy / nginx
        ├── /                →  Nuxt (Node, SSR)              :3000
        ├── /api/v1/*        →  Odoo  (nasq_api)              :8069
        ├── /web/content/*   →  Odoo  (attachments, images)   :8069
        ├── /web/session/*   →  Odoo  (login, logout, info)   :8069
        ├── /websocket       →  Odoo  gevent (bus)            :8072 (workers>0) / :8069 (dev)
        └── /odoo/*  /web/*  →  Odoo web client (vendor only) :8069
```

The browser holds one `session_id` cookie for the origin. Nitro forwards it on
SSR fetches; client-side fetches send it automatically. No BFF beyond a
transparent proxy and the login/logout route handlers.

### Flows

**Login**
```
POST /auth/login (Nitro)  →  POST /web/session/authenticate {db, login, password}
                          ←  Set-Cookie: session_id  (2FA challenge handled via auth_totp routes)
GET  /  (SSR)             →  /web/session/get_session_info → user context → rendered HTML
```

**Read** — SSR on first load (`$fetch` with forwarded cookie), then client-side
via TanStack Query; cached, revalidated in background.

**Write** — `PATCH /api/v1/tasks/17 {state}` → `task.write()` (constraints,
tracking, chatter, followers for free) → `bus._sendone(...)` → `200 {task}`.
Client replaces cache with the returned record; on 4xx rolls back + toast.

**Real-time** — Odoo `bus.bus` on write → `/websocket` → `useBus()` composable
→ `queryClient.invalidateQueries([...])`.

**Files** — `/web/content/<attachment_id>` and `/web/image/...` unchanged.

**Reports (PDF)** — Odoo report controllers unchanged.

### Odoo side

One addon per pillar, plus one addon of shared plumbing under it. A pillar
never edits another pillar's files; `nasq_api` is the only addon both may
read from, and neither may import from the other.

```
odoo-addons/
├── nasq_core/                    depends: base, project, hr, hr_timesheet — the group
│                                 records, whose implied_ids are why project/hr/
│                                 hr_timesheet are declared, plus the branding
│                                 fields and defaults on res.company
├── nasq_api/                     depends: nasq_core, auth_totp — SHARED PLUMBING ONLY
│   ├── controllers/  common.py (ApiError · api_handler · get_record ·
│   │                 parse_nonneg_int) · auth.py · branding.py · me.py
│   ├── serializers/  common.py (iso) · company.py · user.py
│   └── tests/        common.py (NasqApiCase: the two roles + api()) ·
│                     test_branding.py · test_me.py · test_totp.py
├── nasq_pmo/                     depends: nasq_api, project, hr, mail, bus — THE PROJECT PILLAR
│   ├── controllers/  tasks.py · timeline.py · personal_stages.py · projects.py · people.py
│   ├── serializers/  task.py · timeline.py
│   ├── models/       project_task.py (transition hooks + bus notifier, one class)
│   └── tests/        common.py (NasqPmoCase: NasqApiCase + project/task records) ·
│                     test_tasks.py · test_timeline.py · test_personal_stages.py ·
│                     test_bus.py · test_transition.py
├── nasq_hr/                      the HR pillar, same shape, built on the same nasq_api
├── web_theme_shadcn/             vendor console theme (moved from odoo-addons repo)
└── customer_<name>/              per-customer overlays; never merged into core
```

The same rule shapes the web side: `apps/web/i18n/locales/<locale>/<pillar>.json`
merged by `@nuxtjs/i18n`'s per-locale `files: [...]`, and
`packages/contracts/src/{common,pmo,hr}/` each with its own `index.ts` behind a
root barrel. See `docs/parallel-work.md`.

Route conventions:

- `@http.route('/api/v1/...', type='json2', auth='user', methods=[...], readonly=<bool>)`.
  `json2` is a general dispatcher (`Json2Dispatcher`, `odoo/http.py`), used by
  `api_doc` with `auth='user'`; it gives raw JSON in/out, real HTTP status codes
  via `handle_error`, no CSRF token (JSON content-type), and `readonly=True`
  routes get a read-only cursor. `type='http'` would require CSRF tokens on
  PATCH/POST or `csrf=False`.
- `auth='bearer'` is server-to-server only (global API key; cookie-authenticated
  XHR is rejected by the Sec-Fetch check in `ir_http._auth_method_bearer`).
- Serializers are the contract: they `dump()` a whitelist of fields and
  `parse()` a whitelist of writable fields. Nothing else crosses.
- Errors: `{ "code": "...", "message": "...", "field": "...?" }` with HTTP status.
- Public method hooks: any core method over ~15 lines is split into
  `_check_*` / `_get_*` / `_do_*` / `_post_*_hook` so customer overlays override
  one step, not the whole method.

### API contract v1

```
GET   /api/v1/branding                       public, cached
GET   /api/v1/me
GET   /api/v1/me/today
GET   /api/v1/tasks?filter=mine|project=..   PATCH /api/v1/tasks/{id}   POST /api/v1/tasks
POST  /api/v1/tasks/{id}/comments            POST  /api/v1/tasks/{id}/time
POST  /api/v1/tasks/{id}/transition          {state}  (pending-confirm path)
GET   /api/v1/projects                       GET   /api/v1/projects/{id}
GET   /api/v1/projects/{id}/board|list|milestones|updates
GET   /api/v1/people                         GET   /api/v1/departments
GET   /api/v1/reports/time|overdue|completion
GET|PATCH /api/v1/admin/branding             customer_admin
GET|POST|PATCH /api/v1/admin/users           customer_admin
GET|POST|PATCH /api/v1/admin/departments     customer_admin
GET|PATCH /api/v1/admin/project-defaults     customer_admin
WS    /websocket                             bus, unchanged
```

~20 endpoints. Contract types live in `packages/contracts` as zod schemas
(single source of truth for the frontend; runtime-validated). Odoo does not
emit OpenAPI; the serializers are the server-side mirror and are tested against
the zod schemas in CI.

### Frontend stack

| Layer | Choice | Role |
|---|---|---|
| Framework | Nuxt 4, Vue 3.5, TypeScript strict | SSR, Nitro proxy, file routing |
| Styling | Tailwind v4, logical properties | RTL, tokens as CSS variables |
| Components | shadcn-vue (reka-ui) | copied into repo, owned |
| Icons | lucide-vue-next | |
| Server state | @tanstack/vue-query | cache, optimistic, revalidate |
| Tables | @tanstack/vue-table via shadcn DataTable | |
| Forms | vee-validate + zod | shared validation with contracts |
| UI state | Pinia (minimal) | drawer open, sidebar collapsed |
| Utilities | VueUse | hotkeys, storage, media |
| Dates | @internationalized/date + Intl | `ar-SA` |
| i18n | @nuxtjs/i18n, `ar` default | |
| Real-time | thin wrapper over native WebSocket | Odoo bus protocol |
| PWA | @vite-pwa/nuxt | installable, push later |
| Tests | Vitest, Playwright (against real Odoo) | |
| Quality | ESLint, Prettier, vue-tsc | |

Deliberately absent: Redis (Odoo does not use it), GraphQL, Nuxt UI / PrimeVue.

### Repo layout

```
nasq/
├── apps/web/                       Nuxt 4
│   ├── app/pages/                  today · tasks · projects/[id] · people · reports · settings/*
│   ├── app/components/ui/          shadcn-vue
│   ├── app/components/task/        TaskDrawer · TaskTable · StateBadge
│   ├── app/composables/            useTasks · useBus · useHotkeys · useBranding
│   ├── app/layouts/default.vue     Sidebar + ⌘K
│   ├── app/assets/css/tokens.css
│   ├── server/api/auth/            login.post.ts · logout.post.ts
│   └── nuxt.config.ts              routeRules proxy → Odoo
├── packages/contracts/             zod schemas + TS types
├── odoo-addons/                    nasq_core · nasq_api · nasq_pmo · web_theme_shadcn · customer_*
├── deploy/
│   ├── docker-compose.yml          proxy · web · odoo · db
│   ├── Caddyfile
│   ├── branding.example.json
│   └── provision.sh                one command = one customer environment
└── docs/superpowers/{specs,plans}/
```

### Deployment per customer

Four containers: `proxy` (Caddy, TLS), `web` (Nuxt build, stateless), `odoo`
(19 + `odoo-addons` volume, `--workers N`, gevent for websocket), `db`
(PostgreSQL 16). `provision.sh` creates the environment, seeds branding, creates
the vendor account. Upgrade = new `web` image + new `odoo` image with
`-u nasq_core,nasq_api,nasq_pmo`. Our addons ship `migrations/<version>/` for
every schema change; supported core versions: current + previous.

## Testing

- `nasq_api/tests/test_api.py`: `HttpCase`, `@tagged('post_install','-at_install')`,
  one test per endpoint + one per role (employee cannot reach `/admin/*`).
- Contract test: serializer output validates against `packages/contracts` zod schemas.
- Frontend: Vitest for composables/components; Playwright e2e against a real
  Odoo (`nasq_test` DB) for login, the task detail modal, state transition, settings.
- CI matrix: core alone (`-i nasq_core,nasq_api,nasq_pmo`) **and** core + each
  `customer_*` overlay. Core tests must pass with every overlay installed.
- Lint: `ruff check odoo-addons/`, `npx eslint`, `vue-tsc --noEmit`.

## Phases

nasq's full scope is the four pillars in Goal (initiatives, projects, HR,
meetings). Phases 0-3 below deliver the **project-management pillar only**,
built first because it is the fastest path to a demo-able product for Erada.
The remaining pillars (initiatives, HR beyond read-only "People", meetings)
are phase-4-and-later work, not out-of-scope forever.

| Phase | Delivers | Duration |
|---|---|---|
| 0 — Foundation | Monorepo, `nasq_core` groups + branding fields, `nasq_api` skeleton (`/branding`, `/me`), Nuxt shell (login, sidebar, ⌘K, tokens, RTL, proxy), `deploy/` compose, remove OCA modules | 1 week — done 2026-09-04 |
| 1 — Core | My tasks table + board, task detail **modal** at `/tasks/{id}` (autosave, comments, sub-tasks), real-time | Delivered 2026-09-04 |
| 2 — Projects | Projects list, project screen (list / board by project stage, status set by managers) — spec `2026-09-04-nasq-phase-2-projects-design.md` | 3 weeks |
| **Demo to Erada** | | **~7 weeks** |
| 3 — Completion | Today, People, Reports, Settings (4 pages, incl. create/edit project and stages), milestones and project updates, hide Odoo noise, PWA | 3 weeks |
| 4 — Later packages | Gantt (custom build), risks, initiatives, meetings, KPIs, SSO, portal users | per package |

## Out of scope (v1)

Risks, initiatives, meetings, KPIs, Gantt, external/portal users, SSO, native
app, accounting/invoicing, payroll, multi-tenancy, dark mode.

## Licensing

- Odoo CE is LGPL-3 and stays unmodified; our addons and the Nuxt app carry our
  license. Never depend on Odoo Enterprise (OPL-1).
- All 8 OCA modules in the current dev DB are AGPL-3 and are removed before any
  customer deployment. `project_task_code` and `project_milestone_status`
  behaviour is re-implemented in `nasq_pmo` (~30 lines).
- Trademark: "Odoo" does not appear in customer-facing UI.

## Known constraints (verified in source, 2026-09-03)

- `/xmlrpc`, `/jsonrpc` are deprecated in 19 and removed in 22
  (`addons/rpc/controllers/__init__.py`). We use neither.
- `Json2Dispatcher` registers `type='json2'` for any route (`odoo/http.py`,
  `_dispatchers` via `__init_subclass__`); the `route()` docstring is stale.
- `/websocket` listens on the gevent port (8072) only when `--workers > 0`;
  in threaded dev mode everything is on 8069. The proxy config must handle both.
- `web._assets_primary_variables` is shared with the frontend bundle, so theme
  tokens also reach portal pages (irrelevant once portal is unused).

## Open items

- **Team & deadline** (Q10): solo or with developers; when Erada must see a
  working version. If shorter than 7 weeks, phase 2 shrinks to "projects list +
  board" and milestones/updates move to phase 3.
- **Erada existing data** (Q11): if they have projects/tasks elsewhere, one-time
  CSV import via `base_import`; no integration.
