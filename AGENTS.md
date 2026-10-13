# Nasq agent instructions (single source)

This file is the single source of repository instructions for every coding agent
(Codex and Claude). `CLAUDE.md` imports it. Rules that apply only to one layer live in
`docs/agents/odoo-rules.md` (Odoo addons, API, scratch-database checks) and
`docs/agents/web-rules.md` (Nuxt UI): read the one that matches the files you change.

واجهة العميل: [DESIGN.md](DESIGN.md) هو نقطة البداية وسياسة التصميم الوحيدة، وفيه روابط الفهرس والمرجع التقني.
هذا الملف يملك المعمارية والعقود والأمن والبيانات. [أرشيف الواجهة](docs/archive/ui/README.md) والتقارير لا يغيّران هذه القواعد.

## تعريف المنتج المعتمد — 2026-09-30

نسق منصة عربية موحّدة لتشغيل الشركات، والأساس المشترك لجميع تطبيقاتها، ببيانات
وإجراءات وصلاحيات مترابطة في نظام واحد. رؤيتها شاملة لوظائف الشركة، مثل أودو في
اتساع النطاق، بدل الاشتراك في أنظمة متعددة معزولة، بهدف خفض التكلفة الإجمالية
للاشتراكات والتكامل والتشغيل. المشاريع والمهام والموارد البشرية تطبيقات أولية
داخل المنصة، وليست تعريف المنتج الكامل أو حدّه النهائي. المرجع التفصيلي هو
[تعريف المنتج](apps/web/PRODUCT.md).

ميّز دائمًا بين هذه الرؤية والقدرات المنفّذة والمتحققة حاليًا. المجالات المؤجلة
هي حدود مرحلة تنفيذ، وليست استبعادًا دائمًا من رؤية نسق. توسيع التعريف لا يجيز
تنفيذ وحدات جديدة تلقائيًا أو الادعاء بجاهزيتها، وخفض التكلفة هدف يحتاج قياسًا.

## واجهة العميل

ابدأ من [DESIGN.md](DESIGN.md): سياسة الواجهة الوحيدة وروابط فهرس المكونات والمرجع التقني.
التنفيذ في `apps/web/app`. [الأرشيف](docs/archive/ui/README.md) والتقارير وخطط التنفيذ أدلة لسياقها، لا تعليمات واجهة نشطة.
مكوّنات الواجهة تؤخذ من Storybook (`apps/web/stories/**`، `npm -w apps/web run storybook`)؛ مكوّن مشترك بلا قصة ليس لبنة معتمدة، ولا نسخة محلية من مكوّن له قصة.
اتبع [UPDATE_POLICY.md](docs/UPDATE_POLICY.md).

Read `docs/WORKSPACE.md` for the workspace and recovery map. Read
`docs/parallel-work.md` before parallel work or changing shared files.
These are repository instructions for every coding agent, regardless of tool.
Before changing `odoo-addons/` or Odoo tests read `docs/agents/odoo-rules.md`; before
changing `apps/web` read `docs/agents/web-rules.md` and DESIGN.md.

- Verify the current branch, worktree, and dirty paths before editing. The
  canonical local development checkout is `/Users/tariq/code/nasq` on `main`.
- Develop bounded tasks in temporary `codex/<area>-<slug>` worktrees based on current
  `main`. Give each task explicit file ownership and independent dependencies,
  generated files, databases, and ports. One orchestrator owns Git integration,
  shared-file edits, runtime changes, and final checks.
- Preserve stock Odoo source. Extend `project` through `nasq_pmo` and `hr`
  through `nasq_hr`. Do not recreate either pillar.
- The HR page is `/hr`; `/api/v1/people` remains the user-id picker (owned by `nasq_directory`). Preserve
  HR documents and the `{items, total}` list envelopes.
- Presentation (pages, the one route-backed create panel `SharedCreatePanel`,
  and the three overlay exceptions: search, notification bell, unsaved draft)
  follows DESIGN.md. `/new` routes open that panel; records and edits are
  pages. Task board view is `?view=board`. Keep direct links, refresh/back,
  filters, permissions and draft protection. Do not stack business dialogs.
  Confirm destructive actions inline. Value-selection menus are controls, not
  screens.
- Read `docs/WORKSPACE.md` for the checkout map and current delivery records.
  Verify branch and dirty state live. Dated integration/recovery reports and
  older WIP describe their own checkpoints, not the current source state.
- When reviewing a diff, follow `REVIEW.md` (what to report and what is already automated).
- Never run tests on `odoo19`. Do not commit, merge, push, deploy, remove
  worktrees/branches, or discard work without authorization for that action.
- Local verification does not prove production deployment. Report fresh test
  evidence and the actual branch/runtime state.

nasq (نَسَق) is an Arabic-first unified business platform whose vision is to
be the shared foundation for all of a company's business applications, with
connected data, workflows, and permissions. Its breadth of ambition is
comparable to Odoo: replace fragmented systems and subscriptions with one
coherent platform that companies can adopt progressively, aiming to reduce
total subscription, integration, and operating cost. PMO and HR are initial
applications, not the full product definition. Sales, finance, purchasing,
inventory, and other company functions are part of the broader vision, not
claims of currently delivered functionality. See the owner-approved
[product definition](apps/web/PRODUCT.md) dated 2026-09-30. Current delivery
limits describe implementation stages, not permanent product exclusions.

Odoo 19 Community is the engine and `apps/web` (Nuxt 4) is the customer UI,
with Nasq's own identity and experience. The current
deployment templates run an independent database, Odoo instance, frontend, and
edge per customer. The **target primary model** is self-service SaaS on shared
application services, retaining a separate database and filestore per customer;
local integration and acceptance boundaries are recorded in
[WORKSPACE.md](docs/WORKSPACE.md); they do not establish release approval.
Managed dedicated remains
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

## Architecture rules (R1–R10)

Spec: [reference architecture and Git workflow](docs/superpowers/specs/2026-10-05-nasq-reference-architecture-and-git-workflow-design.md).
`tools/arch_policy.py` (runs inside `npm test`) and `tools/git_policy.py` (CI `static` step) enforce these
rules. Violations that predate them are recorded in `tools/arch_baseline.json`. That baseline only shrinks:
never add an entry or raise a count to make a check pass.

- **R1** `nasq_core` depends on `base` only and names no application model or group.
- **R2** Each application owns its capabilities, groups, roles and record rules inside its own addon.
- **R3** No application imports another application. Two applications are linked by a bridge addon
  `nasq_<a>_<b>` with `auto_install`. The same holds in `apps/web`: an application folder under
  `pages/` or `components/` does not use another application's components.
- **R4** Dependencies point down only: foundation (`nasq_core` ← `nasq_platform` ← `nasq_api`) ← shared
  services ← applications ← bridges ← `customer_<name>_*`.
- **R5** The product runs without the control plane. Nothing in `odoo-addons` or `apps/web/app` imports
  from `apps/control-plane`; no new file references the control plane.
- **R6** No condition on a customer name or customer type. Differences come from `commercial_mode`,
  entitlements and `customer_<name>_*` addons.
- **R7** No new `sudo()` outside the documented cases.
- **R8** Every feature works in `saas` and `non_saas`, or is explicitly commercial and hidden in `non_saas`.
- **R9** Customise Odoo through its public extension points only: no edits to Odoo source, no new direct
  SQL on Odoo tables, no new override of a private access method on an Odoo model without a documented
  reason and a test, no copied Odoo methods.
- **R10** Each application registers its `<app>.enabled` feature, sub-features, limits and counters in
  `nasq.feature.registry` with `owner` set to its addon name, and every route checks its feature. A
  shared service (rank 3) gates its routes with `requires_registered_feature`, whose keys the
  applications register in that service's registry.

A new addon is registered in `tools/arch_layers.json` with its rank (0–2 foundation, 3 shared service,
4 application, 5 bridge, 6 customer overlay) before it is merged. After removing or moving a violation,
run `python3 -B tools/arch_policy.py --write-baseline` and commit the updated baseline with the change; the
command refuses any rule whose total grows. Never delete or hand-edit `tools/arch_baseline.json`. Weakening `tools/arch_layers.json` (changing a
rank, growing `exempt` or `commercial.allowed`, removing a commercial page gate, moving a web folder to
another application) needs the owner's approval, recorded by the owner as an
`Architecture-approved-by:` trailer on the commit that changes it; agents never add that trailer.
`--base` detects all of these.

### Git workflow

- `main` is the only long-lived branch and is always releasable. Task branches are
  `codex/<area>-<slug>`; throwaway experiments are `spike/<slug>` and are never merged.
  `<area>` is one of `core platform api pmo hr chat meetings web cp deploy tools docs ci`; the
  application areas (`pmo hr chat meetings`) are derived from the rank-4 addons in `tools/arch_layers.json`,
  so a new application's id becomes a valid area when it is registered there.
- Commit subjects are `type(scope): imperative subject`, at most 72 characters, with `type` in
  `feat fix refactor perf test docs ci build chore` and `scope` from the `<area>` list. One logical change
  per commit. No `wip` commit reaches `main`. A schema change carries its version bump and migration
  directory in the same commit.
- Merging is the orchestrator's job and needs the owner's authorization for that integration. Before
  merging: merge current `main` into the task branch (never rebase a branch another worker owns); the
  focused checks and `npm test` pass; `python3 -B tools/git_policy.py --base main` and
  `python3 -B tools/arch_policy.py --base main` pass (this local run is the binding gate; CI repeats it
  on push); addon or contract changes are reviewed by the `odoo-reviewer` agent; the working tree is
  clean. Then `git merge --no-ff`. Removing the merged branch and its worktree also needs the owner's
  authorization, and happens only after the content is preserved and no process uses it; unmerged work
  is tagged `archive/<name>` before its branch is removed.
- Only `main` and tags are pushed, each push with the owner's explicit authorization. Task branches stay
  local unless the owner asks for a pull request. `release/19.0.X.Y.Z` tags on `main` are the releases;
  there is no per-customer branch.


## Preserve approved work on every merge — 2026-09-08

The user's instruction «كومت ودمج» means: commit the requested work and
integrate it into the latest local `main`, preserving previously approved
behavior and adding the requested changes. It does not authorize undoing an
earlier decision, merging unrelated worktrees, or deleting recovery material.

Before every integration, including from an older worktree:

1. Read this policy from the canonical `/Users/tariq/code/nasq/AGENTS.md` and
   the latest committed `main`, not only the incoming worktree's older copy.
   Inspect and preserve dirty changes in both checkouts. Record the current
   `main` commit and incoming commit as the integration baseline.
2. Prepare the combined result in an isolated integration worktree based on
   that current `main`. A branch that started earlier has no priority over
   later approved work. Do not replace whole files from the incoming tree,
   use blanket `ours`/`theirs` conflict resolution, reset `main` to that tree,
   or treat an ancestor commit's presence as proof its behavior survives.
3. Review the candidate diff against the recorded current `main`, including
   deletions, shared components, design decisions, navigation, permissions,
   contracts and regression tests affected by the incoming work. Reconcile
   changes so both compatible sets of approved behavior remain. Resolve
   accidental regressions without asking the user to reapprove old decisions.
4. Run applicable checks on the combined result. Retain the regression
   requirements from the recorded `main`; an incoming branch must not make
   its own regression pass by silently removing or weakening those checks.
   A failing check requires diagnosis: distinguish a reproduced baseline
   failure from a new regression and report the actual result. No new
   regression may be accepted as a completed merge.
5. If the new request genuinely conflicts with a prior approved behavior,
   preserve that behavior and ask for the specific decision needed. General
   permission to commit and merge does not authorize that reversal. Explicit
   user approval to replace the old behavior permits the corresponding code
   and regression-test update.
6. Before updating `main`, verify it still points to the recorded baseline.
   If another task advanced it, rebuild and verify the candidate against the
   new tip. Promote only the verified candidate with `git merge --no-ff` (see Git workflow), then
   verify the resulting commit and working-tree state. Preserve other active
   worktrees; cleanup still needs separate authorization.

These are mandatory agent workflow instructions. They are not a Git hook or
server-enforced branch protection; do not claim automated merge protection
exists unless it has actually been installed and verified.

## Implementation agent routing — 2026-09-07 (scoped 2026-09-09)

This rule applies to Codex only. When the coordinator runs inside Codex, all
implementation agents must use GPT-5.6 Luna with high reasoning effort
(`luna-high`); read-only review agents may use Astra. Do not substitute another
implementation model there without a new user instruction.

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
- API routes use `type='json2'`, `auth='user'`, explicit methods, and the
  shared `api_handler`. Return serializer-whitelisted shapes and structured
  errors with a real HTTP status: 403 `forbidden`, 404 `not_found`, and 422
  `invalid` where applicable. Browser traffic uses the session cookie, not a
  bearer token.
- Keep `/api/v1/people?q=` and its user-id `PersonRef` contract unchanged.
  HR employee ids and user ids are distinct resources and must not be merged.
- `nasq_hr` has no `sudo()` path. In PMO, only the documented manager-write,
  policy/config, display-lookup, integer-count, completion-status and notification
  cron/candidate cases use `sudo()` after the caller's authorization check;
  `nasq_notify` uses it only for bell delivery and recipient-owned bell reads.
  `nasq_meetings` uses it only for its server-controlled minutes, snapshot,
  version and event records, the company-wide organizer-overlap check, the
  meeting-manager group lookup and the recipient-owned bell candidates;
  `nasq_meetings_pmo` only for the id-only lookup of converted tasks. Do not add
  another case without documenting it and fixing ACLs/rules where possible.
- The current delivery scope has no time logging or payroll product surface.
  These are stage constraints, not permanent exclusions from the product
  vision; adding them requires a separately scoped implementation request. Do not add
  `hr_timesheet`, timesheet fields/endpoints, payroll, bank, or compensation
  data to the customer UI.
- Task detail routes are `/tasks/{id}` and `/projects/{id}/tasks/{taskId}`.
  Presentation follows DESIGN.md. Preserve URL query filters when returning;
  do not promise scroll restoration without evidence.

## Safe worktree workflow

Use one temporary worktree per bounded task, named `codex/<area>-<slug>`. Worktrees
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

## Authorization model


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

## Check commands

The Odoo scratch-database command block and the CI notes are in `docs/agents/odoo-rules.md`.
Web checks and general commands:

CI is Woodpecker (`.woodpecker.yml`, with the image gate in
`deploy/woodpecker/image.yml`); GitHub
Actions is not used. The main pipeline has seven steps—`static`,
`control-plane`, `odoo`, `upgrade`, `restore-drill`, `image`, and `e2e-mock`—and each is
runnable locally with the same command block in that file: static checks, the
control-plane PostgreSQL contracts, explicit scratch Odoo install/upgrade
commands, the backup and restore drill, and the mock Playwright run. The
control-plane live suites run serially by design: its `test` script sets
`--no-file-parallelism --hookTimeout=60000` because they share one scratch
control database and TRUNCATE the same tables. The `image` step
needs a Docker daemon on the agent; `deploy/woodpecker/image.yml` is the separate opt-in pipeline for
agents whose engine can start a privileged dind service. The
migration policy is [`docs/migrations.md`](docs/migrations.md), and the pinned
Odoo source commit is [`deploy/odoo/ODOO_COMMIT`](deploy/odoo/ODOO_COMMIT).

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

Test layers and the isolated agentic e2e runner (`npm run e2e`) are described in
[`docs/testing.md`](docs/testing.md).

The global `~/.npmrc` may be malformed. Use `npm ci --ignore-scripts` and never
edit that file. Use `rg` and targeted file reads for code search across Odoo and Nasq addons.

New collaboration endpoints require the current company. Company-less
projects and tasks are not visible after the Phase 1 backfill; isolation is
database-per-tenant with `nasq_platform.root_company_id`. Addon versions follow
[`docs/migrations.md`](docs/migrations.md).
