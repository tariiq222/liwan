# liwan

**تعليمات ومراجع الواجهة: ابدأ من [DESIGN.md](DESIGN.md).** التنفيذ في `apps/web/app` باستخدام Nuxt UI.

هذه نسخة عمل؛ راجع [خريطة مساحة العمل](docs/WORKSPACE.md) قبل مقارنتها بـ`main` أو بمهمة أخرى.

**ليوان منصة عربية موحّدة لتشغيل الشركات، تكون الأساس المشترك لجميع تطبيقاتها،
وتربط بياناتها وإجراءاتها وصلاحياتها في نظام واحد.** تستهدف الرؤية الشركات بمختلف
أنشطتها؛ بدل اشتراكات متعددة في أنظمة معزولة، تبدأ الشركة بما تحتاجه وتتوسع
تدريجيًا، بهدف خفض التكلفة الإجمالية للاشتراكات والتكامل والتشغيل.

LiwanOS's product vision is a unified business platform spanning company functions,
comparable in breadth of ambition to Odoo. Projects, tasks, and HR are initial
applications, not the limit of the product. Sales, finance, purchasing,
inventory, and other business applications belong to the broader vision;
this does not claim that all of them are implemented or ready for release.
Lower total cost is a product objective, not a measured savings claim.
See [the product definition](apps/web/PRODUCT.md).

Odoo 19 Community is the business engine and Nuxt 4 is the customer UI, under
LiwanOS's own identity and experience. The primary hosting target is self-service
SaaS with shared application services and a separate database and filestore per
customer. Dedicated and customer-hosted deployments are separate options.
See [the hosting contract](docs/superpowers/specs/liwan-shared-saas-and-sovereign-deployment.md)
and [WORKSPACE.md](docs/WORKSPACE.md) for implementation and acceptance evidence;
the product vision does not establish production readiness.

Remote integration into `main` uses a protected GitHub pull request under the [integration policy](docs/agents/integration-rules.md). The required status-check policy is current-head `ci-result` only, alongside review of the actual diff, an up-to-date branch and resolved conversations. CI success does not authorize publication or merging; the owner's explicit authorization remains required. Review uses the selected available agent or a human. See the [testing guide](docs/testing.md#ci-workflow) for check scope. Release, production deployment and cleanup retain separate authorization requirements.

## Current product

The following is a partial overview of implemented surfaces, not a complete release inventory or evidence of readiness:

- Project tasks at `/tasks` and personal tasks at `/my-tasks`, including their
  separate task spaces, board/table views, timelines, comments, and updates.
- Projects at `/projects`, including project tasks, stages, milestones, status
  updates, followers, archive actions, tags, and project settings.
- Meetings at `/meetings` (including calendar, recurring series and minutes),
  conversations at `/chat`, and documents at `/documents`.
- Finance at `/finance` (sales and purchase records, payments, partners,
  accounting, bank statements, budgets, assets and reports). Individual gaps and
  verification status are tracked in the finance documentation.
- Operations at `/operations` (requests, pending approvals and monitoring), and
  the AI workspace at `/ai`.
- HR at `/hr`, including the employee directory, leave, recruitment, shifts,
  onboarding/offboarding, assets and payroll; department documents are linked to
  the separate document library. Payroll belongs to `liwan_hr`, uses dedicated
  capabilities and retains the [open payroll release gates](docs/WORKSPACE.md#الرواتب-السعودية-بوابات-الإطلاق-المفتوحة).
  HR routes live under `/api/v1/hr/*` and use employee ids. The PMO assignee
  picker at `/api/v1/people` remains a user-id resource.
- Access administration at `/settings/team/users`, roles and audit with capability
  checks. Company branding colour is for documents and reports and does not
  change the fixed UI palette; company name/logo edits require
  `settings.company.manage` through LiwanOS. `/account` opens Self-service, with
  application-owned personal services
  and password/appearance controls at `/account/settings`.
- PMO adds task attachments, recipient notifications, dependencies and a routed
  archived-task list with restore. HR document creation and edits use pages.
- Arabic is the default locale and the UI supports RTL. Navigation follows
  DESIGN.md (module rail + contextual sidebar).

Task detail routes are `/tasks/{id}` and `/projects/{id}/tasks/{taskId}`.
Presentation follows DESIGN.md. Returning from a nested task preserves query
filters; scroll restoration is not part of the contract.

[WORKSPACE.md](docs/WORKSPACE.md) is the workspace map. Dated reports are
historical evidence, not UI policy.

## Local development

The canonical checkout is `/Users/tariq/code/webvue`. A
temporary worktree may be used for a bounded task. Always point the Odoo
addons path at that chosen LiwanOS worktree; `/Users/tariq/code/odoo` is the
read-only Odoo 19 upstream source checkout. Authorized commands may use an
explicitly isolated scratch database; do not operate on arbitrary databases.

Run the two services with isolated values for each worktree:

```sh
# Odoo, from the read-only upstream checkout
cd /Users/tariq/code/odoo
# Use your scratch-only config and unique allocated database/ports.
# Keep data_dir and logfile outside the read-only upstream checkout.
.venv/bin/python odoo-bin -c /absolute/path/to/scratch-only.conf \
  --addons-path=/Users/tariq/code/odoo/addons,/path/to/liwan-worktree/odoo-addons,$(python3 -B /path/to/liwan-worktree/tools/oca_addons.py path) \
  -d liwan_scratch_example --http-port=8171

# Nuxt loads the selected worktree's allocated .env.worktree profile.
# Match the Odoo database/port above to that profile's actual values first.
cd /path/to/liwan-worktree
npm run dev
```

Use a unique Odoo database and HTTP port, and a matching Nuxt port, for every
active worktree; the Odoo values above are placeholders and must match `.env.worktree`.
Worktree dev rejects CLI overrides; its saved profile owns the ports and endpoints. Ports `3100` and `3103` are reserved for vendor administration and its live-proof build; follow [parallel-work.md](docs/parallel-work.md) and check current claims before choosing others. Install dependencies independently in each worktree with
`npm ci --ignore-scripts`; use the local cache when working offline. Do not
share `node_modules` or `.nuxt` through symlinks. Never run tests against the
production-style `odoo19` database.

After installing dependencies or moving a checkout, regenerate each Nuxt
app's local files before running the root tests or type checks:

```sh
npm -w apps/web run postinstall
npm -w apps/vendor-admin run postinstall
```

The ordinary local development topology is Odoo `:8069` and Nuxt `:3000`.
Use Node 24.15.0 from `.nvmrc`. Main's private apps/web/.env selects the explicitly
configured `liwan_dev` database; it is a development target, never a test target.
In a task worktree, `npm run dev` loads that worktree's git-ignored `.env.worktree`
for its allocated Nuxt/Odoo ports, database and WebSocket endpoint. Install local
dependencies and run Nuxt postinstall in each worktree first; a shared parent
installation does not provide an independent worktree environment.

The deployment templates are in [`deploy/`](deploy/). They describe a
customer deployment and are not proof that a deployment has been performed.
No production deployment or DNS cutover is implied by this repository.

## Layout and ownership

- `apps/web` contains the Nuxt UI, per-pillar composables/components, and
  locale files.
- `packages/contracts` contains the Zod wire contracts. Shared contracts live
  under `src/common`; PMO contracts under `src/pmo`; HR contracts under
  `src/hr`.
- `odoo-addons/liwan_core` depends on `base` only and owns the access service,
  the system capabilities and branding defaults; each application owns its own
  capabilities, groups and roles;
  `liwan_api` owns shared API plumbing; the shared services `liwan_notify` (the
  notification bell) and `liwan_directory` (the user-id people picker) know no
  application; `liwan_tasks` owns personal tasks without a project, while
  `liwan_pmo` owns projects and project-linked task workflows, with
  `liwan_tasks_pmo` bridging personal-task creation when both are installed;
  `liwan_meetings` owns meetings, series and minutes, and `liwan_meetings_pmo` links them to projects and tasks;
  `liwan_finance`, `liwan_documents`, `liwan_operations` and `liwan_hr` own
  their corresponding application APIs and capabilities; `liwan_documents_hr`
  connects the document library to HR department and own-employee contexts.
- `deploy` contains per-customer provisioning and reverse-proxy templates.

The detailed one-writer ownership and isolation workflow is in
[`docs/parallel-work.md`](docs/parallel-work.md). The Git remote is
`origin` (`https://github.com/tariiq222/webvue.git`), tracked by `main`. Pushes
need explicit authorization; do not imply that a push occurred.

## Documentation

Specifications and the open plans are under `docs/superpowers/{specs,plans}`.
The shipped phase documents describe implementation intent and scope; current
runtime and verification status must be confirmed from the active checkout and
fresh checks before making a release claim.
