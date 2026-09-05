# nasq

nasq (نَسَق) is a resellable project and task management product. Odoo 19 CE
is the engine and Nuxt 4 is the customer UI. Each customer has an independent
deployment, database, Odoo instance, and frontend; there is no shared tenant
layer. The platform design is in
[`docs/superpowers/specs/2026-09-03-nasq-platform-design.md`](docs/superpowers/specs/2026-09-03-nasq-platform-design.md).

## Current product

This Phase 3b checkout contains the PMO and HR pillars:

- Tasks at `/tasks`, including personal stages, board and table views,
  timelines, comments, task updates, and real-time bus updates.
- Projects at `/projects`, including project tasks, stages, milestones, status
  updates, followers, archive actions, tags, and project settings.
- The HR directory at `/hr`, including company-wide employee cards, department
  administration, employee access/archive controls, and department documents.
  HR routes live under `/api/v1/hr/*` and use employee ids. The PMO assignee
  picker at `/api/v1/people` remains a user-id resource.
- Phase 3b also delivers customer branding administration and `/account`
  password changes. Existing HR document create/edit/read and attachment
  actions remain available from the departments tab.
- Arabic is the default locale and the UI supports RTL. The sidebar exposes
  tasks, projects, HR, and role-gated settings/admin entries.

Task detail is a full page at `/tasks/{id}` and at
`/projects/{id}/tasks/{taskId}`. Returning from a nested task preserves the
query filters in the URL; scroll restoration is not part of the contract.

Phase 3b is delivered in this local checkout. It expands the existing
people/HR, branding, and account surfaces; it does not replace the shipped HR
API or the PMO people picker. Its
working documents are [`docs/superpowers/specs/2026-09-05-nasq-phase-3b-people-branding-design.md`](docs/superpowers/specs/2026-09-05-nasq-phase-3b-people-branding-design.md),
[`docs/superpowers/plans/2026-09-05-nasq-phase-3b-people-branding.md`](docs/superpowers/plans/2026-09-05-nasq-phase-3b-people-branding.md),
and [`docs/superpowers/plans/2026-09-05-nasq-phase-3b-handoff.md`](docs/superpowers/plans/2026-09-05-nasq-phase-3b-handoff.md).

The final local verification records Odoo aggregate `182` green, contracts
`52` green, web `152` green, Playwright `47` green, and clean `ruff`,
`vue-tsc`, and production-build gates. This is branch-local evidence only;
canonical `main` remains the pre-Phase-3b baseline and no merge, push,
deployment, DNS cutover, or release approval is implied. Detailed evidence is
recorded in the [Phase 3b delivery report](docs/superpowers/plans/2026-09-05-nasq-phase-3b-delivery.md).

## Local development

The canonical checkout after integration is `/Users/tariq/code/nasq`. A
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
