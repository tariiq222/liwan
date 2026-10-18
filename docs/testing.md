# Testing guide

webvue has four test layers. Pick the cheapest one that proves the change.

| Layer | Use it for | Run |
| --- | --- | --- |
| 1. Odoo `TransactionCase` / `HttpCase` | Models, access rules, API routes, migrations | Odoo test run on a fresh scratch DB (see `docs/agents/odoo-rules.md` "Check commands"; `npm run test:odoo` wraps it) |
| 2. Contracts + web unit tests | Zod contracts, composables, pure UI logic | `npm test`, `npm -w apps/web run lint` |
| 3. Playwright mock specs | Page behaviour against the mock API, no model needed | `cd apps/web && npm run test:e2e` (CI step `e2e-mock`) |
| 4. Agentic e2e | Whole user journeys through the real UI | `npm run e2e` / `npm run e2e:smoke` |

## Node version

`.nvmrc` pins Node 22, but Homebrew's default `node` may be newer. For Claude Code sessions the
`SessionStart` hook in `.claude/settings.json` runs `.claude/scripts/use-nvmrc-node.sh`, which puts
`$(brew --prefix node@<.nvmrc major>)/bin` first on `PATH` (one stderr line if that Node is not installed) for every Bash command, so no manual
`export PATH=...` is needed. Outside Claude Code, run `export PATH=/opt/homebrew/opt/node@22/bin:$PATH` once per shell.

## Fast local loop

Use these while iterating; `npm test` and the `ci` workflow stay binding before a merge.

| Command | What it does |
| --- | --- |
| `npm run check:fast` | Policy checks always, plus ruff, tools tests, contracts/web tests and the web type check only for the layers that changed against `main` (`tools/check_fast.py`). |
| `npm run test:odoo` | Odoo tests of the changed addons and their dependents on a scratch database cloned from a cached template (`tools/odoo_test.py`). Options: `--addons a,b`, `--all`, `--base`, `--dry-run`, `--keep-db`. |
| `npm run wt -- new <area>-<slug>` | New task worktree with its own `node_modules`/`.nuxt`, free ports and a scratch DB name in the git-ignored `.env.worktree` (`tools/wt.py`). |
| `npm run wt -- status` | One table of every worktree wherever it lives (`*` = outside `.worktrees/`): branch, ahead/behind `main`, merged, dirty, last commit age, `node_modules` size, recorded scratch DB and ports, plus a summary line (`tools/wt.py`). |
| `npm run wt -- gc [--apply] [--branch codex/<area>-<slug>]` | Dry run by default: lists worktrees+branches merged into `main` with commits of their own, clean, and held by no process, plus the scratch databases of those worktrees that nobody is connected to (`webvue_scratch_e2e`, hand-named and `odoo_test.py` databases are never touched). Removing a worktree also deletes its ignored files (`.env.worktree`, `.nuxt`, `node_modules`). `--apply` runs `git worktree remove`, `git branch -d` and `dropdb`, reports each failure and continues; unmerged, dirty, current, in-use and missing-folder worktrees are skipped. `--apply` needs the owner's authorization. `--branch` limits it to that branch's worktree and scratch database, says why a worktree is kept, and deletes the local branch when it has no worktree and is merged. |
| `npm run check:semgrep` | Semgrep (`p/python`, `p/typescript`, `p/secrets`) on the source files changed against `main`, tests and generated files excluded (`tools/semgrep_gate.py`). ERROR and secrets findings fail; WARNING is listed only. Needs network for the rulesets, sends no usage data, exits 3 when semgrep or the registry is unavailable. Also runs in the CI `static` stage. |
| `npm run review:jev -- --task "<what the change does>"` | Advisory Jev quality scores (score and confidence per dimension, plus priorities) for the diff against `main` (`tools/jev_review.mjs`; `--base <ref>`, `--diff <file>`, `--json`, `--previous <file>` for a before/after delta). Needs the local `~/code/jev-review` server and a key in `JEV_API_KEY` or `~/.config/jev-review/api-key`; refuses diffs that touch secret-bearing paths; always exits 0. Never a gate: see `REVIEW.md`. |
| `npm run test:rtl` | Builds Storybook and opens every story in Arabic at 1280 px and 390 px: no page error, `dir=rtl`, no sideways page scroll (`apps/web/e2e-rtl`, config `playwright.rtl.config.ts`). Stories that cannot render are listed with a reason in `KNOWN_BROKEN` and only that list may shrink. Runs in CI as the `rtl-stories` stage. |

Optional local git hooks: `npm run hooks:install` writes `pre-commit` (secret guard, docs and
architecture policy, plus ui policy and ruff for staged files) and `commit-msg` (the
`type(scope): subject` rule) into the shared `.git/hooks`, so every worktree gets them. It leaves
`core.hooksPath` and the existing Git LFS hooks alone, refuses to overwrite a hook that is not
its own, and `git commit --no-verify` still bypasses it. When the checks pass, `pre-commit` also prints the advisory Jev scores for the staged diff (never blocks; `WEBVUE_SKIP_JEV=1` skips it). The `ci` workflow stays binding.

`tools/odoo_test.py` builds the template once from the base branch (Odoo commit, release
module list and the base `odoo-addons` tree form its name, so it is rebuilt when any of them
changes) and only ever creates, clones or drops `webvue_scratch_*` databases. Stale
`webvue_scratch_tpl_*` templates are small and can be dropped by hand.

## CI workflow

Integration into `main` is a direct push after local checks (owner decision 2026-10-17, valid until the first
server deployment). The `ci` workflow (`.github/workflows/ci.yml`) is a safety net, not a gate: it runs on pull
requests and can be started by hand (`workflow_dispatch`, input `full`), which is the step that follows each push. Each stage is a job that runs `deploy/ci/<stage>.sh`, so a stage
can also be run locally from a clean checkout. The aggregate job `ci-result` passes only when every
selected stage passed. The `automerge` job still merges a non-draft PR whose `ci-result` passed, but direct
push is the normal route (GitHub branch protection and auto-merge are unavailable on this private repository's
plan). The owner will replace this before deployment. The preservation steps in
[`agents/integration-rules.md`](agents/integration-rules.md) apply before every integration.

The twelve stages are `static`, `ai-service`, `control-plane`, `vendor-admin`, `odoo`,
`odoo-tasks-standalone`, `odoo-tasks-bridge`, `upgrade`, `restore-drill`, `image`, `e2e-mock` and
`rtl-stories`.

### Change-scoped stages

The twelve stages take about 33 minutes, so a pull request runs only the stages its changed files can
affect. The path-to-stage map is `RULES` in `tools/ci_scope.py`: the first matching rule wins, `static`
always runs, and **a path with no rule runs all twelve stages** (that includes any `tools/` file not
listed in `STATIC_ONLY_TOOLS`). Preview a selection, with the rule behind each changed path:

```sh
python3 -B tools/ci_scope.py --base main [--commit codex/<area>-<slug>]
```

A manual `workflow_dispatch` run with `full: true` runs all twelve stages whatever the change. A
`release/19.0.X.Y.Z` tag is cut only from a `main` commit whose `ci` run was such a full run with all
twelve stages green. This is a manual rule, no tool enforces it.

### After the merge

Removing the merged task's worktree, branch and scratch database is `python3 -B tools/wt.py gc`
(see "Fast local loop"), only with the owner's authorization.

### Stage notes

The `odoo` stage covers the release modules; the standalone tasks and tasks/PMO bridge stages cover
independent installations, each on a disposable PostgreSQL database rather than `odoo19`. The
control-plane PostgreSQL suites run serially because they share their isolated scratch databases.
`vendor-admin` has its own prepare, types, tests and build checks. The `image` stage builds and checks
the deployment image; mock browser tests and RTL stories cover their listed flows, not every possible
real integration. No paid model calls are required.

The `upgrade` stage reports an explicit absence of a compatible release baseline when none exists. That
outcome is not evidence of an upgrade having been exercised. Migration rules are in
[`migrations.md`](migrations.md), and the pinned Odoo source commit is
[`deploy/odoo/ODOO_COMMIT`](../deploy/odoo/ODOO_COMMIT).

## Measured timings (2026-10-13, 14-core Mac, warm caches, single runs)

| Step | Time |
| --- | --- |
| `npm test` chain plus web type check, step by step | about 50 s |
| `npm run check:fast` when only `tools/` changed | about 18 s |
| `npm ci --ignore-scripts --prefer-offline` | 4.7 s |
| `tools/wt.py new` (worktree, install, `nuxt prepare`) | about 10 s |
| Odoo install of the 10 release modules | about 17 s |
| `createdb -T` clone of the installed template | about 1.2 s |
| `npm run test:odoo -- --addons webvue_hr` (80 tests), warm / cold template | 30 s / 43 s |
| Full Odoo run (install and tests of all release modules, 658 tests) | 234 s |
| CI `e2e-mock` locally (`nuxt build` 28.8 s, 7 Playwright tests 4.9 s) | about 35 s |
| `npm run test:rtl` (Storybook build 7.6 s, 184 stories x 2 viewports, 4 workers) | about 2.4 min |
| Semgrep gate on a few changed files | about 7 s |

Not measured: the agentic e2e runner (needs model credentials) and the Odoo-backed e2e stack.

## 1. Odoo tests

Extend `WebVueApiCase` (or `WebVuePmoCase`) from `webvue_api/tests/common.py`. Every `test_*.py`
is imported by its addon `tests/__init__.py`. Never run them against the dev `odoo19` DB.

`tools/odoo_test.py` clones a template with every release module installed and runs `-u` of the
selected addons, so an `at_install` test of a low-rank addon sees a PARTIAL registry (later modules
such as `calendar` or `webvue_tasks_pmo` are not loaded yet) over a COMPLETE schema. Any test that
creates users or tasks, or touches rules or fields owned by later modules, must be tagged
`@tagged('post_install', '-at_install')` (examples: `webvue_core` `tests/test_access_models.py`,
`webvue_pmo` `tests/test_transition.py`).

## 2. Unit tests

`npm test` runs the policy checks, the contracts tests and the web unit tests. Keep pure
logic in composables so it can be tested here without a browser.

## 3. Playwright mock specs

Specs live in `apps/web/e2e` and talk to `internal-ui-audit-mock.mjs`. They are
deterministic and free, and CI runs the list in `ci-mock-specs.txt`. Use them for page
states, navigation and regressions that need no judgement.

### WebVue AI spec

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

`e2e/my-tasks-*.spec.ts` (list, new, detail) are not in `ci-mock-specs.txt`: the shared mock's `/me` does
not know the tasks app, and the SSR route guard fetches `/me` on the server where `page.route` cannot
reach. All three run through one wrapper, `e2e/my-tasks-mock.mjs`, behind one flag, `E2E_MY_TASKS=1`. The
wrapper listens on `MOCK_PORT`, starts the audit mock on `MOCK_PORT + 1000` (the upstream), adds the tasks
capabilities to `GET /api/v1/me`, and answers the first-paint reads of `/my-tasks/<id>` (the task, its
comments and attachments, and `convert-targets`) from `e2e/my-tasks-fixtures.mjs`, because the server
renders them where `page.route` cannot reach. Everything else is forwarded untouched, and each spec mocks
its later browser calls to `/api/v1/my-tasks` itself. Use free ports (never 3000, 8069 or the `odoo19`
database), point Nuxt at the wrapper port, and open Nuxt on `localhost`, not `127.0.0.1`:

```sh
MOCK_PORT=4501 node apps/web/e2e/my-tasks-mock.mjs   # wrapper 4501, upstream 5501
cd apps/web
NUXT_ODOO_URL=http://127.0.0.1:4501 NUXT_ODOO_DB=webvue_ui_mock_only \
  NUXT_PUBLIC_WS_URL=ws://127.0.0.1:4501/websocket npx nuxt dev --port 4401
E2E_MY_TASKS=1 E2E_BASE_URL=http://localhost:4401 npx playwright test e2e/my-tasks-*.spec.ts
```

Warm `nuxt dev` (open `/login` once) before the first run: a cold compile can time out the login.
The specs use 60s test and 15s expect timeouts for a loaded machine.

## 4. Agentic e2e

The runner is `e2e` (config: `e2e.config.ts`, models: `e2e/models.ts`, tests:
`e2e/tests/*.e2e.ts`).

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
  `webvue_scratch_e2e` (the wrapper refuses any other name and never uses `odoo19`), served
  from `/Users/tariq/code/odoo` (override `E2E_ODOO_ROOT`) with a generated config, data
  and logs under `.e2e/odoo/` and a `saas` classification fixture like CI. PostgreSQL comes
  from `PGHOST`/`PGPORT`/`PGUSER` (defaults `127.0.0.1`, `5432`, `tariq`); passwords only
  through `PGPASSWORD`.
  - First run creates the database: installs every release module, then
    `tools/e2e_seed.py` (through `odoo-bin shell`) opens the full entitlement policy
    (`pmo.enabled` and the other keys) and creates the test accounts `e2e_admin` and
    `e2e_employee` (credentials declared in `e2e.config.ts`, override with
    `E2E_USER_<NAME>_PASSWORD`). Expect about 40 s on a warm machine, more on a cold one; a
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

- Never run tests against `:3000`, `:8069` or the `odoo19` database. The wrapper refuses
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

`apps/vendor-admin` is tested on its own; `npm test` and the web commands above do not cover it. Run `npx nuxt prepare` in
`apps/vendor-admin` first (the `postinstall` does it after a normal install).

| Command | Proves |
| --- | --- |
| `npm -w apps/vendor-admin run lint` | Type check (`vue-tsc --build --noEmit`); CI step `vendor-admin`. |
| `npm -w apps/vendor-admin run test` | Unit tests (vitest); CI step `vendor-admin`. |
| `npm -w apps/vendor-admin run e2e` | Playwright against the mock control service in `apps/vendor-admin/e2e`, on a production build; `e2e:dev` runs the `*.dev.spec.ts` specs on `nuxt dev`. Not a CI step. |
| `PATH=/opt/homebrew/bin:$PATH node tools/vendor_admin_local_check.mjs` | Live proof: sign-in, enrollment and team management against the real control plane with real WebAuthn verification. Needs local Postgres; scratch database `webvue_control_scratch_p3live`. Details in `apps/vendor-admin/README.md`. Not a CI step. |

Local evidence only; it does not establish deployment readiness.

## Continuous release verification

The twelve-stage pipeline remains unchanged in scope; the `ci` workflow selects from it as described under "Change-scoped stages". The static stage
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
Never use `odoo19`. Reports distinguish source-process, PostgreSQL, Odoo upgrade,
HTTP/session/attachment and concurrent tenant evidence from Docker/production
proof. `tools/continuous_updates_acceptance/docker_odoo.py` is a separate scoped
image experiment, not fresh product Dockerfile acceptance.

Maintenance model/API checks use test tag `webvue_maintenance`: authorization,
company isolation, operator notices, immutable events, preference/booking CAS,
overlap serialization, scheduling policy and atomic claim duration. Contracts
and web tests cover Arabic/English, draft preservation and IANA/DST windows.
Actual translated-error tests verify PO runtime loading. A local check never
approves hosting, release, external provider quality or universal zero downtime.
