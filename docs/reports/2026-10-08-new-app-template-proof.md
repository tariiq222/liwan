# New-app template proof (Phase 4): app `sample`

Date: 2026-10-08. Worktree `/Users/tariq/code/nasq-spike-new-app-proof`, branch `spike/new-app-proof` (throwaway, not merged, not pushed). Base: `codex/tools-new-app` (819bd9ee).

## Goal
Show that an agent following the `nasq-new-app` skill can add a working application (`sample`, «تجريبي» / "Sample") without editing any foundation file.

## Steps
1. Read the skill; `python3 -B tools/new_app.py sample --name-ar "تجريبي" --name-en "Sample" --dry-run`, then the real run: 24 files created, 3 registration edits, 9 release copies synced.
2. Commit `fafe3fb0 feat(sample): add the sample application` (generator output only).
3. Gates and scratch Odoo found one template bug (missing `_nasq_scope`), fixed in the spike as `c68a5d77 fix(sample): declare the company scope on the record model`.

## Skill vs reality (SKILL.md edited in place, now 120 lines, frontmatter kept)
- Skill never said the model needs `_nasq_scope = 'company'`; the template model lacks it and `nasq_core` `test_nasq_tables_declare_scope` fails (see Residual risks). Skill now says so.
- Skill said the sync writes "copies" without naming them; now documented (RELEASE_COPIES; nine files changed, `.woodpecker.yml` unchanged). Skill now also states that no `components/` or `stories/` folder is created.
- Missing in skill: scratch Odoo needs `NASQ_COMMERCIAL_CONFIG` from `python3 deploy/classification.py fixture --database <db> --mode saas --output <file>` (added); macOS has no `timeout` (noted).
- Missing: page uses `useQuery` inline; move fetching to a composable over `useApi()` as it grows (added). Contracts test lives in `src/<app>/__tests__/schemas.test.ts` (added).
- Missing: known gap, 11 foundation Odoo tests pin the app set (added to section 9).
- Confirmed correct: command line and flags, rail order 60 (next free above 50), shortcut `a`, scope `sample` accepted by git_policy, ids and registration files.

## Allowed-files check: PASS
`git diff --name-only codex/tools-new-app...HEAD` (36 paths at the feat commit; the fix commit touches only `odoo-addons/nasq_sample/models/sample_record.py`) filtered through the allowed set: no disallowed path (grep exit 1). Non-app paths: the three registration files (`tools/arch_layers.json`, `deploy/catalog/solutions/platform_v3.json`, `packages/contracts/src/index.ts`) and nine sync copies: `deploy/provision.sh`, `deploy/woodpecker/image.yml`, `tools/shared_acceptance_live/up.sh`, `deploy/check_isolated.py`, `deploy/OPERATIONS.md`, `deploy/verification-checks.json`, `deploy/control-plane-outage/outage-fixture`, `deploy/control-plane-outage/README.md`, `tools/nasq_cli/operator.py`. Stat: 36 files changed, 481 insertions, 12 deletions. No foundation file (nasq_core, nasq_api, locale loader, nav, baseline) was edited.

## Gates
| Gate | Result |
|---|---|
| `npm ci --ignore-scripts && npm -w apps/web run postinstall` | ok, "Types generated in .nuxt." |
| `npm test` (root) | exit 0: python `Ran 662 tests ... OK`; contracts `29 files, 185 tests passed`; web `164 files, 1257 tests passed` |
| `cd apps/web && npm run lint` | exit 0 |
| `python3 -B tools/arch_policy.py --base codex/tools-new-app` | exit 0 |
| `python3 -B tools/git_policy.py --base codex/tools-new-app` | exit 0 (spike branch name and `feat(sample)` scope accepted) |
| `python3 -B tools/catalog_check.py` | `CATALOG_OK solutions=3` |
| `python3 -B -m unittest discover -s tools -p 'test_*.py'` | `Ran 662 tests ... OK`; working tree stayed clean |
| `ruff check odoo-addons` | All checks passed |
| Temporary vitest (not committed, removed) | `sample` manifest discovered: rail `/sample`, nav `/sample`, feature `sample.enabled` - 1 passed |
Mock Nuxt UI stack was not started (the temporary vitest was used instead).

## Scratch Odoo (db `nasq_scratch_p4proof`, port 8189, data/logs/config under /tmp/p4proof, NASQ_COMMERCIAL_CONFIG fixture, all 11 release modules, `--test-tags` for all)
Run 1 (feat commit only): `12 failed, 0 error(s) of 807 tests` (11 below + `nasq_core` test_nasq_tables_declare_scope: `nasq.sample.record` missing `_nasq_scope`).
Run 2 (after the one-line fix): `odoo.tests.result: 11 failed, 0 error(s) of 807 tests`.
Per addon tests: nasq_api 102, nasq_chat 25, nasq_core 53, nasq_directory 9, nasq_hr 96, nasq_meetings 120, nasq_meetings_pmo 51, nasq_notify 24, nasq_platform 81, nasq_pmo 450, nasq_sample 14 (all 14 sample tests pass). DB dropped and /tmp/p4proof removed.

The 11 remaining failures are all foundation tests that pin the current app/capability set (messages show `nasq_sample`/sample keys; I did not run a baseline Odoo run without sample, but the causes are visible in the assertions):
- `nasq_core` test_app_xmlid_migration (x1)
- `nasq_platform` test_entitlements: test_legacy_initializer_grants_installed_pillars_once, test_registry_exposes_owned_keys_and_baseline_capabilities
- `nasq_api` test_access_admin: test_catalog_is_exact_and_protects_access_changes
- `nasq_api` test_access_composition (x7): actor_keys/legacy_admin_roles, builtin_roles grants, "same 28 keys", groups implications, legacy groups, permission dependencies, permission domains on the wire

## Verdict: PARTIAL (no foundation file edited, but the suite is not green)
The app installs, serves its route and passes its own tests; web, contracts, policies, catalog and tools gates are green. The full Odoo release suite is not green because of the template bug (fixed in spike) and 11 non-generalised foundation tests.

## Residual risks / follow-ups
1. Template bug: add `_nasq_scope = 'company'` to `tools/new_app_templates/odoo-addons/nasq___app__/models/sample_record.py.tmpl` (its real path) and a test in `tools/test_new_app.py`.
2. Generalise the 11 foundation Odoo tests (same approach as the web test generalisation of task 8) so adding an app keeps the suite green; until then the allowed-files rule cannot be met without a red suite.
3. The mock UI was not exercised in a browser; the page itself (SharedPageState list) is only covered by type-check and the manifest assertion.
4. Baseline Odoo run without sample was not repeated; attribution of the 11 failures rests on assertion output.
