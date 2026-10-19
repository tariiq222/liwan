# webvue

**تعليمات ومراجع الواجهة: ابدأ من [DESIGN.md](DESIGN.md).** التنفيذ في `apps/web/app` باستخدام Nuxt UI.

هذه نسخة عمل؛ راجع [خريطة مساحة العمل](docs/WORKSPACE.md) قبل مقارنتها بـ`main` أو بمهمة أخرى.

**ويب فيو منصة عربية موحّدة لتشغيل الشركات، تكون الأساس المشترك لجميع تطبيقاتها،
وتربط بياناتها وإجراءاتها وصلاحياتها في نظام واحد.** تستهدف الرؤية الشركات بمختلف
أنشطتها؛ بدل اشتراكات متعددة في أنظمة معزولة، تبدأ الشركة بما تحتاجه وتتوسع
تدريجيًا، بهدف خفض التكلفة الإجمالية للاشتراكات والتكامل والتشغيل.

WebVue's product vision is a unified business platform spanning company functions,
comparable in breadth of ambition to Odoo. Projects, tasks, and HR are initial
applications, not the limit of the product. Sales, finance, purchasing,
inventory, and other business applications belong to the broader vision;
this does not claim that all of them are implemented or ready for release.
Lower total cost is a product objective, not a measured savings claim.
See [the product definition](apps/web/PRODUCT.md).

Odoo 19 Community is the business engine and Nuxt 4 is the customer UI, under
WebVue's own identity and experience. The primary hosting target is self-service
SaaS with shared application services and a separate database and filestore per
customer. Dedicated and customer-hosted deployments are separate options.
See [the hosting contract](docs/superpowers/specs/webvue-shared-saas-and-sovereign-deployment.md)
and [WORKSPACE.md](docs/WORKSPACE.md) for implementation and acceptance evidence;
the product vision does not establish production readiness.

Integration into `main` is a GitHub pull request; the `ci` workflow (`.github/workflows/ci.yml`) is the only gate
and merges the PR when it passes (until the first server deployment). See the
[testing guide](docs/testing.md#ci-workflow). Agents do not push without the owner's authorization.

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
- Access administration at `/settings/team/users`, roles and audit with capability
  checks. Branding settings edit the primary colour; Odoo system administrators
  manage institution name/logo. `/account` handles self password changes.
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
addons path at that chosen WebVue worktree; `/Users/tariq/code/odoo` is the
read-only Odoo 19 upstream source checkout. Authorized commands may use an
explicitly isolated scratch database; do not operate on arbitrary databases.

Run the two services with isolated values for each worktree:

```sh
# Odoo, from the read-only upstream checkout
cd /Users/tariq/code/odoo
.venv/bin/python odoo-bin -c /Users/tariq/code/odoo/odoo.conf \
  --addons-path=/Users/tariq/code/odoo/addons,/path/to/webvue-worktree/odoo-addons,$(python3 -B /path/to/webvue-worktree/tools/oca_addons.py path) \
  -d webvue_scratch --http-port=8169

# Nuxt, from the selected WebVue worktree
cd /path/to/webvue-worktree
NUXT_ODOO_URL=http://127.0.0.1:8169 \
NUXT_ODOO_DB=webvue_scratch \
NUXT_PUBLIC_WS_URL=ws://localhost:8169/websocket \
npm -w apps/web run dev -- --port 3100
```

Use a unique Odoo database and HTTP port, and a matching Nuxt port, for every
active worktree. Install dependencies independently in each worktree with
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

The deployment templates are in [`deploy/`](deploy/). They describe a
customer deployment and are not proof that a deployment has been performed.
No production deployment or DNS cutover is implied by this repository.

## Layout and ownership

- `apps/web` contains the Nuxt UI, per-pillar composables/components, and
  locale files.
- `packages/contracts` contains the Zod wire contracts. Shared contracts live
  under `src/common`; PMO contracts under `src/pmo`; HR contracts under
  `src/hr`.
- `odoo-addons/webvue_core` depends on `base` only and owns the access service,
  the system capabilities and branding defaults; each application owns its own
  capabilities, groups and roles;
  `webvue_api` owns shared API plumbing; the shared services `webvue_notify` (the
  notification bell) and `webvue_directory` (the user-id people picker) know no
  application; `webvue_pmo` owns projects/tasks; `webvue_meetings` owns meetings,
  series and minutes, and the bridge `webvue_meetings_pmo` links them to projects
  and tasks; `webvue_hr` owns HR routes, documents, and employee directory
  behavior.
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
