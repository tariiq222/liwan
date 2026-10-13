# Testing guide

nasq has four test layers. Pick the cheapest one that proves the change.

| Layer | Use it for | Run |
| --- | --- | --- |
| 1. Odoo `TransactionCase` / `HttpCase` | Models, access rules, API routes, migrations | Odoo test run on a fresh scratch DB (see `docs/agents/odoo-rules.md` "Check commands"; `npm run test:odoo` wraps it) |
| 2. Contracts + web unit tests | Zod contracts, composables, pure UI logic | `npm test`, `npm -w apps/web run lint` |
| 3. Playwright mock specs | Page behaviour against the mock API, no model needed | `cd apps/web && npm run test:e2e` (CI step `e2e-mock`) |
| 4. Agentic e2e | Whole user journeys through the real UI | `npm run e2e` / `npm run e2e:smoke` |

## Fast local loop

Use these while iterating; `npm test` and the Odoo/CI gates stay binding before a merge.

| Command | What it does |
| --- | --- |
| `npm run check:fast` | Policy checks always, plus ruff, tools tests, contracts/web tests and the web type check only for the layers that changed against `main` (`tools/check_fast.py`). |
| `npm run test:odoo` | Odoo tests of the changed addons and their dependents on a scratch database cloned from a cached template (`tools/odoo_test.py`). Options: `--addons a,b`, `--all`, `--base`, `--dry-run`, `--keep-db`. |
| `npm run wt -- new <area>-<slug>` | New task worktree with its own `node_modules`/`.nuxt`, free ports and a scratch DB name in the git-ignored `.env.worktree` (`tools/wt.py`). |
| `npm run check:semgrep` | Semgrep (`p/python`, `p/typescript`, `p/secrets`) on the source files changed against `main`, tests and generated files excluded (`tools/semgrep_gate.py`). ERROR and secrets findings fail; WARNING is listed only. Needs network for the rulesets, sends no usage data, exits 3 when semgrep or the registry is unavailable. Also runs in the CI `static` step. |
| `npm run test:rtl` | Builds Storybook and opens every story in Arabic at 1280 px and 390 px: no page error, `dir=rtl`, no sideways page scroll (`apps/web/e2e-rtl`, config `playwright.rtl.config.ts`). Stories that cannot render are listed with a reason in `KNOWN_BROKEN` and only that list may shrink. Runs in CI as the `rtl-stories` step. |

Optional local git hooks: `npm run hooks:install` writes `pre-commit` (secret guard, docs and
architecture policy, plus ui policy and ruff for staged files) and `commit-msg` (the
`type(scope): subject` rule) into the shared `.git/hooks`, so every worktree gets them. It leaves
`core.hooksPath` and the existing Git LFS hooks alone, refuses to overwrite a hook that is not
its own, and `git commit --no-verify` still bypasses it. The merge gates stay binding.

`tools/odoo_test.py` builds the template once from the base branch (Odoo commit, release
module list and the base `odoo-addons` tree form its name, so it is rebuilt when any of them
changes) and only ever creates, clones or drops `nasq_scratch_*` databases. Stale
`nasq_scratch_tpl_*` templates are small and can be dropped by hand.

## Running a CI step locally

`woodpecker-cli exec` (Homebrew `woodpecker-cli`) runs `.woodpecker.yml` steps on the local
backend with no server. Verified for the `static` step (197.6 s, passed):

```sh
# 1. a throwaway clone, because the step runs `npm ci` and writes into its workspace
git clone --local --no-hardlinks /Users/tariq/code/nasq /tmp/nasq-ci && cd /tmp/nasq-ci
# 2. a pipeline file holding only the wanted step (exec cannot select one)
#    copy `when:` plus the `static` block of .woodpecker.yml into /tmp/static-only.yaml
woodpecker-cli exec --local --repo-path /tmp/nasq-ci --backend-engine local \
  --commit-branch main /tmp/static-only.yaml
```

Other steps need extra local services (PostgreSQL role `nasq_test`, the Odoo checkout, a Docker
daemon for `image`) and were not run this way. This mirrors CI for a branch before merge; the
local policy runs in AGENTS.md stay the binding gate.

## Measured timings (2026-10-13, 14-core Mac, warm caches, single runs)

| Step | Time |
| --- | --- |
| `npm test` chain plus web type check, step by step | about 50 s |
| `npm run check:fast` when only `tools/` changed | about 18 s |
| `npm ci --ignore-scripts --prefer-offline` | 4.7 s |
| `tools/wt.py new` (worktree, install, `nuxt prepare`) | about 10 s |
| Odoo install of the 10 release modules | about 17 s |
| `createdb -T` clone of the installed template | about 1.2 s |
| `npm run test:odoo -- --addons nasq_hr` (80 tests), warm / cold template | 30 s / 43 s |
| Full Odoo run (install and tests of all release modules, 658 tests) | 234 s |
| CI `e2e-mock` locally (`nuxt build` 28.8 s, 7 Playwright tests 4.9 s) | about 35 s |
| `npm run test:rtl` (Storybook build 7.6 s, 184 stories x 2 viewports, 4 workers) | about 2.4 min |
| Semgrep gate on a few changed files | about 7 s |

Not measured: the agentic e2e runner (needs model credentials) and the Odoo-backed e2e stack.

## 1. Odoo tests

Extend `NasqApiCase` (or `NasqPmoCase`) from `nasq_api/tests/common.py`. Every `test_*.py`
is imported by its addon `tests/__init__.py`. Never run them against the dev `odoo19` DB.

## 2. Unit tests

`npm test` runs the policy checks, the contracts tests and the web unit tests. Keep pure
logic in composables so it can be tested here without a browser.

## 3. Playwright mock specs

Specs live in `apps/web/e2e` and talk to `internal-ui-audit-mock.mjs`. They are
deterministic and free, and CI runs the list in `ci-mock-specs.txt`. Use them for page
states, navigation and regressions that need no judgement.

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
  `nasq_scratch_e2e` (the wrapper refuses any other name and never uses `odoo19`), served
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
