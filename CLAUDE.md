# CLAUDE.md — nasq

واجهة العميل: [DESIGN.md](DESIGN.md) هو نقطة البداية وسياسة التصميم الوحيدة، وفيه روابط الفهرس والمرجع التقني.
هذا الملف يملك المعمارية والعقود والأمن والبيانات. [أرشيف الواجهة](docs/archive/ui/README.md) والتقارير لا يغيّران هذه القواعد.

nasq (نَسَق) is a resellable project and task management product on Odoo 19
CE. Odoo is the engine and `apps/web` (Nuxt 4) is the customer UI. The current
deployment templates run an independent database, Odoo instance, frontend, and
edge per customer. The **target primary model** is self-service SaaS on shared
application services, retaining a separate database and filestore per customer;
it has not been implemented or accepted for release. Managed dedicated remains
separate from customer-hosted non-SaaS, which must not require SaaS billing or a
vendor connection at runtime. Nasq has a tenant abstraction through
`nasq_platform`, but tenant isolation remains database-per-tenant. There is no
shared-database tenant layer. Customer-specific behavior belongs in a
`customer_<name>_*` overlay, never in the core pillars. See the new
[hosting and acceptance contract](docs/superpowers/specs/nasq-shared-saas-and-sovereign-deployment.md)
for the target and its pending gates; the older
`docs/superpowers/specs/2026-09-03-nasq-platform-design.md` describes its own
historical scope. Government packaging from one release line is preferred for
assessment; a permanent fork is not approved by default.

## Repository layout

- `odoo-addons/nasq_core` owns the capability catalog, roles, assignments, access audit, migration and identity protection.
- `odoo-addons/nasq_platform` owns the tenant profile singleton and `root_company_id`.
- `odoo-addons/nasq_api` owns shared `/api/v1` plumbing, common serializers,
  authentication, branding, and the shared test fixture. It does not import a
  pillar.
- `odoo-addons/nasq_pmo` owns projects, tasks, timelines, project settings,
  attachments, dependencies, archive/restore, recipient notifications,
  and `/api/v1/people` (the task assignee picker, whose ids are `res.users`
  ids).
- `odoo-addons/nasq_hr` owns the HR directory, departments, documents, HR
  serializers/controllers, and `/api/v1/hr/*` (employee ids are
  `hr.employee` ids).
- `odoo-addons/cyan_meeting_minutes` provides the preserved LGPL meeting engine.
  Nasq meeting routes, serializers, task conversion and recipient notifications
  extend it through `nasq_pmo`; `nasq_core` owns meeting capability grants.
- `packages/contracts/src/common`, `src/access`, `src/pmo`, and `src/hr` hold the Zod wire
  contracts; each namespace has a barrel re-exported from `src/index.ts`.
- `apps/web` holds Nuxt pages, components, composables, and per-pillar locale
  files. `/hr` is the shipped HR directory; `/people` is not the HR route.
- `odoo-addons/web_theme_shadcn` holds the vendor-console theme.
- `deploy` holds per-customer Docker, Caddy, provisioning, and branding
  templates.

## Unified product state

The unified checkout brings together Phase 3b, routed internal pages, capability
administration, the design system, HR hierarchy/documents, and PMO collaboration.
The checkout map and delivery records are linked from `docs/WORKSPACE.md`.
Confirm the selected branch and working tree before reading implementation
guidance; dated delivery/recovery reports are historical snapshots and do not
override the capability policy below.

HR manages employee records and archival. Account grants, role assignments,
password resets and reactivation belong to `/settings/users` and the
`/api/v1/admin/users` API. Archiving an employee disables linked access;
unarchiving does not reactivate the login. `/account` changes one's own password.
Nasq branding settings edit only `primary_color`. Institution name and logo
are managed in Odoo by `base.group_system`, with company, related partner and
attachment guards against indirect identity changes.

The Odoo upstream checkout is `/Users/tariq/code/odoo`, branch `19.0`. Its
source, configuration, and Git state are read-only for this project; source
inspection and read-only Git audits are allowed. Authorized Odoo commands may
create or update an explicitly isolated test/development database, but never
operate arbitrarily on a database or run tests against the dev `odoo19`
database. Always pass the selected Nasq worktree's `odoo-addons` path
explicitly; do not assume an Odoo config points at a particular Nasq checkout.

## Product contracts

- Presentation follows DESIGN.md (pages, the route-backed `SharedCreatePanel`
  for `/new`, and the overlay exceptions: search, notification bell, unsaved
  draft). Keep stable routes, visible headings, direct-link/refresh support,
  and back navigation that preserves list filters. Task board view is
  `?view=board`. Destructive actions use explicit inline confirmation. Do not
  stack business dialogs. Selection menus remain controls, not business
  screens.
- Arabic (`ar`) is the default locale and the UI is RTL-first. User-facing
  strings use `$t()`/`t()` and the owning locale namespace.
- Use Tailwind logical properties (`ms-`, `me-`, `ps-`, `pe-`, `start-`,
  `end-`, `text-start`); preserve the existing design tokens.
- API routes use `type='json2'`, `auth='user'`, explicit methods, and the
  shared `api_handler`. Return serializer-whitelisted shapes and structured
  errors with a real HTTP status: 403 `forbidden`, 404 `not_found`, and 422
  `invalid` where applicable. Browser traffic uses the session cookie, not a
  bearer token.
- Keep `/api/v1/people?q=` and its user-id `PersonRef` contract unchanged.
  HR employee ids and user ids are distinct resources and must not be merged.
- `nasq_hr` has no `sudo()` path. In PMO, only the documented manager-write,
  policy/config, display-lookup, integer-count, completion-status and notification cases use `sudo()` after the
  caller's authorization check; do not add another case without documenting
  it and fixing ACLs/rules where possible.
- nasq has no time logging or payroll product surface. Do not add
  `hr_timesheet`, timesheet fields/endpoints, payroll, bank, or compensation
  data to the customer UI.
- Task detail routes are `/tasks/{id}` and `/projects/{id}/tasks/{taskId}`.
  Presentation follows DESIGN.md. Preserve URL query filters when returning;
  do not promise scroll restoration without evidence.

## Safe worktree workflow

Use one temporary worktree per bounded task, named `codex/<task>`. Worktrees
must have independent `node_modules` and `.nuxt` directories; do not symlink
either one. One writer owns each file, and one orchestrator owns shared files,
Git integration, runtime state, and final checks. The ownership and collision
map is in `docs/parallel-work.md`.

For a worktree, install with `npm ci --ignore-scripts` (using the local cache
when offline). Set its own `NUXT_ODOO_URL`, `NUXT_ODOO_DB`,
`NUXT_PUBLIC_WS_URL`, and Nuxt `--port`. Start Odoo with an explicit addons
path, an isolated scratch database, and a unique `--http-port`. Never run
tests against the production-style `odoo19` database. Temporary integration
databases, ports, and logs are disposable and must not be described as
production evidence.

The Nasq Git remote is `origin` (`https://github.com/tariiq222/nasq.git`),
tracked by `main`. Fetch and compare `main` with `origin/main` before
integration work. Push only when the user authorizes that push, and do not
force-push or rewrite published history. Do not imply a push, merge,
deployment, DNS cutover, or release approval that did not happen. Preserve
unrelated user changes and inspect status/diffs before editing overlapping
files.

## Python and API conventions

Every Python file begins with the Odoo copyright header. Addons use
`'license': 'LGPL-3'`, version `19.0.1.0.0`, and author `Tariq Alwalidi`.
Avoid Enterprise and OCA dependencies. Serializers explicitly whitelist wire
fields; never send a raw `read()` result. A write returns the full server
shape, and the client replaces its cache with that response.

Authorization uses the 28 capabilities in `nasq.access.service`, built-in and
custom roles, and company-scoped assignments. `system_admin` manages access
and settings without implicitly granting HR/PMO write access. Project ownership
contributes contextual PMO capabilities. Legacy groups are migration/ORM support,
not a substitute for capability checks. Every resource operation also enforces
current-company and record visibility. Customers do not open Odoo.

## Verification boundary

Run focused checks appropriate to the changed layer, then the owning
orchestrator runs broader gates once. Odoo addon checks run from
`/Users/tariq/code/odoo` against a fresh scratch database with the selected
Nasq worktree's addons path. Web checks run from the selected worktree. Fresh
test output proves that checked layer only; it is not production or DNS proof.
Before claiming completion, report changed files, fresh command evidence, and
any residual risk.

Integration is a merge operation owned by the orchestrator. Do not rewrite
history on another worker's branch. Remove branches or
worktrees only after their content is preserved and no process is using them.

## Odoo addon and API rules

- Every Python file starts with `# Part of Odoo. See LICENSE file for full
  copyright and licensing details.` Addon manifests use `'license': 'LGPL-3'`,
  version `19.0.1.0.0`, and author `Tariq Alwalidi`. Do not add OCA or
  Enterprise dependencies. Keep `ruff check odoo-addons` clean.
- Routes use `@http.route('/api/v1/...', type='json2', auth='user',
  methods=[...], readonly=<bool>)` and `@api_handler`. Errors use
  `{"code": "<snake_case>", "message": "<human>", "field"?: "<name>"}`
  with a real HTTP status: 403 `forbidden` or `transition_forbidden`, 404
  `not_found`, and 422 `invalid`. Never use `type='http'` for JSON or
  `auth='bearer'` for browser traffic. Never use `sudo()` to dodge an access
  error; fix the group or record rule.
- Serializers whitelist fields explicitly: shared shapes belong in
  `nasq_api/serializers`, PMO shapes in `nasq_pmo/serializers`, and HR shapes
  in `nasq_hr/serializers`. Never send a raw ORM `read()` result. Every write
  returns the full detail shape.
- Task state names on the wire are
  `in_progress | changes_requested | approved | waiting | done | cancelled`,
  mapped to Odoo `01_in_progress | 02_changes_requested | 03_approved |
  04_waiting_normal | 1_done | 1_canceled`. Write and approve capabilities
  and record-specific allowed actions decide transitions; do not infer them
  from a legacy role label.
- Branding source of truth is `res.company`; `deploy/branding.json` seeds it.
  The public branding response is cached. The customer UI edits and sends only
  `primary_color`, and ignores stored secondary colour for rendering. The API
  retains optional `secondary_color` compatibility; it rejects identity fields
  and mixed identity/color requests before any write.
- PMO project management uses record-scoped `_nasq_can_manage` and checked
  private mutation helpers. Task writes, approvals, archive, dependency edits
  and attachment mutations preserve their dedicated capability/visibility gates.
- Documented PMO elevated operations are policy/config access, policy-based
  project creation, checked manager mutations, serializer display lookups,
  integer counts, automatic completion status after an authorized task
  mutation, and notification delivery/recipient-owned reads. Notification
  elevated reads must first restrict recipient and readable current-company
  tasks or meetings; resource lookup stays in the caller's ordinary ACL and
  record-rule environment. Meeting-only access must not reveal task/digest
  notifications. Do not add an undocumented bypass.
- The project charter is written as a stepper: basics, then the optional
  steps the project type configures (`charter_steps` on `nasq.project.type`,
  exposed on the types catalog and on `charter.type`), then review. The
  charter carries `state` (`draft | final`); a new charter is a draft and the
  review step finalizes it. `/projects/new` uses the route-backed create panel
  (`SharedCreatePanel`), like other `/new` routes.
- Task comments are one conversation per task family: `/tasks/{id}/timeline`
  returns the comments of the topmost readable ancestor and every readable
  descendant (each carries `task`), while tracking entries stay per task. A
  comment is stored on the task it was posted from. `POST .../comments` takes
  plain-text `body` plus optional `mentions` (user ids, the `/people`
  population) and `task_refs` (family task ids from `.../thread-tasks`); the
  server marks up only declared `@name` / `/task name` tokens present in the
  text. A mention sends one `mention` notification, only to a person who can
  read the task, and replaces that person's `comment` row.
- Task attachment uploads accept PDF, PNG, JPEG, text, DOCX and XLSX up to
  10 MiB decoded, with exact binary task linkage and ordinary attachment ACLs.
  Dependency edits require project management, same active project, positive
  unique IDs and no cycles. Restores require a readable active parent project.

## Frontend and machine rules

- Arabic is default (`ar`), English is secondary, and i18n uses `no_prefix`.
  Every user-facing string uses `$t()`/`t()` in the owning per-pillar file
  under `apps/web/i18n/locales/{ar,en}`. A pillar's `nav.*` label is the
  deliberate shared `common.json` exception. HR owns `hr.json` and the `/hr`
  page; PMO owns `tasks.json`, `projects.json`, `settings.json`, and the
  unchanged user-id people picker.
- RTL styling uses logical Tailwind properties only (`ms-`, `me-`, `ps-`,
  `pe-`, `start-`, `end-`, `text-start`), never physical `ml-`, `pl-`, or
  `left-` classes. Keep the shared tokens owned by `apps/web/app/assets/css/`
  and configure Nuxt UI primitives through `apps/web/app/app.config.ts`.
- Authenticated interactive controls whose first click must not be lost during
  SSR hydration use the shared `useHydrated()` composable and stay disabled
  until hydrated. Do not replace this with per-component `mounted` flags or
  make the whole authenticated app client-only. Hydration tests assert the
  disabled-to-enabled transition before clicking.
- Storybook (`npm -w apps/web run storybook`, `apps/web/stories/**`) is the
  mandatory component catalog for every agent: reuse the story component; a
  shared component ships with its story and is listed in `STORYBOOK_COMPONENTS`
  (`tools/ui_policy.py`) before a second page uses it. No local copy of a
  component that has a story.
- Nuxt UI components are the customer control surface. Preserve their RTL
  semantics, keyboard behavior and public props/slots; shared composite
  components are documented in `docs/design-system/components.md`.
- The data layer uses `@tanstack/vue-query` composables over `useApi()`, which
  throws `ApiError {status, code, message, field}`. Plain edits may be
  optimistic; transitions and approvals remain pending until the server
  confirms them. Replace cache entries with the server response.
- The topology is same-origin behind a reverse proxy: Nuxt `/`, Odoo
  `/api/v1`, `/web/content`, and `/websocket`, and vendor console `/odoo`.
  Session cookies are used; no CORS or bearer tokens for browser flows.

## Check commands

Run Odoo checks from `/Users/tariq/code/odoo` using a fresh scratch database
and the selected Nasq worktree's explicit addons path. Use a scratch-only
config at `/absolute/path/to/scratch-only.conf`; do not use a live config whose
`data_dir` or `logfile` points inside the read-only Odoo checkout. Keep the
temporary data and logs outside that checkout, and remove the scratch database,
temporary data, logs, and scratch-only config after the check:

```sh
export PYTHONDONTWRITEBYTECODE=1
cd /Users/tariq/code/odoo
ODOO_ROOT=/Users/tariq/code/odoo
ODOO_PYTHON="$ODOO_ROOT/.venv/bin/python"
ODOO_CONF=/absolute/path/to/scratch-only.conf
WORKTREE=/absolute/path/to/nasq-worktree
SCRATCH_ROOT=$(mktemp -d)
mkdir -p "$SCRATCH_ROOT/data" "$SCRATCH_ROOT/logs"
# Set PGHOST, PGPORT, PGUSER, and PGPASSWORD in the environment as needed;
# never put a password on the command line.
PGHOST=${PGHOST:-127.0.0.1}; PGPORT=${PGPORT:-5432}; PGUSER=${PGUSER:-tariq}
"$ODOO_PYTHON" "$ODOO_ROOT/odoo-bin" -c "$ODOO_CONF" \
  --addons-path="$ODOO_ROOT/odoo/addons,$ODOO_ROOT/addons,$WORKTREE/odoo-addons" \
  --db_host="$PGHOST" --db_port="$PGPORT" --db_user="$PGUSER" \
  -d nasq_scratch --db-filter='^nasq_scratch$' \
  --data-dir="$SCRATCH_ROOT/data" --logfile="$SCRATCH_ROOT/logs/odoo.log" \
  -i nasq_core,nasq_platform,nasq_api,nasq_pmo,nasq_hr,nasq_chat \
  --test-tags /nasq_core,/nasq_platform,/nasq_api,/nasq_pmo,/nasq_hr,/nasq_chat \
  --http-port=8169 --workers=0 --max-cron-threads=0 --stop-after-init
```

CI is Woodpecker (`.woodpecker.yml`); GitHub Actions is not used. The pipeline
has eight steps—`prepare`, `static`, `control-plane`, `odoo`, `upgrade`,
`restore-drill`, `image`, and `e2e-mock`. Each step is runnable locally with the
same command block in that file: static checks, the control-plane PostgreSQL
contracts, explicit scratch Odoo install/upgrade commands, the Docker image
checks, the backup and restore drill, and the mock Playwright run. The migration
policy is [`docs/migrations.md`](docs/migrations.md), and the pinned Odoo source
commit is [`deploy/odoo/ODOO_COMMIT`](deploy/odoo/ODOO_COMMIT).

Use `npm test` for contracts and web unit tests, `npm -w apps/web run lint`
(that is `vue-tsc --build --noEmit`) for the web type check, and
`cd apps/web && npm run test:e2e` for Playwright. Do not type-check with
`npx -w apps/web vue-tsc ...`: `npx` has no `-w` flag, so it silently runs
from the repo root, checks nothing, and exits 0. Every `vue-tsc` invocation
runs from `apps/web`. Employee fixtures are created through Odoo, never through the
Nuxt UI. API tests extend `NasqApiCase` from `nasq_api/tests/common.py` or
`NasqPmoCase` for PMO fixtures; every `test_*.py` must be imported by its
addon `tests/__init__.py`. Loading a code/data change into an authorized
development database may use `-u <addon> --no-http --stop-after-init`; never
run tests against the dev `odoo19` database.

The global `~/.npmrc` may be malformed. Use `npm ci --ignore-scripts` and never
edit that file. Use `rg` and targeted file reads for code search across Odoo and Nasq addons.

New collaboration endpoints require the current company. Company-less
projects and tasks are not visible after the Phase 1 backfill; isolation is
database-per-tenant with `nasq_platform.root_company_id`. Addon versions follow
[`docs/migrations.md`](docs/migrations.md).
