# LiwanOS agent instructions (single source)

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
| Addon-by-addon layout and cross-addon links | [Repository layout](docs/agents/repository-layout.md) |
| Schema versions and migrations | [Migrations](docs/migrations.md) |
| Isolated agentic e2e runner | [E2E guide](docs/e2e.md) |
| OCA addon sources | [OCA addons](docs/oca-addons.md) |
| `apps/web` folder-level instructions | [apps/web/AGENTS.md](apps/web/AGENTS.md) |
| Approval before updating external source versions | [Update policy](docs/UPDATE_POLICY.md) |
| Checkout map and evidence entry points, not live runtime state | [Workspace map](docs/WORKSPACE.md) |

Read the current task and the references for its scope before editing. A task-specific owner decision must state its scope; do not turn a bounded exception into a permanent policy change. If active references conflict or the decision source is unclear, report the exact conflict before changing the affected behavior. Errors, stale text and dead code inside the task's own scope are fixed or deleted without asking; a user-visible behavior change or reversing a recorded owner decision goes to the owner as options with a recommended default ([integration-rules.md](docs/agents/integration-rules.md#standing-authorization-owner-decision-2026-11-08)). Plans, archived documents, old worktree instructions and reports do not silently supersede active policy.

Keep three claims separate: an approved requirement, implementation present in a named branch/SHA, and behavior verified by a recorded check. Neither a document update nor green checks authorize a release tag, production deployment or any operation excluded in [integration-rules.md](docs/agents/integration-rules.md). Change the owning reference and update its summaries together; do not copy a policy into another instruction file.

## تعريف المنتج المعتمد — 2026-09-30

ليوان منصة عربية موحّدة لتشغيل الشركات، والأساس المشترك لجميع تطبيقاتها، ببيانات
وإجراءات وصلاحيات مترابطة في نظام واحد. رؤيتها شاملة لوظائف الشركة، مثل أودو في
اتساع النطاق، بدل الاشتراك في أنظمة متعددة معزولة، بهدف خفض التكلفة الإجمالية
للاشتراكات والتكامل والتشغيل. المشاريع والمهام والموارد البشرية وغيرها من التطبيقات الأولية
داخل المنصة، وليست تعريف المنتج الكامل أو حدّه النهائي. المرجع التفصيلي هو
[تعريف المنتج](apps/web/PRODUCT.md).

ميّز دائمًا بين هذه الرؤية والقدرات المنفّذة والمتحققة حاليًا. المجالات المؤجلة
هي حدود مرحلة تنفيذ، وليست استبعادًا دائمًا من رؤية ليوان. توسيع التعريف لا يجيز
تنفيذ وحدات جديدة تلقائيًا أو الادعاء بجاهزيتها، وخفض التكلفة هدف يحتاج قياسًا.

## واجهة العميل

ابدأ من [DESIGN.md](DESIGN.md): سياسة الواجهة الوحيدة وروابط فهرس المكونات والمرجع التقني.
التنفيذ في `apps/web/app` مع الطبقتين المشتركتين `packages/ui` و`packages/commercial-ui`. [الأرشيف](docs/archive/ui/README.md) والتقارير وخطط التنفيذ أدلة لسياقها، لا تعليمات واجهة نشطة.
مكوّنات الواجهة تؤخذ من Storybook (`apps/web/stories/**`، `npm -w apps/web run storybook`)؛ مكوّن مشترك بلا قصة ليس لبنة معتمدة، ولا نسخة محلية من مكوّن له قصة.
اتبع [UPDATE_POLICY.md](docs/UPDATE_POLICY.md).

Read `docs/parallel-work.md` before parallel work or changing shared files.

- Verify the current branch, worktree, and dirty paths before editing. The
  canonical local development checkout is `/Users/tariq/code/webvue` on `main`.
- Develop bounded tasks in temporary worktrees (any normal branch name) based on current
  `main`. Give each task explicit file ownership and independent dependencies,
  generated files, databases, and ports. One orchestrator owns Git integration,
  shared-file edits, runtime changes, and final checks.
- Preserve stock Odoo source. Extend `project` through `liwan_pmo` and `hr`
  through `liwan_hr`. Do not recreate either pillar.
- The HR page is `/hr`; `/api/v1/people` remains the user-id picker (owned by `liwan_directory`). Preserve
  HR documents and the `{items, total}` list envelopes.
- Presentation follows DESIGN.md, and DESIGN.md section 5 owns the list of overlays and
  the route-backed create panel. Records and edits are pages. Task board view is
  `?view=board`. Keep direct links, refresh/back, filters, permissions and draft protection.
- Read `docs/WORKSPACE.md` for the checkout map and links to acceptance evidence.
  Verify branch and dirty state live. Dated integration/recovery reports and
  older WIP describe their own checkpoints, not the current source state.
- When reviewing a diff, follow `REVIEW.md` (what to report and what is already automated).
- Never run tests on `liwan_dev` or `odoo19`. Commit, push of the task branch, PR, merge
  and `wt gc` fall under the standing authorization in
  [integration-rules.md](docs/agents/integration-rules.md); deploying, release tags,
  force-push, direct push to `main` and discarding work still need the owner's explicit words.
- Local verification does not prove production deployment. Report fresh test
  evidence and the actual branch/runtime state.

Odoo 19 Community is the engine and `apps/web` (Nuxt 4) is the customer UI,
with LiwanOS's own identity and experience. The current
deployment templates run an independent database, Odoo instance, frontend, and
edge per customer. The **target primary model** is self-service SaaS on shared
application services, retaining a separate database and filestore per customer;
local integration and acceptance boundaries are recorded in
[WORKSPACE.md](docs/WORKSPACE.md); they do not establish release approval.
Managed dedicated remains
separate from customer-hosted non-SaaS, which must not require SaaS billing or a
vendor connection at runtime. LiwanOS has a tenant abstraction through
`liwan_platform`, but tenant isolation remains database-per-tenant. There is no
shared-database tenant layer. Customer-specific behavior belongs in a
`customer_<name>_*` overlay, never in the core pillars. See the new
[hosting and acceptance contract](docs/superpowers/specs/liwan-shared-saas-and-sovereign-deployment.md)
for the target and its pending gates; the older
`docs/superpowers/specs/2026-09-03-liwan-platform-design.md` describes its own
historical scope. Government packaging from one release line is preferred for
assessment; a permanent fork is not approved by default.

## Clean pre-release codebase: no accumulation — 2026-10-15

LiwanOS has not been released and has no live tenants, so there is nothing to stay
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
  conventions in `docs/agents/web-rules.md`). One module per responsibility; no `misc`/`utils2`/`helpers_new`
  dumping grounds. When a file's last use goes, the file goes, together with its tests,
  stories, fixtures and locale keys.
- **Suppressions only shrink.** Like `tools/arch_baseline.json`, the set of test skips,
  `# noqa`, `eslint-disable`, `@ts-ignore`/`@ts-expect-error` and lint ignores never grows
  without a reason on the same line, and each is removed with its cause.
- **Touch it, clean it.** A task that meets accumulation inside its own file ownership removes
  it in the same task. Accumulation outside that ownership is reported in the task's result so
  the orchestrator schedules it; it is never extended. Cleaning is not a licence to widen scope,
  reverse an approved decision, or merge outside the authorization in
  [integration-rules.md](docs/agents/integration-rules.md).
- **Done means clean.** Work is not complete while it leaves a parallel path, an unused
  artifact, or a schema remnant behind. Reviewers (`REVIEW.md`, `odoo-reviewer`) report
  accumulation as a blocking finding, in the same class as a failing test.

## User-facing decisions and configurable customer policies — 2026-10-22

- Before changing user-visible behavior with materially different valid outcomes,
  present the owner with the options, user impact and a recommended default.
- Legitimate policies that vary across customers must have an explicit setting
  in the owning LiwanOS settings surface. State its scope (customer, company,
  branch or user), default, who may change it and how it affects existing data.
  Reuse the owning configuration model; do not hardcode customer-specific behavior.
- Configurable authorization policies must enforce the selected policy on the
  server for reads, writes, exports and attachments, with tests for each supported
  mode. Membership alone never grants a sensitive capability. No setting may
  bypass tenant isolation or expose data without an explicit authorized grant.
- Correctness, broken links, session isolation and error handling are defects to
  fix, not customer options to preserve faulty behavior. Deployment secrets and
  infrastructure policies remain in their owning operator/vendor configuration.

### Configurable, sector-flexible applications — owner constitution 2026-10-28

Every application, existing and new, serves many sectors and lets each tenant shape
it from that application's own settings section, so a tenant gets the options that
fit it without code changes or a per-customer fork.

- When designing or changing an application, identify the behavior that varies by
  sector or tenant (stages, optional sub-features, extra fields, value lists such as
  sources or reasons, visibility policies) and expose it as a setting with a sensible
  default, under the rules above. Sector presets that set several options at once
  are encouraged.
- Settings are explicit and structured (enumerable options, typed values, stated
  defaults) and readable through the API, because an assistant will recommend
  settings to each tenant. Do not hide a tenant choice in code or free text.
- Flexibility stays simple: good defaults, grouped settings, no option that serves
  no real sector. It never overrides R6 (no customer-name or customer-type
  condition), tenant isolation or server-enforced authorization; logic for one
  customer only still belongs in a `customer_<name>_*` overlay.

## Architecture rules (R1–R10)

Spec: [reference architecture and Git workflow](docs/superpowers/specs/2026-10-05-liwan-reference-architecture-and-git-workflow-design.md).
`tools/arch_policy.py` (the pre-commit hook and the CI `static` step) and `tools/git_policy.py` (CI `static` step) enforce these
rules. Violations that predate them are recorded in `tools/arch_baseline.json`. That baseline only shrinks:
never add an entry or raise a count to make a check pass.

- **R1** `liwan_core` depends on `base` only and names no application model or group.
- **R2** Each application owns its capabilities, groups, roles and record rules inside its own addon.
- **R3** No application imports another application. Two applications are linked by a bridge addon
  `liwan_<a>_<b>` with `auto_install`. The same holds in `apps/web`: an application folder under
  `pages/` or `components/` does not use another application's components.
- **R4** Dependencies point down only: foundation (`liwan_core` ← `liwan_platform` ← `liwan_api`) ← shared
  services ← applications ← bridges ← `customer_<name>_*`.
- **R5** The product runs without the control plane. Nothing in `odoo-addons` or `apps/web/app` imports
  from `apps/control-plane`; no new file references the control plane. `apps/vendor-admin` is the only vendor
  client of the control plane; the customer-commercial paths (`/subscription`, `apps/web/server/api/commercial`,
  `apps/web/server/utils/customer-commercial.ts`) remain the sole customer-side exception.
- **R6** No condition on a customer name or customer type. Differences come from `commercial_mode`,
  entitlements and `customer_<name>_*` addons.
- **R7** No new `sudo()` outside the documented cases. `tools/arch_documented_sudo.json` is the single
  registry of them, per file, outside the shrink-only baseline. `tools/sudo_gate.py` (inside `npm test`)
  fails a `sudo()` site beyond its file's documented cases and `tools/arch_baseline.json` count, naming
  `file:line`, and requires every documented case to carry a non-boilerplate reason that names the
  elevating call and the blocking ACL or rule (empty and duplicated reasons are rejected). A documented
  count that the code no longer reaches fails as stale. Adding a case needs no approval trailer (owner
  decision 2026-10-25); the reason itself is the record, and review of the actual diff is what judges it.
  Document a case only after fixing ACLs/rules where possible.
- **R8** Every feature works in `saas` and `non_saas`, or is explicitly commercial and hidden in `non_saas`.
- **R9** Customise Odoo through its public extension points only: no edits to Odoo source, no new direct
  SQL on Odoo tables, no new override of a private access method on an Odoo model without a documented
  reason and a test, no copied Odoo methods.
- **R10** Each application registers its `<app>.enabled` feature, sub-features, limits and counters in
  `liwan.feature.registry` with `owner` set to its addon name, and every route checks its feature. A
  shared service (rank 3) gates its routes with `requires_registered_feature`, whose keys the
  applications register in that service's registry.

- **UI1** The shared UI layers `packages/ui` and `packages/commercial-ui` import no
  application, addon, app alias, `@liwan/contracts` or control-plane code.
- **VA1** `apps/vendor-admin` imports only itself, the shared UI layers and `@liwan/commercial-contracts`, calls no
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
  `<area>` is one of the fixed areas `core platform api web cp deploy tools docs ci` or an application area;
  `tools/git_policy.py` (`app_areas()`) derives the application areas from the rank-4 addons in `tools/arch_layers.json`
  (the addon name without `liwan_`); `AREAS` in that file is the exact list. A new application's id becomes a valid area when it is registered there.
- Commit subjects are `type(scope): imperative subject`, at most 72 characters, with `type` in
  `feat fix refactor perf test docs ci build chore` and `scope` from the `<area>` list. One logical change
  per commit. No `wip` commit reaches `main`. A schema change carries its version bump and migration
  directory in the same commit.
- `main` is protected on GitHub with PR and current CI requirements and no admin bypass.
  Integration uses a pull request; direct pushes and protection bypasses are prohibited. The
  preservation procedure, the standing authorization (commit, push of the task branch, PR,
  ready, merge after green `ci-result`, `wt gc`), the exclusions and the merge checklist have one
  owner: [integration-rules.md](docs/agents/integration-rules.md). Read it before integrating an
  older branch. The 2026-10-17 direct-push exception is superseded by this PR workflow.
- Use a task PR for an independent change; use one `<prefix>/tools-integrate-<slug>` candidate
  and one PR for a coupled batch, and do not submit both a batch and its constituent branches.
- A PR stays **draft** while scope, local checks or prepublication inspection are incomplete.
  The required status-check policy is current-head `ci-result` only; review follows `REVIEW.md`.
- The `ci` workflow runs on PRs, on pushes to `main` and nightly; the last two run all thirteen
  stages. Release tags, the full-run requirement and the live-protection checks are in
  [integration-rules.md](docs/agents/integration-rules.md); check scope is in
  [testing.md](docs/testing.md#ci-workflow).
- Only task branches and tags are pushed; `main` changes only through a merged PR.
  `release/19.0.X.Y.Z` tags on `main` are the releases (owner's explicit authorization each time);
  there is no per-customer branch. Unmerged work is tagged `archive/<name>` before its branch is removed.


## Preserve approved work on every merge — 2026-09-08

Before every integration, including from an older worktree, follow the six steps in
`docs/agents/integration-rules.md`. They are mandatory, as is its definition of the owner
keywords «كومت ودمج» and «انشر». These are agent workflow instructions, not a Git hook or
server-enforced branch protection; do not claim automated merge protection exists unless it has
actually been installed and verified.

## Agent execution

Use the model selected for the current session. No exclusive model is required
for the coordinator, workers or reviewers. Choose available native models and
supported effort appropriate to the task; a model-name mismatch does not block
work or require permission. Never retry exhausted quota or use paid API
credentials as a hidden fallback.

Implementation is delegated by default to native Sonnet subagents (owner decision 2026-11-08):
the coordinator plans, writes the brief with explicit file ownership and checks, splits independent
work across parallel agents, reviews the returned patch and re-runs the checks. Scopes stay
explicit and mutable resources isolated: one writer per file, per `docs/parallel-work.md`. Delegation
does not change who may commit, push, merge or clean up; that is in
[integration-rules.md](docs/agents/integration-rules.md).

## Repository layout and product state

The addon-by-addon layout, the unified checkout state and the English product background are in
`docs/agents/repository-layout.md`. Read it before changing addon boundaries, ownership or
cross-addon links.

## Product contracts

- Presentation follows DESIGN.md (overlays and the create panel are in its section 5). Keep
  stable routes, visible headings, direct-link/refresh support, and back navigation that
  preserves list filters. Task board view is `?view=board`.
- Arabic (`ar`) is the default locale and the UI is RTL-first. User-facing
  strings use `$t()`/`t()` and the owning locale namespace.
- API routes use `type='json2'`, `auth='user'`, explicit methods, and the
  shared `api_handler`. The one exception is the public namespace `/api/v1/public/` (owner decision
  D3, 2026-10-28): routes for anonymous visitors, `auth='public'` and `save_session=False`, authorized by a
  per-document access token or a gateway signature, never by a session (the Nuxt proxy forwards them
  without cookies); gateway callbacks there may be `type='http'`. Each is listed with its reason in
  `tools/route_gate_allowlist.json`. Return serializer-whitelisted shapes and structured
  errors with a real HTTP status: 403 `forbidden`, 404 `not_found`, and 422
  `invalid` where applicable. Browser traffic uses the session cookie, not a
  bearer token.
- Keep `/api/v1/people?q=` and its user-id `PersonRef` contract unchanged.
  HR employee ids and user ids are distinct resources and must not be merged.
- `sudo()` is allowed only in the documented cases. `tools/arch_documented_sudo.json` is their single
  source: per file, a count and a reason that names the elevating call and the blocking ACL or record
  rule. `tools/sudo_gate.py` (inside `npm test`) fails any site beyond that registry plus the
  `tools/arch_baseline.json` count, any weak or duplicated reason, and any documented count the code no
  longer reaches. Do not add a case without documenting it and fixing ACLs/rules where possible.
  Adding or raising one needs no approval trailer (owner decision 2026-10-25): the reason is the
  record and review of the actual diff is the human gate. Weakening `tools/arch_layers.json` still
  needs the owner's `Architecture-approved-by:` trailer; agents never add that trailer.
  `liwan_tasks`, `liwan_operations` and their bridges have no `sudo()` path. Never write `sudo()` inside
  an `@api.constrains` method: Odoo's `_validate_fields` already runs constraints on `self.sudo()`, so
  it changes nothing and is noise. Cron jobs run as `base.user_root` and need none.
- The current delivery scope has no time logging product surface: do not add `hr_timesheet`
  or timesheet fields/endpoints to the customer UI; adding them requires a separately scoped
  implementation request. Payroll is approved (owner decision 2026-10-19) as the Saudi payroll
  phase of the HR and finance plan:
  payroll is a section of the HR application `liwan_hr` (owner decision 2026-10-19: one addon per
  application, not one addon per domain; ready-made modules such as OCA `payroll` are internal
  engines under it). Salary structures, GOSI, WPS, end of service, employee bank accounts and
  compensation data sit behind dedicated `hr.payroll.*` capabilities that no other HR capability
  implies, and behind the `hr.payroll` sub-feature; they never appear in general employee,
  directory or people views or serializers. The company's own bank statements and reconciliation in
  `liwan_finance` are accounting data and are allowed.
- Task detail routes are `/tasks/{id}` and `/projects/{id}/tasks/{taskId}`.
  Presentation follows DESIGN.md. Preserve URL query filters when returning.

## Safe worktree workflow

Create every task worktree with `npm run wt -- new <area>-<slug> --owner <who> --task <what> --scope <path>`:
it lives only in `<main checkout>/.worktrees/<area>-<slug>`, branches from `main` (or the task's
integration branch) and records its owner and scopes. Never use a bare `git worktree add` or a tool's own
worktree folder (the Claude app's `worktrees` folder under `.claude`). Overlapping another active claim needs `--allow-overlap
"<reason>"` agreed with its owner. `npm run wt -- check` reports violations and changes nothing; the full
rules are in `docs/parallel-work.md` ("Worktree rules").

Use one temporary worktree per bounded task. Worktrees have independent `node_modules` and
`.nuxt` (never symlinked); install with `npm ci --ignore-scripts`. Ports, databases and Odoo/Nuxt
endpoints come from the worktree's `.env.worktree` profile, not from command-line overrides.
One writer owns each file and one orchestrator owns shared files, Git integration, runtime state
and final checks; install, port and collision rules are in `docs/parallel-work.md`. Never run
tests against `liwan_dev` or `odoo19`; use a scratch database. Temporary integration databases,
ports and logs are disposable and are not production evidence.

The LiwanOS Git remote is `origin` (`https://github.com/tariiq222/liwan.git`), tracked by `main`.
Fetch and compare `main` with `origin/main` before integration work. Do not force-push or
rewrite published history. Do not imply a push, merge, deployment, DNS cutover, or release
approval that did not happen. Preserve unrelated user changes and inspect status/diffs before
editing overlapping files.

## Authorization model


Authorization uses the capability catalog composed by `liwan.access.service` (the eleven
`liwan_core` system capabilities plus each application's own), built-in and
custom roles, and company-scoped assignments. `system_admin` manages access
and settings without implicitly granting HR/PMO write access. Project ownership
contributes contextual PMO capabilities. Legacy groups are migration/ORM support,
not a substitute for capability checks. Every resource operation also enforces
current-company and record visibility. Customers do not open Odoo.
Nobody does: the Odoo web client and Odoo's generic endpoints (`/web/dataset`, `/json/2`,
`/doc`, `/xmlrpc`, `/jsonrpc`, `/odoo`, `/report`, ...) are closed by the `ir.http` guard in
`liwan_platform` (default-deny, 404) for every session including system admins. A function that
was only reachable there moves into LiwanOS (`/api/v1` and the Nuxt UI).


## Verification boundary

Run focused checks appropriate to the changed layer, then the owning
orchestrator runs broader gates once. Odoo addon checks run from
`/Users/tariq/code/odoo` against a fresh scratch database with the selected
LiwanOS worktree's addons path. Web checks run from the selected worktree. Fresh
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
(`.github/workflows/ci.yml`, thirteen stages, each a `deploy/ci/<stage>.sh` script runnable locally); see
`docs/testing.md`. Fast local loop: `npm run check:fast`, `npm run test:odoo`,
`npm run wt -- new <area>-<slug>`, `npm run hooks:install` (see `docs/testing.md`).
Web checks and general commands:

Use `npm test` (the repository tools, policy gates and the unit tests of contracts, shared UI, web and
vendor-admin; see `package.json`), `npm -w apps/web run lint`
(that is `vue-tsc --build --noEmit`) for the web type check, and
`cd apps/web && npm run test:e2e` for Playwright. Do not type-check with
`npx -w apps/web vue-tsc ...`: `npx` has no `-w` flag, so it silently runs
from the repo root, checks nothing, and exits 0. Every `vue-tsc` invocation
runs from `apps/web`. Employee fixtures are created through Odoo, never through the
Nuxt UI. API tests extend `LiwanApiCase` from `liwan_api/tests/common.py` or
`LiwanPmoCase` for PMO fixtures; every `test_*.py` must be imported by its
addon `tests/__init__.py`. Loading a code/data change into an authorized
development database may use `-u <addon> --no-http --stop-after-init`; never
run tests against `liwan_dev` or `odoo19`.

`apps/vendor-admin` has its own lint (run `npx nuxt prepare` there first):
`npm -w apps/vendor-admin run lint`; its tests are in `npm test`, and the live proof
against the real control plane is in `apps/vendor-admin/README.md` and `docs/testing.md`.

Test layers and the isolated agentic e2e runner (`npm run e2e`) are described in
[`docs/testing.md`](docs/testing.md).

The global `~/.npmrc` may be malformed. Use `npm ci --ignore-scripts` and never
edit that file. Use `rg` and targeted file reads for code search across Odoo and LiwanOS addons.

New collaboration endpoints require the current company. Company-less
projects and tasks are not visible after the Phase 1 backfill; isolation is
database-per-tenant with `liwan_platform.root_company_id`. Addon versions follow
[`docs/migrations.md`](docs/migrations.md).
