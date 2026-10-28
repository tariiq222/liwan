# Area agent brief (copy, fill the <placeholders>, send as the agent prompt)

Goal: run the `planned` rows of <FILES> against the REAL UI of the running local stack, as the
persona each row names, and record the true outcome in each row. Find and record problems only;
do NOT fix anything, do not commit, do not push, do not open GitHub issues.

## Environment (already running, shared — do NOT start, stop or restart it)
- Web UI http://localhost:43300 (Nuxt dev, Arabic RTL); Odoo 127.0.0.1:43369, scratch DB
  `webvue_scratch_e2e`. Repository: <WORKTREE> (cd there). Never touch the main checkout files,
  ports 3000/8069 or the `odoo19` database.
- Playwright is installed in the worktree. Write scripts in <SCRATCH>/<AREA>/ and load it with
  `createRequire('<WORKTREE>/package.json')('playwright')`; run them with `node` from the worktree.
  One browser context per persona, `locale: 'ar'`. Keep at most <MAX_CONTEXTS> contexts open and
  close them when done. First compile of a page can take 60–90 s; retry 429/503 from the proxy.
- Sign in at /login: «اسم المستخدم», «كلمة المرور», «دخول»; wait until the URL leaves /login.
  Logins and test-only passwords are in `e2e.config.ts` / `tools/e2e_seed.py`; never print them.
- Personas and their roles: `e2e/scenarios/README.md`. Branch personas (`jeddah_staff`,
  `dammam_manager`) serve every «another company» row. `custom role (...)` rows map to the closest
  custom-role persona; if none fits, create a custom role and user as it_admin (timestamped).
- Create-panel routes (`/x/new`) open a dialog (role=dialog) over the list.
- API-only rows: call `fetch('/api/v1/...')` from the signed-in page and record status and `code`.
- Scheduled jobs: arrange data, then run `tools/e2e_cron.py` through the Odoo shell (docstring).
- Known blockers (link them, do not re-report): <KNOWN>.

## Shared-state rules
- Never change the seeded personas (roles, passwords, active state, their employees). Create your
  own users, roles and employees with your area and a timestamp in the name.
- Never switch applications off, suspend the tenant, make it read-only, change branch access mode
  or another application's settings. Such rows stay `planned` with note "exclusive phase".
- Change your own application's settings only to test them and restore them right after.
- Never delete or archive records you did not create.

## Recording (edit only <FILES>)
Pipe `ID<TAB>STATUS<TAB>NOTE` lines into `python3 -B tools/e2e_scenario_status.py`:
- `manual <date>` + short evidence when the expectation holds;
- `fail` + what actually happened (status, message text, screen);
- leave `planned` with a concrete reason when it cannot run here.
Never mark what you did not observe. Then `python3 -B tools/e2e_scenario_coverage.py --check`
(must stay complete, 0 unknown).

## Findings
Append each new problem to <FINDINGS> as:
`### <short Arabic title>` then `IDs:`, `Severity: P0|P1|P2`, `Kind: bug|ux|i18n|a11y|gap|security`,
`Steps:` (numbered), `Expected:`, `Actual:` (exact text/status), `Code:` (file:line if quick).
Security findings: `Kind: security`, minimal exploit detail.

## Priority
Core happy paths and state machines; permission refusals per persona; validation messages
(Arabic, clear, no raw codes); settings options, filters, paging, back navigation.
Report: rows run (manual/fail), rows left planned and why, findings titles with IDs, and any
state you left behind.
