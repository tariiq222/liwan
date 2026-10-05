# Nasq agent entry point

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

Read `CLAUDE.md` for the product architecture and engineering rules, then
`docs/WORKSPACE.md` for the workspace and recovery map. Read
`docs/parallel-work.md` before parallel work or changing shared files.
These are repository instructions for every coding agent, regardless of tool.

- Verify the current branch, worktree, and dirty paths before editing. The
  canonical local development checkout is `/Users/tariq/code/nasq` on `main`.
- Develop bounded tasks in temporary `codex/<area>-<slug>` worktrees based on current
  `main`. Give each task explicit file ownership and independent dependencies,
  generated files, databases, and ports. One orchestrator owns Git integration,
  shared-file edits, runtime changes, and final checks.
- Preserve stock Odoo source. Extend `project` through `nasq_pmo` and `hr`
  through `nasq_hr`. Do not recreate either pillar.
- The HR page is `/hr`; `/api/v1/people` remains the PMO user-id picker. Preserve
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
- Never run tests on `odoo19`. Do not commit, merge, push, deploy, remove
  worktrees/branches, or discard work without authorization for that action.
- Local verification does not prove production deployment. Report fresh test
  evidence and the actual branch/runtime state.

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
  `nasq.feature.registry` with `owner` set to its addon name, and every route checks its feature.

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
  `<area>` is one of `core platform api pmo hr chat web cp deploy tools docs ci`.
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
   new tip. Promote only the verified candidate with a fast-forward, then
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

In OpenCode (including the Flex-* agents and `flex_delegate`) this rule does
not apply: models are chosen per task from the connected providers by cost and
adequacy, subject to any restriction the user gives in that session. The
coordinator owns planning, integration and review in both tools.

## Odoo development

- Use the `odoo-workflow` skill before any Odoo change; trace real source into a
  Context Brief with `file:line`, then consult the `odoo-19` reference pack.
- Runtime: Odoo **19.0**, read-only core `/Users/tariq/code/odoo`, custom addons
  in this checkout's `odoo-addons/`. `.claude/odoo.json` is machine-local and
  already gitignored; it pins `odoo_version`, `odoo_root`, `addons` (a JSON
  array), and `python`, deliberately without a live config or `dev_db`.
  Read-only trace command from the repo root (use Python 3.12 for core syntax):
  `/Users/tariq/code/odoo/.venv/bin/python /Users/tariq/.agents/skills/odoo-workflow/scripts/odoo_trace.py env`.
- Never run against named/live databases (including `odoo19`); use an explicitly
  isolated throwaway database and scratch-only config, data directory and logs.
  Test execution needs authorization; this setup does not authorize Odoo startup.
- Manifests: Odoo copyright header, `LGPL-3`, author `Tariq Alwalidi`,
  `category: Hidden`, `installable: True`, `application: False`; versions use
  `19.0.X.Y.Z` (core/HR `19.0.1.0.0`, PMO `19.0.1.1.0`). Follow
  `docs/migrations.md` for schema/data version bumps and migrations.
- Declare real dependencies: core uses `base`, `project`, `hr`,
  `cyan_meeting_minutes`; HR uses `nasq_api`, `hr`, `mail`; PMO also uses
  `nasq_platform`, `project`, `bus`, `cyan_meeting_minutes` (see manifests).
  Preserve pillar direction: shared `nasq_api` never imports a pillar.
- Keep `models/`, `security/`, `data/`, `tests/`; API pillars additionally use
  `controllers/` and whitelist-based `serializers/`; PMO has `report/`, `i18n/`
  and `migrations/`. Import Python modules through their `__init__.py` files;
  list every XML/CSV file in manifest `data` in the required dependency order.
- New models use dotted `nasq.*` names and `Nasq*` classes; extend stock models
  with `_inherit`, not copies. Model files and local XML ids use snake_case
  (`permission_access_users_read`, `nasq_hr_document_company_rule`); qualify
  cross-addon ids. ACLs live in `security/ir.model.access.csv` (PMO also has
  suffixed ACL CSVs), with `access_*` ids and `model_<dots_as_underscores>` refs.
- Tests live in `tests/test_*.py` and must be imported in `tests/__init__.py`.
  Model tests use `TransactionCase`; HTTP tests use `NasqApiCase(HttpCase)` via
  `NasqHrCase` / `NasqPmoCase`. Mirror existing `nasq` / `nasq_access` tags and
  `post_install`, `-at_install` selection where appropriate.
- Arabic: PMO ships `i18n/ar.po`; core/HR currently have no `i18n/` directory.
  Core capability data has explicit `name_ar` / `name_en` fields. Keep shipped
  PO filenames; make new UI strings extractable and update Arabic translations.
- Lint: `ruff check odoo-addons` uses root `ruff.toml` (upstream Odoo rules;
  imports: stdlib, third-party, `odoo`, `odoo.addons`). No project pre-commit
  or pylint-odoo configuration was found; do not introduce another convention.
- Authorized module tests: use the existing `CLAUDE.md` **Check commands** block
  and `.woodpecker.yml` **odoo** step (including its classification fixture),
  with the selected checkout's explicit addons path, `-i` modules,
  `--test-tags /<addon>` and `--stop-after-init`. Require a nonzero test count;
  preserve isolation/cleanup. These are documented commands, not run by setup.
