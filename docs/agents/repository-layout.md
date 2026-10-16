# Repository layout and product state

Reference material moved out of `AGENTS.md`; the rules that always apply stay there.

## Product background

nasq (نَسَق) is an Arabic-first unified business platform whose vision is to
be the shared foundation for all of a company's business applications, with
connected data, workflows, and permissions. Its breadth of ambition is
comparable to Odoo: replace fragmented systems and subscriptions with one
coherent platform that companies can adopt progressively, aiming to reduce
total subscription, integration, and operating cost. PMO and HR are initial
applications, not the full product definition. Sales, finance, purchasing,
inventory, and other company functions are part of the broader vision, not
claims of currently delivered functionality. See the owner-approved
[product definition](../../apps/web/PRODUCT.md) dated 2026-09-30. Current delivery
limits describe implementation stages, not permanent product exclusions.

## Repository layout

- `odoo-addons/nasq_core` depends on `base` only. It owns the access service, the nine system capabilities, the
  built-in `employee`, `system_admin` and `vendor_support` roles, assignments, access audit, migration and identity
  protection. Applications add their capabilities to the catalog through `nasq.access.service` hooks.
- `odoo-addons/nasq_platform` owns the tenant profile singleton and `root_company_id`.
- `odoo-addons/nasq_api` owns shared `/api/v1` plumbing, common serializers,
  authentication, branding, and the shared test fixture. It does not import a
  pillar.
- `odoo-addons/nasq_notify` (shared service, rank 3) owns the notification bell:
  the generic `mail.message` columns `nasq_notification`, `nasq_notification_kind`
  and `nasq_notification_key` with its unique index, the `nasq.notify.registry`
  where applications register their notification kinds, delivery
  (`nasq.notify.service._nasq_deliver`) and `/api/v1/notifications`. It names no
  application.
- `odoo-addons/nasq_ai` (shared service, rank 3) owns the Nasq AI tool registry
  (`nasq.ai.tool.registry`, composed through `super()` by each application), the
  per-user audit log `nasq.ai.audit`, the `ai.*` features and limits, the `ai.use` capability (granted to the employee role), and the two
  routes `GET /api/v1/ai/tools` and `POST /api/v1/ai/audit`. It knows no application and
  holds no language-model code. PMO's tools are declared by the bridge `nasq_pmo_ai`
  (rank 5, `auto_install`), not by `nasq_pmo`, which does not depend on `nasq_ai`. The AI service and the Nuxt executor live
  outside Odoo (`docs/superpowers/specs/2026-10-15-nasq-ai-design.md`).
- `odoo-addons/nasq_directory` (shared service, rank 3) owns `/api/v1/people`
  (the user-id picker, whose ids are `res.users` ids) and its population of
  active internal users of the current company; applications that pick people
  register their feature keys in `nasq.directory`.
- `odoo-addons/nasq_pmo` owns projects, tasks, timelines, project settings,
  attachments, dependencies, archive/restore, its task and digest notification
  kinds, producers and `/api/v1/notification-digests`, and the eight `pmo.*`
  capabilities, their groups and the `pmo_manager` role. It does not depend on
  the meeting engine.
- `odoo-addons/nasq_hr` owns the HR directory, departments, documents, HR
  serializers/controllers, `/api/v1/hr/*` (employee ids are
  `hr.employee` ids), and the eight `hr.*` capabilities, their groups and the
  `hr_manager` role.
- `odoo-addons/cyan_meeting_minutes` provides the preserved LGPL meeting engine.
- `odoo-addons/nasq_meetings` (application, rank 4) extends it: the meeting,
  series, minutes and recommendation routes (`/api/v1/meetings`,
  `/api/v1/meeting-series`), their serializers, the seven meeting notification
  kinds, `meetings.enabled`, the three `meetings.*` capabilities, their groups
  and the meeting record rules. It knows no other application: links to other
  records go through the `nasq.meeting.links` hooks, which answer "no project,
  no linked task" by default.
- `odoo-addons/nasq_meetings_pmo` (bridge, rank 5, `auto_install`) is installed
  whenever `nasq_meetings` and `nasq_pmo` both are. It owns the `project_id`
  columns of meetings, series and recommendations, the task origin columns and
  their unique index, recommendation-to-task conversion and its route, and the
  project/task implementation of `nasq.meeting.links`.
- `odoo-addons/nasq_tasks` (application, rank 4) owns personal tasks (a `project.task` without a
  project, with `nasq_parent_id` for sub-tasks), `/api/v1/my-tasks` (the unified list, CRUD,
  transitions, comments, attachments), `tasks.enabled`, the three `tasks.*` capabilities, their
  groups, the global personal-task record rule and the `tasks.assigned` notification kind. It
  knows no other application: project rows and conversion go through the `nasq.task.links` hooks,
  which answer "none" by default.
- `odoo-addons/nasq_tasks_pmo` (bridge, rank 5, `auto_install`) is installed whenever `nasq_tasks`
  and `nasq_pmo` both are. It lets PMO create and read personal tasks, holds every write of a
  personal task (also through PMO's own routes) to the personal fields, adds the project rows of
  the list, and owns the convert route (`/api/v1/my-tasks/<id>/convert`, `convert-targets`).
- `odoo-addons/base_tier_validation` (shared service, rank 3) is the vendored OCA tier-validation
  engine (AGPL-3) used by `nasq_operations`.
- `odoo-addons/nasq_operations` (application, rank 4) owns versioned process definitions and
  permission-checked approval requests, `/api/v1/operations`, and the five `operations.*`
  capabilities and their groups.
- `odoo-addons/nasq_operations_pmo` (bridge, rank 5, `auto_install`) is installed whenever
  `nasq_operations` and `nasq_pmo` both are. It executes task completion through the original
  designated-reviewer policy.
- `packages/contracts/src/common`, `src/access`, `src/pmo`, `src/hr`, `src/meetings`, `src/chat`,
  `src/tasks` and `src/operations` hold the Zod wire
  contracts; each namespace has a barrel re-exported from `src/index.ts`.
- `apps/web` holds Nuxt pages, components, composables, and per-pillar locale
  files. `/hr` is the shipped HR directory; `/people` is not the HR route.
  PMO components live in `app/components/pmo/{projects,tasks}`, personal-task
  components in `app/components/personal-tasks`, and the shared building blocks in
  `app/components/shared/{layout,data,form,feedback,commerce}`.
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
