# Testing guide

liwan has four test layers (layer 3 has a mock variant and a real-Odoo variant, 3b). Pick the cheapest one that proves the change.

| Layer | Use it for | Run |
| --- | --- | --- |
| 1. Odoo `TransactionCase` / `HttpCase` | Models, access rules, API routes, migrations | Odoo test run on a fresh scratch DB (see `docs/agents/odoo-rules.md` "Check commands"; `npm run test:odoo` wraps it) |
| 2. Contracts + web unit tests | Zod contracts, composables, pure UI logic | `npm test`, `npm -w apps/web run lint` |
| 3. Playwright mock specs | Page behaviour against the mock API, no model needed | `cd apps/web && npm run test:e2e` (CI step `e2e-mock`) |
| 3b. Playwright real-Odoo specs | Journeys that write real data through a production build on a scratch Odoo | `deploy/ci/e2e-odoo.sh` (CI stage `e2e-odoo`) |
| 4. Agentic e2e | Whole user journeys through the real UI | `npm run e2e` / `npm run e2e:smoke` |

## Finance close race drill

The CLI `--timeout` is a total wall-clock budget for both authentications, the barrier, close requests and bounded body reads; it is not a per-socket timeout.

This is a **manual scratch-only drill**, not a CI test or release gate. Never run it against a live/customer database. Use a disposable clone of the Odoo test template and bind the server only to loopback. Seed one company with the Saudi chart, an open fiscal year containing balanced posted activity, and a manager assigned `finance.closing.manage` (plus `finance.setup.manage`, as required by the close route).

1. From the Odoo environment, clone the local test template (substitute the actual template database name):

   ```sh
   createdb --template=liwan_test_template liwan_scratch_finance_race
   ```

2. Seed and commit the fixture through `odoo-bin shell` with the selected worktree addon path. Use a local seed script which creates the company, loads the chart, posts balanced entries dated within the open year, creates the manager, assigns the finance manager role, and confirms the year remains open:

   ```sh
   "$ODOO_PYTHON" "$ODOO_ROOT/odoo-bin" shell --no-http \\
     --addons-path="$ODOO_ROOT/odoo/addons,$ODOO_ROOT/addons,$WORKTREE/odoo-addons,$OCA_PATH" \\
     -d liwan_scratch_finance_race < /path/to/scratch-seed.py
   ```

3. Start Odoo on an available loopback port, with only the scratch DB and isolated data/log paths:

   ```sh
   "$ODOO_PYTHON" "$ODOO_ROOT/odoo-bin" \\
     --addons-path="$ODOO_ROOT/odoo/addons,$ODOO_ROOT/addons,$WORKTREE/odoo-addons,$OCA_PATH" \\
     -d liwan_scratch_finance_race --db-filter='^liwan_scratch_finance_race$' \\
     --data-dir="$SCRATCH_ROOT/data" --logfile="$SCRATCH_ROOT/logs/odoo.log" \\
     --http-interface=127.0.0.1 --http-port=8178 --workers=0 --max-cron-threads=0
   ```

4. Run the tool with the manager credentials; do not put them in scripts or logs:

   ```sh
   python3 tools/finance_close_race.py \\
     --base-url http://127.0.0.1:8178 --db liwan_scratch_finance_race \\
     --login finance_race_manager --password "$RACE_PASSWORD" --year 2025 \\
     --timeout 30 --json-out "$SCRATCH_ROOT/race-result.json"
   ```

   It authenticates two independent cookie sessions, synchronizes the close calls, and exits 0 only for one success plus one structured 422 `already_closed` refusal. Preserve result/logs as scratch evidence, stop the harness server afterward, and never point it at a live database.

## Node version

`.nvmrc` pins the Node version (the file is the single source; do not copy the number into other
documents). Select that
version with your Node version manager before installing dependencies or running
checks; confirm `node --version`. Local Claude Code's `SessionStart` hook reads
the major from `.nvmrc` and prepends the installed Homebrew major to `PATH` for
its Bash commands. It reports a missing installation; this hook alone does not
prove the exact active patch version.

Install dependencies independently in each worktree with `npm ci --ignore-scripts`
and regenerate both apps' Nuxt files with their `postinstall` scripts before
root tests/type checks. Do not share `node_modules` or `.nuxt` by symlink.
`npm run dev` loads the selected worktree's git-ignored `.env.worktree` automatically,
including its Nuxt/Odoo ports, scratch database and WebSocket URL. Main uses its
private apps/web/.env with the explicitly configured `liwan_dev` development
database. `liwan_dev` is never a test target (the Bash guard also refuses the legacy name `odoo19`); use scratch resources.

In a Claude Code cloud session (`CLAUDE_CODE_REMOTE=true`) the same hook fetches the full Git history (the clone is
shallow, and `tools/ui_policy.py` reads its baseline commit), runs `npm ci --ignore-scripts` when
`package-lock.json` changed and `nuxt prepare` in `apps/web` and `apps/vendor-admin`, so `npm test` and
`npm -w apps/web run lint` work at once; it also sets `NODE_OPTIONS=--max-old-space-size=6144`, because `vue-tsc`
runs out of Node's default heap there. The container's network policy blocks the Playwright browser download, so the
hook points `PLAYWRIGHT_BROWSERS_PATH` at `~/.cache/ms-playwright`, where the Chromium revisions the repo's
`playwright-core` expects are linked to the container's own `/opt/pw-browsers` builds. Odoo tests are not set up there: they run in the `ci` workflow or locally.
The Bash guard reads the upstream Odoo checkout from `LIWAN_ODOO_SRC` (default `~/code/odoo`).

## Fast local loop

This section owns the depth of local checks. For a pull request, GitHub Actions runs the required
tests and type checks before merge. A failed PR run costs a full CI round (tens of minutes), so the
goal before Ready is a PR that passes on its first run. For a routine change, review the actual
diff, run the applicable local Git and architecture policies, and run the focused checks of the
changed part only: `npm run check:fast` (it selects by changed layer), or the specific test files,
type check or `npm run test:odoo -- --addons <changed>` that cover the diff. These take minutes;
leave the broad suites (full `npm test`, every Odoo module, Playwright, RTL stories) to CI.

Before marking Ready, run focused local verification for changes to authentication, permissions,
tenant isolation, payments, migrations, or operations that can lose or corrupt persisted data.
Also verify locally when changing how CI selects or gates checks, when the selected PR stages
leave a material coverage gap, or when the task or layer rules require specific evidence. Select
checks that prove the affected behavior and relevant failure or refusal paths. Odoo checks use
isolated scratch databases. For local-only integration, verify the combined result locally
because there is no PR run.

Record which local checks ran and which coverage was left to CI. Reuse recorded local evidence
when it covers the candidate and the relevant inputs are unchanged. The orchestrator runs the
checks that depend on the combined candidate when earlier evidence cannot cover it. Run a broad
local suite only when focused checks cannot diagnose a failure or cover a material gap. GitHub
still requires successful `ci-result` for the current PR head. The full run on `main` checks the
merged result and supplies release evidence.

| Command | What it does |
| --- | --- |
| `npm run check:fast` | Optional local shortcut: policy checks and checks for layers changed against `main` (`tools/check_fast.py`). Root `package.json`, `package-lock.json` or the CI workflow also select the full `npm test`. Use `-- --dry-run` to see the plan without running checks. |
| `npm run test:odoo` | Odoo tests of the changed addons and their dependents on a scratch database cloned from a cached template (`tools/odoo_test.py`). Options: `--addons a,b`, `--all`, `--base`, `--dry-run`, `--keep-db`. |
| `python3 -B tools/test_slot.py -- <command>` | Machine-wide test queue shared by every session and worktree: at most `LIWAN_TEST_SLOTS` (default 2) heavy checks run at once, the rest wait and print who holds the slots. `npm test`, `npm run test:odoo`, `npm run check:fast`, the `npm run e2e*` scripts and `npm -w apps/web run lint` already take a slot; wrap any other heavy command (a direct `odoo-bin` test run, `vitest`, Playwright, `vue-tsc`) in it. A command inside a held slot takes no second one. `--status` lists the holders. From a worktree that predates it, call it by the main checkout path. |
| `npm run wt -- new <area>-<slug> --owner <who> --task <what> --scope <path>` | New task worktree with its own `node_modules`/`.nuxt`, free ports and a scratch DB name in the git-ignored `.env.worktree`, and its ownership claim; accepts any valid branch name as a base and refuses scopes that overlap another active claim unless `--allow-overlap "<reason>"` (`tools/wt.py`, rules in `docs/parallel-work.md`). |
| `npm run wt -- claim --owner <who> [--task ...] [--scope ...]` | Inside a task worktree: record its claim, change or refresh your own, or take over an expired one (`tools/wt.py`). |
| `npm run wt -- check` | Read-only report of worktrees that break the location, naming or claim rules; exit 1 when there is one (`tools/wt.py`). |
| `npm run wt -- status` | One table of every worktree wherever it lives (`*` = outside `.worktrees/`): branch, owner and claim state, ahead/behind `main`, merged, dirty, last commit age, `node_modules` size, recorded scratch DB and ports, a summary line and the rule report (`tools/wt.py`). |
| `npm run wt -- gc [--apply] [--branch codex/<area>-<slug>]` | Dry run by default: lists worktrees+branches merged into `main` with commits of their own, clean, and held by no process, plus the scratch databases of those worktrees that nobody is connected to (`liwan_scratch_e2e`, hand-named and `tools/odoo_test.py` databases are never touched). Removing a worktree also deletes its ignored files (`.env.worktree`, `.nuxt`, `node_modules`). `--apply` runs `git worktree remove`, `git branch -d` and `dropdb`, reports each failure and continues; unmerged, dirty, current, in-use and missing-folder worktrees are skipped. After a merge `--apply` falls under the standing authorization in `docs/agents/integration-rules.md`. `--branch` limits it to that branch's worktree and scratch database, says why a worktree is kept, and deletes the local branch when it has no worktree and is merged. |
| `npm run check:audit` | `npm audit` gate: fails on a high or critical advisory in production dependencies, or a critical one in any dependency. Needs registry access. The CI `static` stage runs it when a change touches `package.json` or `package-lock.json`; the daily `audit` workflow runs it on `main`. |
| `npm run check:semgrep` | Semgrep (`p/python`, `p/typescript`, `p/secrets`) on the source files changed against `main`, tests and generated files excluded (`tools/semgrep_gate.py`). ERROR and secrets findings fail; WARNING is listed only. Needs network for the rulesets, sends no usage data, exits 3 when semgrep or the registry is unavailable. Also runs in the CI `static` stage. |
| `npm run review:jev -- --base <ref> --task "<what the change does>"` | Advisory Jev quality scores (score and confidence per dimension, plus priorities) for the diff against the base (`tools/jev_review.mjs`; `--diff <file>`, `--json`, `--previous <file>` for a before/after delta). Needs the local `~/code/jev-review` server and a key in `JEV_API_KEY` or `~/.config/jev-review/api-key`; refuses diffs that touch secret-bearing paths; always exits 0. Run once per non-trivial review (see `REVIEW.md`); never a gate. |
| `npm run test:rtl` | Builds Storybook and opens every story in Arabic at 1280 px and 390 px: no page error, `dir=rtl`, no sideways page scroll (`apps/web/e2e-rtl`, config `apps/web/playwright.rtl.config.ts`). Stories that cannot render are listed with a reason in `KNOWN_BROKEN` and only that list may shrink. Runs in CI as the `rtl-stories` stage, a matrix of four shards (`deploy/ci/rtl-stories.sh --shard k/N`, Playwright `--shard=k/N` over the story tests, each job building Storybook itself); `fullyParallel` in the config splits the one spec file per test. |

Optional local git hooks: `npm run hooks:install` writes `pre-commit` (secret guard, docs and
architecture policy, plus ui policy and ruff for staged files) and `commit-msg` (the
`type(scope): subject` rule) into the shared `.git/hooks`, so every worktree gets them. It leaves
`core.hooksPath` and the existing Git LFS hooks alone, refuses to overwrite a hook that is not
its own, and `git commit --no-verify` still bypasses it. The `ci` workflow stays binding.

`tools/odoo_test.py` builds the template once from the base branch (Odoo commit, release
module list and the base `odoo-addons` tree form its name, so it is rebuilt when any of them
changes) and only ever creates, clones or drops `liwan_scratch_*` databases. Stale
`liwan_scratch_tpl_*` templates are small and can be dropped by hand.

## CI workflow

Integration uses a PR to `main`, following
[`agents/integration-rules.md`](agents/integration-rules.md). `ci` runs on PRs,
merge-queue entries (`merge_group`) and pushes to `main`, runs nightly on `main` (`schedule`), and can be started with
`workflow_dispatch` (`full: true` for all stages). The workflow file `.github/workflows/ci.yml` is the source for the
triggers. Each job runs its `deploy/ci` script and can be reproduced locally with
isolated resources. `ci-result` aggregates selected stages; its success is needed
before merge, but does not prove a full run or owner authorization.

`ci` remains read-only and deterministic. Keep a PR draft during local
preparation. A draft runs no stage and reports its blocked state as `ci-draft`. Draft events use a separate
concurrency group so a delayed draft event cannot cancel a ready run or replace its required `ci-result`. Marking it
ready starts the run on the actual candidate and requests review. A newer push to the same PR cancels its older
run. On `main` a running run always finishes; GitHub keeps only the newest pending `main` run, whose
commit contains every earlier merge. A manual `workflow_dispatch` run is never cancelled by a push. The required
status-check policy is current-head `ci-result` only. It fails if a selected stage
was skipped or missing, or any stage failed/cancelled. Only unselected stages may
be skipped. The branch need not be up to date with `main` (merge `main` in only on a
conflict or a needed change, see `docs/agents/integration-rules.md`); resolve review
findings/conversations before an explicitly authorized protected merge. Recheck live GitHub rules;
source policy alone does not establish remote protection settings. CI does not
repair code, merge PRs, create tags or deploy.

The thirteen stages are `static`, `ai-service`, `control-plane`, `vendor-admin`, `odoo`,
`odoo-app-standalone`, `odoo-bridge`, `upgrade`, `restore-drill`, `image`, `e2e-mock`, `e2e-odoo` and
`rtl-stories`.

### Review evidence

Review follows `REVIEW.md` using the selected available agent or a human.
Record the reviewed head, findings and evidence limits. There is no mandatory
model provider or automated AI review status. Recheck the actual combined diff
and affected tests when the base/head changes; CI evidence and owner authorization
remain separate from a review report.

### Change-scoped stages

A pull request runs only the stages its changed files can affect. The path-to-stage map is `RULES` in `tools/ci_scope.py`: the first matching rule wins, `static`
always runs, and **a path with no rule runs all thirteen stages** (that includes any `tools/` file not
listed in `STATIC_ONLY_TOOLS`). Preview a selection, with the rule behind each changed path:

```sh
python3 -B tools/ci_scope.py --base main [--commit codex/<area>-<slug>] [--pull-request]
```

A pull request is narrower still (`--pull-request`, passed by the `scope` job only for the `pull_request`
and `merge_group` events; a merge-queue entry is selected from the queue base to the queued merge result):

- `upgrade`, `restore-drill` and `image` never run on a pull request. They run on the push to `main`, the
  nightly run and a full dispatch.
- `e2e-odoo` runs before merge for changes under `apps/web/` or `odoo-addons/`, and when a shared input selects
  it through `tools/ci_scope.py`. The stage's seed and runner also select it.
- An addon file selects `static`, the Odoo stages with affected modules, and `e2e-odoo`. The other stages in the
  addon rule run on the push to `main`.
- A change limited to `apps/web/server/` does not select `rtl-stories`: the Storybook build imports no
  server file.
- The `odoo` stages reach only the affected release modules: the addons changed under `odoo-addons/<addon>/`
  plus every release addon that depends on them, directly or transitively (`depends` in each manifest). A
  changed path outside `odoo-addons/` that feeds an Odoo stage (`.github/`, `deploy/`, `tools/catalog_check.py`,
  `packages/contracts/`, `package.json`, an unmapped file) affects all modules. `ci_scope.py --pull-request
  --modules` prints the list (empty means all).
- `odoo` still installs the whole release but runs only the affected modules' tests, split by test weight over
  as few shards as the weight needs: one shard per sixth of the release's total test weight, up to 6
  (`shard_count_for` in `tools/odoo_shards.py`). The scope job passes the list to the shards
  as `ODOO_TEST_MODULES` (`ODOO_TEST_MODULES=a,b deploy/ci/odoo.sh --shard k/N`).
- `odoo-app-standalone` and `odoo-bridge` run only the applications and bridges among the affected modules
  (a bridge is affected through either side); with none, the stage is not selected, and `ci-result` does not
  expect it.

Every push to `main`, the nightly schedule and `workflow_dispatch` with `full: true` run all thirteen stages with all
six shards and every isolation group, so a cross-module regression the narrowed pull request could not see is
caught on `main`.

A manual `workflow_dispatch` run with `full: true` runs all thirteen stages whatever the change. A
`release/19.0.X.Y.Z` tag is cut only from a `main` commit whose `ci` run was such a full run with all
thirteen stages green, including every matrix job and aggregate on the exact main
commit. Publishing that immutable tag requires explicit owner authorization; no
workflow creates it automatically.

### Documentation-only static checks

A pull request that only adds or edits ordinary Markdown under `docs/` uses the
light static profile if the changed files are valid UTF-8 and at most 1 MiB each.
It checks new relative links in changed Markdown, the owning instruction
documents' references, Git and
architecture rules, tracked secrets and retired terms, without installing npm
dependencies or Chromium; only the `policies` part of `static` runs them. Deletions, renamed paths, binary files, changes in
`docs/api/` or `docs/design-system/`, and any mixed or unknown diff use the full
static profile. The job and required `ci-result` are the same. Pushes to `main`,
scheduled runs, manual runs and merge groups always use the full static profile.

### CI job pass cache

In a pull request or merge-queue entry, an individual job that already passed on exactly the same inputs
is omitted from the next run. `static` always runs with three parallel parts
(`deploy/ci/static.sh policies|tests|types`; without an argument the script runs all three in order).
Every other stage job ends with `.github/actions/stage-pass`, which saves a key from
`python3 -B tools/ci_stage_cache.py key`: a hash of the tracked files the stage reads (the `RULES` of
`tools/ci_scope.py`) and its matrix entry. The `scope` job trusts keys from the same ref only.
It logs the reused jobs and sends GitHub the remaining matrix entries. A shard retains its original
number and total: if only shard 4 of 6 is still required, it runs as `4/6`. A shared input change invalidates
the keys of every job that reads it. When every job of a stage is reused, the stage is omitted.
A failed cache lookup reuses nothing. Pushes to `main`, nightly runs and manual runs execute every selected job.

### Red `main` alert

On a push to `main` and on the nightly run, the `main-alert` job (`deploy/ci/main-alert.sh`) reads `ci-result`. A red
result opens one issue titled `CI is red on main` (label `ci-red`) or, when one is open, comments the run URL and the
failed jobs; a green result comments the green run URL on the open issue and closes it. `ci-result` does not depend on
it, and a failing issue call fails the job so a broken alert is seen.

### After the merge

Removing the merged task's worktree, branch and scratch database is `python3 -B tools/wt.py gc --apply`
(see "Fast local loop"), under the standing authorization in `docs/agents/integration-rules.md`.

### Stage notes

The `odoo` stage covers the release modules and is a matrix of six shards (a job still named `odoo` to
`ci-result`, so it stays one of the thirteen stages). Every shard installs the whole release module list on
its own Postgres service and runs only its share of the module tests (`--test-tags`), so cross-module
behaviour is exercised in each. `tools/odoo_shards.py` splits the release modules by their `def test_`
counts times `COST_FACTOR` (seconds per test relative to the median module, measured for `liwan_finance`, `liwan_hr`, `liwan_pmo` and five bridges; the comment in `tools/odoo_shards.py` records how) (greedy, heaviest first; refit the factors when the shard times drift apart); `python3 -B tools/odoo_shards.py plan` shows the split and its weights. Run one shard
with `deploy/ci/odoo.sh --shard k/N`, all shards in parallel locally with `python3 -B tools/odoo_shards.py run`
(same environment as `deploy/ci/odoo.sh`; shard k uses `ODOO_PORT + k - 1` and its own scratch database), and the
unsharded full run with plain `deploy/ci/odoo.sh`. A template database does not help the shards: Odoo
runs the module tests during `-i`, so each shard has to install anyway (the install is about 17 s). The
shard count is `SHARD_COUNT` in `tools/odoo_shards.py`; a changed count changes the matrix and the
`--shard k/N` argument together.

`odoo-app-standalone` and `odoo-bridge` prove that each application works alone and each bridge works with
its two sides (owner decision 2026-10-20: a customer subscribing to one application is not affected by
another). Both are matrices built by `tools/app_isolation.py` from the ranks in `tools/arch_layers.json`:
the foundation, every rank-4 application and every rank-5 bridge, so a newly registered application or
bridge joins them without a workflow edit. `matrix` packs them into `GROUP_COUNT` jobs per stage (3 for
applications, 2 for bridges, split by test weight like the `odoo` shards); `deploy/ci/lib/isolation-group.sh`
runs each module of its job in turn and fails at the end naming every module that did not pass. Each run
installs only its part on a disposable PostgreSQL database:

- `deploy/ci/odoo-app-standalone.sh liwan_api` installs the foundation alone (ranks 0-2, no shared service,
  application or bridge), runs the tests of every foundation module, and with the route probe also creates,
  disables and reactivates an account through `/api/v1/admin/users` with no HR employee in the payload (the
  account contract approved on 2026-10-20; it fails until the foundation stops requiring `employee_id`).
- `deploy/ci/odoo-app-standalone.sh <app>` installs the application alone (Odoo brings its declared
  foundation, shared-service and engine dependencies), runs its own tests, fails when another application
  or any bridge was installed (`tools/app_isolation.py check`), then runs the route probe with the
  application's features on.
- `deploy/ci/odoo-bridge.sh <bridge>` installs the bridge's two sides, requires the bridge to auto-install
  and its tests to pass, checks nothing else came along, runs the route probe with every feature on, and
  then once per side with the other side's features switched off (no retained read).

The route probe (`deploy/ci/odoo_route_probe.py`, run inside `odoo-bin shell`) calls every parameterless
`GET /api/v1` route of the probed modules through the real HTTP dispatch as a user holding every
assignable role. An answering module's routes must return 2xx (400 or 422 when a route needs a query input
the probe does not invent) and it must serve at least one such route; the routes of a switched-off side must
refuse with 403 `feature_not_included`, and a module asked to answer needs at least one 2xx; a bridge's routes with one side off, and a shared service's routes
(gated by the keys applications register, so closed with the application side) may refuse but never fail
with a 5xx. It checks the route surface, not bridge-specific fields inside a side's responses: those stay with
the bridge's own tests. Run one locally with the environment of `deploy/ci/odoo.sh` plus `ISOLATION_PORT`, for example
`deploy/ci/odoo-app-standalone.sh liwan_hr` or `deploy/ci/odoo-bridge.sh liwan_tasks_pmo`. The
control-plane PostgreSQL suites run serially because they share their isolated scratch databases.
`vendor-admin` has its own prepare, types, tests and build checks. The `image` stage builds every production image
(Odoo, web, vendor-admin, ai-service, proxy and guard) under owned `liwan-<name>:ci-<run id>` tags. It
installs the release in the Odoo image and checks it is hardened, starts web, vendor-admin, ai-service
and guard without external services (web answers `/login`, vendor-admin serves a built static asset because its pages need the control plane, ai-service `/healthz`, guard
denies an unknown host with 403 and passes its healthcheck) and asserts none runs as root, validates both
Caddyfiles with the proxy image and checks its rate-limit module (the official Caddy base keeps root), and
writes each image's tag and content digest to the job summary. After the smoke checks it scans all six
images with Trivy 0.75.0 (the official `aquasec/trivy` container, pinned by tag and digest, run against the
Docker socket) for vulnerabilities that have a fix available: any CRITICAL finding fails the stage, HIGH findings
are listed in the job log and counted in the summary without failing, and a scanner error (for example the
vulnerability database download) fails the stage with a message instead of passing. All images are scanned before
the stage fails. The scan covers OS and language packages known to the Trivy database at run time, not the
application code, and it does not allowlist anything. The daily `image-scan` workflow runs the same stage on `main`,
so an advisory published against an unchanged base image fails there first instead of in every pull request. The image digests are not published artifacts. A change under
`apps/web`, `apps/vendor-admin`, `apps/ai-service`, `packages/ui`, `packages/commercial-ui` or
`packages/commercial-contracts` selects the `image` stage because those images build from them. Mock browser tests and RTL stories cover their listed flows, not every possible
real integration. No paid model calls are required.

The `upgrade` stage reports an explicit absence of a compatible release baseline when none exists. That
outcome is not evidence of an upgrade having been exercised. Migration rules are in
[`migrations.md`](migrations.md), and the pinned Odoo source commit is
[`deploy/odoo/ODOO_COMMIT`](../deploy/odoo/ODOO_COMMIT).

## Measured timings (dated 2026-10-13, 14-core Mac, warm caches, single runs)

These numbers are a dated snapshot; the module, test and story counts have grown since. Re-measure before quoting them.

| Step | Time |
| --- | --- |
| `npm test` chain plus web type check, step by step | about 50 s |
| `npm run check:fast` when only `tools/` changed | about 18 s |
| `npm ci --ignore-scripts --prefer-offline` | 4.7 s |
| `tools/wt.py new` (worktree, install, `nuxt prepare`) | about 10 s |
| `createdb -T` clone of the installed template | about 1.2 s |
| `npm run test:odoo -- --addons liwan_hr`, warm / cold template | 30 s / 43 s |
| CI `e2e-mock` locally on a busy machine (production build, then the spec files in 14 min, then the long-list tests in 25 s) | about 16 min |
| `npm run test:rtl` (Storybook build 7.6 s, every story x 2 viewports, 4 workers) | about 2.4 min |
| Semgrep gate on a few changed files | about 7 s |

Not measured: the agentic e2e runner (needs model credentials) and the Odoo-backed e2e stack.

## 1. Odoo tests

Extend `LiwanApiCase` (or `LiwanPmoCase`) from `liwan_api/tests/common.py`. Every `test_*.py`
is collected by its addon `tests/__init__.py` (`import_all_tests(__name__)` from `liwan_core.testing`). Never run them against the dev `liwan_dev` database.

`tools/odoo_test.py` clones a template with every release module installed and runs `-u` of the
selected addons, so an `at_install` test of a low-rank addon sees a PARTIAL registry (later modules
such as `calendar` or `liwan_tasks_pmo` are not loaded yet) over a COMPLETE schema. Any test that
creates users or tasks, or touches rules or fields owned by later modules, must be tagged
`@tagged('post_install', '-at_install')` (examples: `liwan_core` `tests/test_access_models.py`,
`liwan_pmo` `tests/test_transition.py`).

## 2. Unit tests

`npm test` runs the policy checks, the contracts tests (including the database-free
`packages/commercial-contracts` tests, which compile the real `deploy/catalog` solution) and the web unit tests. Keep pure
logic in composables so it can be tested here without a browser.

### Contract fixtures (serializer to zod parity)

`packages/contracts/fixtures/manifest.json` lists routes (name, addon, route, status, zod schema
export). `LiwanApiCase.api()` records the real JSON response of each listed route while the Odoo
tests run, only when `LIWAN_CONTRACT_FIXTURES=<dir>` is set (the richest response wins, ids are
renumbered, timestamps pinned). The committed files in `packages/contracts/fixtures/<app>/` are
parsed with their strict schema by `src/fixtures.test.ts`, which runs in `npm test`.

- Add a route: add one manifest entry, then refresh.
- Refresh: `python3 -B tools/contract_fixtures.py` (runs the Odoo tests of the manifest addons on a
  scratch database, slow). Drift check: `python3 -B tools/contract_fixtures.py --check`. Neither is part
  of `npm test`.

## 3. Playwright mock specs

Specs live in `apps/web/e2e` and talk to `apps/web/e2e/internal-ui-audit-mock.mjs`. They are
deterministic and free, and CI runs the list in `ci-mock-specs.txt`. Use them for page
states, navigation and regressions that need no judgement.

How the stage runs (`deploy/ci/e2e-mock.sh`):

- One production build and one worker per job, the mock on `MOCK_PORT`. `e2e-mock` is a matrix of three jobs
  (`deploy/ci/e2e-mock.sh --shard k/N`, Playwright `--shard=k/N` over `ci-mock-specs.txt`); the long-list run below
  happens in the last shard only, and without `--shard` the script runs everything, as locally. The context menu starts folded, so a spec that reads the
  sidebar sets the `liwan-context-sidebar=open` cookie itself.
- The customer commercial flag is on for this server (`NUXT_CUSTOMER_COMMERCIAL_ENABLED` and its public twin), with the
  mock acting as the stub control plane for `/subscription` and `/invite/accept`.
- `ci-mock-long-list-specs.txt` runs on a second mock padded to 60 tasks (`MOCK_TASK_COUNT=60`, port `MOCK_PORT + 10`) and a
  second server from the same build (`WEB_PORT + 10`): the scroll-restoration and navigation specs need a list taller than a
  viewport, and every other spec keeps the four-task fixture its counts assume.
- A spec belongs in `ci-mock-specs.txt` only if it passes in that run. The gate is never edited to hide a failure.

A spec that signs in to Odoo and writes real data needs a scratch stack. Such a journey
either runs in the `e2e-odoo` stage below or is covered by an addon test plus a mock spec, in which case it is deleted.
The `E2E_REAL_ODOO` specs that have not yet passed on a scratch Odoo are named, with the reason, in
`deploy/ci/e2e-odoo.sh` and in the latest record under `docs/verification/`; they are in no CI list until one scratch run proves them.

### Real-Odoo specs (`e2e-odoo` stage)

`deploy/ci/e2e-odoo.sh` installs every release module on the scratch database `liwan_scratch_e2e`, seeds it through Odoo
(`tools/e2e_seed.py`, then `apps/web/e2e/fixtures/real-odoo-acceptance.py`, which writes the fixture ids to
`.superpowers/real-odoo/fixtures.json`), starts Odoo and a production Nuxt build on port 44300 and runs the specs named in
`REAL_ODOO_SPECS` (fourteen files, one per guarded `E2E_REAL_ODOO` spec) with `E2E_REAL_ODOO=1`. Every one of those files
signs in through `apps/web/e2e/support/realOdooSession.ts`, which finishes the mandatory two-step sign-in with the remembered
device the fixture seeds per account; no spec posts a single-step form and none carries its own credential fallback. Any
explicit exclusion belongs in `EXCLUDED_REAL_ODOO_SPECS` with its reason.
No model call or API key is involved, unlike `npm run e2e:odoo` (the agentic runner of "Isolated agentic e2e"), which stays the local exploration path. The stage
runs on pull requests according to the scope above, on pushes to `main`, nightly and in a full dispatch. A project starts with no optional tool enabled and finance stays off until a company enables it, so the finance journeys
create their project with `tool_preferences` and assert the tool answered as enabled — the same opt-in a customer performs.

### LiwanOS AI spec

`e2e/ai-mocked.spec.ts` is in `ci-mock-specs.txt`. Besides the audit mock it needs `e2e/ai-service-mock.mjs`, a
scripted stand-in for the AI service (no model; port `AI_MOCK_PORT`, 4499 in CI) that Nuxt reaches through
`NUXT_AI_SERVICE_URL`. Export that variable when starting the server (`nuxt dev` or `node .output/server/index.mjs`): it also switches on
`/ai` and is read at runtime, so the build needs none (CI builds without it on purpose). The audit mock serves `GET /api/v1/ai/tools` (the catalog: the draft tool is omitted for a
`mock_caps=reader` user) and records `POST /api/v1/ai/audit` rows, which the spec reads from
`GET /__mock/ai-audit`. The unavailable state is checked by answering 503 `ai_unavailable` from the browser
side (`page.route`), not by stopping the service. The 375px case checks the conversations disclosure below 768px
(toggle, new conversation, reopening, touch targets, no sideways scroll). Set `AI_SHOTS_DIR` to also save Arabic and English
desktop and mobile screenshots of `/ai` and the open disclosure at 375px.

### Running the my-tasks specs

The standalone list, new and detail specs use `e2e/my-tasks-mock.mjs`, behind the flag `E2E_MY_TASKS=1`.
The shared audit mock's module-preview profile also includes task capabilities. Both paths supply
first-paint reads on the server, while `page.route` handles browser requests. The
wrapper listens on `MOCK_PORT`, starts the audit mock on `MOCK_PORT + 1000` (the upstream), adds the tasks
capabilities to `GET /api/v1/me`, and answers the first-paint reads of `/my-tasks/<id>` (the task, its
comments and attachments, and `convert-targets`) from `e2e/my-tasks-fixtures.mjs`, because the server
renders them where `page.route` cannot reach. Everything else is forwarded untouched, and each spec mocks
its later browser calls to `/api/v1/my-tasks` itself. Use free ports (never 3000, 8069 or the `liwan_dev`
database), point Nuxt at the wrapper port, and open Nuxt on `localhost`, not `127.0.0.1`:

```sh
MOCK_PORT=4501 node apps/web/e2e/my-tasks-mock.mjs   # wrapper 4501, upstream 5501
cd apps/web
NUXT_ODOO_URL=http://127.0.0.1:4501 NUXT_ODOO_DB=liwan_ui_mock_only \
  NUXT_PUBLIC_WS_URL=ws://127.0.0.1:4501/websocket npx nuxt dev --port 4401
E2E_MY_TASKS=1 E2E_BASE_URL=http://localhost:4401 npx playwright test e2e/my-tasks-*.spec.ts
```

Warm `nuxt dev` (open `/login` once) before the first run: a cold compile can time out the login.
The specs use 60s test and 15s expect timeouts for a loaded machine.

The CI personal-task journey and account-invitation specs use `e2e/ssr-fixture.ts` to install
session-scoped first-paint data in the ordinary audit mock. Specs that install these fixtures import
its extended `test`, whose automatic fixture deletes each session's data after the test, including
when several spec files reuse one worker. Browser mutations synchronize confirmed successful writes
with the server snapshot, so a hard refresh sees the same record. The shared mock and dedicated
wrapper reuse `myTaskFixtureRead` from `e2e/my-tasks-fixtures.mjs`; their list fixtures retain their
respective contexts, and unknown record IDs return 404.

## 4. Agentic e2e

The runner is `e2e` (config: `e2e.config.ts`, models: `e2e/models.ts`, tests:
`e2e/tests/*.e2e.ts`).

The register of end-user scenarios, with the personas and the status of each scenario
(planned, manual, automated, failing, gap), is [e2e/scenarios](../e2e/scenarios/README.md).
A test that covers a scenario cites its ID in the title and updates its row in the same change.
`python3 -B tools/e2e_scenario_coverage.py` lists every page, Odoo route and capability that has no
scenario yet (`--check` exits 1 on a gap).

- `npm run e2e` runs all tests, `npm run e2e:smoke` runs the smoke test, and
  `npm run e2e -- e2e/tests/<file>.e2e.ts` runs one file. All args are forwarded to
  `e2e run`.
- The wrapper `tools/e2e_isolated.mjs` starts the mock API and a private Nuxt dev server,
  points the runner at them, and stops both afterwards (also on Ctrl-C). Logs go to
  `.e2e/logs/` (`mock.log`, `nuxt.log`); the report is `.e2e/report.json`.
- Default ports are 43388 (mock) and 43300 (Nuxt). Override with `E2E_MOCK_PORT` and
  `E2E_NUXT_PORT`. If a default port is busy a random one is used. The replay cache is
  keyed by the app origin, so a random port means a cache miss and live model calls.
- Model calls: the first run of an `agent.act` calls the configured model. Later runs
  replay the cached actions in a few seconds. `.e2e/cache/` is output; deleting it only
  slows the next run.
- `npm run e2e:explore -- 'goal' --max-steps 4` (mock) and `npm run e2e:odoo:explore -- ...` (scratch Odoo) run `e2e explore` through the same isolated wrapper (`E2E_COMMAND=explore`; args are forwarded to `e2e explore`).
- `npx e2e explore` hunts for bugs toward a goal without a test file.
  `npx e2e mcp` lets a coding agent drive and inspect the live app, then write a test
  from what it saw. Point both at the isolated stack (start it with the commands in
  `tools/e2e_isolated.mjs`, or set `E2E_BASE_URL` to its origin).
- `npm run e2e:odoo` (same wrapper with `E2E_STACK=odoo`) runs against a real scratch Odoo
  instead of the mock, for journeys that write data (`e2e/tests/pmo-journey.e2e.ts`, tag
  `journey`; it skips itself on the mock stack). The database is the fixed
  `liwan_scratch_e2e` (the wrapper refuses any other name and never uses `liwan_dev`), served
  from `/Users/tariq/code/odoo` (override `E2E_ODOO_ROOT`) with a generated config, data
  and logs under `.e2e/odoo/` and a `saas` classification fixture like CI. PostgreSQL comes
  from `PGHOST`/`PGPORT`/`PGUSER` (defaults `127.0.0.1`, `5432`, `tariq`); passwords only
  through `PGPASSWORD`.
  - First run creates the database: installs every release module, then
    `tools/e2e_seed.py` (through `odoo-bin shell`) opens the full entitlement policy
    (`pmo.enabled` and the other keys), creates the test accounts `e2e_admin` and
    `e2e_employee`, and builds the demo company with its role personas (`e2e_ceo`,
    `e2e_hr_manager`, `e2e_staff1`, ...; credentials declared in `e2e.config.ts`, override
    with `E2E_USER_<NAME>_PASSWORD`). Expect about 40 s on a warm machine, more on a cold one; a
    failed create drops the half-built database. Later runs reuse it (about 25 s of
    startup).
  - `E2E_ODOO_RESET=1` drops and recreates it; `E2E_ODOO_UPDATE=1` runs `-u` and re-seeds. `E2E_ODOO_SEED=1` only re-runs the seed on the existing database (the seed is idempotent).
    Tests must use unique names (timestamps), because the database persists between runs.
  - Ports: Odoo 43369 (`E2E_ODOO_PORT`), Nuxt 43300 (`E2E_NUXT_PORT`); 3000 and 8069 are
    refused. Odoo logs: `.e2e/odoo/logs/odoo.log` (server), `prepare.log` (create/seed).
- The default agent's judge is Jev (TypeSafe System One, `e2e/jev-judge.ts`): it gives the `assert` and `waitFor`
  verdicts from the text observation; `extract` and screenshot-only judgments fall back to `google/gemini-3.7-flash`.
  The key comes from `JEV_API_KEY` or `~/.config/jev-review/api-key`; the instruction and the accessibility tree of the
  page go to `api.typesafe.ai`, so test data only.
- The `ultrafast` agent (`e2e/jev-ultrafast.ts`) is an alternative brain for `agent.act` steps, a port of the
  [jev-ultrafast](https://github.com/browser-use/jev-ultrafast) policy. One request per turn lets Jev pick an operation
  (`CLICK`, `TYPE_TEXT`, `SELECT`, scroll, `WAIT`, `DONE`, `BLOCKED`) and an indexed element. Run it with
  `npm run e2e -- --agent ultrafast` (`--agent` is forwarded to `e2e run`). The TypeSafe key (`JEV_API_KEY` or
  `~/.config/jev-review/api-key`) is the only key it needs; it calls no other model. It never replays or records the
  cache and stops after three actions that change nothing.
  - Limitation: Jev cannot generate text, so `TYPE_TEXT` selects instead of generating. Code finds candidates in the
    step instruction (quoted text, then every run of up to four words), Jev selects one in the same request, and the
    code types it verbatim, or blocks with `AUTOMATION_UNSUPPORTED` when none fits. A value must appear literally in
    the instruction; generated or reformatted values are not possible.
  - A custom executor also receives `agent.assert`, which it blocks as `AUTOMATION_UNSUPPORTED`, so run tests that use
    `assert` with the default agent; `waitFor` and `extract` keep using the Jev judge.
  - The instruction and the accessibility text of the page go to `api.typesafe.ai`, so test data only.
- `npm run e2e:dev` runs the runner directly against an already-running dev server. Use
  it only deliberately and never for state-changing tests.

## Rules

- Never run tests against `:3000`, `:8069` or the `liwan_dev` database. The wrapper refuses
  an `E2E_BASE_URL` on those ports.
- Test data only. Agent steps send screenshots to the configured model provider, so the
  page must never show real customer data.
- One goal per `agent.act`, and pin the outcome with `expect`. Prefer exact steps
  (`screen`, `app`, `expect`) and use the agent only for what is hard to script.
- Every user journey of an application gets one e2e test once it has real flows.
- The mock API only knows today's applications. A new application's journey test needs
  either mock routes for that application or a scratch Odoo stack.
- CI does not run agentic e2e today because it needs model credentials. Tests that use
  only exact steps may join CI later (the cache runs `read-only` in CI).

## 5. Vendor admin app

`apps/vendor-admin` has its own checks. `npm test` runs its unit tests (CI step `vendor-admin` too); the type check, build and Playwright specs below are separate commands. Run `npx nuxt prepare` in
`apps/vendor-admin` first (the `postinstall` does it after a normal install).

| Command | Proves |
| --- | --- |
| `npm -w apps/vendor-admin run lint` | Type check (`vue-tsc --build --noEmit`); CI step `vendor-admin`. |
| `npm -w apps/vendor-admin run test` | Unit tests (vitest); CI step `vendor-admin`. |
| `npm -w apps/vendor-admin run e2e` | Playwright against the mock control service in `apps/vendor-admin/e2e`, on a production build; `e2e:dev` runs the `*.dev.spec.ts` specs on `nuxt dev`. Not a CI step. |
| `PATH=/opt/homebrew/bin:$PATH node tools/vendor_admin_local_check.mjs` | Live proof: sign-in, enrollment and team management against the real control plane with real WebAuthn verification. Needs local Postgres; scratch database `liwan_control_scratch_p3live`. Details in `apps/vendor-admin/README.md`. Not a CI step. |

Local evidence only; it does not establish deployment readiness.

## Continuous release verification

The thirteen-stage pipeline remains unchanged in scope; the `ci` workflow selects from it as described under "Change-scoped stages". The static stage
runs canonical release unit discovery after dependency installation (the real H3
handler probes load jiti), and shared/dedicated guard regressions. Root deployment
tests run separately with `PYTHONPATH=deploy` for their existing top-level helper imports, to avoid importing the same package as `releases.*` instead
of `deploy.releases.*`. No default unit test may connect to PostgreSQL or start
Docker/Odoo. Focused checks from the selected worktree:

```sh
python3 -B -m unittest discover -s deploy/releases -t . -p 'test_*.py'
node --test deploy/shared/release-guard.test.mjs deploy/shared/release-assets.test.mjs deploy/shared/release-routes.test.mjs deploy/releases/test_dedicated_guard.mjs
```

Live release acceptance remains an explicit separate local operator command,
not a thirteenth pipeline stage or a condition that weakens the `ci` workflow:

```sh
python3 -m tools.continuous_updates_acceptance.run --config /absolute/operator/local.json --output /absolute/operator/report.json
```

The prepared configuration requires scratch database bindings, actual source
process/config/role identities, existing sessions/attachments and loopback URLs.
Never use `liwan_dev`. Reports distinguish source-process, PostgreSQL, Odoo upgrade,
HTTP/session/attachment and concurrent tenant evidence from Docker/production
proof. `tools/continuous_updates_acceptance/docker_odoo.py` is a separate scoped
image experiment, not fresh product Dockerfile acceptance.

Maintenance model/API checks use test tag `liwan_maintenance`: authorization,
company isolation, operator notices, immutable events, preference/booking CAS,
overlap serialization, scheduling policy and atomic claim duration. Contracts
and web tests cover Arabic/English, draft preservation and IANA/DST windows.
Actual translated-error tests verify PO runtime loading. A local check never
approves hosting, release, external provider quality or universal zero downtime.
