# nasq

## Current UI authority — 2026-09-07

For all Nasq customer-UI work, read [DESIGN.md](DESIGN.md) first, then the component catalog and frontend/theme role linked there. The approved module rail and contextual sidebar supersede older visual/navigation instructions. This is project-local policy; existing business, security and delivery rules still apply. The reference is approved; runtime migration remains a separate implementation phase.

nasq (نَسَق) is a resellable project and task management product. Odoo 19 CE
is the engine and Nuxt 4 is the customer UI. Each customer has an independent
deployment, database, Odoo instance, and frontend; there is no shared tenant
layer. The platform design is in
[`docs/superpowers/specs/2026-09-03-nasq-platform-design.md`](docs/superpowers/specs/2026-09-03-nasq-platform-design.md).

## Current product

This unified checkout contains the PMO, HR and access administration surfaces:

- Tasks at `/tasks`, including personal stages, board and table views,
  timelines, comments, task updates, and real-time bus updates.
- Projects at `/projects`, including project tasks, stages, milestones, status
  updates, followers, archive actions, tags, and project settings.
- The HR directory at `/hr`, including company-wide employee cards, department
  hierarchy, employee archive controls, and department documents.
  HR routes live under `/api/v1/hr/*` and use employee ids. The PMO assignee
  picker at `/api/v1/people` remains a user-id resource.
- Access administration at `/settings/users`, roles and audit with capability
  checks. Branding settings edit the primary colour; Odoo system administrators
  manage institution name/logo. `/account` handles self password changes.
- PMO adds task attachments, recipient notifications, dependencies and a routed
  archived-task list with restore. HR document creation and edits use pages.
- Arabic is the default locale and the UI supports RTL. The sidebar exposes
  tasks, projects, HR, and capability-gated settings/admin entries.

Task detail is a full page at `/tasks/{id}` and at
`/projects/{id}/tasks/{taskId}`. Returning from a nested task preserves the
query filters in the URL; scroll restoration is not part of the contract.

The [unification report](docs/unification-2026-09-05.md) records current
verification and recovery. [WORKSPACE.md](docs/WORKSPACE.md) is the canonical
workspace map. Earlier branch delivery reports under `docs/superpowers/` are
historical evidence. All business workflows use normal internal pages with
filter-preserving back navigation; destructive confirmation stays inline.

## Local development

The canonical checkout is `/Users/tariq/code/nasq`. A
temporary worktree may be used for a bounded task. Always point the Odoo
addons path at that chosen Nasq worktree; `/Users/tariq/code/odoo` is the
read-only Odoo 19 upstream source checkout. Authorized commands may use an
explicitly isolated scratch database; do not operate on arbitrary databases.

Run the two services with isolated values for each worktree:

```sh
# Odoo, from the read-only upstream checkout
cd /Users/tariq/code/odoo
.venv/bin/python odoo-bin -c /Users/tariq/code/odoo/odoo.conf \
  --addons-path=/Users/tariq/code/odoo/addons,/path/to/nasq-worktree/odoo-addons \
  -d nasq_scratch --http-port=8169

# Nuxt, from the selected Nasq worktree
cd /path/to/nasq-worktree
NUXT_ODOO_URL=http://127.0.0.1:8169 \
NUXT_ODOO_DB=nasq_scratch \
NUXT_PUBLIC_WS_URL=ws://localhost:8169/websocket \
npm -w apps/web run dev -- --port 3100
```

Use a unique Odoo database and HTTP port, and a matching Nuxt port, for every
active worktree. Install dependencies independently in each worktree with
`npm ci --ignore-scripts`; use the local cache when working offline. Do not
share `node_modules` or `.nuxt` through symlinks. Never run tests against the
production-style `odoo19` database.

The ordinary local development topology is Odoo `:8069` and Nuxt `:3000`.

The deployment templates are in [`deploy/`](deploy/). They describe a
customer deployment and are not proof that a deployment has been performed.
No production deployment or DNS cutover is implied by this repository.

## Layout and ownership

- `apps/web` contains the Nuxt UI, per-pillar composables/components, and
  locale files.
- `packages/contracts` contains the Zod wire contracts. Shared contracts live
  under `src/common`; PMO contracts under `src/pmo`; HR contracts under
  `src/hr`.
- `odoo-addons/nasq_core` owns groups and branding defaults;
  `nasq_api` owns shared API plumbing; `nasq_pmo` owns projects/tasks and the
  user-id people picker; `nasq_hr` owns HR routes, documents, and employee
  directory behavior.
- `deploy` contains per-customer provisioning and reverse-proxy templates.

The detailed one-writer ownership and isolation workflow is in
[`docs/parallel-work.md`](docs/parallel-work.md). There is currently no Nasq
Git remote configured, so repository work is local until an explicit remote is
provided. Do not invent a remote URL or imply that a push occurred.

## Documentation

Phase specifications and plans are under `docs/superpowers/{specs,plans}`.
The shipped phase documents describe implementation intent and scope; current
runtime and verification status must be confirmed from the active checkout and
fresh checks before making a release claim.
