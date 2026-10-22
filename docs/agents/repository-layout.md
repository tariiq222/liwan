# Repository layout and product state

Reference material moved out of `AGENTS.md`; the rules that always apply stay there.

## Product background

webvue (ويب فيو) is an Arabic-first unified business platform whose vision is to
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

- `odoo-addons/webvue_core` depends on `base` only. It owns the access service, the system capabilities, the
  built-in `employee`, `system_admin` and `vendor_support` roles, assignments, access audit, migration and identity
  protection. Applications add their capabilities to the catalog through `webvue.access.service` hooks.
- `odoo-addons/webvue_platform` owns the tenant profile singleton and `root_company_id`.
- `odoo-addons/webvue_api` owns shared `/api/v1` plumbing, common serializers,
  authentication, branding, and the shared test fixture. It does not import a
  pillar.
- `odoo-addons/webvue_notify` (shared service, rank 3) owns the notification bell:
  the generic `mail.message` columns `webvue_notification`, `webvue_notification_kind`
  and `webvue_notification_key` with its unique index, the `webvue.notify.registry`
  where applications register their notification kinds, delivery
  (`webvue.notify.service._webvue_deliver`) and `/api/v1/notifications`. It names no
  application.
- `odoo-addons/webvue_ai` (shared service, rank 3) owns the WebVue AI tool registry
  (`webvue.ai.tool.registry`, composed through `super()` by each application), the
  per-user audit log `webvue.ai.audit`, the `ai.*` features and limits, the `ai.use` capability (granted to the employee role; its ACL and own-rows rule follow that capability group, and the monthly message limit counts tenant-wide), and the two
  routes `GET /api/v1/ai/tools` and `POST /api/v1/ai/audit`. It knows no application and
  holds no language-model code. PMO's tools are declared by the bridge `webvue_pmo_ai`
  (rank 5, `auto_install`), not by `webvue_pmo`, which does not depend on `webvue_ai`. The AI service and the Nuxt executor live
  outside Odoo (`docs/superpowers/specs/2026-10-15-webvue-ai-design.md`).
- `odoo-addons/webvue_directory` (shared service, rank 3) owns `/api/v1/people`
  (the user-id picker, whose ids are `res.users` ids) and its population of
  active internal users of the current company; applications that pick people
  register their feature keys in `webvue.directory`.
- `odoo-addons/webvue_pmo` owns projects, tasks, timelines, project settings,
  attachments, dependencies, archive/restore, its task and digest notification
  kinds, producers and `/api/v1/notification-digests`, and the `pmo.*`
  capabilities, their groups and the `pmo_manager` role. It does not depend on
  the meeting engine.
- `odoo-addons/webvue_hr` owns the HR directory, departments, HR-specific
  serializers/controllers, `/api/v1/hr/*` (employee ids are
  `hr.employee` ids), and the `hr.*` capabilities, their groups and the
  `hr_manager` role.
- `odoo-addons/webvue_documents` (application, rank 4) owns the central DMS-backed
  document library and `/api/v1/documents` routes. `odoo-addons/webvue_documents_hr`
  (bridge, rank 5, `auto_install`) adds HR department contexts to that library.
- `odoo-addons/webvue_meetings` (application, rank 4) owns the meeting engine
  (`webvue.meeting.minute`, `webvue.meeting.resolution`; LGPL, vendored from Cyan,
  see `odoo-addons/webvue_meetings/PROVENANCE.md`) and the meeting,
  series, minutes and recommendation routes (`/api/v1/meetings`,
  `/api/v1/meeting-series`), their serializers, the seven meeting notification
  kinds, `meetings.enabled`, the `meetings.*` capabilities, their groups
  and the meeting record rules. It knows no other application: links to other
  records go through the `webvue.meeting.links` hooks, which answer "no project,
  no linked task" by default.
- `odoo-addons/webvue_meetings_pmo` (bridge, rank 5, `auto_install`) is installed
  whenever `webvue_meetings` and `webvue_pmo` both are. It owns the `project_id`
  columns of meetings, series and recommendations, the task origin columns and
  their unique index, recommendation-to-task conversion and its route, and the
  project/task implementation of `webvue.meeting.links`.
- `odoo-addons/webvue_access_hr` (bridge, rank 5, `auto_install`) is installed whenever `webvue_api`
  and `webvue_hr` both are. It owns the user-to-employee link: granting an account from an employee
  (`/api/v1/admin/employee-accounts`, `.../candidates`), the `department_id` user filter, the `employee`
  field of the admin user shape, the archived-employee reactivation refusal and disabling the linked
  account when an employee is archived. The foundation account routes (`/api/v1/admin/users`) know no HR.
- `odoo-addons/webvue_tasks` (application, rank 4) owns personal tasks (a `project.task` without a
  project, with `webvue_parent_id` for sub-tasks), `/api/v1/my-tasks` (the unified list, CRUD,
  transitions, comments, attachments), `tasks.enabled`, the `tasks.*` capabilities, their
  groups, the global personal-task record rule and the `tasks.assigned` notification kind. It
  knows no other application: project rows and conversion go through the `webvue.task.links` hooks,
  which answer "none" by default.
- `odoo-addons/webvue_tasks_pmo` (bridge, rank 5, `auto_install`) is installed whenever `webvue_tasks`
  and `webvue_pmo` both are. It lets PMO create and read personal tasks, holds every write of a
  personal task (also through PMO's own routes) to the personal fields, adds the project rows of
  the list, and owns the convert route (`/api/v1/my-tasks/<id>/convert`, `convert-targets`).
- `odoo-addons/base_tier_validation` (shared service, rank 3) is the vendored OCA tier-validation
  engine (AGPL-3) used by `webvue_operations`.
- `odoo-addons/webvue_operations` (application, rank 4) owns versioned process definitions and
  permission-checked approval requests, `/api/v1/operations`, and the `operations.*`
  capabilities and their groups.
- `odoo-addons/webvue_operations_pmo` (bridge, rank 5, `auto_install`) is installed whenever
  `webvue_operations` and `webvue_pmo` both are. It executes task completion through the original
  designated-reviewer policy.
- `odoo-addons/webvue_pmo_finance` (bridge, rank 5, `auto_install`) is installed whenever `webvue_pmo`
  and `webvue_finance` both are. While `finance.enabled` is on, a project's actual cost is the posted
  expense of its cost center (an analytic account linked by `webvue_project_id`) instead of manual
  PMO expense entries, and PMO keeps the planned budget. It implements the neutral
  `webvue.project.actual.source` hooks and the PMO settings extension (cost-center mode `auto` or
  `manual`), and reads analytic lines in the caller's own environment through its own ACLs and
  record rules, with no `sudo()`.
- `odoo-addons/webvue_hr_finance` (bridge, rank 5, `auto_install`) is installed whenever `webvue_hr`
  and `webvue_finance` both are. It holds the accounting mapping of a company's payroll (journal,
  accounts, entry detail) and the analytic cost center of each department, edited through
  `/api/v1/hr/payroll/finance-settings` and `/api/v1/hr/payroll/cost-centers`; it also owns the posting
  preview and posting (`/api/v1/hr/payroll/runs/<id>/posting-preview`, `.../post`), payment recording
  (`.../payment`) and the monthly end-of-service provision (`/api/v1/hr/payroll/eos-provisions`). It answers the neutral
  `webvue.hr.payroll.finance.link` hooks of `webvue_hr` and runs in the caller's own environment through
  its own ACLs and record rules, with no `sudo()`.
- `packages/contracts/src/common`, `src/access`, `src/pmo`, `src/hr`, `src/meetings`, `src/chat`,
  `src/tasks` and `src/operations` hold the Zod wire
  contracts; each namespace has a barrel re-exported from `src/index.ts`.
- `apps/web` holds Nuxt pages, components, composables, and per-pillar locale
  files. `/hr` is the shipped HR directory; `/people` is not the HR route.
  PMO components live in `app/components/pmo/{projects,tasks}`, personal-task
  components in `app/components/personal-tasks`. Presentational building blocks live in
  the `packages/ui` Nuxt layer (`@webvue/ui`, shared by every Nuxt app);
  `app/components/shared/{data,form,commerce}` keeps only those that need app data.
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
password resets and reactivation belong to `/settings/team/users` and the
`/api/v1/admin/users` API. Archiving an employee disables linked access;
unarchiving does not reactivate the login. `/account` changes one's own password.
WebVue branding settings edit only `primary_color`. Institution name and logo
are managed in Odoo by `base.group_system`, with company, related partner and
attachment guards against indirect identity changes.

The Odoo upstream checkout is `/Users/tariq/code/odoo`, branch `19.0`. Its
source, configuration, and Git state are read-only for this project; source
inspection and read-only Git audits are allowed. Authorized Odoo commands may
create or update an explicitly isolated test/development database, but never
operate arbitrarily on a database or run tests against the dev `odoo19`
database. Always pass the selected WebVue worktree's `odoo-addons` path
explicitly; do not assume an Odoo config points at a particular WebVue checkout.
