# WebVue agent instructions (single source)

This file is the single source of repository instructions for every coding agent
(Codex and Claude). `CLAUDE.md` imports it. Rules that apply only to one layer live in
`docs/agents/odoo-rules.md` (Odoo addons, API, scratch-database checks) and
`docs/agents/web-rules.md` (Nuxt UI): read the one that matches the files you change.

واجهة العميل: [DESIGN.md](DESIGN.md) هو نقطة البداية وسياسة التصميم الوحيدة، وفيه روابط الفهرس والمرجع التقني.
هذا الملف يملك المعمارية والعقود والأمن والبيانات. [أرشيف الواجهة](docs/archive/ui/README.md) والتقارير لا يغيّران هذه القواعد.

## Instruction authority and task entry

`CLAUDE.md` is an import adapter, not a second policy. Use one owning reference per subject:

| Subject | Owning reference |
| --- | --- |
| Architecture, product contracts, security and authorization boundaries | This file |
| Presentation and shared design | [DESIGN.md](DESIGN.md) |
| Layer-specific implementation | [Odoo/API rules](docs/agents/odoo-rules.md), [web rules](docs/agents/web-rules.md) |
| File ownership, worktree isolation and shared resources | [Parallel work](docs/parallel-work.md) |
| Integration, publication and protected delivery | [Integration rules](docs/agents/integration-rules.md) |
| Review findings and reviewer independence | [Review guide](REVIEW.md) |
| Where planner-skill output lives (specs, tickets, triage) | [Issue tracker](docs/agents/issue-tracker.md) |
| Verification commands and evidence scope | [Testing guide](docs/testing.md) |
| Approval before updating external source versions | [Update policy](docs/UPDATE_POLICY.md) |
| Checkout map and evidence entry points, not live runtime state | [Workspace map](docs/WORKSPACE.md) |

Read the current task and the references for its scope before editing. A task-specific owner decision must state its scope; do not turn a bounded exception into a permanent policy change. If active references conflict or the decision source is unclear, report the exact conflict before changing the affected behavior. Plans, archived documents, old worktree instructions and reports do not silently supersede active policy.

Keep three claims separate: an approved requirement, implementation present in a named branch/SHA, and behavior verified by a recorded check. Neither a document update nor green checks authorize publication, production deployment or cleanup. Change the owning reference and update its summaries together; do not copy a policy into another instruction file.

## تعريف المنتج المعتمد — 2026-09-30

ويب فيو منصة عربية موحّدة لتشغيل الشركات، والأساس المشترك لجميع تطبيقاتها، ببيانات
وإجراءات وصلاحيات مترابطة في نظام واحد. رؤيتها شاملة لوظائف الشركة، مثل أودو في
اتساع النطاق، بدل الاشتراك في أنظمة متعددة معزولة، بهدف خفض التكلفة الإجمالية
للاشتراكات والتكامل والتشغيل. المشاريع والمهام والموارد البشرية تطبيقات أولية
داخل المنصة، وليست تعريف المنتج الكامل أو حدّه النهائي. المرجع التفصيلي هو
[تعريف المنتج](apps/web/PRODUCT.md).

ميّز دائمًا بين هذه الرؤية والقدرات المنفّذة والمتحققة حاليًا. المجالات المؤجلة
هي حدود مرحلة تنفيذ، وليست استبعادًا دائمًا من رؤية ويب فيو. توسيع التعريف لا يجيز
تنفيذ وحدات جديدة تلقائيًا أو الادعاء بجاهزيتها، وخفض التكلفة هدف يحتاج قياسًا.

## واجهة العميل

ابدأ من [DESIGN.md](DESIGN.md): سياسة الواجهة الوحيدة وروابط فهرس المكونات والمرجع التقني.
التنفيذ في `apps/web/app`. [الأرشيف](docs/archive/ui/README.md) والتقارير وخطط التنفيذ أدلة لسياقها، لا تعليمات واجهة نشطة.
مكوّنات الواجهة تؤخذ من Storybook (`apps/web/stories/**`، `npm -w apps/web run storybook`)؛ مكوّن مشترك بلا قصة ليس لبنة معتمدة، ولا نسخة محلية من مكوّن له قصة.
اتبع [UPDATE_POLICY.md](docs/UPDATE_POLICY.md).

Read `docs/parallel-work.md` before parallel work or changing shared files.

- Verify the current branch, worktree, and dirty paths before editing. The
  canonical local development checkout is `/Users/tariq/code/webvue` on `main`.
- Develop bounded tasks in temporary worktrees (any normal branch name) based on current
  `main`. Give each task explicit file ownership and independent dependencies,
  generated files, databases, and ports. One orchestrator owns Git integration,
  shared-file edits, runtime changes, and final checks.
- Preserve stock Odoo source. Extend `project` through `webvue_pmo` and `hr`
  through `webvue_hr`. Do not recreate either pillar.
- The HR page is `/hr`; `/api/v1/people` remains the user-id picker (owned by `webvue_directory`). Preserve
  HR documents and the `{items, total}` list envelopes.
- Presentation (pages, the one route-backed create panel `SharedCreatePanel`,
  and the four overlay exceptions: search, notification bell, unsaved draft, the assistant sheet)
  follows DESIGN.md. `/new` routes open that panel; records and edits are
  pages. Task board view is `?view=board`. Keep direct links, refresh/back,
  filters, permissions and draft protection. Do not stack business dialogs.
  Confirm destructive actions inline. Value-selection menus are controls, not
  screens.
- Read `docs/WORKSPACE.md` for the checkout map and links to acceptance evidence.
  Verify branch and dirty state live. Dated integration/recovery reports and
  older WIP describe their own checkpoints, not the current source state.
- When reviewing a diff, follow `REVIEW.md` (what to report and what is already automated).
- Never run tests on `odoo19`. Do not commit, merge, push, deploy, remove
  worktrees/branches, or discard work without authorization for that action.
- Local verification does not prove production deployment. Report fresh test
  evidence and the actual branch/runtime state.

Odoo 19 Community is the engine and `apps/web` (Nuxt 4) is the customer UI,
with WebVue's own identity and experience. The current
deployment templates run an independent database, Odoo instance, frontend, and
edge per customer. The **target primary model** is self-service SaaS on shared
application services, retaining a separate database and filestore per customer;
local integration and acceptance boundaries are recorded in
[WORKSPACE.md](docs/WORKSPACE.md); they do not establish release approval.
Managed dedicated remains
separate from customer-hosted non-SaaS, which must not require SaaS billing or a
vendor connection at runtime. WebVue has a tenant abstraction through
`webvue_platform`, but tenant isolation remains database-per-tenant. There is no
shared-database tenant layer. Customer-specific behavior belongs in a
`customer_<name>_*` overlay, never in the core pillars. See the new
[hosting and acceptance contract](docs/superpowers/specs/webvue-shared-saas-and-sovereign-deployment.md)
for the target and its pending gates; the older
`docs/superpowers/specs/2026-09-03-webvue-platform-design.md` describes its own
historical scope. Government packaging from one release line is preferred for
assessment; a permanent fork is not approved by default.

## Clean pre-release codebase: no accumulation — 2026-10-15

WebVue has not been released and has no live tenants, so there is nothing to stay
backward compatible with. The product must ship sound and clean: clean code, correct data
structures, and a file architecture where every file has one owner and one reason to exist.
Accumulation in code or in the database schema is a defect, not technical debt to schedule.

- **Replace, do not layer.** When behavior changes, change the code in place. No parallel
  `v2`/`_new`/`_old` copies, no dead branches kept "just in case", no compatibility wrappers,
  no feature flags whose only purpose is to keep an old path alive, no commented-out code.
  Removed code lives in Git history, never in `legacy/`, `.bak` or archived copies inside the
  source tree. `docs/archive/` is never a code store or an automatic destination for completed documents; document retention follows [WORKSPACE.md](docs/WORKSPACE.md#الأرشفة-والاسترداد).
- **One schema, no remnants.** A model change edits the field or table directly. No unused
  or renamed-and-kept columns, no "temporary" fields, no compatibility tables, no duplicate
  store of the same fact. Migrations follow [docs/migrations.md](docs/migrations.md) only to
  carry existing development data forward to the clean schema; they never preserve the old
  structure next to the new one, and the simplest correct schema wins over a migration-friendly
  one.
- **Clean code.** Small functions with one purpose, names that state what a thing is, no magic
  values, no duplication (extract one helper in the owning layer per R4), explicit errors (no
  silent `except`/`catch`), no unused parameters, imports or locale keys, and the existing
  conventions of the layer (`docs/agents/odoo-rules.md`, `docs/agents/web-rules.md`).
- **Sound data structures.** One source of truth per fact; derived values are computed, not
  stored twice; Odoo field types, serializers and the zod contracts in `packages/contracts`
  match exactly; relations and selections instead of free-text or JSON blobs when the data has
  a shape; list envelopes stay `{items, total}`.
- **Files where they belong.** Every file sits in the folder its application and layer own
  (R2–R4, [repository layout](docs/agents/repository-layout.md), the `apps/web` folder
  conventions in DESIGN.md). One module per responsibility; no `misc`/`utils2`/`helpers_new`
  dumping grounds. When a file's last use goes, the file goes, together with its tests,
  stories, fixtures and locale keys.
- **Suppressions only shrink.** Like `tools/arch_baseline.json`, the set of test skips,
  `# noqa`, `eslint-disable`, `@ts-ignore`/`@ts-expect-error` and lint ignores never grows
  without a reason on the same line, and each is removed with its cause.
- **Touch it, clean it.** A task that meets accumulation inside its own file ownership removes
  it in the same task. Accumulation outside that ownership is reported in the task's result so
  the orchestrator schedules it; it is never extended. Cleaning is not a licence to widen scope,
  reverse an approved decision, or merge without the authorizations above.
- **Done means clean.** Work is not complete while it leaves a parallel path, an unused
  artifact, or a schema remnant behind. Reviewers (`REVIEW.md`, `odoo-reviewer`) report
  accumulation as a blocking finding, in the same class as a failing test.

## User-facing decisions and configurable customer policies — 2026-10-22

- Before changing user-visible behavior with materially different valid outcomes,
  present the owner with the options, user impact and a recommended default.
- Legitimate policies that vary across customers must have an explicit setting
  in the owning WebVue settings surface. State its scope (customer, company,
  branch or user), default, who may change it and how it affects existing data.
  Reuse the owning configuration model; do not hardcode customer-specific behavior.
- Configurable authorization policies must enforce the selected policy on the
  server for reads, writes, exports and attachments, with tests for each supported
  mode. Membership alone never grants a sensitive capability. No setting may
  bypass tenant isolation or expose data without an explicit authorized grant.
- Correctness, broken links, session isolation and error handling are defects to
  fix, not customer options to preserve faulty behavior. Deployment secrets and
  infrastructure policies remain in their owning operator/vendor configuration.

## Architecture rules (R1–R10)

Spec: [reference architecture and Git workflow](docs/superpowers/specs/2026-10-05-webvue-reference-architecture-and-git-workflow-design.md).
`tools/arch_policy.py` (runs inside `npm test`) and `tools/git_policy.py` (CI `static` step) enforce these
rules. Violations that predate them are recorded in `tools/arch_baseline.json`. That baseline only shrinks:
never add an entry or raise a count to make a check pass.

- **R1** `webvue_core` depends on `base` only and names no application model or group.
- **R2** Each application owns its capabilities, groups, roles and record rules inside its own addon.
- **R3** No application imports another application. Two applications are linked by a bridge addon
  `webvue_<a>_<b>` with `auto_install`. The same holds in `apps/web`: an application folder under
  `pages/` or `components/` does not use another application's components.
- **R4** Dependencies point down only: foundation (`webvue_core` ← `webvue_platform` ← `webvue_api`) ← shared
  services ← applications ← bridges ← `customer_<name>_*`.
- **R5** The product runs without the control plane. Nothing in `odoo-addons` or `apps/web/app` imports
  from `apps/control-plane`; no new file references the control plane. `apps/vendor-admin` is the only vendor
  client of the control plane; the customer-commercial paths (`/subscription`, `apps/web/server/api/commercial`,
  `apps/web/server/utils/customer-commercial.ts`) remain the sole customer-side exception.
- **R6** No condition on a customer name or customer type. Differences come from `commercial_mode`,
  entitlements and `customer_<name>_*` addons.
- **R7** No new `sudo()` outside the documented cases.
- **R8** Every feature works in `saas` and `non_saas`, or is explicitly commercial and hidden in `non_saas`.
- **R9** Customise Odoo through its public extension points only: no edits to Odoo source, no new direct
  SQL on Odoo tables, no new override of a private access method on an Odoo model without a documented
  reason and a test, no copied Odoo methods.
- **R10** Each application registers its `<app>.enabled` feature, sub-features, limits and counters in
  `webvue.feature.registry` with `owner` set to its addon name, and every route checks its feature. A
  shared service (rank 3) gates its routes with `requires_registered_feature`, whose keys the
  applications register in that service's registry.

- **UI1** The shared UI layers `packages/ui` and `packages/commercial-ui` import no
  application, addon, app alias, `@webvue/contracts` or control-plane code.
- **VA1** `apps/vendor-admin` imports only itself, the shared UI layers and `@webvue/commercial-contracts`, calls no
  Odoo route, and `apps/web` never imports it. UI1 and VA1 are hard rules, never baselined.

A new addon is registered in `tools/arch_layers.json` with its rank (0–2 foundation, 3 shared service,
4 application, 5 bridge, 6 customer overlay) before it is merged. After removing or moving a violation,
run `python3 -B tools/arch_policy.py --write-baseline` and commit the updated baseline with the change; the
command refuses any rule whose total grows. Never delete or hand-edit `tools/arch_baseline.json`. Weakening `tools/arch_layers.json` (changing a
rank, growing `exempt` or `commercial.allowed`, removing a commercial page gate, moving a web folder to
another application) needs the owner's approval, recorded by the owner as an
`Architecture-approved-by:` trailer on the commit that changes it; agents never add that trailer.
`--base` detects all of these.

### Git workflow

- `main` is the only long-lived branch and is always releasable. Any normal task branch
  name is accepted (a descriptive `<area>-<slug>` is recommended, not required);
  throwaway experiments are `spike/<slug>` and are never merged.
  `<area>` is one of `core platform api pmo meetings hr chat tasks operations web cp deploy tools docs ci`; the
  application areas (`pmo meetings hr chat tasks operations`) are derived from the rank-4 addons in `tools/arch_layers.json`,
  so a new application's id becomes a valid area when it is registered there.
- Commit subjects are `type(scope): imperative subject`, at most 72 characters, with `type` in
  `feat fix refactor perf test docs ci build chore` and `scope` from the `<area>` list. One logical change
  per commit. No `wip` commit reaches `main`. A schema change carries its version bump and migration
  directory in the same commit.
- `main` is protected on GitHub with PR and current CI requirements and no admin bypass.
  Integration uses a pull request; direct pushes and protection bypasses are prohibited. The preservation procedure, authorization boundaries and merge
  checklist have one owner: [integration-rules.md](docs/agents/integration-rules.md).
  Read that current policy before integrating an older branch. The 2026-10-17
  direct-push exception is superseded by this PR workflow.
- Prepare and check the combined result against the current remote `main`, preserving
  unrelated dirty work and each worker's history. Use a task PR for an independent change;
  use one `<prefix>/tools-integrate-<slug>` candidate and one PR for a coupled batch.
  Regenerate the API artifacts there when needed. Do not submit both a batch and its
  constituent branches for separate merge.
- A PR stays **draft** while scope, local checks or prepublication inspection are incomplete.
  Marking ready requests CI and review of the actual candidate; it does not authorize
  publication or merging. The required status-check policy is current-head `ci-result`
  only. Review follows `REVIEW.md` using the selected available agent or a human.
  Publish and merge only within the owner's explicit authorization. Missing services,
  stale checks or protected scope never authorize a bypass.
- The `ci` workflow runs on PRs and pushes to `main`; selected stages must pass before
  integration. `workflow_dispatch` with `full: true` runs all twelve stages. A scoped
  green run is not evidence of a full release run. A `release/19.0.X.Y.Z` tag requires
  all twelve stages green in a full run on that exact `main` commit and the owner's
  explicit authorization to publish the release. No workflow creates tags automatically;
  a tag is not deployment authorization.
- Check actual GitHub rules before delivery. Branch protection, required reviews, required
  status checks and administrator bypass are separate settings; a protected branch alone
  does not prove CI is enforced. Report gaps instead of assuming a plan limitation.
- After a branch is merged, removing its worktree, branch and scratch database is `python3 -B tools/wt.py gc`, only with
  the owner's authorization and only after the content is preserved and no process uses it; unmerged work is
  tagged `archive/<name>` before its branch is removed.
- Only `main`, tags and authorized task branches are pushed, each push with the owner's explicit authorization.
  `release/19.0.X.Y.Z` tags on `main` are the releases; there is no per-customer branch.


## Preserve approved work on every merge — 2026-09-08

The user's instruction «كومت ودمج» means: commit the requested work and
prepare its integration against the latest remote `main`, preserving previously
approved behavior and adding the requested changes. Follow the publication and
merge authorization boundaries in `docs/agents/integration-rules.md`. It does not authorize undoing an
earlier decision, merging unrelated worktrees, or deleting recovery material.

Before every integration, including from an older worktree, follow the six steps in
`docs/agents/integration-rules.md`. They are mandatory.

These are mandatory agent workflow instructions. They are not a Git hook or
server-enforced branch protection; do not claim automated merge protection
exists unless it has actually been installed and verified.

## Agent execution

Use the model selected for the current session. No exclusive model is required
for the coordinator, workers or reviewers. Choose available native models and
supported effort appropriate to the task; a model-name mismatch does not block
work or require permission. Delegate only when justified by independently owned
work, with explicit scopes and isolated mutable resources. Model selection does
not authorize commit, push, merge, deployment or cleanup. Never retry exhausted
quota or use paid API credentials as a hidden fallback.

## Repository layout and product state

The addon-by-addon layout, the unified checkout state and the English product background are in
`docs/agents/repository-layout.md`. Read it before changing addon boundaries, ownership or
cross-addon links.

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
- `webvue_hr`, `webvue_tasks`, `webvue_operations` and their bridges have no `sudo()` path. In PMO, only the documented manager-write,
  charter-approval (approval fields only, through `_webvue_write_sudo` with its own whitelist, after the manager or sponsor check), policy/config, display-lookup, integer-count, completion-status and notification
  cron/candidate cases use `sudo()` after the caller's authorization check;
  `webvue_notify` uses it only for bell delivery and recipient-owned bell reads.
  `webvue_meetings` uses it only for its server-controlled minutes, snapshot,
  version and event records, the company-wide organizer-overlap check, the
  meeting-manager group lookup, the existence check of the minutes linked to a
  calendar event (read only, access is rechecked by the caller) and the
  recipient-owned bell candidates;
  `webvue_meetings_pmo` only for the id-only lookup of converted tasks;
  `webvue_finance` only in `models/setup_service.py`, for loading the Saudi chart of accounts and
  writing the fiscal settings of the current company, after the
  `finance.setup.manage` check, with a field whitelist, and in `models/zatca_service.py`, for the
  ZATCA onboarding of a sales journal and the submission of one invoice through stock `l10n_sa_edi`,
  after the `finance.zatca.manage` / `finance.zatca.submit` capability and current-company checks,
  in the sandbox api mode only (ZATCA onboarding is sandbox-only in this phase, so production invoicing for real
  tenants is a release blocker until the preprod/prod policy is approved).
  `webvue_api` uses it in `controllers/common.py`, for the single company-ownership
  read in `get_record`, before any access check, so another company's record answers the
  same 404 not-found as a missing one instead of a 403 that leaks its existence; in
  `controllers/branding.py`, for the one tenant-profile read behind the public
  `/api/v1/branding` route, which has no session to authorize it; in
  `controllers/auth.py` and `serializers/user.py`, for the entitlement service's
  suspension and self-service checks; and in `controllers/commercial.py`, for the
  tenant-profile mode read that answers the commercial routes. Each of those reads a
  platform service or singleton, never an application record.
  Do not add
  another case without documenting it and fixing ACLs/rules where possible.
  Documented cases are listed per file in `tools/arch_documented_sudo.json`, outside the
  shrink-only baseline. Adding one or raising its count needs the owner's
  `Architecture-approved-by:` trailer on the commit that changes that file, like
  `tools/arch_layers.json`; agents never add that trailer. Removing a case lowers the
  baseline and needs no trailer.
- The current delivery scope has no time logging product surface: do not add `hr_timesheet`
  or timesheet fields/endpoints to the customer UI; adding them requires a separately scoped
  implementation request. Payroll is approved (owner decision 2026-10-19) as the Saudi payroll
  phase of the HR and finance plan:
  payroll is a section of the HR application `webvue_hr` (owner decision 2026-10-19: one addon per
  application, not one addon per domain; ready-made modules such as OCA `payroll` are internal
  engines under it). Salary structures, GOSI, WPS, end of service, employee bank accounts and
  compensation data sit behind dedicated `hr.payroll.*` capabilities that no other HR capability
  implies, and behind the `hr.payroll` sub-feature; they never appear in general employee,
  directory or people views or serializers. The company's own bank statements and reconciliation in
  `webvue_finance` are accounting data and are allowed.
- Task detail routes are `/tasks/{id}` and `/projects/{id}/tasks/{taskId}`.
  Presentation follows DESIGN.md. Preserve URL query filters when returning;
  do not promise scroll restoration without evidence.

## Safe worktree workflow

Create every task worktree with `npm run wt -- new <area>-<slug> --owner <who> --task <what> --scope <path>`:
it lives only in `<main checkout>/.worktrees/<area>-<slug>`, branches from `main` (or the task's
integration branch) and records its owner and scopes. Never use a bare `git worktree add` or a tool's own
worktree folder (the Claude app's `worktrees` folder under `.claude`). Overlapping another active claim needs `--allow-overlap
"<reason>"` agreed with its owner. `npm run wt -- check` reports violations and changes nothing; the full
rules are in `docs/parallel-work.md` ("Worktree rules").

Use one temporary worktree per bounded task; its branch may use any normal name. Worktrees
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

The WebVue Git remote is `origin` (`https://github.com/tariiq222/webvue.git`),
tracked by `main`. Fetch and compare `main` with `origin/main` before
integration work. Push only when the user authorizes that push, and do not
force-push or rewrite published history. Do not imply a push, merge,
deployment, DNS cutover, or release approval that did not happen. Preserve
unrelated user changes and inspect status/diffs before editing overlapping
files.

## Authorization model


Authorization uses the capability catalog composed by `webvue.access.service` (the eleven
`webvue_core` system capabilities plus each application's own), built-in and
custom roles, and company-scoped assignments. `system_admin` manages access
and settings without implicitly granting HR/PMO write access. Project ownership
contributes contextual PMO capabilities. Legacy groups are migration/ORM support,
not a substitute for capability checks. Every resource operation also enforces
current-company and record visibility. Customers do not open Odoo.
Nobody does: the Odoo web client and Odoo's generic endpoints (`/web/dataset`, `/json/2`,
`/doc`, `/xmlrpc`, `/jsonrpc`, `/odoo`, `/report`, ...) are closed by the `ir.http` guard in
`webvue_platform` (default-deny, 404) for every session including system admins. A function that
was only reachable there moves into WebVue (`/api/v1` and the Nuxt UI).


## Verification boundary

Run focused checks appropriate to the changed layer, then the owning
orchestrator runs broader gates once. Odoo addon checks run from
`/Users/tariq/code/odoo` against a fresh scratch database with the selected
WebVue worktree's addons path. Web checks run from the selected worktree. Fresh
test output proves that checked layer only; it is not production or DNS proof.
Before claiming completion, report changed files, fresh command evidence, and
any residual risk.

Integration is a merge operation owned by the orchestrator. Do not rewrite
history on another worker's branch. Remove branches or
worktrees only after their content is preserved and no process is using them.

## Check commands

Follow the focused-local / complete-CI verification policy in
[`docs/testing.md`](docs/testing.md#fast-local-loop).

The Odoo scratch-database command block is in `docs/agents/odoo-rules.md`. CI is the GitHub Actions `ci` workflow
(`.github/workflows/ci.yml`, twelve stages, each a `deploy/ci/<stage>.sh` script runnable locally); see
`docs/testing.md`. Fast local loop: `npm run check:fast`, `npm run test:odoo`,
`npm run wt -- new <area>-<slug>`, `npm run hooks:install` (see `docs/testing.md`).
Web checks and general commands:

Use `npm test` for contracts and web unit tests, `npm -w apps/web run lint`
(that is `vue-tsc --build --noEmit`) for the web type check, and
`cd apps/web && npm run test:e2e` for Playwright. Do not type-check with
`npx -w apps/web vue-tsc ...`: `npx` has no `-w` flag, so it silently runs
from the repo root, checks nothing, and exits 0. Every `vue-tsc` invocation
runs from `apps/web`. Employee fixtures are created through Odoo, never through the
Nuxt UI. API tests extend `WebVueApiCase` from `webvue_api/tests/common.py` or
`WebVuePmoCase` for PMO fixtures; every `test_*.py` must be imported by its
addon `tests/__init__.py`. Loading a code/data change into an authorized
development database may use `-u <addon> --no-http --stop-after-init`; never
run tests against the dev `odoo19` database.

`apps/vendor-admin` has its own checks (run `npx nuxt prepare` there first):
`npm -w apps/vendor-admin run lint` and `npm -w apps/vendor-admin run test`; the live proof
against the real control plane is in `apps/vendor-admin/README.md` and `docs/testing.md`.

Test layers and the isolated agentic e2e runner (`npm run e2e`) are described in
[`docs/testing.md`](docs/testing.md).

The global `~/.npmrc` may be malformed. Use `npm ci --ignore-scripts` and never
edit that file. Use `rg` and targeted file reads for code search across Odoo and WebVue addons.

New collaboration endpoints require the current company. Company-less
projects and tasks are not visible after the Phase 1 backfill; isolation is
database-per-tenant with `webvue_platform.root_company_id`. Addon versions follow
[`docs/migrations.md`](docs/migrations.md).
